"""Tests for LlamaCppRunner, ClaudeCodeRunner, and CodexRunner."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
#  _format_discord_context_block (LlamaCpp helper)
# ---------------------------------------------------------------------------

from cli.gateway.runners.llamacpp import _format_discord_context_block


class TestFormatDiscordContextBlock:
    def test_full_guild_context(self):
        ctx = {
            "guild_id": "123",
            "guild_name": "My Server",
            "channel_id": "456",
            "channel_name": "general",
            "channel_type": "guild_text",
            "author_id": "789",
            "author_display_name": "Alice",
            "is_bot_mentioned": False,
            "reply_to_message_id": None,
        }
        result = _format_discord_context_block(ctx)
        assert "[Discord context]" in result
        assert "My Server" in result
        assert "id=123" in result
        assert "#general" in result
        assert "type=guild_text" in result
        assert "Alice" in result
        assert "id=789" in result
        # bot mention note should NOT be present
        assert "@mentioned" not in result
        # reply-reference note should NOT be present (no reply_to_message_id in this ctx)
        assert "reply to message id=" not in result.lower()

    def test_bot_mentioned_note(self):
        ctx = {
            "is_bot_mentioned": True,
            "author_display_name": "Bob",
            "author_id": "1",
        }
        result = _format_discord_context_block(ctx)
        assert "@mentioned" in result

    def test_reply_reference(self):
        ctx = {
            "reply_to_message_id": "555",
            "author_display_name": "Carol",
            "author_id": "2",
        }
        result = _format_discord_context_block(ctx)
        assert "555" in result
        assert "reply" in result.lower()

    def test_dm_context_no_guild(self):
        ctx = {
            "channel_type": "dm",
            "channel_name": "dm",
            "channel_id": "999",
            "author_display_name": "Dave",
            "author_id": "3",
        }
        result = _format_discord_context_block(ctx)
        assert "[Discord context]" in result
        # No guild section
        assert "Server:" not in result

    def test_empty_context(self):
        result = _format_discord_context_block({})
        assert "[Discord context]" in result


# ---------------------------------------------------------------------------
#  LlamaCppRunner.run — message list construction
# ---------------------------------------------------------------------------

class TestLlamaCppRunnerMessageList:
    def _make_runner(self):
        import sys
        # cli.llamacpp has a transitive dep on psutil; mock the whole module.
        mock_llamacpp = MagicMock()
        mock_llamacpp.get_llama_server_url.return_value = "http://localhost:8080"
        with patch.dict(sys.modules, {
            "cli.llamacpp": mock_llamacpp,
            "cli.hw_utils": MagicMock(),
            "psutil": MagicMock(),
        }):
            from cli.gateway.runners.llamacpp import LlamaCppRunner
            return LlamaCppRunner()

    def _stub_response(self, text: str) -> dict:
        return {
            "choices": [
                {
                    "message": {"content": text, "tool_calls": None},
                    "finish_reason": "stop",
                }
            ]
        }

    def test_no_history_no_context(self):
        """Plain prompt → single user message, no system prefix."""
        runner = self._make_runner()
        captured: list[list[dict]] = []

        def fake_post(url, json, timeout):  # type: ignore[override]
            captured.append(json["messages"])
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json.return_value = self._stub_response("hello")
            return resp

        with patch("requests.post", side_effect=fake_post):
            result = runner.run("hi", can_edit=False)

        assert result == "hello"
        msgs = captured[0]
        assert len(msgs) == 1
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "hi"

    def test_with_history(self):
        """History entries are prepended (without metadata key)."""
        runner = self._make_runner()
        history = [
            {"role": "user", "content": "Alice: hello", "metadata": {"author_id": "1"}},
            {"role": "assistant", "content": "Hi Alice!"},
        ]
        captured: list[list[dict]] = []

        def fake_post(url, json, timeout):  # type: ignore[override]
            captured.append(json["messages"])
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json.return_value = self._stub_response("yo")
            return resp

        with patch("requests.post", side_effect=fake_post):
            runner.run("Alice: bye", can_edit=False, history=history)

        msgs = captured[0]
        # history: 2 entries + current prompt = 3
        assert len(msgs) == 3
        assert msgs[0]["role"] == "user"
        assert msgs[1]["role"] == "assistant"
        assert msgs[2]["role"] == "user"
        # metadata key must NOT be forwarded to the API
        assert "metadata" not in msgs[0]
        assert "metadata" not in msgs[1]

    def test_with_context_adds_system_message(self):
        """message_context → system message prepended."""
        runner = self._make_runner()
        ctx = {
            "guild_id": "1",
            "guild_name": "SRV",
            "channel_id": "2",
            "channel_name": "chat",
            "channel_type": "guild_text",
            "author_id": "3",
            "author_display_name": "Eve",
            "is_bot_mentioned": False,
            "reply_to_message_id": None,
        }
        captured: list[list[dict]] = []

        def fake_post(url, json, timeout):  # type: ignore[override]
            captured.append(json["messages"])
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json.return_value = self._stub_response("ok")
            return resp

        with patch("requests.post", side_effect=fake_post):
            runner.run("hey", message_context=ctx)

        msgs = captured[0]
        assert msgs[0]["role"] == "system"
        assert "[Discord context]" in msgs[0]["content"]
        assert msgs[-1]["role"] == "user"

    def test_discord_tools_added_with_context(self):
        """Discord tools are appended to the tool list when message_context is set."""
        runner = self._make_runner()
        ctx = {"guild_id": "1", "channel_id": "2", "author_id": "3"}
        captured_tools: list[list] = []

        def fake_post(url, json, timeout):  # type: ignore[override]
            captured_tools.append(json.get("tools", []))
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json.return_value = self._stub_response("done")
            return resp

        with patch("requests.post", side_effect=fake_post):
            runner.run("go", message_context=ctx)

        tool_names = {t["function"]["name"] for t in captured_tools[0]}
        assert "discord_get_server_context" in tool_names
        assert "discord_list_members" in tool_names
        assert "discord_list_channels" in tool_names

    def test_discord_tools_absent_without_context(self):
        """Without message_context, Discord tools are NOT in the list."""
        runner = self._make_runner()
        captured_tools: list[list] = []

        def fake_post(url, json, timeout):  # type: ignore[override]
            captured_tools.append(json.get("tools", []))
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json.return_value = self._stub_response("done")
            return resp

        with patch("requests.post", side_effect=fake_post):
            runner.run("go")

        tool_names = {t["function"]["name"] for t in captured_tools[0]}
        assert "discord_get_server_context" not in tool_names


# ---------------------------------------------------------------------------
#  _build_prefixed_prompt (ClaudeCode / Codex shared helper)
# ---------------------------------------------------------------------------

from cli.gateway.runners.claude_code import _build_prefixed_prompt


class TestBuildPrefixedPrompt:
    def test_no_history_no_context_returns_prompt_unchanged(self):
        assert _build_prefixed_prompt("hello", None, None) == "hello"

    def test_empty_history_no_context_returns_prompt_unchanged(self):
        assert _build_prefixed_prompt("hello", [], None) == "hello"

    def test_with_context_only(self):
        ctx = {
            "guild_id": "1",
            "guild_name": "SRV",
            "channel_id": "2",
            "channel_name": "chat",
            "channel_type": "guild_text",
            "author_id": "3",
            "author_display_name": "Alice",
            "is_bot_mentioned": False,
            "reply_to_message_id": None,
        }
        result = _build_prefixed_prompt("hi", None, ctx)
        assert "[Discord context]" in result
        assert "SRV" in result
        assert "hi" in result

    def test_with_history_only(self):
        history = [
            {"role": "user", "content": "Alice: first"},
            {"role": "assistant", "content": "Got it"},
        ]
        result = _build_prefixed_prompt("second", history, None)
        assert "[Conversation history]" in result
        assert "Alice: first" in result
        assert "Got it" in result
        assert result.endswith("second")

    def test_metadata_stripped_from_history(self):
        """metadata key should not appear in stdin output."""
        history = [
            {"role": "user", "content": "Alice: hi", "metadata": {"author_id": "999"}},
        ]
        result = _build_prefixed_prompt("bye", history, None)
        assert "999" not in result  # author_id value not leaked

    def test_with_both_context_and_history(self):
        ctx = {"guild_id": "10", "guild_name": "G", "channel_id": "20",
               "channel_name": "c", "author_id": "30", "author_display_name": "X"}
        history = [{"role": "user", "content": "X: previous"}]
        result = _build_prefixed_prompt("now", history, ctx)
        # Sections: context block, few-shot example, history block, prompt
        assert "[Discord context]" in result
        assert "[Example interaction" in result
        assert "[Conversation history]" in result
        assert result.endswith("now")

    def test_bot_mentioned_note_in_context(self):
        ctx = {"author_id": "1", "author_display_name": "A", "is_bot_mentioned": True}
        result = _build_prefixed_prompt("ping", None, ctx)
        assert "@mentioned" in result

    def test_reply_reference_in_context(self):
        ctx = {"author_id": "1", "author_display_name": "A", "reply_to_message_id": "777"}
        result = _build_prefixed_prompt("quoting", None, ctx)
        assert "777" in result


# ---------------------------------------------------------------------------
#  ClaudeCodeRunner.run — forwards prefixed prompt to subprocess
# ---------------------------------------------------------------------------

class TestClaudeCodeRunnerRun:
    def test_no_context_passes_prompt_directly(self):
        from cli.gateway.runners.claude_code import ClaudeCodeRunner
        runner = ClaudeCodeRunner(bin_path="claude")
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "  response  "

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            out = runner.run("hello")

        assert out == "response"
        _, kwargs = mock_run.call_args
        assert kwargs["input"] == "hello"

    def test_with_context_passes_prefixed_prompt(self):
        from cli.gateway.runners.claude_code import ClaudeCodeRunner
        runner = ClaudeCodeRunner(bin_path="claude")
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "ok"

        ctx = {"guild_id": "1", "guild_name": "S", "channel_id": "2",
               "channel_name": "c", "author_id": "3", "author_display_name": "U"}

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            runner.run("hey", message_context=ctx)

        _, kwargs = mock_run.call_args
        assert "[Discord context]" in kwargs["input"]
        assert "hey" in kwargs["input"]

    def test_raises_on_nonzero_exit(self):
        from cli.gateway.runners.claude_code import ClaudeCodeRunner
        runner = ClaudeCodeRunner(bin_path="claude")
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "oops"

        with patch("subprocess.run", return_value=mock_result):
            with pytest.raises(RuntimeError, match="oops"):
                runner.run("fail")


# ---------------------------------------------------------------------------
#  CodexRunner.run — same pattern as ClaudeCodeRunner
# ---------------------------------------------------------------------------

class TestCodexRunnerRun:
    def test_no_context_passes_prompt_directly(self):
        from cli.gateway.runners.codex import CodexRunner
        runner = CodexRunner(bin_path="codex")
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "codex-response"

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            out = runner.run("task")

        assert out == "codex-response"
        _, kwargs = mock_run.call_args
        assert kwargs["input"] == "task"

    def test_with_context_passes_prefixed_prompt(self):
        from cli.gateway.runners.codex import CodexRunner
        runner = CodexRunner(bin_path="codex")
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "done"

        ctx = {"guild_id": "1", "guild_name": "S", "channel_id": "2",
               "channel_name": "c", "author_id": "3", "author_display_name": "U"}

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            runner.run("go", message_context=ctx)

        _, kwargs = mock_run.call_args
        assert "[Discord context]" in kwargs["input"]
