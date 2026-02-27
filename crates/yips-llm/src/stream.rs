//! SSE stream parsing for the `/v1/chat/completions` streaming endpoint.

use bytes::Bytes;
use futures::stream::Stream;
use std::pin::Pin;
use std::task::{Context, Poll};

use crate::error::{LlmError, Result};
use crate::types::ChatCompletionChunk;

/// A stream that parses SSE `data:` lines from a byte stream and yields
/// [`ChatCompletionChunk`] items.
pub struct SseStream {
    /// The underlying byte stream from reqwest.
    inner: Pin<Box<dyn Stream<Item = std::result::Result<Bytes, reqwest::Error>> + Send>>,
    /// Buffer for incomplete lines across chunk boundaries.
    buffer: String,
    /// Set to `true` once we receive `data: [DONE]`.
    done: bool,
}

impl SseStream {
    /// Create a new SSE stream from a reqwest response byte stream.
    pub fn new(
        inner: impl Stream<Item = std::result::Result<Bytes, reqwest::Error>> + Send + 'static,
    ) -> Self {
        Self {
            inner: Box::pin(inner),
            buffer: String::new(),
            done: false,
        }
    }

    /// Parse buffered data and return the next available chunk, if any.
    ///
    /// Returns:
    /// - `Some(Ok(chunk))` if a complete `data: {...}` line was found
    /// - `Some(Err(_))` if parsing failed
    /// - `None` if we need more data or the stream is done
    fn try_parse_next(&mut self) -> Option<Result<ChatCompletionChunk>> {
        loop {
            // Find the next complete line.
            let newline_pos = match self.buffer.find('\n') {
                Some(pos) => pos,
                None => return None,
            };

            let line = self.buffer[..newline_pos]
                .trim_end_matches('\r')
                .to_string();
            self.buffer = self.buffer[newline_pos + 1..].to_string();

            // Skip empty lines and comments.
            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            // We only care about `data:` lines.
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();

                // Check for the sentinel.
                if data == "[DONE]" {
                    self.done = true;
                    return None;
                }

                // Parse the JSON payload.
                match serde_json::from_str::<ChatCompletionChunk>(data) {
                    Ok(chunk) => return Some(Ok(chunk)),
                    Err(e) => {
                        tracing::warn!(data = data, error = %e, "Failed to parse SSE chunk");
                        return Some(Err(LlmError::Json(e)));
                    }
                }
            }
            // Ignore non-data SSE fields (event:, id:, retry:).
        }
    }
}

impl Stream for SseStream {
    type Item = Result<ChatCompletionChunk>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();

        if this.done {
            return Poll::Ready(None);
        }

        // First, try to yield a chunk from already-buffered data.
        if let Some(result) = this.try_parse_next() {
            return Poll::Ready(Some(result));
        }

        // Pull more bytes from the underlying stream.
        loop {
            match this.inner.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(bytes))) => {
                    // Append new bytes to the buffer.
                    match std::str::from_utf8(&bytes) {
                        Ok(text) => this.buffer.push_str(text),
                        Err(e) => {
                            return Poll::Ready(Some(Err(LlmError::Stream(format!(
                                "Invalid UTF-8 in SSE stream: {e}"
                            )))));
                        }
                    }

                    // Try to extract a chunk from the updated buffer.
                    if let Some(result) = this.try_parse_next() {
                        return Poll::Ready(Some(result));
                    }

                    // Need more data -- loop and poll again.
                    continue;
                }
                Poll::Ready(Some(Err(e))) => {
                    return Poll::Ready(Some(Err(LlmError::Http(e))));
                }
                Poll::Ready(None) => {
                    // The HTTP stream ended.
                    if this.done {
                        return Poll::Ready(None);
                    }
                    // Try to parse anything remaining in the buffer.
                    if let Some(result) = this.try_parse_next() {
                        return Poll::Ready(Some(result));
                    }
                    // No more data; stream ended (possibly without [DONE]).
                    return Poll::Ready(None);
                }
                Poll::Pending => {
                    return Poll::Pending;
                }
            }
        }
    }
}

/// Convenience alias for a boxed SSE chunk stream.
pub type ChatCompletionStream = Pin<Box<dyn Stream<Item = Result<ChatCompletionChunk>> + Send>>;
