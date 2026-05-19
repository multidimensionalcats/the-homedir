<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import { categoryColor, createScreenReaderTable, responsiveDimensions } from '../lib/chart-utils';
  import { sessionsToAttentionCategories } from '../lib/transforms';

  let { data = [], weeklyData = [] } = $props();
  let container = $state(null);
  let srTableHtml = $state('');
  const uid = Math.random().toString(36).slice(2, 8);

  // Determine which dataset to use: daily data primary, weekly fallback
  function resolveEntries() {
    if (data && data.length > 0) {
      return { entries: data, dateField: 'date', hasVersion: true };
    }
    if (weeklyData && weeklyData.length > 0) {
      return { entries: weeklyData, dateField: 'weekStart', hasVersion: false };
    }
    return null;
  }

  function hasData() {
    return (data && data.length > 0) || (weeklyData && weeklyData.length > 0);
  }

  $effect(() => {
    if (!container) return;

    const resolved = resolveEntries();
    if (!resolved) return;

    const { entries, dateField, hasVersion } = resolved;

    // Sort entries by date ascending
    const sorted = [...entries].sort((a, b) => {
      const aDate = a[dateField];
      const bDate = b[dateField];
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    });

    // Extract all unique category names across ALL entries (including void days)
    const categorySet = new Set();
    for (const entry of sorted) {
      if (entry.categories) {
        for (const key of Object.keys(entry.categories)) {
          categorySet.add(key);
        }
      }
    }
    let categoryNames = [...categorySet].sort();

    // All-void fallback: use canonical 13 categories
    if (categoryNames.length === 0) {
      categoryNames = sessionsToAttentionCategories().map(c => c.name);
    }

    // Compute max value across all data cells for opacity normalization
    let maxValue = 0;
    for (const entry of sorted) {
      if (!entry.hasAttentionData || !entry.categories) continue;
      for (const cat of categoryNames) {
        const catData = entry.categories[cat];
        if (catData) {
          const val = (catData.reads || 0) + (catData.writes || 0);
          if (val > maxValue) maxValue = val;
        }
      }
    }

    // Get responsive dimensions with extra left margin for category labels
    const dims = responsiveDimensions(800);
    const margin = { ...dims.margin, left: Math.max(dims.margin.left, 110) };
    const { width, height } = dims;
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
      .attr('aria-label', 'Attention heatmap — file access patterns across 13 categories');

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

    // X scale: band scale using dates
    const dates = sorted.map(d => d[dateField]);
    const xScale = d3Scale.scaleBand()
      .domain(dates)
      .range([0, innerWidth])
      .padding(0.05);

    // Y scale: band scale using category names
    const yScale = d3Scale.scaleBand()
      .domain(categoryNames)
      .range([0, innerHeight])
      .padding(0.05);

    // Draw heatmap cells
    for (const entry of sorted) {
      const entryDate = entry[dateField];

      for (const cat of categoryNames) {
        if (!entry.hasAttentionData) {
          // VOID cell: base rect + hatch overlay
          // Base rect
          g.append('rect')
            .attr('class', 'void-cell')
            .attr('x', xScale(entryDate))
            .attr('y', yScale(cat))
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('fill', '#0F1115')
            .attr('stroke', '#0A0C0F')
            .attr('stroke-width', 0.5);

          // Hatch pattern overlay
          g.append('rect')
            .attr('x', xScale(entryDate))
            .attr('y', yScale(cat))
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('fill', 'url(#void-hatch-${uid})')
            .attr('pointer-events', 'none');
        } else {
          // DATA cell: solid base + teal overlay
          const catData = entry.categories && entry.categories[cat];
          const val = catData ? (catData.reads || 0) + (catData.writes || 0) : 0;

          // Compute normalized value for overlay opacity
          const normalized = maxValue > 0 ? val / maxValue : 0;
          // Floor of 0.12, ceiling of 0.95
          const overlayOpacity = 0.12 + (normalized * 0.83);

          // Base rect (teal-tinted floor)
          g.append('rect')
            .attr('class', 'data-cell')
            .attr('x', xScale(entryDate))
            .attr('y', yScale(cat))
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('fill', '#1C2425')
            .attr('stroke', '#252B2C')
            .attr('stroke-width', 0.5)
            .attr('data-date', entryDate)
            .attr('data-category', cat);

          // Teal overlay
          g.append('rect')
            .attr('x', xScale(entryDate))
            .attr('y', yScale(cat))
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('fill', '#2AA9A9')
            .attr('opacity', overlayOpacity)
            .attr('pointer-events', 'none');
        }
      }
    }

    // Version boundary markers (only for daily data with version field)
    if (hasVersion) {
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].version && sorted[i - 1].version &&
            sorted[i].version !== sorted[i - 1].version) {
          const x1 = xScale(sorted[i - 1][dateField]);
          const x2 = xScale(sorted[i][dateField]);
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
    const headers = ['Date', ...categoryNames];
    const rows = sorted.map((entry) => {
      const row = [entry[dateField]];
      for (const cat of categoryNames) {
        if (!entry.hasAttentionData) {
          row.push('∅'); // ∅ for void cells
        } else {
          const catData = entry.categories && entry.categories[cat];
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

{#if !hasData()}
  <p data-testid="no-data">No data available</p>
{:else}
  <div data-testid="chart-container" bind:this={container}></div>
  <div data-testid="legend">
    <div style="display: flex; gap: 1.5rem; flex-wrap: wrap; padding: 0.75rem 0; font-size: 0.85rem; color: #aaa;">
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <svg width="20" height="14" role="presentation">
          <rect width="20" height="14" fill="#0F1115" stroke="#0A0C0F" stroke-width="1" />
          <line x1="0" y1="0" x2="20" y2="14" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <line x1="5" y1="0" x2="20" y2="10" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <line x1="10" y1="0" x2="20" y2="7" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
        </svg>
        <span>Unrecorded</span>
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <svg width="80" height="14" role="presentation">
          <defs>
            <linearGradient id="legend-teal-gradient-{uid}" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#1C2425" />
              <stop offset="30%" stop-color="#2AA9A9" stop-opacity="0.3" />
              <stop offset="100%" stop-color="#2AA9A9" stop-opacity="0.95" />
            </linearGradient>
          </defs>
          <rect width="80" height="14" fill="url(#legend-teal-gradient-{uid})" rx="2" />
        </svg>
        <span>Engagement level</span>
      </div>
    </div>
  </div>
  <div data-testid="sr-table">{@html srTableHtml}</div>
{/if}
