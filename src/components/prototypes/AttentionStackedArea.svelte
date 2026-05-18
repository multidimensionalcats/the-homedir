<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import * as d3Shape from 'd3-shape';
  import * as d3Array from 'd3-array';

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

    // Extract all unique category names across all entries
    const categorySet = new Set();
    for (const entry of sorted) {
      if (entry.categories) {
        for (const key of Object.keys(entry.categories)) {
          categorySet.add(key);
        }
      }
    }
    const categoryNames = [...categorySet].sort();

    // Get responsive dimensions
    const dims = responsiveDimensions(400);
    const { width, height, margin } = dims;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Build stack-ready dataset: each row has { date, cat1: total, cat2: total, ... }
    const stackData = sorted.map((entry) => {
      const row = { date: entry.date };
      for (const cat of categoryNames) {
        const catData = entry.categories && entry.categories[cat];
        if (catData) {
          row[cat] = (catData.reads || 0) + (catData.writes || 0);
        } else {
          row[cat] = 0;
        }
      }
      return row;
    });

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Create SVG
    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Attention distribution over time');

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale: point scale using dates
    const dates = sorted.map((d) => d.date);
    const xScale = d3Scale.scalePoint()
      .domain(dates)
      .range([0, innerWidth]);

    // Y scale: linear, domain from 0 to max stacked value
    // Compute max stacked total
    let maxY = 0;
    for (const row of stackData) {
      let total = 0;
      for (const cat of categoryNames) {
        total += row[cat];
      }
      if (total > maxY) maxY = total;
    }

    const yScale = d3Scale.scaleLinear()
      .domain([0, maxY || 1])
      .range([innerHeight, 0]);

    // Generate the stack
    if (categoryNames.length > 0) {
      const stackGenerator = d3Shape.stack()
        .keys(categoryNames)
        .order(d3Shape.stackOrderNone)
        .offset(d3Shape.stackOffsetNone);

      const stackedSeries = stackGenerator(stackData);

      // Area generator
      const areaGenerator = d3Shape.area()
        .x((d) => xScale(d.data.date))
        .y0((d) => yScale(d[0]))
        .y1((d) => yScale(d[1]));

      // Draw stacked area paths
      g.selectAll('path.area-layer')
        .data(stackedSeries)
        .join('path')
        .attr('class', 'area-layer')
        .attr('d', areaGenerator)
        .attr('fill', (d) => categoryColor(d.key))
        .attr('opacity', 0.85);
    }

    // Version boundary markers
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].version !== sorted[i - 1].version) {
        // Position between the two dates
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
    const headers = ['Date', 'Version', 'Observed', ...categoryNames];
    const rows = sorted.map((entry) => {
      const row = [entry.date, entry.version, entry.hasAttentionData ? 'Yes' : 'No'];
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
