<script lang="ts">
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import { petEventsToLifecycles, type PetLifecycle } from '../lib/transforms';
  import { createScreenReaderTable } from '../lib/chart-utils';

  let { events = [] }: { events?: any[] } = $props();
  let container = $state<HTMLElement | null>(null);
  let srTableHtml = $state('');

  const safeEvents = $derived(Array.isArray(events) && events.length > 0 ? events : []);
  const hasEvents = $derived(safeEvents.length > 0);
  const lifecycles = $derived(hasEvents ? petEventsToLifecycles(safeEvents) : []);

  // Event type color mapping
  const EVENT_COLORS: Record<string, string> = {
    acquired: '#6bb08a',
    care: '#7ea7c8',
    death: '#ca6c6b',
  };
  const FALLBACK_COLOR = '#888';

  function eventColor(eventType: string): string {
    return EVENT_COLORS[eventType] ?? FALLBACK_COLOR;
  }

  // Layout constants
  const TIMELINE_WIDTH = 200;
  const TIMELINE_HEIGHT = 300;
  const MARGIN = { top: 40, right: 20, bottom: 20, left: 20 };
  const DOT_RADIUS = 6;

  $effect(() => {
    if (!container || !hasEvents) return;

    // Clear any previous rendering
    d3Selection.select(container).selectAll('*').remove();

    const totalWidth = lifecycles.length * TIMELINE_WIDTH;

    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('viewBox', `0 0 ${totalWidth} ${TIMELINE_HEIGHT}`)
      .attr('role', 'img')
      .attr('aria-label', `Pet lifecycle timeline: ${lifecycles.map(l => l.petName).join(', ')}`);

    // Collect all timestamps across all pets for a shared Y scale
    const allTimestamps = lifecycles.flatMap(l => l.events.map(e => new Date(e.timestamp).getTime()));
    const minTime = Math.min(...allTimestamps);
    const maxTime = Math.max(...allTimestamps);

    // Build per-pet timeline columns
    lifecycles.forEach((lifecycle, colIndex) => {
      const xCenter = colIndex * TIMELINE_WIDTH + TIMELINE_WIDTH / 2;

      // Create a group for this pet
      const petGroup = svg.append('g')
        .attr('data-testid', `pet-${lifecycle.petName}`);

      // Pet name label
      petGroup.append('text')
        .attr('class', 'pet-name')
        .attr('x', xCenter)
        .attr('y', MARGIN.top - 15)
        .attr('text-anchor', 'middle')
        .attr('fill', '#a0a0a0')
        .attr('font-size', '14px')
        .text(lifecycle.petName);

      // Build Y scale for this pet's events
      const petTimestamps = lifecycle.events.map(e => new Date(e.timestamp).getTime());
      const petMin = Math.min(...petTimestamps);
      const petMax = Math.max(...petTimestamps);

      let yScale: (t: number) => number;
      if (petMin === petMax) {
        // Single event or all same timestamp -- center vertically
        yScale = () => MARGIN.top + (TIMELINE_HEIGHT - MARGIN.top - MARGIN.bottom) / 2;
      } else {
        yScale = d3Scale.scaleLinear()
          .domain([petMin, petMax])
          .range([MARGIN.top, TIMELINE_HEIGHT - MARGIN.bottom]) as unknown as (t: number) => number;
      }

      // Vertical timeline line
      const lineY1 = lifecycle.events.length === 1
        ? yScale(petMin) - 10
        : yScale(petMin);
      const lineY2 = lifecycle.events.length === 1
        ? yScale(petMin) + 10
        : yScale(petMax);

      petGroup.append('line')
        .attr('x1', xCenter)
        .attr('x2', xCenter)
        .attr('y1', lineY1)
        .attr('y2', lineY2)
        .attr('stroke', '#2a2a2a')
        .attr('stroke-width', 2);

      // Event dots
      lifecycle.events.forEach(event => {
        const cy = yScale(new Date(event.timestamp).getTime());
        const fill = eventColor(event.eventType);

        petGroup.append('circle')
          .attr('class', 'pet-event')
          .attr('data-event-type', event.eventType)
          .attr('cx', xCenter)
          .attr('cy', cy)
          .attr('r', DOT_RADIUS)
          .attr('fill', fill);
      });
    });

    // Build screen reader table
    const headers = ['Pet Name', 'Event Type', 'Timestamp', 'Notes'];
    const rows: [string, string, string, string][] = lifecycles.flatMap(l =>
      l.events.map(e => [
        l.petName,
        e.eventType,
        e.timestamp,
        (e.notes || '').slice(0, 80),
      ] as [string, string, string, string])
    );
    srTableHtml = createScreenReaderTable(headers, rows, 'Pet lifecycle data');

    return () => {
      d3Selection.select(container).selectAll('*').remove();
    };
  });
</script>

<div data-testid="pet-container">
  {#if !hasEvents}
    <div data-testid="no-data">No pet data available</div>
  {:else}
    <div bind:this={container}></div>
    <div data-testid="sr-table" class="sr-only">
      {@html srTableHtml}
    </div>
  {/if}
</div>
