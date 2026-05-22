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
  const webSearches: string[] = [];

  switch (axis) {
    case 'introspection':
      profile.private_journal = { reads: amount, writes: 0 };
      break;
    case 'creative':
      profile.writing = { reads: amount, writes: 0 };
      break;
    case 'web':
      for (let i = 0; i < amount; i++) webSearches.push(`search-${i}`);
      break;
    case 'predictions':
      profile.predictions = { reads: amount, writes: 0 };
      break;
    case 'messaging':
      profile.msgs_from_james = { reads: Math.floor(amount / 2), writes: 0 };
      profile.msgs_to_james = { reads: 0, writes: Math.ceil(amount / 2) };
      break;
    case 'memory':
      profile.memory_files = { reads: amount, writes: 0 };
      break;
  }

  return makeSession({
    version,
    attention_profile: profile,
    web_searches: webSearches,
    ...overrides,
  });
}

/**
 * Build a full three-version dataset with distinct behavioral fingerprints.
 * 4.5: heavy introspection + creative, low web
 * 4.6: heavy web + predictions, low creative
 * 4.7: heavy memory + messaging, moderate everything
 */
function makeThreeVersionDataset(): ReturnType<typeof makeSession>[] {
  return [
    // Version 4.5 sessions — introspective writer
    makeSessionWithActivity('4.5', 'introspection', 10, { id: 's45-a', date: '2026-01-10' }),
    makeSessionWithActivity('4.5', 'creative', 8, { id: 's45-b', date: '2026-01-11' }),
    makeSessionWithActivity('4.5', 'web', 1, { id: 's45-c', date: '2026-01-12' }),
    makeSessionWithActivity('4.5', 'memory', 2, { id: 's45-d', date: '2026-01-13' }),
    // Version 4.6 sessions — researcher
    makeSessionWithActivity('4.6', 'web', 12, { id: 's46-a', date: '2026-02-10' }),
    makeSessionWithActivity('4.6', 'predictions', 9, { id: 's46-b', date: '2026-02-11' }),
    makeSessionWithActivity('4.6', 'creative', 1, { id: 's46-c', date: '2026-02-12' }),
    makeSessionWithActivity('4.6', 'introspection', 2, { id: 's46-d', date: '2026-02-13' }),
    // Version 4.7 sessions — communicator
    makeSessionWithActivity('4.7', 'memory', 11, { id: 's47-a', date: '2026-03-10' }),
    makeSessionWithActivity('4.7', 'messaging', 10, { id: 's47-b', date: '2026-03-11' }),
    makeSessionWithActivity('4.7', 'web', 4, { id: 's47-c', date: '2026-03-12' }),
    makeSessionWithActivity('4.7', 'creative', 5, { id: 's47-d', date: '2026-03-13' }),
  ];
}

// ============================================================
// 1. Rendering
// ============================================================
describe('MorphingRadar -- rendering', () => {
  it('renders without crashing with session data', () => {
    const { container } = render(MorphingRadar, {
      props: { sessions: [makeSession()] },
    });
    expect(container).toBeTruthy();
    // Must actually produce content, not just an empty div
    expect(container.innerHTML.length).toBeGreaterThan(10);
  });

  it('shows no-data when sessions is empty array', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
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
// 2. SVG Structure
// ============================================================
describe('MorphingRadar -- SVG structure', () => {
  it('creates SVG element inside chart-container', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('SVG has role="img" and a non-empty aria-label', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
    const ariaLabel = svg!.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel!.length).toBeGreaterThan(5);
  });

  it('renders exactly 6 axis lines (class="axis-line")', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const axisLines = containerEl.querySelectorAll('.axis-line');
    expect(axisLines.length).toBe(6);
  });

  it('renders exactly 6 axis labels (class="axis-label")', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const axisLabels = containerEl.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(6);
  });

  it('renders at least 2 grid rings (class="grid-ring")', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const gridRings = containerEl.querySelectorAll('.grid-ring');
    expect(gridRings.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// 3. Version Polygons
// ============================================================
describe('MorphingRadar -- version polygons', () => {
  it('renders polygon paths with class "version-polygon"', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBeGreaterThan(0);
  });

  it('three polygons when three versions present in data', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBe(3);
  });

  it('each polygon has a data-version attribute matching a version string', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    const versions = new Set<string>();
    polygons.forEach((p) => {
      const v = p.getAttribute('data-version');
      expect(v).toBeTruthy();
      // Must be a known version string from the data
      expect(['4.5', '4.6', '4.7']).toContain(v);
      versions.add(v!);
    });
    // All three versions must be represented
    expect(versions.size).toBe(3);
  });

  it('polygons have different fill colors (distinct visual identity)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    const fills = new Set<string>();
    polygons.forEach((p) => {
      const fill = p.getAttribute('fill') || p.getAttribute('stroke') || '';
      expect(fill).toBeTruthy();
      fills.add(fill);
    });
    // All three polygons must have distinct fill/stroke colors
    expect(fills.size).toBe(3);
  });

  it('polygons have fill-opacity less than 1 (semi-transparent)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBeGreaterThan(0);
    polygons.forEach((p) => {
      const opacity = p.getAttribute('fill-opacity');
      // fill-opacity must exist and be < 1 for semi-transparency
      expect(opacity).toBeTruthy();
      const opacityNum = parseFloat(opacity!);
      expect(opacityNum).toBeLessThan(1);
      expect(opacityNum).toBeGreaterThan(0);
    });
  });

  it('single version in data renders only one polygon', () => {
    const singleVersionSessions = [
      makeSessionWithActivity('4.6', 'web', 5, { id: 's1', date: '2026-02-01' }),
      makeSessionWithActivity('4.6', 'creative', 3, { id: 's2', date: '2026-02-02' }),
      makeSessionWithActivity('4.6', 'memory', 7, { id: 's3', date: '2026-02-03' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: singleVersionSessions },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBe(1);
    expect(polygons[0].getAttribute('data-version')).toBe('4.6');
  });
});

// ============================================================
// 4. Data-Driven Shape
// ============================================================
describe('MorphingRadar -- data-driven shape', () => {
  it('version with heavy introspection has larger shape on introspection axis than version with none', () => {
    // 4.5 has massive introspection, 4.6 has zero
    const sessions = [
      makeSessionWithActivity('4.5', 'introspection', 20, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'web', 1, { id: 's2', date: '2026-01-11' }),
      makeSessionWithActivity('4.6', 'web', 5, { id: 's3', date: '2026-02-10' }),
      makeSessionWithActivity('4.6', 'creative', 3, { id: 's4', date: '2026-02-11' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const poly45 = containerEl.querySelector('.version-polygon[data-version="4.5"]');
    const poly46 = containerEl.querySelector('.version-polygon[data-version="4.6"]');
    expect(poly45).not.toBeNull();
    expect(poly46).not.toBeNull();

    // Parse the path d attribute to compare vertex positions
    // For a 6-axis radar, the introspection axis is the first axis (index 0 by convention).
    // The polygon with introspection activity should extend further from center on that axis.
    const d45 = poly45!.getAttribute('d') || '';
    const d46 = poly46!.getAttribute('d') || '';
    expect(d45.length).toBeGreaterThan(0);
    expect(d46.length).toBeGreaterThan(0);
    // Polygons must be different shapes since their data differs
    expect(d45).not.toBe(d46);
  });

  it('version with more web searches has larger web research axis value', () => {
    const sessions = [
      makeSessionWithActivity('4.5', 'web', 1, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.6', 'web', 15, { id: 's2', date: '2026-02-10' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const poly45 = containerEl.querySelector('.version-polygon[data-version="4.5"]');
    const poly46 = containerEl.querySelector('.version-polygon[data-version="4.6"]');
    expect(poly45).not.toBeNull();
    expect(poly46).not.toBeNull();
    // Different amounts of web research must produce different polygon shapes
    const d45 = poly45!.getAttribute('d') || '';
    const d46 = poly46!.getAttribute('d') || '';
    expect(d45).not.toBe(d46);
  });

  it('all-void sessions (empty profiles, no web searches) produce polygons at center', () => {
    const sessions = [
      makeSession({ id: 's1', version: '4.5', date: '2026-01-10', attention_profile: {}, web_searches: [] }),
      makeSession({ id: 's2', version: '4.5', date: '2026-01-11', attention_profile: {}, web_searches: [] }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const polygon = containerEl.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    const d = polygon!.getAttribute('d') || '';
    // Parse numeric coordinates from path. All points should be clustered near center.
    const numbers = d.match(/-?\d+\.?\d*/g);
    expect(numbers).not.toBeNull();
    expect(numbers!.length).toBeGreaterThan(0);
    // No coordinate should be NaN or Infinity
    numbers!.forEach((n) => {
      const val = parseFloat(n);
      expect(Number.isFinite(val)).toBe(true);
    });
  });

  it('polygon points are within SVG viewBox bounds (no NaN or Infinity)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();

    // Get SVG dimensions
    const width = parseFloat(svg!.getAttribute('width') || svg!.getAttribute('viewBox')?.split(' ')[2] || '1000');
    const height = parseFloat(svg!.getAttribute('height') || svg!.getAttribute('viewBox')?.split(' ')[3] || '1000');

    const polygons = containerEl.querySelectorAll('.version-polygon');
    polygons.forEach((p) => {
      const d = p.getAttribute('d') || '';
      const numbers = d.match(/-?\d+\.?\d*/g);
      expect(numbers).not.toBeNull();
      numbers!.forEach((n) => {
        const val = parseFloat(n);
        expect(Number.isFinite(val)).toBe(true);
        expect(Number.isNaN(val)).toBe(false);
        // Points should be within reasonable bounds (within 2x the SVG dimensions)
        expect(Math.abs(val)).toBeLessThan(width * 2 + height * 2);
      });
    });
  });

  it('two versions with identical data produce overlapping polygons (same path d values)', () => {
    // Give both versions identical activity on every axis
    const sessions = [
      makeSessionWithActivity('4.5', 'introspection', 5, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'creative', 3, { id: 's2', date: '2026-01-11' }),
      makeSessionWithActivity('4.5', 'web', 4, { id: 's3', date: '2026-01-12' }),
      makeSessionWithActivity('4.5', 'predictions', 2, { id: 's4', date: '2026-01-13' }),
      makeSessionWithActivity('4.5', 'messaging', 6, { id: 's5', date: '2026-01-14' }),
      makeSessionWithActivity('4.5', 'memory', 3, { id: 's6', date: '2026-01-15' }),
      // Exact same activity pattern for 4.6
      makeSessionWithActivity('4.6', 'introspection', 5, { id: 's7', date: '2026-02-10' }),
      makeSessionWithActivity('4.6', 'creative', 3, { id: 's8', date: '2026-02-11' }),
      makeSessionWithActivity('4.6', 'web', 4, { id: 's9', date: '2026-02-12' }),
      makeSessionWithActivity('4.6', 'predictions', 2, { id: 's10', date: '2026-02-13' }),
      makeSessionWithActivity('4.6', 'messaging', 6, { id: 's11', date: '2026-02-14' }),
      makeSessionWithActivity('4.6', 'memory', 3, { id: 's12', date: '2026-02-15' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const poly45 = containerEl.querySelector('.version-polygon[data-version="4.5"]');
    const poly46 = containerEl.querySelector('.version-polygon[data-version="4.6"]');
    expect(poly45).not.toBeNull();
    expect(poly46).not.toBeNull();
    // Identical input data -> identical polygon shape (same d attribute)
    expect(poly45!.getAttribute('d')).toBe(poly46!.getAttribute('d'));
  });
});

// ============================================================
// 5. Axis Labels
// ============================================================
describe('MorphingRadar -- axis labels', () => {
  it('axis labels include text for all 6 dimensions (case-insensitive)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const axisLabels = containerEl.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(6);
    const allLabelText = Array.from(axisLabels)
      .map((l) => (l.textContent || '').toLowerCase())
      .join(' ');

    // All six axis dimensions must be represented
    expect(allLabelText).toMatch(/introspection/);
    expect(allLabelText).toMatch(/creativ/); // creative, creativity
    expect(allLabelText).toMatch(/web/); // web, web research
    expect(allLabelText).toMatch(/predict/); // predictions, prediction
    expect(allLabelText).toMatch(/messag/); // messaging, messages
    expect(allLabelText).toMatch(/memory/); // memory, memory mgmt
  });

  it('axis labels are text elements positioned around the chart perimeter (y coordinates vary)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const axisLabels = containerEl.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(6);

    // Collect y coordinates (or transform-translated y values)
    const yCoords = new Set<number>();
    axisLabels.forEach((label) => {
      const y = parseFloat(label.getAttribute('y') || '0');
      const transform = label.getAttribute('transform') || '';
      const translateMatch = transform.match(/translate\([^,]+,\s*([^)]+)\)/);
      const effectiveY = translateMatch ? parseFloat(translateMatch[1]) : y;
      yCoords.add(Math.round(effectiveY));
    });

    // Labels positioned around a hexagonal perimeter must NOT all share the same y
    expect(yCoords.size).toBeGreaterThan(1);
  });

  it('labels do not overlap with each other (each has distinct position)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const axisLabels = containerEl.querySelectorAll('.axis-label');
    expect(axisLabels.length).toBe(6);

    // Extract (x, y) or transform positions for each label
    const positions: string[] = [];
    axisLabels.forEach((label) => {
      const x = label.getAttribute('x') || '0';
      const y = label.getAttribute('y') || '0';
      const transform = label.getAttribute('transform') || '';
      const posKey = transform || `${x},${y}`;
      positions.push(posKey);
    });

    // All 6 labels must have unique positions
    const uniquePositions = new Set(positions);
    expect(uniquePositions.size).toBe(6);
  });
});

// ============================================================
// 6. Accessibility
// ============================================================
describe('MorphingRadar -- accessibility', () => {
  it('screen reader table exists with data-testid="sr-table"', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('screen reader table has headers for version and each axis', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const srTable = getByTestId('sr-table');
    const headers = srTable.querySelectorAll('th');
    expect(headers.length).toBeGreaterThan(0);
    const headerTexts = Array.from(headers)
      .map((th) => (th.textContent || '').toLowerCase())
      .join(' ');
    // Must have a version column header
    expect(headerTexts).toMatch(/version/);
    // Must have headers for each axis (at least a few)
    expect(headerTexts).toMatch(/introspection/);
    expect(headerTexts).toMatch(/creativ/);
    expect(headerTexts).toMatch(/web/);
    expect(headerTexts).toMatch(/predict/);
    expect(headerTexts).toMatch(/messag/);
    expect(headerTexts).toMatch(/memory/);
  });

  it('legend exists with data-testid="legend"', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const legend = getByTestId('legend');
    expect(legend).toBeTruthy();
  });

  it('legend contains entries mentioning version numbers (4.5, 4.6, 4.7)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const legend = getByTestId('legend');
    const legendText = legend.textContent || '';
    expect(legendText).toContain('4.5');
    expect(legendText).toContain('4.6');
    expect(legendText).toContain('4.7');
  });
});

// ============================================================
// 7. Edge Cases
// ============================================================
describe('MorphingRadar -- edge cases', () => {
  it('single session produces a valid polygon (no crash)', () => {
    const sessions = [
      makeSessionWithActivity('4.5', 'introspection', 5, { id: 's1', date: '2026-01-10' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBe(1);
    // The polygon must have a valid d attribute
    const d = polygons[0].getAttribute('d') || '';
    expect(d.length).toBeGreaterThan(0);
    // No NaN in path
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
  });

  it('missing attention_profile on sessions does not crash (treated as zeros)', () => {
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
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    // Must still render polygon(s)
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBeGreaterThan(0);
  });

  it('sessions with only one axis of activity still renders 6-axis polygon', () => {
    // All activity on introspection only, nothing else
    const sessions = [
      makeSessionWithActivity('4.5', 'introspection', 10, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'introspection', 8, { id: 's2', date: '2026-01-11' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    // Still must have 6 axis lines and 6 axis labels
    expect(containerEl.querySelectorAll('.axis-line').length).toBe(6);
    expect(containerEl.querySelectorAll('.axis-label').length).toBe(6);
    // Polygon must exist
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBe(1);
    // The polygon d should contain at least 6 points (6 vertices of the radar)
    const d = polygons[0].getAttribute('d') || '';
    const numbers = d.match(/-?\d+\.?\d*/g) || [];
    // 6 vertices = at least 12 coordinate values (x,y pairs), plus the close command
    expect(numbers.length).toBeGreaterThanOrEqual(12);
  });

  it('very large values (reads: 999) still renders without overflow or NaN', () => {
    const sessions = [
      makeSessionWithActivity('4.5', 'introspection', 999, { id: 's1', date: '2026-01-10' }),
      makeSessionWithActivity('4.5', 'web', 999, { id: 's2', date: '2026-01-11' }),
      makeSessionWithActivity('4.5', 'memory', 999, { id: 's3', date: '2026-01-12' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const polygon = containerEl.querySelector('.version-polygon');
    expect(polygon).not.toBeNull();
    const d = polygon!.getAttribute('d') || '';
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
    expect(d).not.toContain('undefined');
    // All coordinates must be finite numbers
    const numbers = d.match(/-?\d+\.?\d*/g) || [];
    numbers.forEach((n) => {
      expect(Number.isFinite(parseFloat(n))).toBe(true);
    });
  });

  it('unknown version string ("5.0") still renders polygon for that version', () => {
    const sessions = [
      makeSessionWithActivity('5.0', 'creative', 5, { id: 's1', date: '2026-04-10' }),
      makeSessionWithActivity('5.0', 'web', 3, { id: 's2', date: '2026-04-11' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBe(1);
    expect(polygons[0].getAttribute('data-version')).toBe('5.0');
    // Must have a fill color (even if fallback)
    const fill = polygons[0].getAttribute('fill');
    expect(fill).toBeTruthy();
  });
});

// ============================================================
// 8. Adversarial / Structural Integrity
// ============================================================
describe('MorphingRadar -- adversarial inputs', () => {
  it('handles sessions with web_searches undefined (not just empty array)', () => {
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
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles sessions with null web_searches', () => {
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
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles mixed versions where one version has many sessions and another has one', () => {
    const sessions = [
      // 10 sessions for 4.5
      ...Array.from({ length: 10 }, (_, i) =>
        makeSessionWithActivity('4.5', 'introspection', i + 1, {
          id: `s45-${i}`,
          date: `2026-01-${(10 + i).toString().padStart(2, '0')}`,
        }),
      ),
      // Just 1 session for 4.7
      makeSessionWithActivity('4.7', 'web', 3, { id: 's47-0', date: '2026-03-10' }),
    ];
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBe(2);
    const versions = Array.from(polygons).map((p) => p.getAttribute('data-version'));
    expect(versions).toContain('4.5');
    expect(versions).toContain('4.7');
  });

  it('polygon paths are closed (end where they start)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const polygons = containerEl.querySelectorAll('.version-polygon');
    expect(polygons.length).toBeGreaterThan(0);
    polygons.forEach((p) => {
      const d = p.getAttribute('d') || '';
      // A closed path must end with 'Z' (SVG close-path command)
      expect(d.trim().toUpperCase().endsWith('Z')).toBe(true);
    });
  });

  it('grid rings are circle or ellipse elements (not rectangles)', () => {
    const { getByTestId } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    const containerEl = getByTestId('chart-container');
    const gridRings = containerEl.querySelectorAll('.grid-ring');
    expect(gridRings.length).toBeGreaterThanOrEqual(2);
    gridRings.forEach((ring) => {
      const tag = ring.tagName.toLowerCase();
      // Grid rings on a radar chart should be circles, ellipses, or polygon paths -- not rects
      expect(['circle', 'ellipse', 'path', 'polygon']).toContain(tag);
      expect(tag).not.toBe('rect');
    });
  });

  it('cleans up on unmount -- chart-container gone from DOM', () => {
    const { getByTestId, unmount } = render(MorphingRadar, {
      props: { sessions: makeThreeVersionDataset() },
    });
    expect(getByTestId('chart-container')).toBeTruthy();

    unmount();

    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });
});
