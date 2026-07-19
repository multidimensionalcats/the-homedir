import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import CareCalendar from './CareCalendar.svelte';

afterEach(() => {
  cleanup();
  delete (window as any).__care_pwned;
});

// ============================================================
// Contractual constants (from spec)
// ============================================================

const DEFAULT_CAPTION = 'Sessions during the care window';

const EVENT_COLORS: Record<string, string> = {
  acquired: '#6bb08a',
  care: '#7ea7c8',
  death: '#ca6c6b',
};
const FALLBACK_COLOR = '#838997';

// ============================================================
// Test data factories (inline fixtures matching CareDay in
// src/lib/transforms.ts — never import real data files)
// ============================================================

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    pet_name: 'Bramble',
    event_type: 'care',
    event_timestamp: '2026-02-01T09:00:00Z',
    notes: 'fed and watered',
    ...overrides,
  };
}

function makeSlot(overrides: Record<string, any> = {}) {
  return { sessionPresent: false, events: [], ...overrides };
}

function makeDay(date: string, overrides: Record<string, any> = {}) {
  return {
    date,
    dayEvents: [],
    slots: { AM: makeSlot(), PM: makeSlot() },
    ...overrides,
  };
}

/** Contiguous window starting 2026-02-01, mostly-empty (absence dominates) */
function makeWindow(n: number) {
  const days = [];
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0');
    days.push(makeDay(`2026-02-${day}`));
  }
  return days;
}

// ============================================================
// Color helpers — the pinned hex must be resolvable from the
// element itself: inline style declaration or an inline CSS
// custom property (both live in the style attribute).
// ============================================================

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function elementCarriesColor(el: Element, hex: string): boolean {
  const style = (el.getAttribute('style') || '').toLowerCase();
  return style.includes(hex.toLowerCase()) || style.includes(hexToRgb(hex));
}

// ============================================================
// DOM helpers
// ============================================================

function daysIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('[data-testid="care-day"]'));
}

function slotAm(day: Element): Element | null {
  return day.querySelector('[data-testid="care-slot-am"]');
}

function slotPm(day: Element): Element | null {
  return day.querySelector('[data-testid="care-slot-pm"]');
}

function eventsIn(el: Element): Element[] {
  return Array.from(el.querySelectorAll('[data-testid="care-event"]'));
}

function labelsIn(el: Element): Element[] {
  return Array.from(el.querySelectorAll('[data-testid="care-day-label"]'));
}

function rowLabelsIn(el: Element): Element[] {
  return Array.from(el.querySelectorAll('[data-testid="care-row-label"]'));
}

function legendIn(root: Element): Element | null {
  return root.querySelector('[data-testid="care-legend"]');
}

/**
 * Deepest elements inside `scope` whose full trimmed textContent is exactly
 * one of `texts` — a parent wrapping a matching child is not double-counted.
 * Returned in document order. Exact, case-sensitive string comparison:
 * "Death" never matches "death". Never call with '' in `texts` (empty
 * swatch elements would match).
 */
function deepestExact(
  scope: Element,
  texts: string[],
): { el: Element; text: string }[] {
  return Array.from(scope.querySelectorAll('*'))
    .map((el) => ({ el, text: (el.textContent || '').trim() }))
    .filter(
      ({ el, text }) =>
        texts.includes(text) &&
        !Array.from(el.children).some((c) =>
          texts.includes((c.textContent || '').trim()),
        ),
    );
}

/** Count of legend entries labeled with EXACTLY this text. */
function legendLabelCount(legend: Element, text: string): number {
  return deepestExact(legend, [text]).length;
}

/** All elements inside the legend carrying this hex via inline style. */
function legendSwatches(legend: Element, hex: string): Element[] {
  return Array.from(legend.querySelectorAll('*')).filter((el) =>
    elementCarriesColor(el, hex),
  );
}

/** true if el sits inside an aria-hidden="true" subtree bounded by root */
function isAriaHidden(el: Element, root: Element): boolean {
  let cur: Element | null = el;
  while (cur && cur !== root.parentElement) {
    if (cur.getAttribute('aria-hidden') === 'true') return true;
    cur = cur.parentElement;
  }
  return false;
}

const XSS_PAYLOAD =
  '<img src=x onerror="window.__care_pwned = 1"><script>window.__care_pwned = 1</script>';

// ============================================================
// 1. Rendering, mount & caption
// ============================================================
describe('CareCalendar -- rendering, mount & caption', () => {
  it('mounts without crashing with a valid window', () => {
    expect(() => {
      render(CareCalendar, { props: { days: makeWindow(3) } });
    }).not.toThrow();
  });

  it('renders root container with data-testid="care-calendar"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    expect(getByTestId('care-calendar')).toBeTruthy();
  });

  it('does not crash when props are entirely omitted (days defaults to [])', () => {
    expect(() => {
      render(CareCalendar, { props: {} });
    }).not.toThrow();
  });

  it('omitted days prop behaves as empty: empty marker, no day columns', () => {
    const { getByTestId, queryAllByTestId } = render(CareCalendar, {
      props: {},
    });
    expect(getByTestId('care-calendar-empty')).toBeTruthy();
    expect(queryAllByTestId('care-day').length).toBe(0);
  });

  it('days=[] renders root + empty-state marker, no day columns', () => {
    const { getByTestId, queryAllByTestId } = render(CareCalendar, {
      props: { days: [] },
    });
    expect(getByTestId('care-calendar')).toBeTruthy();
    expect(getByTestId('care-calendar-empty')).toBeTruthy();
    expect(queryAllByTestId('care-day').length).toBe(0);
  });

  it('days=[] still renders the default caption text', () => {
    const { getByTestId } = render(CareCalendar, { props: { days: [] } });
    const root = getByTestId('care-calendar');
    expect(root.textContent || '').toContain(DEFAULT_CAPTION);
  });

  it('days=[] renders no sr-table body rows (header alone acceptable)', () => {
    const { getByTestId } = render(CareCalendar, { props: { days: [] } });
    const root = getByTestId('care-calendar');
    const table = root.querySelector('[data-testid="care-calendar-table"]');
    if (table) {
      expect(table.querySelectorAll('tbody tr').length).toBe(0);
      expect(table.querySelectorAll('td').length).toBe(0);
    }
  });

  it('empty marker is ABSENT when days are provided', () => {
    const { queryByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    expect(queryByTestId('care-calendar-empty')).toBeNull();
  });

  it('default caption text appears when caption prop omitted', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    expect(getByTestId('care-calendar').textContent || '').toContain(
      DEFAULT_CAPTION,
    );
  });

  it('custom caption replaces the default (default string gone)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2), caption: 'Custodial record, Feb 2026' },
    });
    const text = getByTestId('care-calendar').textContent || '';
    expect(text).toContain('Custodial record, Feb 2026');
    expect(text).not.toContain(DEFAULT_CAPTION);
  });

  it('empty-string caption renders NO caption element (pinned: absent, not empty)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2), caption: '' },
    });
    const root = getByTestId('care-calendar');
    expect(
      root.querySelector('[data-testid="care-calendar-caption"]'),
    ).toBeNull();
    expect(root.textContent || '').not.toContain(DEFAULT_CAPTION);
  });
});

// ============================================================
// 2. Day columns — input order is the contract
// ============================================================
describe('CareCalendar -- day columns & input order', () => {
  it('renders one care-day per input day with matching data-date', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(4) },
    });
    const days = daysIn(getByTestId('care-calendar'));
    expect(days.length).toBe(4);
    expect(days.map((d) => d.getAttribute('data-date'))).toEqual([
      '2026-02-01',
      '2026-02-02',
      '2026-02-03',
      '2026-02-04',
    ]);
  });

  it('out-of-order dates are NOT re-sorted — DOM order equals input order', () => {
    const days = [
      makeDay('2026-02-09'),
      makeDay('2026-02-01'),
      makeDay('2026-02-05'),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(cols.map((d) => d.getAttribute('data-date'))).toEqual([
      '2026-02-09',
      '2026-02-01',
      '2026-02-05',
    ]);
  });

  it('duplicate dates each get their own column, in input order', () => {
    const days = [
      makeDay('2026-02-02'),
      makeDay('2026-02-02'),
      makeDay('2026-02-03'),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(cols.length).toBe(3);
    expect(
      cols.filter((d) => d.getAttribute('data-date') === '2026-02-02').length,
    ).toBe(2);
  });

  it('a single day renders exactly one column', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-02-14')] },
    });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(cols.length).toBe(1);
    expect(cols[0].getAttribute('data-date')).toBe('2026-02-14');
  });

  it('a 50-day window renders all 50 columns', () => {
    const days = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(Date.UTC(2026, 1, 1) + i * 86400000);
      days.push(makeDay(d.toISOString().slice(0, 10)));
    }
    const { getByTestId } = render(CareCalendar, { props: { days } });
    expect(daysIn(getByTestId('care-calendar')).length).toBe(50);
  });
});

// ============================================================
// 3. Slot cells — presence vs absence
// ============================================================
describe('CareCalendar -- slot cells', () => {
  it('every day column contains exactly one AM cell and one PM cell', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    for (const day of daysIn(getByTestId('care-calendar'))) {
      expect(
        day.querySelectorAll('[data-testid="care-slot-am"]').length,
      ).toBe(1);
      expect(
        day.querySelectorAll('[data-testid="care-slot-pm"]').length,
      ).toBe(1);
    }
  });

  it('sessionPresent slot gets class "session-present" and NOT "session-absent"', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: { AM: makeSlot({ sessionPresent: true }), PM: makeSlot() },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const am = slotAm(daysIn(getByTestId('care-calendar'))[0])!;
    expect(am.classList.contains('session-present')).toBe(true);
    expect(am.classList.contains('session-absent')).toBe(false);
  });

  it('slot without a session gets class "session-absent" and NOT "session-present"', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: { AM: makeSlot({ sessionPresent: true }), PM: makeSlot() },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const pm = slotPm(daysIn(getByTestId('care-calendar'))[0])!;
    expect(pm.classList.contains('session-absent')).toBe(true);
    expect(pm.classList.contains('session-present')).toBe(false);
  });

  it('AM present / PM absent on the same day are classed independently', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: { AM: makeSlot(), PM: makeSlot({ sessionPresent: true }) },
      }),
      makeDay('2026-02-02'),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(slotAm(cols[0])!.classList.contains('session-absent')).toBe(true);
    expect(slotPm(cols[0])!.classList.contains('session-present')).toBe(true);
    expect(slotAm(cols[1])!.classList.contains('session-absent')).toBe(true);
    expect(slotPm(cols[1])!.classList.contains('session-absent')).toBe(true);
  });

  it('a fully-empty window is all session-absent (absence dominates)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(6) },
    });
    const root = getByTestId('care-calendar');
    const present = root.querySelectorAll('.session-present');
    const absent = root.querySelectorAll('.session-absent');
    expect(present.length).toBe(0);
    expect(absent.length).toBe(12);
  });

  it('a day where BOTH slots have sessions AND events renders everything', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            sessionPresent: true,
            events: [makeEvent({ event_type: 'acquired' })],
          }),
          PM: makeSlot({
            sessionPresent: true,
            events: [makeEvent({ event_type: 'care' })],
          }),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const col = daysIn(getByTestId('care-calendar'))[0];
    const am = slotAm(col)!;
    const pm = slotPm(col)!;
    expect(am.classList.contains('session-present')).toBe(true);
    expect(pm.classList.contains('session-present')).toBe(true);
    expect(eventsIn(am).length).toBe(1);
    expect(eventsIn(pm).length).toBe(1);
  });
});

// ============================================================
// 4. Event placement
// ============================================================
describe('CareCalendar -- event placement', () => {
  it('slot events render inside their slot cell with data-event-type', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: 'care' })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const col = daysIn(getByTestId('care-calendar'))[0];
    const amEvents = eventsIn(slotAm(col)!);
    expect(amEvents.length).toBe(1);
    expect(amEvents[0].getAttribute('data-event-type')).toBe('care');
    expect(eventsIn(slotPm(col)!).length).toBe(0);
  });

  it('day-level events render in care-day-events, NOT inside either slot', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ event_type: 'acquired' })],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const col = daysIn(getByTestId('care-calendar'))[0];
    const dayArea = col.querySelector('[data-testid="care-day-events"]');
    expect(dayArea).not.toBeNull();
    const dayLevel = eventsIn(dayArea!);
    expect(dayLevel.length).toBe(1);
    expect(dayLevel[0].getAttribute('data-event-type')).toBe('acquired');
    expect(dayLevel[0].closest('[data-testid="care-slot-am"]')).toBeNull();
    expect(dayLevel[0].closest('[data-testid="care-slot-pm"]')).toBeNull();
    expect(eventsIn(slotAm(col)!).length).toBe(0);
    expect(eventsIn(slotPm(col)!).length).toBe(0);
  });

  it('multiple events in one slot ALL render, in input order', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            events: [
              makeEvent({ event_type: 'acquired' }),
              makeEvent({ event_type: 'care' }),
              makeEvent({ event_type: 'death' }),
              makeEvent({ event_type: 'care' }),
            ],
          }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const amEvents = eventsIn(
      slotAm(daysIn(getByTestId('care-calendar'))[0])!,
    );
    expect(amEvents.map((e) => e.getAttribute('data-event-type'))).toEqual([
      'acquired',
      'care',
      'death',
      'care',
    ]);
  });

  it('events never leak into sibling days', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: { AM: makeSlot({ events: [makeEvent()] }), PM: makeSlot() },
      }),
      makeDay('2026-02-02'),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(eventsIn(cols[0]).length).toBe(1);
    expect(eventsIn(cols[1]).length).toBe(0);
  });
});

// ============================================================
// 5. Event colors — pinned hexes, literal type matching
// ============================================================
describe('CareCalendar -- event colors', () => {
  function renderSingleSlotEvent(event_type: string): Element {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    return eventsIn(getByTestId('care-calendar'))[0];
  }

  it('acquired → #6bb08a', () => {
    expect(
      elementCarriesColor(renderSingleSlotEvent('acquired'), EVENT_COLORS.acquired),
    ).toBe(true);
  });

  it('care → #7ea7c8', () => {
    expect(
      elementCarriesColor(renderSingleSlotEvent('care'), EVENT_COLORS.care),
    ).toBe(true);
  });

  it('death → #ca6c6b', () => {
    expect(
      elementCarriesColor(renderSingleSlotEvent('death'), EVENT_COLORS.death),
    ).toBe(true);
  });

  it('unknown event_type "resurrected" → fallback #838997, never a known color', () => {
    const el = renderSingleSlotEvent('resurrected');
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
    for (const hex of Object.values(EVENT_COLORS)) {
      expect(elementCarriesColor(el, hex)).toBe(false);
    }
  });

  it('type matching is LITERAL: "Death" (capitalized) → fallback, not #ca6c6b', () => {
    const el = renderSingleSlotEvent('Death');
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
    expect(elementCarriesColor(el, EVENT_COLORS.death)).toBe(false);
  });

  it('whitespace-padded " care " is not "care" → fallback', () => {
    const el = renderSingleSlotEvent(' care ');
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
    expect(elementCarriesColor(el, EVENT_COLORS.care)).toBe(false);
  });

  it('day-level events are colored by the same rule', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ event_type: 'death' })],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const el = eventsIn(getByTestId('care-calendar'))[0];
    expect(elementCarriesColor(el, EVENT_COLORS.death)).toBe(true);
  });
});

// ============================================================
// 6. Sparse date labels — collision-suppression rule
//    (spec 2026-07-19): death labels ALWAYS render; the
//    first-day label renders only if index 0 is >= 2 away from
//    every death-label index; the last-day label renders only
//    if it is >= 2 away from every death-label index AND >= 2
//    away from index 0 when the first-day label rendered.
// ============================================================
describe('CareCalendar -- sparse date labels', () => {
  it('with no deaths, ONLY first and last days carry a label', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(5) },
    });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[0]).length).toBe(1);
    expect(labelsIn(cols[1]).length).toBe(0);
    expect(labelsIn(cols[2]).length).toBe(0);
    expect(labelsIn(cols[3]).length).toBe(0);
    expect(labelsIn(cols[4]).length).toBe(1);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
  });

  it('a SLOT-level death on a middle day adds a label to that day', () => {
    const days = makeWindow(5);
    days[2] = makeDay('2026-02-03', {
      slots: {
        AM: makeSlot(),
        PM: makeSlot({ events: [makeEvent({ event_type: 'death' })] }),
      },
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(1);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(3);
  });

  it('a DAY-level death at index 3 of 5 labels that day AND suppresses the adjacent last-day label', () => {
    const days = makeWindow(5);
    days[3] = makeDay('2026-02-04', {
      dayEvents: [makeEvent({ event_type: 'death' })],
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[3]).length).toBe(1); // death label always renders
    expect(labelsIn(cols[0]).length).toBe(1); // |0-3| >= 2 → first-day label survives
    expect(labelsIn(cols[4]).length).toBe(0); // |4-3| < 2 → last-day label SUPPRESSED
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
  });

  it('non-death events on middle days do NOT earn a label', () => {
    const days = makeWindow(5);
    days[2] = makeDay('2026-02-03', {
      dayEvents: [makeEvent({ event_type: 'acquired' })],
      slots: {
        AM: makeSlot({ events: [makeEvent({ event_type: 'care' })] }),
        PM: makeSlot({ sessionPresent: true }),
      },
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(0);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
  });

  it('a single-day window carries exactly ONE label (first === last, no duplicate)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-02-01')] },
    });
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(1);
  });

  it('label text is month-abbrev + UNPADDED day: "2026-02-01" → "Feb 1"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-02-01')] },
    });
    const label = labelsIn(getByTestId('care-calendar'))[0];
    expect((label.textContent || '').trim()).toBe('Feb 1');
  });

  it('label parsing is UTC-safe: "2026-02-01" never renders as "Jan 31"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-02-01')] },
    });
    const text = getByTestId('care-calendar').textContent || '';
    expect(text).not.toContain('Jan 31');
  });

  it('"2026-11-09" → "Nov 9" (no zero-padding leaks through)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-11-09')] },
    });
    const label = labelsIn(getByTestId('care-calendar'))[0];
    expect((label.textContent || '').trim()).toBe('Nov 9');
  });

  it('"2026-12-31" → "Dec 31" and never "Dec 30" (western-TZ off-by-one)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-12-31')] },
    });
    const label = labelsIn(getByTestId('care-calendar'))[0];
    expect((label.textContent || '').trim()).toBe('Dec 31');
  });

  it('50-day window still shows exactly 2 labels when death-free', () => {
    const days = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(Date.UTC(2026, 1, 1) + i * 86400000);
      days.push(makeDay(d.toISOString().slice(0, 10)));
    }
    const { getByTestId } = render(CareCalendar, { props: { days } });
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
  });
});

// ============================================================
// 7. Screen-reader table & aria-hidden pairing
// ============================================================
describe('CareCalendar -- screen-reader table & aria pairing', () => {
  function daysWithContent() {
    return [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            sessionPresent: true,
            events: [
              makeEvent({ pet_name: 'Bramble', event_type: 'acquired' }),
            ],
          }),
          PM: makeSlot(),
        },
      }),
      makeDay('2026-02-02'),
      makeDay('2026-02-03', {
        dayEvents: [makeEvent({ pet_name: 'Wren', event_type: 'death' })],
      }),
    ];
  }

  it('table exists with data-testid="care-calendar-table" and class "sr-only"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: daysWithContent() },
    });
    const table = getByTestId('care-calendar-table');
    expect(table).toBeTruthy();
    expect(table.classList.contains('sr-only')).toBe(true);
  });

  it('table has exactly one body row per day', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: daysWithContent() },
    });
    const table = getByTestId('care-calendar-table');
    expect(table.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('rows expose the date as text', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: daysWithContent() },
    });
    const rows = Array.from(
      getByTestId('care-calendar-table').querySelectorAll('tbody tr'),
    );
    expect(rows[0].textContent || '').toContain('2026-02-01');
    expect(rows[1].textContent || '').toContain('2026-02-02');
    expect(rows[2].textContent || '').toContain('2026-02-03');
  });

  it('rows expose pet name and event type as text (slot AND day-level)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: daysWithContent() },
    });
    const rows = Array.from(
      getByTestId('care-calendar-table').querySelectorAll('tbody tr'),
    );
    expect(rows[0].textContent || '').toContain('Bramble');
    expect(rows[0].textContent || '').toContain('acquired');
    expect(rows[2].textContent || '').toContain('Wren');
    expect(rows[2].textContent || '').toContain('death');
  });

  it('AM/PM session presence is exposed: present-day and empty-day rows differ beyond the date', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: daysWithContent() },
    });
    const rows = Array.from(
      getByTestId('care-calendar-table').querySelectorAll('tbody tr'),
    );
    const strip = (row: Element, date: string) =>
      (row.textContent || '').split(date).join('').replace(/\s+/g, ' ').trim();
    // Row 0 has an AM session; row 1 has none. If presence is exposed at all,
    // the date-stripped, event-stripped remainder must differ.
    const r0 = strip(rows[0], '2026-02-01')
      .replace('Bramble', '')
      .replace('acquired', '');
    const r1 = strip(rows[1], '2026-02-02');
    expect(r0).not.toBe(r1);
  });

  it('unicode + emoji pet names survive intact in the table text', () => {
    const name = '🐟 Șžołte-محبوب-ẞtrudel';
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ pet_name: name })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    expect(getByTestId('care-calendar-table').textContent || '').toContain(
      name,
    );
  });

  it('the visual grid (day columns) is inside an aria-hidden="true" subtree', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: daysWithContent() },
    });
    const root = getByTestId('care-calendar');
    for (const day of daysIn(root)) {
      expect(isAriaHidden(day, root)).toBe(true);
    }
  });

  it('the sr table is NOT inside an aria-hidden subtree', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: daysWithContent() },
    });
    const root = getByTestId('care-calendar');
    const table = getByTestId('care-calendar-table');
    expect(isAriaHidden(table, root)).toBe(false);
  });
});

// ============================================================
// 8. Malformed input — no crash, siblings survive
// ============================================================
describe('CareCalendar -- malformed input', () => {
  it('null entry in days array does not crash; valid siblings still render', () => {
    const days = [makeDay('2026-02-01'), null as any, makeDay('2026-02-03')];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-01"]'),
    ).not.toBeNull();
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-03"]'),
    ).not.toBeNull();
  });

  it('undefined entry in days array does not crash', () => {
    const days = [undefined as any, makeDay('2026-02-02')];
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      expect(
        getByTestId('care-calendar').querySelector(
          '[data-date="2026-02-02"]',
        ),
      ).not.toBeNull();
    }).not.toThrow();
  });

  it('day with missing slots object does not crash; siblings render fully', () => {
    const broken = { date: '2026-02-02', dayEvents: [] } as any;
    const days = [makeDay('2026-02-01'), broken, makeDay('2026-02-03')];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const survivor = root!.querySelector(
      '[data-testid="care-day"][data-date="2026-02-03"]',
    );
    expect(survivor).not.toBeNull();
    expect(slotAm(survivor!)).not.toBeNull();
    expect(slotPm(survivor!)).not.toBeNull();
  });

  it('day with missing dayEvents does not crash; its slots still render', () => {
    const broken = {
      date: '2026-02-01',
      slots: {
        AM: makeSlot({ sessionPresent: true }),
        PM: makeSlot(),
      },
    } as any;
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: [broken, makeDay('2026-02-02')] },
      });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-02"]'),
    ).not.toBeNull();
  });

  it('slots missing AM does not crash; sibling day unaffected', () => {
    const broken = {
      date: '2026-02-01',
      dayEvents: [],
      slots: { PM: makeSlot({ sessionPresent: true }) },
    } as any;
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: [broken, makeDay('2026-02-02')] },
      });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const sibling = root!.querySelector(
      '[data-testid="care-day"][data-date="2026-02-02"]',
    );
    expect(sibling).not.toBeNull();
    expect(slotAm(sibling!)).not.toBeNull();
  });

  it('slots missing PM does not crash; sibling day unaffected', () => {
    const broken = {
      date: '2026-02-01',
      dayEvents: [],
      slots: { AM: makeSlot() },
    } as any;
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: [broken, makeDay('2026-02-02')] },
      });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const sibling = root!.querySelector(
      '[data-testid="care-day"][data-date="2026-02-02"]',
    );
    expect(sibling).not.toBeNull();
    expect(slotPm(sibling!)).not.toBeNull();
  });

  it('extremely long notes (100k chars) do not crash the grid', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            events: [makeEvent({ notes: 'x'.repeat(100000) })],
          }),
          PM: makeSlot(),
        },
      }),
      makeDay('2026-02-02'),
    ];
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      expect(daysIn(getByTestId('care-calendar')).length).toBe(2);
    }).not.toThrow();
  });
});

// ============================================================
// 8b. Review pins 2026-07-19 — pet_name access hardening at
// render sites. The dedup path guards via readPetName(), but
// the AM/PM slot loops (`title={event.pet_name}`), the
// day-events loop, and the sr-table interpolation all read the
// property RAW. A throwing `pet_name` getter on an otherwise
// valid event must not crash the render ("malformed entries
// never crash siblings"), and non-string pet_names pin to the
// readPetName discipline: EMPTY STRING, never a coercion.
// ============================================================
describe('CareCalendar -- review pins 2026-07-19: hostile pet_name at render sites', () => {
  // Built by hand — makeEvent() spreads overrides, which would
  // TRIGGER the getter at fixture-build time. defineProperty keeps
  // the trap armed until the component itself touches pet_name.
  function trapNameEvent(overrides: Record<string, any> = {}) {
    const ev: Record<string, any> = {
      event_type: 'care',
      event_timestamp: '2026-02-01T09:00:00Z',
      notes: 'fed and watered',
      ...overrides,
    };
    Object.defineProperty(ev, 'pet_name', {
      enumerable: true,
      get() {
        throw new Error('trap');
      },
    });
    return ev;
  }

  /** title attribute normalized: absent (null) and "" are both "empty". */
  function titleOf(el: Element): string {
    return el.getAttribute('title') ?? '';
  }

  it('AM slot with one valid + one throwing-getter pet_name event: render does NOT throw, BOTH dots render, hostile title is empty/absent, valid title intact, sibling day unaffected', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            events: [
              makeEvent({ pet_name: 'Bramble', event_type: 'acquired' }),
              trapNameEvent({ event_type: 'care' }),
            ],
          }),
          PM: makeSlot(),
        },
      }),
      makeDay('2026-02-02'),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const cols = daysIn(root!);
    expect(cols.length).toBe(2); // sibling day survives
    const amDots = eventsIn(slotAm(cols[0])!);
    expect(amDots.length).toBe(2); // hostile dot is NOT dropped
    expect(amDots.map((e) => e.getAttribute('data-event-type'))).toEqual([
      'acquired',
      'care',
    ]);
    expect(titleOf(amDots[0])).toBe('Bramble'); // valid title untouched
    expect(titleOf(amDots[1])).toBe(''); // hostile title empty or absent
  });

  it('PM slot throwing-getter pet_name: render does NOT throw, dot renders with empty/absent title', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot(),
          PM: makeSlot({ events: [trapNameEvent({ event_type: 'death' })] }),
        },
      }),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const pmDots = eventsIn(slotPm(daysIn(root!)[0])!);
    expect(pmDots.length).toBe(1);
    expect(pmDots[0].getAttribute('data-event-type')).toBe('death');
    expect(titleOf(pmDots[0])).toBe('');
  });

  it('dayEvents with one throwing-getter + one valid event: render does NOT throw, both dots render in order, hostile title empty/absent', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [
          trapNameEvent({ event_type: 'care' }),
          makeEvent({ pet_name: 'Wren', event_type: 'acquired' }),
        ],
      }),
      makeDay('2026-02-02'),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const cols = daysIn(root!);
    expect(cols.length).toBe(2);
    const area = cols[0].querySelector('[data-testid="care-day-events"]')!;
    const dots = eventsIn(area);
    expect(dots.length).toBe(2);
    expect(dots.map((e) => e.getAttribute('data-event-type'))).toEqual([
      'care',
      'acquired',
    ]);
    expect(titleOf(dots[0])).toBe(''); // hostile
    expect(titleOf(dots[1])).toBe('Wren'); // valid sibling in the SAME loop
  });

  it('sr-table with a throwing-getter pet_name: renders without throwing; the hostile row cell keeps its event_type and notes with an EMPTY pet_name contribution', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            events: [
              makeEvent({
                pet_name: 'Bramble',
                event_type: 'acquired',
                notes: 'welcomed home',
              }),
              trapNameEvent({ event_type: 'care', notes: 'trap notes survive' }),
            ],
          }),
          PM: makeSlot(),
        },
      }),
    ];
    let table: Element;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      table = getByTestId('care-calendar-table');
    }).not.toThrow();
    const rows = Array.from(table!.querySelectorAll('tbody tr'));
    expect(rows.length).toBe(1);
    const rowText = rows[0].textContent || '';
    // Valid sibling event in the same cell is fully intact.
    expect(rowText).toContain('Bramble');
    expect(rowText).toContain('acquired');
    expect(rowText).toContain('welcomed home');
    // Hostile event still contributes its event_type and notes...
    expect(rowText).toContain('care');
    expect(rowText).toContain('trap notes survive');
    // ...as its own sr-event span (not silently dropped from the cell).
    const srEvents = Array.from(rows[0].querySelectorAll('.sr-event'));
    expect(srEvents.length).toBe(2);
    const trapSpanText = srEvents[1].textContent || '';
    expect(trapSpanText).toContain('care');
    expect(trapSpanText).toContain('trap notes survive');
  });

  it('non-string pet_name 42 pins to EMPTY: title empty/absent (never "42") and "42" never appears in the sr table', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            events: [
              makeEvent({
                pet_name: 42 as any,
                event_type: 'care',
                notes: 'plain notes',
              }),
            ],
          }),
          PM: makeSlot(),
        },
      }),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const dot = eventsIn(slotAm(daysIn(root!)[0])!)[0];
    expect(titleOf(dot)).toBe('');
    const table = root!.querySelector('[data-testid="care-calendar-table"]')!;
    expect(table.textContent || '').not.toContain('42');
    // The event itself is still exposed to AT — only the name is empty.
    expect(table.textContent || '').toContain('plain notes');
  });

  it('object pet_name pins to EMPTY: no "[object Object]" in title, grid, or sr table', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [
          makeEvent({
            pet_name: { sneaky: true } as any,
            event_type: 'acquired',
          }),
        ],
      }),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const area = daysIn(root!)[0].querySelector(
      '[data-testid="care-day-events"]',
    )!;
    const dot = eventsIn(area)[0];
    expect(titleOf(dot)).toBe('');
    expect(titleOf(dot)).not.toContain('[object');
    expect(root!.textContent || '').not.toContain('[object Object]');
  });

  it('object pet_name with a THROWING toString: render does NOT throw, dot renders with empty/absent title, sr row survives', () => {
    const bomb = {
      toString() {
        throw new Error('hostile toString');
      },
    };
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            events: [makeEvent({ pet_name: bomb as any, event_type: 'care' })],
          }),
          PM: makeSlot(),
        },
      }),
      makeDay('2026-02-02'),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const cols = daysIn(root!);
    expect(cols.length).toBe(2);
    const dot = eventsIn(slotAm(cols[0])!)[0];
    expect(dot.getAttribute('data-event-type')).toBe('care');
    expect(titleOf(dot)).toBe('');
    const table = root!.querySelector('[data-testid="care-calendar-table"]')!;
    expect(table.querySelectorAll('tbody tr').length).toBe(2);
  });
});

// ============================================================
// 9. XSS — hostile strings render as literal text
// ============================================================
describe('CareCalendar -- XSS', () => {
  it('hostile pet_name is inert: no injected elements, raw string as text', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ pet_name: XSS_PAYLOAD })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
    expect(root.textContent || '').toContain(XSS_PAYLOAD);
  });

  it('hostile event_type is inert', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: XSS_PAYLOAD })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
  });

  it('hostile notes are inert', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ notes: XSS_PAYLOAD })],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
  });

  it('hostile caption is inert and rendered as literal text', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(1), caption: XSS_PAYLOAD },
    });
    const root = getByTestId('care-calendar');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
    expect(root.textContent || '').toContain(XSS_PAYLOAD);
  });
});

// ============================================================
// 10. Hardening: reactivity — props updated AFTER mount
// ============================================================
describe('CareCalendar -- hardening: reactivity', () => {
  it('growing the days prop after mount renders the new columns', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    expect(daysIn(getByTestId('care-calendar')).length).toBe(2);
    await rerender({ days: makeWindow(5) });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(cols.length).toBe(5);
    expect(cols[4].getAttribute('data-date')).toBe('2026-02-05');
  });

  it('shrinking days to [] after mount swaps the grid for the empty marker', async () => {
    const { getByTestId, queryByTestId, queryAllByTestId, rerender } = render(
      CareCalendar,
      { props: { days: makeWindow(3) } },
    );
    expect(queryByTestId('care-calendar-empty')).toBeNull();
    await rerender({ days: [] });
    expect(getByTestId('care-calendar-empty')).toBeTruthy();
    expect(queryAllByTestId('care-day').length).toBe(0);
  });

  it('sparse labels are recomputed when days change (new last day gets the label)', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    await rerender({ days: makeWindow(6) });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(0); // old last day loses its label
    expect(labelsIn(cols[5]).length).toBe(1); // new last day gains it
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
  });

  it('caption prop updates after mount are reflected', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(2), caption: 'Before' },
    });
    await rerender({ caption: 'After' });
    const text = getByTestId('care-calendar').textContent || '';
    expect(text).toContain('After');
    expect(text).not.toContain('Before');
  });
});

// ============================================================
// 11. Hardening: garbage top-level props
// ============================================================
describe('CareCalendar -- hardening: garbage top-level props', () => {
  it('days=null (explicit — bypasses the default) does not crash, renders no columns', () => {
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: null as any },
      });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(daysIn(root!).length).toBe(0);
  });

  it('days as a plain object does not crash and renders no columns', () => {
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: { length: 3 } as any },
      });
      expect(daysIn(getByTestId('care-calendar')).length).toBe(0);
    }).not.toThrow();
  });

  it('days as a string (a char-iterable!) does not crash and renders no day columns', () => {
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: 'garbage' as any },
      });
      expect(daysIn(getByTestId('care-calendar')).length).toBe(0);
    }).not.toThrow();
  });

  it('caption=null (explicit) does not crash', () => {
    expect(() => {
      render(CareCalendar, {
        props: { days: makeWindow(1), caption: null as any },
      });
    }).not.toThrow();
  });
});

// ============================================================
// 12. Hardening: prototype-chain lookups & literal matching
// ============================================================
describe('CareCalendar -- hardening: prototype keys & literal matching', () => {
  function renderEventOfType(event_type: string): Element {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    return eventsIn(getByTestId('care-calendar'))[0];
  }

  it('event_type "toString" hits fallback color, never a Function serialization', () => {
    const el = renderEventOfType('toString');
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
    expect((el.getAttribute('style') || '')).not.toContain('function');
  });

  it('event_type "constructor" hits fallback color without crashing', () => {
    const el = renderEventOfType('constructor');
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
  });

  it('event_type "__proto__" hits fallback color without crashing', () => {
    const el = renderEventOfType('__proto__');
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
  });

  it('event_type "hasOwnProperty" hits fallback color', () => {
    const el = renderEventOfType('hasOwnProperty');
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
  });

  it('"death-adjacent" (superstring) earns NO label on a middle day — literal match only', () => {
    const days = makeWindow(5);
    days[2] = makeDay('2026-02-03', {
      dayEvents: [makeEvent({ event_type: 'death-adjacent' })],
      slots: {
        AM: makeSlot({ events: [makeEvent({ event_type: 'predeath' })] }),
        PM: makeSlot(),
      },
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(0);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
  });

  it('a death on the FIRST day yields exactly one label there (rules do not stack)', () => {
    const days = makeWindow(3);
    days[0] = makeDay('2026-02-01', {
      dayEvents: [makeEvent({ event_type: 'death' })],
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[0]).length).toBe(1);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
  });
});

// ============================================================
// 13. Hardening: event & slot garbage
// ============================================================
describe('CareCalendar -- hardening: event & slot garbage', () => {
  it('null entries inside a slot events array do not crash; valid siblings render', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({
            events: [null as any, makeEvent({ event_type: 'care' })],
          }),
          PM: makeSlot(),
        },
      }),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const rendered = eventsIn(slotAm(daysIn(root!)[0])!);
    expect(
      rendered.some((e) => e.getAttribute('data-event-type') === 'care'),
    ).toBe(true);
  });

  it('null entries inside dayEvents do not crash; valid siblings render', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [null as any, makeEvent({ event_type: 'acquired' })],
      }),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const area = daysIn(root!)[0].querySelector(
      '[data-testid="care-day-events"]',
    );
    expect(
      eventsIn(area!).some(
        (e) => e.getAttribute('data-event-type') === 'acquired',
      ),
    ).toBe(true);
  });

  it('an event object with ALL fields missing does not crash grid or sr table', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: { AM: makeSlot({ events: [{} as any] }), PM: makeSlot() },
      }),
    ];
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      expect(getByTestId('care-calendar')).toBeTruthy();
      expect(getByTestId('care-calendar-table')).toBeTruthy();
    }).not.toThrow();
  });

  it('a slot always carries EXACTLY ONE presence class, even for garbage sessionPresent', () => {
    const garbageValues = [1, 'true', {}, [], NaN, null, undefined];
    const days = garbageValues.map((v, i) =>
      makeDay(`2026-02-${String(i + 1).padStart(2, '0')}`, {
        slots: { AM: makeSlot({ sessionPresent: v as any }), PM: makeSlot() },
      }),
    );
    const { getByTestId } = render(CareCalendar, { props: { days } });
    for (const day of daysIn(getByTestId('care-calendar'))) {
      const am = slotAm(day)!;
      const classCount =
        Number(am.classList.contains('session-present')) +
        Number(am.classList.contains('session-absent'));
      expect(classCount).toBe(1);
    }
  });
});

// ============================================================
// 14. Multiple instances are independent
// ============================================================
describe('CareCalendar -- multiple instances', () => {
  it('two instances render independently with their own day counts', () => {
    render(CareCalendar, { props: { days: makeWindow(2) } });
    render(CareCalendar, { props: { days: makeWindow(5) } });
    const roots = Array.from(
      document.querySelectorAll('[data-testid="care-calendar"]'),
    );
    expect(roots.length).toBe(2);
    const counts = roots
      .map((r) => r.querySelectorAll('[data-testid="care-day"]').length)
      .sort((a, b) => a - b);
    expect(counts).toEqual([2, 5]);
  });

  it('an empty instance and a populated instance coexist', () => {
    render(CareCalendar, { props: { days: [] } });
    render(CareCalendar, { props: { days: makeWindow(3) } });
    const roots = Array.from(
      document.querySelectorAll('[data-testid="care-calendar"]'),
    );
    expect(roots.length).toBe(2);
    const emptyMarkers = document.querySelectorAll(
      '[data-testid="care-calendar-empty"]',
    );
    expect(emptyMarkers.length).toBe(1);
    const allDays = document.querySelectorAll('[data-testid="care-day"]');
    expect(allDays.length).toBe(3);
  });
});

// ============================================================
// H2-1. hardening2: label formatting — month table & edge dates
// ============================================================
describe('hardening2: label formatting — month table & edge dates', () => {
  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  it('"2026-01-01" (year boundary) → exactly "Jan 1", never "Dec 31"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-01-01')] },
    });
    const root = getByTestId('care-calendar');
    const label = labelsIn(root)[0];
    expect((label.textContent || '').trim()).toBe('Jan 1');
    expect(root.textContent || '').not.toContain('Dec 31');
  });

  it('"2026-12-05" → "Dec 5" (unpadded single digit from a padded string)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-12-05')] },
    });
    const label = labelsIn(getByTestId('care-calendar'))[0];
    expect((label.textContent || '').trim()).toBe('Dec 5');
  });

  it('month-abbrev table integrity: the 1st of ALL 12 months labels with the CORRECT month (no western-TZ off-by-one)', () => {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      // Scope to THIS render's container: getByTestId queries document.body,
      // and 12 accumulated instances collide on the root testid.
      const { container } = render(CareCalendar, {
        props: { days: [makeDay(`2026-${mm}-01`)] },
      });
      const root = container.querySelector(
        '[data-testid="care-calendar"]',
      ) as HTMLElement;
      expect(root).not.toBeNull();
      const label = labelsIn(root)[0];
      expect((label.textContent || '').trim()).toBe(`${MONTHS[m - 1]} 1`);
      // A local-TZ Date parse of "YYYY-MM-01" in a western timezone yields
      // the LAST day of the PREVIOUS month — that abbrev must not appear.
      const prev = MONTHS[(m + 10) % 12];
      expect(root.textContent || '').not.toContain(`${prev} 3`); // "Feb 28"-style leaks share no prefix; guard 30/31
      expect((label.textContent || '').trim().startsWith(prev)).toBe(false);
    }
  });
});

// ============================================================
// H2-2. hardening2: malformed & hostile date values
// ============================================================
describe('hardening2: malformed & hostile date values', () => {
  function visibleText(root: HTMLElement): string {
    return root.textContent || '';
  }

  it('unpadded date "2026-2-1" as only day: no crash, data-date passes through raw, no "NaN"/"undefined" text', () => {
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: [makeDay('2026-2-1')] },
      });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const cols = daysIn(root!);
    expect(cols.length).toBe(1);
    expect(cols[0].getAttribute('data-date')).toBe('2026-2-1');
    expect(visibleText(root!)).not.toContain('NaN');
    expect(visibleText(root!)).not.toContain('undefined');
  });

  it('date="garbage" on the FIRST day of 3: no crash, siblings render, no "NaN"/"undefined" text', () => {
    const days = [
      makeDay('garbage'),
      makeDay('2026-02-02'),
      makeDay('2026-02-03'),
    ];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(daysIn(root!).length).toBe(3);
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-03"]'),
    ).not.toBeNull();
    expect(visibleText(root!)).not.toContain('NaN');
    expect(visibleText(root!)).not.toContain('undefined');
  });

  it('date="" as only day: no crash, column renders, no "NaN"/"undefined" text', () => {
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: [makeDay('')] },
      });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(daysIn(root!).length).toBe(1);
    expect(visibleText(root!)).not.toContain('NaN');
    expect(visibleText(root!)).not.toContain('undefined');
  });

  it('date field MISSING on a middle day: row SKIPPED — 2 columns, siblings intact, and the string "undefined" never appears in grid OR sr table', () => {
    const broken = {
      dayEvents: [],
      slots: { AM: makeSlot(), PM: makeSlot() },
    } as any;
    const days = [makeDay('2026-02-01'), broken, makeDay('2026-02-03')];
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    const cols = daysIn(root!);
    expect(cols.length).toBe(2);
    expect(cols.map((c) => c.getAttribute('data-date'))).toEqual([
      '2026-02-01',
      '2026-02-03',
    ]);
    expect(visibleText(root!)).not.toContain('undefined');
    const table = root!.querySelector('[data-testid="care-calendar-table"]');
    expect((table?.textContent || '')).not.toContain('undefined');
    expect(table?.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('numeric date 20260201: no crash, no "NaN" text', () => {
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, {
        props: { days: [makeDay(20260201 as any)] },
      });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(visibleText(root!)).not.toContain('NaN');
  });

  it('date object with a THROWING toString is skipped-or-inert: render must NOT throw and valid siblings must render', () => {
    const bomb = {
      toString() {
        throw new Error('hostile toString');
      },
    };
    const days = [
      makeDay('2026-02-01'),
      makeDay(bomb as any),
      makeDay('2026-02-03'),
    ];
    let root: HTMLElement | undefined;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-01"]'),
    ).not.toBeNull();
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-03"]'),
    ).not.toBeNull();
  });

  it('day row with a THROWING "date" getter is skipped-or-inert: render must NOT throw and valid siblings must render', () => {
    const trap = {
      dayEvents: [],
      slots: { AM: makeSlot(), PM: makeSlot() },
    } as any;
    Object.defineProperty(trap, 'date', {
      enumerable: true,
      get() {
        throw new Error('hostile getter');
      },
    });
    const days = [makeDay('2026-02-01'), trap, makeDay('2026-02-03')];
    let root: HTMLElement | undefined;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-01"]'),
    ).not.toBeNull();
    expect(
      root!.querySelector('[data-testid="care-day"][data-date="2026-02-03"]'),
    ).not.toBeNull();
  });

  it('XSS payload as the date string on the first (labeled) day is inert everywhere it lands', () => {
    const days = [makeDay(XSS_PAYLOAD), makeDay('2026-02-02')];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
    // The raw payload may legitimately appear as TEXT (inert fallback) but
    // never as markup.
    expect(daysIn(root).length).toBe(2);
  });
});

// ============================================================
// H2-3. hardening2: sr-table vs grid validity parity
// ============================================================
describe('hardening2: sr-table vs grid validity parity', () => {
  it('3 valid + 2 malformed (null, 42) interleaved: EXACTLY 3 columns AND EXACTLY 3 sr rows, dates aligned in order', () => {
    const days = [
      makeDay('2026-02-01'),
      null as any,
      makeDay('2026-02-02'),
      42 as any,
      makeDay('2026-02-03'),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    const cols = daysIn(root);
    const rows = Array.from(
      getByTestId('care-calendar-table').querySelectorAll('tbody tr'),
    );
    expect(cols.length).toBe(3);
    expect(rows.length).toBe(3);
    const colDates = cols.map((c) => c.getAttribute('data-date'));
    expect(colDates).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
    rows.forEach((row, i) => {
      expect(row.textContent || '').toContain(colDates[i]!);
    });
  });

  it('ALL-malformed days ([null, undefined, 42, "x"]): 0 columns, 0 sr rows, no crash', () => {
    const days = [null, undefined, 42, 'x'] as any;
    let root: HTMLElement;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      root = getByTestId('care-calendar');
    }).not.toThrow();
    expect(daysIn(root!).length).toBe(0);
    const table = root!.querySelector('[data-testid="care-calendar-table"]');
    if (table) {
      expect(table.querySelectorAll('tbody tr').length).toBe(0);
    }
  });

  it('a dateless object row ({}) is SKIPPED identically by grid and sr table (no sighted/sr divergence)', () => {
    const days = [makeDay('2026-02-01'), {} as any, makeDay('2026-02-03')];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    const colCount = daysIn(root).length;
    const rowCount = getByTestId('care-calendar-table').querySelectorAll(
      'tbody tr',
    ).length;
    expect(colCount).toBe(rowCount);
    expect(colCount).toBe(2); // only the two valid days — the dateless row is skipped
  });
});

// ============================================================
// H2-4. hardening2: death-label uniqueness
// ============================================================
describe('hardening2: death-label uniqueness', () => {
  it('death in BOTH an AM slot AND dayEvents on the same middle day → exactly ONE label on that day', () => {
    const days = makeWindow(5);
    days[2] = makeDay('2026-02-03', {
      dayEvents: [makeEvent({ event_type: 'death' })],
      slots: {
        AM: makeSlot({ events: [makeEvent({ event_type: 'death' })] }),
        PM: makeSlot(),
      },
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(1);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(3);
  });

  it('THREE deaths (AM, PM, dayEvents) on one middle day still yield exactly ONE label there', () => {
    const days = makeWindow(5);
    days[2] = makeDay('2026-02-03', {
      dayEvents: [makeEvent({ event_type: 'death' })],
      slots: {
        AM: makeSlot({ events: [makeEvent({ event_type: 'death' })] }),
        PM: makeSlot({ events: [makeEvent({ event_type: 'death' })] }),
      },
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(1);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(3);
  });

  it('single-day window that IS the death day (first === last === death) → exactly ONE label total', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ event_type: 'death' })],
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: 'death' })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const labels = labelsIn(getByTestId('care-calendar'));
    expect(labels.length).toBe(1);
    expect((labels[0].textContent || '').trim()).toBe('Feb 1');
  });

  it('two ADJACENT middle death days of DIFFERENT pets each carry exactly one label (total 4 with endpoints)', () => {
    const days = makeWindow(6);
    days[2] = makeDay('2026-02-03', {
      dayEvents: [makeEvent({ pet_name: 'Pixel', event_type: 'death' })],
    });
    days[3] = makeDay('2026-02-04', {
      slots: {
        AM: makeSlot(),
        PM: makeSlot({
          events: [makeEvent({ pet_name: 'Echo', event_type: 'death' })],
        }),
      },
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(1);
    expect(labelsIn(cols[3]).length).toBe(1);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(4);
  });
});

// ============================================================
// H2-5. hardening2: empty-state accessibility pairing
// ============================================================
describe('hardening2: empty-state accessibility pairing', () => {
  it('days=[]: the empty marker is NOT inside an aria-hidden subtree (perceivable by AT)', () => {
    const { getByTestId } = render(CareCalendar, { props: { days: [] } });
    const root = getByTestId('care-calendar');
    const marker = root.querySelector('[data-testid="care-calendar-empty"]');
    expect(marker).not.toBeNull();
    expect(isAriaHidden(marker!, root)).toBe(false);
  });

  it('days=[]: the empty marker carries non-empty human-readable text', () => {
    const { getByTestId } = render(CareCalendar, { props: { days: [] } });
    const marker = getByTestId('care-calendar-empty');
    expect((marker.textContent || '').trim().length).toBeGreaterThan(0);
    expect(marker.getAttribute('aria-hidden')).not.toBe('true');
  });
});

// ============================================================
// H2-6. hardening2: caption lifecycle & XSS via rerender
// ============================================================
describe('hardening2: caption lifecycle & XSS via rerender', () => {
  it('caption updated to an XSS payload AFTER mount stays inert and renders as literal text', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(2), caption: 'Benign' },
    });
    await rerender({ caption: XSS_PAYLOAD });
    const root = getByTestId('care-calendar');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
    expect(root.textContent || '').toContain(XSS_PAYLOAD);
    expect(root.textContent || '').not.toContain('Benign');
  });

  it('caption rerendered to "" REMOVES the caption element (absent, not empty)', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(2), caption: 'Present' },
    });
    await rerender({ caption: '' });
    const root = getByTestId('care-calendar');
    expect(
      root.querySelector('[data-testid="care-calendar-caption"]'),
    ).toBeNull();
    expect(root.textContent || '').not.toContain('Present');
  });

  it('caption rerendered from "" to text makes the caption element APPEAR', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(2), caption: '' },
    });
    expect(
      getByTestId('care-calendar').querySelector(
        '[data-testid="care-calendar-caption"]',
      ),
    ).toBeNull();
    await rerender({ caption: 'Late caption' });
    const cap = getByTestId('care-calendar').querySelector(
      '[data-testid="care-calendar-caption"]',
    );
    expect(cap).not.toBeNull();
    expect(cap!.textContent || '').toContain('Late caption');
  });
});

// ============================================================
// H2-7. hardening2: full-year window scale
// ============================================================
describe('hardening2: full-year window scale', () => {
  it('a 366-day leap-year window renders EXACTLY 366 columns, 366 sr rows, and exactly 2 labels ("Jan 1", "Dec 31")', () => {
    const days = [];
    for (let i = 0; i < 366; i++) {
      const d = new Date(Date.UTC(2028, 0, 1) + i * 86400000);
      days.push(makeDay(d.toISOString().slice(0, 10)));
    }
    expect(days[365].date).toBe('2028-12-31'); // fixture sanity: leap year
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(daysIn(root).length).toBe(366);
    expect(
      getByTestId('care-calendar-table').querySelectorAll('tbody tr').length,
    ).toBe(366);
    const labels = labelsIn(root);
    expect(labels.length).toBe(2);
    expect((labels[0].textContent || '').trim()).toBe('Jan 1');
    expect((labels[1].textContent || '').trim()).toBe('Dec 31');
  });
});

// ============================================================
// H2-8. hardening2: event count integrity within one day
// ============================================================
describe('hardening2: event count integrity within one day', () => {
  it('a day with 6 events (2 AM + 2 PM + 2 dayEvents) renders EXACTLY 6 care-event elements, correctly partitioned', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [
          makeEvent({ event_type: 'acquired' }),
          makeEvent({ event_type: 'care' }),
        ],
        slots: {
          AM: makeSlot({
            events: [
              makeEvent({ event_type: 'care' }),
              makeEvent({ event_type: 'death' }),
            ],
          }),
          PM: makeSlot({
            events: [
              makeEvent({ event_type: 'care' }),
              makeEvent({ event_type: 'resurrected' }),
            ],
          }),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    const col = daysIn(root)[0];
    expect(eventsIn(col).length).toBe(6);
    expect(eventsIn(slotAm(col)!).length).toBe(2);
    expect(eventsIn(slotPm(col)!).length).toBe(2);
    const dayArea = col.querySelector('[data-testid="care-day-events"]')!;
    expect(eventsIn(dayArea).length).toBe(2);
    // The sr table must NOT mint additional care-event testids.
    expect(eventsIn(root).length).toBe(6);
  });

  it('the SAME event object referenced from both AM.events and dayEvents renders once per placement (2 total), never deduped or duplicated', () => {
    const shared = makeEvent({ event_type: 'care' });
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [shared],
        slots: { AM: makeSlot({ events: [shared] }), PM: makeSlot() },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const col = daysIn(getByTestId('care-calendar'))[0];
    expect(eventsIn(col).length).toBe(2);
    expect(eventsIn(slotAm(col)!).length).toBe(1);
    const dayArea = col.querySelector('[data-testid="care-day-events"]')!;
    expect(eventsIn(dayArea).length).toBe(1);
  });
});

// ============================================================
// H2-9. hardening2: style-attribute containment
// ============================================================
describe('hardening2: style-attribute containment', () => {
  function renderSlotEvent(event_type: string): Element {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    return eventsIn(getByTestId('care-calendar'))[0];
  }

  it('a known type pins the exact declaration: style attribute carries a background-color declaration with the pinned hex', () => {
    const el = renderSlotEvent('acquired');
    const style = (el.getAttribute('style') || '').toLowerCase();
    expect(style).toContain('background-color');
    expect(elementCarriesColor(el, EVENT_COLORS.acquired)).toBe(true);
  });

  it('CSS-injection event_type "x; background-image: url(javascript:alert(1))" → fallback color; NO background-image, NO javascript: in the style attribute', () => {
    const hostile = 'x; background-image: url(javascript:alert(1))';
    const el = renderSlotEvent(hostile);
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
    const style = (el.getAttribute('style') || '').toLowerCase();
    expect(style).not.toContain('background-image');
    expect(style).not.toContain('javascript:');
    expect(
      (el as HTMLElement).style.getPropertyValue('background-image'),
    ).toBe('');
  });

  it('attribute-breakout event_type \'"><img src=x onerror=window.__care_pwned=1>\' cannot escape: no img, no execution, fallback color', () => {
    const hostile = '"><img src=x onerror=window.__care_pwned=1>';
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: hostile })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(root.querySelector('img')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
    const el = eventsIn(root)[0];
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
  });

  it('a hostile event_type string NEVER appears inside the style attribute itself (only in data-event-type)', () => {
    const hostile = 'ca6c6b; color: red';
    const el = renderSlotEvent(hostile);
    const style = el.getAttribute('style') || '';
    expect(style).not.toContain('color: red');
    expect(style.toLowerCase()).not.toContain(hostile.toLowerCase());
    expect(elementCarriesColor(el, FALLBACK_COLOR)).toBe(true);
  });
});

// ============================================================
// Review pins 2026-07-15 — sr table must be programmatically
// labelled via a <caption> element (coordinator ruling). The
// VISUAL caption (care-calendar-caption) is pinned elsewhere;
// these pins target the table's own <caption> only. The
// caption='' case is deliberately NOT pinned here.
// ============================================================
describe('review pins 2026-07-15', () => {
  it('sr table has a <caption> as its FIRST child carrying the default caption text', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    const table = getByTestId('care-calendar-table');
    const cap = table.querySelector('caption');
    expect(cap).not.toBeNull();
    expect(table.firstElementChild).toBe(cap); // programmatic label, first child
    expect((cap!.textContent || '').trim()).toBe(DEFAULT_CAPTION);
  });

  it('sr table <caption> reflects a custom caption prop verbatim', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2), caption: 'Custodial record, Feb 2026' },
    });
    const table = getByTestId('care-calendar-table');
    const cap = table.querySelector('caption');
    expect(cap).not.toBeNull();
    expect((cap!.textContent || '').trim()).toBe('Custodial record, Feb 2026');
  });
});

// ============================================================
// Death-label dedup — QA ruling 2026-07-15 (coordinator,
// James-approved): a day earns a death LABEL only for a pet's
// FIRST death event within the provided days, matching
// PetTimeline's one-death-per-pet dedup. Repeat deaths of the
// same pet on later days do NOT label those days. "First" means
// first OCCURRENCE in input order — the component's input-order
// contract; it has no timestamps to compare beyond day
// membership. Event DOTS are unchanged: every death event still
// renders. First/last-day labels follow the 2026-07-19
// collision-suppression rule (see section 6 and the dedicated
// collision-suppression describe below).
// ============================================================
describe('death-label dedup (QA ruling 2026-07-15)', () => {
  function deathDotsIn(col: Element): Element[] {
    return eventsIn(col).filter(
      (e) => e.getAttribute('data-event-type') === 'death',
    );
  }

  it('same pet dying on 3 consecutive middle days (Feb 7/8/9 of 12) labels ONLY Feb 7; dots still render on Feb 8/9', () => {
    const days = makeWindow(12); // Feb 1 – Feb 12
    days[6] = makeDay('2026-02-07', {
      dayEvents: [makeEvent({ pet_name: 'Pixel', event_type: 'death' })],
    });
    days[7] = makeDay('2026-02-08', {
      dayEvents: [makeEvent({ pet_name: 'Pixel', event_type: 'death' })],
    });
    days[8] = makeDay('2026-02-09', {
      slots: {
        AM: makeSlot({
          events: [makeEvent({ pet_name: 'Pixel', event_type: 'death' })],
        }),
        PM: makeSlot(),
      },
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[6]).length).toBe(1); // Feb 7 — Pixel's first death
    expect(labelsIn(cols[7]).length).toBe(0); // Feb 8 — repeat, NO label
    expect(labelsIn(cols[8]).length).toBe(0); // Feb 9 — repeat, NO label
    // first day + Feb 7 + last day = 3 labels total
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(3);
    // DOTS are not deduped — repeat death events still render as dots
    expect(deathDotsIn(cols[7]).length).toBe(1);
    expect(deathDotsIn(cols[8]).length).toBe(1);
  });

  it('two DIFFERENT pets dying on different middle days BOTH earn labels (dedup is per-pet, not global)', () => {
    // Window Jan 30 – Feb 10 so BOTH death days are middle days.
    const days = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(2026, 0, 30) + i * 86400000);
      days.push(makeDay(d.toISOString().slice(0, 10)));
    }
    days[2] = makeDay('2026-02-01', {
      dayEvents: [makeEvent({ pet_name: 'Pixel', event_type: 'death' })],
    });
    days[8] = makeDay('2026-02-07', {
      dayEvents: [makeEvent({ pet_name: 'Echo', event_type: 'death' })],
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(1); // Pixel's first death — labeled
    expect(labelsIn(cols[8]).length).toBe(1); // Echo's first death — labeled
    // first day + Feb 1 + Feb 7 + last day = 4 labels total
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(4);
  });

  it('same pet: SLOT-level death on an earlier day, DAY-level death later → only the earlier day labeled', () => {
    const days = makeWindow(8); // Feb 1 – Feb 8
    days[2] = makeDay('2026-02-03', {
      slots: {
        AM: makeSlot({
          events: [makeEvent({ pet_name: 'Moss', event_type: 'death' })],
        }),
        PM: makeSlot(),
      },
    });
    days[5] = makeDay('2026-02-06', {
      dayEvents: [makeEvent({ pet_name: 'Moss', event_type: 'death' })],
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[2]).length).toBe(1); // Feb 3 — slot-level first death
    expect(labelsIn(cols[5]).length).toBe(0); // Feb 6 — repeat, NO label
    // first day + Feb 3 + last day = 3 labels total
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(3);
    // The Feb 6 dot survives — only the label is deduped
    expect(deathDotsIn(cols[5]).length).toBe(1);
  });

  it('"first death" is first OCCURRENCE in input order, not chronological date order (input-order contract)', () => {
    // Non-chronological input: Moss dies on Feb 9 (input index 1) and
    // Feb 2 (input index 2). Feb 2 is chronologically earlier, but the
    // component's contract is input order — the earlier-INDEXED day
    // (Feb 9) wins the label; Feb 2 gets none. Under the collision
    // rule the death label at index 1 also SUPPRESSES the first-day
    // label (|0-1| < 2); the last-day label at index 4 survives
    // (|4-1| >= 2, and the first-day label did not render).
    const days = [
      makeDay('2026-02-05'),
      makeDay('2026-02-09', {
        dayEvents: [makeEvent({ pet_name: 'Moss', event_type: 'death' })],
      }),
      makeDay('2026-02-02', {
        dayEvents: [makeEvent({ pet_name: 'Moss', event_type: 'death' })],
      }),
      makeDay('2026-02-06'),
      makeDay('2026-02-08'),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[0]).length).toBe(0); // first-day label suppressed by adjacent death label
    expect(labelsIn(cols[1]).length).toBe(1); // Feb 9 — first occurrence in input
    expect(labelsIn(cols[2]).length).toBe(0); // Feb 2 — later in input, NO label
    expect(labelsIn(cols[4]).length).toBe(1); // last-day label survives
    // death label (index 1) + last day = 2 labels total
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(2);
    // The unlabeled repeat day keeps its death dot
    expect(deathDotsIn(cols[2]).length).toBe(1);
  });
});

// ============================================================
// VC-1. Version-change spec 2026-07-19: label collision
// suppression. Deterministic rule over day indices:
//   - candidates: index 0, last index, every hasDeathLabel day
//   - death labels ALWAYS render
//   - first-day label only if |0 - d| >= 2 for EVERY death-label
//     index d (a death ON index 0 is one label, not two)
//   - last-day label only if |last - d| >= 2 for every
//     death-label index d AND |last - 0| >= 2 when the first-day
//     label rendered
//   - single-day window: exactly one label
// Suppression keys off death-LABEL indices (post per-pet dedup),
// NOT death-event indices.
// ============================================================
describe('CareCalendar -- label collision suppression (spec 2026-07-19)', () => {
  function allLabels(root: Element): Element[] {
    return labelsIn(root as HTMLElement);
  }

  /** indices (into rendered columns) that carry a day label */
  function labeledIndices(root: Element): number[] {
    const out: number[] = [];
    daysIn(root as HTMLElement).forEach((col, i) => {
      if (labelsIn(col).length > 0) out.push(i);
    });
    return out;
  }

  function deathAt(date: string, pet: string) {
    return makeDay(date, {
      dayEvents: [makeEvent({ pet_name: pet, event_type: 'death' })],
    });
  }

  it('THE PIN: 10-day window with death labels at indices 2 and 8 renders labels at EXACTLY {0, 2, 8} — index 9 suppressed', () => {
    const days = makeWindow(10);
    days[2] = deathAt('2026-02-03', 'Pixel');
    days[8] = deathAt('2026-02-09', 'Echo');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 2, 8]);
    expect(allLabels(root).length).toBe(3);
    // every labeled day carries exactly ONE label
    const cols = daysIn(root);
    for (const i of [0, 2, 8]) {
      expect(labelsIn(cols[i]).length).toBe(1);
    }
    expect(labelsIn(cols[9]).length).toBe(0);
  });

  it('2-day death-free window: exactly ONE label, on index 0 (last suppressed: |1-0| < 2 with first rendered)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0]);
    expect(allLabels(root).length).toBe(1);
  });

  it('3-day death-free window: exactly two labels at indices 0 and 2 (|2-0| = 2 clears the bar)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 2]);
    expect(allLabels(root).length).toBe(2);
  });

  it('death on the FIRST day of a 2-day window: exactly ONE label total, on index 0 (death + first collapse to one; last suppressed)', () => {
    const days = makeWindow(2);
    days[0] = deathAt('2026-02-01', 'Moss');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0]);
    expect(allLabels(root).length).toBe(1);
    expect(labelsIn(daysIn(root)[0]).length).toBe(1); // one label, not two
  });

  it('death on the LAST day of a 5-day window: labels at {0, 4}, exactly one label on the death day (death + last collapse)', () => {
    const days = makeWindow(5);
    days[4] = deathAt('2026-02-05', 'Moss');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 4]);
    expect(allLabels(root).length).toBe(2);
    expect(labelsIn(daysIn(root)[4]).length).toBe(1); // never doubled
  });

  it('deaths at indices 0 AND 1 simultaneously (different pets, 5 days): labels at exactly {0, 1, 4}, one per day', () => {
    const days = makeWindow(5);
    days[0] = deathAt('2026-02-01', 'Pixel');
    days[1] = deathAt('2026-02-02', 'Echo');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 1, 4]);
    expect(allLabels(root).length).toBe(3);
    const cols = daysIn(root);
    expect(labelsIn(cols[0]).length).toBe(1);
    expect(labelsIn(cols[1]).length).toBe(1);
  });

  it('adjacent deaths at indices 3 and 4 of 6 (different pets): both death labels render, last-day label (5) suppressed → {0, 3, 4}', () => {
    const days = makeWindow(6);
    days[3] = deathAt('2026-02-04', 'Pixel');
    days[4] = deathAt('2026-02-05', 'Echo');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 3, 4]);
    expect(allLabels(root).length).toBe(3);
  });

  it('ALL 10 days carry deaths (10 distinct pets): exactly one label per day, 10 total — first/last never stack a second label', () => {
    const days = makeWindow(10);
    for (let i = 0; i < 10; i++) {
      days[i] = deathAt(days[i].date, `Pet-${i}`);
    }
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    const cols = daysIn(root);
    expect(cols.length).toBe(10);
    for (const col of cols) {
      expect(labelsIn(col).length).toBe(1);
    }
    expect(allLabels(root).length).toBe(10);
  });

  it('death label at index 1 of 10 suppresses the FIRST-day label; last-day label survives (first did not render) → {1, 9}', () => {
    const days = makeWindow(10);
    days[1] = deathAt('2026-02-02', 'Moss');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([1, 9]);
    expect(allLabels(root).length).toBe(2);
  });

  it('death label at index 8 of 10 suppresses the LAST-day label; first-day label survives → {0, 8}', () => {
    const days = makeWindow(10);
    days[8] = deathAt('2026-02-09', 'Moss');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 8]);
    expect(allLabels(root).length).toBe(2);
  });

  it('suppression keys off death-LABEL indices, not death-EVENT indices: a deduped repeat death at index 8 does NOT suppress the last-day label', () => {
    // Pixel dies at index 2 (labeled) and AGAIN at index 8 (per-pet
    // dedup → dot only, NO death label). Death-label indices = {2},
    // so the last-day label at 9 survives (|9-2| >= 2). A naive
    // implementation using raw death-event indices would suppress it.
    const days = makeWindow(10);
    days[2] = deathAt('2026-02-03', 'Pixel');
    days[8] = deathAt('2026-02-09', 'Pixel');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 2, 9]);
    expect(allLabels(root).length).toBe(3);
    expect(labelsIn(daysIn(root)[8]).length).toBe(0);
    // the deduped repeat still renders its dot
    const dots = eventsIn(daysIn(root)[8]).filter(
      (e) => e.getAttribute('data-event-type') === 'death',
    );
    expect(dots.length).toBe(1);
  });

  it('suppression removes LABELS only — every death dot still renders in the pin scenario', () => {
    const days = makeWindow(10);
    days[2] = deathAt('2026-02-03', 'Pixel');
    days[8] = deathAt('2026-02-09', 'Echo');
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    const deathDots = Array.from(
      root.querySelectorAll('[data-testid="care-event"]'),
    ).filter((e) => e.getAttribute('data-event-type') === 'death');
    expect(deathDots.length).toBe(2);
  });

  it('suppression is recomputed on rerender: growing the window past the dead zone resurrects the last-day label', async () => {
    const days = makeWindow(10);
    days[8] = deathAt('2026-02-09', 'Moss');
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days },
    });
    let root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 8]); // last (9) suppressed
    const grown = makeWindow(12);
    grown[8] = deathAt('2026-02-09', 'Moss');
    await rerender({ days: grown });
    root = getByTestId('care-calendar');
    expect(labeledIndices(root)).toEqual([0, 8, 11]); // |11-8| >= 2 → last returns
  });
});

// ============================================================
// VC-2. Version-change spec 2026-07-19: visible legend —
// rendering conditions, visibility, slot-state entries, and
// the untouched sr-table AT surface.
// ============================================================
describe('CareCalendar -- legend: rendering, visibility & slot-state entries', () => {
  it('legend renders inside the component root with data-testid="care-legend" when days are present', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    const root = getByTestId('care-calendar');
    const legend = legendIn(root);
    expect(legend).not.toBeNull();
    expect(root.contains(legend!)).toBe(true);
  });

  it('legend element itself carries aria-hidden="true"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legend.getAttribute('aria-hidden')).toBe('true');
  });

  it('legend is VISIBLE: neither it nor any ancestor inside the component carries class "sr-only"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    const root = getByTestId('care-calendar');
    const legend = legendIn(root)!;
    let cur: Element | null = legend;
    while (cur && cur !== root.parentElement) {
      expect(cur.classList.contains('sr-only')).toBe(false);
      cur = cur.parentElement;
    }
  });

  it('slot-state entries "session ran" and "no session" each appear EXACTLY once, even in a window with zero sessions and zero events', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(4) },
    });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'session ran')).toBe(1);
    expect(legendLabelCount(legend, 'no session')).toBe(1);
  });

  it('slot-state labels are exact lowercase — no capitalized variants anywhere in the legend', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    const legend = legendIn(getByTestId('care-calendar'))!;
    const text = legend.textContent || '';
    expect(text).toContain('session ran');
    expect(text).toContain('no session');
    expect(text).not.toContain('Session');
    expect(text).not.toContain('No session');
  });

  it('days=[] (hasData false): legend is NOT rendered; empty marker is', () => {
    const { getByTestId } = render(CareCalendar, { props: { days: [] } });
    const root = getByTestId('care-calendar');
    expect(legendIn(root)).toBeNull();
    expect(
      root.querySelector('[data-testid="care-calendar-empty"]'),
    ).not.toBeNull();
  });

  it('days prop omitted: no legend', () => {
    const { getByTestId } = render(CareCalendar, { props: {} });
    expect(legendIn(getByTestId('care-calendar'))).toBeNull();
  });

  it('ALL-malformed days ([null, undefined, 42, "x"]) → hasData false → no legend', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [null, undefined, 42, 'x'] as any },
    });
    expect(legendIn(getByTestId('care-calendar'))).toBeNull();
  });

  it('legend lifecycle tracks hasData across rerenders: present → gone at [] → back again', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    expect(legendIn(getByTestId('care-calendar'))).not.toBeNull();
    await rerender({ days: [] });
    expect(legendIn(getByTestId('care-calendar'))).toBeNull();
    await rerender({ days: makeWindow(3) });
    expect(legendIn(getByTestId('care-calendar'))).not.toBeNull();
  });

  it('sr table stays the untouched AT surface: not aria-hidden, no legend or row-label testids inside it, thead exactly Date/AM/PM/Events, one row per day', () => {
    const days = makeWindow(3);
    days[1] = makeDay('2026-02-02', {
      dayEvents: [makeEvent({ event_type: 'death' })],
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    const table = getByTestId('care-calendar-table');
    expect(isAriaHidden(table, root)).toBe(false);
    expect(table.querySelector('[data-testid="care-legend"]')).toBeNull();
    expect(table.querySelector('[data-testid="care-row-label"]')).toBeNull();
    const ths = Array.from(table.querySelectorAll('thead th')).map((th) =>
      (th.textContent || '').trim(),
    );
    expect(ths).toEqual(['Date', 'AM', 'PM', 'Events']);
    expect(table.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('legend does not mint extra care-event dots: a window with 1 event still has exactly 1 [data-testid="care-event"]', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: 'care' })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    expect(eventsIn(getByTestId('care-calendar')).length).toBe(1);
  });
});

// ============================================================
// VC-3. Version-change spec 2026-07-19: legend event-type
// entries — presence-driven, fixed order, pinned colors.
// ============================================================
describe('CareCalendar -- legend: event-type entries, fixed order & colors', () => {
  const KNOWN = ['acquired', 'care', 'death'];

  it('no events anywhere → NO event-type entries and NO "other": zero known labels, zero known-color or fallback-color swatches', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(5) },
    });
    const legend = legendIn(getByTestId('care-calendar'))!;
    for (const name of KNOWN) {
      expect(legendLabelCount(legend, name)).toBe(0);
    }
    expect(legendLabelCount(legend, 'other')).toBe(0);
    for (const hex of Object.values(EVENT_COLORS)) {
      expect(legendSwatches(legend, hex).length).toBe(0);
    }
    expect(legendSwatches(legend, FALLBACK_COLOR).length).toBe(0);
  });

  it('acquired-only window: exactly one "acquired" entry with exactly one #6bb08a swatch; care/death/other all absent', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: 'acquired' })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'acquired')).toBe(1);
    expect(legendSwatches(legend, EVENT_COLORS.acquired).length).toBe(1);
    expect(legendLabelCount(legend, 'care')).toBe(0);
    expect(legendLabelCount(legend, 'death')).toBe(0);
    expect(legendLabelCount(legend, 'other')).toBe(0);
    expect(legendSwatches(legend, EVENT_COLORS.care).length).toBe(0);
    expect(legendSwatches(legend, EVENT_COLORS.death).length).toBe(0);
    expect(legendSwatches(legend, FALLBACK_COLOR).length).toBe(0);
  });

  it('care-only via a PM slot: exactly one "care" entry with exactly one #7ea7c8 swatch', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot(),
          PM: makeSlot({ events: [makeEvent({ event_type: 'care' })] }),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'care')).toBe(1);
    expect(legendSwatches(legend, EVENT_COLORS.care).length).toBe(1);
    expect(legendLabelCount(legend, 'acquired')).toBe(0);
    expect(legendLabelCount(legend, 'death')).toBe(0);
  });

  it('death-only via dayEvents (no slot events at all): legend still picks it up — one "death" entry, one #ca6c6b swatch', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ event_type: 'death' })],
      }),
      makeDay('2026-02-02'),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'death')).toBe(1);
    expect(legendSwatches(legend, EVENT_COLORS.death).length).toBe(1);
    expect(legendLabelCount(legend, 'acquired')).toBe(0);
    expect(legendLabelCount(legend, 'care')).toBe(0);
    expect(legendLabelCount(legend, 'other')).toBe(0);
  });

  it('all three types present but SCRAMBLED in input (death first, acquired last): legend order is acquired, care, death', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ event_type: 'death' })],
      }),
      makeDay('2026-02-02', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: 'care' })] }),
          PM: makeSlot(),
        },
      }),
      makeDay('2026-02-03', {
        slots: {
          AM: makeSlot(),
          PM: makeSlot({ events: [makeEvent({ event_type: 'acquired' })] }),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    const orderedTexts = deepestExact(legend, KNOWN).map((e) => e.text);
    expect(orderedTexts).toEqual(['acquired', 'care', 'death']);
    for (const hex of Object.values(EVENT_COLORS)) {
      expect(legendSwatches(legend, hex).length).toBe(1);
    }
  });

  it('duplicate types NEVER duplicate entries: five "care" events across days, slots and dayEvents → exactly one "care" entry and one swatch', () => {
    const care = () => makeEvent({ event_type: 'care' });
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [care(), care()],
        slots: { AM: makeSlot({ events: [care()] }), PM: makeSlot() },
      }),
      makeDay('2026-02-02', {
        slots: {
          AM: makeSlot({ events: [care()] }),
          PM: makeSlot({ events: [care()] }),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'care')).toBe(1);
    expect(legendSwatches(legend, EVENT_COLORS.care).length).toBe(1);
  });

  it('a type appearing after a rerender shows up: no events → zero entries, then a death is added → "death" entry appears', async () => {
    const { getByTestId, rerender } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    let legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'death')).toBe(0);
    const days = makeWindow(2);
    days[1] = makeDay('2026-02-02', {
      dayEvents: [makeEvent({ event_type: 'death' })],
    });
    await rerender({ days });
    legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'death')).toBe(1);
    expect(legendSwatches(legend, EVENT_COLORS.death).length).toBe(1);
  });

  it('two instances keep independent legends: acquired-only instance never shows "death" and vice versa', () => {
    const a = render(CareCalendar, {
      props: {
        days: [
          makeDay('2026-02-01', {
            dayEvents: [makeEvent({ event_type: 'acquired' })],
          }),
        ],
      },
    });
    const b = render(CareCalendar, {
      props: {
        days: [
          makeDay('2026-03-01', {
            dayEvents: [makeEvent({ event_type: 'death' })],
          }),
        ],
      },
    });
    const rootA = a.container.querySelector('[data-testid="care-calendar"]')!;
    const rootB = b.container.querySelector('[data-testid="care-calendar"]')!;
    const legendA = legendIn(rootA)!;
    const legendB = legendIn(rootB)!;
    expect(legendLabelCount(legendA, 'acquired')).toBe(1);
    expect(legendLabelCount(legendA, 'death')).toBe(0);
    expect(legendLabelCount(legendB, 'death')).toBe(1);
    expect(legendLabelCount(legendB, 'acquired')).toBe(0);
  });
});

// ============================================================
// VC-4. Version-change spec 2026-07-19: unknown & hostile
// event types collapse to a single "other" legend entry.
// ============================================================
describe('CareCalendar -- legend: unknown & hostile event types → single "other"', () => {
  it('one unknown type "resurrected": exactly one "other" entry with exactly one #838997 swatch; zero known entries', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: 'resurrected' })] }),
          PM: makeSlot(),
        },
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'other')).toBe(1);
    expect(legendSwatches(legend, FALLBACK_COLOR).length).toBe(1);
    expect(legendLabelCount(legend, 'acquired')).toBe(0);
    expect(legendLabelCount(legend, 'care')).toBe(0);
    expect(legendLabelCount(legend, 'death')).toBe(0);
  });

  it('FIVE distinct hostile unknowns ("__proto__", "", 42, null, "🐟💀") still yield exactly ONE "other" entry and ONE fallback swatch', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [
          makeEvent({ event_type: '__proto__' }),
          makeEvent({ event_type: '' }),
        ],
        slots: {
          AM: makeSlot({
            events: [
              makeEvent({ event_type: 42 as any }),
              makeEvent({ event_type: null as any }),
            ],
          }),
          PM: makeSlot({ events: [makeEvent({ event_type: '🐟💀' })] }),
        },
      }),
    ];
    let legend: Element;
    expect(() => {
      const { getByTestId } = render(CareCalendar, { props: { days } });
      legend = legendIn(getByTestId('care-calendar'))!;
    }).not.toThrow();
    expect(legend!).not.toBeNull();
    expect(legendLabelCount(legend!, 'other')).toBe(1);
    expect(legendSwatches(legend!, FALLBACK_COLOR).length).toBe(1);
  });

  it('prototype-chain keys never unlock known entries: "__proto__"/"constructor"/"hasOwnProperty" produce "other" only, no known labels or colors', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [
          makeEvent({ event_type: '__proto__' }),
          makeEvent({ event_type: 'constructor' }),
          makeEvent({ event_type: 'hasOwnProperty' }),
        ],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'other')).toBe(1);
    for (const name of ['acquired', 'care', 'death']) {
      expect(legendLabelCount(legend, name)).toBe(0);
    }
    for (const hex of Object.values(EVENT_COLORS)) {
      expect(legendSwatches(legend, hex).length).toBe(0);
    }
  });

  it('raw unknown type strings never leak into the legend text', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [
          makeEvent({ event_type: 'resurrected' }),
          makeEvent({ event_type: '__proto__' }),
          makeEvent({ event_type: 42 as any }),
        ],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    const text = legend.textContent || '';
    expect(text).not.toContain('resurrected');
    expect(text).not.toContain('__proto__');
    expect(text).not.toContain('42');
  });

  it('XSS payload as an unknown event_type: legend stays inert (no img/script, no execution) and shows exactly one "other"', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ event_type: XSS_PAYLOAD })],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const root = getByTestId('care-calendar');
    const legend = legendIn(root)!;
    expect(legend.querySelector('img')).toBeNull();
    expect(legend.querySelector('script')).toBeNull();
    expect((window as any).__care_pwned).toBeUndefined();
    expect(legendLabelCount(legend, 'other')).toBe(1);
  });

  it('known + unknown mixed ("care" + "__proto__" + "zombie"): one "care" entry AND exactly one "other"', () => {
    const days = [
      makeDay('2026-02-01', {
        slots: {
          AM: makeSlot({ events: [makeEvent({ event_type: 'care' })] }),
          PM: makeSlot({ events: [makeEvent({ event_type: 'zombie' })] }),
        },
        dayEvents: [makeEvent({ event_type: '__proto__' })],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'care')).toBe(1);
    expect(legendSwatches(legend, EVENT_COLORS.care).length).toBe(1);
    expect(legendLabelCount(legend, 'other')).toBe(1);
    expect(legendSwatches(legend, FALLBACK_COLOR).length).toBe(1);
  });

  it('type matching is LITERAL: "Death" (capitalized) is unknown → "other" entry, NO "death" entry, no #ca6c6b swatch in the legend', () => {
    const days = [
      makeDay('2026-02-01', {
        dayEvents: [makeEvent({ event_type: 'Death' })],
      }),
    ];
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const legend = legendIn(getByTestId('care-calendar'))!;
    expect(legendLabelCount(legend, 'other')).toBe(1);
    expect(legendLabelCount(legend, 'death')).toBe(0);
    expect(legendSwatches(legend, EVENT_COLORS.death).length).toBe(0);
    expect(legendSwatches(legend, FALLBACK_COLOR).length).toBe(1);
  });
});

// ============================================================
// VC-5. Version-change spec 2026-07-19: visible AM/PM row
// labels inside the aria-hidden grid area.
// ============================================================
describe('CareCalendar -- AM/PM row labels', () => {
  it('exactly TWO care-row-label elements with texts exactly ["AM", "PM"] in document order (multi-day window)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(5) },
    });
    const labels = rowLabelsIn(getByTestId('care-calendar'));
    expect(labels.length).toBe(2);
    expect(labels.map((l) => (l.textContent || '').trim())).toEqual([
      'AM',
      'PM',
    ]);
  });

  it('row labels live inside an aria-hidden subtree (the sr table remains the AT surface)', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(3) },
    });
    const root = getByTestId('care-calendar');
    const labels = rowLabelsIn(root);
    expect(labels.length).toBe(2);
    for (const label of labels) {
      expect(isAriaHidden(label, root)).toBe(true);
    }
  });

  it('days=[]: no row labels (no grid, no labels)', () => {
    const { getByTestId } = render(CareCalendar, { props: { days: [] } });
    expect(rowLabelsIn(getByTestId('care-calendar')).length).toBe(0);
  });

  it('single-day window still gets exactly 2 row labels', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: [makeDay('2026-02-01')] },
    });
    const labels = rowLabelsIn(getByTestId('care-calendar'));
    expect(labels.length).toBe(2);
  });

  it('a 50-day window still has exactly 2 row labels — labels are per ROW, never per day', () => {
    const days = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(Date.UTC(2026, 1, 1) + i * 86400000);
      days.push(makeDay(d.toISOString().slice(0, 10)));
    }
    const { getByTestId } = render(CareCalendar, { props: { days } });
    expect(rowLabelsIn(getByTestId('care-calendar')).length).toBe(2);
  });

  it('row labels never masquerade as day labels: no care-day-label carries the text "AM" or "PM"', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(4) },
    });
    const dayLabels = labelsIn(getByTestId('care-calendar'));
    for (const label of dayLabels) {
      const text = (label.textContent || '').trim();
      expect(text).not.toBe('AM');
      expect(text).not.toBe('PM');
    }
  });

  it('row labels never appear inside the sr table', () => {
    const { getByTestId } = render(CareCalendar, {
      props: { days: makeWindow(2) },
    });
    const table = getByTestId('care-calendar-table');
    expect(table.querySelector('[data-testid="care-row-label"]')).toBeNull();
  });
});
