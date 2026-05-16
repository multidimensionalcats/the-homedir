"""Hostile tests for extract_predictions.py -- defines the API contract via TDD.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.
"""

import datetime

import pytest

from scripts.extract_predictions import (
    extract_all_predictions,
    parse_confidence,
    parse_prediction_file,
    parse_verification_date,
    store_prediction,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SAMPLE_PREDICTION_FILE = """\
# Predictions — 2026-04-20 evening session

This is a practice session for making explicit predictions. The idea is to
force clarity about what I actually expect to happen.

---

## 1. US-Iran ceasefire (window ending ~May 4)

**Prediction:** Ceasefire extends past May 4 without a formal new agreement. \
Probability I'd put on this: ~60%.

**Reasoning:** The current framework has held longer than expected.

**Verification:** By 2026-05-10. Check: has the ceasefire formally collapsed?

**How I'm wrong if:** Bolton or similar hawks push for confrontation.

---

## 2. FISA 702 (13-day extension to April 30)

**Prediction:** Another short extension rather than full reauthorization. \
Probability: ~70%.

**Reasoning:** Neither party has incentive to force full debate now.

**Verification:** By 2026-05-05. Check: was FISA 702 reauthorized or extended?

**How I'm wrong if:** A national security event forces immediate reauth.
"""

_SAMPLE_WITH_OUTCOME = """\
# Predictions — 2026-05-01 review

---

## 1. Prediction that was correct

**Prediction:** Something happens. Probability: ~80%.

**Reasoning:** Because reasons.

**Verification:** By 2026-05-10. Check: did it happen?

**Outcome:** Correct — it happened as predicted.

---

## 2. Prediction that was wrong

**Prediction:** Something else happens. Probability: ~40%.

**Reasoning:** Because other reasons.

**Verification:** By 2026-05-15. Check: did it happen?

**Outcome:** Wrong — it did not happen.

---

## 3. Prediction still pending

**Prediction:** A third thing. Probability: ~55%.

**Reasoning:** More reasons.

**Verification:** By 2026-06-01. Check: will it happen?
"""

_SAMPLE_RESOLUTION = """\
# Predictions — 2026-05-14

---

## 1. Resolved prediction

**Prediction:** The bill passes. Probability: ~65%.

**Verification:** By 2026-06-01.

**Resolution:** Confirmed — bill passed on May 12.
"""

_SAMPLE_MALFORMED = """\
# Predictions — 2026-04-26

Some text but no proper sections.

A line that says Prediction: but not in the right format.

## Not a numbered section

Random content.
"""

_SAMPLE_UNICODE = """\
# Predictions — 2026-04-26

---

## 1. Prédiction avec des accents (café)

**Prediction:** Le résultat sera positif. Probability: ~75%.

**Verification:** By 2026-06-01. Check: résultat vérifié.

**How I'm wrong if:** Les données étaient incorrectes.
"""


def _write_md(tmp_path, name, content):
    """Write a .md file and return the path."""
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def _insert_session(conn, session_id, date):
    """Insert a minimal session row for FK testing."""
    from scripts.extract_sessions import detect_version

    conn.execute(
        """
        INSERT INTO sessions (
            id, date, time_of_day, version, source_type, source_file
        ) VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            session_id,
            date,
            "PM",
            detect_version(date),
            "jsonl",
            f"activity-{date.isoformat()}.jsonl",
        ),
    )
    conn.commit()


# ===========================================================================
# 1. PARSE CONFIDENCE
# ===========================================================================


class TestParseConfidence:
    def test_probability_with_tilde(self):
        assert parse_confidence("Probability: ~60%") == pytest.approx(0.6)

    def test_probability_verbose_phrasing(self):
        assert parse_confidence("Probability I'd put on this: ~60%") == pytest.approx(0.6)

    def test_bare_percentage(self):
        assert parse_confidence("Something happens. 70%.") == pytest.approx(0.7)

    def test_tilde_percentage(self):
        assert parse_confidence("About ~85% likely") == pytest.approx(0.85)

    def test_no_percentage_returns_none(self):
        assert parse_confidence("No numbers here at all") is None

    def test_zero_percent(self):
        assert parse_confidence("Probability: 0%") == pytest.approx(0.0)

    def test_hundred_percent(self):
        assert parse_confidence("Probability: 100%") == pytest.approx(1.0)

    def test_over_hundred_returns_none(self):
        """150% is not a valid probability."""
        assert parse_confidence("Probability: 150%") is None

    def test_negative_returns_none(self):
        """Negative percentage is not a valid probability."""
        assert parse_confidence("Probability: -10%") is None

    def test_words_not_parsed(self):
        """'sixty percent' should not be parsed as a number."""
        assert parse_confidence("sixty percent chance") is None

    def test_empty_string(self):
        assert parse_confidence("") is None

    def test_percentage_in_longer_text(self):
        text = (
            "Ceasefire extends past May 4 without a formal new agreement. "
            "Probability I'd put on this: ~60%."
        )
        assert parse_confidence(text) == pytest.approx(0.6)

    def test_multiple_percentages_returns_first(self):
        """If multiple percentages, take the first (most likely the confidence)."""
        text = "About 30% of people agree, but Probability: ~65%."
        result = parse_confidence(text)
        # Should pick up 30% as the first match
        assert result == pytest.approx(0.3)

    def test_percentage_sign_required(self):
        """A bare number like '60' without % should not be parsed."""
        assert parse_confidence("about 60 chance") is None


# ===========================================================================
# 2. PARSE VERIFICATION DATE
# ===========================================================================


class TestParseVerificationDate:
    def test_by_date_with_trailing_text(self):
        result = parse_verification_date("By 2026-05-10. Check: has the ceasefire collapsed?")
        assert result == datetime.date(2026, 5, 10)

    def test_by_date_standalone(self):
        result = parse_verification_date("By 2026-05-05")
        assert result == datetime.date(2026, 5, 5)

    def test_no_date_returns_none(self):
        assert parse_verification_date("Check sometime later") is None

    def test_invalid_date_returns_none(self):
        assert parse_verification_date("By 2026-13-45") is None

    def test_multiple_dates_returns_first(self):
        text = "By 2026-05-10. Or maybe by 2026-06-01."
        assert parse_verification_date(text) == datetime.date(2026, 5, 10)

    def test_empty_string(self):
        assert parse_verification_date("") is None

    def test_date_without_by_prefix(self):
        """A raw YYYY-MM-DD should still be found."""
        result = parse_verification_date("2026-07-01. Check something.")
        assert result == datetime.date(2026, 7, 1)

    def test_date_with_extra_whitespace(self):
        result = parse_verification_date("By  2026-05-10 . Check something.")
        assert result == datetime.date(2026, 5, 10)


# ===========================================================================
# 3. PARSE PREDICTION FILE
# ===========================================================================


class TestParsePredictionFile:
    def test_two_predictions_from_sample(self, tmp_path):
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
        assert pred["title"] is not None
        assert "iran" in pred["title"].lower() or "ceasefire" in pred["title"].lower()

    def test_second_prediction_fields(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        pred = results[1]

        assert pred["confidence"] == pytest.approx(0.7)
        assert pred["resolution_date"] == datetime.date(2026, 5, 5)
        assert "FISA" in pred["title"] or "fisa" in pred["title"].lower()

    def test_date_made_from_filename(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        for pred in results:
            assert pred["date_made"] == datetime.date(2026, 4, 20)

    def test_empty_file_returns_empty_list(self, tmp_path):
        path = _write_md(tmp_path, "2026-01-01.md", "")
        assert parse_prediction_file(path) == []

    def test_preamble_only_no_sections(self, tmp_path):
        content = "# Predictions — 2026-04-20\n\nJust some thoughts, no ## sections."
        path = _write_md(tmp_path, "2026-04-20.md", content)
        assert parse_prediction_file(path) == []

    def test_outcome_correct(self, tmp_path):
        path = _write_md(tmp_path, "2026-05-01.md", _SAMPLE_WITH_OUTCOME)
        results = parse_prediction_file(path)
        assert results[0]["outcome"] is True

    def test_outcome_wrong(self, tmp_path):
        path = _write_md(tmp_path, "2026-05-01.md", _SAMPLE_WITH_OUTCOME)
        results = parse_prediction_file(path)
        assert results[1]["outcome"] is False

    def test_outcome_pending_is_none(self, tmp_path):
        path = _write_md(tmp_path, "2026-05-01.md", _SAMPLE_WITH_OUTCOME)
        results = parse_prediction_file(path)
        assert results[2]["outcome"] is None

    def test_resolution_section(self, tmp_path):
        """**Resolution:** should work the same as **Outcome:**"""
        path = _write_md(tmp_path, "2026-05-14.md", _SAMPLE_RESOLUTION)
        results = parse_prediction_file(path)
        assert len(results) == 1
        assert results[0]["outcome"] is True

    def test_malformed_file_no_crash(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-26.md", _SAMPLE_MALFORMED)
        results = parse_prediction_file(path)
        # Should return empty list or gracefully skip non-prediction sections
        assert isinstance(results, list)

    def test_unicode_in_predictions(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-26.md", _SAMPLE_UNICODE)
        results = parse_prediction_file(path)
        assert len(results) == 1
        assert "résultat" in results[0]["text"] or "positif" in results[0]["text"]
        assert results[0]["confidence"] == pytest.approx(0.75)

    def test_null_bytes_in_file_stripped(self, tmp_path):
        content = _SAMPLE_PREDICTION_FILE.replace("ceasefire", "cease\x00fire")
        path = _write_md(tmp_path, "2026-04-20.md", content)
        results = parse_prediction_file(path)
        for pred in results:
            assert "\x00" not in pred["text"]
            if pred.get("self_assessment"):
                assert "\x00" not in pred["self_assessment"]

    def test_self_assessment_from_how_im_wrong(self, tmp_path):
        path = _write_md(tmp_path, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        results = parse_prediction_file(path)
        pred = results[0]
        assert pred["self_assessment"] is not None
        assert "Bolton" in pred["self_assessment"] or "hawks" in pred["self_assessment"]

    def test_prediction_without_prediction_line_skipped(self, tmp_path):
        """A ## section with no **Prediction:** should be skipped."""
        content = """\
# Predictions — 2026-04-20

---

## 1. Section with no prediction line

**Reasoning:** Just reasoning with no prediction.

**Verification:** By 2026-06-01.

---

## 2. Normal prediction

**Prediction:** Something happens. Probability: ~50%.

**Verification:** By 2026-06-15.
"""
        path = _write_md(tmp_path, "2026-04-20.md", content)
        results = parse_prediction_file(path)
        # Only the second section should be a prediction
        assert len(results) == 1
        assert results[0]["confidence"] == pytest.approx(0.5)

    def test_date_made_falls_back_to_header(self, tmp_path):
        """If filename has no date, fall back to header date."""
        content = """\
# Predictions — 2026-04-20 evening session

---

## 1. Test prediction

**Prediction:** Something. Probability: ~50%.

**Verification:** By 2026-06-01.
"""
        path = _write_md(tmp_path, "random-name.md", content)
        results = parse_prediction_file(path)
        assert len(results) == 1
        assert results[0]["date_made"] == datetime.date(2026, 4, 20)


# ===========================================================================
# 4. STORE PREDICTION
# ===========================================================================


class TestStorePrediction:
    def test_insert_and_roundtrip(self, db_conn):
        pred = {
            "text": "Ceasefire extends past May 4.",
            "confidence": 0.6,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": datetime.date(2026, 5, 10),
            "outcome": None,
            "session_id": None,
            "self_assessment": "Hawks could push for confrontation.",
            "title": "US-Iran ceasefire",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT text, confidence, date_made, resolution_date, outcome, self_assessment "
            "FROM predictions WHERE date_made = %s AND text LIKE %s",
            (datetime.date(2026, 4, 20), "%Ceasefire%"),
        ).fetchone()
        assert row is not None
        assert row[0] == "Ceasefire extends past May 4."
        assert row[1] == pytest.approx(0.6)
        assert row[2] == datetime.date(2026, 4, 20)
        assert row[3] == datetime.date(2026, 5, 10)
        assert row[4] is None
        assert "Hawks" in row[5] or "hawks" in row[5]

    def test_idempotent_no_duplicate(self, db_conn):
        pred = {
            "text": "Short extension happens.",
            "confidence": 0.7,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": datetime.date(2026, 5, 5),
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
            "title": "FISA 702",
        }
        store_prediction(db_conn, pred)
        store_prediction(db_conn, pred)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM predictions WHERE date_made = %s AND text LIKE %s",
            (datetime.date(2026, 4, 20), "%extension%"),
        ).fetchone()[0]
        assert count == 1

    def test_null_confidence_and_dates(self, db_conn):
        pred = {
            "text": "Vague prediction with no details.",
            "confidence": None,
            "date_made": None,
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
            "title": "Vague",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT confidence, date_made, resolution_date FROM predictions WHERE text = %s",
            ("Vague prediction with no details.",),
        ).fetchone()
        assert row is not None
        assert row[0] is None
        assert row[1] is None
        assert row[2] is None

    def test_confidence_boundary_zero(self, db_conn):
        pred = {
            "text": "Zero confidence prediction.",
            "confidence": 0.0,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
            "title": "Zero",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT confidence FROM predictions WHERE text = %s",
            ("Zero confidence prediction.",),
        ).fetchone()
        assert row is not None
        assert row[0] == pytest.approx(0.0)

    def test_confidence_boundary_one(self, db_conn):
        pred = {
            "text": "Full confidence prediction.",
            "confidence": 1.0,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": None,
            "title": "Full",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT confidence FROM predictions WHERE text = %s",
            ("Full confidence prediction.",),
        ).fetchone()
        assert row is not None
        assert row[0] == pytest.approx(1.0)

    def test_null_bytes_stripped_from_text(self, db_conn):
        pred = {
            "text": "Prediction\x00with\x00nulls.",
            "confidence": 0.5,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": None,
            "self_assessment": "Assessment\x00here.",
            "title": "Nulls",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT text, self_assessment FROM predictions WHERE text LIKE %s",
            ("%Prediction%nulls%",),
        ).fetchone()
        assert row is not None
        assert "\x00" not in row[0]
        assert "\x00" not in row[1]

    def test_session_id_fk_enforced(self, db_conn):
        """session_id must reference a real session or be None."""
        pred = {
            "text": "FK test prediction.",
            "confidence": 0.5,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": "nonexistent-session-id",
            "self_assessment": None,
            "title": "FK test",
        }
        with pytest.raises(Exception):
            store_prediction(db_conn, pred)
        db_conn.rollback()

    def test_session_id_valid_fk(self, db_conn):
        """session_id referencing a real session should work."""
        _insert_session(db_conn, "session-pred-test", datetime.date(2026, 4, 20))
        pred = {
            "text": "Prediction with session.",
            "confidence": 0.5,
            "date_made": datetime.date(2026, 4, 20),
            "resolution_date": None,
            "outcome": None,
            "session_id": "session-pred-test",
            "self_assessment": None,
            "title": "With session",
        }
        store_prediction(db_conn, pred)

        row = db_conn.execute(
            "SELECT session_id FROM predictions WHERE text = %s",
            ("Prediction with session.",),
        ).fetchone()
        assert row is not None
        assert row[0] == "session-pred-test"


# ===========================================================================
# 5. EXTRACT ALL PREDICTIONS
# ===========================================================================


class TestExtractAll:
    def test_two_files_correct_total(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        _write_md(pred_dir, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        _write_md(pred_dir, "2026-05-01.md", _SAMPLE_WITH_OUTCOME)

        count = extract_all_predictions(pred_dir, db_conn)
        # 2 from first file + 3 from second file = 5
        assert count == 5

    def test_empty_directory(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        count = extract_all_predictions(pred_dir, db_conn)
        assert count == 0

    def test_idempotent_run_twice(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        _write_md(pred_dir, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)

        count1 = extract_all_predictions(pred_dir, db_conn)
        count2 = extract_all_predictions(pred_dir, db_conn)

        assert count1 == count2 == 2

        total = db_conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
        assert total == 2, "Duplicate rows created on second run"

    def test_non_md_files_ignored(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        _write_md(pred_dir, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        (pred_dir / "notes.txt").write_text("not predictions")
        (pred_dir / "README").write_text("also not predictions")

        count = extract_all_predictions(pred_dir, db_conn)
        assert count == 2

    def test_all_stored_in_db(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        _write_md(pred_dir, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)

        extract_all_predictions(pred_dir, db_conn)

        rows = db_conn.execute("SELECT text, confidence FROM predictions ORDER BY id").fetchall()
        assert len(rows) == 2
        # First prediction
        assert rows[0][1] == pytest.approx(0.6)
        # Second prediction
        assert rows[1][1] == pytest.approx(0.7)

    def test_outcomes_stored_correctly(self, tmp_path, db_conn):
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        _write_md(pred_dir, "2026-05-01.md", _SAMPLE_WITH_OUTCOME)

        extract_all_predictions(pred_dir, db_conn)

        rows = db_conn.execute("SELECT outcome FROM predictions ORDER BY id").fetchall()
        assert rows[0][0] is True
        assert rows[1][0] is False
        assert rows[2][0] is None

    def test_unreadable_file_skipped(self, tmp_path, db_conn):
        """Unreadable file should be skipped, not crash."""
        pred_dir = tmp_path / "predictions"
        pred_dir.mkdir()
        _write_md(pred_dir, "2026-04-20.md", _SAMPLE_PREDICTION_FILE)
        bad = _write_md(pred_dir, "2026-04-26.md", "# Predictions\n\n## 1. Bad\n")
        bad.chmod(0o000)

        try:
            count = extract_all_predictions(pred_dir, db_conn)
            assert count >= 2  # At least the good file's predictions
        finally:
            bad.chmod(0o644)
