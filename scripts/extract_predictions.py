"""Extract structured prediction data from prediction markdown files."""

from __future__ import annotations

import datetime
import hashlib
import re
from pathlib import Path

import psycopg

from scripts.extract_sessions import _sanitize_string


# ---------------------------------------------------------------------------
# Confidence parsing
# ---------------------------------------------------------------------------

# Match patterns like ~60%, 70%, ~85%
_PERCENTAGE_RE = re.compile(r"~?(-?\d+(?:\.\d+)?)%")


def parse_confidence(text: str) -> float | None:
    """Extract a confidence value (0-1 float) from prediction text.

    Handles:
    - ``Probability: ~60%`` -> 0.6
    - ``Probability I'd put on this: ~60%`` -> 0.6
    - ``70%`` -> 0.7
    - ``~85%`` -> 0.85
    - No percentage -> None
    - Out-of-range (>100%, <0%) -> None
    """
    if not text:
        return None

    match = _PERCENTAGE_RE.search(text)
    if not match:
        return None

    value = float(match.group(1))
    if value < 0 or value > 100:
        return None

    return value / 100.0


# ---------------------------------------------------------------------------
# Verification date parsing
# ---------------------------------------------------------------------------

_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def parse_verification_date(text: str) -> datetime.date | None:
    """Extract the first valid date from verification text.

    Handles:
    - ``By 2026-05-10. Check: something`` -> date(2026, 5, 10)
    - ``By 2026-05-05`` -> date(2026, 5, 5)
    - No date -> None
    - Invalid date -> None
    """
    if not text:
        return None

    match = _DATE_RE.search(text)
    if not match:
        return None

    try:
        return datetime.date.fromisoformat(match.group(1))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Prediction file parsing
# ---------------------------------------------------------------------------

# Match section headers like "## 1. Title text" or "## 2. Another title"
_SECTION_HEADER_RE = re.compile(r"^##\s+\d+\.\s+(.+)$", re.MULTILINE)

# Match the date from filename like "2026-04-20.md"
_FILENAME_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})\.md$")

# Match the date from header like "# Predictions — 2026-04-20 evening session"
_HEADER_DATE_RE = re.compile(r"#\s+Predictions\s*[—–-]\s*(\d{4}-\d{2}-\d{2})")

# Match field lines
_PREDICTION_LINE_RE = re.compile(r"\*\*Prediction:\*\*\s*(.*)", re.DOTALL)
_VERIFICATION_LINE_RE = re.compile(r"\*\*Verification:\*\*\s*(.*)")
_OUTCOME_LINE_RE = re.compile(r"\*\*Outcome:\*\*\s*(.*)")
_RESOLUTION_LINE_RE = re.compile(r"\*\*Resolution:\*\*\s*(.*)")
_HOW_WRONG_LINE_RE = re.compile(r"\*\*How I'm wrong if:\*\*\s*(.*)")


def _extract_date_from_filename(filepath: Path) -> datetime.date | None:
    """Extract date from a filename like 2026-04-20.md."""
    match = _FILENAME_DATE_RE.search(filepath.name)
    if match:
        try:
            return datetime.date.fromisoformat(match.group(1))
        except ValueError:
            return None
    return None


def _extract_date_from_header(content: str) -> datetime.date | None:
    """Extract date from the first header line like '# Predictions — 2026-04-20'."""
    match = _HEADER_DATE_RE.search(content)
    if match:
        try:
            return datetime.date.fromisoformat(match.group(1))
        except ValueError:
            return None
    return None


def _parse_outcome(text: str) -> bool | None:
    """Parse outcome text into True (correct), False (wrong), or None."""
    lower = text.strip().lower()
    if any(word in lower for word in ("correct", "confirmed", "yes", "right", "true")):
        return True
    if any(word in lower for word in ("wrong", "incorrect", "no", "false", "failed")):
        return False
    return None


def _split_into_sections(content: str) -> list[tuple[str, str]]:
    """Split markdown content into (title, section_body) tuples by ## N. headers."""
    sections: list[tuple[str, str]] = []
    matches = list(_SECTION_HEADER_RE.finditer(content))

    for i, match in enumerate(matches):
        title = match.group(1).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        body = content[start:end].strip()
        sections.append((title, body))

    return sections


def _extract_field(body: str, pattern: re.Pattern) -> str | None:
    """Extract the first match of a field pattern from a section body."""
    match = pattern.search(body)
    if match:
        return match.group(1).strip()
    return None


def parse_prediction_file(filepath: Path) -> list[dict]:
    """Parse a prediction markdown file into a list of prediction dicts.

    Each dict has: text, confidence, date_made, resolution_date, outcome,
    self_assessment, title.
    """
    filepath = Path(filepath)

    try:
        content = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    # Sanitize: strip null bytes and unicode control chars
    content = _sanitize_string(content)

    if not content.strip():
        return []

    # Determine date_made: try filename first, then header
    date_made = _extract_date_from_filename(filepath)
    if date_made is None:
        date_made = _extract_date_from_header(content)

    # Split into numbered sections
    sections = _split_into_sections(content)
    if not sections:
        return []

    predictions: list[dict] = []

    for title, body in sections:
        # Extract the **Prediction:** field
        prediction_text = _extract_field(body, _PREDICTION_LINE_RE)
        if not prediction_text:
            # No **Prediction:** line -> skip this section
            continue

        # The prediction text may be multi-line; take up to the next ** field or ---
        # For simplicity, take the first line of the prediction text
        # (the regex captures everything after **Prediction:** on that line)
        # But in our data, the prediction text can span to the next field.
        # Trim at the next **field:** or ---
        pred_lines = []
        for line in prediction_text.split("\n"):
            if (
                line.strip().startswith("**")
                and line.strip() != prediction_text.split("\n")[0].strip()
            ):
                break
            if line.strip() == "---":
                break
            pred_lines.append(line)
        prediction_text = " ".join(pred_lines).strip()

        # Extract confidence from prediction text
        confidence = parse_confidence(prediction_text)

        # Extract verification date
        verification_text = _extract_field(body, _VERIFICATION_LINE_RE)
        resolution_date = parse_verification_date(verification_text) if verification_text else None

        # Extract outcome from **Outcome:** or **Resolution:** sections
        outcome_text = _extract_field(body, _OUTCOME_LINE_RE)
        if outcome_text is None:
            outcome_text = _extract_field(body, _RESOLUTION_LINE_RE)
        outcome = _parse_outcome(outcome_text) if outcome_text else None

        # Extract self_assessment from **How I'm wrong if:**
        self_assessment = _extract_field(body, _HOW_WRONG_LINE_RE)

        predictions.append(
            {
                "text": prediction_text,
                "confidence": confidence,
                "date_made": date_made,
                "resolution_date": resolution_date,
                "outcome": outcome,
                "self_assessment": self_assessment,
                "title": title,
            }
        )

    return predictions


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------


def _prediction_dedup_key(prediction: dict) -> str:
    """Generate a dedup key from date_made + title."""
    date_str = str(prediction.get("date_made") or "no-date")
    title = prediction.get("title") or prediction.get("text", "")
    raw = f"{date_str}:{title}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def store_prediction(conn: psycopg.Connection, prediction: dict) -> None:
    """Insert into predictions table. Idempotent via dedup on (date_made, title hash).

    Uses a text hash to detect duplicates without requiring a unique constraint
    on the text column itself.
    """
    text = _sanitize_string(prediction["text"])
    self_assessment = (
        _sanitize_string(prediction["self_assessment"])
        if prediction.get("self_assessment")
        else None
    )
    confidence = prediction.get("confidence")
    date_made = prediction.get("date_made")
    resolution_date = prediction.get("resolution_date")
    outcome = prediction.get("outcome")
    session_id = prediction.get("session_id")

    # Check for existing prediction with same dedup key
    existing = conn.execute(
        """
        SELECT id FROM predictions
        WHERE date_made IS NOT DISTINCT FROM %s
          AND md5(COALESCE(text, '')) = md5(%s)
        """,
        (date_made, text),
    ).fetchone()

    if existing:
        # Update existing row
        conn.execute(
            """
            UPDATE predictions SET
                confidence = %s,
                resolution_date = %s,
                outcome = %s,
                session_id = %s,
                self_assessment = %s
            WHERE id = %s
            """,
            (confidence, resolution_date, outcome, session_id, self_assessment, existing[0]),
        )
    else:
        conn.execute(
            """
            INSERT INTO predictions (
                text, confidence, date_made, resolution_date,
                outcome, session_id, self_assessment
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (text, confidence, date_made, resolution_date, outcome, session_id, self_assessment),
        )

    conn.commit()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def extract_all_predictions(
    predictions_dir: Path,
    conn: psycopg.Connection,
) -> int:
    """Process all .md files in predictions_dir. Return total prediction count."""
    predictions_dir = Path(predictions_dir)
    total = 0

    if not predictions_dir.is_dir():
        return 0

    for md_file in sorted(predictions_dir.glob("*.md")):
        try:
            preds = parse_prediction_file(md_file)
        except (OSError, PermissionError):
            continue

        for pred in preds:
            store_prediction(conn, pred)
            total += 1

    return total
