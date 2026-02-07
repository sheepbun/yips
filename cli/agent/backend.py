"""
Backend communication logic for YipsAgent.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from typing import Any, TYPE_CHECKING

import requests
from rich.text import Text
from rich.live import Live
from rich.console import Group

from cli.color_utils import (
    gradient_text,
    apply_gradient_to_text,
    get_yips_prefix,
    TOOL_COLOR,
)
from cli.config import (
    CLAUDE_CLI_PATH,
    CLAUDE_CLI_MODEL,
)
from cli.llamacpp import (
    LLAMA_SERVER_URL,
    LLAMA_SERVER_PATH,
    is_llamacpp_running,
    start_llamacpp,
)
from cli.setup import install_llama_server, download_default_model
from cli.info_utils import (
    get_friendly_backend_name,
)
from cli.ui_rendering import (
    PulsingSpinner,
    show_loading,
    render_tool_call,
    render_thinking_block,
    calculate_reading_pause,
)
from cli.tool_execution import clean_response

if TYPE_CHECKING:
    from cli.type_defs import YipsAgentProtocol


class AgentBackendMixin:
    """Mixin providing backend communication capabilities to YipsAgent."""

    def initialize_backend(self: YipsAgentProtocol) -> None:
        """Initialize backend after UI is displayed."""
        if getattr(self, 'backend_initialized', False):
            return

        # If using Claude CLI, nothing to initialize
        if getattr(self, 'use_claude_cli', False):
            self.backend_initialized = True
            return

        # llama.cpp backend
        if self.backend == "llamacpp":
            if not is_llamacpp_running():
                if not start_llamacpp(self.current_model):
                    # Check if we should attempt self-correction
                    from rich.prompt import Confirm
                    import os
                    
                    self.console.print(f"[yellow]{get_friendly_backend_name('llamacpp')} unavailable.[/yellow]")
                    
                    # Diagnose the issue
                    server_exists = os.path.exists(LLAMA_SERVER_PATH)
                    
                    if not server_exists:
                        msg = "llama.cpp binary not found."
                        action = "attempt to download and build it"
                        should_ask = True
                    else:
                        msg = "llama.cpp failed to start (tried GPU and CPU modes)."
                        action = "attempt to rebuild it (might fix compatibility issues)"
                        # If it exists but fails, it's risky to just rebuild without asking, 
                        # but we should offer it.
                        should_ask = True

                    self.console.print(f"[red]{msg}[/red]")

                    if should_ask and Confirm.ask(f"Would you like me to {action}?"):
                         # 1. Download Model (idempotent-ish)
                         if not download_default_model():
                             self.console.print("[red]Failed to verify default model.[/red]")
                         
                         # 2. Install/Rebuild Server
                         install_llama_server()
                         
                         # 3. Retry Start
                         if start_llamacpp(self.current_model):
                             self.console.print("[green]Successfully started llama.cpp![/green]")
                             self.backend_initialized = True
                             return

                    self.console.print(f"[yellow]Falling back to {get_friendly_backend_name('claude')}...[/yellow]")
                    self.use_claude_cli = True
                    self.backend = "claude"
                    self.current_model = CLAUDE_CLI_MODEL
            else:
                self.backend_initialized = True
                return

        self.backend_initialized = True

    def check_and_prune_context(self: YipsAgentProtocol, additional_text: str = "") -> None:
        """Check if context exceeds limit and prune/summarize if necessary."""
        # Ensure limits are initialized
        if not hasattr(self, 'token_limits'):
            if hasattr(self, 'calculate_context_limits'):
                self.calculate_context_limits()
            else:
                return

        system_prompt = self.load_context()
        
        # Estimate total tokens: System + Summary + History + New Message
        current_est = self.estimate_tokens(system_prompt, self.conversation_history)
        if hasattr(self, 'running_summary') and self.running_summary:
            current_est += len(self.running_summary) // 3  # Conservative estimate
            
        if additional_text:
            current_est += len(additional_text) // 3

        threshold = self.token_limits.get("pruning_threshold", 15000)
        
        if current_est < threshold:
            return

        # Pruning needed
        if self.verbose_mode:
            self.console.print(f"[yellow]Context limit approached ({current_est}/{threshold}). Pruning...[/yellow]")
            
        prune_amount_tokens = self.token_limits.get("prune_amount", 4000)
        self.force_prune_context(prune_amount_tokens)

    def force_prune_context(self: YipsAgentProtocol, amount_tokens: int) -> None:
        """Force prune the conversation history by a specific token amount."""
        pruned_tokens = 0
        
        if self.verbose_mode:
            self.console.print(f"[dim]Force pruning requesting removal of ~{amount_tokens} tokens...[/dim]")

        # 1. Prune whole messages from the beginning, keeping at least the last 1
        # (We use a loop to pop one by one until satisfied)
        while len(self.conversation_history) > 1 and pruned_tokens < amount_tokens:
            msg = self.conversation_history.pop(0)
            
            # Add to archive
            if not hasattr(self, 'archived_history'):
                self.archived_history = []
            self.archived_history.append(msg)
            
            # Calculate tokens removed
            msg_len = len(msg.get("content", ""))
            msg_tokens = msg_len // 3
            if msg_tokens == 0: msg_tokens = 1
            
            pruned_tokens += msg_tokens
            
        if pruned_tokens >= amount_tokens:
            if self.verbose_mode:
                 self.console.print(f"[dim]Pruned ~{pruned_tokens} tokens (removed whole messages).[/dim]")
            return

        # 2. If still need to prune, truncate the content of remaining messages
        # We start from the oldest remaining message.
        remaining_needed = amount_tokens - pruned_tokens
        
        if self.verbose_mode:
            self.console.print(f"[dim]Still need to prune ~{remaining_needed} tokens. Truncating content...[/dim]")

        for i in range(len(self.conversation_history)):
            if remaining_needed <= 0:
                break
                
            msg = self.conversation_history[i]
            content = msg.get("content", "")
            content_len = len(content)
            current_tokens = content_len // 3
            
            # Only truncate if it has significant content
            if current_tokens > 50:
                # Calculate chars to remove
                # 1 token ~= 3 chars. 
                chars_to_remove = int(remaining_needed * 3.5) # slightly aggressive
                
                # Ensure we don't delete the whole thing, leave a tail
                max_remove = content_len - 100 
                if max_remove < 0: max_remove = 0
                
                if chars_to_remove > max_remove:
                    chars_to_remove = max_remove
                
                if chars_to_remove > 0:
                    # Truncate from the beginning (assuming older context in the message is less critical)
                    new_content = f"...[TRUNCATED {chars_to_remove} chars]...\n" + content[chars_to_remove:]
                    msg["content"] = new_content
                    
                    removed_tokens = chars_to_remove // 3
                    remaining_needed -= removed_tokens
                    pruned_tokens += removed_tokens

    def get_response(self: YipsAgentProtocol, message: str) -> str:
        """Get response using available backend (llamacpp or Claude CLI)."""
        if not getattr(self, 'backend_initialized', False):
            return "[Error: Backend not initialized]"

        # Check and prune context before generation
        self.check_and_prune_context(additional_text=message)

        self.emit_gui_event("status", "thinking")

        if getattr(self, 'use_claude_cli', False):
            response = self.call_claude_cli(message)
        elif self.backend == "llamacpp":
            response = self.call_llamacpp(message)
            # If llama.cpp fails, fall back to Claude CLI
            if response.startswith("[Error: Could not connect") or response.startswith("[Error calling llama.cpp"):
                self.console.print(f"[yellow]{get_friendly_backend_name('llamacpp')} disconnected, trying {get_friendly_backend_name('claude')}...[/yellow]")
                self.backend = "claude"
                self.use_claude_cli = True
                response = self.call_claude_cli(message)
        else:
             # Should not happen given init logic, but fallback
             self.console.print(f"[yellow]Unknown backend {self.backend}, switching to {get_friendly_backend_name('claude')}.[/yellow]")
             self.backend = "claude"
             self.use_claude_cli = True
             response = self.call_claude_cli(message)
        
        self.emit_gui_event("status", "idle")
        return response

    def call_llamacpp(self: YipsAgentProtocol, message: str) -> str:
        """Call llama-server API using OpenAI-compatible endpoint with retries."""
        system_prompt = self.load_context()
        
        # Max retries for context overflow handling
        max_overflow_retries = 2
        overflow_retry_count = 0

        while True: # Outer loop for context overflow retries
            raw_messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
            
            # Inject Running Summary if available
            if hasattr(self, 'running_summary') and self.running_summary:
                raw_messages.append({
                    "role": "system", 
                    "content": f"PREVIOUS CONVERSATION SUMMARY:\n{self.running_summary}"
                })

            for msg in self.conversation_history:
                if msg["role"] == "system":
                    content = msg["content"]
                    try:
                        if content.startswith('{') and content.endswith('}'):
                            data = json.loads(content)
                            if "result" in data:
                                content = data["result"]
                    except:
                        pass
                    raw_messages.append({"role": "user", "content": f"[Observation]: {content}"})
                else:
                    raw_messages.append({"role": msg["role"], "content": msg["content"]})
            
            if not raw_messages or raw_messages[-1]["content"] != message:
                raw_messages.append({"role": "user", "content": message})

            # Ensure strict alternation for llama.cpp (required by Gemma-3 and others)
            messages: list[dict[str, Any]] = []
            for msg in raw_messages:
                if not messages:
                    messages.append(msg)
                    continue
                
                if messages[-1]["role"] == msg["role"]:
                    # Merge consecutive messages of same role
                    messages[-1]["content"] += "\n\n" + msg["content"]
                else:
                    messages.append(msg)

            if getattr(self, "streaming_enabled", True) and overflow_retry_count == 0:
                # We only try streaming on the first pass. If we overflowed, we fall back to blocking for stability (or we could just stream again)
                try:
                    # Note: Streaming method doesn't currently handle overflow retries. 
                    # If it fails with 400, it returns an error string.
                    # Ideally we should refactor stream to also handle it, but for now let's use the blocking call for retries if streaming fails with context error.
                    result = self.stream_llamacpp(messages)
                    if not result.startswith("[Error from llama.cpp (400)"):
                        return result
                    # If it WAS a 400 error, fall through to blocking retry logic
                except Exception as e:
                    self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")

            last_error = ""
            attempt = 0
            for attempt in range(3):
                try:
                    est_tokens = self.estimate_tokens(system_prompt, messages)
                    
                    loading_msg = "Waiting for llama.cpp response..."
                    if attempt > 0:
                        loading_msg = f"Retrying llama.cpp (attempt {attempt+1}/3)..."
                    if overflow_retry_count > 0:
                        loading_msg = f"Retrying with pruned context ({overflow_retry_count})..."

                    with show_loading(loading_msg, token_count=est_tokens):
                        response = requests.post(
                            f"{LLAMA_SERVER_URL}/v1/chat/completions",
                            json={
                                "model": self.current_model,
                                "messages": messages,
                                "max_tokens": 2048,
                                "temperature": 0.7,
                            },
                            timeout=120
                        )
                        
                        if response.status_code == 400:
                            # Check for context overflow
                            try:
                                err_json = response.json()
                                if "error" in err_json:
                                    err_type = err_json["error"].get("type", "")
                                    err_msg = err_json["error"].get("message", "")
                                    
                                    if "exceed_context_size_error" in err_type or "exceeds the available context size" in err_msg:
                                        if overflow_retry_count < max_overflow_retries:
                                            # Calculate overflow amount
                                            n_prompt = err_json["error"].get("n_prompt_tokens", 0)
                                            n_ctx = err_json["error"].get("n_ctx", 0)
                                            
                                            self.console.print(f"[yellow]Context limit exceeded (Prompt: {n_prompt}, Limit: {n_ctx}). Pruning history and retrying...[/yellow]")
                                            
                                            if n_prompt > 0 and n_ctx > 0:
                                                overflow = n_prompt - n_ctx
                                                # Prune overflow + 20% buffer
                                                to_prune = overflow + int(n_ctx * 0.2)
                                            else:
                                                # Fallback if numbers aren't provided
                                                to_prune = 4000
                                                
                                            self.force_prune_context(to_prune)
                                            overflow_retry_count += 1
                                            break # Break inner loop to rebuild messages in outer loop
                                        else:
                                            return f"[Error: Context limit exceeded even after pruning. Try starting a new session with /clear.]"
                            except Exception:
                                pass
                                
                        if response.status_code != 200:
                            last_error = f"{response.status_code}: {response.text}"
                            continue

                        data = response.json()
                        msg_data = data.get("choices", [{}])[0].get("message", {})
                        content = msg_data.get("content", "")
                        reasoning = msg_data.get("reasoning_content", "")

                        if reasoning and self.verbose_mode:
                            self.console.print(render_thinking_block(reasoning))
                        
                        if reasoning and not content.startswith("<think>"):
                            content = f"<think>\n{reasoning}\n</think>\n{content}"
                        
                        usage = data.get("usage", {})
                        if self.verbose_mode and usage:
                            output_tokens = usage.get("completion_tokens", 0)
                            if output_tokens > 0:
                                token_str = f"{output_tokens/1000:.1f}k" if output_tokens >= 1000 else str(output_tokens)
                                self.console.print(f"[dim]↓ {token_str} tokens[/dim]", style=TOOL_COLOR)

                        return content

                except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                    last_error = str(e)
                    time.sleep(attempt + 1)
                    continue
                except Exception as e:
                    return f"[Error calling llama.cpp: {e}]"
            
            # If we exited the inner loop without 'break' (for retry) and without returning, it implies failure
            if overflow_retry_count > 0 and attempt == 2:
                 return f"[Error calling llama.cpp after pruning and retrying. Last error: {last_error}]"
            elif attempt == 2:
                 return f"[Error calling llama.cpp after 3 attempts. Last error: {last_error}]"
            
            # If we hit the break, we continue to outer loop
            pass

    def extract_thinking_points(self: YipsAgentProtocol, thinking_text: str, is_streaming: bool = False) -> list[str]:
        """Extract summary points from thinking text (mirrors render_thinking_block logic)."""
        text = thinking_text.strip()
        if text.startswith("<think>"):
            text = text[7:].strip()
        if text.endswith("</think>"):
            text = text[:-8].strip()
        if not text:
            return []

        noise_prefixes = [
            r"^i (will|need to|should|can|am going to|think|believe|want to|'m going to|'m thinking about)\b",
            r"^let's (try to|check|see|look)\b",
            r"^i'll\b",
            r"^now\b",
            r"^first(ly)?,\b",
            r"^second(ly)?,\b",
            r"^third(ly)?,\b",
            r"^then,\b",
            r"^next,\b",
            r"^finally,\b",
            r"^okay,\b",
            r"^so,\b",
            r"^actually,\b",
            r"^it seems (that|like)?\b",
            r"^i should (probably)?\b",
        ]

        raw_parts = re.split(r'(?:(?<=[.!?])\s+)|(?:\n+)', text)
        points: list[str] = []

        last_char = text[-1] if text else ""
        is_text_finished = last_char in ('.', '!', '?', '\n')

        for i, part in enumerate(raw_parts):
            part = part.strip()
            if not part:
                continue

            is_last = (i == len(raw_parts) - 1)
            if is_streaming and is_last and not is_text_finished:
                continue

            part = re.sub(r'^[-*•\d\.\s]+', '', part).strip()
            for pattern in noise_prefixes:
                part = re.sub(pattern, '', part, flags=re.IGNORECASE).strip()

            if part:
                part = part[0].upper() + part[1:]
                part = part.rstrip(':').strip()
                if len(part) >= 3 and part not in points:
                    points.append(part)

        return points

    def stream_llamacpp(self: YipsAgentProtocol, messages: list[dict[str, Any]]) -> str:
        """Stream response from llama-server API with real-time display."""
        try:
            prefix = get_yips_prefix()
            indent = " " * len(prefix)
            all_content = "".join([str(m["content"]) for m in messages])
            est_tokens = len(all_content) // 4
            spinner = PulsingSpinner("Thinking...", token_count=est_tokens)

            accumulated_text = ""
            in_thinking_block = False
            self.thinking_lines_shown = 0
            with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
                response = requests.post(
                    f"{LLAMA_SERVER_URL}/v1/chat/completions",
                    json={
                        "model": self.current_model,
                        "messages": messages,
                        "max_tokens": 2048,
                        "stream": True,
                    },
                    timeout=120,
                    stream=True
                )

                if response.status_code != 200:
                    return f"[Error from llama.cpp ({response.status_code}): {response.text}]"

                for line in response.iter_lines():
                    if not line: continue
                    line_str = line.decode('utf-8').strip()
                    if not line_str.startswith('data:'): continue
                    data_str = line_str[5:].strip()
                    if data_str == '[DONE]': break
                    try:
                        data = json.loads(data_str)
                        delta = data.get("choices", [{}])[0].get("delta", {})
                        if "reasoning_content" in delta:
                            reasoning = delta["reasoning_content"]
                            if reasoning:
                                if not in_thinking_block:
                                    accumulated_text += "<think>\n"
                                    in_thinking_block = True
                                    spinner.update_status("reasoning")
                                accumulated_text += reasoning
                        if "content" in delta:
                            text = delta["content"]
                            if text:
                                if in_thinking_block:
                                    accumulated_text += "\n</think>\n"
                                    start_idx = accumulated_text.rfind("<think>")
                                    end_idx = accumulated_text.rfind("</think>") + 8
                                    in_thinking_block = False
                                    spinner.update_status("generating")
                                    if start_idx != -1 and end_idx != -1:
                                        # Clear thinking from live display before printing final
                                        thinking_part = accumulated_text[start_idx:end_idx]
                                        display_accumulated = clean_response(accumulated_text)
                                        if display_accumulated:
                                            display_text = Text()
                                            display_text.append_text(prefix)
                                            lines = display_accumulated.split('\n')
                                            for i, text_line in enumerate(lines):
                                                if i > 0: display_text.append("\n" + indent)
                                                display_text.append(apply_gradient_to_text(text_line))
                                            live.update(Group(display_text, spinner))
                                        else:
                                            live.update(spinner)
                                        
                                        live.refresh()
                                        self.console.print(render_thinking_block(thinking_part))
                                        time.sleep(0.3)
                                        self.thinking_lines_shown = 0
                                accumulated_text += text
                        if accumulated_text:
                            renderables: list[Any] = []
                            if in_thinking_block:
                                start_idx = accumulated_text.rfind("<think>")
                                if start_idx != -1:
                                    thinking_part = accumulated_text[start_idx:]

                                    # Show only the latest single line during streaming
                                    current_points = self.extract_thinking_points(thinking_part, is_streaming=True)
                                    new_line_count = len(current_points) - self.thinking_lines_shown

                                    if new_line_count > 0 and self.thinking_lines_shown > 0:
                                        # Pause on the previous line before switching
                                        pause = calculate_reading_pause(current_points[self.thinking_lines_shown - 1])
                                        time.sleep(pause)
                                        self.thinking_lines_shown = len(current_points)

                                    elif new_line_count > 0:
                                        self.thinking_lines_shown = len(current_points)

                                    # Display only the most recent line
                                    latest_idx = max(1, len(current_points))
                                    renderables.append(render_thinking_block(
                                        thinking_part,
                                        is_streaming=True,
                                        visible_lines=latest_idx,
                                        show_only_last=True
                                    ))
                            display_accumulated = clean_response(accumulated_text)
                            if display_accumulated:
                                display_text = Text()
                                display_text.append_text(prefix)
                                lines = display_accumulated.split('\n')
                                for i, text_line in enumerate(lines):
                                    if i > 0: display_text.append("\n" + indent)
                                    display_text.append(apply_gradient_to_text(text_line))
                                renderables.append(display_text)
                            if not renderables: live.update(spinner)
                            else: live.update(Group(*renderables, spinner))
                        usage = data.get("usage")
                        if usage:
                            spinner.update_tokens(
                                input_tokens=usage.get("prompt_tokens"),
                                output_tokens=usage.get("completion_tokens")
                            )
                    except Exception: continue
            if in_thinking_block:
                accumulated_text += "\n</think>"
                start_idx = accumulated_text.rfind("<think>")
                end_idx = accumulated_text.rfind("</think>") + 8
                in_thinking_block = False
                if start_idx != -1 and end_idx != -1:
                    thinking_part = accumulated_text[start_idx:end_idx]
                    self.console.print(render_thinking_block(thinking_part))
                    time.sleep(0.3)
                    self.thinking_lines_shown = 0
            cleaned_text = clean_response(accumulated_text)
            if cleaned_text:
                final_text = Text()
                final_text.append_text(prefix)
                lines = cleaned_text.strip().split('\n')
                for i, line in enumerate(lines):
                    if i > 0: final_text.append("\n" + indent)
                    final_text.append(gradient_text(line))
                self.console.print(final_text)
            return accumulated_text
        except Exception as e:
            return f"[Error streaming from llama.cpp: {e}]"

    def call_claude_cli(self: YipsAgentProtocol, message: str) -> str:
        """Fallback: Call Claude Code CLI."""
        system_prompt = self.load_context()
        
        history_parts: list[str] = []
        
        # Inject Running Summary
        if hasattr(self, 'running_summary') and self.running_summary:
            history_parts.append(f"System: PREVIOUS CONVERSATION SUMMARY:\n{self.running_summary}")

        for msg in self.conversation_history:
            content = msg["content"]
            if msg["role"] == "user": role = "User"
            elif msg["role"] == "assistant": role = "Assistant"
            else:
                role = "System Observation"
                try:
                    if content.startswith('{') and content.endswith('}'):
                        data = json.loads(content)
                        if "result" in data: content = data["result"]
                except: pass
            history_parts.append(f"{role}: {content}")
        if not self.conversation_history or self.conversation_history[-1]["content"] != message:
            history_parts.append(f"User: {message}")
        history_text = "\n\n".join(history_parts)
        full_prompt = f"{system_prompt}\n\n# CONVERSATION HISTORY\n\n{history_text}"
        if getattr(self, "streaming_enabled", True):
            try: return self.stream_claude_cli(full_prompt)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")
        try:
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", str(self.current_model)]
            if self.verbose_mode: cmd.append("--verbose")
            est_tokens = self.estimate_tokens("", full_prompt)
            with show_loading("Waiting for Claude response...", token_count=est_tokens):
                result = subprocess.run(cmd, input=full_prompt, capture_output=True, text=True, timeout=120)
            if self.verbose_mode and result.stderr: self.display_claude_tool_calls(result.stderr)
            if result.returncode == 0: return result.stdout.strip()
            return f"[Error from Claude CLI: {result.stderr}]"
        except subprocess.TimeoutExpired: return "[Error: Claude CLI timed out after 120 seconds]"
        except Exception as e: return f"[Error calling Claude CLI: {e}]"

    def stream_claude_cli(self: YipsAgentProtocol, full_prompt: str) -> str:
        """Stream response from Claude CLI with real-time display."""
        try:
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", str(self.current_model)]
            if self.verbose_mode: cmd.append("--verbose")
            accumulated_text = ""
            prefix = get_yips_prefix()
            indent = " " * len(prefix)
            spinner = PulsingSpinner("Thinking...", token_count=0, model_status="generating")
            if getattr(self, 'is_gui', False):
                process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
                assert process.stdin is not None
                process.stdin.write(full_prompt)
                process.stdin.close()
                assert process.stdout is not None
                assert process.stderr is not None
                while True:
                    char = process.stdout.read(1)
                    if not char and process.poll() is not None: break
                    if not char: time.sleep(0.01); continue
                    accumulated_text += char
                    self.emit_gui_event("text_chunk", char)
            else:
                with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
                    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
                    assert process.stdin is not None
                    process.stdin.write(full_prompt)
                    process.stdin.close()
                    assert process.stdout is not None
                    assert process.stderr is not None
                    while True:
                        char = process.stdout.read(1)
                        if not char and process.poll() is not None: break
                        if not char: time.sleep(0.01); continue
                        accumulated_text += char
                        display_accumulated = clean_response(accumulated_text)
                        display_text = Text()
                        display_text.append_text(prefix)
                        lines = display_accumulated.split('\n')
                        for i, text_line in enumerate(lines):
                            if i > 0: display_text.append("\n" + indent)
                            display_text.append(apply_gradient_to_text(text_line))
                        live.update(Group(display_text, spinner))
            cleaned_text = clean_response(accumulated_text)
            if cleaned_text:
                final_text = Text()
                final_text.append_text(prefix)
                lines = cleaned_text.strip().split('\n')
                for i, line in enumerate(lines):
                    if i > 0: final_text.append("\n" + indent)
                    final_text.append(gradient_text(line))
                self.console.print(final_text)
            stderr_output = process.stderr.read()
            process.wait()
            if self.verbose_mode and stderr_output: self.display_claude_tool_calls(stderr_output)
            if process.returncode == 0: return accumulated_text.strip()
            return f"[Error from Claude CLI: {stderr_output}]"
        except Exception as e: return f"[Error streaming from Claude CLI: {e}]"

    def display_claude_tool_calls(self: YipsAgentProtocol, stderr_output: str) -> None:
        """Parse and display Claude Code tool calls from stderr."""
        lines = stderr_output.split('\n')
        for raw_line in lines:
            stripped_line = raw_line.strip()
            if not stripped_line: continue
            if any(k in stripped_line for k in ['Tool:', 'tool:', 'Reading', 'Writing', 'Running']):
                panel = render_tool_call("Claude Tool", stripped_line)
                self.console.print(panel)