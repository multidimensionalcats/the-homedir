<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import * as d3Shape from 'd3-shape';
  import { categoryColor, createScreenReaderTable } from '../../lib/chart-utils';
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

    // Extract all unique category names across all entries
    const categorySet = new Set();
    for (const entry of sorted) {
      if (entry.categories) {
        for (const key of Object.keys(entry.categories)) {
          categorySet.add(key);
        }
      }
    }
    let categoryNames = [...categorySet].sort();

    // Fallback: if no categories found in data, use canonical list
    if (categoryNames.length === 0) {
      categoryNames = sessionsToAttentionCategories().map((c) => c.name).sort();
    }

    // Extract dates for shared X axis
    const dates = sorted.map((d) => d.date);

    // Mini-chart dimensions
    const cellWidth = 200;
    const cellHeight = 120;
    const margin = { top: 18, right: 4, bottom: 4, left: 4 };
    const innerWidth = cellWidth - margin.left - margin.right;
    const innerHeight = cellHeight - margin.top - margin.bottom;

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Apply CSS grid to container
    d3Selection.select(container)
      .style('display', 'grid')
      .style('grid-template-columns', 'repeat(3, 1fr)')
      .style('gap', '8px');

    // Render one mini-chart per category
    for (const cat of categoryNames) {
      // Compute per-date values for this category
      const values = sorted.map((entry) => {
        const catData = entry.categories && entry.categories[cat];
        if (catData) {
          return (catData.reads || 0) + (catData.writes || 0);
        }
        return 0;
      });

      const maxVal = Math.max(...values, 0);

      // Create wrapper div (grid cell)
      const wrapper = d3Selection.select(container)
        .append('div')
        .style('min-width', '0');

      // Create SVG inside the wrapper
      const svg = wrapper
        .append('svg')
        .attr('width', cellWidth)
        .attr('height', cellHeight)
        .style('display', 'block')
        .style('max-width', '100%');

      const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      // X scale: point scale with dates
      const xScale = d3Scale.scalePoint()
        .domain(dates)
        .range([0, innerWidth]);

      // Y scale: linear from 0 to max (minimum domain max of 1)
      const yScale = d3Scale.scaleLinear()
        .domain([0, maxVal || 1])
        .range([innerHeight, 0]);

      // Build data array for area generator
      const areaData = sorted.map((entry, i) => ({
        date: entry.date,
        value: values[i],
      }));

      // Area generator
      const areaGenerator = d3Shape.area()
        .x((d) => xScale(d.date))
        .y0(innerHeight)
        .y1((d) => yScale(d.value));

      // Draw the area path
      g.append('path')
        .datum(areaData)
        .attr('d', areaGenerator)
        .attr('fill', categoryColor(cat))
        .attr('opacity', 0.7);

      // Add category name label
      svg.append('text')
        .attr('x', margin.left + 2)
        .attr('y', 13)
        .attr('fill', '#ccc')
        .attr('font-size', '11px')
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
  <div data-testid="chart-container" bind:this={container} role="img" aria-label="Attention small multiples"></div>
  <div data-testid="sr-table">{@html srTableHtml}</div>
{/if}
