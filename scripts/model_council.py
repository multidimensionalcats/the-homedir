"""Multi-model discussion framework via OpenRouter chat completions API.

Usage:
    # Start a council using a preset (design-review, code-review,
    # quote-curation, narrative-review):
    python scripts/model_council.py new \\
        --participants narrative-review \\
        --name "my-review" \\
        --context "Review this design for..." \\
        --prompt "What works and what doesn't?"

    # Start a council with explicit model IDs:
    python scripts/model_council.py new \\
        --models deepseek/deepseek-r1 google/gemini-2.5-pro \\
        --name "quick-debate" \\
        --prompt "Is static typing worth the cost?"

    # Add another round to an existing council:
    python scripts/model_council.py continue \\
        --transcript council-my-review.json \\
        --prompt "Respond to each other's critiques."

    # View a saved transcript:
    python scripts/model_council.py show \\
        --transcript council-my-review.json

API key resolved from (in priority order):
    1. --api-key flag
    2. OPENROUTER_API_KEY environment variable
    3. home-directory-spec.md (pattern match for 'API Key: ...')
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_CONTEXT_WARN_TOKENS = 100_000
CHARS_PER_TOKEN_ESTIMATE = 4


def _read_spec_api_key(spec_path: Path | None = None) -> str | None:
    """Read OpenRouter API key from home-directory-spec.md by pattern match."""
    if spec_path is None:
        spec_path = Path(__file__).resolve().parent.parent / "home-directory-spec.md"
    try:
        for line in spec_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("API Key:"):
                key = stripped.split(":", 1)[1].strip()
                if key:
                    return key
    except OSError:
        pass
    return None


def _participant_from_dict(d: dict) -> Participant:
    """Construct a Participant from a dict (transcript or preset JSON)."""
    for field in ("name", "model", "persona"):
        if field not in d:
            raise ValueError(f"Participant dict missing required field: {field}")
    for field in ("name", "model", "persona"):
        if not isinstance(d[field], str):
            raise TypeError(
                f"Participant field '{field}' must be a string, got {type(d[field]).__name__}"
            )
    if d.get("max_tokens") is not None and (
        isinstance(d["max_tokens"], bool) or not isinstance(d["max_tokens"], int)
    ):
        raise TypeError(
            f"Participant field 'max_tokens' must be an int, got {type(d['max_tokens']).__name__}"
        )
    if d.get("timeout") is not None and (
        isinstance(d["timeout"], bool) or not isinstance(d["timeout"], int)
    ):
        raise TypeError(
            f"Participant field 'timeout' must be an int, got {type(d['timeout']).__name__}"
        )
    return Participant(
        name=d["name"],
        model=d["model"],
        persona=d["persona"],
        max_tokens=d.get("max_tokens"),
        timeout=d.get("timeout"),
    )


@dataclass(frozen=True)
class Participant:
    name: str
    model: str
    persona: str
    max_tokens: int | None = None
    timeout: int | None = None


class Council:
    """Manages a multi-model discussion with stateful round history."""

    def __init__(
        self,
        name: str,
        system_context: str,
        participants: list[Participant],
        api_key: str | None = None,
        max_tokens: int = 8000,
        timeout: int = 120,
        context_token_limit: int = DEFAULT_CONTEXT_WARN_TOKENS,
    ):
        if not participants:
            raise ValueError("At least one participant required")

        seen: set[str] = set()
        for p in participants:
            if p.name in seen:
                raise ValueError(f"Duplicate participant name: {p.name}")
            seen.add(p.name)

        if api_key is not None and not api_key:
            raise ValueError("api_key must not be empty string")

        self.name = name
        self.system_context = system_context
        self.participants = list(participants)
        self._api_key = api_key
        self.max_tokens = max_tokens
        self.timeout = timeout
        self._context_warn_tokens = context_token_limit
        self._created = datetime.datetime.now(datetime.UTC).isoformat()
        self._rounds: list[dict] = []

    def _resolve_api_key(self) -> str:
        """Resolve API key lazily: explicit > env > spec file."""
        if self._api_key:
            return self._api_key
        key = os.environ.get("OPENROUTER_API_KEY")
        if key:
            return key
        key = _read_spec_api_key()
        if key:
            return key
        raise ValueError(
            "API key required: pass api_key, set OPENROUTER_API_KEY,"
            " or add to home-directory-spec.md"
        )

    def _format_attribution(self, name: str, round_num: int, text: str) -> str:
        return f"=== {name} (Round {round_num}) ===\n{text}"

    def _build_messages(self, participant: Participant, round_prompt: str) -> list[dict]:
        messages: list[dict] = [
            {
                "role": "system",
                "content": (self.system_context + "\n\nYour persona: " + participant.persona),
            }
        ]

        for i, rnd in enumerate(self._rounds):
            user_content = rnd["prompt"]
            if i > 0:
                prev_round = self._rounds[i - 1]
                others_text = self._collect_others(participant.name, prev_round, i)
                if others_text:
                    user_content += "\n\n" + others_text
            messages.append({"role": "user", "content": user_content})

            this_response = rnd["responses"].get(participant.name, {})
            messages.append({"role": "assistant", "content": this_response.get("content", "")})

        final_user = round_prompt
        if self._rounds:
            last_round = self._rounds[-1]
            last_round_num = len(self._rounds)
            others_text = self._collect_others(participant.name, last_round, last_round_num)
            if others_text:
                final_user += "\n\n" + others_text
        messages.append({"role": "user", "content": final_user})

        return messages

    def _collect_others(self, exclude_name: str, rnd: dict, round_num: int) -> str:
        parts: list[str] = []
        for p in self.participants:
            if p.name == exclude_name:
                continue
            resp = rnd["responses"].get(p.name, {})
            content = resp.get("content", "")
            if content:
                parts.append(self._format_attribution(p.name, round_num, content))
        return "\n\n".join(parts)

    def _parse_response(self, response_data: dict) -> dict:
        """Parse an OpenRouter API response dict."""
        choices = response_data.get("choices")
        if not choices or not isinstance(choices, list):
            raise ValueError("Response missing 'choices' or choices is empty")

        first_choice = choices[0]
        message = first_choice.get("message")
        if message is None:
            raise ValueError("Response missing 'message' in first choice")

        content = message.get("content")
        if content is None:
            content = message.get("reasoning")
        if content is None:
            content = ""

        finish_reason = first_choice.get("finish_reason", "")
        truncated = finish_reason == "length"

        raw_usage = response_data.get("usage") or {}
        usage = (
            {
                "prompt_tokens": raw_usage.get("prompt_tokens"),
                "completion_tokens": raw_usage.get("completion_tokens"),
                "total_tokens": raw_usage.get("total_tokens"),
            }
            if raw_usage
            else None
        )

        return {
            "content": content,
            "finish_reason": finish_reason,
            "truncated": truncated,
            "usage": usage,
        }

    def _call_participant(self, participant: Participant, messages: list[dict]) -> dict:
        api_key = self._resolve_api_key()
        effective_max_tokens = (
            participant.max_tokens if participant.max_tokens is not None else self.max_tokens
        )
        effective_timeout = participant.timeout if participant.timeout is not None else self.timeout

        body = json.dumps(
            {
                "model": participant.model,
                "messages": messages,
                "max_tokens": effective_max_tokens,
            }
        ).encode()

        req = Request(  # noqa: S310
            OPENROUTER_API_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

        max_retries = 3
        delays = [1, 2, 4]
        for attempt in range(max_retries + 1):
            try:
                with urlopen(req, timeout=effective_timeout) as resp:  # noqa: S310
                    data = json.loads(resp.read().decode())
                return self._parse_response(data)
            except HTTPError as e:
                if e.code == 429 and attempt < max_retries:
                    time.sleep(delays[attempt])
                    continue
                raise
        raise RuntimeError("Unreachable: retry loop exited without return or raise")

    def _estimate_tokens(self, messages: list[dict]) -> int:
        total_chars = sum(len(m.get("content", "")) for m in messages)
        return total_chars // CHARS_PER_TOKEN_ESTIMATE

    def run_round(self, prompt: str) -> dict[str, str]:
        """Send prompt to all participants in parallel, return name->content."""
        messages_map: dict[str, list[dict]] = {}
        for p in self.participants:
            msgs = self._build_messages(p, prompt)
            messages_map[p.name] = msgs
            estimated = self._estimate_tokens(msgs)
            if estimated > self._context_warn_tokens:
                print(
                    f"WARNING: {p.name} context ~{estimated} tokens"
                    f" (limit: {self._context_warn_tokens})",
                    file=sys.stderr,
                )

        results: dict[str, dict] = {}

        def _call(participant: Participant) -> tuple[str, dict]:
            return (
                participant.name,
                self._call_participant(participant, messages_map[participant.name]),
            )

        with ThreadPoolExecutor(max_workers=len(self.participants)) as pool:
            futures = [pool.submit(_call, p) for p in self.participants]
            for fut in futures:
                name, parsed = fut.result()
                results[name] = parsed

        self._rounds.append(
            {
                "round": len(self._rounds) + 1,
                "prompt": prompt,
                "responses": results,
            }
        )

        return {name: parsed["content"] for name, parsed in results.items()}

    @property
    def cost_summary(self) -> dict:
        """Aggregate token usage per round and total."""
        rounds_summary: list[dict] = []
        grand_total = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }
        for rnd in self._rounds:
            round_total = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            }
            for _name, resp in rnd["responses"].items():
                usage = resp.get("usage")
                if usage:
                    for k in round_total:
                        round_total[k] += usage.get(k) or 0
                        grand_total[k] += usage.get(k) or 0
            rounds_summary.append({"round": rnd["round"], **round_total})
        return {"rounds": rounds_summary, "total": grand_total}

    @property
    def transcript(self) -> dict:
        return {
            "name": self.name,
            "created": self._created,
            "system_context": self.system_context,
            "max_tokens": self.max_tokens,
            "timeout": self.timeout,
            "context_token_limit": self._context_warn_tokens,
            "participants": [asdict(p) for p in self.participants],
            "rounds": self._rounds,
        }

    def save_transcript(self, path: str) -> None:
        """Write transcript JSON to the given path."""
        Path(path).write_text(
            json.dumps(self.transcript, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load_transcript(cls, path: str, api_key: str | None = None) -> Council:
        """Reconstruct a Council from a saved transcript JSON file."""
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Transcript not found: {path}")

        data = json.loads(p.read_text(encoding="utf-8"))

        if "participants" not in data:
            raise ValueError("Transcript missing required field: participants")
        if "rounds" not in data:
            raise ValueError("Transcript missing required field: rounds")

        participants = [_participant_from_dict(pd) for pd in data["participants"]]

        for i, rnd in enumerate(data["rounds"]):
            if "prompt" not in rnd:
                raise ValueError(f"Round {i + 1} missing required field: prompt")
            if "responses" not in rnd:
                raise ValueError(f"Round {i + 1} missing required field: responses")

        council = cls(
            name=data.get("name", ""),
            system_context=data.get("system_context", ""),
            participants=participants,
            api_key=api_key,
            max_tokens=data.get("max_tokens", 8000),
            timeout=data.get("timeout", 120),
            context_token_limit=data.get("context_token_limit", DEFAULT_CONTEXT_WARN_TOKENS),
        )
        council._created = data.get("created", council._created)
        council._rounds = data["rounds"]
        return council

    def print_transcript(self) -> str:
        """Return a formatted markdown string of the full transcript."""
        lines: list[str] = [f"# {self.name}", ""]
        names = ", ".join(p.name for p in self.participants)
        lines.append(f"**Participants:** {names}")
        lines.append("")

        for rnd in self._rounds:
            lines.append(f"## Round {rnd['round']}")
            lines.append("")
            lines.append(f"**Prompt:** {rnd['prompt']}")
            lines.append("")

            for p in self.participants:
                resp = rnd["responses"].get(p.name, {})
                content = resp.get("content", "")
                lines.append(f"### {p.name}")
                lines.append("")
                lines.append(content)
                lines.append("")

        if self._rounds:
            summary = self.cost_summary
            lines.append("## Token Usage")
            lines.append("")
            for r in summary["rounds"]:
                lines.append(
                    f"- Round {r['round']}: {r['total_tokens']} tokens"
                    f" ({r['prompt_tokens']} prompt"
                    f" + {r['completion_tokens']} completion)"
                )
            lines.append("")
            total = summary["total"]
            lines.append(
                f"**Total: {total['total_tokens']} tokens"
                f" ({total['prompt_tokens']} prompt"
                f" + {total['completion_tokens']} completion)**"
            )
            lines.append("")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _deduplicate_names(names: list[str]) -> list[str]:
    """Append random hex suffixes to make duplicate names unique."""
    seen_counts: dict[str, int] = {}
    all_names: set[str] = set()
    result: list[str] = []
    for name in names:
        seen_counts[name] = seen_counts.get(name, 0) + 1
        if seen_counts[name] == 1:
            all_names.add(name)
            result.append(name)
        else:
            for _ in range(100):
                unique = f"{name}-{os.urandom(3).hex()}"
                if unique not in all_names:
                    break
            else:
                raise RuntimeError(f"Failed to generate unique name for '{name}'")
            all_names.add(unique)
            result.append(unique)
    return result


_EPILOG = """\
examples:
  %(prog)s new --participants design-review --name my-review \\
      --prompt "Evaluate this architecture."
  %(prog)s new --models deepseek/deepseek-r1 google/gemini-2.5-pro \\
      --name debate --prompt "Is TDD always worth it?"
  %(prog)s continue --transcript council-my-review.json \\
      --prompt "Respond to each other."
  %(prog)s show --transcript council-my-review.json

presets (--participants):
  design-review, code-review, quote-curation, narrative-review
"""


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Multi-model discussion framework via OpenRouter.",
        epilog=_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # new
    new_parser = subparsers.add_parser("new", help="Start a new council")
    new_parser.add_argument("--name", required=True, help="Council name")
    new_parser.add_argument("--prompt", required=True, help="Initial prompt")
    group = new_parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--models",
        nargs="+",
        help="Model IDs (e.g. deepseek/deepseek-r1)",
    )
    group.add_argument(
        "--participants",
        help="Preset name from council_presets.json",
    )
    new_parser.add_argument("--context", default="", help="Shared system context")
    new_parser.add_argument("--api-key", default=None, help="OpenRouter API key")
    new_parser.add_argument(
        "--max-tokens",
        type=int,
        default=8000,
        help="Max tokens per response",
    )

    # continue
    cont_parser = subparsers.add_parser("continue", help="Continue an existing council")
    cont_parser.add_argument("--transcript", required=True, help="Path to transcript JSON")
    cont_parser.add_argument("--prompt", required=True, help="Next round prompt")
    cont_parser.add_argument("--api-key", default=None, help="OpenRouter API key")

    # show
    show_parser = subparsers.add_parser("show", help="Print a transcript")
    show_parser.add_argument("--transcript", required=True, help="Path to transcript JSON")

    return parser.parse_args(argv)


def _load_presets(
    preset_name: str,
    presets_path: Path | None = None,
) -> list[Participant]:
    """Load participant presets from a JSON config file."""
    if presets_path is None:
        presets_path = Path(__file__).resolve().parent / "council_presets.json"
    if not presets_path.exists():
        raise FileNotFoundError(f"Presets file not found: {presets_path}")
    data = json.loads(presets_path.read_text(encoding="utf-8"))
    if preset_name not in data:
        available = ", ".join(sorted(data.keys()))
        raise ValueError(f"Unknown preset: {preset_name}. Available: {available}")
    return [_participant_from_dict(p) for p in data[preset_name]]


def main(argv: list[str] | None = None) -> None:
    if argv is None:
        argv = sys.argv[1:]

    args = _parse_args(argv)

    if args.subcommand == "new":
        if args.participants:
            participants = _load_presets(args.participants)
        else:
            raw_names = [m.split("/")[-1] for m in args.models]
            unique_names = _deduplicate_names(raw_names)
            participants = [
                Participant(
                    name=name,
                    model=model_id,
                    persona="Provide thoughtful analysis.",
                )
                for name, model_id in zip(unique_names, args.models, strict=True)
            ]
        council = Council(
            name=args.name,
            system_context=args.context,
            participants=participants,
            api_key=args.api_key,
            max_tokens=args.max_tokens,
        )
        council.run_round(args.prompt)
        out_path = f"council-{args.name}.json"
        council.save_transcript(out_path)
        print(f"Transcript saved to {out_path}")
        print(council.print_transcript())

    elif args.subcommand == "continue":
        council = Council.load_transcript(args.transcript, api_key=args.api_key)
        council.run_round(args.prompt)
        council.save_transcript(args.transcript)
        print(f"Transcript updated: {args.transcript}")
        print(council.print_transcript())

    elif args.subcommand == "show":
        council = Council.load_transcript(args.transcript)
        print(council.print_transcript())


if __name__ == "__main__":
    main()
