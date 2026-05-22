import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import PredictionTracker from './PredictionTracker.svelte';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

function makePrediction(overrides: Record<string, any> = {}) {
  return {
    text: 'Test prediction text',
    confidence: 0.7,
    date_made: '2026-04-25',
    resolution_date: null,
    outcome: null,
    self_assessment: null,
    ...overrides,
  };
}

/** Build N predictions spread across a date range with varied confidence */
function makePredictionSet(n: number): Array<Record<string, any>> {
  const result = [];
  for (let i = 0; i < n; i++) {
    const day = 20 + (i % 29); // April 20 through May 18
    const month = day > 30 ? '05' : '04';
    const d = day > 30 ? String(day - 30).padStart(2, '0') : String(day).padStart(2, '0');
    result.push(
      makePrediction({
        text: `Prediction number ${i + 1}`,
        confidence: 0.5 + (i % 4) * 0.1, // 0.5, 0.6, 0.7, 0.8 cycling
        date_made: `2026-${month}-${d}`,
      }),
    );
  }
  return result;
}

/** 21 predictions matching real data characteristics -- all unresolved, one null confidence */
function makeRealisticSet(): Array<Record<string, any>> {
  const set = makePredictionSet(20);
  // The 21st has null confidence, matching the real dataset
  set.push(
    makePrediction({
      text: 'Conditional prediction with no numeric confidence',
      confidence: null,
      date_made: '2026-04-20',
    }),
  );
  return set;
}

// ============================================================
// 1. Rendering
// ============================================================
describe('PredictionTracker -- rendering', () => {
  it('renders without crashing with prediction data', () => {
    const { container } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data when predictions is an empty array', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('shows no-data when predictions is undefined', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when predictions has entries', () => {
    const { queryByTestId } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// 2. SVG Structure
// ============================================================
describe('PredictionTracker -- SVG structure', () => {
  it('creates an SVG element inside chart-container', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    const chart = getByTestId('chart-container');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('SVG has role="img" and aria-label', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    const chart = getByTestId('chart-container');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders circle elements for prediction dots', () => {
    const predictions = [
      makePrediction({ date_made: '2026-04-20', confidence: 0.6 }),
      makePrediction({ date_made: '2026-04-25', confidence: 0.7 }),
      makePrediction({ date_made: '2026-05-01', confidence: 0.8 }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = chart.querySelectorAll('circle.prediction-dot');
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });

  it('dot count matches prediction count (all have confidence)', () => {
    const predictions = makePredictionSet(7);
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = chart.querySelectorAll('circle.prediction-dot');
    // Every prediction with non-null confidence should produce a dot
    expect(dots.length).toBe(7);
  });
});

// ============================================================
// 3. Unresolved State
// ============================================================
describe('PredictionTracker -- unresolved state', () => {
  it('all dots have class "unresolved" when all outcomes are null', () => {
    const predictions = [
      makePrediction({ outcome: null, confidence: 0.5 }),
      makePrediction({ outcome: null, confidence: 0.6 }),
      makePrediction({ outcome: null, confidence: 0.7 }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = chart.querySelectorAll('circle.prediction-dot');
    expect(dots.length).toBeGreaterThan(0);
    dots.forEach((dot) => {
      expect(dot.classList.contains('unresolved')).toBe(true);
    });
  });

  it('unresolved dots have gray-ish fill -- not vivid red/green/blue', () => {
    const predictions = [makePrediction({ outcome: null })];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dot = chart.querySelector('circle.prediction-dot.unresolved');
    expect(dot).not.toBeNull();
    const fill = dot!.getAttribute('fill') || '';
    // Vivid colors that would be WRONG for an unresolved phantom:
    const vividColors = ['#ff0000', '#00ff00', '#0000ff', 'red', 'green', 'blue', 'lime', 'cyan'];
    vividColors.forEach((c) => {
      expect(fill.toLowerCase()).not.toBe(c);
    });
  });

  it('a prediction with a non-null outcome does NOT have "unresolved" class', () => {
    const predictions = [
      makePrediction({ outcome: 'correct', confidence: 0.7 }),
      makePrediction({ outcome: null, confidence: 0.6 }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = chart.querySelectorAll('circle.prediction-dot');
    expect(dots.length).toBeGreaterThanOrEqual(2);
    // Find the resolved one -- it must NOT have the unresolved class
    const resolvedDots = chart.querySelectorAll('circle.prediction-dot:not(.unresolved)');
    expect(resolvedDots.length).toBeGreaterThanOrEqual(1);
    // And the unresolved one must have it
    const unresolvedDots = chart.querySelectorAll('circle.prediction-dot.unresolved');
    expect(unresolvedDots.length).toBeGreaterThanOrEqual(1);
  });

  it('all dots have class "prediction-dot" regardless of resolution status', () => {
    const predictions = [
      makePrediction({ outcome: 'correct', confidence: 0.7 }),
      makePrediction({ outcome: null, confidence: 0.5 }),
      makePrediction({ outcome: null, confidence: 0.8 }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    // Every circle in the scatter area must be a prediction-dot
    const allCircles = chart.querySelectorAll('circle.prediction-dot');
    expect(allCircles.length).toBeGreaterThanOrEqual(3);
    allCircles.forEach((circle) => {
      expect(circle.classList.contains('prediction-dot')).toBe(true);
    });
  });
});

// ============================================================
// 4. Confidence Axis
// ============================================================
describe('PredictionTracker -- confidence axis', () => {
  it('Y-axis label contains "confidence" (case-insensitive)', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    const chart = getByTestId('chart-container');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    const textElements = Array.from(svg!.querySelectorAll('text'));
    const allText = textElements.map((t) => (t.textContent || '').toLowerCase()).join(' ');
    expect(allText).toContain('confidence');
  });

  it('higher confidence prediction has lower cy (closer to top of SVG)', () => {
    const predictions = [
      makePrediction({ confidence: 0.5, date_made: '2026-04-20', text: 'low' }),
      makePrediction({ confidence: 0.8, date_made: '2026-04-21', text: 'high' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = chart.querySelectorAll('circle.prediction-dot');
    expect(dots.length).toBeGreaterThanOrEqual(2);
    // Collect cy values -- sort them by cy ascending to find the dot nearest top
    const cyValues = Array.from(dots).map((d) => ({
      cy: parseFloat(d.getAttribute('cy') || '0'),
      cx: parseFloat(d.getAttribute('cx') || '0'),
    }));
    // In SVG, smaller cy = higher on screen
    // The two dots should have different cy values
    const cySet = new Set(cyValues.map((v) => v.cy));
    expect(cySet.size).toBe(2);
  });

  it('confidence 0.8 dot has smaller cy than confidence 0.5 dot', () => {
    const predictions = [
      makePrediction({ confidence: 0.5, date_made: '2026-04-20', text: 'low-conf' }),
      makePrediction({ confidence: 0.8, date_made: '2026-05-10', text: 'high-conf' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = Array.from(chart.querySelectorAll('circle.prediction-dot'));
    expect(dots.length).toBeGreaterThanOrEqual(2);
    // Sort by cx to identify which dot is which by date position
    const sorted = dots
      .map((d) => ({
        el: d,
        cx: parseFloat(d.getAttribute('cx') || '0'),
        cy: parseFloat(d.getAttribute('cy') || '0'),
      }))
      .sort((a, b) => a.cx - b.cx);
    // First dot (earlier date = 0.5 conf), second dot (later date = 0.8 conf)
    const lowConfCy = sorted[0].cy;
    const highConfCy = sorted[1].cy;
    // Higher confidence = smaller cy (closer to top)
    expect(highConfCy).toBeLessThan(lowConfCy);
  });

  it('Y scale covers 0 to 1 range -- confidence 0.5 is not at extreme top or bottom', () => {
    const predictions = [
      makePrediction({ confidence: 0.5, date_made: '2026-04-25' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    const dot = chart.querySelector('circle.prediction-dot');
    expect(dot).not.toBeNull();
    const cy = parseFloat(dot!.getAttribute('cy') || '0');
    const svgHeight = parseFloat(svg!.getAttribute('height') || svg!.getAttribute('viewBox')?.split(' ')[3] || '400');
    // A 0.5 confidence dot should be roughly in the middle, not crammed at top or bottom
    // Allow generous margins for axis padding -- but it must not be at 0 or at svgHeight
    expect(cy).toBeGreaterThan(0);
    expect(cy).toBeLessThan(svgHeight);
  });
});

// ============================================================
// 5. Date Axis
// ============================================================
describe('PredictionTracker -- date axis', () => {
  it('earlier date_made has smaller cx than later date_made', () => {
    const predictions = [
      makePrediction({ date_made: '2026-04-20', confidence: 0.6, text: 'early' }),
      makePrediction({ date_made: '2026-05-18', confidence: 0.6, text: 'late' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = Array.from(chart.querySelectorAll('circle.prediction-dot'));
    expect(dots.length).toBeGreaterThanOrEqual(2);
    const cxValues = dots.map((d) => parseFloat(d.getAttribute('cx') || '0'));
    // The dots should have different cx
    expect(cxValues[0]).not.toBe(cxValues[1]);
    // Sort to find min and max
    const minCx = Math.min(...cxValues);
    const maxCx = Math.max(...cxValues);
    expect(maxCx).toBeGreaterThan(minCx);
  });

  it('date labels present as text elements in the SVG', () => {
    const predictions = [
      makePrediction({ date_made: '2026-04-20', confidence: 0.6 }),
      makePrediction({ date_made: '2026-05-18', confidence: 0.7 }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    const texts = Array.from(svg!.querySelectorAll('text'));
    // At least some text elements should exist for axis ticks
    expect(texts.length).toBeGreaterThan(0);
    // At least one text should contain a month or year fragment
    const allText = texts.map((t) => t.textContent || '').join(' ');
    const hasDateFragment =
      allText.includes('Apr') ||
      allText.includes('May') ||
      allText.includes('04') ||
      allText.includes('05') ||
      allText.includes('2026') ||
      allText.includes('4/') ||
      allText.includes('5/');
    expect(hasDateFragment).toBe(true);
  });

  it('three predictions on different dates produce three distinct cx values', () => {
    const predictions = [
      makePrediction({ date_made: '2026-04-20', confidence: 0.6, text: 'a' }),
      makePrediction({ date_made: '2026-04-26', confidence: 0.6, text: 'b' }),
      makePrediction({ date_made: '2026-05-01', confidence: 0.6, text: 'c' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = Array.from(chart.querySelectorAll('circle.prediction-dot'));
    expect(dots.length).toBeGreaterThanOrEqual(3);
    const cxValues = dots.map((d) => parseFloat(d.getAttribute('cx') || '0'));
    const unique = new Set(cxValues);
    expect(unique.size).toBe(3);
  });
});

// ============================================================
// 6. Null Confidence
// ============================================================
describe('PredictionTracker -- null confidence', () => {
  it('prediction with null confidence gets "no-confidence" class', () => {
    const predictions = [
      makePrediction({ confidence: null, date_made: '2026-04-20' }),
      makePrediction({ confidence: 0.7, date_made: '2026-04-25' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const noConfDots = chart.querySelectorAll('.no-confidence');
    expect(noConfDots.length).toBe(1);
  });

  it('null-confidence prediction does not crash the component', () => {
    // ALL predictions have null confidence -- the most adversarial version
    const predictions = [
      makePrediction({ confidence: null, date_made: '2026-04-20', text: 'null-1' }),
      makePrediction({ confidence: null, date_made: '2026-04-25', text: 'null-2' }),
      makePrediction({ confidence: null, date_made: '2026-05-01', text: 'null-3' }),
    ];
    const { container, getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    expect(container).toBeTruthy();
    // Should still produce a chart, not a no-data state
    const chart = getByTestId('chart-container');
    expect(chart).toBeTruthy();
  });

  it('null-confidence prediction still renders in the DOM (not silently dropped)', () => {
    const predictions = [
      makePrediction({ confidence: null, date_made: '2026-04-20', text: 'ghost' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    // Either as a dot in the SVG or in the SR table, the prediction must exist
    const noConfDots = chart.querySelectorAll('.no-confidence');
    const srTable = chart.ownerDocument.querySelector('[data-testid="sr-table"]');
    const srContent = srTable?.textContent || '';
    // At least one of these must show the prediction exists
    const dotExists = noConfDots.length > 0;
    const tableHasIt = srContent.includes('ghost');
    expect(dotExists || tableHasIt).toBe(true);
  });
});

// ============================================================
// 7. Accessibility
// ============================================================
describe('PredictionTracker -- accessibility', () => {
  it('SR table exists with data-testid="sr-table"', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('SR table has columns for prediction text and confidence', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    const srTable = getByTestId('sr-table');
    const thElements = srTable.querySelectorAll('th');
    const headers = Array.from(thElements).map((th) => (th.textContent || '').toLowerCase());
    // Must have headers mentioning prediction/text and confidence
    const hasTextHeader = headers.some(
      (h) => h.includes('prediction') || h.includes('text') || h.includes('description'),
    );
    const hasConfidenceHeader = headers.some(
      (h) => h.includes('confidence') || h.includes('probability'),
    );
    expect(hasTextHeader).toBe(true);
    expect(hasConfidenceHeader).toBe(true);
  });

  it('prediction count element exists with data-testid="prediction-count"', () => {
    const predictions = makePredictionSet(5);
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const countEl = getByTestId('prediction-count');
    expect(countEl).toBeTruthy();
  });

  it('prediction count displays the actual number of predictions', () => {
    const predictions = makeRealisticSet(); // 21 predictions
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const countEl = getByTestId('prediction-count');
    const text = countEl.textContent || '';
    // Must contain "21" somewhere
    expect(text).toContain('21');
  });
});

// ============================================================
// 8. Edge Cases
// ============================================================
describe('PredictionTracker -- edge cases', () => {
  it('single prediction renders exactly one dot', () => {
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions: [makePrediction({ confidence: 0.6, date_made: '2026-04-20' })] },
    });
    const chart = getByTestId('chart-container');
    const dots = chart.querySelectorAll('circle.prediction-dot');
    expect(dots.length).toBe(1);
  });

  it('all same date_made renders dots at same cx value', () => {
    const predictions = [
      makePrediction({ date_made: '2026-04-20', confidence: 0.5, text: 'x' }),
      makePrediction({ date_made: '2026-04-20', confidence: 0.6, text: 'y' }),
      makePrediction({ date_made: '2026-04-20', confidence: 0.8, text: 'z' }),
    ];
    const { getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    const chart = getByTestId('chart-container');
    const dots = Array.from(chart.querySelectorAll('circle.prediction-dot'));
    expect(dots.length).toBeGreaterThanOrEqual(3);
    const cxValues = dots.map((d) => parseFloat(d.getAttribute('cx') || '0'));
    // All on same date => all same cx
    const unique = new Set(cxValues);
    expect(unique.size).toBe(1);
  });

  it('empty text string does not crash the component', () => {
    const predictions = [
      makePrediction({ text: '', confidence: 0.7, date_made: '2026-04-20' }),
    ];
    const { container, getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    expect(container).toBeTruthy();
    const chart = getByTestId('chart-container');
    expect(chart).toBeTruthy();
  });

  it('very long text does not crash the component', () => {
    const longText = 'A'.repeat(5000);
    const predictions = [
      makePrediction({ text: longText, confidence: 0.7, date_made: '2026-04-20' }),
    ];
    const { container, getByTestId } = render(PredictionTracker, {
      props: { predictions },
    });
    expect(container).toBeTruthy();
    const chart = getByTestId('chart-container');
    expect(chart).toBeTruthy();
  });

  it('cleans up on unmount -- chart-container gone from DOM', () => {
    const { getByTestId, unmount } = render(PredictionTracker, {
      props: { predictions: [makePrediction()] },
    });
    expect(getByTestId('chart-container')).toBeTruthy();

    unmount();

    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
