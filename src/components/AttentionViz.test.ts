import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import AttentionViz from './AttentionViz.svelte';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'sess-001',
    date: '2026-01-15',
    time_of_day: 'PM',
    version: '4.5',
    attention_profile: {
      daily_notes: { reads: 2, writes: 1 },
      writing: { reads: 0, writes: 1 },
    },
    ...overrides,
  };
}

function makeVoidSession(overrides: Record<string, any> = {}) {
  return makeSession({ attention_profile: {}, ...overrides });
}

// All 13 canonical attention categories
const ALL_13_CATEGORIES: Record<string, { reads: number; writes: number }> = {
  conversations: { reads: 3, writes: 0 },
  daily_notes: { reads: 2, writes: 1 },
  experiments: { reads: 1, writes: 0 },
  learning: { reads: 0, writes: 2 },
  memory_files: { reads: 5, writes: 3 },
  msgs_from_james: { reads: 1, writes: 0 },
  msgs_to_james: { reads: 0, writes: 1 },
  other: { reads: 1, writes: 1 },
  predictions: { reads: 0, writes: 1 },
  private_journal: { reads: 0, writes: 1 },
  scripts: { reads: 2, writes: 0 },
  tamagotchi: { reads: 1, writes: 1 },
  writing: { reads: 0, writes: 3 },
};

// ============================================================
// Rendering
// ============================================================
describe('AttentionViz -- rendering', () => {
  it('renders without crashing with session data', () => {
    const { container } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data when sessions is an empty array', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
  });

  it('shows no-data when sessions is undefined', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when sessions has entries', () => {
    const { queryByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// SVG Structure
// ============================================================
describe('AttentionViz -- SVG structure', () => {
  it('creates an SVG element inside chart container', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('SVG has role="img" and aria-label', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders rect elements for heatmap cells -- 2 sessions x 2 categories = at least 4 rects', () => {
    const sessions = [
      makeSession({
        id: 'sess-001',
        date: '2026-01-15',
        time_of_day: 'AM',
        attention_profile: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 0, writes: 1 },
        },
      }),
      makeSession({
        id: 'sess-002',
        date: '2026-01-15',
        time_of_day: 'PM',
        attention_profile: {
          daily_notes: { reads: 2, writes: 0 },
          writing: { reads: 1, writes: 0 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(4);
  });

  it('renders category labels as text elements on Y axis', () => {
    const sessions = [
      makeSession({
        attention_profile: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 0, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const textElements = svg!.querySelectorAll('text');
    expect(textElements.length).toBeGreaterThan(0);
    const textContents = Array.from(textElements).map((t) => t.textContent || '');
    const hasCategoryLabel = textContents.some(
      (t) =>
        t.toLowerCase().includes('daily') ||
        t.toLowerCase().includes('writing') ||
        t.toLowerCase().includes('notes'),
    );
    expect(hasCategoryLabel).toBe(true);
  });

  it('renders rects only for categories with actual activity (val > 0)', () => {
    const sessions = [
      makeSession({
        id: 'sess-001',
        date: '2026-01-15',
        time_of_day: 'AM',
        attention_profile: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 0, writes: 1 },
          scripts: { reads: 1, writes: 1 },
        },
      }),
      makeSession({
        id: 'sess-002',
        date: '2026-01-15',
        time_of_day: 'PM',
        attention_profile: {
          daily_notes: { reads: 2, writes: 0 },
          writing: { reads: 1, writes: 0 },
          scripts: { reads: 0, writes: 1 },
        },
      }),
      makeSession({
        id: 'sess-003',
        date: '2026-01-16',
        time_of_day: 'AM',
        attention_profile: {
          daily_notes: { reads: 0, writes: 1 },
          writing: { reads: 0, writes: 0 },
          scripts: { reads: 1, writes: 0 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('.data-cell');
    // 3+3+2 = 8 active cells (sess-003 writing has 0 activity, no rect)
    expect(rects.length).toBe(8);
  });

  it('renders one column per session not per day', () => {
    // 2 sessions on the same day should produce 2 columns, not 1
    const sessions = [
      makeSession({
        id: 'sess-001',
        date: '2026-01-15',
        time_of_day: 'AM',
        attention_profile: { daily_notes: { reads: 1, writes: 0 } },
      }),
      makeSession({
        id: 'sess-002',
        date: '2026-01-15',
        time_of_day: 'PM',
        attention_profile: { daily_notes: { reads: 2, writes: 0 } },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    // 2 sessions x 1 category = 2 data cells (one per session column)
    expect(dataCells.length).toBe(2);
  });
});

// ============================================================
// Void Treatment (CRITICAL -- council design)
// ============================================================
describe('AttentionViz -- void treatment', () => {
  const mixedSessions = [
    makeSession({
      id: 'sess-001',
      date: '2026-01-15',
      time_of_day: 'AM',
      attention_profile: {
        daily_notes: { reads: 2, writes: 1 },
        writing: { reads: 0, writes: 1 },
      },
    }),
    makeVoidSession({
      id: 'sess-002',
      date: '2026-01-15',
      time_of_day: 'PM',
    }),
  ];

  it('void cells have class "void-cell"', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: mixedSessions },
    });
    const containerEl = getByTestId('chart-container');
    const voidCells = containerEl.querySelectorAll('.void-cell');
    expect(voidCells.length).toBeGreaterThan(0);
  });

  it('data cells have class "data-cell"', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: mixedSessions },
    });
    const containerEl = getByTestId('chart-container');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    expect(dataCells.length).toBeGreaterThan(0);
  });

  it('void cells do NOT have data-cell class and vice versa', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: mixedSessions },
    });
    const containerEl = getByTestId('chart-container');
    // No element should have both classes
    const dualClass = containerEl.querySelectorAll('.void-cell.data-cell');
    expect(dualClass.length).toBe(0);
    // Both classes must independently exist
    const voidCells = containerEl.querySelectorAll('.void-cell');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    expect(voidCells.length).toBeGreaterThan(0);
    expect(dataCells.length).toBeGreaterThan(0);
  });

  it('ALL void sessions render SVG with void cells (not empty)', () => {
    const allVoidSessions = [
      makeVoidSession({ id: 'sess-001', date: '2026-01-15', time_of_day: 'AM' }),
      makeVoidSession({ id: 'sess-002', date: '2026-01-15', time_of_day: 'PM' }),
      makeVoidSession({ id: 'sess-003', date: '2026-01-16', time_of_day: 'AM' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: allVoidSessions },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const voidCells = containerEl.querySelectorAll('.void-cell');
    // Even all-void data must produce visible void cells
    expect(voidCells.length).toBeGreaterThan(0);
  });

  it('void cells are structurally distinct from data cells -- different fill attributes', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: mixedSessions },
    });
    const containerEl = getByTestId('chart-container');
    const voidCell = containerEl.querySelector('.void-cell');
    const dataCell = containerEl.querySelector('.data-cell');
    expect(voidCell).not.toBeNull();
    expect(dataCell).not.toBeNull();
    const voidFill = voidCell!.getAttribute('fill');
    const dataFill = dataCell!.getAttribute('fill');
    // Void and data cells MUST have different fills -- the three-delta design requires it
    expect(voidFill).not.toBe(dataFill);
  });

  it('zero-activity category on observed session gets data-cell class NOT void-cell', () => {
    // Key distinction: observed-but-zero != void
    // A session with non-empty attention_profile but a category with 0 reads + 0 writes
    // is still a DATA cell (observed zero), not a void cell (unrecorded session)
    const dataWithZero = [
      makeSession({
        id: 'sess-001',
        date: '2026-01-15',
        time_of_day: 'AM',
        attention_profile: {
          daily_notes: { reads: 0, writes: 0 },
          writing: { reads: 3, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: dataWithZero },
    });
    const containerEl = getByTestId('chart-container');
    // All cells on an observed session should be data-cell, even zero-activity ones
    const dataCells = containerEl.querySelectorAll('.data-cell');
    const voidCells = containerEl.querySelectorAll('.void-cell');
    expect(dataCells.length).toBeGreaterThan(0);
    expect(voidCells.length).toBe(0);
  });

  it('~50% void when given half void sessions', () => {
    // 4 sessions: 2 void + 2 with data, each with 2 categories
    const sessions = [
      makeSession({
        id: 'sess-001', date: '2026-01-15', time_of_day: 'AM',
        attention_profile: { daily_notes: { reads: 1, writes: 0 }, writing: { reads: 0, writes: 1 } },
      }),
      makeVoidSession({ id: 'sess-002', date: '2026-01-15', time_of_day: 'PM' }),
      makeSession({
        id: 'sess-003', date: '2026-01-16', time_of_day: 'AM',
        attention_profile: { daily_notes: { reads: 2, writes: 0 }, writing: { reads: 1, writes: 0 } },
      }),
      makeVoidSession({ id: 'sess-004', date: '2026-01-16', time_of_day: 'PM' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const voidCells = containerEl.querySelectorAll('.void-cell');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    const total = voidCells.length + dataCells.length;
    // Void should be roughly 50% (2 void x 2 categories = 4, 2 data x 2 categories = 4)
    const voidRatio = voidCells.length / total;
    expect(voidRatio).toBeGreaterThanOrEqual(0.4);
    expect(voidRatio).toBeLessThanOrEqual(0.6);
  });
});

// ============================================================
// Version Boundaries
// ============================================================
describe('AttentionViz -- version boundaries', () => {
  it('renders version boundary markers when version changes between consecutive sessions', () => {
    const sessions = [
      makeSession({ id: 'sess-001', date: '2026-01-15', time_of_day: 'AM', version: '4.5' }),
      makeSession({ id: 'sess-002', date: '2026-01-15', time_of_day: 'PM', version: '4.5' }),
      makeSession({ id: 'sess-003', date: '2026-01-16', time_of_day: 'AM', version: '4.6' }),
      makeSession({ id: 'sess-004', date: '2026-01-16', time_of_day: 'PM', version: '4.6' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBeGreaterThan(0);
  });

  it('no version boundaries when all entries have same version', () => {
    const sessions = [
      makeSession({ id: 'sess-001', date: '2026-01-15', time_of_day: 'AM', version: '4.5' }),
      makeSession({ id: 'sess-002', date: '2026-01-15', time_of_day: 'PM', version: '4.5' }),
      makeSession({ id: 'sess-003', date: '2026-01-16', time_of_day: 'AM', version: '4.5' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBe(0);
  });

  it('renders version labels as text containing version numbers', () => {
    const sessions = [
      makeSession({ id: 'sess-001', date: '2026-01-15', time_of_day: 'AM', version: '4.5' }),
      makeSession({ id: 'sess-002', date: '2026-01-15', time_of_day: 'PM', version: '4.6' }),
      makeSession({ id: 'sess-003', date: '2026-01-16', time_of_day: 'AM', version: '4.7' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const textElements = Array.from(svg!.querySelectorAll('text'));
    const allText = textElements.map((t) => t.textContent || '').join(' ');
    // At least one version label must appear in the SVG text
    const hasVersionLabel =
      allText.includes('4.5') || allText.includes('4.6') || allText.includes('4.7');
    expect(hasVersionLabel).toBe(true);
  });
});

// ============================================================
// Accessibility
// ============================================================
describe('AttentionViz -- accessibility', () => {
  it('renders a screen reader table with data-testid="sr-table"', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('screen reader table contains a "Session" header', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    const srTable = getByTestId('sr-table');
    const thElements = srTable.querySelectorAll('th');
    const headerTexts = Array.from(thElements).map((th) => th.textContent || '');
    expect(headerTexts.some((h) => h.toLowerCase().includes('session'))).toBe(true);
  });

  it('screen reader table shows void indicator for unrecorded sessions', () => {
    const sessions = [
      makeSession({ id: 'sess-001', date: '2026-01-15', time_of_day: 'AM' }),
      makeVoidSession({ id: 'sess-002', date: '2026-01-16', time_of_day: 'AM' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const srTable = getByTestId('sr-table');
    const tableContent = srTable.textContent || '';
    // Void rows must show a void indicator character
    const hasVoidIndicator = tableContent.includes('∅') || tableContent.includes('-');
    expect(hasVoidIndicator).toBe(true);
  });

  it('component has ARIA description on container or SVG', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    // Either the container or SVG must have an aria-label or aria-describedby
    const containerHasAria =
      containerEl.getAttribute('aria-label') ||
      containerEl.getAttribute('aria-describedby');
    const svgHasAria = svg
      ? svg.getAttribute('aria-label') || svg.getAttribute('aria-describedby')
      : null;
    expect(containerHasAria || svgHasAria).toBeTruthy();
  });
});

// ============================================================
// Per-session columns (replaces weekly data tests)
// ============================================================
describe('AttentionViz -- per-session columns', () => {
  it('renders one column per session, not per day', () => {
    // 3 sessions across 2 days should produce 3 columns
    const sessions = [
      makeSession({
        id: 'sess-001', date: '2026-01-15', time_of_day: 'AM',
        attention_profile: { daily_notes: { reads: 1, writes: 0 } },
      }),
      makeSession({
        id: 'sess-002', date: '2026-01-15', time_of_day: 'PM',
        attention_profile: { daily_notes: { reads: 2, writes: 0 } },
      }),
      makeSession({
        id: 'sess-003', date: '2026-01-16', time_of_day: 'AM',
        attention_profile: { daily_notes: { reads: 1, writes: 1 } },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    // 3 sessions x 1 category = 3 data cells
    expect(dataCells.length).toBe(3);
  });

  it('sorts sessions by date then time_of_day', () => {
    // Feed sessions out of order; verify data-date attributes are sorted
    const sessions = [
      makeSession({
        id: 'sess-003', date: '2026-01-16', time_of_day: 'AM',
        attention_profile: { daily_notes: { reads: 1, writes: 0 } },
      }),
      makeSession({
        id: 'sess-001', date: '2026-01-15', time_of_day: 'AM',
        attention_profile: { daily_notes: { reads: 1, writes: 0 } },
      }),
      makeSession({
        id: 'sess-002', date: '2026-01-15', time_of_day: 'PM',
        attention_profile: { daily_notes: { reads: 1, writes: 0 } },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    const dates = Array.from(dataCells).map((c) => c.getAttribute('data-date'));
    expect(dates).toEqual(['2026-01-15', '2026-01-15', '2026-01-16']);
  });

  it('accepts sessions with only the sessions prop (no data or weeklyData)', () => {
    const { container, queryByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    expect(container).toBeTruthy();
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// Category Colors
// ============================================================
describe('AttentionViz -- category colors', () => {
  it('renders different fill colors for different categories', () => {
    const sessions = [
      makeSession({
        id: 'sess-001',
        date: '2026-01-15',
        time_of_day: 'AM',
        attention_profile: {
          daily_notes: { reads: 2, writes: 1 },
          writing: { reads: 1, writes: 1 },
          memory_files: { reads: 3, writes: 2 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    // Gather unique fill colors
    const fills = new Set<string>();
    dataCells.forEach((cell) => {
      const fill = cell.getAttribute('fill');
      if (fill) fills.add(fill);
    });
    // At least 3 different category colors (daily_notes, writing, memory_files all have different colors)
    expect(fills.size).toBeGreaterThanOrEqual(3);
  });

  it('uses categoryColor() for data cell fills, not a single hardcoded color', () => {
    const sessions = [
      makeSession({
        id: 'sess-001',
        date: '2026-01-15',
        time_of_day: 'AM',
        attention_profile: {
          daily_notes: { reads: 2, writes: 1 },
          writing: { reads: 1, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    // No data cell should have the old hardcoded teal base '#1C2425'
    dataCells.forEach((cell) => {
      expect(cell.getAttribute('fill')).not.toBe('#1C2425');
      expect(cell.getAttribute('fill')).not.toBe('#2AA9A9');
    });
  });
});

// ============================================================
// Edge Cases
// ============================================================
describe('AttentionViz -- edge cases', () => {
  it('handles single-session data without crashing', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession({ id: 'sess-001', date: '2026-03-01' })] },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles all 13 categories -- at least 13 rects', () => {
    const sessions = [
      makeSession({
        id: 'sess-001',
        date: '2026-02-01',
        attention_profile: ALL_13_CATEGORIES,
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(13);
  });

  it('handles mix of observed and void sessions without crash', () => {
    const sessions = [
      makeSession({ id: 'sess-001', date: '2026-01-15', time_of_day: 'AM' }),
      makeVoidSession({ id: 'sess-002', date: '2026-01-15', time_of_day: 'PM' }),
      makeSession({ id: 'sess-003', date: '2026-01-16', time_of_day: 'AM' }),
      makeVoidSession({ id: 'sess-004', date: '2026-01-16', time_of_day: 'PM' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('version transition on consecutive sessions produces boundary marker', () => {
    const sessions = [
      makeSession({ id: 'sess-001', date: '2026-02-10', time_of_day: 'AM', version: '4.5' }),
      makeSession({ id: 'sess-002', date: '2026-02-10', time_of_day: 'PM', version: '4.6' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBeGreaterThan(0);
  });

  it('cleans up on unmount -- chart-container gone from DOM', () => {
    const { getByTestId, unmount } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    expect(getByTestId('chart-container')).toBeTruthy();

    unmount();

    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});

// ============================================================
// Interaction / Tooltip targeting + Legend
// ============================================================
describe('AttentionViz -- interaction and legend', () => {
  it('data cells have data-date and data-category attributes for tooltip targeting', () => {
    const sessions = [
      makeSession({
        id: 'sess-001',
        date: '2026-01-15',
        time_of_day: 'AM',
        attention_profile: {
          daily_notes: { reads: 2, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const dataCell = containerEl.querySelector('.data-cell');
    expect(dataCell).not.toBeNull();
    expect(dataCell!.getAttribute('data-date')).toBe('2026-01-15');
    expect(dataCell!.getAttribute('data-category')).toBeTruthy();
  });

  it('renders a legend element with data-testid="legend"', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    const legend = getByTestId('legend');
    expect(legend).toBeTruthy();
  });

  it('legend contains void and data swatches explaining both cell states', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { sessions: [makeSession()] },
    });
    const legend = getByTestId('legend');
    const legendContent = legend.textContent || '';
    // Legend must mention both void and data/observed states
    const mentionsVoid =
      legendContent.toLowerCase().includes('void') ||
      legendContent.toLowerCase().includes('unrecorded') ||
      legendContent.includes('∅');
    const mentionsData =
      legendContent.toLowerCase().includes('data') ||
      legendContent.toLowerCase().includes('observed') ||
      legendContent.toLowerCase().includes('recorded') ||
      legendContent.toLowerCase().includes('categor');
    expect(mentionsVoid).toBe(true);
    expect(mentionsData).toBe(true);
  });
});
