<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import { createScreenReaderTable, versionColor } from '../lib/chart-utils';

  let { sessions = [] } = $props();
  let container = $state(null);
  let srTableHtml = $state('');

  function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return null;
    return parsed;
  }

  $effect(() => {
    if (!container) return;
    if (!sessions || sessions.length === 0) return;

    // Filter to sessions with parseable dates
    const valid = sessions
      .map(s => {
        const d = parseDate(s.date);
        return d ? { ...s, _parsed: d } : null;
      })
      .filter(Boolean);

    if (valid.length === 0) return;

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Dimensions
    const margin = { left: 10, right: 10 };
    const width = container.clientWidth || 800;
    const height = 60;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height;

    // Compute date extent, accounting for PM offset
    const HALF_DAY_MS = 12 * 60 * 60 * 1000;
    const dates = valid.map(s => s._parsed);
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    let maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

    // Ensure the domain always has enough span so PM offsets (half-day)
    // produce a visible but proportionally small shift. For single-day or
    // short-span data, pad to a minimum span so 12h is a small fraction.
    const ONE_DAY_MS = HALF_DAY_MS * 2;
    const MIN_SPAN_MS = ONE_DAY_MS * 30; // minimum 30-day span
    const rawSpan = maxDate.getTime() - minDate.getTime();
    const padding = Math.max(ONE_DAY_MS, (MIN_SPAN_MS - rawSpan) / 2);
    const domainMin = new Date(minDate.getTime() - padding);
    const domainMax = new Date(maxDate.getTime() + padding);

    // X scale: time scale with padded domain
    const xScale = d3Scale.scaleTime()
      .domain([domainMin, domainMax])
      .range([0, innerWidth]);

    // Compute unique days for aria-label
    const daySet = new Set(valid.map(s => s.date));
    const dayCount = daySet.size;
    const sessionCount = valid.length;

    // Create SVG
    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', `Existence strip: ${sessionCount} sessions across ${dayCount} days`);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},0)`);

    // Draw session marks
    for (const session of valid) {
      let xDate = new Date(session._parsed.getTime());
      // PM sessions offset by half a day
      if (session.time_of_day === 'PM') {
        xDate = new Date(xDate.getTime() + HALF_DAY_MS);
      }

      g.append('rect')
        .attr('class', 'session-mark')
        .attr('x', xScale(xDate))
        .attr('y', 0)
        .attr('width', 2)
        .attr('height', innerHeight)
        .attr('fill', versionColor(session.version));
    }

    // Build screen reader table: session counts by version
    const versionCounts = {};
    for (const session of valid) {
      const v = session.version || 'Unknown';
      versionCounts[v] = (versionCounts[v] || 0) + 1;
    }

    const headers = ['Version', 'Sessions'];
    const rows = Object.entries(versionCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([version, count]) => [version, count]);

    srTableHtml = createScreenReaderTable(headers, rows);

    // Cleanup function
    return () => {
      if (container) {
        d3Selection.select(container).selectAll('*').remove();
      }
    };
  });
</script>

{#if !sessions || sessions.length === 0}
  <div data-testid="existence-strip">
    <p data-testid="no-data">No data</p>
  </div>
{:else}
  <div data-testid="existence-strip" bind:this={container}></div>
  <div data-testid="sr-table" class="sr-only">{@html srTableHtml}</div>
{/if}
