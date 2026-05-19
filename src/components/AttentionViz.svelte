<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import { categoryColor, createScreenReaderTable, responsiveDimensions } from '../lib/chart-utils';
  import { sessionsToAttentionCategories } from '../lib/transforms';

  let { sessions = [] } = $props();
  let container = $state(null);
  let srTableHtml = $state('');
  const uid = Math.random().toString(36).slice(2, 8);

  function isVoidSession(session) {
    const profile = session.attention_profile;
    return !profile || Object.keys(profile).length === 0;
  }

  function sortKey(session) {
    // Sort by date ascending, then AM before PM
    const tod = session.time_of_day === 'AM' ? '0' : '1';
    return session.date + '-' + tod;
  }

  $effect(() => {
    if (!container) return;
    if (!sessions || sessions.length === 0) return;

    // Sort sessions by date + time_of_day
    const sorted = [...sessions].sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    // Extract all unique category names across ALL sessions (including void)
    const categorySet = new Set();
    for (const session of sorted) {
      const profile = session.attention_profile || {};
      for (const key of Object.keys(profile)) {
        categorySet.add(key);
      }
    }
    let categoryNames = [...categorySet].sort();

    // All-void fallback: use canonical 13 categories
    if (categoryNames.length === 0) {
      categoryNames = sessionsToAttentionCategories().map(c => c.name);
    }

    // Compute max value across all data cells for opacity normalization
    let maxValue = 0;
    for (const session of sorted) {
      if (isVoidSession(session)) continue;
      const profile = session.attention_profile;
      for (const cat of categoryNames) {
        const catData = profile[cat];
        if (catData) {
          const val = (catData.reads || 0) + (catData.writes || 0);
          if (val > maxValue) maxValue = val;
        }
      }
    }

    // Width based on session count — each column gets minimum readable width
    const minColWidth = 4;
    const dims = responsiveDimensions(container.clientWidth || 800);
    const margin = { ...dims.margin, left: Math.max(dims.margin.left, 110) };
    const width = Math.max(container.clientWidth || 800, sorted.length * minColWidth + margin.left + margin.right);
    const { height } = dims;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Create SVG
    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Attention heatmap — file access patterns across 13 categories per session');

    // Define the void hatch pattern in <defs>
    const defs = svg.append('defs');
    const pattern = defs.append('pattern')
      .attr('id', `void-hatch-${uid}`)
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('patternTransform', 'rotate(45)');
    pattern.append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 6)
      .attr('stroke', 'rgba(255,255,255,0.08)')
      .attr('stroke-width', 1);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale: band scale using session indices (one column per session)
    const sessionIds = sorted.map((_, i) => String(i));
    const xScale = d3Scale.scaleBand()
      .domain(sessionIds)
      .range([0, innerWidth])
      .padding(0.02);

    // Y scale: band scale using category names
    const yScale = d3Scale.scaleBand()
      .domain(categoryNames)
      .range([0, innerHeight])
      .padding(0.02);

    // Draw heatmap cells
    for (let si = 0; si < sorted.length; si++) {
      const session = sorted[si];
      const sessionKey = String(si);
      const isVoid = isVoidSession(session);

      for (const cat of categoryNames) {
        if (isVoid) {
          // VOID cell: base rect + hatch overlay
          g.append('rect')
            .attr('class', 'void-cell')
            .attr('x', xScale(sessionKey))
            .attr('y', yScale(cat))
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('fill', '#0F1115')
            .attr('stroke', '#0A0C0F')
            .attr('stroke-width', 0.5);

          // Hatch pattern overlay
          g.append('rect')
            .attr('x', xScale(sessionKey))
            .attr('y', yScale(cat))
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('fill', `url(#void-hatch-${uid})`)
            .attr('pointer-events', 'none');
        } else {
          // DATA cell: category-colored fill with opacity scaled by reads+writes
          const profile = session.attention_profile;
          const catData = profile[cat];
          const val = catData ? (catData.reads || 0) + (catData.writes || 0) : 0;

          // Sqrt scale so low values (79% are ≤3) are still visually distinct
          const normalized = maxValue > 0 ? Math.sqrt(val / maxValue) : 0;

          if (val > 0) {
            const opacity = 0.30 + (normalized * 0.65);
            g.append('rect')
              .attr('class', 'data-cell')
              .attr('x', xScale(sessionKey))
              .attr('y', yScale(cat))
              .attr('width', xScale.bandwidth())
              .attr('height', yScale.bandwidth())
              .attr('fill', categoryColor(cat))
              .attr('opacity', opacity)
              .attr('stroke', '#1A1D23')
              .attr('stroke-width', 0.5)
              .attr('data-date', session.date)
              .attr('data-category', cat);
          }
        }
      }
    }

    // Version boundary markers
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].version && sorted[i - 1].version &&
          sorted[i].version !== sorted[i - 1].version) {
        const x1 = xScale(String(i - 1));
        const x2 = xScale(String(i));
        if (x1 == null || x2 == null) continue;

        const bw = xScale.bandwidth();
        const xMid = (x1 + bw + x2) / 2;

        // Boundary line
        g.append('line')
          .attr('class', 'version-boundary')
          .attr('x1', xMid)
          .attr('x2', xMid)
          .attr('y1', 0)
          .attr('y2', innerHeight)
          .attr('stroke', '#888')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');

        // Version label
        g.append('text')
          .attr('class', 'version-boundary')
          .attr('x', xMid)
          .attr('y', -8)
          .attr('text-anchor', 'middle')
          .attr('fill', '#888')
          .attr('font-size', '10px')
          .text(sorted[i].version);
      }
    }

    // Category text labels on Y axis
    for (const cat of categoryNames) {
      g.append('text')
        .attr('x', -5)
        .attr('y', yScale(cat) + yScale.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#ccc')
        .attr('font-size', '12px')
        .text(cat);
    }

    // Build screen reader table
    const headers = ['Session', ...categoryNames];
    const rows = sorted.map((session, i) => {
      const label = `${session.date} ${session.time_of_day || ''}`.trim();
      const row = [label];
      for (const cat of categoryNames) {
        if (isVoidSession(session)) {
          row.push('∅');
        } else {
          const profile = session.attention_profile;
          const catData = profile[cat];
          const val = catData ? (catData.reads || 0) + (catData.writes || 0) : 0;
          row.push(val);
        }
      }
      return row;
    });
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
  <p data-testid="no-data">No data available</p>
{:else}
  <div data-testid="chart-container" bind:this={container} class="chart-scroll" style="overflow-x: auto; overflow-y: hidden;"></div>
  <div data-testid="legend">
    <div style="display: flex; gap: 1.5rem; flex-wrap: wrap; padding: 0.75rem 0; font-size: 0.85rem; color: #aaa;">
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <svg width="20" height="14" role="presentation">
          <rect width="20" height="14" fill="#0F1115" stroke="#0A0C0F" stroke-width="1" />
          <line x1="0" y1="0" x2="20" y2="14" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <line x1="5" y1="0" x2="20" y2="10" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <line x1="10" y1="0" x2="20" y2="7" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
        </svg>
        <span>Unrecorded (55%)</span>
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span>Category colors</span>
      </div>
    </div>
  </div>
  <div data-testid="sr-table">{@html srTableHtml}</div>
{/if}
