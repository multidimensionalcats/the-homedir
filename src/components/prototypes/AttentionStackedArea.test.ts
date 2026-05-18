import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import AttentionStackedArea from './AttentionStackedArea.svelte';
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
describe('AttentionStackedArea — rendering', () => {
  it('renders without crashing with valid data', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
      makeDailyEntry({ date: '2026-01-12' }),
    ];
    const { container } = render(AttentionStackedArea, {
      props: { data },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data message when data is empty array', () => {
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
    expect(noData.textContent).toBeTruthy();
  });

  it('shows no-data message when data is undefined', () => {
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
  });

  it('does NOT show no-data message when data has entries', () => {
    const { queryByTestId } = render(AttentionStackedArea, {
      props: { data: [makeDailyEntry()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// D3 integration
// ============================================================
describe('AttentionStackedArea — D3 integration', () => {
  it('creates an SVG element inside the chart container', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders path elements for stacked area layers (one per unique category)', () => {
    // Two entries each with 2 categories => at least 2 <path> elements
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-10',
        categories: {
          daily_notes: { reads: 3, writes: 1 },
          writing: { reads: 1, writes: 2 },
        },
      }),
      makeDailyEntry({
        date: '2026-01-11',
        categories: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 2, writes: 3 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const paths = containerEl.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders version boundary markers when version changes between consecutive entries', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-11', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-12', version: '4.6' }),
      makeDailyEntry({ date: '2026-01-13', version: '4.6' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT render version boundary when all entries are same version', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-11', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-12', version: '4.5' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    expect(boundaries.length).toBe(0);
  });

  it('renders a screen reader table for accessibility', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
    // Must contain an actual <table> element
    const table = srTable.querySelector('table') ?? srTable;
    expect(table.tagName).toBe('TABLE');
  });

  it('SVG has an accessibility description', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
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
// Empty / void handling
// ============================================================
describe('AttentionStackedArea — empty/void handling', () => {
  it('handles mix of observed and unobserved days', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10', hasAttentionData: true }),
      makeEmptyDay({ date: '2026-01-11' }),
      makeDailyEntry({ date: '2026-01-12', hasAttentionData: true }),
      makeEmptyDay({ date: '2026-01-13' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles data with ALL unobserved days (the void IS the visualization)', () => {
    const data: DailyEntry[] = [
      makeEmptyDay({ date: '2026-01-10' }),
      makeEmptyDay({ date: '2026-01-11' }),
      makeEmptyDay({ date: '2026-01-12' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    // The void must still be visualized — SVG must exist
    expect(svg).not.toBeNull();
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
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const paths = containerEl.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Edge cases
// ============================================================
describe('AttentionStackedArea — edge cases', () => {
  it('handles data spanning all 3 version phases', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-01', version: '4.5' }),
      makeDailyEntry({ date: '2026-01-02', version: '4.5' }),
      makeDailyEntry({ date: '2026-02-01', version: '4.6' }),
      makeDailyEntry({ date: '2026-02-02', version: '4.6' }),
      makeDailyEntry({ date: '2026-03-01', version: '4.7' }),
      makeDailyEntry({ date: '2026-03-02', version: '4.7' }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const boundaries = containerEl.querySelectorAll('.version-boundary');
    // Two transitions: 4.5->4.6 and 4.6->4.7
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
  });

  it('handles entry with many categories (13 paths minimum)', () => {
    const manyCategories: Record<string, { reads: number; writes: number }> = {};
    const categoryNames = [
      'conversations', 'daily_notes', 'experiments', 'learning',
      'memory_files', 'msgs_from_james', 'msgs_to_james', 'other',
      'predictions', 'private_journal', 'scripts', 'tamagotchi', 'writing',
    ];
    for (const name of categoryNames) {
      manyCategories[name] = { reads: Math.floor(Math.random() * 10) + 1, writes: Math.floor(Math.random() * 5) };
    }
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: manyCategories,
      }),
    ];
    const { getByTestId } = render(AttentionStackedArea, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const paths = containerEl.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(13);
  });

  it('cleans up SVG on unmount', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId, unmount } = render(AttentionStackedArea, {
      props: { data },
    });
    // Verify SVG exists before unmount
    const containerEl = getByTestId('chart-container');
    expect(containerEl.querySelector('svg')).not.toBeNull();

    unmount();

    // After unmount, chart-container should be gone from the document
    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
