<script lang="ts">
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import * as d3TimeFormat from 'd3-time-format';
  import { predictionsToCalibration, type CalibrationPrediction } from '../lib/transforms';
  import { createScreenReaderTable } from '../lib/chart-utils';

  let { predictions = [] }: { predictions?: any[] } = $props();
  let container = $state<HTMLElement | null>(null);
  let srTableHtml = $state('');

  const MARGIN = { top: 30, right: 30, bottom: 40, left: 60 };
  const TOTAL_WIDTH = 700;
  const TOTAL_HEIGHT = 300;
  const chartWidth = TOTAL_WIDTH - MARGIN.left - MARGIN.right;
  const chartHeight = TOTAL_HEIGHT - MARGIN.top - MARGIN.bottom;

  const UNRESOLVED_FILL = '#888';
  const NO_CONFIDENCE_FILL = '#666';
  const RESOLVED_FILL = '#6bb08a';

  const safePreds = $derived(Array.isArray(predictions) && predictions.length > 0 ? predictions : []);
  const hasPreds = $derived(safePreds.length > 0);
  const calibrated = $derived(hasPreds ? predictionsToCalibration(safePreds) : []);

  function truncate(str: string, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  }

  $effect(() => {
    if (!container || !hasPreds) return;

    const preds = calibrated;
    if (preds.length === 0) return;

    // Clear previous rendering
    d3Selection.select(container).selectAll('*').remove();

    // Parse dates, skip null dates
    const predsWithDates = preds.map(p => ({
      ...p,
      parsedDate: p.dateMade ? new Date(p.dateMade + 'T00:00:00') : null,
    }));

    const validDates = predsWithDates
      .filter(p => p.parsedDate !== null)
      .map(p => p.parsedDate!.getTime());

    if (validDates.length === 0) return;

    const minDate = new Date(Math.min(...validDates));
    const maxDate = new Date(Math.max(...validDates));

    // Handle single-date case: add a day of padding on each side
    let xDomainMin = minDate;
    let xDomainMax = maxDate;
    if (minDate.getTime() === maxDate.getTime()) {
      xDomainMin = new Date(minDate.getTime() - 86400000);
      xDomainMax = new Date(maxDate.getTime() + 86400000);
    }

    const xScale = d3Scale.scaleTime()
      .domain([xDomainMin, xDomainMax])
      .range([0, chartWidth]);

    const yScale = d3Scale.scaleLinear()
      .domain([0, 1])
      .range([chartHeight, 0]);

    // Create SVG
    const svg = d3Selection.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${TOTAL_WIDTH} ${TOTAL_HEIGHT}`)
      .attr('width', '100%')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img')
      .attr('aria-label', `Prediction tracker scatter plot showing ${preds.length} prediction${preds.length !== 1 ? 's' : ''} by date and confidence`);

    const g = svg.append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    // Y-axis gridlines
    const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
    for (const tick of yTicks) {
      g.append('line')
        .attr('x1', 0)
        .attr('y1', yScale(tick))
        .attr('x2', chartWidth)
        .attr('y2', yScale(tick))
        .attr('stroke', '#2a2a2a')
        .attr('stroke-width', 1);

      g.append('text')
        .attr('x', -8)
        .attr('y', yScale(tick))
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#888')
        .attr('font-size', '11px')
        .text(tick.toFixed(1));
    }

    // Y-axis label
    g.append('text')
      .attr('class', 'y-axis-label')
      .attr('transform', `rotate(-90)`)
      .attr('x', -chartHeight / 2)
      .attr('y', -45)
      .attr('text-anchor', 'middle')
      .attr('fill', '#999')
      .attr('font-size', '12px')
      .text('Confidence');

    // X-axis tick labels
    const formatDate = d3TimeFormat.timeFormat('%b %d');
    const xTicks = xScale.ticks(5);
    for (const tick of xTicks) {
      const xPos = xScale(tick);
      g.append('line')
        .attr('x1', xPos)
        .attr('y1', chartHeight)
        .attr('x2', xPos)
        .attr('y2', chartHeight + 6)
        .attr('stroke', '#888')
        .attr('stroke-width', 1);

      g.append('text')
        .attr('x', xPos)
        .attr('y', chartHeight + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', '#888')
        .attr('font-size', '11px')
        .text(formatDate(tick));
    }

    // X-axis baseline
    g.append('line')
      .attr('x1', 0)
      .attr('y1', chartHeight)
      .attr('x2', chartWidth)
      .attr('y2', chartHeight)
      .attr('stroke', '#444')
      .attr('stroke-width', 1);

    // Draw prediction dots
    for (const pred of predsWithDates) {
      if (!pred.parsedDate) continue;

      const cx = xScale(pred.parsedDate);
      const hasConfidence = pred.confidence !== null && pred.confidence !== undefined;
      const cy = hasConfidence ? yScale(pred.confidence!) : yScale(0);

      let fill: string;
      if (pred.isResolved) {
        fill = RESOLVED_FILL;
      } else if (!hasConfidence) {
        fill = NO_CONFIDENCE_FILL;
      } else {
        fill = UNRESOLVED_FILL;
      }

      let cssClass = 'prediction-dot';
      if (!pred.isResolved) {
        cssClass += ' unresolved';
      }
      if (!hasConfidence) {
        cssClass += ' no-confidence';
      }

      g.append('circle')
        .attr('class', cssClass)
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', hasConfidence ? 5 : 4)
        .attr('fill', fill)
        .attr('fill-opacity', hasConfidence ? 0.7 : 0.5)
        .attr('stroke', hasConfidence ? 'none' : '#555')
        .attr('stroke-width', hasConfidence ? 0 : 1);
    }

    // Build screen reader table
    const headers = ['Prediction', 'Confidence', 'Date Made', 'Status'];
    const rows: (string | number)[][] = preds.map(p => [
      truncate(p.text || '', 80),
      p.confidence !== null && p.confidence !== undefined ? String(p.confidence) : 'N/A',
      p.dateMade || 'N/A',
      p.isResolved ? 'Resolved' : 'Unresolved',
    ]);
    srTableHtml = createScreenReaderTable(headers, rows, 'Predictions and their confidence levels');

    // Cleanup function
    return () => {
      if (container) {
        d3Selection.select(container).selectAll('*').remove();
      }
      srTableHtml = '';
    };
  });
</script>

<div data-testid="prediction-container">
  {#if !hasPreds}
    <div data-testid="no-data">No prediction data available</div>
  {:else}
    <div data-testid="chart-container" bind:this={container}></div>
    <div data-testid="prediction-count" style="font-size: 0.85rem; color: #888; padding: 0.25rem 0;">
      {calibrated.length} prediction{calibrated.length !== 1 ? 's' : ''} tracked
    </div>
    <div style="font-size: 0.8rem; color: #666; padding: 0.25rem 0;">
      All predictions remain unresolved — shown as gray phantoms
    </div>
    <div data-testid="sr-table" class="sr-only">{@html srTableHtml}</div>
  {/if}
</div>
