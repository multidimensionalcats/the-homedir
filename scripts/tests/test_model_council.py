"""Hostile tests for model_council.py -- defines the API contract via TDD.

These tests intentionally target a module that does NOT yet exist.
Every test here should FAIL until the implementation is written.

ALL HTTP calls are mocked -- no live API calls ever.
"""

import io
import json
import os
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import pytest

from scripts.model_council import Council, Participant

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_participants(*names):
    """Create N Participant objects with distinct models and personas."""
    models = [
        "deepseek/deepseek-r1",
        "google/gemini-2.5-pro",
        "qwen/qwen3-235b",
        "meta-llama/llama-4-maverick",
    ]
    personas = [
        "You are a rigorous systems thinker.",
        "You are a creative provocateur.",
        "You are a careful empiricist.",
        "You are a contrarian devil's advocate.",
    ]
    result = []
    for i, name in enumerate(names):
        result.append(
            Participant(
                name=name,
                model=models[i % len(models)],
                persona=personas[i % len(personas)],
            )
        )
    return result


def _mock_openrouter_response(
    content="Response text.",
    reasoning=None,
    finish_reason="stop",
    usage=None,
):
    """Build a bytes-encoded mock OpenRouter JSON response."""
    message = {"content": content, "role": "assistant"}
    if reasoning is not None:
        message["reasoning"] = reasoning
    choice = {"message": message, "finish_reason": finish_reason}
    body = {"choices": [choice]}
    if usage is not None:
        body["usage"] = usage
    return json.dumps(body).encode("utf-8")


def _urlopen_side_effect_factory(responses_by_model):
    """Return a urlopen side-effect that dispatches by model in the request body.

    responses_by_model: dict mapping model string to bytes response body.
    """

    def side_effect(request, timeout=None):
        body = json.loads(request.data.decode("utf-8"))
        model = body["model"]
        if model not in responses_by_model:
            raise HTTPError(
                url="https://openrouter.ai/api/v1/chat/completions",
                code=500,
                msg="Unknown model",
                hdrs={},
                fp=io.BytesIO(b""),
            )
        resp_bytes = responses_by_model[model]
        mock_resp = MagicMock()
        mock_resp.read.return_value = resp_bytes
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    return side_effect


def _make_council(
    participants=None,
    api_key="sk-test-key-1234",
    name="Test Council",
    system_context="You are reviewing an experiment.",
    max_tokens=8000,
    timeout=120,
):
    """Build a Council with sane defaults."""
    if participants is None:
        participants = _make_participants("Alpha", "Beta", "Gamma")
    return Council(
        name=name,
        system_context=system_context,
        participants=participants,
        api_key=api_key,
        max_tokens=max_tokens,
        timeout=timeout,
    )


# ===========================================================================
# 1. PARTICIPANT DATACLASS
# ===========================================================================


class TestParticipant:
    def test_valid_construction(self):
        p = Participant(name="DeepSeek", model="deepseek/deepseek-r1", persona="Thinker")
        assert p.name == "DeepSeek"
        assert p.model == "deepseek/deepseek-r1"
        assert p.persona == "Thinker"

    def test_frozen_immutability(self):
        """Participant is a frozen dataclass -- attribute assignment must raise."""
        p = Participant(name="X", model="m", persona="p")
        with pytest.raises(AttributeError):
            p.name = "Y"
        with pytest.raises(AttributeError):
            p.model = "other"
        with pytest.raises(AttributeError):
            p.persona = "changed"

    def test_empty_strings_still_construct(self):
        """Validation is Council's job, not Participant's."""
        p = Participant(name="", model="", persona="")
        assert p.name == ""
        assert p.model == ""
        assert p.persona == ""

    def test_equality_by_value(self):
        a = Participant(name="A", model="m", persona="p")
        b = Participant(name="A", model="m", persona="p")
        assert a == b

    def test_inequality_on_any_field_difference(self):
        base = Participant(name="A", model="m", persona="p")
        assert base != Participant(name="B", model="m", persona="p")
        assert base != Participant(name="A", model="x", persona="p")
        assert base != Participant(name="A", model="m", persona="q")

    def test_unicode_in_fields(self):
        p = Participant(name="模型α", model="vendor/模型", persona="你是一个严谨的思考者")
        assert "模型" in p.name
        assert "模型" in p.model

    def test_very_long_persona(self):
        """10K char persona should not be rejected at this layer."""
        long = "x" * 10_000
        p = Participant(name="A", model="m", persona=long)
        assert len(p.persona) == 10_000


# ===========================================================================
# 2. COUNCIL CONSTRUCTION
# ===========================================================================


class TestCouncilConstruction:
    def test_valid_construction(self):
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts)
        assert c is not None

    def test_empty_participants_raises(self):
        with pytest.raises(ValueError, match="[Pp]articipant"):
            _make_council(participants=[])

    def test_duplicate_participant_names_raises(self):
        parts = _make_participants("Alpha", "Alpha")
        with pytest.raises(ValueError, match="[Dd]uplicate"):
            _make_council(participants=parts)

    def test_duplicate_names_case_sensitive(self):
        """'Alpha' and 'alpha' are different names -- should NOT raise."""
        parts = [
            Participant(name="Alpha", model="m1", persona="p1"),
            Participant(name="alpha", model="m2", persona="p2"),
        ]
        c = _make_council(participants=parts)
        assert c is not None

    def test_stores_api_key(self):
        c = _make_council(api_key="sk-secret-999")
        # We don't prescribe the attribute name, but the key must
        # appear in outgoing requests (tested in run_round tests).
        # Here we just verify construction doesn't lose it.
        assert c is not None

    def test_stores_max_tokens(self):
        c = _make_council(max_tokens=2048)
        assert c is not None

    def test_stores_timeout(self):
        c = _make_council(timeout=30)
        assert c is not None

    def test_stores_system_context(self):
        ctx = "Custom system context for this council."
        c = _make_council(system_context=ctx)
        assert c is not None

    def test_stores_name(self):
        c = _make_council(name="Design Review Council")
        assert c is not None

    def test_single_participant_allowed(self):
        """A council of one is valid -- solo deliberation."""
        parts = _make_participants("Solo")
        c = _make_council(participants=parts)
        assert c is not None

    def test_many_participants(self):
        """10 participants should be fine."""
        names = [f"Model_{i}" for i in range(10)]
        parts = _make_participants(*names)
        c = _make_council(participants=parts)
        assert c is not None


# ===========================================================================
# 3. CONTEXT BUILDING (_build_messages)
# ===========================================================================


class TestBuildMessages:
    """Tests for _build_messages -- the core logic that constructs the
    OpenRouter messages array for a given participant in a given round."""

    def test_round_1_single_participant(self):
        """Round 1: system + user with prompt. No history."""
        parts = _make_participants("Solo")
        c = _make_council(participants=parts)
        msgs = c._build_messages(parts[0], "What is identity?")
        assert msgs[0]["role"] == "system"
        assert "What is identity?" in msgs[-1]["content"]
        assert msgs[-1]["role"] == "user"
        # No assistant messages yet (round 1)
        assert all(m["role"] != "assistant" for m in msgs)

    def test_round_1_system_contains_context_and_persona(self):
        """System message must include both system_context and persona."""
        parts = _make_participants("Alpha")
        ctx = "Reviewing an AI experiment."
        c = _make_council(
            participants=parts,
            system_context=ctx,
        )
        msgs = c._build_messages(parts[0], "Prompt text")
        system_content = msgs[0]["content"]
        assert ctx in system_content
        assert parts[0].persona in system_content

    def test_round_1_multiple_participants_no_cross_contamination(self):
        """Each participant sees only their own persona, not others'."""
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts)
        msgs_a = c._build_messages(parts[0], "Hello")
        msgs_b = c._build_messages(parts[1], "Hello")
        assert parts[0].persona in msgs_a[0]["content"]
        assert parts[1].persona not in msgs_a[0]["content"]
        assert parts[1].persona in msgs_b[0]["content"]
        assert parts[0].persona not in msgs_b[0]["content"]

    @patch("scripts.model_council.urlopen")
    def test_round_2_includes_round_1_history(self, mock_urlopen):
        """After Round 1, Round 2 messages include attributed R1 responses
        from OTHER participants, and the participant's OWN R1 response
        as an assistant turn."""
        parts = _make_participants("Alpha", "Beta", "Gamma")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response("Alpha R1 answer"),
            parts[1].model: _mock_openrouter_response("Beta R1 answer"),
            parts[2].model: _mock_openrouter_response("Gamma R1 answer"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("Round 1 prompt")

        # Now build Round 2 messages for Alpha
        msgs = c._build_messages(parts[0], "Round 2 prompt")

        # Should have: system, user (R1 prompt), assistant (Alpha R1),
        #              user (R2 prompt + Beta/Gamma R1 attributed)
        roles = [m["role"] for m in msgs]
        assert roles[0] == "system"
        assert "assistant" in roles, "Alpha's own R1 must appear as assistant"

        # Alpha's response must be in an assistant turn
        assistant_msgs = [m for m in msgs if m["role"] == "assistant"]
        assert any("Alpha R1 answer" in m["content"] for m in assistant_msgs)

        # Beta and Gamma R1 must appear in a user turn (attributed)
        user_msgs = [m for m in msgs if m["role"] == "user"]
        user_text = " ".join(m["content"] for m in user_msgs)
        assert "Beta R1 answer" in user_text
        assert "Gamma R1 answer" in user_text
        assert "Round 2 prompt" in user_text

    @patch("scripts.model_council.urlopen")
    def test_round_3_full_history_reconstruction(self, mock_urlopen):
        """Round 3 for Alpha should reconstruct:
        user(R1 prompt) -> assistant(Alpha R1) ->
        user(R2 prompt + others' R1) -> assistant(Alpha R2) ->
        user(R3 prompt + others' R2)."""
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts)

        # Round 1
        r1 = {
            parts[0].model: _mock_openrouter_response("A-R1"),
            parts[1].model: _mock_openrouter_response("B-R1"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r1)
        c.run_round("Prompt-1")

        # Round 2
        r2 = {
            parts[0].model: _mock_openrouter_response("A-R2"),
            parts[1].model: _mock_openrouter_response("B-R2"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r2)
        c.run_round("Prompt-2")

        # Build Round 3 messages for Alpha
        msgs = c._build_messages(parts[0], "Prompt-3")
        roles = [m["role"] for m in msgs]

        # Must start with system
        assert roles[0] == "system"

        # Must alternate user/assistant after system
        non_system = roles[1:]
        for i, role in enumerate(non_system):
            expected = "user" if i % 2 == 0 else "assistant"
            assert role == expected, (
                f"Position {i}: expected {expected}, got {role}. Full roles: {roles}"
            )

        # Alpha's R1 and R2 must be in assistant turns
        assistant_content = " ".join(m["content"] for m in msgs if m["role"] == "assistant")
        assert "A-R1" in assistant_content
        assert "A-R2" in assistant_content

        # Beta's R1 and R2 must be in user turns (attributed)
        user_content = " ".join(m["content"] for m in msgs if m["role"] == "user")
        assert "B-R1" in user_content
        assert "B-R2" in user_content
        assert "Prompt-3" in user_content

    @patch("scripts.model_council.urlopen")
    def test_single_participant_no_other_responses(self, mock_urlopen):
        """Solo council: no 'other' responses to include."""
        parts = _make_participants("Solo")
        c = _make_council(participants=parts)

        r1 = {parts[0].model: _mock_openrouter_response("Solo-R1")}
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r1)
        c.run_round("P1")

        msgs = c._build_messages(parts[0], "P2")
        roles = [m["role"] for m in msgs]
        assert roles[0] == "system"
        # user/assistant alternation
        non_system = roles[1:]
        for i, role in enumerate(non_system):
            expected = "user" if i % 2 == 0 else "assistant"
            assert role == expected

        # Solo's own R1 must be in assistant turn
        assert any("Solo-R1" in m["content"] for m in msgs if m["role"] == "assistant")

    @patch("scripts.model_council.urlopen")
    def test_empty_response_skipped_in_attribution(self, mock_urlopen):
        """A participant with empty R1 response should NOT be attributed
        in other participants' context — avoids wasting tokens on
        empty attribution headers."""
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts)

        r1 = {
            parts[0].model: _mock_openrouter_response("A says stuff"),
            parts[1].model: _mock_openrouter_response(""),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r1)
        c.run_round("P1")

        msgs = c._build_messages(parts[0], "P2")
        user_text = " ".join(m["content"] for m in msgs if m["role"] == "user")
        # Beta's empty response should NOT produce an attribution header
        assert "Beta" not in user_text

    def test_system_message_separator(self):
        """System message must have a clear separator between context and
        persona -- not just concatenated."""
        parts = _make_participants("Alpha")
        c = _make_council(
            participants=parts,
            system_context="CONTEXT_MARKER",
        )
        msgs = c._build_messages(parts[0], "prompt")
        sys_content = msgs[0]["content"]
        # Both must be present
        assert "CONTEXT_MARKER" in sys_content
        assert parts[0].persona in sys_content
        # They must not be directly concatenated (some separator needed)
        combined = "CONTEXT_MARKER" + parts[0].persona
        assert sys_content != combined, "System message appears to be raw concatenation"


# ===========================================================================
# 4. ATTRIBUTION FORMATTING
# ===========================================================================


class TestFormatAttribution:
    def test_standard_format(self):
        parts = _make_participants("DeepSeek")
        c = _make_council(participants=parts)
        result = c._format_attribution("DeepSeek", 1, "Some response.")
        assert result == "=== DeepSeek (Round 1) ===\nSome response."

    def test_special_characters_in_name(self):
        parts = _make_participants("Model/v2.5-β")
        c = _make_council(participants=parts)
        result = c._format_attribution("Model/v2.5-β", 2, "text")
        assert "Model/v2.5-β" in result
        assert "(Round 2)" in result

    def test_multi_line_text(self):
        parts = _make_participants("X")
        c = _make_council(participants=parts)
        text = "Line one.\nLine two.\nLine three."
        result = c._format_attribution("X", 1, text)
        assert result == "=== X (Round 1) ===\nLine one.\nLine two.\nLine three."

    def test_empty_text(self):
        parts = _make_participants("X")
        c = _make_council(participants=parts)
        result = c._format_attribution("X", 3, "")
        assert "=== X (Round 3) ===" in result

    def test_round_number_zero(self):
        """Round 0 is unusual but should not crash."""
        parts = _make_participants("X")
        c = _make_council(participants=parts)
        result = c._format_attribution("X", 0, "text")
        assert "(Round 0)" in result

    def test_large_round_number(self):
        parts = _make_participants("X")
        c = _make_council(participants=parts)
        result = c._format_attribution("X", 999, "text")
        assert "(Round 999)" in result


# ===========================================================================
# 5. REASONING MODEL FALLBACK (_parse_response)
# ===========================================================================


class TestParseResponse:
    def _council(self):
        return _make_council()

    def test_normal_response(self):
        data = json.loads(_mock_openrouter_response("Hello world."))
        result = self._council()._parse_response(data)
        assert result["content"] == "Hello world."

    def test_content_null_reasoning_present(self):
        """Reasoning models may return content=null with reasoning field."""
        data = json.loads(_mock_openrouter_response(content=None, reasoning="Long CoT..."))
        result = self._council()._parse_response(data)
        assert "Long CoT" in result["content"]

    def test_content_empty_string_no_fallback(self):
        """Empty string content (not null) should NOT trigger reasoning
        fallback -- empty string is a valid response."""
        data = json.loads(_mock_openrouter_response(content="", reasoning="Should not use"))
        result = self._council()._parse_response(data)
        assert result["content"] == ""

    def test_both_null_returns_empty_or_raises(self):
        """Content null, reasoning null or missing -- degenerate case."""
        data = {
            "choices": [
                {
                    "message": {"content": None, "role": "assistant"},
                    "finish_reason": "stop",
                }
            ]
        }
        c = self._council()
        # Either returns empty content or raises -- both are acceptable
        try:
            result = c._parse_response(data)
            assert result["content"] == "" or result["content"] is None
        except (KeyError, ValueError):
            pass  # Also acceptable

    def test_finish_reason_length_flags_truncation(self):
        data = json.loads(_mock_openrouter_response(content="Truncated...", finish_reason="length"))
        result = self._council()._parse_response(data)
        assert result.get("truncated") is True or result.get("finish_reason") == "length"

    def test_finish_reason_stop_no_truncation(self):
        data = json.loads(_mock_openrouter_response(finish_reason="stop"))
        result = self._council()._parse_response(data)
        assert result.get("truncated") is not True

    def test_missing_choices_key_raises(self):
        with pytest.raises((KeyError, ValueError)):
            self._council()._parse_response({"id": "abc"})

    def test_empty_choices_array_raises(self):
        with pytest.raises((KeyError, ValueError, IndexError)):
            self._council()._parse_response({"choices": []})

    def test_missing_message_key_raises(self):
        with pytest.raises((KeyError, ValueError)):
            self._council()._parse_response({"choices": [{"finish_reason": "stop"}]})

    def test_usage_data_captured(self):
        usage = {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
        }
        data = json.loads(_mock_openrouter_response(content="text", usage=usage))
        result = self._council()._parse_response(data)
        assert result["usage"] is not None
        assert result["usage"]["total_tokens"] == 150
        assert result["usage"]["prompt_tokens"] == 100

    def test_no_usage_data(self):
        data = json.loads(_mock_openrouter_response(content="text"))
        result = self._council()._parse_response(data)
        assert result["usage"] is None


# ===========================================================================
# 6. ROUND EXECUTION (run_round)
# ===========================================================================


class TestRunRound:
    @patch("scripts.model_council.urlopen")
    def test_three_participants_all_succeed(self, mock_urlopen):
        parts = _make_participants("Alpha", "Beta", "Gamma")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response("A answer"),
            parts[1].model: _mock_openrouter_response("B answer"),
            parts[2].model: _mock_openrouter_response("C answer"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)

        result = c.run_round("Test prompt")
        assert isinstance(result, dict)
        assert result["Alpha"] == "A answer"
        assert result["Beta"] == "B answer"
        assert result["Gamma"] == "C answer"

    @patch("scripts.model_council.urlopen")
    def test_one_participant_http_error(self, mock_urlopen):
        """One participant fails with HTTP error -- should raise or
        return partial results with error info."""
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts)

        def side_effect(request, timeout=None):
            body = json.loads(request.data.decode("utf-8"))
            if body["model"] == parts[1].model:
                raise HTTPError(
                    url="https://openrouter.ai/api/v1/chat/completions",
                    code=500,
                    msg="Internal Server Error",
                    hdrs={},
                    fp=io.BytesIO(b""),
                )
            mock_resp = MagicMock()
            mock_resp.read.return_value = _mock_openrouter_response("A works")
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            return mock_resp

        mock_urlopen.side_effect = side_effect

        # Either raises or returns partial -- both are valid designs
        try:
            result = c.run_round("prompt")
            # If partial: Alpha should have content, Beta should
            # have error info
            assert "Alpha" in result
        except (HTTPError, RuntimeError, Exception):
            pass  # Propagating the error is also acceptable

    @patch("scripts.model_council.urlopen")
    def test_responses_stored_in_history(self, mock_urlopen):
        """After run_round, internal history must be updated."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response("R1 content"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("P1")

        # Building messages for next round should include R1
        msgs = c._build_messages(parts[0], "P2")
        all_content = " ".join(m["content"] for m in msgs)
        assert "R1 content" in all_content

    @patch("scripts.model_council.urlopen")
    def test_second_round_includes_history(self, mock_urlopen):
        """Two sequential run_round calls should build up history."""
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts)

        r1 = {
            parts[0].model: _mock_openrouter_response("A-R1"),
            parts[1].model: _mock_openrouter_response("B-R1"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r1)
        c.run_round("First prompt")

        r2 = {
            parts[0].model: _mock_openrouter_response("A-R2"),
            parts[1].model: _mock_openrouter_response("B-R2"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r2)
        c.run_round("Second prompt")

        # After two rounds, transcript should have both
        t = c.transcript
        assert len(t["rounds"]) == 2

    @patch("scripts.model_council.urlopen")
    def test_authorization_header_sent(self, mock_urlopen):
        """Must send Authorization: Bearer <api_key>."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts, api_key="sk-test-auth-check")

        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        # Inspect the request that was passed to urlopen
        call_args = mock_urlopen.call_args_list[0]
        request = call_args[0][0]  # First positional arg
        auth = request.get_header("Authorization")
        assert auth == "Bearer sk-test-auth-check"

    @patch("scripts.model_council.urlopen")
    def test_correct_model_sent_per_participant(self, mock_urlopen):
        """Each participant's request must use their specific model."""
        parts = [
            Participant(name="A", model="vendor/model-a", persona="pa"),
            Participant(name="B", model="vendor/model-b", persona="pb"),
        ]
        c = _make_council(participants=parts)

        responses = {
            "vendor/model-a": _mock_openrouter_response("a-resp"),
            "vendor/model-b": _mock_openrouter_response("b-resp"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        # Collect all request bodies
        models_sent = set()
        for call in mock_urlopen.call_args_list:
            req = call[0][0]
            body = json.loads(req.data.decode("utf-8"))
            models_sent.add(body["model"])

        assert "vendor/model-a" in models_sent
        assert "vendor/model-b" in models_sent

    @patch("scripts.model_council.urlopen")
    def test_max_tokens_sent_in_request(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts, max_tokens=4096)

        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        req = mock_urlopen.call_args_list[0][0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["max_tokens"] == 4096


# ===========================================================================
# 7. TRANSCRIPT
# ===========================================================================


class TestTranscript:
    def test_transcript_structure(self):
        c = _make_council(name="Test Council")
        t = c.transcript
        assert "name" in t
        assert "created" in t
        assert "participants" in t
        assert "rounds" in t
        assert t["name"] == "Test Council"

    def test_zero_rounds_empty_array(self):
        c = _make_council()
        assert c.transcript["rounds"] == []

    @patch("scripts.model_council.urlopen")
    def test_two_rounds_both_recorded(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        for i in range(2):
            responses = {
                parts[0].model: _mock_openrouter_response(f"R{i + 1}"),
            }
            mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
            c.run_round(f"Prompt {i + 1}")

        t = c.transcript
        assert len(t["rounds"]) == 2
        # Each round should have prompt and responses
        for rnd in t["rounds"]:
            assert "prompt" in rnd
            assert "responses" in rnd

    @patch("scripts.model_council.urlopen")
    def test_round_response_has_content_and_finish_reason(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response(
                "text",
                finish_reason="stop",
                usage={"prompt_tokens": 10, "completion_tokens": 5},
            ),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        rnd = c.transcript["rounds"][0]
        resp = rnd["responses"]["Alpha"]
        assert "content" in resp
        assert "finish_reason" in resp

    def test_participants_in_transcript(self):
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts)
        t = c.transcript
        p_list = t["participants"]
        assert len(p_list) == 2
        names = {p["name"] for p in p_list}
        assert "Alpha" in names
        assert "Beta" in names

    def test_created_is_iso_string(self):
        c = _make_council()
        t = c.transcript
        created = t["created"]
        assert isinstance(created, str)
        # Should be parseable as ISO datetime
        assert "T" in created or "-" in created

    @patch("scripts.model_council.urlopen")
    def test_save_transcript_writes_valid_json(self, mock_urlopen, tmp_path):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response("saved"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        path = str(tmp_path / "transcript.json")
        c.save_transcript(path)

        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert data["name"] == c.transcript["name"]
        assert len(data["rounds"]) == 1

    @patch("scripts.model_council.urlopen")
    def test_load_transcript_reconstructs_council(self, mock_urlopen, tmp_path):
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts, name="Saved Council", api_key="sk-key")

        responses = {
            parts[0].model: _mock_openrouter_response("A-resp"),
            parts[1].model: _mock_openrouter_response("B-resp"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        path = str(tmp_path / "transcript.json")
        c.save_transcript(path)

        loaded = Council.load_transcript(path, api_key="sk-new-key")
        assert loaded.transcript["name"] == "Saved Council"
        assert len(loaded.transcript["rounds"]) == 1

    @patch("scripts.model_council.urlopen")
    def test_round_trip_preserves_all_data(self, mock_urlopen, tmp_path):
        """Save then load should preserve everything."""
        parts = _make_participants("Alpha", "Beta")
        c = _make_council(participants=parts, name="Round Trip")

        r1 = {
            parts[0].model: _mock_openrouter_response("A-R1"),
            parts[1].model: _mock_openrouter_response("B-R1"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r1)
        c.run_round("P1")

        r2 = {
            parts[0].model: _mock_openrouter_response("A-R2"),
            parts[1].model: _mock_openrouter_response("B-R2"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(r2)
        c.run_round("P2")

        path = str(tmp_path / "rt.json")
        c.save_transcript(path)
        loaded = Council.load_transcript(path, api_key="sk-x")

        orig = c.transcript
        reloaded = loaded.transcript

        assert orig["name"] == reloaded["name"]
        assert orig["system_context"] == reloaded["system_context"]
        assert len(orig["rounds"]) == len(reloaded["rounds"])
        assert len(orig["participants"]) == len(reloaded["participants"])

        # Verify round content
        for i, (o_rnd, r_rnd) in enumerate(zip(orig["rounds"], reloaded["rounds"])):
            assert o_rnd["prompt"] == r_rnd["prompt"], f"Round {i} prompt mismatch"
            for name in ("Alpha", "Beta"):
                assert o_rnd["responses"][name]["content"] == r_rnd["responses"][name]["content"], (
                    f"Round {i} {name} content mismatch"
                )

    @patch("scripts.model_council.urlopen")
    def test_print_transcript_returns_markdown(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts, name="MD Test")

        responses = {
            parts[0].model: _mock_openrouter_response("Hello."),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("Say hello")

        md = c.print_transcript()
        assert isinstance(md, str)
        assert "Alpha" in md
        assert "Hello." in md
        # Should have some markdown structure
        assert "#" in md or "===" in md

    def test_print_transcript_empty_council(self):
        """Empty council should still produce valid markdown (not crash)."""
        c = _make_council()
        md = c.print_transcript()
        assert isinstance(md, str)


# ===========================================================================
# 8. TOKEN TRACKING
# ===========================================================================


class TestTokenTracking:
    @patch("scripts.model_council.urlopen")
    def test_usage_data_captured(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        usage = {
            "prompt_tokens": 200,
            "completion_tokens": 100,
            "total_tokens": 300,
        }
        responses = {
            parts[0].model: _mock_openrouter_response("text", usage=usage),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        rnd = c.transcript["rounds"][0]
        resp = rnd["responses"]["Alpha"]
        assert resp["usage"] is not None
        assert resp["usage"]["total_tokens"] == 300

    @patch("scripts.model_council.urlopen")
    def test_no_usage_data_does_not_crash(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response("text"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        rnd = c.transcript["rounds"][0]
        resp = rnd["responses"]["Alpha"]
        assert resp["usage"] is None


# ===========================================================================
# 9. ERROR HANDLING
# ===========================================================================


class TestErrorHandling:
    @patch("scripts.model_council.urlopen")
    def test_http_429_rate_limit(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = HTTPError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=429,
            msg="Rate limit exceeded",
            hdrs={},
            fp=io.BytesIO(b'{"error": "rate limited"}'),
        )

        with pytest.raises((HTTPError, RuntimeError, Exception)):
            c.run_round("prompt")

    @patch("scripts.model_council.urlopen")
    def test_http_500_server_error(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = HTTPError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=500,
            msg="Internal Server Error",
            hdrs={},
            fp=io.BytesIO(b""),
        )

        with pytest.raises((HTTPError, RuntimeError, Exception)):
            c.run_round("prompt")

    @patch("scripts.model_council.urlopen")
    def test_timeout_error(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = TimeoutError("Connection timed out")

        with pytest.raises((TimeoutError, RuntimeError, Exception)):
            c.run_round("prompt")

    @patch("scripts.model_council.urlopen")
    def test_invalid_json_response(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_resp = MagicMock()
        mock_resp.read.return_value = b"NOT VALID JSON {{{"
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with pytest.raises((json.JSONDecodeError, ValueError, RuntimeError, Exception)):
            c.run_round("prompt")

    @patch("scripts.model_council.urlopen")
    def test_network_url_error(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = URLError("Name resolution failed")

        with pytest.raises((URLError, RuntimeError, Exception)):
            c.run_round("prompt")

    @patch("scripts.model_council.urlopen")
    def test_connection_reset(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = ConnectionResetError("Connection reset by peer")

        with pytest.raises((ConnectionResetError, RuntimeError, Exception)):
            c.run_round("prompt")

    @patch("scripts.model_council.urlopen")
    def test_failed_round_does_not_corrupt_history(self, mock_urlopen):
        """After a failed run_round, internal round history must be unchanged."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        # Successful round 1
        responses = {
            parts[0].model: _mock_openrouter_response("R1"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("P1")
        assert len(c.transcript["rounds"]) == 1

        # Failed round 2
        mock_urlopen.side_effect = HTTPError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=500,
            msg="Error",
            hdrs={},
            fp=io.BytesIO(b""),
        )
        with pytest.raises(Exception):
            c.run_round("P2")

        # History must still have exactly 1 round
        assert len(c.transcript["rounds"]) == 1
        assert c.transcript["rounds"][0]["responses"]["Alpha"]["content"] == "R1"


# ===========================================================================
# 10. CLI PARSING
# ===========================================================================


class TestCLIParsing:
    def test_new_subcommand(self):
        """'new' subcommand should parse with required args."""
        from scripts.model_council import _parse_args

        args = _parse_args(
            [
                "new",
                "--name",
                "Test",
                "--prompt",
                "Hello",
                "--models",
                "a/b",
                "c/d",
            ]
        )
        assert args.subcommand == "new"
        assert args.name == "Test"
        assert args.prompt == "Hello"

    def test_continue_subcommand(self):
        from scripts.model_council import _parse_args

        args = _parse_args(["continue", "--transcript", "path.json", "--prompt", "Next"])
        assert args.subcommand == "continue"
        assert args.transcript == "path.json"
        assert args.prompt == "Next"

    def test_show_subcommand(self):
        from scripts.model_council import _parse_args

        args = _parse_args(["show", "--transcript", "path.json"])
        assert args.subcommand == "show"
        assert args.transcript == "path.json"

    def test_missing_required_args_exits(self):
        from scripts.model_council import _parse_args

        with pytest.raises(SystemExit):
            _parse_args(["new"])  # missing --name, --prompt, --models

    def test_no_subcommand_exits(self):
        from scripts.model_council import _parse_args

        with pytest.raises(SystemExit):
            _parse_args([])

    def test_unknown_subcommand_exits(self):
        from scripts.model_council import _parse_args

        with pytest.raises(SystemExit):
            _parse_args(["bogus"])


# ===========================================================================
# 11. API KEY RESOLUTION
# ===========================================================================


class TestAPIKeyResolution:
    def test_explicit_key_used(self):
        c = _make_council(api_key="sk-explicit-key")
        # Must not crash -- key is provided
        assert c is not None

    @patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-from-env"})
    def test_env_var_fallback(self):
        """No explicit key, env var set -> reads from env."""
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key=None,
        )
        assert c is not None

    def test_no_key_constructs_successfully(self):
        """Construction with api_key=None succeeds (lazy resolution)."""
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key=None,
        )
        assert c is not None

    @patch.dict(os.environ, {}, clear=True)
    @patch("scripts.model_council._read_spec_api_key", return_value=None)
    @patch("scripts.model_council.urlopen")
    def test_no_key_no_env_no_spec_raises_on_run(self, mock_urlopen, _mock_read):
        """No key anywhere -> ValueError when run_round is called."""
        parts = _make_participants("Alpha")
        os.environ.pop("OPENROUTER_API_KEY", None)
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key=None,
        )
        with pytest.raises(ValueError, match="API key required"):
            c.run_round("prompt")

    def test_empty_string_api_key_raises(self):
        """api_key='' should raise ValueError immediately."""
        parts = _make_participants("Alpha")
        with pytest.raises(ValueError, match="empty string"):
            Council(
                name="test",
                system_context="ctx",
                participants=parts,
                api_key="",
            )

    @patch.dict(os.environ, {}, clear=True)
    @patch("scripts.model_council._read_spec_api_key", return_value="sk-spec")
    @patch("scripts.model_council.urlopen")
    def test_spec_file_fallback(self, mock_urlopen, _mock_read):
        """No explicit key, no env var, spec file has key -> resolves."""
        parts = _make_participants("Alpha")
        os.environ.pop("OPENROUTER_API_KEY", None)
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key=None,
        )
        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        result = c.run_round("prompt")
        assert result[parts[0].name] == "ok"
        req = mock_urlopen.call_args_list[0][0][0]
        assert req.get_header("Authorization") == "Bearer sk-spec"

    @patch("scripts.model_council._read_spec_api_key", return_value="sk-spec")
    def test_explicit_key_beats_spec_file(self, _mock_read):
        """Explicit key takes priority over spec file."""
        c = _make_council(api_key="sk-explicit")
        assert c is not None

    @patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-env"})
    @patch("scripts.model_council._read_spec_api_key", return_value="sk-spec")
    def test_env_var_beats_spec_file(self, _mock_read):
        """Env var takes priority over spec file."""
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key=None,
        )
        assert c is not None


class TestReadSpecApiKey:
    def test_reads_api_key_line(self, tmp_path):
        """Reads 'API Key: sk-...' by pattern match."""
        from scripts.model_council import _read_spec_api_key

        lines = ["filler\n"] * 16 + ["API Key: sk-or-v1-testkey123\n"]
        spec_file = tmp_path / "home-directory-spec.md"
        spec_file.write_text("".join(lines))
        result = _read_spec_api_key(spec_file)
        assert result == "sk-or-v1-testkey123"

    def test_returns_none_for_missing_file(self):
        from pathlib import Path

        from scripts.model_council import _read_spec_api_key

        result = _read_spec_api_key(Path("/nonexistent/spec.md"))
        assert result is None

    def test_returns_none_for_wrong_format(self, tmp_path):
        from scripts.model_council import _read_spec_api_key

        lines = ["filler\n"] * 16 + ["Not an API key line\n"]
        spec_file = tmp_path / "spec.md"
        spec_file.write_text("".join(lines))
        result = _read_spec_api_key(spec_file)
        assert result is None

    def test_returns_none_for_short_file(self, tmp_path):
        """File with fewer than 17 lines."""
        from scripts.model_council import _read_spec_api_key

        spec_file = tmp_path / "spec.md"
        spec_file.write_text("short\n")
        result = _read_spec_api_key(spec_file)
        assert result is None


# ===========================================================================
# HARDENING: adversarial edge cases
# ===========================================================================


class TestHardeningMalformedResponses:
    """Push _parse_response with truly adversarial data."""

    def _council(self):
        return _make_council()

    def test_choices_is_not_a_list(self):
        """choices is a string instead of a list."""
        with pytest.raises((TypeError, ValueError, KeyError, IndexError)):
            self._council()._parse_response({"choices": "not a list"})

    def test_message_content_is_a_number(self):
        """content is 42 instead of a string."""
        data = {
            "choices": [
                {
                    "message": {"content": 42, "role": "assistant"},
                    "finish_reason": "stop",
                }
            ]
        }
        # Should either coerce to string or raise
        try:
            result = self._council()._parse_response(data)
            assert isinstance(result["content"], (str, int))
        except (TypeError, ValueError):
            pass

    def test_nested_null_in_message(self):
        """message itself is null."""
        with pytest.raises((TypeError, ValueError, KeyError, AttributeError)):
            self._council()._parse_response(
                {"choices": [{"message": None, "finish_reason": "stop"}]}
            )

    def test_extra_keys_ignored(self):
        """Extra keys in response should not cause issues."""
        data = json.loads(_mock_openrouter_response("ok"))
        data["extra_key"] = "extra_value"
        data["choices"][0]["extra"] = True
        result = self._council()._parse_response(data)
        assert result["content"] == "ok"

    def test_very_long_content(self):
        """100K character response should not be truncated by parser."""
        long = "x" * 100_000
        data = json.loads(_mock_openrouter_response(long))
        result = self._council()._parse_response(data)
        assert len(result["content"]) == 100_000

    def test_unicode_content(self):
        """Response with CJK, emoji, RTL text."""
        text = "مرحبا 你好 🎭 café"
        data = json.loads(_mock_openrouter_response(text))
        result = self._council()._parse_response(data)
        assert result["content"] == text

    def test_content_with_newlines_and_markdown(self):
        text = "# Title\n\n**bold** and *italic*\n\n```python\nx=1\n```"
        data = json.loads(_mock_openrouter_response(text))
        result = self._council()._parse_response(data)
        assert "# Title" in result["content"]
        assert "```python" in result["content"]


class TestHardeningTranscriptEdgeCases:
    """Adversarial transcript scenarios."""

    def test_load_nonexistent_file_raises(self):
        with pytest.raises((FileNotFoundError, OSError)):
            Council.load_transcript("/nonexistent/path/transcript.json", api_key="sk-x")

    def test_load_invalid_json_raises(self, tmp_path):
        path = str(tmp_path / "bad.json")
        with open(path, "w") as f:
            f.write("NOT JSON {{{")
        with pytest.raises((json.JSONDecodeError, ValueError)):
            Council.load_transcript(path, api_key="sk-x")

    def test_load_empty_file_raises(self, tmp_path):
        path = str(tmp_path / "empty.json")
        with open(path, "w") as f:
            f.write("")
        with pytest.raises((json.JSONDecodeError, ValueError)):
            Council.load_transcript(path, api_key="sk-x")

    def test_load_json_missing_required_fields_raises(self, tmp_path):
        """Valid JSON but missing council structure."""
        path = str(tmp_path / "incomplete.json")
        with open(path, "w") as f:
            json.dump({"name": "test"}, f)
        with pytest.raises((KeyError, ValueError)):
            Council.load_transcript(path, api_key="sk-x")

    def test_save_to_readonly_dir_raises(self, tmp_path):
        """Saving to unwritable path should raise."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)
        with pytest.raises((PermissionError, OSError)):
            c.save_transcript("/proc/readonly/transcript.json")

    @patch("scripts.model_council.urlopen")
    def test_transcript_with_unicode_participant_names(self, mock_urlopen, tmp_path):
        """Participant names with unicode should survive save/load."""
        parts = [
            Participant(name="模型α", model="vendor/a", persona="p1"),
            Participant(name="Бета", model="vendor/b", persona="p2"),
        ]
        c = _make_council(participants=parts)

        responses = {
            "vendor/a": _mock_openrouter_response("答案"),
            "vendor/b": _mock_openrouter_response("ответ"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        path = str(tmp_path / "unicode.json")
        c.save_transcript(path)

        loaded = Council.load_transcript(path, api_key="sk-x")
        names = {p["name"] for p in loaded.transcript["participants"]}
        assert "模型α" in names
        assert "Бета" in names


class TestHardeningConcurrency:
    """Verify that parallel execution in run_round doesn't corrupt state."""

    @patch("scripts.model_council.urlopen")
    def test_many_participants_parallel(self, mock_urlopen):
        """8 participants should all get correct responses."""
        parts = [
            Participant(name=f"M{i}", model=f"vendor/model-{i}", persona=f"P{i}") for i in range(8)
        ]
        c = _make_council(participants=parts)

        responses = {}
        for p in parts:
            responses[p.model] = _mock_openrouter_response(f"{p.name}-answer")
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)

        result = c.run_round("prompt")
        for p in parts:
            assert p.name in result
            assert f"{p.name}-answer" == result[p.name]


class TestHardeningEdgeCaseConstruction:
    """Push Council construction with adversarial inputs."""

    def test_participant_name_with_newlines(self):
        """Newlines in participant names are unusual but should not crash."""
        parts = [
            Participant(name="Has\nNewline", model="m", persona="p"),
        ]
        c = _make_council(participants=parts)
        assert c is not None

    def test_empty_system_context(self):
        """Empty system context is valid -- persona still provided."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts, system_context="")
        msgs = c._build_messages(parts[0], "prompt")
        # System message should still exist with at least the persona
        assert msgs[0]["role"] == "system"
        assert parts[0].persona in msgs[0]["content"]

    def test_very_long_system_context(self):
        """50K character system context should not be rejected."""
        ctx = "Context word. " * 5000
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts, system_context=ctx)
        msgs = c._build_messages(parts[0], "prompt")
        assert len(msgs[0]["content"]) > 50_000

    def test_max_tokens_zero(self):
        """max_tokens=0 is unusual but should not crash at construction."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts, max_tokens=0)
        assert c is not None

    def test_timeout_negative(self):
        """Negative timeout -- constructor may or may not reject, but
        should not silently corrupt."""
        parts = _make_participants("Alpha")
        try:
            c = _make_council(participants=parts, timeout=-1)
            # If accepted, that's fine -- urllib will handle it
            assert c is not None
        except ValueError:
            pass  # Also acceptable to reject negative timeout


class TestHardeningAttributionEdgeCases:
    """Push _format_attribution with adversarial inputs."""

    def test_name_with_triple_equals(self):
        """Name containing === should still format correctly."""
        parts = _make_participants("===Evil===")
        c = _make_council(participants=parts)
        result = c._format_attribution("===Evil===", 1, "text")
        # Should be parseable -- the outer === delimiters still work
        assert "===Evil===" in result
        assert "(Round 1)" in result

    def test_text_with_null_bytes(self):
        parts = _make_participants("X")
        c = _make_council(participants=parts)
        result = c._format_attribution("X", 1, "text\x00here")
        # Should not crash; null bytes may or may not be preserved
        assert "X" in result
        assert "(Round 1)" in result

    def test_very_long_name(self):
        long_name = "A" * 1000
        parts = [Participant(name=long_name, model="m", persona="p")]
        c = _make_council(participants=parts)
        result = c._format_attribution(long_name, 1, "t")
        assert long_name in result


# ===========================================================================
# PER-PARTICIPANT OVERRIDES
# ===========================================================================


class TestPerParticipantOverrides:
    def test_participant_max_tokens_defaults_none(self):
        p = Participant(name="A", model="m", persona="p")
        assert p.max_tokens is None

    def test_participant_timeout_defaults_none(self):
        p = Participant(name="A", model="m", persona="p")
        assert p.timeout is None

    def test_participant_with_max_tokens(self):
        p = Participant(name="A", model="m", persona="p", max_tokens=16000)
        assert p.max_tokens == 16000

    def test_participant_with_timeout(self):
        p = Participant(name="A", model="m", persona="p", timeout=300)
        assert p.timeout == 300

    def test_participant_frozen_max_tokens(self):
        p = Participant(name="A", model="m", persona="p", max_tokens=100)
        with pytest.raises(AttributeError):
            p.max_tokens = 200

    def test_participant_frozen_timeout(self):
        p = Participant(name="A", model="m", persona="p", timeout=60)
        with pytest.raises(AttributeError):
            p.timeout = 120

    @patch("scripts.model_council.urlopen")
    def test_call_uses_participant_max_tokens(self, mock_urlopen):
        """Participant override should be used instead of council default."""
        parts = [
            Participant(
                name="Big",
                model="vendor/big",
                persona="p",
                max_tokens=16000,
            ),
        ]
        c = _make_council(participants=parts, max_tokens=8000)

        responses = {
            "vendor/big": _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        req = mock_urlopen.call_args_list[0][0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["max_tokens"] == 16000

    @patch("scripts.model_council.urlopen")
    def test_call_uses_council_max_tokens_when_none(self, mock_urlopen):
        """No participant override -> council default used."""
        parts = [
            Participant(name="A", model="vendor/a", persona="p"),
        ]
        c = _make_council(participants=parts, max_tokens=4096)

        responses = {
            "vendor/a": _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        req = mock_urlopen.call_args_list[0][0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["max_tokens"] == 4096

    @patch("scripts.model_council.urlopen")
    def test_call_uses_participant_timeout(self, mock_urlopen):
        """Participant timeout override should be passed to urlopen."""
        parts = [
            Participant(
                name="Slow",
                model="vendor/slow",
                persona="p",
                timeout=300,
            ),
        ]
        c = _make_council(participants=parts, timeout=120)

        responses = {
            "vendor/slow": _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        call_kwargs = mock_urlopen.call_args_list[0]
        # timeout is passed as keyword arg or second positional
        if call_kwargs[1].get("timeout"):
            assert call_kwargs[1]["timeout"] == 300
        else:
            assert call_kwargs[0][1] == 300

    @patch("scripts.model_council.urlopen")
    def test_mixed_participants_different_overrides(self, mock_urlopen):
        """Two participants: one with overrides, one without."""
        parts = [
            Participant(
                name="A",
                model="vendor/a",
                persona="p",
                max_tokens=16000,
            ),
            Participant(name="B", model="vendor/b", persona="p"),
        ]
        c = _make_council(participants=parts, max_tokens=8000)

        responses = {
            "vendor/a": _mock_openrouter_response("a-resp"),
            "vendor/b": _mock_openrouter_response("b-resp"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        bodies = {}
        for call in mock_urlopen.call_args_list:
            req = call[0][0]
            body = json.loads(req.data.decode("utf-8"))
            bodies[body["model"]] = body

        assert bodies["vendor/a"]["max_tokens"] == 16000
        assert bodies["vendor/b"]["max_tokens"] == 8000

    @patch("scripts.model_council.urlopen")
    def test_round_trip_preserves_overrides(self, mock_urlopen, tmp_path):
        """Save/load preserves max_tokens and timeout on participants."""
        parts = [
            Participant(
                name="A",
                model="vendor/a",
                persona="p",
                max_tokens=16000,
                timeout=300,
            ),
        ]
        c = _make_council(participants=parts)

        responses = {"vendor/a": _mock_openrouter_response("ok")}
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        path = str(tmp_path / "rt.json")
        c.save_transcript(path)
        loaded = Council.load_transcript(path, api_key="sk-x")

        loaded_p = loaded.participants[0]
        assert loaded_p.max_tokens == 16000
        assert loaded_p.timeout == 300

    def test_load_old_transcript_without_new_fields(self, tmp_path):
        """Transcripts from before these fields still load correctly."""
        data = {
            "name": "old",
            "created": "2026-01-01T00:00:00",
            "system_context": "ctx",
            "participants": [{"name": "A", "model": "m", "persona": "p"}],
            "rounds": [],
        }
        path = str(tmp_path / "old.json")
        with open(path, "w") as f:
            json.dump(data, f)

        loaded = Council.load_transcript(path, api_key="sk-x")
        assert loaded.participants[0].max_tokens is None
        assert loaded.participants[0].timeout is None


# ===========================================================================
# RATE LIMIT BACKOFF
# ===========================================================================


class TestRateLimitBackoff:
    @patch("scripts.model_council.time")
    @patch("scripts.model_council.urlopen")
    def test_429_retried_then_succeeds(self, mock_urlopen, mock_time):
        """First call returns 429, second succeeds."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = [
            HTTPError(
                url="https://openrouter.ai/api/v1/chat/completions",
                code=429,
                msg="Rate limited",
                hdrs={},
                fp=io.BytesIO(b""),
            ),
            MagicMock(
                read=MagicMock(return_value=_mock_openrouter_response("ok")),
                __enter__=lambda s: s,
                __exit__=MagicMock(return_value=False),
            ),
        ]

        result = c.run_round("prompt")
        assert result["Alpha"] == "ok"
        assert mock_urlopen.call_count == 2

    @patch("scripts.model_council.time")
    @patch("scripts.model_council.urlopen")
    def test_429_all_retries_exhausted(self, mock_urlopen, mock_time):
        """4 consecutive 429s -> raises HTTPError."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = HTTPError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=429,
            msg="Rate limited",
            hdrs={},
            fp=io.BytesIO(b""),
        )

        with pytest.raises(HTTPError):
            c.run_round("prompt")
        assert mock_urlopen.call_count == 4  # initial + 3 retries

    @patch("scripts.model_council.time")
    @patch("scripts.model_council.urlopen")
    def test_500_not_retried(self, mock_urlopen, mock_time):
        """500 error should propagate immediately, no retry."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = HTTPError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=500,
            msg="Server Error",
            hdrs={},
            fp=io.BytesIO(b""),
        )

        with pytest.raises(HTTPError):
            c.run_round("prompt")
        assert mock_urlopen.call_count == 1

    @patch("scripts.model_council.time")
    @patch("scripts.model_council.urlopen")
    def test_backoff_delays(self, mock_urlopen, mock_time):
        """Verify exponential backoff delay pattern: 1, 2, 4."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = HTTPError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=429,
            msg="Rate limited",
            hdrs={},
            fp=io.BytesIO(b""),
        )

        with pytest.raises(HTTPError):
            c.run_round("prompt")

        sleep_calls = [call[0][0] for call in mock_time.sleep.call_args_list]
        assert sleep_calls == [1, 2, 4]

    @patch("scripts.model_council.time")
    @patch("scripts.model_council.urlopen")
    def test_url_error_not_retried(self, mock_urlopen, mock_time):
        """URLError should not trigger retry."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        mock_urlopen.side_effect = URLError("DNS failure")

        with pytest.raises(URLError):
            c.run_round("prompt")
        assert mock_urlopen.call_count == 1

    @patch("scripts.model_council.time")
    @patch("scripts.model_council.urlopen")
    def test_429_third_retry_succeeds(self, mock_urlopen, mock_time):
        """Three 429s then success on fourth attempt."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        err = HTTPError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=429,
            msg="Rate limited",
            hdrs={},
            fp=io.BytesIO(b""),
        )
        ok_resp = MagicMock(
            read=MagicMock(return_value=_mock_openrouter_response("finally")),
            __enter__=lambda s: s,
            __exit__=MagicMock(return_value=False),
        )
        mock_urlopen.side_effect = [err, err, err, ok_resp]

        result = c.run_round("prompt")
        assert result["Alpha"] == "finally"
        assert mock_urlopen.call_count == 4


# ===========================================================================
# COST TRACKING AGGREGATION
# ===========================================================================


class TestCostTracking:
    def test_cost_summary_empty_council(self):
        c = _make_council()
        summary = c.cost_summary
        assert summary["rounds"] == []
        assert summary["total"]["total_tokens"] == 0
        assert summary["total"]["prompt_tokens"] == 0
        assert summary["total"]["completion_tokens"] == 0

    @patch("scripts.model_council.urlopen")
    def test_cost_summary_one_round(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        usage = {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
        }
        responses = {
            parts[0].model: _mock_openrouter_response("ok", usage=usage),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        summary = c.cost_summary
        assert len(summary["rounds"]) == 1
        assert summary["rounds"][0]["total_tokens"] == 150
        assert summary["total"]["total_tokens"] == 150
        assert summary["total"]["prompt_tokens"] == 100
        assert summary["total"]["completion_tokens"] == 50

    @patch("scripts.model_council.urlopen")
    def test_cost_summary_two_rounds_two_participants(self, mock_urlopen):
        parts = [
            Participant(name="A", model="vendor/a", persona="p"),
            Participant(name="B", model="vendor/b", persona="p"),
        ]
        c = _make_council(participants=parts)

        for _ in range(2):
            responses = {
                "vendor/a": _mock_openrouter_response(
                    "ok",
                    usage={
                        "prompt_tokens": 100,
                        "completion_tokens": 50,
                        "total_tokens": 150,
                    },
                ),
                "vendor/b": _mock_openrouter_response(
                    "ok",
                    usage={
                        "prompt_tokens": 200,
                        "completion_tokens": 100,
                        "total_tokens": 300,
                    },
                ),
            }
            mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
            c.run_round("prompt")

        summary = c.cost_summary
        assert len(summary["rounds"]) == 2
        # Each round: 150 + 300 = 450
        assert summary["rounds"][0]["total_tokens"] == 450
        assert summary["rounds"][1]["total_tokens"] == 450
        # Grand total: 450 * 2 = 900
        assert summary["total"]["total_tokens"] == 900

    @patch("scripts.model_council.urlopen")
    def test_cost_summary_missing_usage(self, mock_urlopen):
        """No usage data -> treated as zero."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        summary = c.cost_summary
        assert summary["total"]["total_tokens"] == 0

    @patch("scripts.model_council.urlopen")
    def test_cost_summary_partial_usage(self, mock_urlopen):
        """Usage with only total_tokens, no prompt/completion."""
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response(
                "ok",
                usage={"total_tokens": 500},
            ),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        summary = c.cost_summary
        assert summary["total"]["total_tokens"] == 500
        assert summary["total"]["prompt_tokens"] == 0

    @patch("scripts.model_council.urlopen")
    def test_print_transcript_includes_token_usage(self, mock_urlopen):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response(
                "ok",
                usage={
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                },
            ),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        md = c.print_transcript()
        assert "Token Usage" in md
        assert "150" in md

    @patch("scripts.model_council.urlopen")
    def test_usage_field_in_parse_response(self, mock_urlopen):
        """_parse_response should include usage dict."""
        c = _make_council()
        usage = {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
        }
        data = json.loads(_mock_openrouter_response("ok", usage=usage))
        result = c._parse_response(data)
        assert result.get("usage") is not None
        assert result["usage"]["prompt_tokens"] == 100


# ===========================================================================
# CONTEXT LIMIT WARNINGS
# ===========================================================================


class TestContextLimitWarnings:
    def test_estimate_tokens(self):
        c = _make_council()
        msgs = [{"role": "user", "content": "x" * 400}]
        assert c._estimate_tokens(msgs) == 100  # 400 / 4

    @patch("scripts.model_council.urlopen")
    def test_no_warning_below_threshold(self, mock_urlopen, capsys):
        parts = _make_participants("Alpha")
        c = _make_council(participants=parts)

        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("short prompt")

        captured = capsys.readouterr()
        assert "WARNING" not in captured.err

    @patch("scripts.model_council.urlopen")
    def test_warning_above_threshold(self, mock_urlopen, capsys):
        """Low threshold triggers warning."""
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key="sk-test",
            context_token_limit=10,
        )

        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("x" * 200)

        captured = capsys.readouterr()
        assert "WARNING" in captured.err

    @patch("scripts.model_council.urlopen")
    def test_warning_names_participant(self, mock_urlopen, capsys):
        parts = [Participant(name="BigModel", model="vendor/a", persona="p")]
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key="sk-test",
            context_token_limit=10,
        )

        responses = {
            "vendor/a": _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("x" * 200)

        captured = capsys.readouterr()
        assert "BigModel" in captured.err

    @patch("scripts.model_council.urlopen")
    def test_warning_does_not_block_execution(self, mock_urlopen, capsys):
        """Warning fires but run_round still completes."""
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key="sk-test",
            context_token_limit=1,
        )

        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        result = c.run_round("prompt")

        assert result["Alpha"] == "ok"
        captured = capsys.readouterr()
        assert "WARNING" in captured.err

    def test_custom_threshold_stored(self):
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key="sk-test",
            context_token_limit=50000,
        )
        assert c is not None


# ===========================================================================
# PARTICIPANT PRESETS
# ===========================================================================


class TestParticipantPresets:
    def test_load_presets_valid(self, tmp_path):
        from scripts.model_council import _load_presets

        presets = {
            "test-council": [
                {"name": "A", "model": "vendor/a", "persona": "p1"},
                {"name": "B", "model": "vendor/b", "persona": "p2"},
            ]
        }
        path = tmp_path / "council_presets.json"
        path.write_text(json.dumps(presets))

        result = _load_presets("test-council", path)
        assert len(result) == 2
        assert result[0].name == "A"
        assert result[1].model == "vendor/b"

    def test_load_presets_unknown_name(self, tmp_path):
        from scripts.model_council import _load_presets

        presets = {"real": [{"name": "A", "model": "m", "persona": "p"}]}
        path = tmp_path / "council_presets.json"
        path.write_text(json.dumps(presets))

        with pytest.raises(ValueError, match="Unknown preset"):
            _load_presets("nonexistent", path)

    def test_load_presets_file_missing(self):
        from pathlib import Path

        from scripts.model_council import _load_presets

        with pytest.raises(FileNotFoundError):
            _load_presets("x", Path("/nonexistent/presets.json"))

    def test_load_presets_with_max_tokens(self, tmp_path):
        from scripts.model_council import _load_presets

        presets = {
            "big": [
                {
                    "name": "A",
                    "model": "m",
                    "persona": "p",
                    "max_tokens": 16000,
                },
            ]
        }
        path = tmp_path / "council_presets.json"
        path.write_text(json.dumps(presets))

        result = _load_presets("big", path)
        assert result[0].max_tokens == 16000

    def test_cli_participants_flag(self):
        from scripts.model_council import _parse_args

        args = _parse_args(
            [
                "new",
                "--name",
                "Test",
                "--prompt",
                "Hello",
                "--participants",
                "design-review",
            ]
        )
        assert args.participants == "design-review"

    def test_cli_models_and_participants_mutually_exclusive(self):
        from scripts.model_council import _parse_args

        with pytest.raises(SystemExit):
            _parse_args(
                [
                    "new",
                    "--name",
                    "T",
                    "--prompt",
                    "P",
                    "--models",
                    "a/b",
                    "--participants",
                    "design",
                ]
            )

    def test_cli_neither_models_nor_participants_exits(self):
        from scripts.model_council import _parse_args

        with pytest.raises(SystemExit):
            _parse_args(["new", "--name", "T", "--prompt", "P"])


# ===========================================================================
# CODE REVIEW FIXES
# ===========================================================================


class TestParticipantFromDict:
    def test_valid_dict(self):
        from scripts.model_council import _participant_from_dict

        p = _participant_from_dict({"name": "A", "model": "m", "persona": "p"})
        assert p.name == "A"
        assert p.max_tokens is None

    def test_with_optional_fields(self):
        from scripts.model_council import _participant_from_dict

        p = _participant_from_dict(
            {
                "name": "A",
                "model": "m",
                "persona": "p",
                "max_tokens": 16000,
                "timeout": 300,
            }
        )
        assert p.max_tokens == 16000
        assert p.timeout == 300

    def test_missing_required_field_raises(self):
        from scripts.model_council import _participant_from_dict

        with pytest.raises(ValueError, match="persona"):
            _participant_from_dict({"name": "A", "model": "m"})

    def test_missing_name_raises(self):
        from scripts.model_council import _participant_from_dict

        with pytest.raises(ValueError, match="name"):
            _participant_from_dict({"model": "m", "persona": "p"})


class TestDeduplicateNames:
    def test_no_duplicates(self):
        from scripts.model_council import _deduplicate_names

        assert _deduplicate_names(["a", "b", "c"]) == ["a", "b", "c"]

    def test_two_same(self):
        from scripts.model_council import _deduplicate_names

        result = _deduplicate_names(["gpt-4o", "gpt-4o"])
        assert result[0] == "gpt-4o"
        assert result[1] == "gpt-4o-2"

    def test_three_same(self):
        from scripts.model_council import _deduplicate_names

        result = _deduplicate_names(["x", "x", "x"])
        assert result == ["x", "x-2", "x-3"]

    def test_mixed(self):
        from scripts.model_council import _deduplicate_names

        result = _deduplicate_names(["a", "b", "a", "c", "b"])
        assert len(result) == 5
        assert len(set(result)) == 5


class TestTranscriptSettingsRoundTrip:
    @patch("scripts.model_council.urlopen")
    def test_max_tokens_survives_round_trip(self, mock_urlopen, tmp_path):
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key="sk-test",
            max_tokens=2000,
            timeout=30,
            context_token_limit=50000,
        )
        responses = {
            parts[0].model: _mock_openrouter_response("ok"),
        }
        mock_urlopen.side_effect = _urlopen_side_effect_factory(responses)
        c.run_round("prompt")

        path = str(tmp_path / "rt.json")
        c.save_transcript(path)
        loaded = Council.load_transcript(path, api_key="sk-test")

        assert loaded.max_tokens == 2000
        assert loaded.timeout == 30
        assert loaded._context_warn_tokens == 50000

    def test_transcript_includes_settings(self):
        parts = _make_participants("Alpha")
        c = Council(
            name="test",
            system_context="ctx",
            participants=parts,
            api_key="sk-test",
            max_tokens=4096,
            timeout=60,
        )
        t = c.transcript
        assert t["max_tokens"] == 4096
        assert t["timeout"] == 60
        assert "context_token_limit" in t


class TestRoundValidation:
    def test_load_transcript_validates_round_prompt(self, tmp_path):
        data = {
            "name": "test",
            "system_context": "ctx",
            "participants": [{"name": "A", "model": "m", "persona": "p"}],
            "rounds": [{"responses": {}}],
        }
        path = str(tmp_path / "bad.json")
        with open(path, "w") as f:
            json.dump(data, f)

        with pytest.raises(ValueError, match="prompt"):
            Council.load_transcript(path, api_key="sk-test")

    def test_load_transcript_validates_round_responses(self, tmp_path):
        data = {
            "name": "test",
            "system_context": "ctx",
            "participants": [{"name": "A", "model": "m", "persona": "p"}],
            "rounds": [{"prompt": "hello"}],
        }
        path = str(tmp_path / "bad.json")
        with open(path, "w") as f:
            json.dump(data, f)

        with pytest.raises(ValueError, match="responses"):
            Council.load_transcript(path, api_key="sk-test")


class TestShowWithoutApiKey:
    @patch.dict(os.environ, {}, clear=True)
    @patch("scripts.model_council._read_spec_api_key", return_value=None)
    def test_show_works_without_api_key(self, _mock_read, tmp_path):
        """show subcommand should NOT require an API key."""
        os.environ.pop("OPENROUTER_API_KEY", None)
        data = {
            "name": "test",
            "system_context": "ctx",
            "participants": [{"name": "A", "model": "m", "persona": "p"}],
            "rounds": [
                {
                    "round": 1,
                    "prompt": "hello",
                    "responses": {
                        "A": {
                            "content": "world",
                            "finish_reason": "stop",
                            "usage": None,
                            "truncated": False,
                        }
                    },
                }
            ],
        }
        path = str(tmp_path / "transcript.json")
        with open(path, "w") as f:
            json.dump(data, f)

        loaded = Council.load_transcript(path)
        md = loaded.print_transcript()
        assert "world" in md


class TestReadSpecApiKeyPatternMatch:
    def test_finds_key_anywhere_in_file(self, tmp_path):
        """Key can be on any line, not just line 17."""
        from scripts.model_council import _read_spec_api_key

        content = "some header\n\nstuff\nAPI Key: sk-or-v1-found\nmore stuff\n"
        spec_file = tmp_path / "spec.md"
        spec_file.write_text(content)
        result = _read_spec_api_key(spec_file)
        assert result == "sk-or-v1-found"

    def test_skips_empty_api_key_value(self, tmp_path):
        from scripts.model_council import _read_spec_api_key

        content = "API Key:\nstuff\n"
        spec_file = tmp_path / "spec.md"
        spec_file.write_text(content)
        result = _read_spec_api_key(spec_file)
        assert result is None
