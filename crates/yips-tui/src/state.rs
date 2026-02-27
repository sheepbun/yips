use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use yips_core::ipc::{CancelOrigin, CancelOutcome, ClientMessage, DaemonMessage};

/// A renderable item in the conversation timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HistoryItem {
    User {
        content: String,
    },
    Assistant {
        content: String,
    },
    ToolStart {
        tool_call_id: String,
        tool_name: String,
    },
    ToolResult {
        tool_call_id: String,
        success: bool,
        output: String,
    },
    Error {
        message: String,
    },
    System {
        message: String,
    },
}

/// Result of processing a key event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyAction {
    None,
    Submit,
    CancelTurn,
    ScrollUpLine,
    ScrollDownLine,
    ScrollUpPage,
    ScrollDownPage,
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CancelEventKey {
    session_id: String,
    outcome: CancelOutcome,
    origin: CancelOrigin,
}

/// Application state for the TUI chat loop.
#[derive(Debug, Default)]
pub struct AppState {
    pub session_id: Option<String>,
    pub last_round_count: Option<u32>,
    pub history: Vec<HistoryItem>,
    pub composer: String,
    pub awaiting_turn: bool,
    pub streaming_buffer: String,
    pub saw_stream_tokens_this_turn: bool,
    pub should_quit: bool,
    pub error_banner: Option<String>,
    history_scroll_offset_lines: usize,
    history_viewport_lines: usize,
    cursor_chars: usize,
    assistant_recorded_this_turn: bool,
}

impl AppState {
    /// Create a new app state with an optional initial session id.
    pub fn new(session_id: Option<String>) -> Self {
        Self {
            session_id,
            ..Self::default()
        }
    }

    /// Handle a key event for editing, submit, or quit.
    pub fn handle_key_event(&mut self, key: KeyEvent) -> KeyAction {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.should_quit = true;
            return KeyAction::Quit;
        }

        match key.code {
            KeyCode::Enter if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.insert_char('\n');
                KeyAction::None
            }
            KeyCode::Enter => KeyAction::Submit,
            KeyCode::Esc => {
                if self.can_cancel_turn() {
                    KeyAction::CancelTurn
                } else {
                    KeyAction::None
                }
            }
            KeyCode::Up => KeyAction::ScrollUpLine,
            KeyCode::Down => KeyAction::ScrollDownLine,
            KeyCode::PageUp => KeyAction::ScrollUpPage,
            KeyCode::PageDown => KeyAction::ScrollDownPage,
            KeyCode::Char(ch) => {
                self.insert_char(ch);
                KeyAction::None
            }
            KeyCode::Backspace => {
                self.delete_before_cursor();
                KeyAction::None
            }
            KeyCode::Delete => {
                self.delete_at_cursor();
                KeyAction::None
            }
            KeyCode::Left => {
                self.cursor_chars = self.cursor_chars.saturating_sub(1);
                KeyAction::None
            }
            KeyCode::Right => {
                let len = self.composer.chars().count();
                self.cursor_chars = (self.cursor_chars + 1).min(len);
                KeyAction::None
            }
            KeyCode::Home => {
                self.cursor_chars = 0;
                KeyAction::None
            }
            KeyCode::End => {
                self.cursor_chars = self.composer.chars().count();
                KeyAction::None
            }
            _ => KeyAction::None,
        }
    }

    /// Build a chat message from current input, if non-empty, and update local state.
    pub fn submit_input(&mut self, working_directory: Option<String>) -> Option<ClientMessage> {
        let message = self.composer.trim_end().to_string();
        if message.is_empty() || self.awaiting_turn {
            return None;
        }

        self.history.push(HistoryItem::User {
            content: message.clone(),
        });
        self.composer.clear();
        self.cursor_chars = 0;
        self.awaiting_turn = true;
        self.streaming_buffer.clear();
        self.saw_stream_tokens_this_turn = false;
        self.assistant_recorded_this_turn = false;
        self.error_banner = None;

        Some(ClientMessage::Chat {
            session_id: self.session_id.clone(),
            message,
            working_directory,
        })
    }

    /// Build a cancel message for the active turn, if cancellable.
    pub fn build_cancel_message(&self) -> Option<ClientMessage> {
        if !self.can_cancel_turn() {
            return None;
        }

        self.session_id
            .as_ref()
            .map(|session_id| ClientMessage::Cancel {
                session_id: session_id.clone(),
            })
    }

    /// Apply an incoming daemon message to local state.
    pub fn apply_daemon_message(&mut self, msg: DaemonMessage) {
        let was_pinned = self.history_is_pinned_to_bottom();
        let previous_total_lines = self.total_history_line_count();

        match msg {
            DaemonMessage::Token { session_id, token } => {
                self.session_id = Some(session_id);
                self.saw_stream_tokens_this_turn = true;
                self.streaming_buffer.push_str(&token);
            }
            DaemonMessage::AssistantMessage {
                session_id,
                content,
                ..
            } => {
                self.session_id = Some(session_id);
                if self.assistant_recorded_this_turn {
                    return;
                }

                let final_content = if self.saw_stream_tokens_this_turn {
                    if self.streaming_buffer.is_empty() {
                        content
                    } else {
                        self.streaming_buffer.clone()
                    }
                } else {
                    content
                };

                if !final_content.is_empty() {
                    self.history.push(HistoryItem::Assistant {
                        content: final_content,
                    });
                    self.assistant_recorded_this_turn = true;
                }

                self.streaming_buffer.clear();
            }
            DaemonMessage::ToolStart {
                session_id,
                tool_call_id,
                tool_name,
            } => {
                self.session_id = Some(session_id);
                self.history.push(HistoryItem::ToolStart {
                    tool_call_id,
                    tool_name,
                });
            }
            DaemonMessage::ToolResult {
                session_id,
                tool_call_id,
                success,
                output,
            } => {
                self.session_id = Some(session_id);
                self.history.push(HistoryItem::ToolResult {
                    tool_call_id,
                    success,
                    output,
                });
            }
            DaemonMessage::TurnComplete {
                session_id,
                round_count,
            } => {
                self.session_id = Some(session_id.clone());
                self.last_round_count = Some(round_count);
                self.awaiting_turn = false;

                if !self.streaming_buffer.is_empty() && !self.assistant_recorded_this_turn {
                    self.history.push(HistoryItem::Assistant {
                        content: self.streaming_buffer.clone(),
                    });
                }

                self.streaming_buffer.clear();
                self.saw_stream_tokens_this_turn = false;
                self.assistant_recorded_this_turn = false;
                self.history.push(HistoryItem::System {
                    message: format!(
                        "Turn complete: session={} rounds={}",
                        session_id, round_count
                    ),
                });
            }
            DaemonMessage::CancelResult {
                session_id,
                outcome,
                origin,
            } => {
                self.session_id = Some(session_id.clone());
                self.reset_turn_progress_state();
                self.error_banner = None;

                let event = CancelEventKey {
                    session_id: session_id.clone(),
                    outcome,
                    origin,
                };
                self.history.push(HistoryItem::System {
                    message: format_cancel_system_message(&event),
                });
            }
            DaemonMessage::Error { message, .. } => {
                self.reset_turn_progress_state();
                self.error_banner = Some(message.clone());
                self.history.push(HistoryItem::Error { message });
            }
            _ => {}
        }

        self.adjust_scroll_after_history_change(previous_total_lines, was_pinned);
    }

    /// Cursor position in `(line, column)` within the composer text.
    pub fn cursor_line_col(&self) -> (u16, u16) {
        let prefix: String = self.composer.chars().take(self.cursor_chars).collect();
        let line = prefix.chars().filter(|c| *c == '\n').count() as u16;
        let col = prefix.chars().rev().take_while(|c| *c != '\n').count() as u16;
        (line, col)
    }

    /// Set the visible history viewport height (in lines) used for page scrolling.
    pub fn set_history_viewport_lines(&mut self, lines: usize) {
        self.history_viewport_lines = lines.max(1);
        self.clamp_history_scroll_offset();
    }

    /// Scroll history up (toward older messages) by a line count.
    pub fn scroll_history_up(&mut self, lines: usize) {
        self.history_scroll_offset_lines = self.history_scroll_offset_lines.saturating_add(lines);
        self.clamp_history_scroll_offset();
    }

    /// Scroll history down (toward latest messages) by a line count.
    pub fn scroll_history_down(&mut self, lines: usize) {
        self.history_scroll_offset_lines = self.history_scroll_offset_lines.saturating_sub(lines);
    }

    /// Scroll history up by one viewport page.
    pub fn scroll_history_page_up(&mut self) {
        self.scroll_history_up(self.effective_history_viewport_lines());
    }

    /// Scroll history down by one viewport page.
    pub fn scroll_history_page_down(&mut self) {
        self.scroll_history_down(self.effective_history_viewport_lines());
    }

    /// Return the current history offset from the latest line.
    pub fn history_scroll_offset_lines(&self) -> usize {
        self.history_scroll_offset_lines
    }

    /// Return true when history is following the latest line.
    pub fn history_is_pinned_to_bottom(&self) -> bool {
        self.history_scroll_offset_lines == 0
    }

    fn insert_char(&mut self, ch: char) {
        let idx = char_to_byte_index(&self.composer, self.cursor_chars);
        self.composer.insert(idx, ch);
        self.cursor_chars += 1;
    }

    fn delete_before_cursor(&mut self) {
        if self.cursor_chars == 0 {
            return;
        }

        let start = char_to_byte_index(&self.composer, self.cursor_chars - 1);
        let end = char_to_byte_index(&self.composer, self.cursor_chars);
        self.composer.replace_range(start..end, "");
        self.cursor_chars -= 1;
    }

    fn delete_at_cursor(&mut self) {
        let len = self.composer.chars().count();
        if self.cursor_chars >= len {
            return;
        }

        let start = char_to_byte_index(&self.composer, self.cursor_chars);
        let end = char_to_byte_index(&self.composer, self.cursor_chars + 1);
        self.composer.replace_range(start..end, "");
    }

    fn can_cancel_turn(&self) -> bool {
        self.awaiting_turn && self.session_id.is_some()
    }

    fn reset_turn_progress_state(&mut self) {
        self.awaiting_turn = false;
        self.streaming_buffer.clear();
        self.saw_stream_tokens_this_turn = false;
        self.assistant_recorded_this_turn = false;
    }

    fn total_history_line_count(&self) -> usize {
        let mut count = self.history.len();
        if self.awaiting_turn && !self.streaming_buffer.is_empty() {
            count += 1;
        }
        count
    }

    fn effective_history_viewport_lines(&self) -> usize {
        self.history_viewport_lines.max(1)
    }

    fn max_history_scroll_offset_lines(&self) -> usize {
        self.total_history_line_count()
            .saturating_sub(self.effective_history_viewport_lines())
    }

    fn clamp_history_scroll_offset(&mut self) {
        self.history_scroll_offset_lines = self
            .history_scroll_offset_lines
            .min(self.max_history_scroll_offset_lines());
    }

    fn adjust_scroll_after_history_change(
        &mut self,
        previous_total_lines: usize,
        was_pinned: bool,
    ) {
        if was_pinned {
            self.history_scroll_offset_lines = 0;
            return;
        }

        let current_total_lines = self.total_history_line_count();
        if current_total_lines > previous_total_lines {
            self.history_scroll_offset_lines = self
                .history_scroll_offset_lines
                .saturating_add(current_total_lines - previous_total_lines);
        }
        self.clamp_history_scroll_offset();
    }
}

fn char_to_byte_index(s: &str, char_idx: usize) -> usize {
    if char_idx == 0 {
        return 0;
    }

    s.char_indices()
        .nth(char_idx)
        .map(|(idx, _)| idx)
        .unwrap_or_else(|| s.len())
}

fn format_cancel_system_message(event: &CancelEventKey) -> String {
    match (&event.outcome, &event.origin) {
        (CancelOutcome::CancelledActiveTurn, CancelOrigin::UserRequest) => {
            format!("Cancel succeeded: session={}", event.session_id)
        }
        (CancelOutcome::NoActiveTurn, CancelOrigin::UserRequest) => {
            format!(
                "Cancel ignored: no active turn (session={})",
                event.session_id
            )
        }
        (CancelOutcome::CancelledActiveTurn, CancelOrigin::SupersededByNewChat) => {
            format!(
                "Previous turn cancelled by a new chat request (session={})",
                event.session_id
            )
        }
        (CancelOutcome::NoActiveTurn, CancelOrigin::SupersededByNewChat) => {
            format!(
                "Cancel ignored: no active turn (session={})",
                event.session_id
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEventKind;

    #[test]
    fn submit_input_builds_chat_message_and_clears_composer() {
        let mut state = AppState::new(Some("s1".to_string()));
        state.composer = "Hello daemon".to_string();

        let msg = state.submit_input(Some("/tmp".to_string()));

        assert!(state.composer.is_empty());
        assert!(state.awaiting_turn);
        assert_eq!(
            state.history,
            vec![HistoryItem::User {
                content: "Hello daemon".to_string()
            }]
        );

        match msg {
            Some(ClientMessage::Chat {
                session_id,
                message,
                working_directory,
            }) => {
                assert_eq!(session_id.as_deref(), Some("s1"));
                assert_eq!(message, "Hello daemon");
                assert_eq!(working_directory.as_deref(), Some("/tmp"));
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn token_then_assistant_finalizes_single_message() {
        let mut state = AppState::default();

        state.apply_daemon_message(DaemonMessage::Token {
            session_id: "sess-1".to_string(),
            token: "Hello".to_string(),
        });
        state.apply_daemon_message(DaemonMessage::Token {
            session_id: "sess-1".to_string(),
            token: " world".to_string(),
        });
        state.apply_daemon_message(DaemonMessage::AssistantMessage {
            session_id: "sess-1".to_string(),
            content: "Hello world".to_string(),
            tool_calls: None,
        });

        assert_eq!(
            state.history,
            vec![HistoryItem::Assistant {
                content: "Hello world".to_string()
            }]
        );
        assert!(state.streaming_buffer.is_empty());
    }

    #[test]
    fn tool_events_are_recorded_in_order() {
        let mut state = AppState::default();

        state.apply_daemon_message(DaemonMessage::ToolStart {
            session_id: "sess-2".to_string(),
            tool_call_id: "call-1".to_string(),
            tool_name: "read_file".to_string(),
        });
        state.apply_daemon_message(DaemonMessage::ToolResult {
            session_id: "sess-2".to_string(),
            tool_call_id: "call-1".to_string(),
            success: true,
            output: "ok".to_string(),
        });

        assert_eq!(
            state.history,
            vec![
                HistoryItem::ToolStart {
                    tool_call_id: "call-1".to_string(),
                    tool_name: "read_file".to_string()
                },
                HistoryItem::ToolResult {
                    tool_call_id: "call-1".to_string(),
                    success: true,
                    output: "ok".to_string()
                }
            ]
        );
    }

    #[test]
    fn turn_complete_updates_status_line_state() {
        let mut state = AppState::default();
        state.awaiting_turn = true;

        state.apply_daemon_message(DaemonMessage::TurnComplete {
            session_id: "sess-3".to_string(),
            round_count: 2,
        });

        assert_eq!(state.session_id.as_deref(), Some("sess-3"));
        assert_eq!(state.last_round_count, Some(2));
        assert!(!state.awaiting_turn);
    }

    #[test]
    fn error_event_clears_awaiting_turn_and_records_error() {
        let mut state = AppState::default();
        state.awaiting_turn = true;
        state.streaming_buffer = "partial".to_string();

        state.apply_daemon_message(DaemonMessage::Error {
            session_id: Some("sess-4".to_string()),
            message: "boom".to_string(),
        });

        assert!(!state.awaiting_turn);
        assert!(state.streaming_buffer.is_empty());
        assert_eq!(state.error_banner.as_deref(), Some("boom"));
        assert_eq!(
            state.history.last(),
            Some(&HistoryItem::Error {
                message: "boom".to_string()
            })
        );
    }

    #[test]
    fn cancel_success_result_is_mapped_to_system_history() {
        let mut state = AppState::default();
        state.awaiting_turn = true;
        state.streaming_buffer = "partial".to_string();
        state.saw_stream_tokens_this_turn = true;
        state.assistant_recorded_this_turn = true;

        state.apply_daemon_message(DaemonMessage::CancelResult {
            session_id: "sess-cancel".to_string(),
            outcome: CancelOutcome::CancelledActiveTurn,
            origin: CancelOrigin::UserRequest,
        });

        assert!(!state.awaiting_turn);
        assert!(state.streaming_buffer.is_empty());
        assert!(!state.saw_stream_tokens_this_turn);
        assert!(!state.assistant_recorded_this_turn);
        assert!(state.error_banner.is_none());
        assert_eq!(
            state.history.last(),
            Some(&HistoryItem::System {
                message: "Cancel succeeded: session=sess-cancel".to_string()
            })
        );
    }

    #[test]
    fn cancel_no_active_turn_result_is_mapped_to_system_history() {
        let mut state = AppState::default();
        state.awaiting_turn = true;
        state.streaming_buffer = "partial".to_string();

        state.apply_daemon_message(DaemonMessage::CancelResult {
            session_id: "sess-idle".to_string(),
            outcome: CancelOutcome::NoActiveTurn,
            origin: CancelOrigin::UserRequest,
        });

        assert!(!state.awaiting_turn);
        assert!(state.streaming_buffer.is_empty());
        assert!(state.error_banner.is_none());
        assert_eq!(
            state.history.last(),
            Some(&HistoryItem::System {
                message: "Cancel ignored: no active turn (session=sess-idle)".to_string()
            })
        );
    }

    #[test]
    fn cancel_shaped_error_is_recorded_as_error() {
        let mut state = AppState::default();
        state.awaiting_turn = true;

        state.apply_daemon_message(DaemonMessage::Error {
            session_id: Some("sess-cancel".to_string()),
            message: "Cancelled session turn: sess-cancel".to_string(),
        });

        assert!(!state.awaiting_turn);
        assert_eq!(
            state.error_banner.as_deref(),
            Some("Cancelled session turn: sess-cancel")
        );
        assert_eq!(
            state.history.last(),
            Some(&HistoryItem::Error {
                message: "Cancelled session turn: sess-cancel".to_string()
            })
        );
    }

    #[test]
    fn esc_requests_cancel_when_turn_active_and_session_known() {
        let mut state = AppState::default();
        state.awaiting_turn = true;
        state.session_id = Some("sess-cancel".to_string());

        let action = state.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(action, KeyAction::CancelTurn);

        match state.build_cancel_message() {
            Some(ClientMessage::Cancel { session_id }) => {
                assert_eq!(session_id, "sess-cancel");
            }
            other => panic!("unexpected cancel message: {other:?}"),
        }
    }

    #[test]
    fn esc_is_noop_when_idle() {
        let mut state = AppState::default();
        state.session_id = Some("sess-idle".to_string());

        let action = state.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(action, KeyAction::None);
        assert!(state.build_cancel_message().is_none());
    }

    #[test]
    fn esc_is_noop_when_no_session_id() {
        let mut state = AppState::default();
        state.awaiting_turn = true;
        state.session_id = None;

        let action = state.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(action, KeyAction::None);
        assert!(state.build_cancel_message().is_none());
    }

    #[test]
    fn enter_returns_submit() {
        let mut state = AppState::default();
        let action = state.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(action, KeyAction::Submit);
    }

    #[test]
    fn ctrl_enter_inserts_newline_not_submit() {
        let mut state = AppState::default();
        state.composer = "abc".to_string();
        state.cursor_chars = 3;

        let action = state.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL));

        assert_eq!(action, KeyAction::None);
        assert_eq!(state.composer, "abc\n");
        assert_eq!(state.cursor_chars, 4);
    }

    #[test]
    fn ctrl_c_sets_should_quit_and_returns_quit() {
        let mut state = AppState::default();
        let key = KeyEvent {
            code: KeyCode::Char('c'),
            modifiers: KeyModifiers::CONTROL,
            kind: KeyEventKind::Press,
            state: crossterm::event::KeyEventState::NONE,
        };

        let action = state.handle_key_event(key);
        assert_eq!(action, KeyAction::Quit);
        assert!(state.should_quit);
    }

    #[test]
    fn up_down_keys_return_scroll_actions() {
        let mut state = AppState::default();
        assert_eq!(
            state.handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)),
            KeyAction::ScrollUpLine
        );
        assert_eq!(
            state.handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
            KeyAction::ScrollDownLine
        );
    }

    #[test]
    fn page_keys_return_scroll_actions() {
        let mut state = AppState::default();
        assert_eq!(
            state.handle_key_event(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE)),
            KeyAction::ScrollUpPage
        );
        assert_eq!(
            state.handle_key_event(KeyEvent::new(KeyCode::PageDown, KeyModifiers::NONE)),
            KeyAction::ScrollDownPage
        );
    }

    #[test]
    fn scroll_clamps_to_top_and_bottom() {
        let mut state = AppState::default();
        state.set_history_viewport_lines(2);
        state.history = vec![
            HistoryItem::System {
                message: "1".to_string(),
            },
            HistoryItem::System {
                message: "2".to_string(),
            },
            HistoryItem::System {
                message: "3".to_string(),
            },
            HistoryItem::System {
                message: "4".to_string(),
            },
            HistoryItem::System {
                message: "5".to_string(),
            },
        ];

        state.scroll_history_up(100);
        assert_eq!(state.history_scroll_offset_lines(), 3);

        state.scroll_history_down(1);
        assert_eq!(state.history_scroll_offset_lines(), 2);

        state.scroll_history_down(100);
        assert_eq!(state.history_scroll_offset_lines(), 0);
    }

    #[test]
    fn page_scroll_uses_viewport_height() {
        let mut state = AppState::default();
        state.set_history_viewport_lines(3);
        state.history = (0..10)
            .map(|n| HistoryItem::System {
                message: n.to_string(),
            })
            .collect();

        state.scroll_history_page_up();
        assert_eq!(state.history_scroll_offset_lines(), 3);
        state.scroll_history_page_up();
        assert_eq!(state.history_scroll_offset_lines(), 6);
        state.scroll_history_page_down();
        assert_eq!(state.history_scroll_offset_lines(), 3);
    }

    #[test]
    fn incoming_history_auto_follows_when_pinned() {
        let mut state = AppState::default();
        state.set_history_viewport_lines(2);
        state.history = vec![
            HistoryItem::System {
                message: "a".to_string(),
            },
            HistoryItem::System {
                message: "b".to_string(),
            },
            HistoryItem::System {
                message: "c".to_string(),
            },
        ];

        assert!(state.history_is_pinned_to_bottom());
        state.apply_daemon_message(DaemonMessage::ToolStart {
            session_id: "sess".to_string(),
            tool_call_id: "call-1".to_string(),
            tool_name: "read_file".to_string(),
        });

        assert_eq!(state.history_scroll_offset_lines(), 0);
    }

    #[test]
    fn incoming_history_preserves_position_when_scrolled_up() {
        let mut state = AppState::default();
        state.set_history_viewport_lines(2);
        state.history = vec![
            HistoryItem::System {
                message: "a".to_string(),
            },
            HistoryItem::System {
                message: "b".to_string(),
            },
            HistoryItem::System {
                message: "c".to_string(),
            },
        ];
        state.scroll_history_up(1);
        assert_eq!(state.history_scroll_offset_lines(), 1);

        state.apply_daemon_message(DaemonMessage::ToolStart {
            session_id: "sess".to_string(),
            tool_call_id: "call-2".to_string(),
            tool_name: "read_file".to_string(),
        });

        assert_eq!(state.history_scroll_offset_lines(), 2);
    }

    #[test]
    fn streaming_line_counts_toward_scroll_clamp() {
        let mut state = AppState::default();
        state.set_history_viewport_lines(1);
        state.history.push(HistoryItem::System {
            message: "existing".to_string(),
        });
        state.awaiting_turn = true;
        state.apply_daemon_message(DaemonMessage::Token {
            session_id: "sess-stream".to_string(),
            token: "partial".to_string(),
        });

        state.scroll_history_up(10);
        assert_eq!(state.total_history_line_count(), 2);
        assert_eq!(state.history_scroll_offset_lines(), 1);
    }
}
