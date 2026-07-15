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
// 6. Sparse date labels — first, last, death days ONLY
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

  it('a DAY-level death on a middle day adds a label to that day', () => {
    const days = makeWindow(5);
    days[3] = makeDay('2026-02-04', {
      dayEvents: [makeEvent({ event_type: 'death' })],
    });
    const { getByTestId } = render(CareCalendar, { props: { days } });
    const cols = daysIn(getByTestId('care-calendar'));
    expect(labelsIn(cols[3]).length).toBe(1);
    expect(labelsIn(getByTestId('care-calendar')).length).toBe(3);
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

  it('two ADJACENT middle death days each carry exactly one label (total 4 with endpoints)', () => {
    const days = makeWindow(6);
    days[2] = makeDay('2026-02-03', {
      dayEvents: [makeEvent({ event_type: 'death' })],
    });
    days[3] = makeDay('2026-02-04', {
      slots: {
        AM: makeSlot(),
        PM: makeSlot({ events: [makeEvent({ event_type: 'death' })] }),
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
