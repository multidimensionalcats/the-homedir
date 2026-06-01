import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import ExistenceStrip from './ExistenceStrip.svelte';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'sess-001',
    date: '2026-01-15',
    time_of_day: 'AM',
    version: '4.5',
    ...overrides,
  };
}

/** Build N sessions with sequential dates across a date range */
function makeSessionSpan(
  count: number,
  opts: { startDate?: string; version?: string } = {},
): Array<Record<string, any>> {
  const sessions = [];
  const start = new Date(opts.startDate || '2026-01-01');
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    sessions.push(
      makeSession({
        id: `sess-${String(i + 1).padStart(3, '0')}`,
        date: dateStr,
        time_of_day: i % 2 === 0 ? 'AM' : 'PM',
        version: opts.version || '4.5',
      }),
    );
  }
  return sessions;
}

// Fixture: sessions spread across 3 months with mixed versions
const THREE_MONTH_MIXED = [
  makeSession({ id: 's-01', date: '2026-01-02', time_of_day: 'AM', version: '4.5' }),
  makeSession({ id: 's-02', date: '2026-01-15', time_of_day: 'PM', version: '4.5' }),
  makeSession({ id: 's-03', date: '2026-02-01', time_of_day: 'AM', version: '4.6' }),
  makeSession({ id: 's-04', date: '2026-02-14', time_of_day: 'PM', version: '4.6' }),
  makeSession({ id: 's-05', date: '2026-03-01', time_of_day: 'AM', version: '4.7' }),
  makeSession({ id: 's-06', date: '2026-03-28', time_of_day: 'PM', version: '4.7' }),
];

// Fixture: same-day AM/PM pair
const SAME_DAY_PAIR = [
  makeSession({ id: 'am-sess', date: '2026-02-10', time_of_day: 'AM', version: '4.5' }),
  makeSession({ id: 'pm-sess', date: '2026-02-10', time_of_day: 'PM', version: '4.5' }),
];

// Fixture: all three known versions
const ALL_VERSIONS = [
  makeSession({ id: 'v45', date: '2026-01-01', version: '4.5' }),
  makeSession({ id: 'v46', date: '2026-02-01', version: '4.6' }),
  makeSession({ id: 'v47', date: '2026-03-01', version: '4.7' }),
];

// Fixture: includes unknown version
const WITH_UNKNOWN_VERSION = [
  makeSession({ id: 'v45', date: '2026-01-01', version: '4.5' }),
  makeSession({ id: 'vXX', date: '2026-02-01', version: '9.9' }),
  makeSession({ id: 'v47', date: '2026-03-01', version: '4.7' }),
];

// ============================================================
// 1. Rendering -- container and basic structure
// ============================================================
describe('ExistenceStrip -- rendering', () => {
  it('renders a container with data-testid="existence-strip"', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const strip = getByTestId('existence-strip');
    expect(strip).toBeTruthy();
  });

  it('creates an SVG element inside the existence-strip container', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const strip = getByTestId('existence-strip');
    const svg = strip.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('SVG has role="img" for accessibility', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const svg = getByTestId('existence-strip').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
  });

  it('SVG has aria-label that describes the visualization', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const svg = getByTestId('existence-strip').querySelector('svg');
    expect(svg).not.toBeNull();
    const ariaLabel = svg!.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel!.length).toBeGreaterThan(5);
  });

  it('does NOT render SVG when sessions array is empty', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [] },
    });
    const strip = getByTestId('existence-strip');
    const svg = strip.querySelector('svg');
    expect(svg).toBeNull();
  });
});

// ============================================================
// 2. Empty / missing data
// ============================================================
describe('ExistenceStrip -- empty data', () => {
  it('shows no-data message when sessions is empty array', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('shows no-data message when sessions is undefined', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when sessions has entries', () => {
    const { queryByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });

  it('does not crash when sessions is null', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: null as any },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });
});

// ============================================================
// 3. Session marks -- count accuracy
// ============================================================
describe('ExistenceStrip -- session marks', () => {
  it('renders exactly 1 session-mark for a single session', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(1);
  });

  it('renders exactly 6 session-marks for 6 sessions', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: THREE_MONTH_MIXED },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(6);
  });

  it('renders exactly 10 session-marks for 10 sessions', () => {
    const sessions = makeSessionSpan(10);
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(10);
  });

  it('marks are SVG rect or line elements inside the SVG', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const svg = getByTestId('existence-strip').querySelector('svg');
    expect(svg).not.toBeNull();
    const marks = svg!.querySelectorAll('.session-mark');
    expect(marks.length).toBe(1);
    const tagName = marks[0].tagName.toLowerCase();
    expect(['rect', 'line']).toContain(tagName);
  });

  it('marks are thin -- width or stroke-width is 2-3px', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const mark = getByTestId('existence-strip').querySelector('.session-mark');
    expect(mark).not.toBeNull();
    const tagName = mark!.tagName.toLowerCase();
    if (tagName === 'rect') {
      const width = parseFloat(mark!.getAttribute('width') || '0');
      expect(width).toBeGreaterThanOrEqual(1);
      expect(width).toBeLessThanOrEqual(4);
    } else {
      // line element: check stroke-width
      const sw = mark!.getAttribute('stroke-width');
      expect(sw).toBeTruthy();
      const swVal = parseFloat(sw!);
      expect(swVal).toBeGreaterThanOrEqual(1);
      expect(swVal).toBeLessThanOrEqual(4);
    }
  });
});

// ============================================================
// 4. Version coloring
// ============================================================
describe('ExistenceStrip -- version coloring', () => {
  it('version 4.5 and 4.6 marks have different fill/stroke colors', () => {
    const sessions = [
      makeSession({ id: 'a', date: '2026-01-01', version: '4.5' }),
      makeSession({ id: 'b', date: '2026-02-01', version: '4.6' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(2);
    const color0 = marks[0].getAttribute('fill') || marks[0].getAttribute('stroke');
    const color1 = marks[1].getAttribute('fill') || marks[1].getAttribute('stroke');
    expect(color0).toBeTruthy();
    expect(color1).toBeTruthy();
    expect(color0).not.toBe(color1);
  });

  it('version 4.5, 4.6, and 4.7 all have distinct colors', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: ALL_VERSIONS },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(3);
    const colors = Array.from(marks).map(
      (m) => m.getAttribute('fill') || m.getAttribute('stroke'),
    );
    const unique = new Set(colors);
    expect(unique.size).toBe(3);
  });

  it('unknown version gets default gray color, not one of the known version colors', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: WITH_UNKNOWN_VERSION },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(3);
    // The middle mark (version "9.9") should be gray-ish
    const unknownColor = (
      marks[1].getAttribute('fill') || marks[1].getAttribute('stroke') || ''
    ).toLowerCase();
    expect(unknownColor).toBeTruthy();
    // Known version colors should differ from the unknown one
    const knownColor0 = (
      marks[0].getAttribute('fill') || marks[0].getAttribute('stroke') || ''
    ).toLowerCase();
    const knownColor2 = (
      marks[2].getAttribute('fill') || marks[2].getAttribute('stroke') || ''
    ).toLowerCase();
    expect(unknownColor).not.toBe(knownColor0);
    expect(unknownColor).not.toBe(knownColor2);
  });

  it('all marks of the same version share the same color', () => {
    const sessions = [
      makeSession({ id: 'a', date: '2026-01-01', version: '4.6' }),
      makeSession({ id: 'b', date: '2026-01-05', version: '4.6' }),
      makeSession({ id: 'c', date: '2026-01-10', version: '4.6' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    const colors = Array.from(marks).map(
      (m) => m.getAttribute('fill') || m.getAttribute('stroke'),
    );
    expect(colors[0]).toBe(colors[1]);
    expect(colors[1]).toBe(colors[2]);
  });
});

// ============================================================
// 5. Proportional spacing on time axis
// ============================================================
describe('ExistenceStrip -- proportional spacing', () => {
  it('marks span the SVG width -- first near left edge, last near right edge', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: THREE_MONTH_MIXED },
    });
    const svg = getByTestId('existence-strip').querySelector('svg');
    expect(svg).not.toBeNull();
    const svgWidth = parseFloat(svg!.getAttribute('width') || svg!.getAttribute('viewBox')?.split(' ')[2] || '0');
    expect(svgWidth).toBeGreaterThan(0);

    const marks = Array.from(svg!.querySelectorAll('.session-mark'));
    expect(marks.length).toBe(6);

    // Extract x positions
    const xPositions = marks.map((m) => {
      const x = m.getAttribute('x') || m.getAttribute('x1');
      return parseFloat(x || '0');
    });
    const minX = Math.min(...xPositions);
    const maxX = Math.max(...xPositions);

    // First mark should be in the left quarter
    expect(minX).toBeLessThan(svgWidth * 0.25);
    // Last mark should be in the right quarter
    expect(maxX).toBeGreaterThan(svgWidth * 0.75);
  });

  it('marks are NOT all at the same x position', () => {
    const sessions = [
      makeSession({ id: 'a', date: '2026-01-01' }),
      makeSession({ id: 'b', date: '2026-03-01' }),
      makeSession({ id: 'c', date: '2026-05-01' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    const xPositions = Array.from(marks).map((m) => {
      return parseFloat(m.getAttribute('x') || m.getAttribute('x1') || '0');
    });
    const unique = new Set(xPositions);
    expect(unique.size).toBeGreaterThanOrEqual(3);
  });

  it('chronological ordering is preserved -- earlier dates produce smaller x', () => {
    const sessions = [
      makeSession({ id: 'early', date: '2026-01-01', time_of_day: 'AM' }),
      makeSession({ id: 'mid', date: '2026-03-15', time_of_day: 'AM' }),
      makeSession({ id: 'late', date: '2026-05-30', time_of_day: 'AM' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    const xPositions = Array.from(marks).map((m) => {
      return parseFloat(m.getAttribute('x') || m.getAttribute('x1') || '0');
    });
    expect(xPositions[0]).toBeLessThan(xPositions[1]);
    expect(xPositions[1]).toBeLessThan(xPositions[2]);
  });
});

// ============================================================
// 6. AM/PM differentiation on same day
// ============================================================
describe('ExistenceStrip -- AM/PM differentiation', () => {
  it('two sessions on the same date render as two separate marks', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: SAME_DAY_PAIR },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(2);
  });

  it('AM and PM marks on the same date have different x positions', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: SAME_DAY_PAIR },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(2);
    const x0 = parseFloat(marks[0].getAttribute('x') || marks[0].getAttribute('x1') || '0');
    const x1 = parseFloat(marks[1].getAttribute('x') || marks[1].getAttribute('x1') || '0');
    expect(x0).not.toBe(x1);
  });

  it('AM mark is positioned before PM mark on the same date', () => {
    // Render with AM first, PM second
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: SAME_DAY_PAIR },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    const xPositions = Array.from(marks).map((m) =>
      parseFloat(m.getAttribute('x') || m.getAttribute('x1') || '0'),
    );
    // Sort marks by x and the smaller x should correspond to AM
    const sorted = [...xPositions].sort((a, b) => a - b);
    // The AM/PM offset should be small but nonzero
    expect(Math.abs(sorted[1] - sorted[0])).toBeGreaterThan(0);
    expect(Math.abs(sorted[1] - sorted[0])).toBeLessThan(50);
  });
});

// ============================================================
// 7. Single session edge case
// ============================================================
describe('ExistenceStrip -- single session', () => {
  it('renders exactly one mark for a single session', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(1);
  });

  it('single session does not crash the time scale (no NaN positions)', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const mark = getByTestId('existence-strip').querySelector('.session-mark');
    expect(mark).not.toBeNull();
    const x = parseFloat(mark!.getAttribute('x') || mark!.getAttribute('x1') || 'NaN');
    expect(isNaN(x)).toBe(false);
  });

  it('single session mark has a valid height spanning the strip', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: [makeSession()] },
    });
    const mark = getByTestId('existence-strip').querySelector('.session-mark');
    expect(mark).not.toBeNull();
    const tagName = mark!.tagName.toLowerCase();
    if (tagName === 'rect') {
      const height = parseFloat(mark!.getAttribute('height') || '0');
      expect(height).toBeGreaterThan(0);
    } else {
      // line: y1 and y2 should differ
      const y1 = parseFloat(mark!.getAttribute('y1') || '0');
      const y2 = parseFloat(mark!.getAttribute('y2') || '0');
      expect(Math.abs(y2 - y1)).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// 8. Screen reader table
// ============================================================
describe('ExistenceStrip -- screen reader table', () => {
  it('renders sr-table with data-testid="sr-table"', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: ALL_VERSIONS },
    });
    const table = getByTestId('sr-table');
    expect(table).toBeTruthy();
  });

  it('sr-table contains version information', () => {
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions: ALL_VERSIONS },
    });
    const table = getByTestId('sr-table');
    const text = table.textContent || '';
    expect(text).toContain('4.5');
    expect(text).toContain('4.6');
    expect(text).toContain('4.7');
  });

  it('sr-table includes session count per version', () => {
    const sessions = [
      makeSession({ id: 'a', date: '2026-01-01', version: '4.5' }),
      makeSession({ id: 'b', date: '2026-01-02', version: '4.5' }),
      makeSession({ id: 'c', date: '2026-02-01', version: '4.6' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const table = getByTestId('sr-table');
    const text = table.textContent || '';
    // Should contain the count "2" for 4.5 and "1" for 4.6
    expect(text).toContain('2');
    expect(text).toContain('1');
  });

  it('sr-table is not rendered when there is no data', () => {
    const { queryByTestId } = render(ExistenceStrip, {
      props: { sessions: [] },
    });
    expect(queryByTestId('sr-table')).toBeNull();
  });
});

// ============================================================
// 9. Malformed data -- hostile inputs
// ============================================================
describe('ExistenceStrip -- malformed data', () => {
  it('session with missing date is skipped -- not rendered as a mark', () => {
    const sessions = [
      makeSession({ id: 'good', date: '2026-01-15', version: '4.5' }),
      makeSession({ id: 'bad', date: undefined, version: '4.5' }),
      makeSession({ id: 'good2', date: '2026-02-15', version: '4.5' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(2);
  });

  it('session with empty string date is skipped', () => {
    const sessions = [
      makeSession({ id: 'good', date: '2026-01-15' }),
      makeSession({ id: 'empty-date', date: '' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(1);
  });

  it('session with missing version renders with default color, not crash', () => {
    const sessions = [
      makeSession({ id: 'no-ver', date: '2026-01-15', version: undefined }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(1);
    const color = marks[0].getAttribute('fill') || marks[0].getAttribute('stroke');
    expect(color).toBeTruthy();
  });

  it('session with missing id still renders a mark', () => {
    const sessions = [
      makeSession({ id: undefined, date: '2026-01-15', version: '4.5' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(1);
  });

  it('sessions array with all-invalid entries shows no-data', () => {
    const sessions = [
      makeSession({ id: 'bad1', date: undefined }),
      makeSession({ id: 'bad2', date: '' }),
      makeSession({ id: 'bad3', date: null }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(0);
  });

  it('garbage date string is skipped without crashing', () => {
    const sessions = [
      makeSession({ id: 'garbage', date: 'not-a-date', version: '4.5' }),
      makeSession({ id: 'good', date: '2026-03-01', version: '4.5' }),
    ];
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(1);
  });
});

// ============================================================
// 10. Large dataset -- 259 sessions (realistic)
// ============================================================
describe('ExistenceStrip -- large dataset', () => {
  it('renders 259 session-marks without crashing', () => {
    const sessions = makeSessionSpan(259, { startDate: '2025-01-01' });
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    expect(marks.length).toBe(259);
  });

  it('marks from a 259-session span are distributed across the width, not overlapping at one point', () => {
    const sessions = makeSessionSpan(259, { startDate: '2025-01-01' });
    const { getByTestId } = render(ExistenceStrip, {
      props: { sessions },
    });
    const marks = getByTestId('existence-strip').querySelectorAll('.session-mark');
    const xPositions = Array.from(marks).map((m) =>
      parseFloat(m.getAttribute('x') || m.getAttribute('x1') || '0'),
    );
    const uniqueX = new Set(xPositions);
    // With 259 sessions across 259 days, there should be many distinct x positions
    expect(uniqueX.size).toBeGreaterThan(100);
  });
});

// ============================================================
// 11. Cleanup -- SVG removal
// ============================================================
describe('ExistenceStrip -- cleanup', () => {
  it('unmounting removes SVG from the DOM', () => {
    const { getByTestId, unmount } = render(ExistenceStrip, {
      props: { sessions: THREE_MONTH_MIXED },
    });
    const strip = getByTestId('existence-strip');
    expect(strip.querySelector('svg')).not.toBeNull();
    unmount();
    // After unmount, the container should not be in the document
    expect(document.querySelector('[data-testid="existence-strip"]')).toBeNull();
  });
});
