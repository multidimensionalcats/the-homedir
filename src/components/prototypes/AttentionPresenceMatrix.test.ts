import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import AttentionPresenceMatrix from './AttentionPresenceMatrix.svelte';
import type { DailyEntry } from '../../lib/transforms';

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
describe('AttentionPresenceMatrix -- rendering', () => {
  it('renders without crashing with valid data', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
      makeDailyEntry({ date: '2026-01-12' }),
    ];
    const { container } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data message when data is empty array', () => {
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
    expect(noData.textContent).toBeTruthy();
  });

  it('shows no-data message when data is undefined', () => {
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
  });

  it('does NOT show no-data message when data has entries', () => {
    const { queryByTestId } = render(AttentionPresenceMatrix, {
      props: { data: [makeDailyEntry()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// D3 Integration
// ============================================================
describe('AttentionPresenceMatrix -- D3 integration', () => {
  it('creates an SVG element inside chart container', () => {
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: {
        data: [makeDailyEntry()],
      },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders rect elements for the matrix cells (2 dates x 2 categories = at least 4)', () => {
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
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // 2 dates x 2 categories = 4 cells minimum in a full matrix
    expect(rects.length).toBeGreaterThanOrEqual(4);
  });

  it('renders a screen reader table', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
    // Must contain an actual <table> element
    const table = srTable.querySelector('table') ?? srTable;
    expect(table.tagName).toBe('TABLE');
  });

  it('SVG has accessibility attributes (role="img" and aria-label)', () => {
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: {
        data: [makeDailyEntry()],
      },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBeTruthy();
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
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const textElements = svg!.querySelectorAll('text');
    expect(textElements.length).toBeGreaterThan(0);
    // At least one text element should reference a category name
    const textContents = Array.from(textElements).map((t) => t.textContent || '');
    const hasCategoryLabel = textContents.some(
      (t) =>
        t.toLowerCase().includes('daily') ||
        t.toLowerCase().includes('writing') ||
        t.toLowerCase().includes('notes'),
    );
    expect(hasCategoryLabel).toBe(true);
  });

  it('marks void day cells with a distinct class', () => {
    // 1 observed day + 1 unobserved day -- unobserved should get void-cell class
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15' }),
      makeEmptyDay({ date: '2026-01-16' }),
    ];
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const voidCells = containerEl.querySelectorAll('.void-cell');
    // The unobserved day should have its entire column marked as void
    expect(voidCells.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Void / Empty Handling
// ============================================================
describe('AttentionPresenceMatrix -- void/empty handling', () => {
  it('handles ALL void days -- renders SVG with void cells', () => {
    // Every single day is unobserved -- the void IS the dominant visual
    const data: DailyEntry[] = [
      makeEmptyDay({ date: '2026-01-10' }),
      makeEmptyDay({ date: '2026-01-11' }),
      makeEmptyDay({ date: '2026-01-12' }),
    ];
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    // Even with all void days the SVG must still render --
    // absence is the visualization
    expect(svg).not.toBeNull();
    // All cells should be void cells when every day is unobserved
    const voidCells = containerEl.querySelectorAll('.void-cell');
    expect(voidCells.length).toBeGreaterThan(0);
  });

  it('handles single-day data', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 5, writes: 3 },
          memory_files: { reads: 2, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(1);
  });

  it('handles mix of observed and unobserved days without crashing', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15' }),
      makeEmptyDay({ date: '2026-01-16' }),
      makeDailyEntry({ date: '2026-01-17' }),
      makeEmptyDay({ date: '2026-01-18' }),
    ];
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});

// ============================================================
// Edge Cases
// ============================================================
describe('AttentionPresenceMatrix -- edge cases', () => {
  it('renders correct cell count for entry with 13 categories', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-02-01',
        categories: ALL_13_CATEGORIES,
      }),
    ];
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // 1 day x 13 categories = at least 13 cells
    expect(rects.length).toBeGreaterThanOrEqual(13);
  });

  it('handles entry where category has reads:0 writes:0 -- zero activity is absence, not presence', () => {
    // daily_notes has activity (present), writing has zero activity (absent)
    // The component must distinguish between "category key exists with zero reads+writes"
    // and "category has actual reads or writes". Zero-activity should NOT be "present".
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 1, writes: 0 }, // present -- has reads
          writing: { reads: 0, writes: 0 },      // absent -- zero activity despite key existing
        },
      }),
    ];
    const { getByTestId } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // Should have rects for the matrix
    expect(rects.length).toBeGreaterThanOrEqual(1);

    // The "present" cells (those with a category fill color / present-cell class)
    // should only account for categories with actual activity.
    // daily_notes is present (reads:1), writing is absent (reads:0, writes:0)
    const presentCells = containerEl.querySelectorAll('.present-cell');
    const absentCells = containerEl.querySelectorAll('.absent-cell');

    // Exactly 1 category has activity, so exactly 1 present-cell
    expect(presentCells.length).toBe(1);
    // The zero-activity category should be absent, not present
    expect(absentCells.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up on unmount (chart-container gone from DOM)', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId, unmount } = render(AttentionPresenceMatrix, {
      props: { data },
    });
    // Verify the chart container and SVG exist before unmount
    const containerEl = getByTestId('chart-container');
    expect(containerEl.querySelector('svg')).not.toBeNull();

    unmount();

    // After unmount, chart-container should be gone from the document
    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
