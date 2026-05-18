import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import Placeholder from './Placeholder.svelte';

afterEach(cleanup);

// ============================================================
// Rendering
// ============================================================
describe('Placeholder — rendering', () => {
  it('renders without crashing when given valid data', () => {
    const { container } = render(Placeholder, {
      props: {
        data: [
          { label: 'Alpha', value: 10 },
          { label: 'Beta', value: 20 },
        ],
      },
    });
    expect(container).toBeTruthy();
  });

  it('renders without crashing when given no props (default empty)', () => {
    const { container } = render(Placeholder);
    expect(container).toBeTruthy();
  });

  it('has a chart container div with data-testid="chart-container"', () => {
    const { getByTestId } = render(Placeholder, {
      props: {
        data: [{ label: 'A', value: 5 }],
      },
    });
    const containerEl = getByTestId('chart-container');
    expect(containerEl).toBeTruthy();
    expect(containerEl.tagName).toBe('DIV');
  });

  it('shows "no data" message when data is an empty array', () => {
    const { getByTestId } = render(Placeholder, {
      props: { data: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.tagName).toBe('P');
    expect(noData.textContent).toBeTruthy();
  });

  it('shows "no data" message when data prop is undefined', () => {
    const { getByTestId } = render(Placeholder, {
      props: { data: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show "no data" message when data has entries', () => {
    const { queryByTestId } = render(Placeholder, {
      props: {
        data: [{ label: 'X', value: 42 }],
      },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// D3 integration
// ============================================================
describe('Placeholder — D3 integration', () => {
  it('creates an SVG element inside the container when data is provided', () => {
    const { getByTestId } = render(Placeholder, {
      props: {
        data: [{ label: 'One', value: 100 }],
      },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders the correct number of rect elements (one per data item)', () => {
    const data = [
      { label: 'A', value: 10 },
      { label: 'B', value: 20 },
      { label: 'C', value: 30 },
    ];
    const { getByTestId } = render(Placeholder, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBe(3);
  });

  it('renders exactly one rect for a single data point', () => {
    const { getByTestId } = render(Placeholder, {
      props: {
        data: [{ label: 'Solo', value: 77 }],
      },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBe(1);
  });

  it('handles a large dataset (25 items) without error', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({
      label: `item-${i}`,
      value: (i + 1) * 10,
    }));
    const { getByTestId } = render(Placeholder, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBe(25);
  });

  it('does NOT create an SVG when data is empty', () => {
    const { queryByTestId } = render(Placeholder, {
      props: { data: [] },
    });
    const containerEl = queryByTestId('chart-container');
    expect(containerEl).toBeNull();
  });
});

// ============================================================
// Edge cases
// ============================================================
describe('Placeholder — edge cases', () => {
  it('handles a data point with value: 0', () => {
    const { getByTestId } = render(Placeholder, {
      props: {
        data: [{ label: 'empty', value: 0 }],
      },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBe(1);
    // A zero-value bar should still exist as a rect element
  });

  it('handles a data point with negative value', () => {
    const { getByTestId } = render(Placeholder, {
      props: {
        data: [{ label: 'neg', value: -5 }],
      },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // The bar element should still be created even for negative values
    expect(rects.length).toBe(1);
  });

  it('handles a data point with a very large value', () => {
    const { getByTestId } = render(Placeholder, {
      props: {
        data: [{ label: 'big', value: 999999 }],
      },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBe(1);
  });

  it('handles data with an empty string label', () => {
    const { getByTestId } = render(Placeholder, {
      props: {
        data: [{ label: '', value: 15 }],
      },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBe(1);
  });

  it('handles mixed edge-case values in a single dataset', () => {
    const data = [
      { label: 'zero', value: 0 },
      { label: 'neg', value: -10 },
      { label: 'big', value: 999999 },
      { label: '', value: 42 },
      { label: 'normal', value: 50 },
    ];
    const { getByTestId } = render(Placeholder, {
      props: { data },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBe(5);
  });
});

// ============================================================
// Cleanup
// ============================================================
describe('Placeholder — cleanup', () => {
  it('removes the component from the DOM after unmount', () => {
    const { getByTestId, unmount } = render(Placeholder, {
      props: {
        data: [{ label: 'A', value: 10 }],
      },
    });
    // Verify it exists first
    expect(getByTestId('chart-container')).toBeTruthy();

    unmount();

    // After unmount, querying the document body should find no chart-container
    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
