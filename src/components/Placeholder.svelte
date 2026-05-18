<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';

  let { data = [] } = $props();
  let container = $state(null);

  $effect(() => {
    if (!container || !data || data.length === 0) return;

    const width = 400;
    const height = 200;
    const safeData = data.map(d => ({ ...d, value: Number(d.value) || 0 }));

    d3Selection.select(container).selectAll('*').remove();

    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const maxVal = Math.max(0, ...safeData.map(d => d.value));

    const xScale = d3Scale.scaleBand()
      .domain(safeData.map((d, i) => `${i}`))
      .range([0, width])
      .padding(0.1);

    const yScale = d3Scale.scaleLinear()
      .domain([0, maxVal || 1])
      .range([height, 0]);

    svg.selectAll('rect')
      .data(safeData)
      .join('rect')
      .attr('x', (d, i) => xScale(`${i}`))
      .attr('y', d => yScale(Math.max(0, d.value)))
      .attr('width', xScale.bandwidth())
      .attr('height', d => height - yScale(Math.max(0, d.value)));

    return () => {
      if (container) {
        d3Selection.select(container).selectAll('*').remove();
      }
    };
  });
</script>

{#if !data || data.length === 0}
  <p data-testid="no-data">No data</p>
{:else}
  <div data-testid="chart-container" bind:this={container}></div>
{/if}
