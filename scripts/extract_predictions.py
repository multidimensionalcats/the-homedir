"""Extract predictions from markdown files and store in the database."""

from __future__ import annotations

import datetime
import hashlib
import re
from pathlib import Path


from scripts.extract_sessions import _sanitize_string


# ---------------------------------------------------------------------------
# Confidence parsing
# ---------------------------------------------------------------------------

# Match optional ~, optional -, digits with optional decimal, followed by %
# Must not match URL-encoded sequences like %20
_CONFIDENCE_RE = re.compile(r"~?-?\d+(?:\.\d+)?%")


def parse_confidence(text: str) -> float | None:
    """Extract confidence from prediction text as a 0-1 float.

    Handles patterns like:
    - "Probability: ~60%" -> 0.6
    - "70%" -> 0.7
    - "~85%" -> 0.85
    - "0%" -> 0.0
    - "100%" -> 1.0
    Returns None for out-of-range, word-based, empty, or unparseable values.
    """
    if not text:
        return None

    match = _CONFIDENCE_RE.search(text)
    if not match:
        return None

    raw = match.group(0)

    # Strip leading ~ if present
    raw = raw.lstrip("~")

    # Remove trailing %
    raw = raw.rstrip("%")

    try:
        value = float(raw)
    except (ValueError, OverflowError):
        return None

    # Reject out of range
    if value < 0 or value > 100:
        return None

    return value / 100.0


# ---------------------------------------------------------------------------
# Verification date parsing
# ---------------------------------------------------------------------------

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_verification_date(text: str) -> datetime.date | None:
    """Extract a date from verification text.

    Handles patterns like:
    - "By 2026-05-10. Check: ..."
    - "By 2026-05-05"
    - "2026-05-10" bare
    - Dates in markdown bold: "**By 2026-05-10**"
    Returns None for empty, missing, or invalid dates.
    """
    if not text:
        return None

    match = _DATE_RE.search(text)
    if not match:
        return None

    try:
        return datetime.date.fromisoformat(match.group(0))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Prediction file parsing
# ---------------------------------------------------------------------------


def _extract_date_from_filename(filepath: Path) -> datetime.date | None:
    """Extract date from filename pattern YYYY-MM-DD.md."""
    match = re.search(r"(\d{4}-\d{2}-\d{2})", filepath.name)
    if not match:
        return None
    try:
        return datetime.date.fromisoformat(match.group(1))
    except ValueError:
        return None


def _parse_outcome(text: str | None) -> bool | None:
    """Parse outcome text into True/False/None."""
    if not text:
        return None

    # Strip markdown bold markers (e.g. "**Wrong**" -> "Wrong")
    normalized = text.strip().strip("*").strip().lower()

    if normalized in ("correct", "true", "yes", "right"):
        return True
    if normalized in ("wrong", "incorrect", "falsified", "false", "no"):
        return False
    if normalized in ("pending", "unknown", "tbd"):
        return None

    return None


def _extract_field(lines: list[str], *field_names: str) -> str | None:
    """Extract content from a **FieldName:** line within a section.

    Searches for lines starting with **FieldName:** (case-insensitive match on
    the field name). Returns the content after the colon, or multi-line content
    if lines follow before the next ** field or section heading.
    """
    for field_name in field_names:
        pattern = re.compile(
            r"^\*\*" + re.escape(field_name) + r":\*\*\s*(.*)",
            re.IGNORECASE,
        )
        for i, line in enumerate(lines):
            match = pattern.match(line.strip())
            if match:
                content_parts = [match.group(1).strip()]
                # Collect continuation lines
                for j in range(i + 1, len(lines)):
                    next_line = lines[j].strip()
                    if not next_line:
                        continue
                    # Stop at next field marker, heading, or horizontal rule
                    if (
                        next_line.startswith("**")
                        or next_line.startswith("#")
                        or next_line.startswith("---")
                    ):
                        break
                    content_parts.append(next_line)
                result = " ".join(part for part in content_parts if part)
                return result if result else None
    return None


def parse_prediction_file(filepath: Path) -> list[dict]:
    """Parse a markdown prediction file into a list of prediction dicts.

    Predictions are ## sections (often ## N. Title). For each section:
    - text: from **Prediction:** line
    - confidence: parsed from prediction text
    - date_made: from filename pattern YYYY-MM-DD.md
    - resolution_date: from **Verification:** section
    - outcome: from **Outcome:** or **Resolution:** section
    - self_assessment: from **How I'm wrong if:** section
    """
    filepath = Path(filepath)

    try:
        content = filepath.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            return []
    except OSError:
        return []

    if not content:
        return []

    # Strip null bytes
    content = content.replace("\x00", "")

    date_made = _extract_date_from_filename(filepath)

    # Split into sections by ## headings
    lines = content.splitlines()
    sections: list[tuple[str, list[str]]] = []
    current_heading: str | None = None
    current_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## "):
            if current_heading is not None:
                sections.append((current_heading, current_lines))
            current_heading = stripped[3:].strip()
            current_lines = []
        elif current_heading is not None:
            current_lines.append(line)

    # Don't forget the last section
    if current_heading is not None:
        sections.append((current_heading, current_lines))

    predictions: list[dict] = []

    for heading, section_lines in sections:
        # Extract prediction text
        pred_text = _extract_field(section_lines, "Prediction")
        if pred_text is None:
            continue

        # Extract title from heading (not stored to DB, but useful for callers)
        title = re.sub(r"^\d+\.\s*", "", heading).strip()
        if not title:
            title = heading.strip()

        # Extract confidence from prediction text
        confidence = parse_confidence(pred_text)

        # Extract verification/resolution date
        verification_text = _extract_field(section_lines, "Verification")
        resolution_date = parse_verification_date(verification_text)

        # Extract outcome
        outcome_text = _extract_field(section_lines, "Outcome", "Resolution")
        outcome = _parse_outcome(outcome_text)

        # Extract self-assessment
        self_assessment = _extract_field(section_lines, "How I'm wrong if")

        # If Resolution was present but didn't parse to a boolean outcome,
        # store the raw resolution text as self_assessment (if not already set)
        if self_assessment is None and outcome is None and outcome_text is not None:
            self_assessment = outcome_text

        predictions.append(
            {
                "text": pred_text,
                "confidence": confidence,
                "title": title,
                "date_made": date_made,
                "resolution_date": resolution_date,
                "outcome": outcome,
                "self_assessment": self_assessment,
            }
        )

    return predictions


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------


def _text_md5(text: str) -> str:
    """Compute MD5 hex digest of text."""
    return hashlib.md5(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def store_prediction(conn, prediction: dict) -> None:
    """Insert a prediction into the database. Idempotent via dedup on (date_made, md5 of text).

    If a duplicate is found (same date_made + text MD5), update instead of insert.
    """
    text = _sanitize_string(prediction.get("text", ""))
    if not text.strip():
        raise ValueError("Prediction text must not be empty")
    confidence = prediction.get("confidence")
    date_made = prediction.get("date_made")
    resolution_date = prediction.get("resolution_date")
    outcome = prediction.get("outcome")
    session_id = prediction.get("session_id")
    self_assessment = prediction.get("self_assessment")
    if self_assessment is not None:
        self_assessment = _sanitize_string(self_assessment)

    text_hash = _text_md5(text)

    with conn.transaction():
        # Check for existing prediction with same date_made and text hash
        if date_made is not None:
            existing = conn.execute(
                """
                SELECT id FROM predictions
                WHERE date_made = %s AND md5(text) = %s
                """,
                (date_made, text_hash),
            ).fetchone()
        else:
            existing = conn.execute(
                """
                SELECT id FROM predictions
                WHERE date_made IS NULL AND md5(text) = %s
                """,
                (text_hash,),
            ).fetchone()

        if existing:
            # Update existing record
            conn.execute(
                """
                UPDATE predictions SET
                    text = %s,
                    confidence = %s,
                    resolution_date = %s,
                    outcome = %s,
                    session_id = %s,
                    self_assessment = %s
                WHERE id = %s
                """,
                (
                    text,
                    confidence,
                    resolution_date,
                    outcome,
                    session_id,
                    self_assessment,
                    existing[0],
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO predictions (
                    text, confidence, date_made, resolution_date,
                    outcome, session_id, self_assessment
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    text,
                    confidence,
                    date_made,
                    resolution_date,
                    outcome,
                    session_id,
                    self_assessment,
                ),
            )


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def extract_all_predictions(predictions_dir: Path, conn) -> int:
    """Process all .md files in predictions_dir. Return total prediction count.

    Skips unreadable files. Idempotent.
    """
    predictions_dir = Path(predictions_dir)
    total = 0

    if not predictions_dir.is_dir():
        return 0

    for md_file in sorted(predictions_dir.glob("*.md")):
        try:
            predictions = parse_prediction_file(md_file)
        except (OSError, PermissionError):
            continue

        for pred in predictions:
            store_prediction(conn, pred)
            total += 1

    return total
