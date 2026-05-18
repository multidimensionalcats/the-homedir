import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import AttentionHeatmap from './AttentionHeatmap.svelte';
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
describe('AttentionHeatmap -- rendering', () => {
  it('renders without crashing with valid data', () => {
    const { container } = render(AttentionHeatmap, {
      props: {
        data: [makeDailyEntry()],
      },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data message when data is empty', () => {
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
  });

  it('shows no-data message when data is undefined', () => {
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when data has entries', () => {
    const { queryByTestId } = render(AttentionHeatmap, {
      props: {
        data: [makeDailyEntry()],
      },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// D3 Integration
// ============================================================
describe('AttentionHeatmap -- D3 integration', () => {
  it('creates an SVG element inside chart container', () => {
    const { getByTestId } = render(AttentionHeatmap, {
      props: {
        data: [makeDailyEntry()],
      },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders rect elements for heatmap cells (2 dates x 2 categories = at least 4)', () => {
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
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(4);
  });

  it('renders correct number of cells for 3 dates x 3 categories (at least 9)', () => {
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
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(9);
  });

  it('renders a screen reader table', () => {
    const { getByTestId } = render(AttentionHeatmap, {
      props: {
        data: [makeDailyEntry()],
      },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('SVG has accessibility attributes (role="img" and aria-label)', () => {
    const { getByTestId } = render(AttentionHeatmap, {
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

  it('renders category labels on Y axis as text elements', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        categories: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 0, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const textElements = svg!.querySelectorAll('text');
    expect(textElements.length).toBeGreaterThan(0);
    // At least one text element should contain a category name or display name
    const textContents = Array.from(textElements).map((t) => t.textContent || '');
    const hasCategoryLabel = textContents.some(
      (t) =>
        t.toLowerCase().includes('daily') ||
        t.toLowerCase().includes('writing') ||
        t.toLowerCase().includes('notes'),
    );
    expect(hasCategoryLabel).toBe(true);
  });
});

// ============================================================
// Void / Empty Handling
// ============================================================
describe('AttentionHeatmap -- void/empty handling', () => {
  it('handles mix of observed and void days without crashing', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15' }),
      makeEmptyDay({ date: '2026-01-16' }),
      makeDailyEntry({ date: '2026-01-17' }),
      makeEmptyDay({ date: '2026-01-18' }),
    ];
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles ALL void days (the void IS the visualization)', () => {
    const data: DailyEntry[] = [
      makeEmptyDay({ date: '2026-01-15' }),
      makeEmptyDay({ date: '2026-01-16' }),
      makeEmptyDay({ date: '2026-01-17' }),
    ];
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    // Even with all void days, the SVG must still render --
    // the empty grid IS the visualization of absence
    expect(svg).not.toBeNull();
  });

  it('handles single-day data', () => {
    const data: DailyEntry[] = [makeDailyEntry({ date: '2026-03-01' })];
    const { getByTestId } = render(AttentionHeatmap, {
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
describe('AttentionHeatmap -- edge cases', () => {
  it('handles data with all 13 categories (at least 13 rect elements)', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-02-01',
        categories: ALL_13_CATEGORIES,
      }),
    ];
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(13);
  });

  it('handles entry with single category (at least 1 rect)', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-02-01',
        categories: {
          memory_files: { reads: 10, writes: 5 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionHeatmap, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up on unmount (chart-container gone from DOM)', () => {
    const { getByTestId, unmount } = render(AttentionHeatmap, {
      props: {
        data: [makeDailyEntry()],
      },
    });
    // Verify the chart container exists before unmount
    expect(getByTestId('chart-container')).toBeTruthy();
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();

    unmount();

    // After unmount, chart-container should be gone from the document
    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
