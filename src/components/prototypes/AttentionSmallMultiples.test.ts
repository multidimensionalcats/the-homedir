import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import AttentionSmallMultiples from './AttentionSmallMultiples.svelte';
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

// All 13 categories from the project specification
const ALL_13_CATEGORIES = [
  'conversations', 'daily_notes', 'experiments', 'learning',
  'memory_files', 'msgs_from_james', 'msgs_to_james', 'other',
  'predictions', 'private_journal', 'scripts', 'tamagotchi', 'writing',
] as const;

function makeFullEntry(date: string, version = '4.5'): DailyEntry {
  const categories: Record<string, { reads: number; writes: number }> = {};
  for (const cat of ALL_13_CATEGORIES) {
    categories[cat] = {
      reads: Math.floor(Math.random() * 10) + 1,
      writes: Math.floor(Math.random() * 5),
    };
  }
  return makeDailyEntry({ date, version, categories });
}

// ============================================================
// Rendering
// ============================================================
describe('AttentionSmallMultiples — rendering', () => {
  it('renders without crashing with valid data', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
      makeDailyEntry({ date: '2026-01-12' }),
    ];
    const { container } = render(AttentionSmallMultiples, {
      props: { data },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data message when data is empty array', () => {
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
    expect(noData.textContent).toBeTruthy();
  });

  it('shows no-data message when data is undefined', () => {
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
  });

  it('does NOT show no-data message when data has entries', () => {
    const { queryByTestId } = render(AttentionSmallMultiples, {
      props: { data: [makeDailyEntry()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// D3 integration — small multiples specifics
// ============================================================
describe('AttentionSmallMultiples — D3 integration', () => {
  it('creates SVG elements inside chart container', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svgs = containerEl.querySelectorAll('svg');
    // Small multiples must produce at least 1 SVG (one per category found)
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it('creates exactly one SVG per unique category in the data', () => {
    // Data has exactly 2 categories: daily_notes and writing
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
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svgs = containerEl.querySelectorAll('svg');
    // Key difference from stacked area: one SVG per category, not one big SVG
    expect(svgs.length).toBe(2);
  });

  it('each mini-chart SVG contains at least one path element', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-10',
        categories: {
          daily_notes: { reads: 3, writes: 1 },
          writing: { reads: 1, writes: 2 },
          memory_files: { reads: 5, writes: 0 },
        },
      }),
      makeDailyEntry({
        date: '2026-01-11',
        categories: {
          daily_notes: { reads: 1, writes: 0 },
          writing: { reads: 2, writes: 3 },
          memory_files: { reads: 2, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svgs = containerEl.querySelectorAll('svg');
    expect(svgs.length).toBe(3);
    // Every SVG in the grid must contain at least one <path> (the area)
    svgs.forEach((svg) => {
      const paths = svg.querySelectorAll('path');
      expect(paths.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders a screen reader table for accessibility', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
    // Must contain an actual <table> element
    const table = srTable.querySelector('table') ?? srTable;
    expect(table.tagName).toBe('TABLE');
  });

  it('renders category name labels as text elements in each mini-chart', () => {
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
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const textElements = containerEl.querySelectorAll('text');
    expect(textElements.length).toBeGreaterThanOrEqual(1);
    // At least one text element should contain a recognized category name
    const allText = Array.from(textElements).map((t) => t.textContent ?? '');
    const hasCategoryLabel = allText.some(
      (txt) => txt.includes('daily_notes') || txt.includes('Daily Notes') ||
               txt.includes('writing') || txt.includes('Writing'),
    );
    expect(hasCategoryLabel).toBe(true);
  });
});

// ============================================================
// Void / empty handling
// ============================================================
describe('AttentionSmallMultiples — void/empty handling', () => {
  it('handles data with ALL unobserved/void days — SVGs still render', () => {
    // Even when every day is empty, the component should still render SVG
    // elements (flat areas at zero) rather than crashing or hiding
    const data: DailyEntry[] = [
      makeEmptyDay({ date: '2026-01-10' }),
      makeEmptyDay({ date: '2026-01-11' }),
      makeEmptyDay({ date: '2026-01-12' }),
    ];
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svgs = containerEl.querySelectorAll('svg');
    // Must produce SVGs even for void data — the void is the visualization
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it('handles single-day data — SVGs with paths', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({
        date: '2026-01-15',
        categories: {
          daily_notes: { reads: 5, writes: 3 },
          memory_files: { reads: 2, writes: 1 },
        },
      }),
    ];
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svgs = containerEl.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    // Each SVG should still contain path(s) even with just one data point
    svgs.forEach((svg) => {
      const paths = svg.querySelectorAll('path');
      expect(paths.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles mix of observed and unobserved days without crashing', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10', hasAttentionData: true }),
      makeEmptyDay({ date: '2026-01-11' }),
      makeDailyEntry({ date: '2026-01-12', hasAttentionData: true }),
      makeEmptyDay({ date: '2026-01-13' }),
      makeEmptyDay({ date: '2026-01-14' }),
      makeDailyEntry({ date: '2026-01-15', hasAttentionData: true }),
    ];
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    // Should not crash — container must exist with content
    expect(containerEl).toBeTruthy();
    const svgs = containerEl.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Edge cases
// ============================================================
describe('AttentionSmallMultiples — edge cases', () => {
  it('creates exactly 13 SVGs when data contains all 13 categories', () => {
    const data: DailyEntry[] = [
      makeFullEntry('2026-01-10'),
      makeFullEntry('2026-01-11'),
      makeFullEntry('2026-01-12'),
    ];
    const { getByTestId } = render(AttentionSmallMultiples, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const svgs = containerEl.querySelectorAll('svg');
    // Exactly 13 mini-charts — one per category, no more, no less
    expect(svgs.length).toBe(13);
  });

  it('cleans up all SVGs on unmount', () => {
    const data: DailyEntry[] = [
      makeDailyEntry({ date: '2026-01-10' }),
      makeDailyEntry({ date: '2026-01-11' }),
    ];
    const { getByTestId, unmount } = render(AttentionSmallMultiples, {
      props: { data },
    });
    // Verify SVGs exist before unmount
    const containerEl = getByTestId('chart-container');
    const svgsBefore = containerEl.querySelectorAll('svg');
    expect(svgsBefore.length).toBeGreaterThanOrEqual(1);

    unmount();

    // After unmount, chart-container should be gone from the document
    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
