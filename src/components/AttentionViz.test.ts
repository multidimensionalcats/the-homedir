import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import AttentionViz from './AttentionViz.svelte';
import type { DailyEntry, WeeklyEntry } from '../lib/transforms';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

function makeDailyEntry(overrides: Partial<DailyEntry> = {}): DailyEntry {
  return {
    date: '2026-01-15',
    hasAttentionData: true,
    categories: {
      daily_notes: { reads: 2, writes: 1 },
      writing: { reads: 0, writes: 1 },
    },
    sessionCount: 1,
    version: '4.5',
    ...overrides,
  };
}

function makeEmptyDay(overrides: Partial<DailyEntry> = {}): DailyEntry {
  return makeDailyEntry({
    hasAttentionData: false,
    categories: {},
    ...overrides,
  });
}

function makeWeeklyEntry(overrides: Partial<WeeklyEntry> = {}): WeeklyEntry {
  return {
    weekStart: '2026-01-12',
    hasAttentionData: true,
    categories: { daily_notes: { reads: 5, writes: 2 } },
    sessionCount: 3,
    ...overrides,
  };
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
  it('renders without crashing with daily data', () => {
    const { container } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data when both data and weeklyData are empty arrays', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: [], weeklyData: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
  });

  it('shows no-data when both data and weeklyData are undefined', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: undefined, weeklyData: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when data has entries', () => {
    const { queryByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
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
      props: { data: [makeDailyEntry()] },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('SVG has role="img" and aria-label', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders rect elements for heatmap cells -- 2 dates x 2 categories = at least 4 rects', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 0, writes: 1 },
        },
      }),
      makeDailyEntry({
        date: '2026-01-16',
        categories: {
          daily_notes: { reads: 2, writes: 0 },
          writing: { reads: 1, writes: 0 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(4);
  });

  it('renders category labels as text elements on Y axis', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        categories: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 0, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
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

  it('renders correct cell count for 3 dates x 3 categories = at least 9 rects', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 0, writes: 1 },
          scripts: { reads: 1, writes: 1 },
        },
      }),
      makeDailyEntry({
        date: '2026-01-16',
        categories: {
          daily_notes: { reads: 2, writes: 0 },
          writing: { reads: 1, writes: 0 },
          scripts: { reads: 0, writes: 1 },
        },
      }),
      makeDailyEntry({
        date: '2026-01-17',
        categories: {
          daily_notes: { reads: 0, writes: 1 },
          writing: { reads: 0, writes: 0 },
          scripts: { reads: 1, writes: 0 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(9);
  });
});

// ============================================================
// Void Treatment (CRITICAL -- council design)
// ============================================================
describe('AttentionViz -- void treatment', () => {
  const mixedData: DailyEntry[] = [
    makeDailyEntry({
      date: '2026-01-15',
      categories: {
        daily_notes: { reads: 2, writes: 1 },
        writing: { reads: 0, writes: 1 },
      },
    }),
    makeEmptyDay({
      date: '2026-01-16',
    }),
  ];

  it('void cells have class "void-cell"', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: mixedData },
    });
    const containerEl = getByTestId('chart-container');
    const voidCells = containerEl.querySelectorAll('.void-cell');
    expect(voidCells.length).toBeGreaterThan(0);
  });

  it('data cells have class "data-cell"', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: mixedData },
    });
    const containerEl = getByTestId('chart-container');
    const dataCells = containerEl.querySelectorAll('.data-cell');
    expect(dataCells.length).toBeGreaterThan(0);
  });

  it('void cells do NOT have data-cell class and vice versa', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: mixedData },
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

  it('ALL void days render SVG with void cells (not empty)', () => {
    const allVoidData: DailyEntry[] = [
      makeEmptyDay({ date: '2026-01-15' }),
      makeEmptyDay({ date: '2026-01-16' }),
      makeEmptyDay({ date: '2026-01-17' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data: allVoidData },
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
      props: { data: mixedData },
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

  it('zero-activity category on observed day gets data-cell class NOT void-cell', () => {
    // Key distinction: observed-but-zero != void
    // A day with hasAttentionData=true but a category with 0 reads + 0 writes
    // is still a DATA cell (observed zero), not a void cell (unrecorded session)
    const dataWithZero: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 0, writes: 0 },
          writing: { reads: 3, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data: dataWithZero },
    });
    const containerEl = getByTestId('chart-container');
    // All cells on an observed day should be data-cell, even zero-activity ones
    const dataCells = containerEl.querySelectorAll('.data-cell');
    const voidCells = containerEl.querySelectorAll('.void-cell');
    expect(dataCells.length).toBeGreaterThan(0);
    expect(voidCells.length).toBe(0);
  });
});

// ============================================================
// Version Boundaries
// ============================================================
describe('AttentionViz -- version boundaries', () => {
  it('renders version boundary markers when version changes between consecutive days', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-16', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-17', version: '4.6' }),
      makeDailyEntry({ date: '2026-01-18', version: '4.6' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBeGreaterThan(0);
  });

  it('no version boundaries when all entries have same version', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-16', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-17', version: '4.5' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBe(0);
  });

  it('renders version labels as text containing version numbers', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-16', version: '4.6' }),
      makeDailyEntry({ date: '2026-01-17', version: '4.7' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
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
      props: { data: [makeDailyEntry()] },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('screen reader table contains a "Date" header', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
    });
    const srTable = getByTestId('sr-table');
    const thElements = srTable.querySelectorAll('th');
    const headerTexts = Array.from(thElements).map((th) => th.textContent || '');
    expect(headerTexts.some((h) => h.toLowerCase().includes('date'))).toBe(true);
  });

  it('screen reader table shows void indicator for unrecorded sessions', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15' }),
      makeEmptyDay({ date: '2026-01-16' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const srTable = getByTestId('sr-table');
    const tableContent = srTable.textContent || '';
    // Void rows must show a void indicator character
    const hasVoidIndicator = tableContent.includes('∅') || tableContent.includes('-');
    expect(hasVoidIndicator).toBe(true);
  });

  it('component has ARIA description on container or SVG', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
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
// Responsive / Dual data props
// ============================================================
describe('AttentionViz -- responsive data handling', () => {
  it('renders with daily data when provided', () => {
    const { getByTestId, queryByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders with weekly data when only weeklyData provided and data is empty', () => {
    const { getByTestId, queryByTestId } = render(AttentionViz, {
      props: { data: [], weeklyData: [makeWeeklyEntry()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('accepts both data and weeklyData props without crashing', () => {
    const { container } = render(AttentionViz, {
      props: {
        data: [makeDailyEntry()],
        weeklyData: [makeWeeklyEntry()],
      },
    });
    expect(container).toBeTruthy();
  });
});

// ============================================================
// Edge Cases
// ============================================================
describe('AttentionViz -- edge cases', () => {
  it('handles single-day data without crashing', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry({ date: '2026-03-01' })] },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles all 13 categories -- at least 13 rects', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-02-01',
        categories: ALL_13_CATEGORIES,
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(13);
  });

  it('handles mix of observed and void days without crash', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15' }),
      makeEmptyDay({ date: '2026-01-16' }),
      makeDailyEntry({ date: '2026-01-17' }),
      makeEmptyDay({ date: '2026-01-18' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('version transition on consecutive days produces boundary marker', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-02-10', version: '4.5' }),
      makeDailyEntry({ date: '2026-02-11', version: '4.6' }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBeGreaterThan(0);
  });

  it('cleans up on unmount -- chart-container gone from DOM', () => {
    const { getByTestId, unmount } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
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
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 2, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionViz, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const dataCell = containerEl.querySelector('.data-cell');
    expect(dataCell).not.toBeNull();
    expect(dataCell!.getAttribute('data-date')).toBe('2026-01-15');
    expect(dataCell!.getAttribute('data-category')).toBeTruthy();
  });

  it('renders a legend element with data-testid="legend"', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
    });
    const legend = getByTestId('legend');
    expect(legend).toBeTruthy();
  });

  it('legend contains void and data swatches explaining both cell states', () => {
    const { getByTestId } = render(AttentionViz, {
      props: { data: [makeDailyEntry()] },
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
      legendContent.toLowerCase().includes('recorded');
    expect(mentionsVoid).toBe(true);
    expect(mentionsData).toBe(true);
  });
});
