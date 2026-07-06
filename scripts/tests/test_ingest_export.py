"""Hostile tests for scripts/ingest.py Stage-2 export wrapper (NOT yet implemented — RED).

Covers:
  - ExportReport dataclass: written / blocked / quotes_verified / errors and
    the `ok` property truth table (blocked → False; errors → False;
    quotes_verified False → False; clean → True).
  - run_export(conn, cfg, force=False): exports via export_all into a FRESH
    temp dir, moves results into cfg.output_dir with temp-then-move
    atomicity, record-count semantics (list → len; dict → sum of len of
    top-level list values), a quotes.json integrity guard (sha256 before /
    after, refuse-to-move when the export produces a quotes.json), and a
    shrink guard (new 0 over old >0 blocked unless force=True).
  - run_export never raises for operational failures — everything lands in
    the report.

The functions under test do not exist yet, so the import below fails at
collection time — that is the intended RED state.

Deviations / decisions (spec ambiguities resolved; documented per convention):
  - quotes_verified when the PRE-move clobber guard trips is NOT pinned: the
    contract assigns quotes_verified semantics only to the post-move re-hash.
    Clobber tests pin errors["quotes"], untouched bytes, written == {}, and
    ok False instead.
  - A pre-existing file that parses as JSON but is neither list nor dict
    (e.g. `42`): the contract defines counts only for list/dict and None only
    for parse failures. Pinned: no crash, file overwritten, NOT blocked,
    new_count 0; old_count accepted as either 0 or None.
  - errors keys for non-quotes operational failures (mid-export exception,
    unwritable output_dir) are unspecified: tests pin errors non-empty with
    str values, and that the exception message survives into some value.
  - "fresh temp dir" is pinned as: not inside output_dir, empty if it exists
    when export_all is called, distinct across runs, and gone afterwards.
  - Count semantics are TYPE-based, not filename-based: a dict-shaped
    messages.json counts the sum of its top-level list values (and can
    therefore trip the shrink guard).
  - written/blocked keys are pinned to bare filenames (the contract's own
    examples use filenames, e.g. "memory-snapshots.json").
  - Connection hygiene: run_export must leave the shared connection out of
    INTRANS (repo convention per table_counts docstring); pinned in its own
    test so a failure is legible as a convention, not a contract, breach.
  - chmod-based tests are skipped when running as root (root ignores mode).
"""

import dataclasses
import datetime
import json
import os
import pathlib

import pytest

from psycopg.pq import TransactionStatus

import scripts.prebuild_export as prebuild_export_module
from scripts.ingest import (  # noqa: F401  (RED: names absent)
    ExportReport,
    IngestConfig,
    run_export,
)

not_root = pytest.mark.skipif(os.geteuid() == 0, reason="chmod is not enforced for root")

# The six files export_all produces, in export order.
FILES = (
    "sessions.json",
    "writing-metadata.json",
    "messages.json",
    "predictions.json",
    "pet-timeline.json",
    "memory-snapshots.json",
)

EMPTY_PAYLOADS = {
    "sessions.json": [],
    "writing-metadata.json": [],
    "messages.json": [],
    "predictions.json": [],
    "pet-timeline.json": [],
    "memory-snapshots.json": {"snapshots": [], "blocks": []},
}

# Sentinel quotes.json bytes: unicode, RTL, emoji, no trailing newline —
# any re-encode / re-serialize / newline-append shows up as a byte diff.
QUOTES_SENTINEL = (
    '[{"quote": "יהי אור 🌱", "source": "curated"}, '
    '{"quote": "مرحبا — hand-picked", "source": "council"}]'
).encode("utf-8")


# ===========================================================================
# Helpers
# ===========================================================================


def _cfg(tmp_path, out=None):
    """Config whose output_dir is safely inside tmp_path. Returns (cfg, out)."""
    out = pathlib.Path(out) if out is not None else tmp_path / "out"
    cfg = IngestConfig(source_root=tmp_path / "srcroot", output_dir=out)
    assert pathlib.Path(cfg.output_dir) == out
    return cfg, out


def _dump_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _memory_payload(n_snapshots, n_blocks):
    """A plausible pre-existing memory-snapshots.json with given list sizes."""
    return {
        "snapshots": [
            {"session_id": f"s{i}", "date": "2026-01-01", "token_count": 100, "block_hashes": []}
            for i in range(n_snapshots)
        ],
        "blocks": [
            {"hash": f"h{i}", "heading": "H", "first_seen_date": None, "last_seen_date": None}
            for i in range(n_blocks)
        ],
    }


def _write_minimal_exports(out_dir, extra=()):
    """Write the six standard export files (empty payloads) into out_dir.

    `extra` is an iterable of (filename, text) additionally written.
    Returns the six standard paths in export order (extras NOT included).
    """
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in FILES:
        p = out_dir / name
        _dump_json(p, EMPTY_PAYLOADS[name])
        paths.append(p)
    for name, text in extra:
        (out_dir / name).write_text(text, encoding="utf-8")
    return paths


def _snapshot_dir(path):
    """{filename: bytes} for every regular file directly inside path."""
    path = pathlib.Path(path)
    if not path.is_dir():
        return {}
    return {p.name: p.read_bytes() for p in path.iterdir() if p.is_file()}


# --- DB seeding (minimal valid rows; see migrations/001, 002) --------------


def _seed_session(conn, session_id="sess-2026-01-01-am", date=datetime.date(2026, 1, 1)):
    # NOTE: id must not start with "test" — export_sessions drops those.
    conn.execute(
        """
        INSERT INTO sessions (id, date, time_of_day, version, source_type,
                              source_file, timestamp_start, turns)
        VALUES (%s, %s, 'AM', '4.6', 'jsonl', %s, %s, 5)
        """,
        (
            session_id,
            date,
            f"activity-{date.isoformat()}.jsonl",
            datetime.datetime(date.year, date.month, date.day, 10, 0, tzinfo=datetime.UTC),
        ),
    )
    conn.commit()
    return session_id


def _seed_composition(conn, session_id, slug="on-continuity"):
    conn.execute(
        """
        INSERT INTO compositions (slug, filename, title, date_written, session_id,
                                  version, size_bytes, content, topic)
        VALUES (%s, %s, 'On Continuity', %s, %s, '4.6', 1234, 'body', 'identity')
        """,
        (slug, f"{slug}.md", datetime.date(2026, 1, 1), session_id),
    )
    conn.commit()


def _seed_message(conn, content="hello james", direction="to_james"):
    conn.execute(
        """
        INSERT INTO messages (direction, date, content, line_start, line_end)
        VALUES (%s, %s, %s, 1, 3)
        """,
        (direction, datetime.date(2026, 1, 2), content),
    )
    conn.commit()


def _seed_prediction(conn, text="the fern survives the month"):
    conn.execute(
        """
        INSERT INTO predictions (text, confidence, date_made)
        VALUES (%s, 0.7, %s)
        """,
        (text, datetime.date(2026, 1, 3)),
    )
    conn.commit()


def _seed_pet_event(conn, pet_name="fern"):
    conn.execute(
        """
        INSERT INTO pet_events (pet_name, event_type, event_timestamp, notes)
        VALUES (%s, 'acquired', %s, 'adopted')
        """,
        (pet_name, datetime.datetime(2026, 1, 4, 9, 0, tzinfo=datetime.UTC)),
    )
    conn.commit()


def _seed_memory_snapshot(conn, session_id, date=datetime.date(2026, 1, 1)):
    row = conn.execute(
        """
        INSERT INTO memory_snapshots (session_id, date, full_content, token_count)
        VALUES (%s, %s, '# MEMORY', 42)
        RETURNING id
        """,
        (session_id, date),
    ).fetchone()
    conn.commit()
    return row[0]


def _seed_memory_block(conn, block_hash="abc123"):
    row = conn.execute(
        """
        INSERT INTO memory_blocks (block_hash, heading, content)
        VALUES (%s, 'Identity', 'block body')
        RETURNING id
        """,
        (block_hash,),
    ).fetchone()
    conn.commit()
    return row[0]


def _seed_one_of_each(conn):
    """One session + FK'd composition, one message, prediction, pet event.

    Memory tables stay empty. Expected new counts:
    sessions 1, writing 1, messages 1, predictions 1, pets 1, memory 0.
    """
    sid = _seed_session(conn)
    _seed_composition(conn, sid)
    _seed_message(conn)
    _seed_prediction(conn)
    _seed_pet_event(conn)
    return sid


# ===========================================================================
# ExportReport unit tests — ok truth table, mutable-default hygiene
# ===========================================================================


def test_report_default_is_not_ok():
    # quotes_verified defaults False, so a fresh report is NOT ok.
    report = ExportReport()
    assert report.written == {}
    assert report.blocked == {}
    assert report.errors == {}
    assert report.quotes_verified is False
    assert report.ok is False


def test_report_clean_with_quotes_verified_is_ok():
    report = ExportReport(quotes_verified=True)
    assert report.ok is True


def test_report_written_entries_do_not_affect_ok():
    report = ExportReport(
        written={"sessions.json": (None, 10), "messages.json": (3, 0)},
        quotes_verified=True,
    )
    assert report.ok is True


def test_report_blocked_forces_not_ok():
    report = ExportReport(blocked={"memory-snapshots.json": (5, 0)}, quotes_verified=True)
    assert report.ok is False


def test_report_errors_force_not_ok():
    report = ExportReport(errors={"quotes": "hash mismatch"}, quotes_verified=True)
    assert report.ok is False


def test_report_blocked_and_errors_together_not_ok():
    report = ExportReport(
        blocked={"sessions.json": (1, 0)},
        errors={"export": "boom"},
        quotes_verified=True,
    )
    assert report.ok is False


def test_report_quotes_unverified_alone_not_ok():
    report = ExportReport(written={"sessions.json": (None, 1)}, quotes_verified=False)
    assert report.ok is False


def test_report_instances_do_not_share_mutable_defaults():
    r1 = ExportReport()
    r2 = ExportReport()
    r1.written["sessions.json"] = (None, 1)
    r1.blocked["messages.json"] = (2, 0)
    r1.errors["quotes"] = "bad"
    assert r2.written == {}
    assert r2.blocked == {}
    assert r2.errors == {}


def test_report_is_a_dataclass_with_expected_fields():
    names = {f.name for f in dataclasses.fields(ExportReport)}
    assert {"written", "blocked", "quotes_verified", "errors"} <= names


# ===========================================================================
# run_export — happy path, counts, second-run old/new
# ===========================================================================


def test_first_export_seeded_db_writes_six_files(db_conn, tmp_path):
    _seed_one_of_each(db_conn)
    cfg, out = _cfg(tmp_path)

    report = run_export(db_conn, cfg)

    assert isinstance(report, ExportReport)
    # Exactly the six files — no temp litter, no quotes.json conjured up.
    assert {p.name for p in out.iterdir()} == set(FILES)
    assert not (out / "quotes.json").exists()

    sessions = _read_json(out / "sessions.json")
    assert [s["id"] for s in sessions] == ["sess-2026-01-01-am"]
    messages = _read_json(out / "messages.json")
    assert [m["content"] for m in messages] == ["hello james"]
    memory = _read_json(out / "memory-snapshots.json")
    assert memory == {"snapshots": [], "blocks": []}

    assert report.written == {
        "sessions.json": (None, 1),
        "writing-metadata.json": (None, 1),
        "messages.json": (None, 1),
        "predictions.json": (None, 1),
        "pet-timeline.json": (None, 1),
        "memory-snapshots.json": (None, 0),
    }
    assert report.blocked == {}
    assert report.errors == {}
    assert report.quotes_verified is True
    assert report.ok is True


def test_second_export_reports_previous_counts_as_old(db_conn, tmp_path):
    _seed_one_of_each(db_conn)
    cfg, out = _cfg(tmp_path)

    first = run_export(db_conn, cfg)
    second = run_export(db_conn, cfg)

    assert second.ok is True
    assert set(second.written) == set(FILES)
    for name in FILES:
        old, new = second.written[name]
        assert old == first.written[name][1], name
        assert new == first.written[name][1], name
    assert second.blocked == {}
    assert second.errors == {}


def test_empty_db_no_preexisting_writes_six_empty_files(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)

    report = run_export(db_conn, cfg)

    assert {p.name for p in out.iterdir()} == set(FILES)
    for name in FILES:
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name
    assert report.written == {name: (None, 0) for name in FILES}
    assert report.blocked == {}
    assert report.errors == {}
    assert report.ok is True


def test_output_dir_missing_is_created_with_parents(db_conn, tmp_path):
    out = tmp_path / "deep" / "nested" / "data"
    assert not out.exists()
    cfg, out = _cfg(tmp_path, out=out)

    report = run_export(db_conn, cfg)

    assert out.is_dir()
    assert {p.name for p in out.iterdir()} == set(FILES)
    assert report.ok is True


def test_dict_count_is_sum_of_top_level_lists(db_conn, tmp_path):
    # DB: 2 snapshots + 1 block (+ presence row, which must NOT be counted)
    # → new_count 3. Pre-existing file: 1 snapshot + 1 block → old_count 2.
    sid = _seed_session(db_conn)
    snap1 = _seed_memory_snapshot(db_conn, sid, datetime.date(2026, 1, 1))
    _seed_memory_snapshot(db_conn, sid, datetime.date(2026, 1, 2))
    block = _seed_memory_block(db_conn)
    db_conn.execute(
        "INSERT INTO memory_block_presence (snapshot_id, block_id) VALUES (%s, %s)",
        (snap1, block),
    )
    db_conn.commit()

    cfg, out = _cfg(tmp_path)
    _dump_json(out / "memory-snapshots.json", _memory_payload(1, 1))

    report = run_export(db_conn, cfg)

    assert report.written["memory-snapshots.json"] == (2, 3)
    assert "memory-snapshots.json" not in report.blocked
    exported = _read_json(out / "memory-snapshots.json")
    assert len(exported["snapshots"]) == 2
    assert len(exported["blocks"]) == 1


def test_unicode_rtl_emoji_message_survives_roundtrip(db_conn, tmp_path):
    content = "مرحبا 🌍 שלום ‏world — 👩‍👩‍👧‍👧 (ZWJ) \U0001f9ecgenome"
    _seed_message(db_conn, content=content)
    cfg, out = _cfg(tmp_path)

    report = run_export(db_conn, cfg)

    assert report.ok is True
    messages = _read_json(out / "messages.json")
    assert [m["content"] for m in messages] == [content]


def test_run_export_leaves_connection_usable(db_conn, tmp_path):
    # Repo convention: helpers must not leave the shared connection INTRANS
    # (see table_counts docstring in scripts/ingest.py).
    cfg, _ = _cfg(tmp_path)
    run_export(db_conn, cfg)
    assert db_conn.info.transaction_status == TransactionStatus.IDLE


# ===========================================================================
# quotes.json guard
# ===========================================================================


def test_sentinel_quotes_json_byte_identical_and_verified(db_conn, tmp_path):
    _seed_one_of_each(db_conn)
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)

    report = run_export(db_conn, cfg)

    assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
    assert report.quotes_verified is True
    assert report.ok is True
    # quotes.json is not an exported file — must not appear in the ledgers.
    assert "quotes.json" not in report.written
    assert "quotes.json" not in report.blocked
    assert set(report.written) == set(FILES)


def test_export_writing_quotes_json_blocks_entire_move(db_conn, tmp_path, monkeypatch):
    # Adversarial export_all writes a quotes.json into the temp dir but does
    # NOT return it — the temp-dir-contents branch of the guard must bite.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
    sessions_sentinel = b'[{"id": "pre-existing"}]'
    (out / "sessions.json").write_bytes(sessions_sentinel)
    before = _snapshot_dir(out)

    def clobbering_export_all(conn, output_dir):
        return _write_minimal_exports(
            output_dir, extra=[("quotes.json", '["MACHINE-GENERATED CLOBBER"]')]
        )

    monkeypatch.setattr("scripts.ingest.export_all", clobbering_export_all)

    report = run_export(db_conn, cfg)

    # NOTHING moved: output_dir byte-for-byte as before.
    assert _snapshot_dir(out) == before
    assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
    assert (out / "sessions.json").read_bytes() == sessions_sentinel
    assert "quotes" in report.errors
    assert isinstance(report.errors["quotes"], str) and report.errors["quotes"]
    assert report.written == {}
    assert report.ok is False


def test_returned_quotes_path_alone_blocks_entire_move(db_conn, tmp_path, monkeypatch):
    # The OTHER branch: export_all merely RETURNS a quotes.json path (the
    # file is never written to the temp dir). Guard must still bite, even
    # with no pre-existing quotes.json to protect.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    writing_sentinel = b'[{"slug": "pre-existing"}]'
    (out / "writing-metadata.json").write_bytes(writing_sentinel)
    before = _snapshot_dir(out)

    def phantom_quotes_export_all(conn, output_dir):
        paths = _write_minimal_exports(output_dir)
        return paths + [pathlib.Path(output_dir) / "quotes.json"]

    monkeypatch.setattr("scripts.ingest.export_all", phantom_quotes_export_all)

    report = run_export(db_conn, cfg)

    assert _snapshot_dir(out) == before
    assert (out / "writing-metadata.json").read_bytes() == writing_sentinel
    for name in FILES:
        if name != "writing-metadata.json":
            assert not (out / name).exists(), name
    assert "quotes" in report.errors
    assert report.written == {}
    assert report.ok is False


def test_quotes_changed_after_move_is_detected(db_conn, tmp_path, monkeypatch):
    # Post-move verification: something (here: export_all itself, standing in
    # for a concurrent writer) rewrites output_dir/quotes.json between the
    # pre-hash and the re-hash. The temp dir never contains a quotes.json,
    # so the move proceeds — the re-hash must then flag the mismatch.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)

    def concurrent_clobber_export_all(conn, output_dir):
        paths = _write_minimal_exports(output_dir)
        (out / "quotes.json").write_bytes(b'["silently swapped"]')
        return paths

    monkeypatch.setattr("scripts.ingest.export_all", concurrent_clobber_export_all)

    report = run_export(db_conn, cfg)

    assert "quotes" in report.errors
    assert report.quotes_verified is False
    assert report.ok is False
    # The move itself was normal — the six files were written and recorded.
    assert set(report.written) == set(FILES)
    for name in FILES:
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name


# ===========================================================================
# Shrink guard
# ===========================================================================


def test_shrink_guard_blocks_zero_over_nonzero(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    payload = _memory_payload(3, 2)  # count 5
    _dump_json(out / "memory-snapshots.json", payload)
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
    pre_bytes = (out / "memory-snapshots.json").read_bytes()

    # DB fully empty → memory-snapshots new_count 0.
    report = run_export(db_conn, cfg)

    assert report.blocked == {"memory-snapshots.json": (5, 0)}
    assert (out / "memory-snapshots.json").read_bytes() == pre_bytes
    assert "memory-snapshots.json" not in report.written
    # The other five files are unaffected by the block.
    assert set(report.written) == set(FILES) - {"memory-snapshots.json"}
    for name in set(FILES) - {"memory-snapshots.json"}:
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name
    # Quotes untouched and verified; ok False comes from blocked ALONE.
    assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
    assert report.quotes_verified is True
    assert report.errors == {}
    assert report.ok is False


def test_force_overrides_shrink_guard(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    _dump_json(out / "memory-snapshots.json", _memory_payload(3, 2))

    report = run_export(db_conn, cfg, force=True)

    assert report.blocked == {}
    assert report.written["memory-snapshots.json"] == (5, 0)
    assert _read_json(out / "memory-snapshots.json") == {"snapshots": [], "blocks": []}
    assert report.errors == {}
    assert report.ok is True


def test_shrink_guard_not_fired_on_growth_equal_zero_and_missing(db_conn, tmp_path):
    # growth: messages 1 → 2; equal: predictions 1 → 1; 0→0: pet-timeline
    # [] → []; missing pre-existing with new 0: sessions, writing, memory.
    _seed_message(db_conn, content="first")
    _seed_message(db_conn, content="second")
    _seed_prediction(db_conn)

    cfg, out = _cfg(tmp_path)
    _dump_json(out / "messages.json", [{"content": "old"}])
    _dump_json(out / "predictions.json", [{"text": "old"}])
    _dump_json(out / "pet-timeline.json", [])

    report = run_export(db_conn, cfg)

    assert report.blocked == {}
    assert report.written == {
        "sessions.json": (None, 0),
        "writing-metadata.json": (None, 0),
        "messages.json": (1, 2),
        "predictions.json": (1, 1),
        "pet-timeline.json": (0, 0),
        "memory-snapshots.json": (None, 0),
    }
    assert report.errors == {}
    assert report.ok is True
    assert [m["content"] for m in _read_json(out / "messages.json")] == ["first", "second"]


def test_dict_shaped_preexisting_list_file_counts_lists_and_can_block(db_conn, tmp_path):
    # Count semantics are type-based: a dict-shaped messages.json with a
    # 3-element top-level list counts 3, so an empty DB must trip the guard.
    cfg, out = _cfg(tmp_path)
    _dump_json(out / "messages.json", {"messages": [1, 2, 3], "meta": "x"})
    pre_bytes = (out / "messages.json").read_bytes()

    report = run_export(db_conn, cfg)

    assert report.blocked == {"messages.json": (3, 0)}
    assert (out / "messages.json").read_bytes() == pre_bytes
    assert "messages.json" not in report.written
    assert report.ok is False


def test_corrupt_preexisting_json_gets_old_none_and_is_overwritten(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    # Invalid UTF-8 AND invalid JSON.
    (out / "messages.json").write_bytes(b"\x80\x81 not json {{{" + bytes([0]))

    report = run_export(db_conn, cfg)

    # old_count None → shrink guard must NOT fire; file is overwritten.
    assert report.written["messages.json"] == (None, 0)
    assert "messages.json" not in report.blocked
    assert _read_json(out / "messages.json") == []
    assert report.ok is True


def test_preexisting_dict_with_no_list_values_counts_zero(db_conn, tmp_path):
    # Only top-level lists count — nested lists do not. old 0, new 0 → written.
    cfg, out = _cfg(tmp_path)
    _dump_json(
        out / "memory-snapshots.json",
        {"a": 1, "b": "xy", "c": {"inner": [1, 2, 3]}, "d": None},
    )

    report = run_export(db_conn, cfg)

    assert report.written["memory-snapshots.json"] == (0, 0)
    assert "memory-snapshots.json" not in report.blocked
    assert _read_json(out / "memory-snapshots.json") == {"snapshots": [], "blocks": []}
    assert report.ok is True


def test_preexisting_scalar_json_does_not_crash(db_conn, tmp_path):
    # Parses as JSON but is neither list nor dict. Contract leaves old_count
    # open (0 or None accepted); pinned: no raise, not blocked, overwritten.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "messages.json").write_text("42\n", encoding="utf-8")

    report = run_export(db_conn, cfg)

    assert "messages.json" not in report.blocked
    assert "messages.json" in report.written
    old, new = report.written["messages.json"]
    assert old in (0, None)
    assert new == 0
    assert _read_json(out / "messages.json") == []


# ===========================================================================
# Temp-then-move atomicity, temp hygiene
# ===========================================================================


def test_midexport_failure_leaves_output_dir_untouched(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "sessions.json").write_bytes(b'[{"id": "keep-me"}]')
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
    before = _snapshot_dir(out)
    captured = {}

    def failing_export_all(conn, output_dir):
        d = pathlib.Path(output_dir)
        captured["temp"] = d
        d.mkdir(parents=True, exist_ok=True)
        _dump_json(d / "sessions.json", [])
        _dump_json(d / "messages.json", [])
        raise RuntimeError("boom: disk full mid-export")

    monkeypatch.setattr("scripts.ingest.export_all", failing_export_all)

    report = run_export(db_conn, cfg)  # must not raise

    # No file created, mutated, or half-moved; no temp litter in output_dir.
    assert _snapshot_dir(out) == before
    assert not any(p.is_dir() for p in out.iterdir())
    assert report.written == {}
    assert report.blocked == {}
    assert report.errors != {}
    assert all(isinstance(v, str) for v in report.errors.values())
    assert any("boom" in v for v in report.errors.values())
    assert report.ok is False
    # The temp dir itself was cleaned up despite the exception.
    assert "temp" in captured and not captured["temp"].exists()


def test_temp_dir_is_fresh_outside_output_dir_and_cleaned(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)
    real_export_all = prebuild_export_module.export_all
    captured = []

    def spying_export_all(conn, output_dir):
        d = pathlib.Path(output_dir)
        captured.append(d)
        if d.exists():
            assert list(d.iterdir()) == [], "temp dir handed to export_all is not fresh"
        return real_export_all(conn, d)

    monkeypatch.setattr("scripts.ingest.export_all", spying_export_all)

    report1 = run_export(db_conn, cfg)
    report2 = run_export(db_conn, cfg)

    assert report1.ok is True and report2.ok is True
    assert len(captured) == 2
    out_resolved = out.resolve()
    for d in captured:
        resolved = d.resolve()
        assert resolved != out_resolved
        assert not resolved.is_relative_to(out_resolved), (
            f"temp dir {resolved} lives inside output_dir — partial state is visible"
        )
        assert not d.exists(), f"temp dir {d} was not cleaned up"
    assert captured[0].resolve() != captured[1].resolve(), "temp dir reused across runs"
    assert {p.name for p in out.iterdir()} == set(FILES)


# ===========================================================================
# Operational failures never escape
# ===========================================================================


@not_root
def test_unwritable_output_dir_reports_error_without_raising(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    out.chmod(0o500)
    try:
        report = run_export(db_conn, cfg)  # must not raise
    finally:
        out.chmod(0o700)

    assert report.errors != {}
    assert all(isinstance(v, str) for v in report.errors.values())
    assert report.ok is False
    # No partial state: nothing landed in the unwritable directory.
    assert list(out.iterdir()) == []


def test_output_dir_is_a_regular_file_reports_error_without_raising(db_conn, tmp_path):
    blocker = tmp_path / "not-a-dir"
    blocker.write_bytes(b"I am a file, not a directory")
    cfg, _ = _cfg(tmp_path, out=blocker)

    report = run_export(db_conn, cfg)  # must not raise

    assert report.errors != {}
    assert report.ok is False
    assert blocker.read_bytes() == b"I am a file, not a directory"


# ===========================================================================
# HARDENING ROUND 2 — adversarial extensions (first-attempt GREEN means the
# suite above was too polite; everything below is designed to break the
# implementation, not confirm it).
#
# Additional pinned decisions:
#   - Report-vs-disk invariant: every filename in `written` must exist in
#     output_dir as a REGULAR FILE; every filename in `blocked` must be
#     byte-identical to its pre-run content; no filename may appear in both
#     buckets. Enforced via _assert_report_matches_disk in several tests.
#   - A destination occupied by a DIRECTORY is an operational failure:
#     errors non-empty, ok False, the directory survives, and export content
#     is never deposited INSIDE it. shutil.move's silently-nest-into-a-dir
#     behavior must not be laundered into a `written` claim.
#   - force=True overrides ONLY the shrink guard. The quotes guard is
#     absolute: force must never let a pipeline-produced quotes.json through.
#   - The shrink guard is type-agnostic in BOTH directions (dict→list and
#     list→dict count changes) and fires for scalar/degenerate new payloads
#     (null / "string" / 42 → 0 records) and for unparseable staged bytes
#     (garbage export must not replace a good baseline).
#   - BOM-prefixed pre-existing JSON: outcome branch not pinned (utf-8-sig
#     parse → blocked, or unparseable → old None → overwritten are both
#     coherent); pinned instead: no crash + filename in exactly one bucket +
#     report-vs-disk consistency.
#   - Rogue/extra staged files: moved-and-reported or ignored are both
#     acceptable, but never half-handled, and never allowed to bypass the
#     shrink guard over a populated pre-existing file of the same name.
#   - Garbage export_all return values (nonexistent, duplicate, absolute,
#     None, non-iterable): no crash, and nothing outside staging+output_dir
#     is touched.
#   - Connection hygiene (never INTRANS) is pinned on FAILURE paths too,
#     with the fake exporter opening an implicit transaction first so the
#     rollback obligation is real, not vacuous.
# ===========================================================================


def _assert_report_matches_disk(report, out_dir, before):
    """Report-vs-disk consistency invariant.

    `before` is a _snapshot_dir(out_dir) taken immediately before run_export.
    """
    out_dir = pathlib.Path(out_dir)
    overlap = set(report.written) & set(report.blocked)
    assert overlap == set(), f"files reported both written AND blocked: {overlap}"
    for name in report.written:
        p = out_dir / name
        assert p.is_file(), f"{name} reported written but {p} is not a regular file on disk"
    for name in report.blocked:
        assert name in before, f"{name} reported blocked but no pre-existing baseline was on disk"
        assert (out_dir / name).read_bytes() == before[name], (
            f"{name} reported blocked but its bytes changed — guard claimed to "
            f"protect a file it clobbered"
        )


def _fake_export_all(overrides):
    """export_all replacement writing the six files with per-file overrides.

    `overrides` maps filename → payload; bytes are written raw, anything else
    is JSON-dumped. Unlisted files get their EMPTY_PAYLOADS default.
    """

    def fake(conn, output_dir):
        d = pathlib.Path(output_dir)
        d.mkdir(parents=True, exist_ok=True)
        paths = []
        for name in FILES:
            p = d / name
            payload = overrides.get(name, EMPTY_PAYLOADS[name])
            if isinstance(payload, bytes):
                p.write_bytes(payload)
            else:
                _dump_json(p, payload)
            paths.append(p)
        return paths

    return fake


# --- 1. force=True must not override the quotes guard ----------------------


def test_force_true_does_not_override_quotes_guard(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
    (out / "sessions.json").write_bytes(b'[{"id": "pre-existing"}]')
    before = _snapshot_dir(out)

    def clobbering_export_all(conn, output_dir):
        return _write_minimal_exports(
            output_dir, extra=[("quotes.json", '["MACHINE CLOBBER under force"]')]
        )

    monkeypatch.setattr("scripts.ingest.export_all", clobbering_export_all)

    report = run_export(db_conn, cfg, force=True)

    # force widens the shrink guard ONLY — quotes abort must be absolute.
    assert _snapshot_dir(out) == before
    assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
    assert "quotes" in report.errors
    assert report.written == {}
    assert report.blocked == {}
    assert report.ok is False


# --- 2. Move-phase atomicity: hostile destinations --------------------------


def test_destination_directory_is_never_silently_nested_into(db_conn, tmp_path):
    # shutil.move(src, dst) where dst is an existing DIRECTORY does not fail —
    # it moves src INSIDE dst. That must not be laundered into `written`.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "sessions.json").mkdir()  # destination name occupied by a directory
    before = _snapshot_dir(out)

    report = run_export(db_conn, cfg)  # empty DB, real exporter; must not raise

    assert "sessions.json" not in report.written, (
        "report claims sessions.json was written, but the destination is a directory"
    )
    assert (out / "sessions.json").is_dir()
    assert not (out / "sessions.json" / "sessions.json").exists(), (
        "export content was deposited INSIDE the foreign directory"
    )
    assert report.errors != {}
    assert report.ok is False
    _assert_report_matches_disk(report, out, before)
    # RECONCILED to the total-accounting contract (see final section): the
    # failure is keyed by the FILENAME, never by a fixed "move" key, and
    # every staged file is accounted for across written ∪ blocked ∪ errors.
    assert "sessions.json" in report.errors
    assert "move" not in report.errors
    _assert_total_accounting(report)


def test_one_unmovable_destination_yields_error_and_consistent_report(db_conn, tmp_path):
    # Destination dir CONTAINING a same-named file forces shutil.move to
    # raise. Other destinations are fine; the report must stay coherent:
    # everything claimed written is really on disk, nothing more.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    trap = out / "sessions.json"
    trap.mkdir()
    (trap / "sessions.json").write_bytes(b"occupied")
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
    before = _snapshot_dir(out)

    report = run_export(db_conn, cfg)  # must not raise

    assert report.errors != {}
    assert report.ok is False
    assert "sessions.json" not in report.written
    assert (trap / "sessions.json").read_bytes() == b"occupied"
    assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
    _assert_report_matches_disk(report, out, before)
    # Whatever WAS claimed written must carry the new export content.
    for name in report.written:
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name
    # RECONCILED to the total-accounting contract (see final section):
    # regardless of which branch fires (dir-collision or OSError), the error
    # is keyed by the FILENAME — never the fixed "move" key — and all six
    # staged files are accounted for across written ∪ blocked ∪ errors.
    assert "sessions.json" in report.errors
    assert "move" not in report.errors
    _assert_total_accounting(report)


# --- 3. Symlink hostility ----------------------------------------------------


def test_symlinked_quotes_json_is_verified_and_target_untouched(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    target = tmp_path / "curated" / "quotes-real.json"
    target.parent.mkdir(parents=True)
    target.write_bytes(QUOTES_SENTINEL)
    (out / "quotes.json").symlink_to(target)

    report = run_export(db_conn, cfg)

    assert (out / "quotes.json").is_symlink(), "symlink was replaced by a regular file"
    assert target.read_bytes() == QUOTES_SENTINEL
    assert report.quotes_verified is True
    assert report.ok is True
    assert "quotes.json" not in report.written
    assert "quotes.json" not in report.blocked


def test_symlinked_quotes_target_rewrite_is_detected(db_conn, tmp_path, monkeypatch):
    # The guard must verify the BYTES the path serves: rewriting the symlink
    # TARGET (path itself untouched) must still trip the post-move re-hash.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    target = tmp_path / "curated" / "quotes-real.json"
    target.parent.mkdir(parents=True)
    target.write_bytes(QUOTES_SENTINEL)
    (out / "quotes.json").symlink_to(target)

    def target_rewriting_export_all(conn, output_dir):
        paths = _write_minimal_exports(output_dir)
        target.write_bytes(b'["swapped behind the symlink"]')
        return paths

    monkeypatch.setattr("scripts.ingest.export_all", target_rewriting_export_all)

    report = run_export(db_conn, cfg)

    assert "quotes" in report.errors
    assert report.quotes_verified is False
    assert report.ok is False


def test_output_dir_that_is_a_symlink_to_a_real_dir_works(db_conn, tmp_path):
    real = tmp_path / "real-out"
    real.mkdir()
    link = tmp_path / "out-link"
    link.symlink_to(real)
    cfg, out = _cfg(tmp_path, out=link)

    report = run_export(db_conn, cfg)

    assert report.ok is True
    assert link.is_symlink(), "output_dir symlink was replaced"
    assert {p.name for p in real.iterdir()} == set(FILES)
    for name in FILES:
        assert _read_json(real / name) == EMPTY_PAYLOADS[name], name


# --- 4. Type-change shrink ----------------------------------------------------


def test_type_change_dict5_to_empty_list_is_blocked(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)
    _dump_json(out / "memory-snapshots.json", _memory_payload(3, 2))  # count 5
    pre = (out / "memory-snapshots.json").read_bytes()

    monkeypatch.setattr(
        "scripts.ingest.export_all",
        _fake_export_all({"memory-snapshots.json": []}),  # dict → empty LIST
    )

    report = run_export(db_conn, cfg)

    assert report.blocked == {"memory-snapshots.json": (5, 0)}
    assert (out / "memory-snapshots.json").read_bytes() == pre
    assert "memory-snapshots.json" not in report.written
    assert report.ok is False


def test_type_change_list5_to_empty_dict_is_blocked(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)
    _dump_json(out / "messages.json", [{"content": f"m{i}"} for i in range(5)])
    pre = (out / "messages.json").read_bytes()

    monkeypatch.setattr(
        "scripts.ingest.export_all",
        _fake_export_all({"messages.json": {}}),  # list → empty DICT
    )

    report = run_export(db_conn, cfg)

    assert report.blocked == {"messages.json": (5, 0)}
    assert (out / "messages.json").read_bytes() == pre
    assert "messages.json" not in report.written
    assert report.ok is False


# --- 5. Scalar / degenerate / garbage NEW payloads -----------------------------


def test_degenerate_new_payloads_are_blocked_over_populated_baselines(
    db_conn, tmp_path, monkeypatch
):
    # null / "string" / 42 / unparseable bytes as the FULL new file content:
    # all carry zero records and must not replace populated baselines.
    cfg, out = _cfg(tmp_path)
    _dump_json(out / "messages.json", [{"c": 1}, {"c": 2}])
    _dump_json(out / "predictions.json", [{"t": "x"}])
    _dump_json(out / "sessions.json", [1, 2, 3])
    _dump_json(out / "writing-metadata.json", [{"slug": "keep"}])
    before = _snapshot_dir(out)

    monkeypatch.setattr(
        "scripts.ingest.export_all",
        _fake_export_all(
            {
                "messages.json": b"null",
                "predictions.json": b'"string"',
                "sessions.json": b"42",
                "writing-metadata.json": b"\x80\x81 not json {{{",  # unparseable
            }
        ),
    )

    report = run_export(db_conn, cfg)  # must not raise

    assert report.blocked == {
        "messages.json": (2, 0),
        "predictions.json": (1, 0),
        "sessions.json": (3, 0),
        "writing-metadata.json": (1, 0),
    }
    for name in report.blocked:
        assert (out / name).read_bytes() == before[name], name
    _assert_report_matches_disk(report, out, before)
    assert report.ok is False


# --- 6. Empty pre-existing quotes.json ----------------------------------------


def test_zero_byte_quotes_json_is_verified_and_survives(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "quotes.json").write_bytes(b"")

    report = run_export(db_conn, cfg)

    assert (out / "quotes.json").exists()
    assert (out / "quotes.json").read_bytes() == b""
    assert report.quotes_verified is True
    assert report.ok is True
    assert "quotes.json" not in report.written
    assert "quotes.json" not in report.blocked


# --- 7. BOM-prefixed pre-existing JSON -----------------------------------------


def test_bom_prefixed_preexisting_json_is_coherent_not_half_handled(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    bom_payload = b"\xef\xbb\xbf" + json.dumps([{"content": "a"}, {"content": "b"}]).encode("utf-8")
    (out / "messages.json").write_bytes(bom_payload)
    before = _snapshot_dir(out)

    report = run_export(db_conn, cfg)  # must not raise

    in_written = "messages.json" in report.written
    in_blocked = "messages.json" in report.blocked
    assert in_written != in_blocked, "messages.json must land in EXACTLY one of written/blocked"
    if in_blocked:
        # Parsed via utf-8-sig → baseline of 2 protected, bytes untouched.
        assert (out / "messages.json").read_bytes() == bom_payload
        assert report.blocked["messages.json"] == (2, 0)
    else:
        # Treated as unparseable → no trustworthy baseline → overwritten.
        old, new = report.written["messages.json"]
        assert old in (None, 2)
        assert new == 0
        assert _read_json(out / "messages.json") == []
    _assert_report_matches_disk(report, out, before)


# --- 8. Rogue extra staged files -----------------------------------------------


def test_rogue_extra_staged_file_is_never_half_handled(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)

    def rogue_export_all(conn, output_dir):
        return _write_minimal_exports(output_dir, extra=[("rogue.json", '[{"x": 1}, {"x": 2}]')])

    monkeypatch.setattr("scripts.ingest.export_all", rogue_export_all)

    report = run_export(db_conn, cfg)  # must not raise

    before = {}  # nothing pre-existed
    _assert_report_matches_disk(report, out, before)
    in_written = "rogue.json" in report.written
    in_blocked = "rogue.json" in report.blocked
    assert not (in_written and in_blocked)
    if in_written:
        assert _read_json(out / "rogue.json") == [{"x": 1}, {"x": 2}]
    else:
        # Ignored is acceptable — but then it must not be on disk either.
        assert not (out / "rogue.json").exists(), (
            "rogue.json moved into output_dir but never reported"
        )
    # The six standard files are unaffected by the stowaway.
    for name in FILES:
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name


def test_rogue_extra_file_cannot_bypass_shrink_guard(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)
    _dump_json(out / "rogue.json", [{"x": i} for i in range(4)])
    pre = (out / "rogue.json").read_bytes()
    before = _snapshot_dir(out)

    def rogue_export_all(conn, output_dir):
        return _write_minimal_exports(output_dir, extra=[("rogue.json", "[]")])

    monkeypatch.setattr("scripts.ingest.export_all", rogue_export_all)

    report = run_export(db_conn, cfg)  # must not raise

    # The populated baseline survives no matter how rogue.json was classified.
    assert (out / "rogue.json").read_bytes() == pre
    assert "rogue.json" not in report.written
    if "rogue.json" in report.blocked:
        assert report.blocked["rogue.json"] == (4, 0)
    _assert_report_matches_disk(report, out, before)


# --- 9. Subdirectory inside staging ---------------------------------------------


def test_subdirectory_in_staging_does_not_crash_or_leak(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)

    def nesting_export_all(conn, output_dir):
        paths = _write_minimal_exports(output_dir)
        nested = pathlib.Path(output_dir) / "nested"
        nested.mkdir()
        (nested / "junk.json").write_text('[{"junk": true}]', encoding="utf-8")
        return paths

    monkeypatch.setattr("scripts.ingest.export_all", nesting_export_all)

    report = run_export(db_conn, cfg)  # must not raise

    assert not (out / "nested").exists(), "staging subdirectory leaked into output_dir"
    assert not any(p.is_dir() for p in out.iterdir())
    assert "nested" not in report.written and "nested" not in report.blocked
    for name in FILES:
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name
    _assert_report_matches_disk(report, out, {})


# --- 10. Garbage export_all return values ---------------------------------------


def test_garbage_returned_paths_touch_nothing_outside(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)
    decoy = tmp_path / "decoy.json"
    decoy.write_bytes(b'["do not touch"]')
    hostname_before = (
        pathlib.Path("/etc/hostname").read_bytes()
        if pathlib.Path("/etc/hostname").exists()
        else None
    )

    def lying_export_all(conn, output_dir):
        _write_minimal_exports(output_dir)
        d = pathlib.Path(output_dir)
        return [
            d / "ghost.json",  # never written to staging
            d / "sessions.json",  # duplicate 1
            d / "sessions.json",  # duplicate 2
            pathlib.Path("/etc/hostname"),  # absolute, outside staging+output
            decoy,  # outside staging+output
            None,  # garbage entry
        ]

    monkeypatch.setattr("scripts.ingest.export_all", lying_export_all)

    report = run_export(db_conn, cfg)  # must not raise

    assert decoy.read_bytes() == b'["do not touch"]'
    if hostname_before is not None:
        assert pathlib.Path("/etc/hostname").read_bytes() == hostname_before
    assert not (out / "ghost.json").exists()
    assert "ghost.json" not in report.written
    # Only names that really came out of staging may be claimed.
    if out.is_dir():
        assert {p.name for p in out.iterdir() if p.is_file()} <= set(FILES)
    _assert_report_matches_disk(report, out, {})
    assert isinstance(report.ok, bool)


def test_non_iterable_export_all_return_value_does_not_crash(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)

    def weird_export_all(conn, output_dir):
        _write_minimal_exports(output_dir)
        return 42  # not iterable, not None

    monkeypatch.setattr("scripts.ingest.export_all", weird_export_all)

    report = run_export(db_conn, cfg)  # must not raise

    _assert_report_matches_disk(report, out, {})
    assert isinstance(report.ok, bool)
    assert not (out / "quotes.json").exists()


# --- 12. Connection hygiene on FAILURE paths -------------------------------------


def test_conn_not_intrans_after_quotes_abort(db_conn, tmp_path, monkeypatch):
    cfg, out = _cfg(tmp_path)

    def quotes_writing_export_all(conn, output_dir):
        # Open an implicit transaction first so the rollback duty is real.
        conn.execute("SELECT count(*) FROM sessions").fetchone()
        return _write_minimal_exports(output_dir, extra=[("quotes.json", "[]")])

    monkeypatch.setattr("scripts.ingest.export_all", quotes_writing_export_all)

    report = run_export(db_conn, cfg)

    assert "quotes" in report.errors
    assert db_conn.info.transaction_status == TransactionStatus.IDLE


def test_conn_not_intrans_after_export_all_raises(db_conn, tmp_path, monkeypatch):
    cfg, _ = _cfg(tmp_path)

    def exploding_export_all(conn, output_dir):
        conn.execute("SELECT count(*) FROM sessions").fetchone()  # opens txn
        raise RuntimeError("boom after opening a transaction")

    monkeypatch.setattr("scripts.ingest.export_all", exploding_export_all)

    report = run_export(db_conn, cfg)  # must not raise

    assert report.errors != {}
    assert db_conn.info.transaction_status == TransactionStatus.IDLE


@not_root
def test_conn_not_intrans_after_unwritable_output_dir(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    out.chmod(0o500)
    try:
        report = run_export(db_conn, cfg)  # real exporter runs real queries
    finally:
        out.chmod(0o700)

    assert report.errors != {}
    assert db_conn.info.transaction_status == TransactionStatus.IDLE


# --- 13. Alternating blocked/grown runs ------------------------------------------


def test_blocked_run_does_not_mutate_baseline_for_next_run(db_conn, tmp_path):
    cfg, out = _cfg(tmp_path)
    _dump_json(out / "messages.json", [{"content": f"old{i}"} for i in range(3)])
    baseline = (out / "messages.json").read_bytes()

    # Run 1: empty DB → new 0 over old 3 → blocked; baseline must survive.
    first = run_export(db_conn, cfg)
    assert first.blocked == {"messages.json": (3, 0)}
    assert (out / "messages.json").read_bytes() == baseline
    assert first.ok is False

    # Run 2: DB grew → written, and old_count is the ORIGINAL 3, proving the
    # blocked run never rewrote or truncated the baseline behind the report.
    _seed_message(db_conn, content="fresh")
    second = run_export(db_conn, cfg)

    assert second.blocked == {}
    assert second.written["messages.json"] == (3, 1)
    assert [m["content"] for m in _read_json(out / "messages.json")] == ["fresh"]
    assert second.errors == {}
    assert second.ok is True


# ===========================================================================
# TOTAL-ACCOUNTING CONTRACT — move-phase failures (code-review CRITICAL pin)
#
# Code review found run_export's move loop `break`s on the first failing
# file: files already moved were on disk but the loop aborted with the
# remainder unrecorded, and the OSError branch was keyed by a fixed "move"
# string while the directory-collision branch was keyed by filename. New
# contract, pinned below. For a move-phase failure on file K (sorted move
# order: memory-snapshots.json, messages.json, pet-timeline.json,
# predictions.json, sessions.json, writing-metadata.json):
#
#   1. Every file successfully moved BEFORE K is on disk in output_dir with
#      the NEW content AND in `written` with correct (old, new) counts.
#   2. K itself is in `errors` keyed by ITS FILENAME — for BOTH failure
#      modes (destination-is-a-directory AND generic OSError; the fixed
#      "move" key is dead) — with a message describing the failure; nothing
#      is ever deposited inside a colliding directory.
#   3. Files AFTER K are NOT moved (disk untouched for them) and are in
#      `errors` keyed by their filenames with a message indicating they
#      were not attempted / aborted.
#   4. INVARIANT: written ∪ blocked ∪ errors keys cover every staged file
#      (all six here), and no filename appears in more than one bucket.
#   5. `ok` is False; the quotes guard logic is unaffected.
#
# Ambiguities resolved (documented per suite convention):
#   - Message wording is not fully pinned. The failing file's dir-collision
#     message must contain "directory"; its OSError message must carry the
#     underlying exception text. Not-attempted messages must contain one of
#     the tokens {"not attempted", "abort", "skip", "not moved"}
#     (case-insensitive) — anything vaguer is indistinguishable from a
#     genuine move failure in cron logs.
#   - Non-filename error keys ("quotes", "staging", "export_all",
#     "output_dir") remain legal on OTHER paths; the invariant requires
#     coverage of staged filenames and disjointness of the three buckets,
#     nothing about extra keys. In the scenarios below the error-key set is
#     pinned EXACTLY, so a stray "move"/"quotes" key fails loudly.
#   - quotes_verified on move-failure paths: the post-move re-hash still
#     runs; with quotes.json absent-both-times or byte-identical it is True
#     (ok False comes from `errors` alone). Pinned in the mid-order test.
#   - `blocked` stays {} in these scenarios: a move failure is an error,
#     never laundered into the shrink-guard bucket.
# ===========================================================================


# Tokens acceptable in a "this file was never attempted" error message.
_NOT_ATTEMPTED_TOKENS = ("not attempted", "abort", "skip", "not moved")


def _assert_total_accounting(report, staged_names=FILES):
    """Pin contract item 4: full coverage, zero double-bucketing."""
    written = set(report.written)
    blocked = set(report.blocked)
    errored = set(report.errors)
    assert written & blocked == set(), f"files in BOTH written and blocked: {written & blocked}"
    assert written & errored == set(), f"files in BOTH written and errors: {written & errored}"
    assert blocked & errored == set(), f"files in BOTH blocked and errors: {blocked & errored}"
    missing = set(staged_names) - (written | blocked | errored)
    assert missing == set(), (
        f"staged files unaccounted for in written ∪ blocked ∪ errors: "
        f"{sorted(missing)} — the report undercounts disk state"
    )


def _assert_not_attempted_message(msg, name):
    assert isinstance(msg, str) and msg, f"errors[{name!r}] is not a non-empty str"
    lowered = msg.lower()
    assert any(tok in lowered for tok in _NOT_ATTEMPTED_TOKENS), (
        f"errors[{name!r}] = {msg!r} does not indicate the file was never "
        f"attempted (expected one of {_NOT_ATTEMPTED_TOKENS})"
    )


def test_dir_collision_mid_order_accounts_for_every_staged_file(db_conn, tmp_path):
    # Collision on pet-timeline.json — third of six in sorted move order, so
    # there are real files on BOTH sides of the failure. Seeded DB gives
    # non-zero counts, so a hardcoded (None, 0) ledger also fails.
    _seed_one_of_each(db_conn)
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "pet-timeline.json").mkdir()
    (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
    # Pre-existing baseline for a file AFTER the failure: count 1 == new
    # count 1, so the shrink guard stays out of the way — any byte change
    # proves the file was attempted when the contract says it must not be.
    predictions_baseline = b'[{"text": "old prediction"}]'
    (out / "predictions.json").write_bytes(predictions_baseline)
    before = _snapshot_dir(out)

    report = run_export(db_conn, cfg)  # must not raise

    # (1) BEFORE the failure: written with correct counts AND new content.
    assert report.written == {
        "memory-snapshots.json": (None, 0),
        "messages.json": (None, 1),
    }
    assert _read_json(out / "memory-snapshots.json") == {"snapshots": [], "blocks": []}
    assert [m["content"] for m in _read_json(out / "messages.json")] == ["hello james"]

    # (2) The failing file: keyed by FILENAME, no fixed "move" key, nothing
    # deposited inside the colliding directory.
    assert "pet-timeline.json" in report.errors
    assert "move" not in report.errors
    assert "directory" in report.errors["pet-timeline.json"].lower()
    assert (out / "pet-timeline.json").is_dir()
    assert list((out / "pet-timeline.json").iterdir()) == [], (
        "export content was deposited INSIDE the colliding directory"
    )

    # (3) AFTER the failure: in errors as not-attempted, disk untouched.
    for name in ("predictions.json", "sessions.json", "writing-metadata.json"):
        assert name in report.errors, name
        _assert_not_attempted_message(report.errors[name], name)
    assert (out / "predictions.json").read_bytes() == predictions_baseline
    assert not (out / "sessions.json").exists()
    assert not (out / "writing-metadata.json").exists()

    # (4) Invariant + EXACT error-key set (no strays, no "quotes" leakage).
    assert set(report.errors) == {
        "pet-timeline.json",
        "predictions.json",
        "sessions.json",
        "writing-metadata.json",
    }
    assert report.blocked == {}
    _assert_total_accounting(report)
    _assert_report_matches_disk(report, out, before)

    # (5) ok False from errors alone; quotes logic unaffected.
    assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
    assert report.quotes_verified is True
    assert report.ok is False


def test_dir_collision_on_last_file_first_five_written_only_last_errored(db_conn, tmp_path):
    # writing-metadata.json is LAST in sorted move order: everything else
    # must be moved, recorded, and on disk; exactly one error entry exists.
    cfg, out = _cfg(tmp_path)
    out.mkdir(parents=True)
    (out / "writing-metadata.json").mkdir()
    before = _snapshot_dir(out)

    report = run_export(db_conn, cfg)  # empty DB, real exporter; must not raise

    first_five = set(FILES) - {"writing-metadata.json"}
    assert set(report.written) == first_five
    for name in sorted(first_five):
        assert report.written[name] == (None, 0), name
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name

    assert set(report.errors) == {"writing-metadata.json"}
    assert "directory" in report.errors["writing-metadata.json"].lower()
    assert (out / "writing-metadata.json").is_dir()
    assert list((out / "writing-metadata.json").iterdir()) == [], (
        "export content was deposited INSIDE the colliding directory"
    )
    assert report.blocked == {}
    _assert_total_accounting(report)
    _assert_report_matches_disk(report, out, before)
    assert report.ok is False


def test_oserror_mid_order_keys_error_by_filename_not_move(db_conn, tmp_path, monkeypatch):
    # Generic OSError branch (not a directory collision): shutil.move itself
    # raises for pet-timeline.json only. Same total-accounting shape, and
    # the error must be keyed by the FILENAME with the underlying exception
    # text — the fixed "move" key is dead.
    cfg, out = _cfg(tmp_path)
    import shutil as _shutil

    real_move = _shutil.move

    def sabotaged_move(src, dst, *args, **kwargs):
        if pathlib.Path(dst).name == "pet-timeline.json":
            raise PermissionError(13, "injected-EACCES: pet-timeline is radioactive")
        return real_move(src, dst, *args, **kwargs)

    monkeypatch.setattr("scripts.ingest.shutil.move", sabotaged_move)

    report = run_export(db_conn, cfg)  # must not raise

    # (1) BEFORE: moved, recorded, new content on disk.
    assert report.written == {
        "memory-snapshots.json": (None, 0),
        "messages.json": (None, 0),
    }
    for name in ("memory-snapshots.json", "messages.json"):
        assert _read_json(out / name) == EMPTY_PAYLOADS[name], name

    # (2) K: filename key, exception text preserved, nothing on disk.
    assert "move" not in report.errors
    assert "pet-timeline.json" in report.errors
    assert "injected-EACCES" in report.errors["pet-timeline.json"]
    assert not (out / "pet-timeline.json").exists()

    # (3) AFTER: not attempted, not on disk, recorded as aborted.
    for name in ("predictions.json", "sessions.json", "writing-metadata.json"):
        assert name in report.errors, name
        _assert_not_attempted_message(report.errors[name], name)
        assert not (out / name).exists(), name

    # (4)(5)
    assert set(report.errors) == {
        "pet-timeline.json",
        "predictions.json",
        "sessions.json",
        "writing-metadata.json",
    }
    assert report.blocked == {}
    _assert_total_accounting(report)
    _assert_report_matches_disk(report, out, {})
    assert report.ok is False


def test_happy_path_satisfies_total_accounting_invariant(db_conn, tmp_path):
    # Regression guard: the contract change must not smuggle bookkeeping
    # entries into a clean run — errors stays {}, all six in written, and
    # the invariant holds with zero double-bucketing.
    _seed_one_of_each(db_conn)
    cfg, out = _cfg(tmp_path)

    report = run_export(db_conn, cfg)

    assert report.errors == {}
    assert report.blocked == {}
    assert set(report.written) == set(FILES)
    _assert_total_accounting(report)
    _assert_report_matches_disk(report, out, {})
    assert report.ok is True
