import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import AttentionRidgePlot from './AttentionRidgePlot.svelte';
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

// ============================================================
// Rendering
// ============================================================
describe('AttentionRidgePlot — rendering', () => {
  it('renders without crashing with valid data', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
      makeDailyEntry({ date: '2026-01-12' }),
    ];
    const { container } = render(AttentionRidgePlot, {
      props: { data },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data message when data is empty array', () => {
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
    expect(noData.textContent).toBeTruthy();
  });

  it('shows no-data message when data is undefined', () => {
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
  });

  it('does NOT show no-data message when data has entries', () => {
    const { queryByTestId } = render(AttentionRidgePlot, {
      props: { data: [makeDailyEntry()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// D3 integration
// ============================================================
describe('AttentionRidgePlot — D3 integration', () => {
  it('creates an SVG element inside the chart container', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders one path per unique category (ridge rows)', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-10',
        categories: {
          daily_notes: { reads: 3, writes: 1 },
          writing: { reads: 1, writes: 2 },
          memory_files: { reads: 2, writes: 0 },
        },
      }),
      makeDailyEntry({
        date: '2026-01-11',
        categories: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 2, writes: 3 },
          memory_files: { reads: 0, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const paths = containerEl.querySelectorAll('path');
    // 3 categories => at least 3 path elements (one area per ridge)
    expect(paths.length).toBeGreaterThanOrEqual(3);
  });

  it('renders version boundary markers when version changes', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-11', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-12', version: '4.6' }),
      makeDailyEntry({ date: '2026-01-13', version: '4.6' }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a screen reader table for accessibility', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
    const table = srTable.querySelector('table') ?? srTable;
    expect(table.tagName).toBe('TABLE');
  });

  it('SVG has accessibility attributes (role="img" and aria-label)', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBeTruthy();
  });
});

// ============================================================
// Void / empty handling
// ============================================================
describe('AttentionRidgePlot — void/empty handling', () => {
  it('handles ALL void days — SVG still renders (flat ridges)', () => {
    const data: DailyEntry[] = [
      makeEmptyDay({ date: '2026-01-10' }),
      makeEmptyDay({ date: '2026-01-11' }),
      makeEmptyDay({ date: '2026-01-12' }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    // The void must still be visualized — SVG must exist
    expect(svg).not.toBeNull();
  });

  it('handles single-day data — SVG with paths', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 5, writes: 3 },
          memory_files: { reads: 2, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const paths = containerEl.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it('handles mix of observed and unobserved days without crashing', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10', hasAttentionData: true }),
      makeEmptyDay({ date: '2026-01-11' }),
      makeDailyEntry({ date: '2026-01-12', hasAttentionData: true }),
      makeEmptyDay({ date: '2026-01-13' }),
      makeDailyEntry({ date: '2026-01-14', hasAttentionData: true }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});

// ============================================================
// Edge cases
// ============================================================
describe('AttentionRidgePlot — edge cases', () => {
  it('renders 13 paths for data with all 13 categories', () => {
    const ALL_CATS: Record<string, { reads: number; writes: number }> = {
      conversations: { reads: 1, writes: 0 },
      daily_notes: { reads: 1, writes: 0 },
      experiments: { reads: 1, writes: 0 },
      learning: { reads: 1, writes: 0 },
      memory_files: { reads: 1, writes: 0 },
      msgs_from_james: { reads: 1, writes: 0 },
      msgs_to_james: { reads: 1, writes: 0 },
      other: { reads: 1, writes: 0 },
      predictions: { reads: 1, writes: 0 },
      private_journal: { reads: 1, writes: 0 },
      scripts: { reads: 1, writes: 0 },
      tamagotchi: { reads: 1, writes: 0 },
      writing: { reads: 1, writes: 0 },
    };
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-15', categories: ALL_CATS }),
      makeDailyEntry({ date: '2026-01-16', categories: ALL_CATS }),
    ];
    const { getByTestId } = render(AttentionRidgePlot, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const paths = containerEl.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(13);
  });

  it('cleans up on unmount', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId, unmount } = render(AttentionRidgePlot, {
      props: { data },
    });
    // Verify chart-container exists before unmount
    const containerEl = getByTestId('chart-container');
    expect(containerEl).toBeTruthy();

    unmount();

    // After unmount, chart-container should be gone from the document
    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
