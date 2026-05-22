<script lang="ts">
  import * as d3Selection from 'd3-selection';
  import { versionColor, createScreenReaderTable } from '../lib/chart-utils';

  let { sessions = [] }: { sessions?: any[] } = $props();
  let container = $state<HTMLElement | null>(null);
  let srTableHtml = $state('');
  let versionList = $state<string[]>([]);

  // Radar axis definitions — order matters for angle assignment
  const AXES = [
    { key: 'introspection', label: 'Introspection', profileKey: 'private_journal' },
    { key: 'creative', label: 'Creative Output', profileKey: 'writing' },
    { key: 'web', label: 'Web Research', profileKey: null },
    { key: 'predictions', label: 'Predictions', profileKey: 'predictions' },
    { key: 'messaging', label: 'Messaging', profileKey: null },
    { key: 'memory', label: 'Memory Mgmt', profileKey: 'memory_files' },
  ] as const;

  const NUM_AXES = AXES.length;
  const CENTER_X = 300;
  const CENTER_Y = 300;
  const RADIUS = 180;
  const LABEL_OFFSET = 25;
  const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];

  // Determine if we have valid session data
  let hasSessions = $derived(Array.isArray(sessions) && sessions.length > 0);

  /**
   * Extract the raw value for a given axis from a single session.
   */
  function axisValue(session: any, axisKey: string): number {
    const profile = session.attention_profile;
    switch (axisKey) {
      case 'introspection': {
        if (!profile || !profile.private_journal) return 0;
        const pj = profile.private_journal;
        return Math.max(0, (pj.reads || 0) + (pj.writes || 0));
      }
      case 'creative': {
        if (!profile || !profile.writing) return 0;
        const w = profile.writing;
        return Math.max(0, (w.reads || 0) + (w.writes || 0));
      }
      case 'web': {
        if (!Array.isArray(session.web_searches)) return 0;
        return Math.max(0, session.web_searches.length);
      }
      case 'predictions': {
        if (!profile || !profile.predictions) return 0;
        const p = profile.predictions;
        return Math.max(0, (p.reads || 0) + (p.writes || 0));
      }
      case 'messaging': {
        if (!profile) return 0;
        let total = 0;
        if (profile.msgs_from_james) {
          total += (profile.msgs_from_james.reads || 0) + (profile.msgs_from_james.writes || 0);
        }
        if (profile.msgs_to_james) {
          total += (profile.msgs_to_james.reads || 0) + (profile.msgs_to_james.writes || 0);
        }
        return Math.max(0, total);
      }
      case 'memory': {
        if (!profile || !profile.memory_files) return 0;
        const m = profile.memory_files;
        return Math.max(0, (m.reads || 0) + (m.writes || 0));
      }
      default:
        return 0;
    }
  }

  /**
   * Compute per-version averages and normalize to 0-1.
   * Returns Map<version, number[]> where each number[] has NUM_AXES entries.
   */
  function computeNormalized(sessionList: any[]): { versions: string[]; normalized: Map<string, number[]> } {
    // Group sessions by version
    const groups = new Map<string, any[]>();
    for (const s of sessionList) {
      const v = s.version || 'unknown';
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(s);
    }

    const versions = [...groups.keys()].sort();

    // Compute per-version averages for each axis
    const averages = new Map<string, number[]>();
    for (const v of versions) {
      const vSessions = groups.get(v)!;
      const count = vSessions.length;
      const avgs: number[] = [];
      for (const axis of AXES) {
        let sum = 0;
        for (const s of vSessions) {
          sum += axisValue(s, axis.key);
        }
        avgs.push(count > 0 ? sum / count : 0);
      }
      averages.set(v, avgs);
    }

    // Find max average per axis across all versions
    const maxPerAxis: number[] = new Array(NUM_AXES).fill(0);
    for (const avgs of averages.values()) {
      for (let i = 0; i < NUM_AXES; i++) {
        if (avgs[i] > maxPerAxis[i]) maxPerAxis[i] = avgs[i];
      }
    }

    // Normalize to 0-1
    const normalized = new Map<string, number[]>();
    for (const v of versions) {
      const avgs = averages.get(v)!;
      const norm: number[] = [];
      for (let i = 0; i < NUM_AXES; i++) {
        if (maxPerAxis[i] === 0) {
          norm.push(0);
        } else {
          norm.push(Math.max(0, avgs[i] / maxPerAxis[i]));
        }
      }
      normalized.set(v, norm);
    }

    return { versions, normalized };
  }

  /**
   * Compute angle in radians for axis index.
   * Start from -PI/2 (top) and go clockwise.
   */
  function axisAngle(index: number): number {
    return (2 * Math.PI * index) / NUM_AXES - Math.PI / 2;
  }

  /**
   * Convert a normalized value (0-1) and axis index to (x, y) coordinates.
   */
  function pointOnAxis(index: number, value: number): [number, number] {
    const angle = axisAngle(index);
    const r = value * RADIUS;
    const x = CENTER_X + r * Math.cos(angle);
    const y = CENTER_Y + r * Math.sin(angle);
    return [x, y];
  }

  /**
   * Build SVG path d string for a polygon from normalized values.
   */
  function polygonPath(values: number[]): string {
    const points: string[] = [];
    for (let i = 0; i < NUM_AXES; i++) {
      const [x, y] = pointOnAxis(i, values[i]);
      // Round to 4 decimal places for consistency
      const rx = Math.round(x * 10000) / 10000;
      const ry = Math.round(y * 10000) / 10000;
      if (i === 0) {
        points.push(`M${rx},${ry}`);
      } else {
        points.push(`L${rx},${ry}`);
      }
    }
    points.push('Z');
    return points.join('');
  }

  /**
   * Determine text-anchor based on axis angle.
   */
  function labelAnchor(index: number): string {
    const angle = axisAngle(index);
    const cos = Math.cos(angle);
    if (Math.abs(cos) < 0.01) return 'middle';
    return cos > 0 ? 'start' : 'end';
  }

  $effect(() => {
    if (!container || !hasSessions) return;

    const sessionList = sessions!;
    const { versions, normalized } = computeNormalized(sessionList);
    versionList = versions;

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Create SVG
    const svg = d3Selection.select(container)
      .append('svg')
      .attr('viewBox', '0 0 600 600')
      .attr('width', '100%')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img')
      .attr('aria-label', `Behavioral fingerprint radar chart comparing ${versions.length} model version${versions.length !== 1 ? 's' : ''} across 6 axes`);

    // Draw grid rings
    for (const level of GRID_LEVELS) {
      svg.append('circle')
        .attr('class', 'grid-ring')
        .attr('cx', CENTER_X)
        .attr('cy', CENTER_Y)
        .attr('r', RADIUS * level)
        .attr('fill', 'none')
        .attr('stroke', '#333')
        .attr('stroke-width', 1);
    }

    // Draw axis lines
    for (let i = 0; i < NUM_AXES; i++) {
      const [ex, ey] = pointOnAxis(i, 1);
      svg.append('line')
        .attr('class', 'axis-line')
        .attr('x1', CENTER_X)
        .attr('y1', CENTER_Y)
        .attr('x2', ex)
        .attr('y2', ey)
        .attr('stroke', '#444')
        .attr('stroke-width', 1);
    }

    // Draw axis labels
    for (let i = 0; i < NUM_AXES; i++) {
      const angle = axisAngle(i);
      const lx = CENTER_X + (RADIUS + LABEL_OFFSET) * Math.cos(angle);
      const ly = CENTER_Y + (RADIUS + LABEL_OFFSET) * Math.sin(angle);
      const anchor = labelAnchor(i);

      svg.append('text')
        .attr('class', 'axis-label')
        .attr('x', Math.round(lx * 100) / 100)
        .attr('y', Math.round(ly * 100) / 100)
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#999')
        .attr('font-size', '12px')
        .text(AXES[i].label);
    }

    // Draw version polygons
    for (const v of versions) {
      const values = normalized.get(v)!;
      const d = polygonPath(values);
      const color = versionColor(v);

      svg.append('path')
        .attr('class', 'version-polygon')
        .attr('data-version', v)
        .attr('d', d)
        .attr('fill', color)
        .attr('fill-opacity', 0.25)
        .attr('stroke', color)
        .attr('stroke-width', 2);
    }

    // Build screen reader table
    const headers = ['Version', ...AXES.map(a => a.label)];
    const rows = versions.map(v => {
      const values = normalized.get(v)!;
      return [v, ...values.map(val => (Math.round(val * 100) / 100).toFixed(2))];
    });
    srTableHtml = createScreenReaderTable(headers, rows, 'Behavioral fingerprint by model version');

    // Cleanup function
    return () => {
      if (container) {
        d3Selection.select(container).selectAll('*').remove();
      }
      srTableHtml = '';
      versionList = [];
    };
  });
</script>

<div data-testid="radar-container">
  {#if !hasSessions}
    <div data-testid="no-data">No session data available</div>
  {:else}
    <div data-testid="chart-container" bind:this={container}></div>
    <div data-testid="legend" style="display: flex; gap: 1rem; flex-wrap: wrap; padding: 0.5rem 0; font-size: 0.85rem; color: #aaa;">
      {#each versionList as v}
        <span style="display: inline-flex; align-items: center; gap: 0.25rem;">
          <span style="color: {versionColor(v)}">&#9632;</span> {v}
        </span>
      {/each}
    </div>
    <div data-testid="sr-table" class="sr-only">{@html srTableHtml}</div>
  {/if}
</div>
