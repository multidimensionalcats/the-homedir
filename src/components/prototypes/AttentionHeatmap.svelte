<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import { categoryColor, createScreenReaderTable, responsiveDimensions } from '../../lib/chart-utils';

  let { data = [] } = $props();
  let container = $state(null);
  let srTableHtml = $state('');

  $effect(() => {
    if (!container || !data || data.length === 0) return;

    // Sort data by date ascending
    const sorted = [...data].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );

    // Extract all unique category names across all entries (including unobserved days)
    const categorySet = new Set();
    for (const entry of sorted) {
      if (entry.categories) {
        for (const key of Object.keys(entry.categories)) {
          categorySet.add(key);
        }
      }
    }
    const categoryNames = [...categorySet].sort();

    // Get responsive dimensions (wider for heatmaps)
    const dims = responsiveDimensions(600);
    const { width, height, margin } = dims;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Compute max value across all cells for opacity scaling
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

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Create SVG
    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Attention heatmap across categories and time');

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale: band scale using dates
    const dates = sorted.map((d) => d.date);
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
      // Skip unobserved days — no rects for columns where hasAttentionData is false
      if (!entry.hasAttentionData) continue;

      for (const cat of categoryNames) {
        const catData = entry.categories && entry.categories[cat];
        if (!catData) continue;

        const val = (catData.reads || 0) + (catData.writes || 0);

        // Compute opacity: minimum 0.1 for non-zero, scaled by maxValue
        let opacity;
        if (val === 0) {
          opacity = 0;
        } else if (maxValue === 0) {
          opacity = 0.1;
        } else {
          opacity = Math.max(0.1, val / maxValue);
        }

        g.append('rect')
          .attr('x', xScale(entry.date))
          .attr('y', yScale(cat))
          .attr('width', xScale.bandwidth())
          .attr('height', yScale.bandwidth())
          .attr('fill', categoryColor(cat))
          .attr('opacity', opacity);
      }
    }

    // Add category text labels on Y axis
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
      const row = [entry.date];
      for (const cat of categoryNames) {
        const catData = entry.categories && entry.categories[cat];
        if (catData) {
          row.push((catData.reads || 0) + (catData.writes || 0));
        } else {
          row.push(0);
        }
      }
      return row;
    });
    srTableHtml = createScreenReaderTable(headers, rows);

    return () => {
      if (container) {
        d3Selection.select(container).selectAll('*').remove();
      }
    };
  });
</script>

{#if !data || data.length === 0}
  <p data-testid="no-data">No data available</p>
{:else}
  <div data-testid="chart-container" bind:this={container}></div>
  <div data-testid="sr-table">{@html srTableHtml}</div>
{/if}
