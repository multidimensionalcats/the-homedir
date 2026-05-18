<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import * as d3Shape from 'd3-shape';
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

    // Extract all unique category names across all entries
    const categorySet = new Set();
    for (const entry of sorted) {
      if (entry.categories) {
        for (const key of Object.keys(entry.categories)) {
          categorySet.add(key);
        }
      }
    }

    // If no categories found (all-void data), fall back to canonical 13 categories
    let categoryNames;
    if (categorySet.size === 0) {
      categoryNames = sessionsToAttentionCategories().map((c) => c.name);
    } else {
      categoryNames = [...categorySet].sort();
    }

    // Get responsive dimensions
    const dims = responsiveDimensions(600);
    const { width, height, margin } = dims;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Row height: each category gets equal vertical space
    const rowHeight = innerHeight / categoryNames.length;

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Create SVG
    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Attention ridge plot');

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale: point scale using sorted dates
    const dates = sorted.map((d) => d.date);
    const xScale = d3Scale.scalePoint()
      .domain(dates)
      .range([0, innerWidth]);

    // For each category, create a mini area chart (ridge)
    for (let catIdx = 0; catIdx < categoryNames.length; catIdx++) {
      const cat = categoryNames[catIdx];

      // Compute per-date values: reads+writes for this category (0 if absent/void)
      const values = sorted.map((entry) => {
        const catData = entry.categories && entry.categories[cat];
        if (catData) {
          return (catData.reads || 0) + (catData.writes || 0);
        }
        return 0;
      });

      // Y scale per category: 0 to max value for this category (or 1 if all zeros)
      const maxVal = Math.max(...values);
      const yScale = d3Scale.scaleLinear()
        .domain([0, maxVal > 0 ? maxVal : 1])
        .range([0, rowHeight]);

      // Baseline: bottom of this category's row
      const baseline = catIdx * rowHeight + rowHeight;

      // Area generator for this ridge
      const areaGenerator = d3Shape.area()
        .x((d, i) => xScale(sorted[i].date))
        .y0(() => baseline)
        .y1((d, i) => baseline - yScale(values[i]));

      // Draw the ridge path
      g.append('path')
        .datum(values)
        .attr('d', areaGenerator)
        .attr('fill', categoryColor(cat))
        .attr('opacity', 0.7);

      // Category label
      g.append('text')
        .attr('x', -5)
        .attr('y', catIdx * rowHeight + rowHeight * 0.5)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#aaa')
        .attr('font-size', '10px')
        .text(cat);
    }

    // Version boundary markers
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].version !== sorted[i - 1].version) {
        const x1 = xScale(sorted[i - 1].date);
        const x2 = xScale(sorted[i].date);
        if (x1 == null || x2 == null) continue;
        const xMid = (x1 + x2) / 2;

        g.append('line')
          .attr('class', 'version-boundary')
          .attr('x1', xMid)
          .attr('x2', xMid)
          .attr('y1', 0)
          .attr('y2', innerHeight)
          .attr('stroke', '#888')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');
      }
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
