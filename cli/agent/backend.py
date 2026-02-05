"""
Backend communication logic for YipsAgent.
"""

import json
import subprocess
import sys
import time
import requests
from rich.text import Text
from rich.live import Live
from rich.console import Group

from cli.color_utils import (
    console,
    gradient_text,
    blue_gradient_text,
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
    LLAMA_DEFAULT_MODEL,
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
)
from cli.tool_execution import clean_response


class AgentBackendMixin:
    """Mixin providing backend communication capabilities to YipsAgent."""

    def initialize_backend(self) -> None:
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

    def get_response(self, message: str) -> str:
        """Get response using available backend (llamacpp or Claude CLI)."""
        if not getattr(self, 'backend_initialized', False):
            return "[Error: Backend not initialized]"

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

    def call_llamacpp(self, message: str) -> str:
        """Call llama-server API using OpenAI-compatible endpoint with retries."""
        system_prompt = self.load_context()

        raw_messages = [{"role": "system", "content": system_prompt}]
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
        messages = []
        for msg in raw_messages:
            if not messages:
                messages.append(msg)
                continue
            
            if messages[-1]["role"] == msg["role"]:
                # Merge consecutive messages of same role
                messages[-1]["content"] += "\n\n" + msg["content"]
            else:
                messages.append(msg)

        if self.streaming_enabled:
            try:
                return self._stream_llamacpp(messages)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")

        last_error = ""
        for attempt in range(3):
            try:
                est_tokens = self._estimate_tokens(system_prompt, messages)
                
                loading_msg = "Waiting for llama.cpp response..."
                if attempt > 0:
                    loading_msg = f"Retrying llama.cpp (attempt {attempt+1}/3)..."

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
        
        return f"[Error calling llama.cpp after 3 attempts. Last error: {last_error}]"

    def _stream_llamacpp(self, messages: list[dict]) -> str:
        """Stream response from llama-server API with real-time display."""
        try:
            prefix = get_yips_prefix()
            indent = " " * len(prefix)
            all_content = "".join([m["content"] for m in messages])
            est_tokens = len(all_content) // 4
            spinner = PulsingSpinner("Thinking...", token_count=est_tokens)

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

            accumulated_text = ""
            in_thinking_block = False
            
            with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
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
                                            live.update(display_text)
                                        else:
                                            live.update(spinner)
                                            
                                        self.console.print(render_thinking_block(thinking_part))
                                        time.sleep(1.5)
                                accumulated_text += text
                        if accumulated_text:
                            renderables = []
                            if in_thinking_block:
                                start_idx = accumulated_text.rfind("<think>")
                                if start_idx != -1:
                                    thinking_part = accumulated_text[start_idx:]
                                    renderables.append(render_thinking_block(thinking_part, is_streaming=True))
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
                            elif len(renderables) == 1: live.update(renderables[0])
                            else: live.update(Group(*renderables))
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
                    time.sleep(1.5)
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

    def call_claude_cli(self, message: str) -> str:
        """Fallback: Call Claude Code CLI."""
        system_prompt = self.load_context()
        history_parts = []
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
        if self.streaming_enabled:
            try: return self._stream_claude_cli(full_prompt)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")
        try:
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", self.current_model]
            if self.verbose_mode: cmd.append("--verbose")
            est_tokens = self._estimate_tokens("", full_prompt)
            with show_loading("Waiting for Claude response...", token_count=est_tokens):
                result = subprocess.run(cmd, input=full_prompt, capture_output=True, text=True, timeout=120)
            if self.verbose_mode and result.stderr: self._display_claude_tool_calls(result.stderr)
            if result.returncode == 0: return result.stdout.strip()
            return f"[Error from Claude CLI: {result.stderr}]"
        except subprocess.TimeoutExpired: return "[Error: Claude CLI timed out after 120 seconds]"
        except Exception as e: return f"[Error calling Claude CLI: {e}]"

    def _stream_claude_cli(self, full_prompt: str) -> str:
        """Stream response from Claude CLI with real-time display."""
        try:
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", self.current_model]
            if self.verbose_mode: cmd.append("--verbose")
            process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            assert process.stdin is not None
            process.stdin.write(full_prompt)
            process.stdin.close()
            accumulated_text = ""
            prefix = get_yips_prefix()
            indent = " " * len(prefix)
            spinner = PulsingSpinner("Thinking...", token_count=0, model_status="generating")
            assert process.stdout is not None
            assert process.stderr is not None
            if getattr(self, 'is_gui', False):
                while True:
                    char = process.stdout.read(1)
                    if not char and process.poll() is not None: break
                    if not char: time.sleep(0.01); continue
                    accumulated_text += char
                    self.emit_gui_event("text_chunk", char)
            else:
                with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
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
                        live.update(display_text)
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
            if self.verbose_mode and stderr_output: self._display_claude_tool_calls(stderr_output)
            if process.returncode == 0: return accumulated_text.strip()
            return f"[Error from Claude CLI: {stderr_output}]"
        except Exception as e: return f"[Error streaming from Claude CLI: {e}]"

    def _display_claude_tool_calls(self, stderr_output: str) -> None:
        """Parse and display Claude Code tool calls from stderr."""
        lines = stderr_output.split('\n')
        for raw_line in lines:
            stripped_line = raw_line.strip()
            if not stripped_line: continue
            if any(k in stripped_line for k in ['Tool:', 'tool:', 'Reading', 'Writing', 'Running']):
                panel = render_tool_call("Claude Tool", stripped_line)
                self.console.print(panel)