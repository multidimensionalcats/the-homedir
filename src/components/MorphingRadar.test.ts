import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import MorphingRadar from './MorphingRadar.svelte';

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
    attention_profile: {},
    web_searches: [],
    ...overrides,
  };
}

/**
 * Create a session with activity on a specific radar axis.
 * Amount controls the magnitude of reads/writes/searches.
 */
function makeSessionWithActivity(
  version: string,
  axis: string,
  amount: number,
  overrides: Record<string, any> = {},
) {
  const profile: Record<string, { reads: number; writes: number }> = {};

  // axis is a direct attention_profile key (e.g., 'private_journal', 'writing', 'experiments')
  profile[axis] = { reads: amount, writes: 0 };

  return makeSession({
    version,
    attention_profile: profile,
    ...overrides,
  });
}

/**
 * Build a full three-version dataset with distinct behavioral fingerprints.
 * 4.5: heavy journal + writing
 * 4.6: heavy experiments + predictions
 * 4.7: heavy memory_files + msgs_to_james
 */
function makeThreeVersionDataset(): ReturnType<typeof makeSession>[] {
  return [
    makeSessionWithActivity('4.5', 'private_journal', 10, { id: 's45-a', date: '2026-01-10' }),
    makeSessionWithActivity('4.5', 'writing', 8, { id: 's45-b', date: '2026-01-11' }),
    makeSessionWithActivity('4.5', 'daily_notes', 3, { id: 's45-c', date: '2026-01-12' }),
    makeSessionWithActivity('4.5', 'memory_files', 2, { id: 's45-d', date: '2026-01-13' }),
    makeSessionWithActivity('4.6', 'experiments', 12, { id: 's46-a', date: '2026-02-10' }),
    makeSessionWithActivity('4.6', 'predictions', 9, { id: 's46-b', date: '2026-02-11' }),
    makeSessionWithActivity('4.6', 'learning', 5, { id: 's46-c', date: '2026-02-12' }),
    makeSessionWithActivity('4.6', 'scripts', 4, { id: 's46-d', date: '2026-02-13' }),
    makeSessionWithActivity('4.7', 'memory_files', 11, { id: 's47-a', date: '2026-03-10' }),
    makeSessionWithActivity('4.7', 'msgs_to_james', 10, { id: 's47-b', date: '2026-03-11' }),
    makeSessionWithActivity('4.7', 'conversations', 6, { id: 's47-c', date: '2026-03-12' }),
    makeSessionWithActivity('4.7', 'writing', 5, { id: 's47-d', date: '2026-03-13' }),
  ];
}

// ============================================================
// Helper: extract polygon path coordinates as numbers
// ============================================================

function extractPathNumbers(d: string): number[] {
  const matches = d.match(/-?\d+\.?\d*/g);
  return matches ? matches.map(Number) : [];
}

// ============================================================
// 1. Rendering Basics
// ============================================================
describe('MorphingRadar -- rendering basics', () => {
  it('renders without crashing with session data', () => {
    const { container } = render(MorphingRadar, {
      props: { sessions: [makeSession()] },
    });
    expect(container).toBeTruthy();
    // Must actually produce content, not just an empty wrapper
    expect(container.innerHTML.length).toBeGreaterThan(10);
  });

  it('shows no-data when sessions is empty array', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
    expect(noData.textContent!.length).toBeGreaterThan(0);
  });

  it('shows no-data when sessions is undefined', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when sessions has entries', () => {
    const { queryByTestId } = render(MorphingRadar, {
      props: { sessions: [makeSession()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// 2. Morph Chart Structure
// ============================================================
describe('MorphingRadar -- morph chart structure', () => {
  it('morph-section container exists when sessions provided', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    expect(getByTestId('morph-section')).toBeTruthy();
  });

  it('morph-chart contains an SVG with role="img" and non-empty aria-label', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const svg = morphChart.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    const ariaLabel = svg!.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel!.length).toBeGreaterThan(5);
  });

  it('morph chart SVG has exactly 6 .axis-line elements', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const axisLines = morphChart.querySelectorAll('.axis-line');
    expect(axisLines.length).toBe(13);
  });

  it('morph chart SVG has exactly 6 .axis-label elements', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const axisLabels = morphChart.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(13);
  });

  it('morph chart SVG has at least 2 .grid-ring circles', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const gridRings = morphChart.querySelectorAll('.grid-ring');
    expect(gridRings.length).toBeGreaterThanOrEqual(2);
  });

  it('morph chart has exactly 1 .version-polygon (the morphing one)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const polygons = morphChart.querySelectorAll('.version-polygon');
    expect(polygons.length).toBe(1);
  });

  it('morph-label element exists and has text content', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphLabel = getByTestId('morph-label');
    expect(morphLabel).toBeTruthy();
    expect(morphLabel.textContent!.trim().length).toBeGreaterThan(0);
  });
});

// ============================================================
// 3. Small Multiples Structure
// ============================================================
describe('MorphingRadar -- small multiples structure', () => {
  it('multiples-section container exists', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    expect(getByTestId('multiples-section')).toBeTruthy();
  });

  it('three version charts exist: version-chart-4.5, version-chart-4.6, version-chart-4.7', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    expect(getByTestId('version-chart-4.5')).toBeTruthy();
    expect(getByTestId('version-chart-4.6')).toBeTruthy();
    expect(getByTestId('version-chart-4.7')).toBeTruthy();
  });

  it('each version chart contains an SVG with role="img"', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const svg = chart.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('role')).toBe('img');
    }
  });

  it('each version chart SVG has 6 .axis-line elements', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const axisLines = chart.querySelectorAll('.axis-line');
      expect(axisLines.length).toBe(13);
    }
  });

  it('each version chart SVG has 6 .axis-label elements', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const axisLabels = chart.querySelectorAll('.axis-label');
      expect(axisLabels.length).toBe(13);
    }
  });

  it('each version chart SVG has at least 2 .grid-ring circles', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const gridRings = chart.querySelectorAll('.grid-ring');
      expect(gridRings.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('each version chart has exactly 1 .version-polygon', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const polygons = chart.querySelectorAll('.version-polygon');
      expect(polygons.length).toBe(1);
    }
  });

  it('each version chart polygon has data-version matching the version string', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const polygon = chart.querySelector('.version-polygon');
      expect(polygon).not.toBeNull();
      expect(polygon!.getAttribute('data-version')).toBe(v);
    }
  });
});

// ============================================================
// 4. Session Scrubbing
// ============================================================
describe('MorphingRadar -- session scrubbing', () => {
  it('each version chart has a session-scrubber-{v} input[type="range"]', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const scrubber = getByTestId(`session-scrubber-${v}`);
      expect(scrubber).toBeTruthy();
      expect(scrubber.tagName.toLowerCase()).toBe('input');
      expect(scrubber.getAttribute('type')).toBe('range');
    }
  });

  it('each version chart has a session-label-{v} with text content', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const label = getByTestId(`session-label-${v}`);
      expect(label).toBeTruthy();
      expect(label.textContent!.trim().length).toBeGreaterThan(0);
    }
  });

  it('scrubber min is "0" and max equals version session count minus 1', () => {
    const dataset = makeThreeVersionDataset();
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: dataset },
    });
    // Count sessions per version from the dataset
    const versionCounts: Record<string, number> = {};
    for (const s of dataset) {
      versionCounts[s.version] = (versionCounts[s.version] || 0) + 1;
    }
    for (const v of ['4.5', '4.6', '4.7']) {
      const scrubber = getByTestId(`session-scrubber-${v}`) as HTMLInputElement;
      expect(scrubber.min).toBe('0');
      // max should be count - 1 (zero-indexed)
      const expectedMax = String(versionCounts[v] - 1);
      expect(scrubber.max).toBe(expectedMax);
    }
  });

  it('scrubber for version with single session has min=0 and max=0', () => {
    const sessions = [
      makeSessionWithActivity('4.5', 'private_journal', 5, { id: 's1', date: '2026-01-10' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const scrubber = getByTestId('session-scrubber-4.5') as HTMLInputElement;
    expect(scrubber.min).toBe('0');
    expect(scrubber.max).toBe('0');
  });
});

// ============================================================
// 5. Data-Driven Shape
// ============================================================
describe('MorphingRadar -- data-driven shape', () => {
  it('version with heavy introspection produces different polygon path than version with heavy web research', () => {
    // Each version has exclusive activity on different axes so per-version
    // normalization produces genuinely different shapes (spike on different axis)
    const sessions = [
      makeSessionWithActivity('4.5', 'private_journal', 20, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'private_journal', 18, { id: 's2', date: '2026-01-11' }),
      makeSessionWithActivity('4.5', 'private_journal', 15, { id: 's3', date: '2026-01-12' }),
      makeSessionWithActivity('4.5', 'private_journal', 12, { id: 's4', date: '2026-01-13' }),
      makeSessionWithActivity('4.5', 'private_journal', 10, { id: 's5', date: '2026-01-14' }),
      makeSessionWithActivity('4.5', 'private_journal', 8, { id: 's6', date: '2026-01-15' }),
      makeSessionWithActivity('4.6', 'experiments', 20, { id: 's7', date: '2026-02-10' }),
      makeSessionWithActivity('4.6', 'experiments', 18, { id: 's8', date: '2026-02-11' }),
      makeSessionWithActivity('4.6', 'experiments', 15, { id: 's9', date: '2026-02-12' }),
      makeSessionWithActivity('4.6', 'experiments', 12, { id: 's10', date: '2026-02-13' }),
      makeSessionWithActivity('4.6', 'experiments', 10, { id: 's11', date: '2026-02-14' }),
      makeSessionWithActivity('4.6', 'experiments', 8, { id: 's12', date: '2026-02-15' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const chart45 = getByTestId('version-chart-4.5');
    const chart46 = getByTestId('version-chart-4.6');
    const poly45 = chart45.querySelector('.version-polygon');
    const poly46 = chart46.querySelector('.version-polygon');
    expect(poly45).not.toBeNull();
    expect(poly46).not.toBeNull();

    const d45 = poly45!.getAttribute('d') || '';
    const d46 = poly46!.getAttribute('d') || '';
    expect(d45.length).toBeGreaterThan(0);
    expect(d46.length).toBeGreaterThan(0);
    // Different behavioral profiles must produce different shapes
    expect(d45).not.toBe(d46);
  });

  it('all-void sessions (empty profiles) produce polygon at center with all finite coordinates, no NaN', () => {
    const sessions = [
      makeSession({ id: 's1', version: '4.5', date: '2026-01-10', attention_profile: {}, web_searches: [] }),
      makeSession({ id: 's2', version: '4.5', date: '2026-01-11', attention_profile: {}, web_searches: [] }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const chart = getByTestId('version-chart-4.5');
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    const d = polygon!.getAttribute('d') || '';
    const numbers = extractPathNumbers(d);
    expect(numbers.length).toBeGreaterThan(0);
    numbers.forEach((n) => {
      expect(Number.isFinite(n)).toBe(true);
      expect(Number.isNaN(n)).toBe(false);
    });
  });

  it('polygon points are within SVG viewBox bounds (no NaN or Infinity)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const svg = chart.querySelector('svg');
      expect(svg).not.toBeNull();

      // Parse viewBox to get bounds
      const viewBox = svg!.getAttribute('viewBox') || '';
      const vbParts = viewBox.split(/\s+/).map(Number);
      const vbWidth = vbParts[2] || 1000;
      const vbHeight = vbParts[3] || 1000;

      const polygon = chart.querySelector('.version-polygon');
      expect(polygon).not.toBeNull();
      const d = polygon!.getAttribute('d') || '';
      const numbers = extractPathNumbers(d);
      expect(numbers.length).toBeGreaterThan(0);
      numbers.forEach((n) => {
        expect(Number.isFinite(n)).toBe(true);
        expect(Number.isNaN(n)).toBe(false);
        // Points should be within reasonable bounds
        expect(Math.abs(n)).toBeLessThan(vbWidth * 2 + vbHeight * 2);
      });
    }
  });

  it('two versions with identical data produce identical polygon path d attributes in their respective version charts', () => {
    // Give both versions identical activity on every axis
    const sessions = [
      makeSessionWithActivity('4.5', 'private_journal', 5, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'writing', 3, { id: 's2', date: '2026-01-11' }),
      makeSessionWithActivity('4.5', 'experiments', 4, { id: 's3', date: '2026-01-12' }),
      makeSessionWithActivity('4.5', 'predictions', 2, { id: 's4', date: '2026-01-13' }),
      makeSessionWithActivity('4.5', 'msgs_to_james', 6, { id: 's5', date: '2026-01-14' }),
      makeSessionWithActivity('4.5', 'memory_files', 3, { id: 's6', date: '2026-01-15' }),
      // Exact same activity pattern for 4.6
      makeSessionWithActivity('4.6', 'private_journal', 5, { id: 's7', date: '2026-02-10' }),
      makeSessionWithActivity('4.6', 'writing', 3, { id: 's8', date: '2026-02-11' }),
      makeSessionWithActivity('4.6', 'experiments', 4, { id: 's9', date: '2026-02-12' }),
      makeSessionWithActivity('4.6', 'predictions', 2, { id: 's10', date: '2026-02-13' }),
      makeSessionWithActivity('4.6', 'msgs_to_james', 6, { id: 's11', date: '2026-02-14' }),
      makeSessionWithActivity('4.6', 'memory_files', 3, { id: 's12', date: '2026-02-15' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    // When scrubbed to the same session index, the per-session polygons for matching
    // activity sessions should produce the same shape. But since this is per-session
    // scrubbing, we test the initial polygon (session index 0) for both — both start
    // at their first session which has introspection=5 and the same structure.
    const chart45 = getByTestId('version-chart-4.5');
    const chart46 = getByTestId('version-chart-4.6');
    const poly45 = chart45.querySelector('.version-polygon');
    const poly46 = chart46.querySelector('.version-polygon');
    expect(poly45).not.toBeNull();
    expect(poly46).not.toBeNull();
    // The initial session (index 0) for both is introspection=5, so shapes should match
    expect(poly45!.getAttribute('d')).toBe(poly46!.getAttribute('d'));
  });

  it('single version in data renders only 1 version chart (not 3)', () => {
    const sessions = [
      makeSessionWithActivity('4.6', 'experiments', 5, { id: 's1', date: '2026-02-01' }),
      makeSessionWithActivity('4.6', 'writing', 3, { id: 's2', date: '2026-02-02' }),
    ];
    const { getByTestId, queryByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    // Should have the 4.6 chart
    expect(getByTestId('version-chart-4.6')).toBeTruthy();
    // Should NOT have 4.5 or 4.7 charts
    expect(queryByTestId('version-chart-4.5')).toBeNull();
    expect(queryByTestId('version-chart-4.7')).toBeNull();
  });
});

// ============================================================
// 6. Axis Labels
// ============================================================
describe('MorphingRadar -- axis labels', () => {
  it('all 6 axis dimension names present in morph chart labels (case-insensitive)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const axisLabels = morphChart.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(13);
    const allLabelText = Array.from(axisLabels)
      .map((l) => (l.textContent || '').toLowerCase())
      .join(' ');

    expect(allLabelText).toMatch(/conversation/);
    expect(allLabelText).toMatch(/daily notes/);
    expect(allLabelText).toMatch(/experiment/);
    expect(allLabelText).toMatch(/learning/);
    expect(allLabelText).toMatch(/memory/);
    expect(allLabelText).toMatch(/predict/);
    expect(allLabelText).toMatch(/journal/);
    expect(allLabelText).toMatch(/script/);
    expect(allLabelText).toMatch(/writing/);
  });

  it('labels positioned around perimeter (y coordinates vary, not all same)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const axisLabels = morphChart.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(13);

    const yCoords = new Set<number>();
    axisLabels.forEach((label) => {
      const y = parseFloat(label.getAttribute('y') || '0');
      const transform = label.getAttribute('transform') || '';
      const translateMatch = transform.match(/translate\([^,]+,\s*([^)]+)\)/);
      const effectiveY = translateMatch ? parseFloat(translateMatch[1]) : y;
      yCoords.add(Math.round(effectiveY));
    });

    // Labels around a hexagonal perimeter must NOT all share the same y
    expect(yCoords.size).toBeGreaterThan(1);
  });

  it('labels have distinct positions (no overlaps)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const morphChart = getByTestId('morph-chart');
    const axisLabels = morphChart.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(13);

    const positions: string[] = [];
    axisLabels.forEach((label) => {
      const x = label.getAttribute('x') || '0';
      const y = label.getAttribute('y') || '0';
      const transform = label.getAttribute('transform') || '';
      const posKey = transform || `${x},${y}`;
      positions.push(posKey);
    });

    const uniquePositions = new Set(positions);
    expect(uniquePositions.size).toBe(13);
  });
});

// ============================================================
// 7. Accessibility
// ============================================================
describe('MorphingRadar -- accessibility', () => {
  it('sr-table exists with a <table> inside', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
    const table = srTable.querySelector('table');
    expect(table).not.toBeNull();
  });

  it('SR table has headers including "Version" and axis names', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const srTable = getByTestId('sr-table');
    const headers = srTable.querySelectorAll('th');
    expect(headers.length).toBeGreaterThan(0);
    const headerTexts = Array.from(headers)
      .map((th) => (th.textContent || '').toLowerCase())
      .join(' ');

    expect(headerTexts).toMatch(/version/);
    expect(headerTexts).toMatch(/conversation/);
    expect(headerTexts).toMatch(/experiment/);
    expect(headerTexts).toMatch(/predict/);
    expect(headerTexts).toMatch(/journal/);
    expect(headerTexts).toMatch(/writing/);
    expect(headerTexts).toMatch(/memory/);
  });

  it('legend exists and mentions version numbers present in data (4.5, 4.6, 4.7)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const legend = getByTestId('legend');
    expect(legend).toBeTruthy();
    const legendText = legend.textContent || '';
    expect(legendText).toContain('4.5');
    expect(legendText).toContain('4.6');
    expect(legendText).toContain('4.7');
  });

  it('SVG elements have role="img" in both morph and version charts', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    // Morph chart SVG
    const morphChart = getByTestId('morph-chart');
    const morphSvg = morphChart.querySelector('svg');
    expect(morphSvg).not.toBeNull();
    expect(morphSvg!.getAttribute('role')).toBe('img');

    // Version chart SVGs
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const svg = chart.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('role')).toBe('img');
    }
  });
});

// ============================================================
// 8. Edge Cases
// ============================================================
describe('MorphingRadar -- edge cases', () => {
  it('single session produces valid polygon (no crash)', () => {
    const sessions = [
      makeSessionWithActivity('4.5', 'private_journal', 5, { id: 's1', date: '2026-01-10' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const chart = getByTestId('version-chart-4.5');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    const d = polygon!.getAttribute('d') || '';
    expect(d.length).toBeGreaterThan(0);
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
  });

  it('missing attention_profile on sessions does not crash', () => {
    const sessions = [
      {
        id: 'sess-bad-1',
        date: '2026-01-10',
        time_of_day: 'AM',
        version: '4.5',
        web_searches: [],
        // attention_profile deliberately omitted
      } as any,
      {
        id: 'sess-bad-2',
        date: '2026-01-11',
        time_of_day: 'PM',
        version: '4.5',
        attention_profile: undefined,
        web_searches: ['search-1'],
      } as any,
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const chart = getByTestId('version-chart-4.5');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
  });

  it('sessions with only one axis of activity still renders 6-axis polygon with 6 axis lines and labels', () => {
    // All activity on introspection only, nothing else
    const sessions = [
      makeSessionWithActivity('4.5', 'private_journal', 10, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'private_journal', 8, { id: 's2', date: '2026-01-11' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const chart = getByTestId('version-chart-4.5');
    // Still must have 6 axis lines and 6 axis labels
    expect(chart.querySelectorAll('.axis-line').length).toBe(13);
    expect(chart.querySelectorAll('.axis-label').length).toBe(13);
    // Polygon must exist
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    // The polygon d should contain at least 6 coordinate pairs (12 numbers) for 6 vertices
    const d = polygon!.getAttribute('d') || '';
    const numbers = extractPathNumbers(d);
    expect(numbers.length).toBeGreaterThanOrEqual(26);
  });

  it('very large values (reads: 999) render without NaN/Infinity/overflow', () => {
    const sessions = [
      makeSessionWithActivity('4.5', 'private_journal', 999, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'experiments', 999, { id: 's2', date: '2026-01-11' }),
      makeSessionWithActivity('4.5', 'memory_files', 999, { id: 's3', date: '2026-01-12' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const chart = getByTestId('version-chart-4.5');
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    const d = polygon!.getAttribute('d') || '';
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
    expect(d).not.toContain('undefined');
    const numbers = extractPathNumbers(d);
    numbers.forEach((n) => {
      expect(Number.isFinite(n)).toBe(true);
    });
  });

  it('unknown version string ("5.0") still renders a version chart for it', () => {
    const sessions = [
      makeSessionWithActivity('5.0', 'writing', 5, { id: 's1', date: '2026-04-10' }),
      makeSessionWithActivity('5.0', 'experiments', 3, { id: 's2', date: '2026-04-11' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const chart = getByTestId('version-chart-5.0');
    expect(chart).toBeTruthy();
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    expect(polygon!.getAttribute('data-version')).toBe('5.0');
  });
});

// ============================================================
// 9. Adversarial / Structural
// ============================================================
describe('MorphingRadar -- adversarial / structural', () => {
  it('web_searches: undefined handled without crash', () => {
    const sessions = [
      makeSession({
        id: 's1',
        version: '4.5',
        date: '2026-01-10',
        attention_profile: { writing: { reads: 3, writes: 1 } },
        web_searches: undefined,
      }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: sessions as any },
    });
    const chart = getByTestId('version-chart-4.5');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
  });

  it('web_searches: null handled without crash', () => {
    const sessions = [
      makeSession({
        id: 's1',
        version: '4.5',
        date: '2026-01-10',
        attention_profile: { writing: { reads: 3, writes: 1 } },
        web_searches: null,
      }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: sessions as any },
    });
    const chart = getByTestId('version-chart-4.5');
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    const polygon = chart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
  });

  it('mixed versions with very unequal session counts (10 vs 1) still render all version charts', () => {
    const sessions = [
      // 10 sessions for 4.5
      ...Array.from({ length: 10 }, (_, i) =>
        makeSessionWithActivity('4.5', 'private_journal', i + 1, {
          id: `s45-${i}`,
          date: `2026-01-${(10 + i).toString().padStart(2, '0')}`,
        }),
      ),
      // Just 1 session for 4.7
      makeSessionWithActivity('4.7', 'experiments', 3, { id: 's47-0', date: '2026-03-10' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    // Both version charts must exist
    expect(getByTestId('version-chart-4.5')).toBeTruthy();
    expect(getByTestId('version-chart-4.7')).toBeTruthy();
    // Each must have a polygon
    const chart45 = getByTestId('version-chart-4.5');
    const chart47 = getByTestId('version-chart-4.7');
    expect(chart45.querySelector('.version-polygon')).not.toBeNull();
    expect(chart47.querySelector('.version-polygon')).not.toBeNull();
  });

  it('all polygon paths are closed (end with Z)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    // Check morph chart polygon
    const morphChart = getByTestId('morph-chart');
    const morphPolygon = morphChart.querySelector('.version-polygon');
    expect(morphPolygon).not.toBeNull();
    const morphD = morphPolygon!.getAttribute('d') || '';
    expect(morphD.trim().toUpperCase().endsWith('Z')).toBe(true);

    // Check version chart polygons
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const polygon = chart.querySelector('.version-polygon');
      expect(polygon).not.toBeNull();
      const d = polygon!.getAttribute('d') || '';
      expect(d.trim().toUpperCase().endsWith('Z')).toBe(true);
    }
  });

  it('grid rings are circles/ellipses (not rects)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    // Check morph chart grid rings
    const morphChart = getByTestId('morph-chart');
    const morphRings = morphChart.querySelectorAll('.grid-ring');
    expect(morphRings.length).toBeGreaterThanOrEqual(2);
    morphRings.forEach((ring) => {
      const tag = ring.tagName.toLowerCase();
      expect(['circle', 'ellipse', 'path', 'polygon']).toContain(tag);
      expect(tag).not.toBe('rect');
    });

    // Check version chart grid rings
    for (const v of ['4.5', '4.6', '4.7']) {
      const chart = getByTestId(`version-chart-${v}`);
      const rings = chart.querySelectorAll('.grid-ring');
      expect(rings.length).toBeGreaterThanOrEqual(2);
      rings.forEach((ring) => {
        const tag = ring.tagName.toLowerCase();
        expect(['circle', 'ellipse', 'path', 'polygon']).toContain(tag);
        expect(tag).not.toBe('rect');
      });
    }
  });

  it('component cleans up on unmount (radar-container gone from DOM)', () => {
    const { getByTestId, unmount } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    expect(getByTestId('radar-container')).toBeTruthy();

    unmount();

    const orphan = document.querySelector('[data-testid="radar-container"]');
    expect(orphan).toBeNull();
  });
});

// ============================================================
// 10. Single-version edge case
// ============================================================
describe('MorphingRadar -- single-version edge case', () => {
  it('when data has only one version: morph chart shows that version shape statically', () => {
    const sessions = [
      makeSessionWithActivity('4.6', 'experiments', 8, { id: 's1', date: '2026-02-01' }),
      makeSessionWithActivity('4.6', 'writing', 4, { id: 's2', date: '2026-02-02' }),
      makeSessionWithActivity('4.6', 'memory_files', 6, { id: 's3', date: '2026-02-03' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    // Morph chart should still render with its single-polygon morph
    const morphChart = getByTestId('morph-chart');
    const svg = morphChart.querySelector('svg');
    expect(svg).not.toBeNull();
    const polygon = morphChart.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    // Polygon path should be valid
    const d = polygon!.getAttribute('d') || '';
    expect(d.length).toBeGreaterThan(0);
    expect(d).not.toContain('NaN');
  });

  it('when data has only one version: only 1 version chart in multiples section', () => {
    const sessions = [
      makeSessionWithActivity('4.6', 'experiments', 8, { id: 's1', date: '2026-02-01' }),
      makeSessionWithActivity('4.6', 'writing', 4, { id: 's2', date: '2026-02-02' }),
    ];
    const { getByTestId, queryByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const multiples = getByTestId('multiples-section');
    expect(multiples).toBeTruthy();
    // Only version-chart-4.6 should exist
    expect(getByTestId('version-chart-4.6')).toBeTruthy();
    expect(queryByTestId('version-chart-4.5')).toBeNull();
    expect(queryByTestId('version-chart-4.7')).toBeNull();
  });

  it('morph-label shows the single version name when only one version present', () => {
    const sessions = [
      makeSessionWithActivity('4.7', 'memory_files', 5, { id: 's1', date: '2026-03-01' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const morphLabel = getByTestId('morph-label');
    expect(morphLabel.textContent).toContain('4.7');
  });

  it('scrubber and session-label exist even for single-version data', () => {
    const sessions = [
      makeSessionWithActivity('4.7', 'memory_files', 5, { id: 's1', date: '2026-03-01' }),
      makeSessionWithActivity('4.7', 'experiments', 3, { id: 's2', date: '2026-03-02' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const scrubber = getByTestId('session-scrubber-4.7') as HTMLInputElement;
    expect(scrubber).toBeTruthy();
    expect(scrubber.getAttribute('type')).toBe('range');
    expect(scrubber.min).toBe('0');
    expect(scrubber.max).toBe('1');

    const label = getByTestId('session-label-4.7');
    expect(label).toBeTruthy();
    expect(label.textContent!.trim().length).toBeGreaterThan(0);
  });
});
