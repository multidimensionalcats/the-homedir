<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import { categoryColor, createScreenReaderTable, responsiveDimensions } from '../../lib/chart-utils';
  import { sessionsToAttentionCategories } from '../../lib/transforms';

  let { data = [] } = $props();
  let container = $state(null);
  let srTableHtml = $state('');

  $effect(() => {
    if (!container || !data || data.length === 0) return;

    // Sort data by date ascending
    const sorted = [...data].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );

    // Extract all unique category names across ALL entries (including unobserved)
    const categorySet = new Set();
    for (const entry of sorted) {
      if (entry.categories) {
        for (const key of Object.keys(entry.categories)) {
          categorySet.add(key);
        }
      }
    }
    let categoryNames = [...categorySet].sort();
    if (categoryNames.length === 0) {
      categoryNames = sessionsToAttentionCategories().map(c => c.name);
    }

    // Get responsive dimensions
    const dims = responsiveDimensions(600);
    const { width, height, margin } = dims;
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
      .attr('aria-label', 'Attention presence matrix');

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

    // Draw cells: for each date x category, classify as present/absent/void
    for (const entry of sorted) {
      for (const cat of categoryNames) {
        let cellClass;
        let fillColor;
        let fillOpacity;

        if (!entry.hasAttentionData) {
          cellClass = 'void-cell';
          fillColor = '#0A0C10';
          fillOpacity = 1;
        } else {
          const catData = entry.categories && entry.categories[cat];
          if (catData && (catData.reads + catData.writes) > 0) {
            cellClass = 'present-cell';
            fillColor = categoryColor(cat);
            fillOpacity = 1;
          } else {
            cellClass = 'absent-cell';
            fillColor = '#141720';
            fillOpacity = 1;
          }
        }

        g.append('rect')
          .attr('class', cellClass)
          .attr('x', xScale(entry.date))
          .attr('y', yScale(cat))
          .attr('width', xScale.bandwidth())
          .attr('height', yScale.bandwidth())
          .attr('fill', fillColor)
          .attr('opacity', fillOpacity)
          .attr('stroke', '#2A2F3A')
          .attr('stroke-width', 0.5);
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
    // Headers: Date + each category name
    const headers = ['Date', ...categoryNames];
    const rows = sorted.map((entry) => {
      const row = [entry.date];
      for (const cat of categoryNames) {
        if (!entry.hasAttentionData) {
          row.push('-');
        } else {
          const catData = entry.categories && entry.categories[cat];
          if (catData && (catData.reads + catData.writes) > 0) {
            row.push('1');
          } else {
            row.push('0');
          }
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
