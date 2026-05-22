<script lang="ts">
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import { messagesToTimeline, type TimelineMessage } from '../lib/transforms';
  import { createScreenReaderTable } from '../lib/chart-utils';

  let { messages = [] }: { messages?: any[] } = $props();
  let container = $state<HTMLElement | null>(null);
  let srTableHtml = $state('');

  const safeMsgs = $derived(Array.isArray(messages) && messages.length > 0 ? messages : []);
  const hasMsgs = $derived(safeMsgs.length > 0);

  const timeline = $derived(hasMsgs ? messagesToTimeline(safeMsgs) : []);
  const fromCount = $derived(timeline.filter(m => m.direction === 'from_james').length);
  const toCount = $derived(timeline.filter(m => m.direction === 'to_james').length);

  // Colors from archival palette
  const FROM_COLOR = '#6bb08a';
  const TO_COLOR = '#569672';
  const ANOMALY_COLOR = '#ca6c6b';

  // Layout constants
  const WIDTH = 700;
  const HEIGHT = 160;
  const MARGIN = { top: 30, right: 40, bottom: 20, left: 100 };
  const LANE_FROM_Y = 50;
  const LANE_TO_Y = 110;
  const DOT_RADIUS = 4;

  $effect(() => {
    if (!container || !hasMsgs) return;

    const normal = timeline.filter(m => !m.isAnomalous && m.date != null);
    const anomalous = timeline.filter(m => m.isAnomalous);

    // Build x scale from normal message dates
    const dates = normal.map(m => new Date(m.date!));
    let xScale: (d: Date) => number;

    if (dates.length === 0) {
      // Only anomalous messages, no normal dates — place anomalies at center
      xScale = () => MARGIN.left + (WIDTH - MARGIN.left - MARGIN.right) / 2;
    } else if (dates.length === 1 || new Set(dates.map(d => d.getTime())).size === 1) {
      // Single date — center it
      const singleTime = dates[0].getTime();
      xScale = (d: Date) => {
        if (d.getTime() === singleTime) {
          return MARGIN.left + (WIDTH - MARGIN.left - MARGIN.right) / 2;
        }
        return MARGIN.left + (WIDTH - MARGIN.left - MARGIN.right) / 2;
      };
    } else {
      const extent = [
        new Date(Math.min(...dates.map(d => d.getTime()))),
        new Date(Math.max(...dates.map(d => d.getTime()))),
      ];
      xScale = d3Scale.scaleTime()
        .domain(extent)
        .range([MARGIN.left, WIDTH - MARGIN.right]) as unknown as (d: Date) => number;
    }

    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
      .attr('role', 'img')
      .attr('aria-label', `Message timeline: ${fromCount} messages from James, ${toCount} messages to James`);

    // Lane labels
    svg.append('text')
      .attr('x', MARGIN.left - 10)
      .attr('y', LANE_FROM_Y + 4)
      .attr('text-anchor', 'end')
      .attr('fill', '#a0a0a0')
      .attr('font-size', '12px')
      .text('From James');

    svg.append('text')
      .attr('x', MARGIN.left - 10)
      .attr('y', LANE_TO_Y + 4)
      .attr('text-anchor', 'end')
      .attr('fill', '#a0a0a0')
      .attr('font-size', '12px')
      .text('To James');

    // Lane guide lines
    svg.append('line')
      .attr('x1', MARGIN.left)
      .attr('x2', WIDTH - MARGIN.right)
      .attr('y1', LANE_FROM_Y)
      .attr('y2', LANE_FROM_Y)
      .attr('stroke', '#2a2a2a')
      .attr('stroke-width', 1);

    svg.append('line')
      .attr('x1', MARGIN.left)
      .attr('x2', WIDTH - MARGIN.right)
      .attr('y1', LANE_TO_Y)
      .attr('y2', LANE_TO_Y)
      .attr('stroke', '#2a2a2a')
      .attr('stroke-width', 1);

    // Render normal message dots
    for (const msg of normal) {
      const cx = xScale(new Date(msg.date!));
      const cy = msg.direction === 'from_james' ? LANE_FROM_Y : LANE_TO_Y;
      const fill = msg.direction === 'from_james' ? FROM_COLOR : TO_COLOR;
      const dotClass = msg.direction === 'from_james' ? 'msg-dot-from' : 'msg-dot-to';

      svg.append('circle')
        .attr('class', dotClass)
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', DOT_RADIUS)
        .attr('fill', fill);
    }

    // Render anomaly markers
    for (const msg of anomalous) {
      const cx = WIDTH - MARGIN.right + 15;
      const cy = msg.direction === 'from_james' ? LANE_FROM_Y : LANE_TO_Y;

      svg.append('circle')
        .attr('class', 'anomaly-marker')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', DOT_RADIUS + 2)
        .attr('fill', ANOMALY_COLOR)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1);
    }

    // Build screen reader table
    const headers = ['Direction', 'Date', 'Content (excerpt)'];
    const rows: [string, string, string][] = timeline.map(m => [
      m.direction === 'from_james' ? 'From James' : 'To James',
      m.date ?? 'Unknown',
      (m.content || '').slice(0, 80),
    ]);
    srTableHtml = createScreenReaderTable(headers, rows, 'Message timeline data');

    return () => {
      d3Selection.select(container).selectAll('*').remove();
    };
  });
</script>

<div data-testid="message-container">
  {#if !hasMsgs}
    <div data-testid="no-data">No message data available</div>
  {:else}
    <div data-testid="chart-container" bind:this={container}></div>
    <div data-testid="sr-table" class="sr-only">
      {@html srTableHtml}
    </div>
    <div data-testid="legend">
      <span style="color: {FROM_COLOR}">●</span> From James
      <span style="color: {TO_COLOR}">●</span> To James
    </div>
    <div data-testid="msg-count">{fromCount} from James · {toCount} to James</div>
  {/if}
</div>
