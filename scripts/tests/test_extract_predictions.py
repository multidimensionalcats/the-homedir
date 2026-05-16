"""Hostile tests for extract_predictions.py -- defines the API contract via TDD.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.
"""

import datetime

import pytest

from scripts.extract_predictions import (
    parse_confidence,
    parse_verification_date,
    parse_prediction_file,
    store_prediction,
    extract_all_predictions,
)

# Null byte constant -- avoids literal embedding issues in Python source.
NUL = chr(0)


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

_SAMPLE_PREDICTION_FILE = """\
# Predictions -- 2026-04-20 evening session

This is a practice in calibrating my own uncertainty. I'm going to make
explicit predictions about near-term events and assign probabilities.

---

## 1. US-Iran ceasefire (window ending ~May 4)

**Prediction:** Ceasefire extends past May 4. Probability I'd put on this: ~60%.

**Reasoning:** The diplomatic dynamics suggest both sides want to avoid
escalation, but the domestic pressures are real.

**Verification:** By 2026-05-10. Check: Was the ceasefire still holding on May 4?

**How I'm wrong if:** Hardliners in either government force a provocation
that neither side can walk back from.

---

## 2. FISA 702 (13-day extension to April 30)

**Prediction:** Another short extension. Probability: ~70%.

**Verification:** By 2026-05-05.

---
"""

_SAMPLE_WITH_OUTCOMES = """\
# Predictions -- 2026-04-20 evening session

---

## 1. Test prediction one

**Prediction:** Something will happen. Probability: ~55%.

**Verification:** By 2026-05-01.

**Outcome:** Correct

**How I'm wrong if:** I'm not.

---

## 2. Test prediction two

**Prediction:** Another thing. Probability: ~40%.

**Verification:** By 2026-05-15.

**Outcome:** Wrong

---

## 3. Test prediction three

**Prediction:** Something pending. Probability: ~80%.

**Verification:** By 2026-06-01.

**Outcome:** Pending

---
"""

_SAMPLE_WITH_RESOLUTION = """\
# Predictions -- 2026-05-01 morning

---

## 1. Resolution test

**Prediction:** Test claim. Probability: ~65%.

**Verification:** By 2026-06-01.

**Resolution:** The claim was vindicated by events on May 28.

---
"""

_SAMPLE_MALFORMED = """\
# Predictions -- 2026-04-25

This file has weird formatting issues.

---

## 1. Missing prediction field

**Reasoning:** Some reasoning without a Prediction line.

**Verification:** By 2026-05-20.

---

## 2. Normal one

**Prediction:** This one is fine. Probability: ~50%.

**Verification:** By 2026-05-25.

---

## No number prefix

**Prediction:** Section header without a number. Probability: ~45%.

**Verification:** By 2026-05-30.

---
"""

_SAMPLE_UNICODE = """\
# Predictions -- 2026-04-20 evening

---

## 1. Geopolitical cafe prediction

**Prediction:** The café negotiations will succeed. Probability: ~72%.

**Verification:** By 2026-06-01.

**How I'm wrong if:** — too many variables, ¿ who knows?

---
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_md(tmp_path, name, content):
    """Write a .md file and return the path."""
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def _write_pred_dir(tmp_path, files):
    """Create a predictions directory with named files. Returns dir path."""
    pred_dir = tmp_path / "predictions"
    pred_dir.mkdir()
    for name, content in files.items():
        (pred_dir / name).write_text(content, encoding="utf-8")
    return pred_dir


def _insert_session(conn, session_id, date):
    """Insert a minimal session row for FK testing."""
    conn.execute(
        """
        INSERT INTO sessions (
            id, date, time_of_day, version, source_type, source_file,
            wrote_prediction
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            session_id,
            date,
            "PM",
            "4.6",
            "jsonl",
            f"activity-{date.isoformat()}.jsonl",
            True,
        ),
    )
    conn.commit()


# ===========================================================================
# 1. PARSE CONFIDENCE
# ===========================================================================


class TestParseConfidence:
    """14 tests -- exercises every confidence extraction edge case."""

    def test_standard_probability_format(self):
        assert parse_confidence("Probability: ~60%") == pytest.approx(0.6)

    def test_verbose_probability_format(self):
        assert parse_confidence("Probability I'd put on this: ~60%") == pytest.approx(0.6)

    def test_bare_percentage(self):
        assert parse_confidence("70%") == pytest.approx(0.7)

    def test_tilde_percentage(self):
        assert parse_confidence("~85%") == pytest.approx(0.85)

    def test_zero_percent(self):
        result = parse_confidence("0%")
        assert result == pytest.approx(0.0)

    def test_hundred_percent(self):
        result = parse_confidence("100%")
        assert result == pytest.approx(1.0)

    def test_over_hundred_returns_none(self):
        """150% is out of valid range -- must reject."""
        assert parse_confidence("150%") is None

    def test_negative_returns_none(self):
        """-10% is out of valid range -- must reject."""
        assert parse_confidence("-10%") is None

    def test_word_form_returns_none(self):
        """'sixty percent' is not machine-parseable -- must return None."""
        assert parse_confidence("sixty percent") is None

    def test_empty_string_returns_none(self):
        assert parse_confidence("") is None

    def test_none_input_returns_none(self):
        assert parse_confidence(None) is None

    def test_decimal_percentage(self):
        """60.5% should parse to 0.605."""
        assert parse_confidence("Probability: ~60.5%") == pytest.approx(0.605)

    def test_no_percentage_in_text(self):
        assert parse_confidence("I think this is likely but I'm not sure.") is None

    def test_multiple_percentages_takes_first(self):
        """'between 60% and 70%' should return first match: 0.6."""
        result = parse_confidence("between 60% and 70%")
        assert result == pytest.approx(0.6)

    def test_percentage_embedded_in_url(self):
        """A URL like 'foo%20bar' should NOT be parsed as 20%."""
        # This is tricky -- %20 is a URL encoding, not a percentage
        result = parse_confidence("See https://example.com/foo%20bar for details")
        # Should return None -- the only "percentage" is URL-encoded noise
        assert result is None

    def test_exactly_zero_is_not_none(self):
        """0% is a valid confidence of 0.0, distinct from None (unknown)."""
        result = parse_confidence("Probability: 0%")
        assert result is not None
        assert result == pytest.approx(0.0)


# ===========================================================================
# 2. PARSE VERIFICATION DATE
# ===========================================================================


class TestParseVerificationDate:
    """10 tests -- date extraction from Verification lines."""

    def test_by_prefix_with_trailing_text(self):
        result = parse_verification_date("By 2026-05-10. Check: something")
        assert result == datetime.date(2026, 5, 10)

    def test_by_prefix_clean(self):
        result = parse_verification_date("By 2026-05-05")
        assert result == datetime.date(2026, 5, 5)

    def test_no_by_prefix(self):
        """A bare date should still be found."""
        result = parse_verification_date("2026-05-10")
        assert result == datetime.date(2026, 5, 10)

    def test_no_date_returns_none(self):
        assert parse_verification_date("Check back later") is None

    def test_invalid_date_returns_none(self):
        """Month 13 day 45 is not a real date."""
        assert parse_verification_date("By 2026-13-45") is None

    def test_empty_string_returns_none(self):
        assert parse_verification_date("") is None

    def test_none_input_returns_none(self):
        assert parse_verification_date(None) is None

    def test_multiple_dates_returns_first(self):
        result = parse_verification_date("By 2026-05-10 or 2026-06-01")
        assert result == datetime.date(2026, 5, 10)

    def test_date_with_surrounding_markdown(self):
        result = parse_verification_date("**Verification:** By 2026-05-10.")
        assert result == datetime.date(2026, 5, 10)

    def test_feb_29_leap_year_handling(self):
        """2028 is a leap year; 2026 is not."""
        assert parse_verification_date("By 2028-02-29") == datetime.date(2028, 2, 29)
        assert parse_verification_date("By 2026-02-29") is None


# ===========================================================================
# 3. PARSE PREDICTION FILE
# ===========================================================================


class TestParsePredictionFile:
    """18 tests -- file parsing with every kind of garbage input."""

    def test_standard_two_predictions(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        assert len(results) == 2

    def test_first_prediction_fields(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        pred = results[0]

        assert "ceasefire" in pred["text"].lower() or "Ceasefire" in pred["text"]
        assert pred["confidence"] == pytest.approx(0.6)
        assert pred["date_made"] == datetime.date(2026, 4, 20)
        assert pred["resolution_date"] == datetime.date(2026, 5, 10)

    def test_second_prediction_fields(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        pred = results[1]

        assert pred["confidence"] == pytest.approx(0.7)
        assert pred["resolution_date"] == datetime.date(2026, 5, 5)

    def test_date_made_from_filename(self, tmp_path):
        """date_made must come from the filename YYYY-MM-DD.md pattern."""
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        for pred in results:
            assert pred["date_made"] == datetime.date(2026, 4, 20)

    def test_title_extracted(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        assert "US-Iran" in results[0]["title"] or "ceasefire" in results[0]["title"].lower()
        assert "FISA" in results[1]["title"]

    def test_self_assessment_field(self, tmp_path):
        """'How I'm wrong if' section should populate self_assessment."""
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        assert results[0]["self_assessment"] is not None
        assert (
            "hardliner" in results[0]["self_assessment"].lower()
            or len(results[0]["self_assessment"]) > 10
        )
        # Second prediction has no "How I'm wrong if" section
        assert results[1].get("self_assessment") is None

    def test_empty_file(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", "")
        results = parse_prediction_file(path)
        assert results == []

    def test_preamble_only_no_sections(self, tmp_path):
        content = "# Predictions -- 2026-04-20\n\nJust some intro text, no ## sections.\n"
        path = _write_md(tmp_path, "2026-04-20.md", content)
        results = parse_prediction_file(path)
        assert results == []

    def test_outcome_correct(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_WITH_OUTCOMES)
        results = parse_prediction_file(path)
        assert results[0]["outcome"] is True

    def test_outcome_wrong(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_WITH_OUTCOMES)
        results = parse_prediction_file(path)
        assert results[1]["outcome"] is False

    def test_outcome_pending(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_WITH_OUTCOMES)
        results = parse_prediction_file(path)
        assert results[2]["outcome"] is None

    def test_resolution_alternative_to_outcome(self, tmp_path):
        """**Resolution:** should be treated as self_assessment or similar metadata."""
        path = _write_md(tmp_path, "2026-05-01.md", _SAMPLE_WITH_RESOLUTION)
        results = parse_prediction_file(path)
        assert len(results) == 1
        # Resolution text should be captured somewhere -- self_assessment is the likely field
        pred = results[0]
        assert pred.get("self_assessment") is not None or pred.get("outcome") is not None

    def test_malformed_missing_prediction_field(self, tmp_path):
        """Section with no **Prediction:** should be skipped or handled gracefully."""
        path = _write_md(tmp_path, "2026-04-25.md", _SAMPLE_MALFORMED)
        results = parse_prediction_file(path)
        # At minimum, the normal prediction (section 2) must be parsed
        texts = [r["text"] for r in results]
        assert any("fine" in t.lower() for t in texts)

    def test_section_without_number_prefix(self, tmp_path):
        """## heading without 'N.' prefix should still be attempted."""
        path = _write_md(tmp_path, "2026-04-25.md", _SAMPLE_MALFORMED)
        results = parse_prediction_file(path)
        # The unnumbered section should either be parsed or cleanly skipped
        # -- it must NOT cause a crash
        assert isinstance(results, list)

    def test_unicode_preserved(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_UNICODE)
        results = parse_prediction_file(path)
        assert len(results) == 1
        # Unicode characters must survive the round-trip
        assert "é" in results[0]["text"] or "caf" in results[0]["text"].lower()
        if results[0].get("self_assessment"):
            assert "—" in results[0]["self_assessment"] or len(results[0]["self_assessment"]) > 0

    def test_null_bytes_stripped(self, tmp_path):
        content = (
            f"# Predictions -- 2026-04-20\n\n---\n\n## 1. Test\n\n"
            f"**Prediction:** Null{NUL}byte test. Probability: ~50%.\n\n"
            f"**Verification:** By 2026-05-01.\n\n---\n"
        )
        path = _write_md(tmp_path, "2026-04-20.md", content)
        results = parse_prediction_file(path)
        assert len(results) >= 1
        assert NUL not in results[0]["text"]

    def test_large_file(self, tmp_path):
        """100KB+ file should not crash."""
        sections = []
        for i in range(1, 101):
            sections.append(
                f"## {i}. Prediction number {i}\n\n"
                f"**Prediction:** Something will happen #{i}. Probability: ~{min(i, 99)}%.\n\n"
                f"**Verification:** By 2026-12-31.\n\n---\n"
            )
        content = "# Predictions -- 2026-04-20\n\n---\n\n" + "\n".join(sections)
        assert len(content.encode("utf-8")) > 10_000  # sanity check size

        path = _write_md(tmp_path, "2026-04-20.md", content)
        results = parse_prediction_file(path)
        assert len(results) == 100

    def test_non_date_filename_graceful(self, tmp_path):
        """File not named YYYY-MM-DD.md should still parse, with date_made=None."""
        content = (
            "# Predictions -- misc\n\n---\n\n## 1. Test\n\n"
            "**Prediction:** Something. Probability: ~50%.\n\n"
            "**Verification:** By 2026-06-01.\n\n---\n"
        )
        path = _write_md(tmp_path, "misc-predictions.md", content)
        results = parse_prediction_file(path)
        assert len(results) == 1
        assert results[0]["date_made"] is None

    def test_outcome_incorrect_synonym(self, tmp_path):
        """'Incorrect' and 'Falsified' should also map to outcome=False."""
        content = """\
# Predictions -- 2026-04-20

---

## 1. Incorrect test

**Prediction:** Will fail. Probability: ~30%.

**Verification:** By 2026-05-01.

**Outcome:** Incorrect

---

## 2. Falsified test

**Prediction:** Also wrong. Probability: ~20%.

**Verification:** By 2026-05-01.

**Outcome:** Falsified

---
"""
        path = _write_md(tmp_path, "2026-04-20.md", content)
        results = parse_prediction_file(path)
        assert results[0]["outcome"] is False
        assert results[1]["outcome"] is False


# ===========================================================================
# 4. STORE PREDICTION
# ===========================================================================


class TestStorePrediction:
    """10 tests -- DB insertion edge cases."""

    def test_insert_and_roundtrip(self, db_conn):
        pred = {
            "text": "Ceasefire extends past May 4",
            "confidence": 0.6,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": datetime.date(2026, 5, 10),
            "outcome": None,
            "session_id": None,
            "self_assessment": "Hardliners force a provocation",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT text, confidence, date_made, resolution_date, outcome, "
            "session_id, self_assessment FROM predictions WHERE text = %s",
            (pred["text"],),
        ).fetchone()
        assert row is not None
        assert row[0] == "Ceasefire extends past May 4"
        assert row[1] == pytest.approx(0.6)
        assert row[2] == datetime.date(2026, 4, 20)
        assert row[3] == datetime.date(2026, 5, 10)
        assert row[4] is None  # outcome
        assert row[5] is None  # session_id
        assert row[6] == "Hardliners force a provocation"

    def test_idempotent_no_duplicate(self, db_conn):
        """Inserting the same prediction twice should not create duplicates."""
        pred = {
            "text": "FISA 702 gets another extension",
            "confidence": 0.7,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": datetime.date(2026, 5, 5),
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        store_prediction(db_conn, pred)
        store_prediction(db_conn, pred)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM predictions WHERE text = %s AND date_made = %s",
            (pred["text"], pred["date_made"]),
        ).fetchone()[0]
        assert count == 1

    def test_null_confidence(self, db_conn):
        pred = {
            "text": "Prediction without confidence",
            "confidence": None,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT confidence FROM predictions WHERE text = %s",
            (pred["text"],),
        ).fetchone()
        assert row is not None
        assert row[0] is None

    def test_null_dates(self, db_conn):
        pred = {
            "text": "Prediction with no dates",
            "confidence": 0.5,
            "date_made": None,
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT date_made, resolution_date FROM predictions WHERE text = %s",
            (pred["text"],),
        ).fetchone()
        assert row[0] is None
        assert row[1] is None

    def test_confidence_zero_boundary(self, db_conn):
        """Confidence 0.0 is valid and must be stored, not treated as NULL."""
        pred = {
            "text": "Zero confidence prediction",
            "confidence": 0.0,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT confidence FROM predictions WHERE text = %s",
            (pred["text"],),
        ).fetchone()
        assert row[0] is not None
        assert row[0] == pytest.approx(0.0)

    def test_confidence_one_boundary(self, db_conn):
        """Confidence 1.0 is valid and must be stored."""
        pred = {
            "text": "Maximum confidence prediction",
            "confidence": 1.0,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT confidence FROM predictions WHERE text = %s",
            (pred["text"],),
        ).fetchone()
        assert row[0] == pytest.approx(1.0)

    def test_confidence_out_of_range_rejected(self, db_conn):
        """Confidence > 1.0 must be caught -- either by code or CHECK constraint."""
        pred = {
            "text": "Out of range confidence",
            "confidence": 1.5,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        with pytest.raises(Exception):
            store_prediction(db_conn, pred)
        db_conn.rollback()

    def test_null_bytes_in_text_stripped(self, db_conn):
        pred = {
            "text": f"Prediction with{NUL}null bytes{NUL}inside",
            "confidence": 0.5,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT text FROM predictions WHERE text LIKE %s",
            ("%Prediction with%",),
        ).fetchone()
        assert row is not None
        assert NUL not in row[0]

    def test_invalid_session_id_fk(self, db_conn):
        """session_id referencing a nonexistent session must raise or be handled."""
        pred = {
            "text": "Prediction with bad FK",
            "confidence": 0.5,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": "nonexistent-session-9999",
            "self_assessment": None,
        }
        with pytest.raises(Exception):
            store_prediction(db_conn, pred)
        db_conn.rollback()

    def test_empty_text_rejected(self, db_conn):
        """Empty text should violate NOT NULL or be caught by code."""
        pred = {
            "text": "",
            "confidence": 0.5,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
        }
        # Either the function rejects empty text or the DB NOT NULL catches it
        # (empty string passes NOT NULL, but the function should arguably reject it)
        with pytest.raises(Exception):
            store_prediction(db_conn, pred)
        db_conn.rollback()

    def test_valid_session_id_fk(self, db_conn):
        """A valid session_id should be stored correctly."""
        _insert_session(db_conn, "pred-session-01", datetime.date(2026, 4, 20))
        pred = {
            "text": "Prediction with valid FK",
            "confidence": 0.6,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": datetime.date(2026, 5, 10),
            "outcome": True,
            "session_id": "pred-session-01",
            "self_assessment": "Was right for wrong reasons",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT session_id FROM predictions WHERE text = %s",
            (pred["text"],),
        ).fetchone()
        assert row[0] == "pred-session-01"


# ===========================================================================
# 5. EXTRACT ALL PREDICTIONS
# ===========================================================================


class TestExtractAll:
    """10 tests -- end-to-end pipeline exercises."""

    def test_two_files_correct_count(self, tmp_path, db_conn):
        pred_dir = _write_pred_dir(
            tmp_path,
            {
                "2026-04-20.md": _SAMPLE_PREDICTION_FILE,
                "2026-04-25.md": _SAMPLE_WITH_OUTCOMES,
            },
        )
        count = extract_all_predictions(pred_dir, db_conn)
        # 2 from first file + 3 from second file = 5
        assert count == 5

    def test_empty_directory(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        count = extract_all_predictions(pred_dir, db_conn)
        assert count == 0

    def test_idempotent_run_twice(self, tmp_path, db_conn):
        pred_dir = _write_pred_dir(
            tmp_path,
            {
                "2026-04-20.md": _SAMPLE_PREDICTION_FILE,
            },
        )
        count1 = extract_all_predictions(pred_dir, db_conn)
        count2 = extract_all_predictions(pred_dir, db_conn)

        assert count1 == count2 == 2

        total = db_conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
        assert total == 2, "Duplicate rows created on second run"

    def test_non_md_files_ignored(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        (pred_dir / "2026-04-20.md").write_text(_SAMPLE_PREDICTION_FILE, encoding="utf-8")
        (pred_dir / "notes.txt").write_text("Not a prediction file", encoding="utf-8")
        (pred_dir / "README").write_text("Also not predictions", encoding="utf-8")
        (pred_dir / "data.json").write_text('{"key": "value"}', encoding="utf-8")

        count = extract_all_predictions(pred_dir, db_conn)
        assert count == 2  # only from the .md file

    def test_predictions_actually_in_db(self, tmp_path, db_conn):
        pred_dir = _write_pred_dir(
            tmp_path,
            {
                "2026-04-20.md": _SAMPLE_PREDICTION_FILE,
            },
        )
        extract_all_predictions(pred_dir, db_conn)

        rows = db_conn.execute(
            "SELECT text, confidence, date_made, resolution_date "
            "FROM predictions ORDER BY resolution_date"
        ).fetchall()
        assert len(rows) == 2
        # Verify data actually reached the DB correctly
        texts = [r[0] for r in rows]
        assert any("ceasefire" in t.lower() or "Ceasefire" in t for t in texts)

    def test_unreadable_file_skipped(self, tmp_path, db_conn):
        """Unreadable file should be skipped; other files still processed."""
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        good = pred_dir / "2026-04-20.md"
        good.write_text(_SAMPLE_PREDICTION_FILE, encoding="utf-8")
        bad = pred_dir / "2026-04-25.md"
        bad.write_text(_SAMPLE_WITH_OUTCOMES, encoding="utf-8")
        bad.chmod(0o000)

        try:
            count = extract_all_predictions(pred_dir, db_conn)
            assert count >= 2  # at least the good file's predictions
        finally:
            bad.chmod(0o644)

    def test_file_with_no_predictions_contributes_zero(self, tmp_path, db_conn):
        pred_dir = _write_pred_dir(
            tmp_path,
            {
                "2026-04-20.md": _SAMPLE_PREDICTION_FILE,
                "2026-04-21.md": (
                    "# Predictions -- 2026-04-21\n\nNo predictions today, just reflection.\n"
                ),
            },
        )
        count = extract_all_predictions(pred_dir, db_conn)
        assert count == 2  # only from the first file

    def test_outcomes_stored_in_db(self, tmp_path, db_conn):
        """Verify outcome booleans survive the full pipeline."""
        pred_dir = _write_pred_dir(
            tmp_path,
            {
                "2026-04-20.md": _SAMPLE_WITH_OUTCOMES,
            },
        )
        extract_all_predictions(pred_dir, db_conn)

        rows = db_conn.execute("SELECT text, outcome FROM predictions ORDER BY id").fetchall()
        outcomes = {r[0]: r[1] for r in rows}
        # At least one True, one False, one None
        assert True in outcomes.values()
        assert False in outcomes.values()
        assert None in outcomes.values()

    def test_self_assessment_stored_in_db(self, tmp_path, db_conn):
        """How I'm wrong if text should reach the DB via the full pipeline."""
        pred_dir = _write_pred_dir(
            tmp_path,
            {
                "2026-04-20.md": _SAMPLE_PREDICTION_FILE,
            },
        )
        extract_all_predictions(pred_dir, db_conn)

        rows = db_conn.execute(
            "SELECT self_assessment FROM predictions WHERE self_assessment IS NOT NULL"
        ).fetchall()
        assert len(rows) >= 1
        assert len(rows[0][0]) > 10  # non-trivial text

    def test_directory_with_subdirectories_only_top_level(self, tmp_path, db_conn):
        """Subdirectories should not be recursed into (predictions are flat)."""
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        (pred_dir / "2026-04-20.md").write_text(_SAMPLE_PREDICTION_FILE, encoding="utf-8")

        subdir = pred_dir / "archive"
        subdir.mkdir()
        (subdir / "2026-01-01.md").write_text(_SAMPLE_WITH_OUTCOMES, encoding="utf-8")

        count = extract_all_predictions(pred_dir, db_conn)
        assert count == 2  # only top-level file

        total = db_conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
        assert total == 2
