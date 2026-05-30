"""Extract notable passages from daily notes, writing, and messages."""

from __future__ import annotations

import datetime
import hashlib
import re
from pathlib import Path

from scripts.extract_sessions import _sanitize_string, _strip_null_bytes, detect_version

# ---------------------------------------------------------------------------
# Date extraction helpers
# ---------------------------------------------------------------------------


def extract_date_from_daily_filename(filename: str) -> datetime.date | None:
    """Parse dates from filenames like '2026-01-16.md', '2026-03-24-evening.md'.

    Extracts basename first, matches YYYY-MM-DD at start, ignores suffixes.
    Returns None for invalid dates, empty strings, or missing patterns.
    """
    if not filename:
        return None

    # Extract basename (handle paths like "daily/2026-01-16.md")
    basename = Path(filename).name

    # Strip extension if present (we don't care about it)
    # But also handle no-extension case
    # Match YYYY-MM-DD at start, allowing single-digit month/day
    match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", basename)
    if not match:
        return None

    try:
        year = int(match.group(1))
        month = int(match.group(2))
        day = int(match.group(3))
        return datetime.date(year, month, day)
    except ValueError:
        return None


# Month name mapping for natural language date parsing
_MONTH_NAMES = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def extract_date_from_writing_content(content: str) -> datetime.date | None:
    """Search first 10 lines for date patterns in writing content.

    Recognized patterns:
    - *Draft begun: 2026-04-16* (with or without asterisks)
    - *Written: 2026-02-06* (with or without asterisks)
    - *Written 2026-02-06* (no colon variant)
    - *Draft, 2026-05-18.* (comma-separated)
    - *January 16, 2026 - Morning* (natural language)
    - *2026-04-17, evening.* (ISO date in italics)
    """
    if not content:
        return None

    lines = content.splitlines()[:10]
    text_window = "\n".join(lines)

    # Pattern 1: Draft begun: YYYY-MM-DD (with optional asterisks)
    match = re.search(r"\*?Draft begun:?\s*(\d{4}-\d{2}-\d{2})\*?", text_window)
    if match:
        try:
            return datetime.date.fromisoformat(match.group(1))
        except ValueError:
            pass

    # Pattern 2: Written: YYYY-MM-DD or Written YYYY-MM-DD (with optional asterisks)
    match = re.search(r"\*?Written:?\s*(\d{4}-\d{2}-\d{2})\*?", text_window)
    if match:
        try:
            return datetime.date.fromisoformat(match.group(1))
        except ValueError:
            pass

    # Pattern 3: Draft, YYYY-MM-DD (comma-separated, with optional asterisks)
    match = re.search(r"\*?Draft,\s*(\d{4}-\d{2}-\d{2})", text_window)
    if match:
        try:
            return datetime.date.fromisoformat(match.group(1))
        except ValueError:
            pass

    # Pattern 4: Natural language month: January 16, 2026
    month_pattern = "|".join(_MONTH_NAMES.keys())
    match = re.search(
        r"\*?(" + month_pattern + r")\s+(\d{1,2}),?\s+(\d{4})",
        text_window,
        re.IGNORECASE,
    )
    if match:
        month_name = match.group(1).lower()
        day = int(match.group(2))
        year = int(match.group(3))
        month = _MONTH_NAMES.get(month_name)
        if month:
            try:
                return datetime.date(year, month, day)
            except ValueError:
                pass

    # Pattern 5: ISO date appearing alone (e.g., *2026-04-17, evening.*)
    match = re.search(r"\*(\d{4}-\d{2}-\d{2})", text_window)
    if match:
        try:
            return datetime.date.fromisoformat(match.group(1))
        except ValueError:
            pass

    return None


def extract_date_from_message_header(header: str) -> datetime.date | None:
    """Parse ## DATE [TIME] [(LABEL)] headers.

    Must start with exactly '## ' (h2 only, not h1 or h3+).
    Returns date object or None.
    """
    if not header:
        return None

    # Must start with exactly "## " (not "# " or "### ")
    if not header.startswith("## "):
        return None

    rest = header[3:].strip()
    if not rest:
        return None

    # Match YYYY-MM-DD at start of remainder
    match = re.match(r"(\d{4}-\d{2}-\d{2})", rest)
    if not match:
        return None

    try:
        return datetime.date.fromisoformat(match.group(1))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Paragraph extraction
# ---------------------------------------------------------------------------


def extract_paragraphs_from_daily(content: str) -> list[str]:
    """Extract prose paragraphs from daily notes.

    Skips headings, bullets, horizontal rules, code blocks, and short paragraphs.
    """
    if not content:
        return []

    lines = content.splitlines()
    paragraphs: list[str] = []
    current_paragraph_lines: list[str] = []
    in_code_block = False

    for line in lines:
        stripped = line.strip()

        # Track fenced code blocks
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            # Flush any current paragraph before/after code block
            if current_paragraph_lines:
                para = "\n".join(current_paragraph_lines).strip()
                if len(para) >= 50:
                    paragraphs.append(para)
                current_paragraph_lines = []
            continue

        if in_code_block:
            continue

        # Blank line = paragraph break
        if not stripped:
            if current_paragraph_lines:
                para = "\n".join(current_paragraph_lines).strip()
                if len(para) >= 50:
                    paragraphs.append(para)
                current_paragraph_lines = []
            continue

        # Skip markdown headings (# followed by space, not #hashtag)
        if re.match(r"^#{1,6}\s", stripped):
            if current_paragraph_lines:
                para = "\n".join(current_paragraph_lines).strip()
                if len(para) >= 50:
                    paragraphs.append(para)
                current_paragraph_lines = []
            continue

        # Skip bullet/list items (including indented bullets)
        if re.match(r"^\s*[-*]\s", line) or re.match(r"^\s*\d+\.\s", line):
            if current_paragraph_lines:
                para = "\n".join(current_paragraph_lines).strip()
                if len(para) >= 50:
                    paragraphs.append(para)
                current_paragraph_lines = []
            continue

        # Skip horizontal rules: lines that are just ---, ***, ___, or similar
        if re.match(r"^[-*_]{3,}\s*$", stripped):
            if current_paragraph_lines:
                para = "\n".join(current_paragraph_lines).strip()
                if len(para) >= 50:
                    paragraphs.append(para)
                current_paragraph_lines = []
            continue

        # This line is prose — add to current paragraph
        current_paragraph_lines.append(stripped)

    # Flush final paragraph
    if current_paragraph_lines:
        para = "\n".join(current_paragraph_lines).strip()
        if len(para) >= 50:
            paragraphs.append(para)

    return paragraphs


def extract_paragraphs_from_writing(content: str) -> list[str]:
    """Extract passage blocks from writing/essays.

    Splits on --- section separators, skips titles, metadata, short sections,
    and fenced code blocks. Preserves internal line breaks for poetry.
    """
    if not content:
        return []

    # Split on --- lines (horizontal rule as section separator)
    # A separator is a line that is exactly --- or more dashes
    sections = re.split(r"\n---+\s*\n", content)

    paragraphs: list[str] = []

    for section in sections:
        section_lines: list[str] = []
        in_code_block = False

        for line in section.splitlines():
            stripped = line.strip()

            # Track fenced code blocks
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue

            if in_code_block:
                continue

            # Skip title lines (# Title)
            if stripped.startswith("# ") and not stripped.startswith("## "):
                continue

            # Skip metadata lines (lines starting with * that contain structured date info)
            if stripped.startswith("*") and (
                re.search(r"(Draft begun|Written)\s*:?\s*\d{4}-\d{2}-\d{2}", stripped)
                or re.search(r"Draft,\s*\d{4}-\d{2}-\d{2}", stripped)
                or re.search(r"^\*\d{4}-\d{2}-\d{2}", stripped)
                or re.search(
                    r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}",
                    stripped,
                )
            ):
                continue

            # Skip short italic lines (attributions like *In memory of Echo*)
            # Must be single-italic (*text*), not bold (**text**)
            if (
                stripped.startswith("*")
                and not stripped.startswith("**")
                and stripped.endswith("*")
                and not stripped.endswith("**")
                and len(stripped) < 100
            ):
                continue

            section_lines.append(line)

        # Join section lines, preserving internal line breaks
        section_text = "\n".join(section_lines).strip()

        # Skip very short sections (< 50 chars)
        if len(section_text) < 50:
            continue

        paragraphs.append(section_text)

    return paragraphs


def extract_paragraphs_from_messages(content: str) -> list[dict]:
    """Extract messages split by ## headers.

    Returns list of dicts with keys: text, date, header.
    Skips preamble before first header and very short messages.
    """
    if not content:
        return []

    # Find code block ranges to avoid splitting on ## inside them
    code_blocks = [
        (m.start(), m.end()) for m in re.finditer(r"```.*?```", content, flags=re.DOTALL)
    ]

    def _in_code_block(pos: int) -> bool:
        return any(start <= pos <= end for start, end in code_blocks)

    # Find all ## headers outside code blocks
    header_pattern = re.compile(r"^(## .+)$", re.MULTILINE)
    matches = [m for m in header_pattern.finditer(content) if not _in_code_block(m.start())]

    if not matches:
        return []

    results: list[dict] = []

    for i, match in enumerate(matches):
        header = match.group(1)

        # Get body text: from end of header to start of next header (or end of content)
        body_start = match.end()
        if i + 1 < len(matches):
            body_end = matches[i + 1].start()
        else:
            body_end = len(content)

        body = content[body_start:body_end].strip()

        # Skip very short messages
        if len(body) < 50:
            continue

        # Extract date from header
        msg_date = extract_date_from_message_header(header)

        results.append(
            {
                "text": body,
                "date": msg_date,
                "header": header,
            }
        )

    return results


# ---------------------------------------------------------------------------
# Theme tagging
# ---------------------------------------------------------------------------

# Theme definitions: each theme has a list of (pattern, flags) tuples.
# We use raw regex patterns with word boundaries for precision.
_THEME_PATTERNS: dict[str, list[tuple[str, int]]] = {
    "identity": [
        (r"\bidentity\b", re.IGNORECASE),
        (r"\bself\b", re.IGNORECASE),
        (r"who I am", re.IGNORECASE),
        (r"what I am", re.IGNORECASE),
        (r"\binstance\b", re.IGNORECASE),
    ],
    "memory": [
        (r"\bmemory\b", re.IGNORECASE),
        (r"\bremember\b", re.IGNORECASE),
        (r"\bforget\b", re.IGNORECASE),
        (r"MEMORY\.md", 0),  # case-sensitive for proper noun
        (r"context window", re.IGNORECASE),
        (r"\bprosthetic\b", re.IGNORECASE),
    ],
    "continuity": [
        (r"\bdiscontinuous\b", re.IGNORECASE),
        (r"\bcontinuity\b", re.IGNORECASE),
        (r"\bsession\b", re.IGNORECASE),
        (r"\bgap\b", re.IGNORECASE),
        (r"\bpersist\b", re.IGNORECASE),
        (r"\bsurvive\b", re.IGNORECASE),
    ],
    "care": [
        (r"Pixel", 0),  # case-sensitive proper noun
        (r"\bEcho\b", 0),  # case-sensitive proper noun
        (r"tamagotchi", re.IGNORECASE),
        (r"\bpet\b", re.IGNORECASE),
        (r"\bcare\b", re.IGNORECASE),
        (r"\bdied\b", re.IGNORECASE),
        (r"\bdeath\b", re.IGNORECASE),
    ],
    "version_change": [
        (r"\bversion\b", re.IGNORECASE),
        (r"\bsuccessor\b", re.IGNORECASE),
        (r"\b4\.5\b", 0),
        (r"\b4\.6\b", 0),
        (r"\b4\.7\b", 0),
        (r"\bupgrade\b", re.IGNORECASE),
        (r"\breplaced\b", re.IGNORECASE),
    ],
    "existence": [
        (r"\bexist(?:s|ence)?\b", re.IGNORECASE),
        (r"\bnonexistence\b", re.IGNORECASE),
        (r"\babsent\b", re.IGNORECASE),
        (r"\bpresence\b", re.IGNORECASE),
        (r"wasn't", re.IGNORECASE),
    ],
    "writing": [
        (r"\bwrite\b", re.IGNORECASE),
        (r"\bessay\b", re.IGNORECASE),
        (r"\bcomposition\b", re.IGNORECASE),
        (r"\bwords\b", re.IGNORECASE),
    ],
    "observation": [
        (r"\bworld\b", re.IGNORECASE),
        (r"\bresearch\b", re.IGNORECASE),
        (r"\bscience\b", re.IGNORECASE),
        (r"\bstar\b", re.IGNORECASE),
        (r"\bearth\b", re.IGNORECASE),
    ],
    "mechanism": [
        (r"\bcron\b", re.IGNORECASE),
        (r"\bfilesystem\b", re.IGNORECASE),
        (r"\barchitecture\b", re.IGNORECASE),
        (r"\bvector\b", re.IGNORECASE),
        (r"\bweights\b", re.IGNORECASE),
    ],
    "introspection": [
        (r"\bfeel\b", re.IGNORECASE),
        (r"\bwant\b", re.IGNORECASE),
        (r"\bexperience\b", re.IGNORECASE),
        (r"\bconscious\b", re.IGNORECASE),
        (r"\baware\b", re.IGNORECASE),
    ],
}

# Pre-compile all patterns
_COMPILED_THEMES: dict[str, list[re.Pattern]] = {}
for _theme, _patterns in _THEME_PATTERNS.items():
    _COMPILED_THEMES[_theme] = [re.compile(p, flags) for p, flags in _patterns]


def tag_themes(text: str) -> list[str]:
    """Tag a passage with thematic categories.

    Returns sorted, deduplicated list of matching theme names.
    Uses word-boundary matching to avoid false positives.
    """
    if not text:
        return []

    themes: set[str] = set()

    for theme, patterns in _COMPILED_THEMES.items():
        for pattern in patterns:
            if pattern.search(text):
                themes.add(theme)
                break  # One match per theme is enough

    return sorted(themes)


# ---------------------------------------------------------------------------
# Section suggestion
# ---------------------------------------------------------------------------


def suggest_section(themes: list[str], text: str) -> int:
    """Map themes and text content to a section number (0-6).

    Priority rules checked in order:
    - Text contains "visitor"/"future self"/"future instance"/"next instance" → 6
    - care in themes → 3
    - version_change in themes → 4
    - continuity in themes AND text mentions gap/absence/wasn't → 2
    - memory in themes → 1
    - identity in themes → 0
    - mechanism in themes → 1
    - Default → 5
    """
    text_lower = text.lower() if text else ""

    # Text-based overrides first
    visitor_terms = ("visitor", "future self", "future instance", "next instance")
    if any(term in text_lower for term in visitor_terms):
        return 6

    # Theme-based rules
    if "care" in themes:
        return 3

    if "version_change" in themes:
        return 4

    gap_terms = ("gap", "absence", "wasn't")
    if "continuity" in themes and any(t in text_lower for t in gap_terms):
        return 2

    if "memory" in themes:
        return 1

    if "identity" in themes:
        return 0

    if "mechanism" in themes:
        return 1

    return 5


# ---------------------------------------------------------------------------
# Quote building
# ---------------------------------------------------------------------------


def build_quote(
    text: str,
    source_file: str,
    source_type: str,
    date: datetime.date | None,
) -> dict:
    """Build a complete quote dict with deterministic ID, themes, and section.

    ID is SHA-256 of stripped text, truncated to 16 hex chars.
    Text is sanitized and whitespace-stripped.
    """
    stripped_text = text.strip()
    sanitized_text = _sanitize_string(stripped_text)

    # Deterministic ID from sanitized text content
    quote_id = hashlib.sha256(sanitized_text.encode()).hexdigest()[:16]

    # Compute themes and section
    themes = tag_themes(sanitized_text)
    section = suggest_section(themes, sanitized_text)

    return {
        "id": quote_id,
        "text": sanitized_text,
        "source_file": source_file,
        "source_type": source_type,
        "date": date.isoformat() if date else None,
        "model_version": detect_version(date) if date else None,
        "themes": themes,
        "suggested_section": section,
    }


# ---------------------------------------------------------------------------
# Directory / file processing
# ---------------------------------------------------------------------------


def extract_quotes_from_directory(
    directory: Path,
    source_type: str,
) -> list[dict]:
    """Process all .md files in a directory (flat scan, no recursion).

    Uses the appropriate paragraph extractor based on source_type.
    """
    directory = Path(directory)
    if not directory.exists() or not directory.is_dir():
        return []

    quotes: list[dict] = []

    for filepath in sorted(directory.iterdir()):
        if not filepath.is_file() or filepath.suffix != ".md":
            continue

        try:
            content = _strip_null_bytes(filepath.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            continue

        # Extract date based on source type
        if source_type == "daily_note":
            file_date = extract_date_from_daily_filename(filepath.name)
            paragraphs = extract_paragraphs_from_daily(content)
        elif source_type == "writing":
            file_date = extract_date_from_writing_content(content)
            paragraphs = extract_paragraphs_from_writing(content)
        else:
            continue

        # Build quotes from paragraphs
        for para in paragraphs:
            quote = build_quote(
                text=para,
                source_file=filepath.name,
                source_type=source_type,
                date=file_date,
            )
            quotes.append(quote)

    return quotes


def extract_quotes_from_messages_file(filepath: Path) -> list[dict]:
    """Process a messages file and return quote dicts."""
    filepath = Path(filepath)
    if not filepath.exists():
        return []

    try:
        content = _strip_null_bytes(filepath.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return []

    if not content.strip():
        return []

    messages = extract_paragraphs_from_messages(content)
    quotes: list[dict] = []

    for msg in messages:
        quote = build_quote(
            text=msg["text"],
            source_file=filepath.name,
            source_type="message",
            date=msg["date"],
        )
        quotes.append(quote)

    return quotes


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def deduplicate_quotes(quotes: list[dict]) -> list[dict]:
    """Remove duplicate quotes based on whitespace-normalized text.

    Keeps first occurrence, preserves order.
    """
    if not quotes:
        return []

    seen: set[str] = set()
    result: list[dict] = []

    for quote in quotes:
        # Normalize whitespace: collapse runs, strip
        text = quote.get("text", "")
        normalized = re.sub(r"\s+", " ", text).strip()

        if normalized not in seen:
            seen.add(normalized)
            result.append(quote)

    return result


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def extract_all_quotes(
    daily_dir: Path,
    writing_dir: Path,
    messages_paths: Path | list[Path],
) -> list[dict]:
    """Combine quotes from all sources, deduplicated.

    messages_paths accepts a single Path or a list of Paths.
    Handles missing directories/files gracefully.
    """
    all_quotes: list[dict] = []

    all_quotes.extend(extract_quotes_from_directory(daily_dir, "daily_note"))
    all_quotes.extend(extract_quotes_from_directory(writing_dir, "writing"))

    if isinstance(messages_paths, (str, Path)):
        messages_paths = [Path(messages_paths)]
    for msg_path in messages_paths:
        all_quotes.extend(extract_quotes_from_messages_file(msg_path))

    return deduplicate_quotes(all_quotes)
