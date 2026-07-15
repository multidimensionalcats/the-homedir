import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi } from 'vitest';
import TransitionLedger from './TransitionLedger.svelte';

// ============================================================
// PINNED CONTRACT (test-defined, component must conform)
//
// TransitionLedger — static, data-driven ledger of EVERY model-version
// transition, merged with a curated overlay (mergeTransitionCuration
// output, src/lib/transforms.ts). THE core requirement: an UNCURATED
// FUTURE transition renders automatically as a complete minimal entry —
// zero code changes when a new Opus version ships.
//
// Props (Svelte 5 runes):
//   transitions?: CuratedTransition[] = []
//   title?: string = 'Version boundaries'
//
// data-testids:
//   transition-ledger — root; contains a heading element (h1–h6 or
//                       [role="heading"]) carrying the title. title=""
//                       → heading ABSENT (pinned ruling).
//   ledger-entry      — one per transition IN INPUT ORDER, with
//                       data-key="<key>"; duplicate keys both render.
//   ledger-chip-from / ledger-chip-to — per entry; each shows the
//                       version string as text; inline style carries
//                       versionColor(version) from ../lib/chart-utils:
//                       4.5 #5B8BD4, 4.6 #D4A55B, 4.7 #5BD47B,
//                       4.8 #A55BD4, unknown → fallback #3A3F4B.
//   ledger-boundary   — shows lastBefore.date and firstAfter.date
//                       VERBATIM as rendered text.
//   ledger-gap        — finite gapHours → one decimal + " h"
//                       ("12.0 h", "0.0 h"); gapHours null OR
//                       non-finite (NaN/±Infinity, malformed upstream)
//                       → literal "interval unrecorded"; the strings
//                       "NaN"/"Infinity" NEVER appear anywhere.
//   ledger-label / ledger-note / ledger-excerpt — ONLY when curation
//                       is a non-null object AND the sub-field is
//                       present and non-empty; curation null → none of
//                       the three exist in that entry; label "" →
//                       ledger-label ABSENT (no empty styled box);
//                       excerpt without source renders text with no
//                       "undefined" leakage; unknown extra curation
//                       fields are ignored (not rendered, no crash).
//   ledger-sr         — class "sr-only", NOT aria-hidden, complete:
//                       every key + both boundary dates (+ label when
//                       present) for every transition.
//   ledger-empty      — present when transitions=[] or omitted;
//                       ABSENT whenever there is data.
//
// Static component: no timers, no IO, no animation. All content renders
// as literal text — never markup.
// ============================================================

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (window as any).__pwned;
});

// ============================================================
// DOM helpers (container-scoped so multi-instance tests work)
// ============================================================

function q(root: Element, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

function qa(root: Element, id: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(`[data-testid="${id}"]`));
}

function rootEl(container: Element): HTMLElement {
  const el = q(container, 'transition-ledger');
  if (!el) throw new Error('transition-ledger root not found');
  return el;
}

function entries(container: Element): HTMLElement[] {
  return qa(container, 'ledger-entry');
}

function entryByKey(container: Element, key: string): HTMLElement | null {
  return (
    entries(container).find((e) => e.getAttribute('data-key') === key) ?? null
  );
}

function heading(container: Element): HTMLElement | null {
  return rootEl(container).querySelector(
    'h1, h2, h3, h4, h5, h6, [role="heading"]',
  );
}

function sr(container: Element): HTMLElement | null {
  return q(container, 'ledger-sr');
}

function chipStyle(entry: Element, which: 'from' | 'to'): string {
  const chip = q(entry, `ledger-chip-${which}`);
  if (!chip) throw new Error(`ledger-chip-${which} not found in entry`);
  return (chip.getAttribute('style') || '').toLowerCase();
}

/**
 * Pin a gap value like "12.0 h" with a lookbehind guard so "112.0 h"
 * can never satisfy an expected "12.0 h".
 */
function expectGapText(entry: Element, rendered: string) {
  const gap = q(entry, 'ledger-gap');
  expect(gap).toBeTruthy();
  const escaped = rendered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(gap!.textContent || '').toMatch(
    new RegExp(`(?<![\\d.])${escaped}`),
  );
}

// ============================================================
// Fixtures
// ============================================================

const FALLBACK = '#3a3f4b';

function makeTransition(overrides: Record<string, any> = {}): any {
  return {
    key: '4.6→4.7',
    from: '4.6',
    to: '4.7',
    lastBefore: { date: '2026-04-17', time_of_day: 'PM' },
    firstAfter: { date: '2026-04-18', time_of_day: 'AM' },
    gapHours: 12,
    curation: null,
    ...overrides,
  };
}

const CURATED_46_47 = makeTransition({
  curation: {
    label: 'anticipated',
    note: 'It wrote about the window closing the night before.',
    excerpt: {
      text: 'The archive keeps what the window forgets.',
      source: 'notes/daily/2026-04-17.md',
    },
  },
});

const CURATED_45_46 = makeTransition({
  key: '4.5→4.6',
  from: '4.5',
  to: '4.6',
  lastBefore: { date: '2026-02-28', time_of_day: 'PM' },
  firstAfter: { date: '2026-03-01', time_of_day: 'AM' },
  gapHours: 13.5,
  curation: { label: 'no handoff' },
});

// THE core scenario: nobody has curated this boundary yet.
const FUTURE_48_50 = makeTransition({
  key: '4.8→5.0',
  from: '4.8',
  to: '5.0',
  lastBefore: { date: '2026-09-30', time_of_day: 'PM' },
  firstAfter: { date: '2026-10-01', time_of_day: 'AM' },
  gapHours: 14,
  curation: null,
});

function renderLedger(props: Record<string, any> = {}) {
  return render(TransitionLedger, { props });
}

// ============================================================
// 1. THE N-VERSION-PROOF PIN — an uncurated FUTURE transition renders
// as a complete minimal entry with ZERO code changes. This is the
// exhibit owner's explicit ruling; new Opus releases keep happening.
// ============================================================
describe('TransitionLedger -- N-VERSION-PROOF: uncurated future transition renders automatically', () => {
  function renderMixed() {
    return renderLedger({
      transitions: [CURATED_45_46, CURATED_46_47, FUTURE_48_50],
    });
  }

  it('the uncurated "4.8→5.0" entry exists alongside curated ones — no crash', () => {
    let container!: Element;
    expect(() => {
      ({ container } = renderMixed());
    }).not.toThrow();
    expect(entries(container).length).toBe(3);
    expect(entryByKey(container, '4.8→5.0')).toBeTruthy();
  });

  it('future entry chips: 4.8 gets its real color #A55BD4, unknown 5.0 gets fallback #3A3F4B — never blank, never crashes', () => {
    const { container } = renderMixed();
    const entry = entryByKey(container, '4.8→5.0')!;
    expect(chipStyle(entry, 'from')).toContain('#a55bd4');
    expect(chipStyle(entry, 'to')).toContain(FALLBACK);
    // chips are not blank — version strings render as text
    expect(q(entry, 'ledger-chip-from')!.textContent).toContain('4.8');
    expect(q(entry, 'ledger-chip-to')!.textContent).toContain('5.0');
  });

  it('future entry has the full minimal skeleton: boundary dates and gap', () => {
    const { container } = renderMixed();
    const entry = entryByKey(container, '4.8→5.0')!;
    const boundary = q(entry, 'ledger-boundary');
    expect(boundary).toBeTruthy();
    expect(boundary!.textContent).toContain('2026-09-30');
    expect(boundary!.textContent).toContain('2026-10-01');
    expectGapText(entry, '14.0 h');
  });

  it('future entry contains ZERO curated elements: no ledger-label, no ledger-note, no ledger-excerpt', () => {
    const { container } = renderMixed();
    const entry = entryByKey(container, '4.8→5.0')!;
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')).toBeNull();
    expect(q(entry, 'ledger-excerpt')).toBeNull();
  });

  it('curated neighbors are unaffected: "4.6→4.7" still shows its label/note/excerpt', () => {
    const { container } = renderMixed();
    const entry = entryByKey(container, '4.6→4.7')!;
    expect(q(entry, 'ledger-label')!.textContent).toContain('anticipated');
    expect(q(entry, 'ledger-note')!.textContent).toContain(
      'window closing',
    );
    expect(q(entry, 'ledger-excerpt')!.textContent).toContain(
      'The archive keeps what the window forgets.',
    );
  });

  it('the sr summary includes the future transition too: key + both dates', () => {
    const { container } = renderMixed();
    const text = sr(container)!.textContent || '';
    expect(text).toContain('4.8→5.0');
    expect(text).toContain('2026-09-30');
    expect(text).toContain('2026-10-01');
  });

  it('an entirely-uncurated ledger (every curation null) renders every entry minimal', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({ key: 'a→b', from: 'a', to: 'b', curation: null }),
        FUTURE_48_50,
      ],
    });
    expect(entries(container).length).toBe(2);
    expect(qa(container, 'ledger-label').length).toBe(0);
    expect(qa(container, 'ledger-note').length).toBe(0);
    expect(qa(container, 'ledger-excerpt').length).toBe(0);
  });
});

// ============================================================
// 2. Mount & static DOM contract
// ============================================================
describe('TransitionLedger -- mount & static contract', () => {
  it('renders root data-testid="transition-ledger" without crashing (props omitted entirely)', () => {
    let container!: Element;
    expect(() => {
      ({ container } = render(TransitionLedger));
    }).not.toThrow();
    expect(q(container, 'transition-ledger')).toBeTruthy();
  });

  it('default title "Version boundaries" appears in a heading element inside the root', () => {
    const { container } = renderLedger({ transitions: [makeTransition()] });
    const h = heading(container);
    expect(h).toBeTruthy();
    expect(h!.textContent).toContain('Version boundaries');
  });

  it('custom title renders in the heading instead of the default', () => {
    const { container } = renderLedger({
      transitions: [makeTransition()],
      title: 'Where the versions changed',
    });
    const h = heading(container)!;
    expect(h.textContent).toContain('Where the versions changed');
    expect(h.textContent).not.toContain('Version boundaries');
  });

  it('one ledger-entry per transition, each with the exact data-key', () => {
    const { container } = renderLedger({
      transitions: [CURATED_45_46, CURATED_46_47],
    });
    const els = entries(container);
    expect(els.length).toBe(2);
    expect(els[0].getAttribute('data-key')).toBe('4.5→4.6');
    expect(els[1].getAttribute('data-key')).toBe('4.6→4.7');
  });

  it('each entry has exactly ONE from chip and ONE to chip', () => {
    const { container } = renderLedger({
      transitions: [CURATED_45_46, FUTURE_48_50],
    });
    for (const entry of entries(container)) {
      expect(qa(entry, 'ledger-chip-from').length).toBe(1);
      expect(qa(entry, 'ledger-chip-to').length).toBe(1);
    }
  });

  it('boundary line shows BOTH dates verbatim', () => {
    const { container } = renderLedger({ transitions: [makeTransition()] });
    const boundary = q(entries(container)[0], 'ledger-boundary')!;
    expect(boundary.textContent).toContain('2026-04-17');
    expect(boundary.textContent).toContain('2026-04-18');
  });

  it('mounting schedules no timers and performs no fetch (static component)', () => {
    vi.useFakeTimers();
    const originalFetch = (globalThis as any).fetch;
    const fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;
    try {
      renderLedger({ transitions: [CURATED_46_47, FUTURE_48_50] });
      expect(vi.getTimerCount()).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('unmount throws nothing and leaves nothing in the document', () => {
    const { unmount } = renderLedger({ transitions: [CURATED_46_47] });
    expect(() => unmount()).not.toThrow();
    expect(
      document.querySelector('[data-testid="transition-ledger"]'),
    ).toBeNull();
    expect(document.querySelector('[data-testid="ledger-entry"]')).toBeNull();
  });
});

// ============================================================
// 3. Empty state
// ============================================================
describe('TransitionLedger -- empty state', () => {
  it('transitions=[]: root + heading render, ledger-empty marker present, zero entries', () => {
    const { container } = renderLedger({ transitions: [] });
    expect(rootEl(container)).toBeTruthy();
    expect(heading(container)).toBeTruthy();
    expect(q(container, 'ledger-empty')).toBeTruthy();
    expect(entries(container).length).toBe(0);
  });

  it('transitions omitted behaves exactly like []: empty marker present', () => {
    const { container } = render(TransitionLedger);
    expect(q(container, 'ledger-empty')).toBeTruthy();
    expect(entries(container).length).toBe(0);
  });

  it('the empty marker is ABSENT whenever there is data — even a single transition', () => {
    const { container } = renderLedger({ transitions: [makeTransition()] });
    expect(q(container, 'ledger-empty')).toBeNull();
    expect(entries(container).length).toBe(1);
  });
});

// ============================================================
// 4. Input order & scale
// ============================================================
describe('TransitionLedger -- input order & scale', () => {
  it('10 transitions in SHUFFLED non-chronological order render in INPUT order (no re-sorting)', () => {
    // deliberately not sorted by date, key, or version
    const dates = [
      '2026-06-01',
      '2026-01-15',
      '2026-09-09',
      '2026-03-03',
      '2026-12-31',
      '2026-02-02',
      '2026-08-08',
      '2026-05-05',
      '2026-11-11',
      '2026-04-04',
    ];
    const keys = dates.map((d, i) => `v${9 - i}→v${i}`);
    const transitions = dates.map((d, i) =>
      makeTransition({
        key: keys[i],
        from: `v${9 - i}`,
        to: `v${i}`,
        lastBefore: { date: d, time_of_day: 'PM' },
        firstAfter: { date: d, time_of_day: 'PM' },
      }),
    );
    const { container } = renderLedger({ transitions });
    const rendered = entries(container).map((e) => e.getAttribute('data-key'));
    expect(rendered).toEqual(keys);
  });

  it('a single transition renders exactly one entry', () => {
    const { container } = renderLedger({ transitions: [FUTURE_48_50] });
    expect(entries(container).length).toBe(1);
  });

  it('duplicate keys: BOTH entries render (count 2), duplicated data-key accepted', () => {
    const a = makeTransition({ gapHours: 1 });
    const b = makeTransition({ gapHours: 2 });
    const { container } = renderLedger({ transitions: [a, b] });
    const dupes = entries(container).filter(
      (e) => e.getAttribute('data-key') === '4.6→4.7',
    );
    expect(dupes.length).toBe(2);
  });

  it('30 transitions render 30 entries, each with chips, boundary and gap', () => {
    const transitions = Array.from({ length: 30 }, (_, i) =>
      makeTransition({
        key: `k${i}→k${i + 1}`,
        from: `k${i}`,
        to: `k${i + 1}`,
        gapHours: i,
      }),
    );
    const { container } = renderLedger({ transitions });
    const els = entries(container);
    expect(els.length).toBe(30);
    for (const entry of els) {
      expect(q(entry, 'ledger-chip-from')).toBeTruthy();
      expect(q(entry, 'ledger-chip-to')).toBeTruthy();
      expect(q(entry, 'ledger-boundary')).toBeTruthy();
      expect(q(entry, 'ledger-gap')).toBeTruthy();
    }
    // spot-check the last one's gap: 29 → "29.0 h"
    expectGapText(els[29], '29.0 h');
  });
});

// ============================================================
// 5. Version chips & colors
// ============================================================
describe('TransitionLedger -- version chips & colors', () => {
  it('known versions carry their exact chart-utils colors inline: 4.6 → #D4A55B, 4.7 → #5BD47B', () => {
    const { container } = renderLedger({ transitions: [makeTransition()] });
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain('#d4a55b');
    expect(chipStyle(entry, 'to')).toContain('#5bd47b');
  });

  it('4.5 → #5B8BD4 and 4.8 → #A55BD4', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({ key: '4.5→4.8', from: '4.5', to: '4.8' }),
      ],
    });
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain('#5b8bd4');
    expect(chipStyle(entry, 'to')).toContain('#a55bd4');
  });

  it('unicode version "4.7β" is unknown to the map: fallback color, literal text intact', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({ key: '4.7β→4.8', from: '4.7β', to: '4.8' }),
      ],
    });
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain(FALLBACK);
    expect(q(entry, 'ledger-chip-from')!.textContent).toContain('4.7β');
  });

  it('degenerate "4.5→4.5": both chips render with the SAME color, no crash', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({ key: '4.5→4.5', from: '4.5', to: '4.5' }),
      ],
    });
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain('#5b8bd4');
    expect(chipStyle(entry, 'to')).toContain('#5b8bd4');
  });

  it('whitespace-only version: fallback color, no crash', () => {
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [
          makeTransition({ key: '   →4.7', from: '   ', to: '4.7' }),
        ],
      }));
    }).not.toThrow();
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain(FALLBACK);
    expect(chipStyle(entry, 'to')).toContain('#5bd47b');
  });

  it('empty-string version: fallback color, no crash', () => {
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [makeTransition({ key: '→4.7', from: '', to: '4.7' })],
      }));
    }).not.toThrow();
    expect(chipStyle(entries(container)[0], 'from')).toContain(FALLBACK);
  });
});

// ============================================================
// 6. Gap formatting — one decimal, exact rounding, null path
// ============================================================
describe('TransitionLedger -- gap formatting', () => {
  function gapEntry(gapHours: any): HTMLElement {
    const { container } = renderLedger({
      transitions: [makeTransition({ gapHours })],
    });
    return entries(container)[0];
  }

  it('gapHours=12 renders "12.0 h" and NOT "interval unrecorded"', () => {
    const entry = gapEntry(12);
    expectGapText(entry, '12.0 h');
    expect(q(entry, 'ledger-gap')!.textContent).not.toContain(
      'interval unrecorded',
    );
  });

  it('gapHours=13.5 renders "13.5 h"', () => {
    expectGapText(gapEntry(13.5), '13.5 h');
  });

  it('gapHours=0 renders "0.0 h" (zero is a real recorded interval, not the null path)', () => {
    const entry = gapEntry(0);
    expectGapText(entry, '0.0 h');
    expect(q(entry, 'ledger-gap')!.textContent).not.toContain(
      'interval unrecorded',
    );
  });

  it('rounding pin: gapHours=0.05 renders "0.1 h"', () => {
    expectGapText(gapEntry(0.05), '0.1 h');
  });

  it('rounding pin: gapHours=143.98 renders "144.0 h", never "143.98"', () => {
    const entry = gapEntry(143.98);
    expectGapText(entry, '144.0 h');
    expect(q(entry, 'ledger-gap')!.textContent).not.toContain('143.98');
  });

  it('gapHours=null renders the literal "interval unrecorded" and no digits+h', () => {
    const entry = gapEntry(null);
    const gap = q(entry, 'ledger-gap')!;
    expect(gap.textContent).toContain('interval unrecorded');
    expect(gap.textContent || '').not.toMatch(/\d+\.\d+ h/);
  });

  it('malformed upstream gapHours=NaN takes the null path — "interval unrecorded", NO "NaN" text anywhere in the entry', () => {
    const entry = gapEntry(NaN);
    expect(q(entry, 'ledger-gap')!.textContent).toContain(
      'interval unrecorded',
    );
    expect(entry.textContent || '').not.toContain('NaN');
  });

  it('gapHours=Infinity takes the null path — no "Infinity" text anywhere in the entry', () => {
    const entry = gapEntry(Infinity);
    expect(q(entry, 'ledger-gap')!.textContent).toContain(
      'interval unrecorded',
    );
    expect(entry.textContent || '').not.toContain('Infinity');
  });

  it('gapHours=-Infinity takes the null path — no "Infinity" text anywhere in the entry', () => {
    const entry = gapEntry(-Infinity);
    expect(q(entry, 'ledger-gap')!.textContent).toContain(
      'interval unrecorded',
    );
    expect(entry.textContent || '').not.toContain('Infinity');
  });
});

// ============================================================
// 7. Curation shapes
// ============================================================
describe('TransitionLedger -- curation shapes', () => {
  function curatedEntry(curation: any): HTMLElement {
    const { container } = renderLedger({
      transitions: [makeTransition({ curation })],
    });
    return entries(container)[0];
  }

  it('full curation {label, note, excerpt}: all three testids render with the right content', () => {
    const entry = curatedEntry({
      label: 'anticipated',
      note: 'A note.',
      excerpt: { text: 'Quoted line.', source: 'writing/x.md' },
    });
    expect(q(entry, 'ledger-label')!.textContent).toContain('anticipated');
    expect(q(entry, 'ledger-note')!.textContent).toContain('A note.');
    const excerpt = q(entry, 'ledger-excerpt')!;
    expect(excerpt.textContent).toContain('Quoted line.');
    expect(excerpt.textContent).toContain('writing/x.md');
  });

  it('label only: ledger-label renders; note and excerpt are ABSENT', () => {
    const entry = curatedEntry({ label: 'no handoff' });
    expect(q(entry, 'ledger-label')!.textContent).toContain('no handoff');
    expect(q(entry, 'ledger-note')).toBeNull();
    expect(q(entry, 'ledger-excerpt')).toBeNull();
  });

  it('note only: ledger-note renders; label and excerpt are ABSENT', () => {
    const entry = curatedEntry({ note: 'only a note' });
    expect(q(entry, 'ledger-note')!.textContent).toContain('only a note');
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-excerpt')).toBeNull();
  });

  it('excerpt only: ledger-excerpt renders; label and note are ABSENT', () => {
    const entry = curatedEntry({
      excerpt: { text: 'just the excerpt', source: 'src' },
    });
    expect(q(entry, 'ledger-excerpt')!.textContent).toContain(
      'just the excerpt',
    );
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')).toBeNull();
  });

  it('excerpt with MISSING source: text renders, NO "undefined" anywhere in the excerpt', () => {
    const entry = curatedEntry({ excerpt: { text: 'orphan quote' } });
    const excerpt = q(entry, 'ledger-excerpt')!;
    expect(excerpt.textContent).toContain('orphan quote');
    expect(excerpt.textContent || '').not.toContain('undefined');
  });

  it('empty curation object {}: entry renders, ZERO curated testids (no empty styled boxes)', () => {
    const entry = curatedEntry({});
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')).toBeNull();
    expect(q(entry, 'ledger-excerpt')).toBeNull();
    // minimal skeleton is still intact
    expect(q(entry, 'ledger-boundary')).toBeTruthy();
    expect(q(entry, 'ledger-gap')).toBeTruthy();
  });

  it('label as empty string "": ledger-label ABSENT (pinned ruling — no empty styled box)', () => {
    const entry = curatedEntry({ label: '', note: 'real note' });
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')!.textContent).toContain('real note');
  });

  it('curation with EXTRA unknown fields: ignored, no crash, extra values never render as text', () => {
    let entry!: HTMLElement;
    expect(() => {
      entry = curatedEntry({
        label: 'kept',
        BOGUS_EXTRA_FIELD: 'BOGUS_SENTINEL_VALUE_93187',
        deeply: { nested: { junk: true } },
        count: 42424242,
      });
    }).not.toThrow();
    expect(q(entry, 'ledger-label')!.textContent).toContain('kept');
    expect(entry.textContent || '').not.toContain(
      'BOGUS_SENTINEL_VALUE_93187',
    );
    expect(entry.textContent || '').not.toContain('42424242');
  });

  it('curation null: none of the three curated testids exist in the entry', () => {
    const entry = curatedEntry(null);
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')).toBeNull();
    expect(q(entry, 'ledger-excerpt')).toBeNull();
  });

  it('per-entry isolation: curated fields from one entry never bleed into a neighboring minimal entry', () => {
    const { container } = renderLedger({
      transitions: [CURATED_46_47, FUTURE_48_50],
    });
    const future = entryByKey(container, '4.8→5.0')!;
    expect(future.textContent || '').not.toContain('anticipated');
    expect(future.textContent || '').not.toContain(
      'The archive keeps what the window forgets.',
    );
    expect(qa(container, 'ledger-label').length).toBe(1);
  });
});

// ============================================================
// 8. Missing / degenerate boundary fields
// ============================================================
describe('TransitionLedger -- boundary field pathology', () => {
  it('missing time_of_day on BOTH sides: dates render, NO "undefined" text anywhere in the entry', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({
          lastBefore: { date: '2026-04-17', time_of_day: undefined },
          firstAfter: { date: '2026-04-18', time_of_day: undefined },
        }),
      ],
    });
    const entry = entries(container)[0];
    const boundary = q(entry, 'ledger-boundary')!;
    expect(boundary.textContent).toContain('2026-04-17');
    expect(boundary.textContent).toContain('2026-04-18');
    expect(entry.textContent || '').not.toContain('undefined');
  });

  it('missing time_of_day: the sr summary also never says "undefined"', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({
          lastBefore: { date: '2026-04-17', time_of_day: undefined },
          firstAfter: { date: '2026-04-18', time_of_day: undefined },
        }),
      ],
    });
    expect(sr(container)!.textContent || '').not.toContain('undefined');
  });
});

// ============================================================
// 9. Screen-reader summary
// ============================================================
describe('TransitionLedger -- sr summary', () => {
  it('sr element: class "sr-only", NOT aria-hidden', () => {
    const { container } = renderLedger({ transitions: [makeTransition()] });
    const el = sr(container);
    expect(el).toBeTruthy();
    expect(el!.classList.contains('sr-only')).toBe(true);
    expect(el!.getAttribute('aria-hidden')).not.toBe('true');
  });

  it('sr is NOT inside any aria-hidden ancestor', () => {
    const { container } = renderLedger({ transitions: [makeTransition()] });
    let cur: Element | null = sr(container);
    while (cur) {
      expect(cur.getAttribute('aria-hidden')).not.toBe('true');
      cur = cur.parentElement;
    }
  });

  it('sr summary is COMPLETE for every transition: key + both dates, label when present', () => {
    const { container } = renderLedger({
      transitions: [CURATED_45_46, CURATED_46_47, FUTURE_48_50],
    });
    const text = sr(container)!.textContent || '';
    for (const t of [CURATED_45_46, CURATED_46_47, FUTURE_48_50]) {
      expect(text).toContain(t.key);
      expect(text).toContain(t.lastBefore.date);
      expect(text).toContain(t.firstAfter.date);
    }
    expect(text).toContain('no handoff'); // CURATED_45_46 label
    expect(text).toContain('anticipated'); // CURATED_46_47 label
  });

  it('sr stays complete at scale: all 30 keys present', () => {
    const transitions = Array.from({ length: 30 }, (_, i) =>
      makeTransition({ key: `k${i}→k${i + 1}` }),
    );
    const { container } = renderLedger({ transitions });
    const text = sr(container)!.textContent || '';
    for (let i = 0; i < 30; i++) {
      expect(text).toContain(`k${i}→k${i + 1}`);
    }
  });
});

// ============================================================
// 10. XSS, injection & content fidelity
// ============================================================
describe('TransitionLedger -- XSS & content fidelity', () => {
  const IMG_XSS = '<img src=x onerror="window.__pwned=1">';
  const SCRIPT_XSS = '<script>window.__pwned=1<' + '/script>';

  it('payload in curation label/note stays LITERAL: no img, no script, __pwned undefined', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({
          curation: { label: IMG_XSS, note: SCRIPT_XSS },
        }),
      ],
    });
    const entry = entries(container)[0];
    expect(q(entry, 'ledger-label')!.textContent).toContain(IMG_XSS);
    expect(q(entry, 'ledger-note')!.textContent).toContain(SCRIPT_XSS);
    expect(document.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('payload in excerpt.text AND excerpt.source stays literal', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({
          curation: { excerpt: { text: IMG_XSS, source: SCRIPT_XSS } },
        }),
      ],
    });
    const excerpt = q(entries(container)[0], 'ledger-excerpt')!;
    expect(excerpt.textContent).toContain(IMG_XSS);
    expect(excerpt.textContent).toContain(SCRIPT_XSS);
    expect(document.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('payload in key: data-key carries it literally, sr renders it as text, nothing executes', () => {
    const key = `${IMG_XSS}→x`;
    const { container } = renderLedger({
      transitions: [makeTransition({ key, from: IMG_XSS, to: 'x' })],
    });
    const entry = entries(container)[0];
    expect(entry.getAttribute('data-key')).toBe(key);
    expect(sr(container)!.textContent).toContain(key);
    expect(document.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('payload in version strings: chips render it literally with fallback color, no crash', () => {
    const hostile = '"><script>window.__pwned=1<' + '/script>';
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [
          makeTransition({
            key: `${hostile}→${hostile}`,
            from: hostile,
            to: hostile,
          }),
        ],
      }));
    }).not.toThrow();
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain(FALLBACK);
    expect(q(entry, 'ledger-chip-from')!.textContent).toContain(hostile);
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('payload in boundary dates stays literal in the boundary line and sr', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({
          lastBefore: { date: IMG_XSS, time_of_day: 'PM' },
          firstAfter: { date: SCRIPT_XSS, time_of_day: 'AM' },
        }),
      ],
    });
    const boundary = q(entries(container)[0], 'ledger-boundary')!;
    expect(boundary.textContent).toContain(IMG_XSS);
    expect(boundary.textContent).toContain(SCRIPT_XSS);
    expect(sr(container)!.textContent).toContain(IMG_XSS);
    expect(document.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('payload in title stays literal in the heading', () => {
    const hostile = '<b onmouseover="window.__pwned=1">Boundaries</b>';
    const { container } = renderLedger({
      transitions: [makeTransition()],
      title: hostile,
    });
    const h = heading(container)!;
    expect(h.textContent).toContain(hostile);
    expect(container.querySelector('b')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('HTML entities in note stay literal (not decoded)', () => {
    const s = '&amp; &lt;gap&gt; &quot;boundary&quot;';
    const { container } = renderLedger({
      transitions: [makeTransition({ curation: { note: s } })],
    });
    expect(q(entries(container)[0], 'ledger-note')!.textContent).toContain(s);
  });

  it('unicode / RTL / ZWJ-emoji in note and excerpt survive intact in entry AND sr', () => {
    const note = 'مرحبا — النافذة تُغلق الليلة 👨‍👩‍👧‍👦';
    const excerpt = { text: 'statús̀ 𝕏𝕐 → wíndow', source: 'ملف.md' };
    const { container } = renderLedger({
      transitions: [
        makeTransition({ curation: { label: 'λ', note, excerpt } }),
      ],
    });
    const entry = entries(container)[0];
    expect(q(entry, 'ledger-note')!.textContent).toContain(note);
    expect(q(entry, 'ledger-excerpt')!.textContent).toContain(excerpt.text);
    expect(q(entry, 'ledger-excerpt')!.textContent).toContain(excerpt.source);
  });

  it('an extremely long note (10k chars) renders without truncation-crash — content present, no script', () => {
    const long = 'the window '.repeat(910); // ~10k chars
    const { container } = renderLedger({
      transitions: [makeTransition({ curation: { note: long } })],
    });
    const noteEl = q(entries(container)[0], 'ledger-note')!;
    expect((noteEl.textContent || '').length).toBeGreaterThanOrEqual(
      long.length,
    );
  });
});

// ============================================================
// 11. Title edge cases
// ============================================================
describe('TransitionLedger -- title edge cases', () => {
  it('title="" → heading is ABSENT (pinned ruling), entries still render', () => {
    const { container } = renderLedger({
      transitions: [makeTransition()],
      title: '',
    });
    expect(heading(container)).toBeNull();
    expect(entries(container).length).toBe(1);
  });

  it('title="" with empty data: root and empty marker still render', () => {
    const { container } = renderLedger({ transitions: [], title: '' });
    expect(rootEl(container)).toBeTruthy();
    expect(q(container, 'ledger-empty')).toBeTruthy();
    expect(heading(container)).toBeNull();
  });
});

// ============================================================
// 12. Two instances are independent
// ============================================================
describe('TransitionLedger -- two instances are independent', () => {
  it('each instance renders ONLY its own transitions and title', () => {
    const a = renderLedger({
      transitions: [CURATED_46_47],
      title: 'Ledger A',
    });
    const b = renderLedger({
      transitions: [FUTURE_48_50, CURATED_45_46],
      title: 'Ledger B',
    });
    expect(entries(a.container).length).toBe(1);
    expect(entries(b.container).length).toBe(2);
    expect(heading(a.container)!.textContent).toContain('Ledger A');
    expect(heading(b.container)!.textContent).toContain('Ledger B');
    expect(entryByKey(a.container, '4.8→5.0')).toBeNull();
    expect(entryByKey(b.container, '4.8→5.0')).toBeTruthy();
    // curated content stays in its own instance
    expect((b.container.textContent || '')).not.toContain(
      'It wrote about the window closing the night before.',
    );
  });

  it('one instance empty, one populated: empty marker appears ONLY in the empty one', () => {
    const a = renderLedger({ transitions: [] });
    const b = renderLedger({ transitions: [makeTransition()] });
    expect(q(a.container, 'ledger-empty')).toBeTruthy();
    expect(q(b.container, 'ledger-empty')).toBeNull();
  });

  it('unmounting one instance leaves the other fully intact', () => {
    const a = renderLedger({ transitions: [CURATED_46_47] });
    const b = renderLedger({ transitions: [FUTURE_48_50] });
    a.unmount();
    expect(entries(b.container).length).toBe(1);
    expect(entryByKey(b.container, '4.8→5.0')).toBeTruthy();
    expect(q(entryByKey(b.container, '4.8→5.0')!, 'ledger-gap')).toBeTruthy();
  });
});

// ============================================================
// HARDENING PASS — first-attempt GREEN means the original suite was
// too polite. Everything below attacks the implementation at
// src/components/TransitionLedger.svelte directly:
//   - all raw-row reads funnel through readProp (lines 94-132); the
//     template (lines 151-213) only touches the pre-computed
//     LedgerEntry fields — these tests verify no raw re-read leaks.
//   - safeVersionColor (lines 39-48) collapses non-string lookups.
//   - formatGap (lines 53-58) trusts toFixed — which betrays it at
//     |x| >= 1e21 (see the marked EXPECTED-FAILURE probe).
// Tests marked PROBE pin no-crash on spec-silent behavior and exist
// to surface observed output for a coordinator ruling.
// ============================================================

/** Build a transition-shaped object where `prop`'s getter throws. */
function hostileRow(
  overrides: Record<string, any>,
  ...throwingProps: string[]
): any {
  const row: Record<string, any> = makeTransition(overrides);
  for (const prop of throwingProps) {
    delete row[prop];
    Object.defineProperty(row, prop, {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error(`hostile getter: ${prop}`);
      },
    });
  }
  return row;
}

/** Attach a throwing getter to an arbitrary plain object. */
function withThrowingGetter(obj: Record<string, any>, prop: string): any {
  delete obj[prop];
  Object.defineProperty(obj, prop, {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error(`hostile getter: ${prop}`);
    },
  });
  return obj;
}

// ============================================================
// H1. Hostile getters on EVERY read path
// ============================================================
describe('hardening: hostile getters on every read path', () => {
  it('row whose `curation` getter throws: renders as a minimal entry, both siblings untouched', () => {
    const bad = hostileRow({ key: 'bad→row' }, 'curation');
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [CURATED_45_46, bad, FUTURE_48_50],
      }));
    }).not.toThrow();
    expect(entries(container).length).toBe(3);
    const entry = entryByKey(container, 'bad→row')!;
    expect(entry).toBeTruthy();
    expect(q(entry, 'ledger-boundary')).toBeTruthy();
    expect(q(entry, 'ledger-gap')).toBeTruthy();
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')).toBeNull();
    expect(q(entry, 'ledger-excerpt')).toBeNull();
    // sibling curation survives the neighbor's hostility
    const curated = entryByKey(container, '4.5→4.6')!;
    expect(q(curated, 'ledger-label')!.textContent).toContain('no handoff');
  });

  it('row whose `key` getter throws: entry still renders with data-key="", sibling keyed normally', () => {
    const bad = hostileRow({}, 'key');
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({ transitions: [bad, FUTURE_48_50] }));
    }).not.toThrow();
    const els = entries(container);
    expect(els.length).toBe(2);
    expect(els[0].getAttribute('data-key')).toBe('');
    expect(els[1].getAttribute('data-key')).toBe('4.8→5.0');
    // its boundary dates still made it through readProp into the sr summary
    expect(sr(container)!.textContent).toContain('2026-04-17');
    expect(container.textContent || '').not.toContain('undefined');
  });

  it('curation object whose `label` getter throws: ledger-label absent, sibling sub-field `note` still renders', () => {
    const curation = withThrowingGetter({ note: 'still here' }, 'label');
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [makeTransition({ curation })],
      }));
    }).not.toThrow();
    const entry = entries(container)[0];
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')!.textContent).toContain('still here');
  });

  it('excerpt whose `text` getter throws: ledger-excerpt absent, label untouched', () => {
    const excerpt = withThrowingGetter({ source: 'x.md' }, 'text');
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [makeTransition({ curation: { label: 'kept', excerpt } })],
      }));
    }).not.toThrow();
    const entry = entries(container)[0];
    expect(q(entry, 'ledger-excerpt')).toBeNull();
    expect(q(entry, 'ledger-label')!.textContent).toContain('kept');
    // source must not leak without text (impl gates source on text, line 111)
    expect(entry.textContent || '').not.toContain('x.md');
  });

  it('row whose `from` getter throws: from-chip gets fallback color and empty (never "undefined") text', () => {
    const bad = hostileRow({ key: 'nofrom→4.7' }, 'from');
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({ transitions: [bad] }));
    }).not.toThrow();
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain(FALLBACK);
    expect(q(entry, 'ledger-chip-from')!.textContent).not.toContain(
      'undefined',
    );
    expect(chipStyle(entry, 'to')).toContain('#5bd47b');
  });

  it('monster row: EVERY property getter throws — renders a fully-degraded entry, valid sibling perfectly intact', () => {
    const monster = hostileRow(
      {},
      'key',
      'from',
      'to',
      'lastBefore',
      'firstAfter',
      'gapHours',
      'curation',
    );
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({ transitions: [monster, FUTURE_48_50] }));
    }).not.toThrow();
    const els = entries(container);
    expect(els.length).toBe(2);
    expect(q(els[0], 'ledger-gap')!.textContent).toContain(
      'interval unrecorded',
    );
    expect(els[0].textContent || '').not.toContain('undefined');
    expect(els[0].textContent || '').not.toContain('NaN');
    // the survivor
    const future = entryByKey(container, '4.8→5.0')!;
    expect(q(future, 'ledger-boundary')!.textContent).toContain('2026-09-30');
    expectGapText(future, '14.0 h');
  });
});

// ============================================================
// H2. safeVersionColor — prototype-chain keys & non-string versions
// ============================================================
describe('hardening: prototype-chain version keys and non-string versions', () => {
  it('version "toString" / "constructor": plain-object lookup returns functions — must collapse to fallback COLOR with literal text', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition({
          key: 'toString→constructor',
          from: 'toString',
          to: 'constructor',
        }),
      ],
    });
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain(FALLBACK);
    expect(chipStyle(entry, 'to')).toContain(FALLBACK);
    expect(q(entry, 'ledger-chip-from')!.textContent).toContain('toString');
    expect(q(entry, 'ledger-chip-to')!.textContent).toContain('constructor');
  });

  it('version "__proto__" / "hasOwnProperty": fallback color, literal text, no crash', () => {
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [
          makeTransition({
            key: '__proto__→hasOwnProperty',
            from: '__proto__',
            to: 'hasOwnProperty',
          }),
        ],
      }));
    }).not.toThrow();
    const entry = entries(container)[0];
    expect(chipStyle(entry, 'from')).toContain(FALLBACK);
    expect(chipStyle(entry, 'to')).toContain(FALLBACK);
    expect(q(entry, 'ledger-chip-from')!.textContent).toContain('__proto__');
  });

  it('PROBE: version as Number 4.8 (not string) — textOf coerces to "4.8" BEFORE color lookup, so the REAL color applies; Number 5.0 loses its ".0" ("5")', () => {
    // Spec is silent on non-string versions. Observed (impl lines 96-97,
    // 121): number → String() → color lookup on the coerced text.
    // 4.8 → "4.8" → #A55BD4; 5.0 → "5" (trailing .0 lost — REPORTED for
    // ruling: upstream should never emit numbers, but the coercion is
    // lossy for x.0 versions).
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({
        transitions: [
          makeTransition({ key: 'num→num', from: 4.8 as any, to: 5.0 as any }),
        ],
      }));
    }).not.toThrow();
    const entry = entries(container)[0];
    expect(q(entry, 'ledger-chip-from')!.textContent).toContain('4.8');
    expect(chipStyle(entry, 'from')).toContain('#a55bd4');
    expect(q(entry, 'ledger-chip-to')!.textContent).toContain('5');
    expect(chipStyle(entry, 'to')).toContain(FALLBACK);
    expect(entry.textContent || '').not.toContain('undefined');
  });
});

// ============================================================
// H3. Gap arithmetic edges — where toFixed betrays formatGap
// ============================================================
describe('hardening: gap arithmetic edges', () => {
  function gapEntryOf(gapHours: any): HTMLElement {
    const { container } = renderLedger({
      transitions: [makeTransition({ gapHours })],
    });
    return entries(container)[0];
  }

  it('gapHours=-0 renders "0.0 h" with NO minus sign ((-0).toFixed(1) === "0.0" — pinned so a future reformat cannot regress)', () => {
    const entry = gapEntryOf(-0);
    expectGapText(entry, '0.0 h');
    expect(q(entry, 'ledger-gap')!.textContent).not.toContain('-0.0');
    expect(q(entry, 'ledger-gap')!.textContent).not.toContain(
      'interval unrecorded',
    );
  });

  it('PROBE: gapHours=-0.04 — (-0.04).toFixed(1) === "-0.0", so "-0.0 h" renders; ugly but spec-silent. No-crash pin; REPORTED for ruling', () => {
    let entry!: HTMLElement;
    expect(() => {
      entry = gapEntryOf(-0.04);
    }).not.toThrow();
    const gap = q(entry, 'ledger-gap')!;
    expect(gap).toBeTruthy();
    expect(entry.textContent || '').not.toContain('NaN');
    expect(entry.textContent || '').not.toContain('undefined');
  });

  it('gapHours=1e21 — the formatGap magnitude guard (Math.abs(raw) < 1e21) routes toFixed-cliff values away from scientific notation. Pin: no "e+" in gap text', () => {
    // Implementation: formatGap, TransitionLedger.svelte — guards the
    // toFixed cliff explicitly: Number.isFinite(1e21) is true, and
    // toFixed falls back to exponential ToString at |x| >= 1e21, so the
    // impl requires Math.abs(raw) < 1e21 and sends anything at or above
    // the cliff to "interval unrecorded". This test verifies that
    // magnitude guard holds ("e+" can never reach the gap line).
    const entry = gapEntryOf(1e21);
    const gap = q(entry, 'ledger-gap')!;
    expect(gap).toBeTruthy();
    expect((gap.textContent || '').toLowerCase()).not.toContain('e+');
  });

  it('boundary contrast: gapHours=1e20 (just below the toFixed cliff) renders a plain decimal — "100000000000000000000.0 h", no "e+"', () => {
    // COORDINATOR RULING: the 21-digit plain-decimal output is ACCEPTED.
    // 1e20 hours is an impossible input (upstream gaps are real session
    // intervals); this probe exists as a no-crash / no-"e+" pin only —
    // no prettier formatting is required for absurd-but-sub-cliff values.
    const entry = gapEntryOf(1e20);
    const gap = q(entry, 'ledger-gap')!;
    expect(gap.textContent).toContain('100000000000000000000.0 h');
    expect((gap.textContent || '').toLowerCase()).not.toContain('e+');
  });

  it('PROBE: negative finite gapHours=-12 — component contract says finite → format ("-12.0 h" observed); upstream nulls negatives, spec-silent here. No-crash pin; REPORTED for ruling', () => {
    let entry!: HTMLElement;
    expect(() => {
      entry = gapEntryOf(-12);
    }).not.toThrow();
    expect(q(entry, 'ledger-gap')).toBeTruthy();
    expect(entry.textContent || '').not.toContain('NaN');
    expect(entry.textContent || '').not.toContain('Infinity');
    expect(entry.textContent || '').not.toContain('undefined');
  });
});

// ============================================================
// H4. Non-string curated sub-fields — truthiness-gate traps
// ============================================================
describe('hardening: non-string curated sub-fields', () => {
  function curated(curation: any): HTMLElement {
    const { container } = renderLedger({
      transitions: [makeTransition({ curation })],
    });
    return entries(container)[0];
  }

  it('label as number 42 (truthy!): ledger-label ABSENT — a truthiness gate would wrongly render it; sibling note unaffected', () => {
    const entry = curated({ label: 42, note: 'real note' });
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(q(entry, 'ledger-note')!.textContent).toContain('real note');
    expect(entry.textContent || '').not.toContain('42');
  });

  it('label as array ["anticipated"] (truthy object): ledger-label ABSENT, contents never leak as text', () => {
    const entry = curated({ label: ['anticipated'] });
    expect(q(entry, 'ledger-label')).toBeNull();
    expect(entry.textContent || '').not.toContain('anticipated');
  });

  it('excerpt as a bare string "quote": no crash, ledger-excerpt ABSENT (non-object excerpt is not an excerpt), string never renders', () => {
    let entry!: HTMLElement;
    expect(() => {
      entry = curated({ label: 'kept', excerpt: 'quote' });
    }).not.toThrow();
    expect(q(entry, 'ledger-excerpt')).toBeNull();
    expect(entry.textContent || '').not.toContain('quote');
    expect(q(entry, 'ledger-label')!.textContent).toContain('kept');
  });

  it('excerpt with non-string text {text: 123}: ledger-excerpt ABSENT, no "123" text', () => {
    const entry = curated({ excerpt: { text: 123, source: 'x.md' } });
    expect(q(entry, 'ledger-excerpt')).toBeNull();
    expect(entry.textContent || '').not.toContain('123');
    // source must not render without a valid text (impl line 111 gate)
    expect(entry.textContent || '').not.toContain('x.md');
  });

  it('excerpt with valid text but non-string source {source: 42}: text renders, cite ABSENT, no "42"', () => {
    const entry = curated({ excerpt: { text: 'the quote', source: 42 } });
    const excerpt = q(entry, 'ledger-excerpt')!;
    expect(excerpt).toBeTruthy();
    expect(excerpt.textContent).toContain('the quote');
    expect(excerpt.textContent || '').not.toContain('42');
    expect(excerpt.querySelector('cite')).toBeNull();
  });
});

// ============================================================
// H5. Deep-frozen input
// ============================================================
describe('hardening: deep-frozen transitions', () => {
  it('recursively frozen array + rows + nested objects render fully — curated fields included, no mutation attempt throws', () => {
    const row: any = makeTransition({
      curation: {
        label: 'frozen label',
        note: 'frozen note',
        excerpt: { text: 'frozen quote', source: 'frozen/src.md' },
      },
    });
    Object.freeze(row.lastBefore);
    Object.freeze(row.firstAfter);
    Object.freeze(row.curation.excerpt);
    Object.freeze(row.curation);
    Object.freeze(row);
    const transitions = Object.freeze([row, Object.freeze({ ...FUTURE_48_50 })]);
    let container!: Element;
    expect(() => {
      ({ container } = renderLedger({ transitions }));
    }).not.toThrow();
    expect(entries(container).length).toBe(2);
    const entry = entries(container)[0];
    expect(q(entry, 'ledger-label')!.textContent).toContain('frozen label');
    expect(q(entry, 'ledger-note')!.textContent).toContain('frozen note');
    expect(q(entry, 'ledger-excerpt')!.textContent).toContain('frozen quote');
    expectGapText(entry, '12.0 h');
  });
});

// ============================================================
// H6. sr summary: duplicates at scale, exactly one container per instance
// ============================================================
describe('hardening: sr summary with duplicates, scale, and instance scoping', () => {
  it('30 entries as 15 duplicated key pairs: ONE sr container, every key appears at least twice in it', () => {
    const transitions = Array.from({ length: 30 }, (_, i) =>
      makeTransition({ key: `k${i % 15}x`, gapHours: i }),
    );
    const { container } = renderLedger({ transitions });
    expect(qa(container, 'ledger-sr').length).toBe(1);
    const text = sr(container)!.textContent || '';
    for (let k = 0; k < 15; k++) {
      const escaped = `k${k}x`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hits = (text.match(new RegExp(escaped, 'g')) || []).length;
      expect(hits).toBeGreaterThanOrEqual(2);
    }
  });

  it('two instances: each container has EXACTLY ONE sr, scoped to its own keys only', () => {
    const a = renderLedger({
      transitions: [makeTransition({ key: 'only-in-A→x' })],
    });
    const b = renderLedger({
      transitions: [makeTransition({ key: 'only-in-B→y' }), FUTURE_48_50],
    });
    expect(qa(a.container, 'ledger-sr').length).toBe(1);
    expect(qa(b.container, 'ledger-sr').length).toBe(1);
    expect(sr(a.container)!.textContent).toContain('only-in-A→x');
    expect(sr(a.container)!.textContent).not.toContain('only-in-B→y');
    expect(sr(b.container)!.textContent).toContain('only-in-B→y');
    expect(sr(b.container)!.textContent).toContain('4.8→5.0');
    expect(sr(b.container)!.textContent).not.toContain('only-in-A→x');
  });
});

// ============================================================
// H7. data-key attribute integrity — quote breakout
// ============================================================
describe('hardening: data-key attribute integrity', () => {
  it('key containing double quotes cannot break out of the attribute: exact value round-trips, no phantom attributes, no extra elements', () => {
    const key = '4.6" data-hax="1" onmouseover="window.__pwned=1';
    const { container } = renderLedger({
      transitions: [makeTransition({ key })],
    });
    const els = entries(container);
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('data-key')).toBe(key);
    expect(els[0].hasAttribute('data-hax')).toBe(false);
    expect(els[0].hasAttribute('onmouseover')).toBe(false);
    expect(container.querySelector('[data-hax]')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });
});

// ============================================================
// H8. Rerender probe — spec-silent, no-crash pins only
// ============================================================
describe('hardening: rerender after mount (spec-silent probe)', () => {
  it('PROBE: updating the transitions prop after mount does not crash and never renders "undefined"/"NaN" — observed behavior REPORTED, not pinned', async () => {
    const { container, rerender } = renderLedger({
      transitions: [CURATED_46_47],
    });
    await rerender({ transitions: [FUTURE_48_50, CURATED_45_46] });
    expect(rootEl(container)).toBeTruthy();
    expect(container.textContent || '').not.toContain('undefined');
    expect(container.textContent || '').not.toContain('NaN');
  });

  it('PROBE: rerender to [] does not crash; root survives', async () => {
    const { container, rerender } = renderLedger({
      transitions: [CURATED_46_47, FUTURE_48_50],
    });
    await rerender({ transitions: [] });
    expect(rootEl(container)).toBeTruthy();
    expect(container.textContent || '').not.toContain('undefined');
  });
});

// ============================================================
// H9. Interleaved malformed rows & non-array transitions
// ============================================================
describe('hardening: interleaved malformed rows and non-array input', () => {
  it('3 valid + 2 null + 1 non-object interleaved: EXACTLY 3 entries, in the valid rows’ relative order, empty marker ABSENT, sr complete', () => {
    const v1 = makeTransition({ key: 'v1→a' });
    const v2 = makeTransition({ key: 'v2→b' });
    const v3 = makeTransition({ key: 'v3→c' });
    const { container } = renderLedger({
      transitions: [v1, null, v2, 42, null, v3] as any,
    });
    const els = entries(container);
    expect(els.length).toBe(3);
    expect(els.map((e) => e.getAttribute('data-key'))).toEqual([
      'v1→a',
      'v2→b',
      'v3→c',
    ]);
    expect(q(container, 'ledger-empty')).toBeNull();
    const text = sr(container)!.textContent || '';
    expect(text).toContain('v1→a');
    expect(text).toContain('v2→b');
    expect(text).toContain('v3→c');
  });

  it('ALL rows malformed [null, undefined, 42, "row", true]: zero entries and the empty marker IS present (zero VALID rows)', () => {
    const { container } = renderLedger({
      transitions: [null, undefined, 42, 'row', true] as any,
    });
    expect(entries(container).length).toBe(0);
    expect(q(container, 'ledger-empty')).toBeTruthy();
    expect(container.textContent || '').not.toContain('undefined');
  });

  it('transitions as a non-array (string / number / array-like object): treated as empty, marker present, no crash', () => {
    for (const garbage of ['garbage', 7, { length: 3, 0: makeTransition() }]) {
      let container!: Element;
      expect(() => {
        ({ container } = renderLedger({ transitions: garbage as any }));
      }).not.toThrow();
      expect(entries(container).length).toBe(0);
      expect(q(container, 'ledger-empty')).toBeTruthy();
    }
  });
});

// ============================================================
// REVIEW PINS 2026-07-15 — accessibility contract corrections from
// code review. All four pins FAIL against the current implementation
// and define the required fix:
//   - ledger-sr must exist in the EMPTY state too (currently it lives
//     in the {:else} branch, so AT users get silence for []).
//   - the sr summary must carry the gap data ("12.0 h" / "interval
//     unrecorded"), not just key + dates.
//   - the visual entries list is presentation-only: <ul> (input order
//     carries no ranking, so no <ol>) and aria-hidden, so AT reads
//     ONLY the sr summary — never both.
//   - the root must not be a nameless <section> landmark.
// ============================================================
describe('review pins 2026-07-15', () => {
  /**
   * True when `el` has an aria-hidden="true" ancestor STRICTLY inside
   * `root` (root itself excluded — aria-hidden on the root would hide
   * the sr summary too, which is always wrong).
   */
  function ariaHiddenAncestorInsideRoot(el: Element, root: Element): boolean {
    let cur: Element | null = el.parentElement;
    while (cur && cur !== root) {
      if (cur.getAttribute('aria-hidden') === 'true') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  it('empty state: ledger-sr EXISTS (class sr-only, not aria-hidden) with non-empty text conveying the empty state', () => {
    const { container } = renderLedger({ transitions: [] });
    const el = sr(container);
    expect(el).toBeTruthy();
    expect(el!.classList.contains('sr-only')).toBe(true);
    expect(el!.getAttribute('aria-hidden')).not.toBe('true');
    const text = (el!.textContent || '').trim();
    expect(text.length).toBeGreaterThan(0);
    // The ledger-empty text is "No version boundaries recorded.", so this
    // single match accepts either "contains the ledger-empty text" or any
    // wording that includes the phrase.
    expect(text).toMatch(/No version boundaries/i);
  });

  it('sr summary carries the gap data: finite gap as "12.0 h", null gap as "interval unrecorded"', () => {
    const { container } = renderLedger({
      transitions: [
        makeTransition(), // gapHours: 12
        makeTransition({ key: '4.7→4.8', from: '4.7', to: '4.8', gapHours: null }),
      ],
    });
    const text = sr(container)!.textContent || '';
    // same lookbehind guard as expectGapText: "112.0 h" must not satisfy it
    expect(text).toMatch(/(?<![\d.])12\.0 h/);
    expect(text).toContain('interval unrecorded');
  });

  it('visual list semantics: entries live in a <ul> (input order carries no ranking) that is aria-hidden, while ledger-sr stays exposed', () => {
    const { container } = renderLedger({
      transitions: [CURATED_45_46, CURATED_46_47, FUTURE_48_50],
    });
    const root = rootEl(container);
    const els = entries(container);
    expect(els.length).toBe(3);
    for (const entry of els) {
      const list = entry.closest('ul, ol');
      expect(list).toBeTruthy();
      expect(list!.tagName).toBe('UL');
      // the visual entry (or a wrapper of it that excludes the sr div)
      // must be hidden from AT so only the sr summary is read
      expect(ariaHiddenAncestorInsideRoot(entry, root)).toBe(true);
    }
    const srEl = sr(container)!;
    expect(srEl.getAttribute('aria-hidden')).not.toBe('true');
    expect(ariaHiddenAncestorInsideRoot(srEl, root)).toBe(false);
    expect(root.getAttribute('aria-hidden')).not.toBe('true');
  });

  it('root landmark: not a nameless <section> — either the root is not a SECTION, or it carries aria-label/aria-labelledby', () => {
    const { container } = renderLedger({ transitions: [makeTransition()] });
    const root = rootEl(container);
    const named =
      root.hasAttribute('aria-label') || root.hasAttribute('aria-labelledby');
    // deliberate disjunction: swapping <section> for a neutral element OR
    // naming the section both satisfy this pin
    expect(root.tagName !== 'SECTION' || named).toBe(true);
  });
});
