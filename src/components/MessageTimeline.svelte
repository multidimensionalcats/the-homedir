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

  function normalizeDate(date: string | null): string | null {
    if (!date) return null;
    return '2026' + date.slice(4);
  }

  const timeline = $derived.by(() => {
    if (!hasMsgs) return [];
    const tl = messagesToTimeline(safeMsgs);
    return tl.map(m => ({ ...m, date: normalizeDate(m.date), isAnomalous: false }));
  });
  const fromCount = $derived(timeline.filter(m => m.direction === 'from_james').length);
  const toCount = $derived(timeline.filter(m => m.direction === 'to_james').length);

  // Colors from archival palette
  const FROM_COLOR = '#6bb08a';
  const TO_COLOR = '#569672';
  // Layout constants
  const WIDTH = 800;
  const HEIGHT = 200;
  const MARGIN = { top: 30, right: 30, bottom: 35, left: 100 };
  const LANE_FROM_Y = 60;
  const LANE_TO_Y = 120;
  const DOT_RADIUS = 4;

  $effect(() => {
    if (!container || !hasMsgs) return;

    const withDates = timeline.filter(m => m.date != null);

    const allDates = withDates.map(m => new Date(m.date!));
    let xScale: (d: Date) => number;

    if (allDates.length <= 1) {
      xScale = () => (MARGIN.left + WIDTH - MARGIN.right) / 2;
    } else {
      const extent = [
        new Date(Math.min(...allDates.map(d => d.getTime()))),
        new Date(Math.max(...allDates.map(d => d.getTime()))),
      ];
      xScale = d3Scale.scaleTime()
        .domain(extent)
        .range([MARGIN.left, WIDTH - MARGIN.right]) as unknown as (d: Date) => number;
    }

    d3Selection.select(container).selectAll('*').remove();

    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
      .attr('role', 'img')
      .attr('aria-label', `Message timeline: ${fromCount} messages from James, ${toCount} messages to James`);

    // Lane labels
    svg.append('text').attr('x', MARGIN.left - 10).attr('y', LANE_FROM_Y + 4)
      .attr('text-anchor', 'end').attr('fill', '#a0a0a0').attr('font-size', '12px').text('From James');
    svg.append('text').attr('x', MARGIN.left - 10).attr('y', LANE_TO_Y + 4)
      .attr('text-anchor', 'end').attr('fill', '#a0a0a0').attr('font-size', '12px').text('To James');

    // Lane guide lines
    for (const y of [LANE_FROM_Y, LANE_TO_Y]) {
      svg.append('line').attr('x1', MARGIN.left).attr('x2', WIDTH - MARGIN.right)
        .attr('y1', y).attr('y2', y).attr('stroke', '#2a2a2a').attr('stroke-width', 1);
    }

    // Message dots
    for (const msg of withDates) {
      const cx = xScale(new Date(msg.date!));
      const cy = msg.direction === 'from_james' ? LANE_FROM_Y : LANE_TO_Y;
      const fill = msg.direction === 'from_james' ? FROM_COLOR : TO_COLOR;
      const dotClass = msg.direction === 'from_james' ? 'msg-dot-from' : 'msg-dot-to';
      svg.append('circle').attr('class', dotClass)
        .attr('cx', cx).attr('cy', cy).attr('r', DOT_RADIUS).attr('fill', fill);
    }

    // X-axis date ticks
    if (allDates.length > 1) {
      const ticks = (xScale as any).ticks ? (xScale as any).ticks(6) : [];
      const fmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
      for (const tick of ticks) {
        const tx = (xScale as any)(tick);
        svg.append('text').attr('x', tx).attr('y', HEIGHT - 8)
          .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', '10px')
          .attr('font-family', 'monospace').text(fmt.format(tick));
        svg.append('line').attr('x1', tx).attr('x2', tx)
          .attr('y1', LANE_TO_Y + 5).attr('y2', LANE_TO_Y + 10)
          .attr('stroke', '#444').attr('stroke-width', 1);
      }
    }

    // SR table
    const headers = ['Direction', 'Date', 'Content (excerpt)'];
    const rows: [string, string, string][] = timeline.map(m => [
      m.direction === 'from_james' ? 'From James' : 'To James',
      m.date ?? 'Unknown',
      (m.content || '').slice(0, 80),
    ]);
    srTableHtml = createScreenReaderTable(headers, rows, 'Message timeline data');

    return () => { d3Selection.select(container).selectAll('*').remove(); };
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
