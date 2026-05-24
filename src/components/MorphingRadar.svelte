<script lang="ts">
  import * as d3Selection from 'd3-selection';
  import { versionColor, createScreenReaderTable } from '../lib/chart-utils';

  let { sessions = [] }: { sessions?: any[] } = $props();

  // DOM bindings
  let morphChartEl = $state<HTMLElement | null>(null);
  let morphSectionEl = $state<HTMLElement | null>(null);
  let versionChartEls = $state<Record<string, HTMLElement | null>>({});

  // Reactive state
  let srTableHtml = $state('');
  let versionList = $state<string[]>([]);
  let morphProgress = $state(0);
  let sessionIndices = $state<Record<string, number>>({});

  // Radar axis definitions — order matters for angle assignment
  const AXES = [
    { key: 'conversations', label: 'Conversations', shortLabel: 'Convo' },
    { key: 'daily_notes', label: 'Daily Notes', shortLabel: 'Notes' },
    { key: 'experiments', label: 'Experiments', shortLabel: 'Exper.' },
    { key: 'learning', label: 'Learning', shortLabel: 'Learn.' },
    { key: 'memory_files', label: 'Memory Files', shortLabel: 'Memory' },
    { key: 'msgs_from_james', label: 'Msgs From James', shortLabel: 'From J' },
    { key: 'msgs_to_james', label: 'Msgs To James', shortLabel: 'To J' },
    { key: 'other', label: 'Other', shortLabel: 'Other' },
    { key: 'predictions', label: 'Predictions', shortLabel: 'Predict.' },
    { key: 'private_journal', label: 'Private Journal', shortLabel: 'Journal' },
    { key: 'scripts', label: 'Scripts', shortLabel: 'Scripts' },
    { key: 'tamagotchi', label: 'Tamagotchi', shortLabel: 'Tama.' },
    { key: 'writing', label: 'Writing', shortLabel: 'Writing' },
  ] as const;

  const NUM_AXES = AXES.length;
  const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];

  const MORPH_CX = 300;
  const MORPH_CY = 300;
  const MORPH_RADIUS = 180;
  const MORPH_LABEL_OFFSET = 30;

  const SMALL_CX = 140;
  const SMALL_CY = 140;
  const SMALL_RADIUS = 80;
  const SMALL_LABEL_OFFSET = 16;

  let hasSessions = $derived(Array.isArray(sessions) && sessions.length > 0);

  function axisValue(session: any, axisKey: string): number {
    const profile = session.attention_profile;
    if (!profile || !profile[axisKey]) return 0;
    const entry = profile[axisKey];
    return Math.max(0, (entry.reads || 0) + (entry.writes || 0));
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

    return { versions, normalized, maxPerAxis };
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
  function pointOnAxis(index: number, value: number, cx: number, cy: number, radius: number): [number, number] {
    const angle = axisAngle(index);
    const r = value * radius;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    return [x, y];
  }

  /**
   * Build SVG path d string for a polygon from normalized values.
   */
  function polygonPath(values: number[], cx: number, cy: number, radius: number): string {
    const points: string[] = [];
    for (let i = 0; i < NUM_AXES; i++) {
      const [x, y] = pointOnAxis(i, values[i], cx, cy, radius);
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

  /**
   * Interpolate between two number arrays element-wise.
   */
  function lerpValues(a: number[], b: number[], t: number): number[] {
    const result: number[] = [];
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      result.push(a[i] + (b[i] - a[i]) * t);
    }
    return result;
  }

  /**
   * Get the interpolated polygon values and current version label for a given progress (0-1).
   */
  function getMorphState(
    versions: string[],
    normalized: Map<string, number[]>,
    progress: number,
  ): { values: number[]; label: string } {
    if (versions.length === 0) {
      return { values: new Array(NUM_AXES).fill(0), label: '' };
    }
    if (versions.length === 1) {
      return { values: normalized.get(versions[0])!, label: versions[0] };
    }

    // Clamp progress
    const p = Math.max(0, Math.min(1, progress));

    // Map progress to segment between keyframes
    const numSegments = versions.length - 1;
    const segmentProgress = p * numSegments;
    const segmentIndex = Math.min(Math.floor(segmentProgress), numSegments - 1);
    const t = segmentProgress - segmentIndex;

    const fromVersion = versions[segmentIndex];
    const toVersion = versions[segmentIndex + 1];
    const fromValues = normalized.get(fromVersion)!;
    const toValues = normalized.get(toVersion)!;

    const interpolated = lerpValues(fromValues, toValues, t);

    // Determine label: show the nearest version
    const label = t < 0.5 ? fromVersion : toVersion;

    return { values: interpolated, label };
  }

  /**
   * Render grid, axes, and labels on an SVG selection.
   */
  function renderChartFrame(
    svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
    cx: number,
    cy: number,
    radius: number,
    labelOffset: number,
    fontSize: string,
    shortLabels = false,
  ) {
    // Draw grid rings
    for (const level of GRID_LEVELS) {
      svg.append('circle')
        .attr('class', 'grid-ring')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', radius * level)
        .attr('fill', 'none')
        .attr('stroke', '#333')
        .attr('stroke-width', 1);
    }

    // Draw axis lines
    for (let i = 0; i < NUM_AXES; i++) {
      const [ex, ey] = pointOnAxis(i, 1, cx, cy, radius);
      svg.append('line')
        .attr('class', 'axis-line')
        .attr('x1', cx)
        .attr('y1', cy)
        .attr('x2', ex)
        .attr('y2', ey)
        .attr('stroke', '#444')
        .attr('stroke-width', 1);
    }

    // Draw axis labels
    for (let i = 0; i < NUM_AXES; i++) {
      const angle = axisAngle(i);
      const lx = cx + (radius + labelOffset) * Math.cos(angle);
      const ly = cy + (radius + labelOffset) * Math.sin(angle);
      const anchor = labelAnchor(i);

      svg.append('text')
        .attr('class', 'axis-label')
        .attr('x', Math.round(lx * 100) / 100)
        .attr('y', Math.round(ly * 100) / 100)
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#999')
        .attr('font-size', fontSize)
        .text(shortLabels ? AXES[i].shortLabel : AXES[i].label);
    }
  }

  // Precompute version data once (shared by morph chart and label)
  let normalizedData = $derived.by(() => {
    if (!hasSessions) return { versions: [] as string[], normalized: new Map<string, number[]>() };
    return computeNormalized(sessions!);
  });

  // =============================================================
  // Effect: Morph chart (big hero)
  // =============================================================
  $effect(() => {
    if (!morphChartEl || !hasSessions) return;

    const { versions, normalized } = normalizedData;
    versionList = versions;

    const progress = morphProgress;

    // Clear previous rendering
    d3Selection.select(morphChartEl).selectAll('*').remove();

    // Create SVG
    const svg = d3Selection.select(morphChartEl)
      .append('svg')
      .attr('viewBox', '0 0 600 600')
      .attr('width', '100%')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img')
      .attr('aria-label', `Behavioral fingerprint radar chart comparing ${versions.length} model version${versions.length !== 1 ? 's' : ''} across 6 axes`);

    renderChartFrame(svg, MORPH_CX, MORPH_CY, MORPH_RADIUS, MORPH_LABEL_OFFSET, '12px');

    // Get interpolated values for current progress
    const { values: morphValues, label: morphLabel } = getMorphState(versions, normalized, progress);

    // Draw single morphing polygon
    const currentVersion = morphLabel || versions[0] || '';
    const color = versionColor(currentVersion);
    const d = polygonPath(morphValues, MORPH_CX, MORPH_CY, MORPH_RADIUS);

    svg.append('path')
      .attr('class', 'version-polygon')
      .attr('data-version', currentVersion)
      .attr('d', d)
      .attr('fill', color)
      .attr('fill-opacity', 0.38)
      .attr('stroke', color)
      .attr('stroke-width', 2);

    // Build screen reader table
    const headers = ['Version', ...AXES.map(a => a.label)];
    const rows = versions.map(v => {
      const values = normalized.get(v)!;
      return [v, ...values.map(val => (Math.round(val * 100) / 100).toFixed(2))];
    });
    srTableHtml = createScreenReaderTable(headers, rows, 'Behavioral fingerprint by model version');

    // Cleanup function
    return () => {
      if (morphChartEl) {
        d3Selection.select(morphChartEl).selectAll('*').remove();
      }
    };
  });

  // =============================================================
  // Effect: Scroll-driven morph progress via IntersectionObserver
  // =============================================================
  $effect(() => {
    if (!morphSectionEl) return;

    if (typeof IntersectionObserver === 'undefined') return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    const handleScroll = () => {
      if (!morphSectionEl) return;
      const rect = morphSectionEl.getBoundingClientRect();
      const stickyTop = window.innerHeight * 0.1;

      // Progress stays 0 until the section top reaches the sticky pin point
      if (rect.top > stickyTop) {
        morphProgress = 0;
        return;
      }

      // Ramp 0→1 from pin point until section bottom exits viewport
      const scrolled = stickyTop - rect.top;
      const totalScroll = rect.height - (window.innerHeight - stickyTop);
      morphProgress = Math.max(0, Math.min(1, scrolled / Math.max(1, totalScroll)));
    };

    // Use IntersectionObserver to know when to listen for scroll
    let scrollActive = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !scrollActive) {
            scrollActive = true;
            window.addEventListener('scroll', handleScroll, { passive: true });
            handleScroll();
          } else if (!entry.isIntersecting && scrollActive) {
            scrollActive = false;
            window.removeEventListener('scroll', handleScroll);
          }
        }
      },
      { threshold: 0 },
    );

    observer.observe(morphSectionEl);

    return () => {
      observer.disconnect();
      if (scrollActive) {
        window.removeEventListener('scroll', handleScroll);
      }
    };
  });

  // =============================================================
  // Derived: grouped sessions for small multiples
  // =============================================================
  let groupedSessions = $derived.by(() => {
    if (!hasSessions) return new Map<string, any[]>();
    const groups = new Map<string, any[]>();
    for (const s of sessions!) {
      const v = s.version || 'unknown';
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(s);
    }
    return groups;
  });

  const SM_WINDOW = 11;

  // =============================================================
  // Effect: Small multiples charts
  // =============================================================
  $effect(() => {
    if (!hasSessions) return;

    const versions = [...groupedSessions.keys()].sort();
    const indices = sessionIndices;

    // Render each version's small chart
    for (const v of versions) {
      const el = versionChartEls[v];
      if (!el) continue;

      const vSessions = groupedSessions.get(v)!;
      const currentIndex = Math.max(0, Math.min(indices[v] || 0, vSessions.length - 1));

      // Clear previous
      d3Selection.select(el).selectAll('*').remove();

      const svg = d3Selection.select(el)
        .append('svg')
        .attr('viewBox', '0 0 280 280')
        .attr('width', '100%')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role', 'img')
        .attr('aria-label', `Session radar chart for version ${v}`);

      renderChartFrame(svg, SMALL_CX, SMALL_CY, SMALL_RADIUS, SMALL_LABEL_OFFSET, '9px', true);

      const halfW = Math.floor(SM_WINDOW / 2);
      const winStart = Math.max(0, currentIndex - halfW);
      const winEnd = Math.min(vSessions.length - 1, currentIndex + halfW);
      const winCount = winEnd - winStart + 1;

      const gMax = normalizedData.maxPerAxis;
      const normalizedValues: number[] = [];
      for (let i = 0; i < NUM_AXES; i++) {
        let sum = 0;
        for (let j = winStart; j <= winEnd; j++) {
          sum += axisValue(vSessions[j], AXES[i].key);
        }
        const avg = winCount > 0 ? sum / winCount : 0;
        const FLOOR = 0.08;
        if (gMax[i] === 0) {
          normalizedValues.push(FLOOR);
        } else {
          normalizedValues.push(Math.max(FLOOR, avg / gMax[i]));
        }
      }

      const color = versionColor(v);
      const d = polygonPath(normalizedValues, SMALL_CX, SMALL_CY, SMALL_RADIUS);

      svg.append('path')
        .attr('class', 'version-polygon')
        .attr('data-version', v)
        .attr('d', d)
        .attr('fill', color)
        .attr('fill-opacity', 0.38)
        .attr('stroke', color)
        .attr('stroke-width', 1.5);
    }

    return () => {
      for (const v of versions) {
        const el = versionChartEls[v];
        if (el) {
          d3Selection.select(el).selectAll('*').remove();
        }
      }
    };
  });

  let currentMorphLabel = $derived.by(() => {
    if (!hasSessions) return '';
    const { versions, normalized } = normalizedData;
    const { label } = getMorphState(versions, normalized, morphProgress);
    return label;
  });

  // Helper to get session label text
  function getSessionLabel(v: string): string {
    const vSessions = groupedSessions.get(v);
    if (!vSessions || vSessions.length === 0) return '';
    const idx = Math.max(0, Math.min(sessionIndices[v] || 0, vSessions.length - 1));
    const s = vSessions[idx];
    const date = s.date || 'Unknown date';
    const tod = s.time_of_day || '';
    const count = vSessions.length;
    const pos = `${idx + 1}/${count}`;
    return tod ? `${pos} · ${date} ${tod}` : `${pos} · ${date}`;
  }

  function handleScrubberInput(v: string, event: Event) {
    const target = event.target as HTMLInputElement;
    sessionIndices = { ...sessionIndices, [v]: parseInt(target.value, 10) };
  }


</script>

<div data-testid="radar-container">
  {#if !hasSessions}
    <div data-testid="no-data">No session data available</div>
  {:else}
    <!-- Part 1: Big Morph Chart (sticky scrollytelling) -->
    <div data-testid="morph-section" bind:this={morphSectionEl} class="morph-section">
      <div class="morph-sticky">
        <div data-testid="morph-chart" bind:this={morphChartEl} class="morph-chart"></div>
        <div data-testid="morph-label" class="morph-label">{currentMorphLabel}</div>
      </div>
    </div>

    <!-- Part 2: Small Multiples -->
    <div data-testid="multiples-section" class="multiples-section">
      {#each [...groupedSessions.keys()].sort() as v}
        <div class="version-panel">
          <div
            data-testid="version-chart-{v}"
            class="version-chart"
            bind:this={versionChartEls[v]}
          ></div>
          <input
            type="range"
            data-testid="session-scrubber-{v}"
            class="session-scrubber"
            min="0"
            max={Math.max(0, (groupedSessions.get(v)?.length ?? 0) - 1)}
            value={sessionIndices[v] || 0}
            oninput={(e) => handleScrubberInput(v, e)}
          />
          <div data-testid="session-label-{v}" class="session-label">
            {getSessionLabel(v)}
          </div>
        </div>
      {/each}
    </div>

    <!-- Legend -->
    <div data-testid="legend" class="legend">
      {#each versionList as v}
        <span class="legend-entry">
          <span class="legend-swatch" style="color: {versionColor(v)}">&#9632;</span> {v}
        </span>
      {/each}
    </div>

    <!-- Screen reader table -->
    <div data-testid="sr-table" class="sr-only">{@html srTableHtml}</div>
  {/if}
</div>

<style>
  .morph-section {
    position: relative;
    min-height: 250vh;
    max-width: 600px;
    margin: 0 auto 2rem;
  }

  .morph-sticky {
    position: sticky;
    top: 10vh;
  }

  .morph-chart {
    width: 100%;
  }

  .morph-label {
    text-align: center;
    font-size: 1.25rem;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    color: #ccc;
    margin-top: 0.5rem;
    letter-spacing: 0.05em;
  }

  .multiples-section {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
    max-width: 960px;
    margin: 0 auto 1.5rem;
  }

  .version-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .version-chart {
    width: 100%;
    max-width: 280px;
  }

  .session-scrubber {
    width: 100%;
    max-width: 240px;
    accent-color: #666;
    cursor: pointer;
  }

  .session-label {
    font-size: 0.8rem;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    color: #888;
    text-align: center;
  }

  .legend {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.5rem 0;
    font-size: 0.85rem;
    color: #aaa;
  }

  .legend-entry {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
