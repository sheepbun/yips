"""
YipsAgent - Core agent class for Yips CLI.

Manages conversation, backend communication, and session state.
"""

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from types import FrameType

import requests
from rich.live import Live
from rich.panel import Panel
from rich.text import Text
from rich.tree import Tree
from rich.console import Group

from cli.color_utils import (
    console,
    gradient_text,
    blue_gradient_text,
    apply_gradient_to_text,
    get_yips_prefix,
    print_gradient,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
    TOOL_COLOR,
    interpolate_color,
)
from cli.config import (
    BASE_DIR,
    DOT_YIPS_DIR,
    MEMORIES_DIR,
    COMMANDS_DIR,
    SKILLS_DIR,
    TOOLS_DIR,
    load_config,
    LAYOUT_FULL_MIN_WIDTH,
    LAYOUT_SINGLE_MIN_WIDTH,
    LAYOUT_COMPACT_MIN_WIDTH,
)
from cli.tool_execution import clean_response
from cli.lmstudio import (
    LM_STUDIO_URL,
    LM_STUDIO_MODEL,
    CLAUDE_CLI_PATH,
    CLAUDE_CLI_MODEL,
    is_lmstudio_running,
    ensure_lmstudio_running,
)
from cli.llamacpp import (
    LLAMA_SERVER_URL,
    LLAMA_DEFAULT_MODEL,
    is_llamacpp_running,
    start_llamacpp,
    stop_llamacpp,
)
from cli.info_utils import (
    get_username,
    get_recent_activity,
    get_friendly_backend_name,
    get_friendly_model_name,
    get_display_directory,
)
from cli.ui_rendering import (
    PulsingSpinner,
    generate_yips_logo,
    safe_center,
    show_loading,
    render_top_border,
    render_bottom_border,
    render_tool_call,
    render_thinking_block,
    LOGO_WIDTH,
)
from cli.type_defs import Message, YipsConfig, StreamingToolCall, SessionState


class YipsAgent:
    """Main agent class managing conversation and autonomous tool execution."""

    def __init__(self, prompt_session=None) -> None:
        self.conversation_history: list[Message] = []
        self.console = console
        self.backend_initialized = False
        
        # Initialize loop state
        self.session_state: SessionState = {
            "thought_signature": "",
            "error_count": 0,
            "last_action": ""
        }

        # Load saved configuration
        config: YipsConfig = load_config()
        saved_model = config.get("model")
        saved_backend = config.get("backend")
        self.verbose_mode = config.get("verbose", True)  # Show tool calls by default
        self.streaming_enabled = config.get("streaming", True)  # Enable streaming by default

        # Terminal resize handling
        self.last_width: int | None = None
        self.resize_pending: bool = False
        self._resize_timer: threading.Timer | None = None

        # Session file tracking for live memory creation
        self.session_file_path: Path | None = None
        self._session_created = False
        self.current_session_name: str | None = None

        # Interactive session selection state
        self.session_selection_active = False
        self.session_selection_idx = 0
        self.session_list: list[dict] = []

        # Prompt toolkit session for triggering redraws
        self.prompt_session = prompt_session

        # Register SIGWINCH handler (Unix only)
        if hasattr(signal, 'SIGWINCH'):
            signal.signal(signal.SIGWINCH, self._handle_resize)

        # Determine backend and model from saved config or defaults
        # Do NOT start backends here - that happens in initialize_backend() after title box display
        self.backend = saved_backend or "llamacpp"
        self.current_model = saved_model

        if self.backend == "claude":
            self.use_claude_cli = True
            if not self.current_model:
                self.current_model = CLAUDE_CLI_MODEL
        elif self.backend == "lmstudio":
            self.use_claude_cli = False
            if not self.current_model:
                self.current_model = LM_STUDIO_MODEL
        else: # Default or explicitly llamacpp
            self.backend = "llamacpp"
            self.use_claude_cli = False
            if not self.current_model:
                self.current_model = LLAMA_DEFAULT_MODEL

    @property
    def is_gui(self) -> bool:
        return os.environ.get("YIPS_GUI_MODE") == "1"

    def emit_gui_event(self, event_type: str, data: Any) -> None:
        """Emit a structured JSON event for the Electron frontend."""
        if self.is_gui:
            event = {
                "type": event_type,
                "data": data,
                "timestamp": time.time()
            }
            # Use a unique prefix to make it easy for the frontend to identify JSON lines
            print(f"__YIPS_JSON__{json.dumps(event)}")
            sys.stdout.flush()

    def initialize_backend(self) -> None:
        """Initialize backend after UI is displayed."""
        if self.backend_initialized:
            return

        # If using Claude CLI, nothing to initialize
        if self.use_claude_cli:
            self.backend_initialized = True
            return

        # llama.cpp backend
        if self.backend == "llamacpp":
            if not is_llamacpp_running():
                if not start_llamacpp(self.current_model):
                    self.console.print(f"[yellow]{get_friendly_backend_name('llamacpp')} unavailable, trying {get_friendly_backend_name('lmstudio')}...[/yellow]")
                    self.backend = "lmstudio"
                    if not self.current_model or "GGUF" not in self.current_model:
                        self.current_model = LM_STUDIO_MODEL
            else:
                self.backend_initialized = True
                return

        # LM Studio backend
        if self.backend == "lmstudio":
            if not is_lmstudio_running():
                if not ensure_lmstudio_running():
                    self.console.print(f"[yellow]{get_friendly_backend_name('lmstudio')} unavailable, using {get_friendly_backend_name('claude')}.[/yellow]")
                    self.use_claude_cli = True
                    self.current_model = CLAUDE_CLI_MODEL

        self.backend_initialized = True

    def load_context(self) -> str:
        """Load all context documents into a system prompt."""
        sections: list[str] = []

        # Soul document
        agent_md = BASE_DIR / "AGENT.md"
        if agent_md.exists():
            sections.append(f"# SOUL DOCUMENT\n\n{agent_md.read_text()}")

        # Identity
        identity_md = BASE_DIR / "IDENTITY.md"
        if identity_md.exists():
            sections.append(f"# IDENTITY\n\n{identity_md.read_text()}")

        # Human info
        human_md = BASE_DIR / "author" / "HUMAN.md"
        if human_md.exists():
            sections.append(f"# ABOUT KATHERINE\n\n{human_md.read_text()}")

        # Specifications
        specs_md = BASE_DIR / "system" / "SPECIFICATIONS.md"
        if specs_md.exists():
            sections.append(f"# SPECIFICATIONS\n\n{specs_md.read_text()}")

        # Focus Area
        focus_md = DOT_YIPS_DIR / "FOCUS.md"
        if focus_md.exists():
            sections.append(f"# CURRENT FOCUS AREA\n\n{focus_md.read_text()}")

        # User Preferences
        pref_json = DOT_YIPS_DIR / "preferences.json"
        if pref_json.exists():
            try:
                prefs = json.loads(pref_json.read_text())
                sections.append(f"# USER PREFERENCES\n\n{json.dumps(prefs, indent=2)}")
            except Exception:
                pass

        # Recent Git Activity (Last 5 commits)
        try:
            git_log = subprocess.run(
                ["git", "log", "-n", "5", "--oneline"],
                capture_output=True,
                text=True,
                cwd=BASE_DIR
            )
            if git_log.returncode == 0 and git_log.stdout:
                sections.append(f"# RECENT GIT COMMITS\n\n{git_log.stdout}")
        except Exception:
            pass

        # Recent memories (last 5)
        if MEMORIES_DIR.exists():
            memories = sorted(MEMORIES_DIR.glob("*.md"), reverse=True)[:5]
            if memories:
                mem_content: list[str] = []
                for mem in memories:
                    mem_content.append(f"## {mem.stem}\n{mem.read_text()}")
                sections.append(f"# RECENT MEMORIES\n\n" + "\n\n".join(mem_content))

        # Available commands
        available_cmds = []
        if TOOLS_DIR.exists():
            available_cmds.extend([d.name.lower() for d in TOOLS_DIR.iterdir() if d.is_dir()])
        if SKILLS_DIR.exists():
            available_cmds.extend([d.name.lower() for d in SKILLS_DIR.iterdir() if d.is_dir()])
            
        if available_cmds:
            cmd_names = [f"/{c}" for c in sorted(list(set(available_cmds)))]
            sections.append(
                f"# USER COMMANDS\n\nKatherine can use these slash commands in the terminal: {', '.join(cmd_names)}\n\n"
                "IMPORTANT: As an agent, you MUST NOT use slash commands. To use a tool or skill yourself, "
                "you MUST use the {INVOKE_SKILL:SKILL_NAME:args} or {ACTION:TOOL_NAME:params} syntax as defined in your soul document."
            )

        # Thought Signature / Current Task State
        if self.session_state.get("thought_signature"):
            sections.append(f"# CURRENT TASK PLAN (Thought Signature)\n\n{self.session_state['thought_signature']}")

        return "\n\n" + "=" * 60 + "\n\n".join(sections)

    def _estimate_tokens(self, system_prompt: str, messages: list[dict] | str) -> int:
        """Estimate token count for prompt."""
        if isinstance(messages, str):
            text = system_prompt + messages
        else:
            text = system_prompt
            for msg in messages:
                text += str(msg.get("content", ""))
        
        # Rough estimate: 1 token ~= 4 chars
        return len(text) // 4

    def call_lm_studio(self, message: str) -> str:
        """Call LM Studio API using Anthropic-compatible endpoint."""
        system_prompt = self.load_context()

        # Build messages (Anthropic format: role must be 'user' or 'assistant')
        messages: list[Message] = []
        for msg in self.conversation_history:
            role = msg["role"]
            content = msg["content"]
            
            if role == "user":
                messages.append({"role": "user", "content": content})
            elif role == "assistant":
                messages.append({"role": "assistant", "content": content})
            elif role == "system":
                # Map system observations to user role so the model sees them
                messages.append({"role": "user", "content": f"[Observation]: {content}"})

        # Only append 'message' if it's not already the last message in history
        # (prevents duplication in run loop while supporting one-off prompts)
        if not messages or (messages[-1]["role"] == "user" and messages[-1]["content"] != message) or messages[-1]["role"] != "user":
             # If the last message was a system observation (mapped to user), 
             # and the next message is the internal reprompt, we might have consecutive user messages.
             # Anthropic API usually requires alternating roles, but some backends are flexible.
             # However, 'process_response_and_tools' in main.py always sends a user reprompt.
             pass

        # Re-sync with what main.py does: it appends user_input to history before calling get_response.
        # But call_lm_studio is sometimes called directly.
        # Let's simplify: the 'messages' list should exactly reflect 'conversation_history'
        # but with 'system' roles converted to 'user'.
        
        # Actually, let's just use a clean mapping loop.
        messages = []
        for msg in self.conversation_history:
            if msg["role"] == "system":
                content = msg["content"]
                # Unwrap structured JSON if present
                try:
                    if content.startswith('{') and content.endswith('}'):
                        data = json.loads(content)
                        if "result" in data:
                            content = data["result"]
                except:
                    pass
                messages.append({"role": "user", "content": f"[Observation]: {content}"})
            else:
                messages.append({"role": msg["role"], "content": msg["content"]})
        
        # Ensure the current 'message' is at the end if not already there
        if not messages or messages[-1]["content"] != message:
            messages.append({"role": "user", "content": message})

        headers = {
            "Content-Type": "application/json",
        }

        # If streaming is enabled, use streaming mode
        if self.streaming_enabled:
            try:
                return self._stream_lm_studio(system_prompt, messages)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")
                # Fall through to non-streaming mode

        try:
            # Calculate tokens for loading spinner
            est_tokens = self._estimate_tokens(system_prompt, messages)

            # Show loading spinner
            with show_loading("Waiting for LM Studio response...", token_count=est_tokens):
                response = requests.post(
                    f"{LM_STUDIO_URL}/v1/messages",
                    headers=headers,
                    json={
                        "model": self.current_model,
                        "system": system_prompt,
                        "messages": messages,
                        "max_tokens": 2048,
                    },
                    timeout=120
                )
                
                if response.status_code != 200:
                    try:
                        err_data = response.json()
                        err_msg = err_data.get("error", {}).get("message", response.text)
                        return f"[Error from LM Studio ({response.status_code}): {err_msg}]"
                    except:
                        return f"[Error from LM Studio: {response.status_code} - {response.text}]"

                data = response.json()

            # Anthropic format: {"content": [{"type": "text", "text": "..."}, {"type": "tool_use", ...}]}
            content_blocks = data.get("content", [])
            text_parts: list[str] = []

            # Extract usage data
            usage = data.get("usage", {})
            if self.verbose_mode and usage:
                output_tokens = usage.get("output_tokens", 0)
                if output_tokens > 0:
                    # Format tokens (e.g., 1.2k)
                    if output_tokens >= 1000:
                        token_str = f"{output_tokens/1000:.1f}k"
                    else:
                        token_str = str(output_tokens)
                    self.console.print(
                        f"[dim]↓ {token_str} tokens[/dim]",
                        style=TOOL_COLOR
                    )

            # Process all content blocks
            for block in content_blocks:
                block_type = block.get("type", "")

                if block_type == "text":
                    text_parts.append(block.get("text", ""))
                elif block_type == "thinking":
                    thinking_content = block.get("thinking", "")
                    if thinking_content:
                        if self.verbose_mode:
                            self.console.print(render_thinking_block(thinking_content))
                        # For models that use thinking blocks instead of text tags,
                        # we want to keep the thinking for context/parsing.
                        text_parts.append(f"<think>\n{thinking_content}\n</think>")
                elif block_type == "tool_use" and self.verbose_mode:
                    # Display tool use if verbose mode is enabled
                    tool_name = block.get("name", "unknown")
                    tool_input = block.get("input", {})
                    self._display_lm_studio_tool_call(tool_name, tool_input)

            # Return combined text
            combined_text = "\n".join(text_parts) if text_parts else ""
            if combined_text:
                return combined_text
            elif content_blocks and content_blocks[0].get("text"):
                return content_blocks[0]["text"]
            else:
                return "[No text response from model]"

        except requests.exceptions.ConnectionError:
            return "[Error: Could not connect to LM Studio. Is it running?]"
        except requests.exceptions.Timeout:
            return "[Error: Request timed out after 120 seconds]"
        except Exception as e:
            return f"[Error calling LM Studio: {e}]"

    def call_llamacpp(self, message: str) -> str:
        """Call llama-server API using OpenAI-compatible endpoint."""
        system_prompt = self.load_context()

        # Build messages (OpenAI format)
        messages = [{"role": "system", "content": system_prompt}]
        for msg in self.conversation_history:
            if msg["role"] == "system":
                content = msg["content"]
                # Unwrap structured JSON if present
                try:
                    if content.startswith('{') and content.endswith('}'):
                        data = json.loads(content)
                        if "result" in data:
                            content = data["result"]
                except:
                    pass
                messages.append({"role": "user", "content": f"[Observation]: {content}"})
            else:
                messages.append({"role": msg["role"], "content": msg["content"]})
        
        if not messages or messages[-1]["content"] != message:
            messages.append({"role": "user", "content": message})

        if self.streaming_enabled:
            try:
                return self._stream_llamacpp(messages)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")

        try:
            est_tokens = self._estimate_tokens(system_prompt, messages)
            with show_loading("Waiting for llama.cpp response...", token_count=est_tokens):
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
                    return f"[Error from llama.cpp ({response.status_code}): {response.text}]"

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

        except Exception as e:
            return f"[Error calling llama.cpp: {e}]"

    def _stream_llamacpp(self, messages: list[dict]) -> str:
        """Stream response from llama-server API with real-time display."""
        try:
            prefix = get_yips_prefix()
            indent = " " * len(prefix)
            
            # Estimate tokens from all messages
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
                    if not line:
                        continue

                    line_str = line.decode('utf-8').strip()
                    if not line_str.startswith('data:'):
                        continue

                    data_str = line_str[5:].strip()
                    if data_str == '[DONE]':
                        break

                    try:
                        data = json.loads(data_str)
                        delta = data.get("choices", [{}])[0].get("delta", {})
                        
                        # Handle reasoning_content (OpenAI extension for thinking models)
                        if "reasoning_content" in delta:
                            reasoning = delta["reasoning_content"]
                            if reasoning: # Ensure it's not None
                                if not in_thinking_block:
                                    accumulated_text += "<think>\n"
                                    in_thinking_block = True
                                    spinner.update_status("reasoning")
                                accumulated_text += reasoning
                        
                        if "content" in delta:
                            text = delta["content"]
                            if text: # Ensure it's not None
                                if in_thinking_block:
                                    # When transitioning from thinking to content, close the tag and render the block
                                    accumulated_text += "\n</think>\n"
                                    
                                    # Find the last thinking block and render it
                                    start_idx = accumulated_text.rfind("<think>")
                                    end_idx = accumulated_text.rfind("</think>") + 8
                                    if start_idx != -1 and end_idx != -1:
                                        thinking_part = accumulated_text[start_idx:end_idx]
                                        self.console.print(render_thinking_block(thinking_part))
                                        
                                    in_thinking_block = False
                                    spinner.update_status("generating")
                                accumulated_text += text                            
                        # Update display
                        if accumulated_text:
                            renderables = []
                            
                            # If we're currently thinking, show the streaming thinking block
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
                            
                            if not renderables:
                                live.update(spinner)
                            elif len(renderables) == 1:
                                live.update(renderables[0])
                            else:
                                live.update(Group(*renderables))
                            
                        # Handle token usage if provided in stream
                        usage = data.get("usage")
                        if usage:
                            spinner.update_tokens(
                                input_tokens=usage.get("prompt_tokens"),
                                output_tokens=usage.get("completion_tokens")
                            )
                    except json.JSONDecodeError:
                        continue

            if in_thinking_block:
                accumulated_text += "\n</think>"
                # Find the last thinking block and render it
                start_idx = accumulated_text.rfind("<think>")
                end_idx = accumulated_text.rfind("</think>") + 8
                if start_idx != -1 and end_idx != -1:
                    thinking_part = accumulated_text[start_idx:end_idx]
                    self.console.print(render_thinking_block(thinking_part))
            
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
        """Fallback: Call Claude Code CLI (Priority 1)."""
        system_prompt = self.load_context()

        # Build history string from conversation_history
        history_parts: list[str] = []
        for msg in self.conversation_history:
            content = msg["content"]
            if msg["role"] == "user":
                role = "User"
            elif msg["role"] == "assistant":
                role = "Assistant"
            else:
                role = "System Observation"
                # Unwrap structured JSON if present
                try:
                    if content.startswith('{') and content.endswith('}'):
                        data = json.loads(content)
                        if "result" in data:
                            content = data["result"]
                except:
                    pass
            history_parts.append(f"{role}: {content}")

        # Add the current message if it's not the last one in history
        if not self.conversation_history or self.conversation_history[-1]["content"] != message:
            history_parts.append(f"User: {message}")

        history_text = "\n\n".join(history_parts)
        full_prompt = f"{system_prompt}\n\n# CONVERSATION HISTORY\n\n{history_text}"

        # If streaming is enabled, use streaming mode
        if self.streaming_enabled:
            try:
                return self._stream_claude_cli(full_prompt)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")
                # Fall through to non-streaming mode

        try:
            # Build command with optional verbose flag
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", self.current_model]
            if self.verbose_mode:
                cmd.append("--verbose")

            # Calculate tokens for loading spinner
            est_tokens = self._estimate_tokens("", full_prompt)

            # Show loading spinner
            with show_loading("Waiting for Claude response...", token_count=est_tokens):
                result = subprocess.run(
                    cmd,
                    input=full_prompt,
                    capture_output=True,
                    text=True,
                    timeout=120
                )

            # Display stderr (contains tool calls and debug info) if verbose mode is on
            if self.verbose_mode and result.stderr:
                self._display_claude_tool_calls(result.stderr)

            if result.returncode == 0:
                return result.stdout.strip()
            return f"[Error from Claude CLI: {result.stderr}]"
        except subprocess.TimeoutExpired:
            return "[Error: Claude CLI timed out after 120 seconds]"
        except Exception as e:
            return f"[Error calling Claude CLI: {e}]"

    def _stream_lm_studio(self, system_prompt: str, messages: list[Message]) -> str:
        """Stream response from LM Studio API with real-time display."""
        headers = {
            "Content-Type": "application/json",
        }

        try:
            # Display with Live for real-time updates
            prefix = get_yips_prefix()
            indent = " " * len(prefix)
            
            # Calculate tokens
            est_tokens = self._estimate_tokens(system_prompt, messages)
            spinner = PulsingSpinner("Thinking...", token_count=est_tokens)

            response = requests.post(
                f"{LM_STUDIO_URL}/v1/messages",
                headers=headers,
                json={
                    "model": self.current_model,
                    "system": system_prompt,
                    "messages": messages,
                    "max_tokens": 2048,
                    "stream": True,
                },
                timeout=120,
                stream=True
            )
            
            if response.status_code != 200:
                try:
                    err_data = response.json()
                    err_msg = err_data.get("error", {}).get("message", response.text)
                    return f"[Error from LM Studio ({response.status_code}): {err_msg}]"
                except:
                    return f"[Error from LM Studio: {response.status_code} - {response.text}]"

            # Accumulate response text
            accumulated_text = ""
            tool_calls: list[StreamingToolCall] = []

            # State tracking for tokens and model status
            current_block_type = None
            in_thinking_block = False
            final_input_tokens = 0
            final_output_tokens = 0

            if self.is_gui:
                for line in response.iter_lines():
                    if not line: continue
                    line_str = line.decode('utf-8').strip()
                    if line_str.startswith('event:'): continue
                    if not line_str.startswith('data:'): continue
                    data_str = line_str[5:].strip()
                    if data_str == '[DONE]': break
                    try:
                        data = json.loads(data_str)
                        event_type = data.get("type", "")
                        if event_type == "content_block_delta":
                            delta = data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                text = delta.get("text", "")
                                accumulated_text += text
                                self.emit_gui_event("text_chunk", text)
                            elif delta.get("type") == "input_json_delta":
                                partial_json = delta.get("partial_json", "")
                                if tool_calls:
                                    tool_calls[-1]["input_json"] += partial_json
                        elif event_type == "content_block_start":
                            block = data.get("content_block", {})
                            if block.get("type") == "tool_use":
                                tool_name = block.get("name", "unknown")
                                tool_calls.append({"name": tool_name, "input_json": ""})
                                self.emit_gui_event("tool_start", {"name": tool_name})
                    except Exception: continue
            else:
                with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
                    for line in response.iter_lines():
                        if not line:
                            continue

                        # Decode SSE format
                        line_str = line.decode('utf-8').strip()

                        # Skip 'event: ...' lines
                        if line_str.startswith('event:'):
                            continue

                        if not line_str.startswith('data:'):
                            continue

                        data_str = line_str[5:].strip()  # Remove 'data:' prefix
                        if data_str == '[DONE]':
                            break

                        try:
                            data = json.loads(data_str)
                            event_type = data.get("type", "")
                        except json.JSONDecodeError:
                            continue

                        # Handle message_start event (contains input tokens)
                        if event_type == "message_start":
                            message_data = data.get("message", {})
                            usage = message_data.get("usage", {})
                            if "input_tokens" in usage:
                                input_tokens = usage.get("input_tokens")
                                spinner.update_tokens(input_tokens=input_tokens)
                                # Trigger input animation (counts up quickly)
                                spinner.start_input_animation(input_tokens)

                        # Handle content_block_start event (detect thinking/text blocks)
                        elif event_type == "content_block_start":
                            block = data.get("content_block", {})
                            current_block_type = block.get("type")

                            if current_block_type == "thinking":
                                in_thinking_block = True
                                spinner.update_status("reasoning")
                            elif current_block_type == "text":
                                in_thinking_block = False
                                spinner.update_status("generating")
                            elif current_block_type == "tool_use":
                                spinner.update_status("using tools")
                                # Still process tool_use as before
                                tool_name = block.get("name", "unknown")
                                tool_calls.append({
                                    "name": tool_name,
                                    "input_json": ""
                                })
                                display_text = Text()
                                display_text.append_text(prefix)
                                if accumulated_text:
                                    lines = accumulated_text.split('\n')
                                    for i, text_line in enumerate(lines):
                                        if i > 0: display_text.append("\n" + indent)
                                        display_text.append(apply_gradient_to_text(text_line))
                                    display_text.append("\n" + indent)
                                display_text.append(blue_gradient_text(f"🔧 Using tool: {tool_name}..."))
                                live.update(display_text)
                            else:
                                # Fallback for unknown block types
                                spinner.update_status("processing")

                        # Handle content_block_delta event (accumulate text and count tokens)
                        elif event_type == "content_block_delta":
                            delta = data.get("delta", {})
                            delta_type = delta.get("type", "")

                            if delta_type == "text_delta":
                                # If we were thinking, close the tag and render the block
                                if in_thinking_block:
                                    accumulated_text += "\n</think>\n"
                                    
                                    # Find the last thinking block and render it
                                    start_idx = accumulated_text.rfind("<think>")
                                    end_idx = accumulated_text.rfind("</think>") + 8
                                    if start_idx != -1 and end_idx != -1:
                                        thinking_part = accumulated_text[start_idx:end_idx]
                                        self.console.print(render_thinking_block(thinking_part))
                                        
                                    in_thinking_block = False
                                    spinner.update_status("generating")
                                text = delta.get("text", "")
                                accumulated_text += text

                                # Estimate output tokens and update animation
                                # This makes it count up smoothly as text streams
                                estimated_output = max(1, len(accumulated_text) // 4)
                                spinner.update_output_animation(estimated_output)

                                # Update display
                                renderables = []
                                display_accumulated = clean_response(accumulated_text)
                                if display_accumulated:
                                    display_text = Text()
                                    display_text.append_text(prefix)
                                    lines = display_accumulated.split('\n')
                                    for i, text_line in enumerate(lines):
                                        if i > 0: display_text.append("\n" + indent)
                                        display_text.append(apply_gradient_to_text(text_line))
                                    renderables.append(display_text)
                                
                                if not renderables:
                                    live.update(spinner)
                                elif len(renderables) == 1:
                                    live.update(renderables[0])
                                else:
                                    live.update(Group(*renderables))

                            elif delta_type == "thinking_delta":
                                # Accumulate thinking
                                thinking = delta.get("thinking", "")
                                
                                # Add tags if this is the start of a thinking block
                                if not in_thinking_block:
                                    accumulated_text += "<think>\n"
                                    in_thinking_block = True
                                
                                accumulated_text += thinking
                                
                                if self.verbose_mode:
                                    # Update display
                                    renderables = []
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
                                    
                                    if not renderables:
                                        live.update(spinner)
                                    elif len(renderables) == 1:
                                        live.update(renderables[0])
                                    else:
                                        live.update(Group(*renderables))

                            elif delta_type == "input_json_delta":
                                # Accumulate JSON for tool call
                                partial_json = delta.get("partial_json", "")
                                if tool_calls:
                                    current_tool = tool_calls[-1]
                                    if "input_json" not in current_tool:
                                        current_tool["input_json"] = ""
                                    current_tool["input_json"] += partial_json

                                # Update display to show tool usage activity
                                display_text = Text()
                                display_text.append_text(prefix)
                                if accumulated_text:
                                    lines = accumulated_text.split('\n')
                                    for i, text_line in enumerate(lines):
                                        if i > 0: display_text.append("\n" + indent)
                                        display_text.append(apply_gradient_to_text(text_line))
                                    display_text.append("\n" + indent)

                                tool_name = tool_calls[-1].get("name", "tool")
                                display_text.append("\n" + indent)
                                display_text.append(blue_gradient_text(f"🔧 Using tool: {tool_name}..."))
                                live.update(display_text)

                        # Handle message_delta event (contains output tokens)
                        elif event_type == "message_delta":
                            # Try multiple paths - Anthropic API has usage at top level,
                            # but LM Studio might nest it differently
                            usage = data.get("usage", {})
                            if not usage:
                                usage = data.get("message", {}).get("usage", {})
                            if not usage:
                                usage = data.get("delta", {}).get("usage", {})
                            if "output_tokens" in usage:
                                # Use actual token count from API
                                output_tokens = usage.get("output_tokens", 0)
                                input_tokens = usage.get("input_tokens", 0)
                                # Save final counts for display after streaming
                                final_output_tokens = output_tokens
                                final_input_tokens = input_tokens
                                spinner.update_tokens(input_tokens=input_tokens, output_tokens=output_tokens)
                                # Update to actual final count
                                spinner.update_output_animation(output_tokens)

                        # Handle message_stop event (LM Studio may send usage here)
                        elif event_type == "message_stop":
                            # Try multiple paths for usage data
                            usage = data.get("usage", {})
                            if not usage:
                                usage = data.get("message", {}).get("usage", {})
                            if "output_tokens" in usage:
                                output_tokens = usage.get("output_tokens", 0)
                                input_tokens = usage.get("input_tokens", input_tokens)
                                final_output_tokens = output_tokens
                                final_input_tokens = input_tokens
                                spinner.update_tokens(input_tokens=input_tokens, output_tokens=output_tokens)
                                # Print final output after Live exits (so it persists)
            if in_thinking_block:
                accumulated_text += "\n</think>"
                # Find the last thinking block and render it
                start_idx = accumulated_text.rfind("<think>")
                end_idx = accumulated_text.rfind("</think>") + 8
                if start_idx != -1 and end_idx != -1:
                    thinking_part = accumulated_text[start_idx:end_idx]
                    self.console.print(render_thinking_block(thinking_part))
                in_thinking_block = False
                
            cleaned_text = clean_response(accumulated_text)
            if cleaned_text:
                final_text = Text()
                final_text.append_text(prefix)
                # Strip trailing newlines to avoid double-spacing with console.print()
                lines = cleaned_text.strip().split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        final_text.append("\n" + indent)
                    final_text.append(gradient_text(line))
                self.console.print(final_text)

            # Display tool calls after streaming completes
            if self.verbose_mode and tool_calls:
                for tool_call in tool_calls:
                    tool_name = tool_call.get("name", "unknown")
                    input_json = tool_call.get("input_json", "{}")
                    tool_input: dict[str, Any]
                    try:
                        tool_input = json.loads(input_json) if input_json else {}
                    except json.JSONDecodeError:
                        tool_input = {"error": "Invalid JSON in tool call", "raw": input_json}
                    self._display_lm_studio_tool_call(tool_name, tool_input)

            return accumulated_text if accumulated_text else "[No text response from model]"

        except requests.exceptions.ConnectionError:
            return "[Error: Could not connect to LM Studio. Is it running?]"
        except requests.exceptions.Timeout:
            return "[Error: Request timed out after 120 seconds]"
        except Exception as e:
            return f"[Error streaming from LM Studio: {e}]"

    def _stream_claude_cli(self, full_prompt: str) -> str:
        """Stream response from Claude CLI with real-time display."""
        try:
            # Build command with optional verbose flag
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", self.current_model]
            if self.verbose_mode:
                cmd.append("--verbose")

            # Use Popen for streaming
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1  # Line buffered
            )

            # Send input (stdin is guaranteed to be non-None when stdin=PIPE)
            assert process.stdin is not None
            process.stdin.write(full_prompt)
            process.stdin.close()

            # Accumulate response
            accumulated_text = ""
            stderr_output = ""

            # Display with Live for real-time updates
            prefix = get_yips_prefix()
            indent = " " * len(prefix)

            # Claude CLI doesn't expose token counts, so show 0 (no fake data)
            spinner = PulsingSpinner("Thinking...", token_count=0, model_status="generating")

            # stdout/stderr are guaranteed non-None when stdout=PIPE, stderr=PIPE
            assert process.stdout is not None
            assert process.stderr is not None

            if self.is_gui:
                while True:
                    char = process.stdout.read(1)
                    if not char and process.poll() is not None:
                        break
                    if not char:
                        time.sleep(0.01)
                        continue
                    accumulated_text += char
                    self.emit_gui_event("text_chunk", char)
            else:
                with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
                    while True:
                        # Read one character at a time for maximum responsiveness
                        char = process.stdout.read(1)
                        if not char and process.poll() is not None:
                            break

                        if not char:
                            time.sleep(0.01)
                            continue

                        accumulated_text += char

                        # Clean the text for display (hides tags)
                        display_accumulated = clean_response(accumulated_text)

                        # Update display with full gradient (include prefix)
                        display_text = Text()
                        display_text.append_text(prefix)

                        lines = display_accumulated.split('\n')
                        for i, text_line in enumerate(lines):
                            if i > 0:
                                display_text.append("\n" + indent)
                            display_text.append(apply_gradient_to_text(text_line))

                        live.update(display_text)

            # Print final output after Live exits (so it persists)
            cleaned_text = clean_response(accumulated_text)
            if cleaned_text:
                final_text = Text()
                final_text.append_text(prefix)
                # Strip trailing newlines to avoid double-spacing with console.print()
                lines = cleaned_text.strip().split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        final_text.append("\n" + indent)
                    final_text.append(gradient_text(line))
                self.console.print(final_text)

            # Collect stderr
            stderr_output = process.stderr.read()
            process.wait()

            # Display tool calls if verbose mode is on
            if self.verbose_mode and stderr_output:
                self._display_claude_tool_calls(stderr_output)

            if process.returncode == 0:
                return accumulated_text.strip()
            return f"[Error from Claude CLI: {stderr_output}]"

        except Exception as e:
            return f"[Error streaming from Claude CLI: {e}]"

    def get_response(self, message: str) -> str:
        """Get response using available backend (llamacpp, LM Studio, or Claude CLI)."""
        if not self.backend_initialized:
            return "[Error: Backend not initialized]"

        self.emit_gui_event("status", "thinking")

        if self.use_claude_cli:
            response = self.call_claude_cli(message)
        elif self.backend == "llamacpp":
            response = self.call_llamacpp(message)
            # If llama.cpp fails, fall back to LM Studio then Claude CLI
            if response.startswith("[Error: Could not connect") or response.startswith("[Error calling llama.cpp"):
                self.console.print(f"[yellow]{get_friendly_backend_name('llamacpp')} disconnected, trying {get_friendly_backend_name('lmstudio')}...[/yellow]")
                self.backend = "lmstudio"
                response = self.get_response(message)
        else: # lmstudio
            response = self.call_lm_studio(message)
            # If LM Studio fails mid-session, fall back to CLI
            if response.startswith("[Error: Could not connect"):
                self.console.print(f"[yellow]{get_friendly_backend_name('lmstudio')} disconnected, switching to {get_friendly_backend_name('claude')}.[/yellow]")
                self.use_claude_cli = True
                response = self.call_claude_cli(message)
        
        self.emit_gui_event("status", "idle")
        return response

    def generate_session_summary(self) -> str:
        """Generate a short summary of the conversation for the session filename."""
        if not self.conversation_history:
            return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"

        # Build a summary prompt
        summary_prompt = (
            "Summarize this conversation in 3-5 words for a filename. "
            "Use lowercase words separated by underscores. No special characters. "
            "Example: 'fixing_memorize_naming' or 'debugging_api_errors'. "
            "Respond with ONLY the filename slug, nothing else."
        )

        try:
            # Call the AI with the summary prompt
            response = self.get_response(summary_prompt)

            # Sanitize the response
            slug = response.strip().lower()
            slug = re.sub(r'[^a-z0-9_\s]', '', slug)
            slug = re.sub(r'[\s]+', '_', slug)
            slug = slug[:50]  # Limit length

            if slug:
                return slug
        except Exception:
            # If summary generation fails, fall back to timestamp
            pass

        # Fallback to timestamp-based name
        return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"

    def _generate_session_name_from_message(self) -> str:
        """Generate session name from first user message."""
        # Find first user message in history
        for entry in self.conversation_history:
            if entry.get("role") == "user":
                message = entry.get("content", "")
                # Clean and truncate
                slug = message.lower().strip()
                # Remove non-alphanumeric (except spaces)
                slug = re.sub(r'[^a-z0-9\s]', '', slug)
                # Replace spaces with underscores
                slug = re.sub(r'\s+', '_', slug)
                # Truncate to 50 chars
                slug = slug[:50]
                # Remove trailing underscores
                slug = slug.rstrip('_')
                return slug if slug else "session"
        return "session"

    def update_session_file(self) -> None:
        """Create or update the session memory file with current conversation."""
        if not self.conversation_history:
            return

        # Create session file on first message if it doesn't exist
        first_creation = False
        if not self._session_created:
            self._session_created = True
            first_creation = True
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            # Generate meaningful name from first user message
            safe_name = self._generate_session_name_from_message()
            self.current_session_name = safe_name
            filename = f"{timestamp}_{safe_name}.md"
            self.session_file_path = MEMORIES_DIR / filename

        if not self.session_file_path:
            return

        # Ensure directory exists
        MEMORIES_DIR.mkdir(parents=True, exist_ok=True)

        # Format conversation for file
        conversation_lines = []
        for entry in self.conversation_history:
            role = entry.get("role", "unknown")
            content = entry.get("content", "")

            if role == "user":
                conversation_lines.append(f"**Katherine**: {content}")
            elif role == "assistant":
                conversation_lines.append(f"**Yips**: {content}")
            elif role == "system":
                # Truncate long system messages
                preview = content[:200] + "..." if len(content) > 200 else content
                conversation_lines.append(f"*[System: {preview}]*")

        memory_content = f"""# Session Memory

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
**Type**: Ongoing Session

## Conversation

{chr(10).join(conversation_lines)}

---
*Last updated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}*
"""

        try:
            self.session_file_path.write_text(memory_content)
            if first_creation:
                self.refresh_title_box_only()
        except Exception as e:
            self.console.print(f"[dim]Note: Could not update session file: {e}[/dim]")

    def _display_lm_studio_tool_call(self, tool_name: str, tool_input: dict[str, Any]) -> None:
        """Display LM Studio tool calls in a formatted way using render_tool_call."""
        console.print()
        panel = render_tool_call(tool_name, tool_input)
        self.console.print(panel)

    def _display_claude_tool_calls(self, stderr_output: str) -> None:
        """Parse and display Claude Code tool calls from stderr."""
        lines = stderr_output.split('\n')

        # Collect tool-related lines
        for raw_line in lines:
            stripped_line = raw_line.strip()
            if not stripped_line:
                continue

            # Look for tool call indicators
            if 'Tool:' in stripped_line or 'tool:' in stripped_line or 'Reading' in stripped_line or 'Writing' in stripped_line or 'Running' in stripped_line:
                console.print()
                panel = render_tool_call("Claude Tool", stripped_line)
                self.console.print(panel)

    def rename_session(self, new_name: str) -> None:
        """Rename the current session and update title box."""
        # Sanitize new name
        slug = new_name.lower().strip()
        slug = re.sub(r'[^a-z0-9_\s-]', '', slug)
        slug = re.sub(r'[\s]+', '_', slug)
        slug = slug[:50]

        if not slug:
            self.console.print("[red]Invalid session name.[/red]")
            return

        self.current_session_name = slug

        # Rename file if it exists
        if self.session_file_path and self.session_file_path.exists():
            try:
                # Expected format: YYYY-MM-DD_HH-MM-SS_slug.md
                # Split by underscore to preserve timestamp parts
                name_parts = self.session_file_path.name.split('_', 2)
                
                if len(name_parts) >= 2:
                    # Reconstruct timestamp part (first two components)
                    timestamp_part = f"{name_parts[0]}_{name_parts[1]}"
                    new_filename = f"{timestamp_part}_{slug}.md"
                    new_path = self.session_file_path.parent / new_filename
                    
                    self.session_file_path.rename(new_path)
                    self.session_file_path = new_path
                    self.console.print(f"[green]Session renamed to: {slug}[/green]")
                else:
                    # Fallback for unexpected filename format
                    new_filename = f"{slug}.md"
                    new_path = self.session_file_path.parent / new_filename
                    self.session_file_path.rename(new_path)
                    self.session_file_path = new_path
                    
            except Exception as e:
                self.console.print(f"[red]Failed to rename session file: {e}[/red]")

        self.refresh_title_box_only()

    def load_session(self, file_path: Path) -> bool:
        """Load a conversation from a session memory file."""
        if not file_path.exists():
            return False

        try:
            content = file_path.read_text()
            
            # Extract conversation part
            conv_section = content.split("## Conversation")[-1].split("---")[0].strip()
            lines = conv_section.split('\n')
            
            new_history: list[Message] = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                if line.startswith("**Katherine**:"):
                    new_history.append({"role": "user", "content": line[len("**Katherine**:") :].strip()})
                elif line.startswith("**Yips**:"):
                    new_history.append({"role": "assistant", "content": line[len("**Yips**:") :].strip()})
                elif line.startswith("*[System:"):
                    # Remove *[System: and ]*
                    sys_content = line[9:-2].strip()
                    new_history.append({"role": "system", "content": sys_content})
                elif new_history:
                    # Append to previous message if it's a multi-line response
                    new_history[-1]["content"] += "\n" + line

            if new_history:
                self.conversation_history = new_history
                self.session_file_path = file_path
                self._session_created = True
                
                # Extract session name from filename
                name = file_path.stem
                parts = name.split('_', 2)
                if len(parts) >= 3:
                    self.current_session_name = parts[2]
                else:
                    self.current_session_name = name
                
                self.refresh_display()
                return True
                
        except Exception as e:
            self.console.print(f"[red]Error loading session: {e}[/red]")
            
        return False

    def new_session(self) -> None:
        """Clear current conversation and start a new session."""
        self.conversation_history = []
        self.session_file_path = None
        self._session_created = False
        self.current_session_name = None
        self.refresh_display()

    def graceful_exit(self) -> None:
        """Handle graceful exit and finalize session memory."""
        # Unload models and stop servers
        if not self.use_claude_cli:
            if self.backend == "llamacpp":
                from cli.llamacpp import stop_llamacpp
                stop_llamacpp()
            else:
                from cli.lmstudio import unload_all_models
                unload_all_models()

        # Cancel any pending resize timer
        if self._resize_timer is not None:
            self._resize_timer.cancel()

        # Ensure the session file is updated one last time before exit
        if self.conversation_history:
            self.update_session_file()

    def render_title_box(self) -> None:
        """Render the title box with responsive layout."""
        terminal_width = self.console.width
        self.last_width = terminal_width
        layout_mode = self._get_layout_mode(terminal_width)

        if layout_mode == "minimal":
            self._render_minimal_title()
        elif layout_mode in ("compact", "single"):
            self._render_single_column_title(layout_mode)
        else:
            self._render_two_column_title()

    def _render_minimal_title(self) -> None:
        """Render minimal title box for very narrow terminals (< 45 chars)."""
        terminal_width = self.console.width
        content_width = terminal_width - 2  # Account for │ borders

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"
        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        # Get info
        backend_key = "claude" if self.use_claude_cli else self.backend
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        logo = generate_yips_logo()
        logo_width = len(logo[0]) if logo else 1

        # Determine if we can show the logo (need at least logo width + 2 for borders)
        show_logo = content_width >= LOGO_WIDTH

        # Build minimal content based on available width
        lines = [""]  # blank line

        if show_logo:
            lines.extend(logo)
        else:
            # Show abbreviated "YIPS" text instead
            lines.append("YIPS")

        model_info = f"{display_backend} · {display_model}"
        lines.append(model_info)
        lines.append("")  # blank line

        logo_height = len(logo) if show_logo else 0
        total_logo_cells = logo_height * logo_width if show_logo else 1

        for line_num, line_text in enumerate(lines):
            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Logo lines (indices 1-6) - only if showing logo
            if show_logo and 1 <= line_num <= 6:
                logo_line_index = line_num - 1
                centered_text = safe_center(line_text, content_width)
                padding_left = (content_width - len(line_text)) // 2 if len(line_text) <= content_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    overall_progress = i / max(content_width - 1, 1)
                    
                    if 0 <= col_index <= logo_width:
                        # Diagonal gradient: Top-Left (Pink) to Bottom-Right (Yellow)
                        vertical_p = logo_line_index / max(logo_height - 1, 1)
                        horizontal_p = col_index / max(logo_width - 1, 1)
                        logo_progress = (vertical_p + horizontal_p) / 2
                        
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, logo_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
                    else:
                        # Padding: extend gradient based on overall position in content_width
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif not show_logo and line_num == 1:
                # Abbreviated "YIPS" text - gradient bold
                centered_text = safe_center(line_text, content_width)
                yips_text = gradient_text(centered_text)
                yips_text.stylize("bold")
                styled_line.append(yips_text)
            elif (show_logo and line_num == 7) or (not show_logo and line_num == 2):
                # Model info - solid blue, truncated if needed
                centered_text = safe_center(line_text, content_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            else:
                styled_line.append(safe_center(line_text, content_width))

            styled_line.append("│", style=right_bar_style)
            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width, self.current_session_name)

    def _render_single_column_title(self, layout_mode: str) -> None:
        """Render single-column title box for narrow terminals (45-79 chars)."""
        terminal_width = self.console.width
        content_width = terminal_width - 2  # Account for │ borders

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"
        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        # Gather content
        username = get_username()
        backend_key = "claude" if self.use_claude_cli else self.backend
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        cwd = get_display_directory()
        logo = generate_yips_logo()
        logo_width = len(logo[0]) if logo else 1

        # Check if we can show the logo
        show_logo = content_width >= LOGO_WIDTH

        # Build single column content
        welcome_msg = f"Welcome back {username}!" if layout_mode == "single" else f"Hi {username}!"
        lines = [
            "",  # [0] blank
            welcome_msg,  # [1]
            "",  # [2] blank
        ]

        if show_logo:
            lines.extend(logo)  # [3-8] logo lines
            model_info_index = 9
        else:
            lines.append("YIPS")  # [3] abbreviated text
            model_info_index = 4

        lines.append(f"{display_backend} · {display_model}")  # model info
        cwd_index = len(lines) if layout_mode == "single" else -1
        if layout_mode == "single":
            lines.append(cwd)
        lines.append("")  # blank padding

        logo_height = len(logo) if show_logo else 0
        total_logo_cells = logo_height * logo_width if show_logo else 1

        for line_num, line_text in enumerate(lines):
            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Logo lines (indices 3-8) - only if showing logo
            if show_logo and 3 <= line_num <= 8:
                logo_line_index = line_num - 3
                centered_text = safe_center(line_text, content_width)
                padding_left = (content_width - len(line_text)) // 2 if len(line_text) <= content_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    overall_progress = i / max(content_width - 1, 1)
                    
                    if 0 <= col_index <= logo_width:
                        # Diagonal gradient: Top-Left (Pink) to Bottom-Right (Yellow)
                        vertical_p = logo_line_index / max(logo_height - 1, 1)
                        horizontal_p = col_index / max(logo_width - 1, 1)
                        logo_progress = (vertical_p + horizontal_p) / 2
                        
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, logo_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
                    else:
                        # Padding: extend gradient based on overall position in content_width
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif not show_logo and line_num == 3:
                # Abbreviated "YIPS" text - gradient bold
                centered_text = safe_center(line_text, content_width)
                yips_text = gradient_text(centered_text)
                yips_text.stylize("bold")
                styled_line.append(yips_text)
            elif line_num == 1:  # Welcome message - gradient, bold
                centered_text = safe_center(line_text, content_width)
                welcome_text = gradient_text(centered_text)
                welcome_text.stylize("bold")
                styled_line.append(welcome_text)
            elif line_num == model_info_index:  # Model info - solid blue
                centered_text = safe_center(line_text, content_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            elif line_num == cwd_index and layout_mode == "single":  # CWD - gradient
                centered_text = safe_center(line_text, content_width)
                cwd_text = gradient_text(centered_text)
                styled_line.append(cwd_text)
            else:
                styled_line.append(safe_center(line_text, content_width))

            styled_line.append("│", style=right_bar_style)
            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width, self.current_session_name)

    def _render_two_column_title(self) -> None:
        """Render two-column title box for wide terminals (>= 80 chars)."""
        terminal_width = self.console.width

        # If logo width exceeds 50% of terminal, hide right column (render single-column)
        if LOGO_WIDTH > terminal_width * 0.5:
            self._render_single_column_title("single")
            return

        # Reserve space for borders and divider: │ + left + │ + right + │
        available_width = terminal_width - 3
        left_width = max(int(available_width * 0.45), 30)
        right_width = available_width - left_width

        # Gather content
        username = get_username()
        backend_key = "claude" if self.use_claude_cli else self.backend
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        cwd = get_display_directory()
        logo = generate_yips_logo()
        logo_height = len(logo)
        logo_width = len(logo[0]) if logo else 1
        
        if self.session_selection_active:
            # Show interactive session list in the right column
            # We have about 5-6 slots depending on layout
            max_slots = 5
            start_idx = max(0, min(self.session_selection_idx - max_slots // 2, len(self.session_list) - max_slots))
            visible_sessions = self.session_list[start_idx : start_idx + max_slots]
            activity = []
            for i, s in enumerate(visible_sessions):
                actual_idx = start_idx + i
                is_selected = (actual_idx == self.session_selection_idx)
                prefix = "> " if is_selected else "  "
                # We'll handle the styling in the render loop below
                activity.append((prefix + s['display'], is_selected))
        else:
            activity = [(a, False) for a in get_recent_activity()]

        # Build left column (12 lines)
        left_col = [
            "",  # [0] blank
            f"Welcome back {username}!",  # [1]
            "",  # [2] blank
        ]
        left_col.extend(logo)  # [3-8] logo lines (6 lines)
        left_col.append(f"{display_backend} · {display_model}")  # [9]
        left_col.append(cwd)  # [10]
        left_col.append("")  # [11] blank padding

        # Build right column
        verbose_status = "on" if self.verbose_mode else "off"
        streaming_status = "on" if self.streaming_enabled else "off"
        right_col_data = [
            ("Tips for getting started:", False),  # [0]
            ("- Ask questions, edit files, or run commands.", False),  # [1]
            ("- Be specific for the best results.", False),  # [2]
            ("- /help for more information.", False),  # [3]
            ("", False),  # [4]
            ("─" * right_width, False),  # [5] divider
            ("Recent activity", False),  # [6]
        ]
        right_col_data.extend(activity)
        
        while len(right_col_data) < len(left_col):
            right_col_data.append(("", False))

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Render content lines
        max_lines = max(len(left_col), len(right_col_data))

        # Calculate border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"

        middle_progress = (left_width + 1) / max(terminal_width - 1, 1)
        r_mid, g_mid, b_mid = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, middle_progress)
        divider_style = f"rgb({r_mid},{g_mid},{b_mid})"

        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        total_logo_cells = logo_height * logo_width
        for line_num in range(max_lines):
            left_text = left_col[line_num] if line_num < len(left_col) else ""
            right_item = right_col_data[line_num] if line_num < len(right_col_data) else ("", False)
            right_text, is_highlighted = right_item

            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Left content with proper styling
            if line_num >= 3 and line_num <= 8:  # Logo lines - raster scan gradient
                logo_line_index = line_num - 3
                centered_text = safe_center(left_text, left_width)
                padding_left = (left_width - len(left_text)) // 2 if len(left_text) <= left_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    overall_progress = i / max(left_width - 1, 1)

                    if 0 <= col_index <= logo_width:  # Allow equal to handle edge cases
                        # Diagonal gradient: Top-Left (Pink) to Bottom-Right (Yellow)
                        vertical_p = logo_line_index / max(logo_height - 1, 1)
                        horizontal_p = col_index / max(logo_width - 1, 1)
                        logo_progress = (vertical_p + horizontal_p) / 2
                        
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, logo_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
                    else:
                        # Padding: extend gradient based on overall position in left_width
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 1:  # Welcome message - gradient, bold
                centered_text = safe_center(left_text, left_width)
                welcome_text = gradient_text(centered_text)
                welcome_text.stylize("bold")
                styled_line.append(welcome_text)
            elif line_num == 9:  # Model info - solid blue
                centered_text = safe_center(left_text, left_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            elif line_num == 10:  # CWD - gradient
                centered_text = safe_center(left_text, left_width)
                cwd_text = gradient_text(centered_text)
                styled_line.append(cwd_text)
            else:
                centered_text = safe_center(left_text, left_width)
                styled_line.append(centered_text)

            # Divider bar
            styled_line.append("│", style=divider_style)

            # Right content with styling - truncate if needed
            def truncate_right(text: str) -> str:
                if len(text) > right_width:
                    return text[:right_width]
                return text.ljust(right_width)

            right_col_start_position = left_width + 2

            if is_highlighted:
                # Highlighted session: pink bold
                padded_text = truncate_right(right_text)
                # First two chars might be "> "
                cursor_part = padded_text[:2]
                text_part = padded_text[2:]
                styled_line.append(cursor_part, style="bold #ffccff")
                styled_line.append(text_part, style="bold #ffccff")
            elif line_num == 0:  # Tips header - gradient, bold
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b}) bold")
            elif 1 <= line_num <= 4:  # Commands - gradient
                padded_text = truncate_right(right_text)
                # Match /command (starts with / followed by letters)
                command_match = re.search(r'(/[a-z]+)', padded_text)
                command_range = command_match.span() if command_match else (-1, -1)

                for i, char in enumerate(padded_text):
                    if command_range[0] <= i < command_range[1]:
                        # Commands in pink
                        styled_line.append(char, style="#ffccff")
                    else:
                        # Rest of the description with gradient
                        char_position = right_col_start_position + i
                        progress = char_position / max(terminal_width - 1, 1)
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 5:  # Divider line - gradient
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 6:  # Recent activity header - white bold
                styled_line.append(truncate_right(right_text), style="bright_white bold")
            elif line_num >= 7:  # Activity items - dim
                styled_line.append(truncate_right(right_text), style="dim")
            else:
                styled_line.append(truncate_right(right_text))

            # Right bar
            styled_line.append("│", style=right_bar_style)

            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width, self.current_session_name)

    def refresh_display(self) -> None:
        """Clear terminal and re-render title box and history."""
        subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
        self.render_title_box()
        self._replay_conversation_history()

    def _replay_conversation_history(self) -> None:
        """Re-render all messages from conversation_history to screen.

        Reconstructs the visible chat by replaying stored messages.
        """
        from cli.color_utils import print_yips, PROMPT_COLOR
        from cli.config import INTERNAL_REPROMPT

        for i, message in enumerate(self.conversation_history):
            role = message.get("role")
            content = message.get("content", "")

            if role == "user":
                # Skip internal reprompts in replay
                if content == INTERNAL_REPROMPT:
                    continue
                # User messages need to be re-printed during replay
                self.console.print(f">>> {content}", style=PROMPT_COLOR)
            elif role == "assistant":
                if content:
                    # Parse and render thinking blocks if present
                    thinking_match = re.search(r"<think>(.*?)</think>", content, re.DOTALL)
                    if thinking_match:
                        thinking_content = thinking_match.group(1).strip()
                        if thinking_content:
                            self.console.print(render_thinking_block(thinking_content))
                    
                    # Clean and print the actual response
                    cleaned_content = clean_response(content)
                    if cleaned_content:
                        print_yips(cleaned_content)
            elif role == "system":
                if content:
                    # Check if it's a structured tool result
                    try:
                        if content.startswith('{') and content.endswith('}'):
                            data = json.loads(content)
                            if "tool" in data and "result" in data:
                                # Reconstruct tool call panel
                                tool_name = data.get("tool", "unknown")
                                params = data.get("params", "")
                                result = data.get("result", "")
                                self.console.print(render_tool_call(tool_name, params, result=result))
                                continue
                    except:
                        pass
                        
                    # Fallback to raw display
                    self.console.print(content, style=TOOL_COLOR)

            # Add turn-separating blank line
            if (i + 1 < len(self.conversation_history) and self.conversation_history[i+1]["role"] == "user") or (i + 1 == len(self.conversation_history)):
                self.console.print()

    def refresh_title_box_only(self) -> None:
        """Re-render the title box and conversation history.

        Clears screen, re-renders title box with updated session name,
        replays all conversation messages, and signals prompt_toolkit to redraw.
        """
        if self.prompt_session is not None:
            try:
                from prompt_toolkit.application import get_app

                # Clear screen to ensure clean redraw
                subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)

                # Re-render title box with updated session name and recent activity
                self.render_title_box()

                # Re-render all conversation messages from memory
                self._replay_conversation_history()

                # Signal prompt_toolkit to redraw the input prompt
                app = get_app()
                app.invalidate()

            except Exception as e:
                # Fallback if get_app() fails (shouldn't happen in normal usage)
                subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
                self.render_title_box()
                self._replay_conversation_history()
        else:
            # Fallback for cases where prompt_session isn't set yet
            subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
            self.render_title_box()
            self._replay_conversation_history()

    def _handle_resize(self, signum: int, frame: "FrameType | None") -> None:
        """Handle SIGWINCH signal with debouncing."""
        # Immediately clear screen to prevent line wrapping during resize
        print("\033[2J\033[H", end="", flush=True)

        if self._resize_timer is not None:
            self._resize_timer.cancel()
        self._resize_timer = threading.Timer(0.1, self._trigger_resize)
        self._resize_timer.start()

    def _trigger_resize(self) -> None:
        """Set flag to trigger resize on next main loop iteration."""
        self.resize_pending = True

    def _get_layout_mode(self, width: int) -> str:
        """Determine layout mode based on terminal width."""
        if width >= LAYOUT_FULL_MIN_WIDTH:
            return "full"
        elif width >= LAYOUT_SINGLE_MIN_WIDTH:
            return "single"
        elif width >= LAYOUT_COMPACT_MIN_WIDTH:
            return "compact"
        else:
            return "minimal"

    def stream_text(self, text: str) -> None:
        """Simulate streaming for a static piece of text."""
        prefix = get_yips_prefix()
        indent = " " * len(prefix)

        accumulated = ""
        with Live("", console=self.console, refresh_per_second=20, transient=True) as live:
            for char in text:
                accumulated += char

                display_text = Text()
                display_text.append_text(prefix)

                lines = accumulated.split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        display_text.append("\n" + indent)
                    display_text.append(apply_gradient_to_text(line))

                live.update(display_text)
                time.sleep(0.02)  # Adjust for desired speed

        # Print final persistent output
        self.console.print(prefix, end="")
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if i == 0:
                self.console.print(gradient_text(line))
            else:
                self.console.print(gradient_text(indent + line))


