<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import * as d3Shape from 'd3-shape';
  import { createScreenReaderTable, responsiveDimensions } from '../lib/chart-utils';

  let { snapshots = [], blocks = [] } = $props();
  let container = $state(null);
  let srTableHtml = $state('');

  /**
   * Compute persistence count for a block: how many snapshots contain its hash.
   */
  function persistenceCount(blockHash, sortedSnapshots) {
    let count = 0;
    for (const snap of sortedSnapshots) {
      const hashes = snap.block_hashes || [];
      if (hashes.includes(blockHash)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Format a date string for x-axis labels.
   * Input: "2026-04-18" → "Apr 18"
   */
  function formatDateLabel(dateStr) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    try {
      const parts = dateStr.split('-');
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return `${months[monthIdx]} ${day}`;
    } catch {
      return dateStr;
    }
  }


  $effect(() => {
    if (!container) return;
    if (!snapshots || snapshots.length === 0) return;
    if (!blocks || blocks.length === 0) return;

    // Sort snapshots by date ascending
    const sorted = [...snapshots].sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      return da < db ? -1 : da > db ? 1 : 0;
    });

    // Sort blocks by persistence (descending), with stable order for ties
    const blocksSorted = [...blocks].map((b, origIdx) => ({
      ...b,
      _origIdx: origIdx,
      _persistence: persistenceCount(b.hash, sorted),
    }));
    blocksSorted.sort((a, b) => {
      if (b._persistence !== a._persistence) return b._persistence - a._persistence;
      return a._origIdx - b._origIdx;
    });

    // Dimensions
    const dims = responsiveDimensions(container.clientWidth || 800);
    const margin = { ...dims.margin, left: Math.max(dims.margin.left, 140) };
    const width = Math.max(container.clientWidth || 800, sorted.length * 30 + margin.left + margin.right);
    const { height } = dims;
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
      .attr('aria-label', 'Memory evolution palimpsest — MEMORY.md block persistence across snapshots from April to May 2026');

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale: band scale using snapshot indices
    const snapshotIds = sorted.map((_, i) => String(i));
    const xScale = d3Scale.scaleBand()
      .domain(snapshotIds)
      .range([0, innerWidth])
      .padding(0.05);

    // Y scale: band scale using block indices (persistence-sorted)
    const blockIds = blocksSorted.map((_, i) => String(i));
    const yScale = d3Scale.scaleBand()
      .domain(blockIds)
      .range([0, innerHeight])
      .padding(0.05);

    // Draw heatmap cells
    for (let si = 0; si < sorted.length; si++) {
      const snapshot = sorted[si];
      const snapshotKey = String(si);
      // Deduplicate hashes for this snapshot
      const hashSet = new Set(snapshot.block_hashes || []);

      for (let bi = 0; bi < blocksSorted.length; bi++) {
        const block = blocksSorted[bi];
        const blockKey = String(bi);
        const isPresent = hashSet.has(block.hash);

        g.append('rect')
          .attr('class', isPresent ? 'present-cell' : 'absent-cell')
          .attr('x', xScale(snapshotKey))
          .attr('y', yScale(blockKey))
          .attr('width', xScale.bandwidth())
          .attr('height', yScale.bandwidth())
          .attr('fill', isPresent ? '#d4a020' : 'rgba(255,255,255,0.04)')
          .attr('stroke', '#1A1D23')
          .attr('stroke-width', 0.5)
          .attr('data-hash', block.hash)
          .attr('data-heading', block.heading || '');
      }
    }

    // X-axis date labels
    for (let si = 0; si < sorted.length; si++) {
      const snapshot = sorted[si];
      const snapshotKey = String(si);
      g.append('text')
        .attr('x', (xScale(snapshotKey) || 0) + xScale.bandwidth() / 2)
        .attr('y', innerHeight + 16)
        .attr('text-anchor', 'middle')
        .attr('fill', '#999')
        .attr('font-size', '10px')
        .text(formatDateLabel(snapshot.date));
    }

    // Y-axis block heading labels
    for (let bi = 0; bi < blocksSorted.length; bi++) {
      const block = blocksSorted[bi];
      const blockKey = String(bi);
      g.append('text')
        .attr('x', -5)
        .attr('y', (yScale(blockKey) || 0) + yScale.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#ccc')
        .attr('font-size', '11px')
        .text(block.heading != null ? block.heading : '');
    }

    // Token count line
    // Filter to snapshots with valid (finite, non-null) token_count
    const tokenData = sorted
      .map((snap, i) => ({
        index: i,
        tokenCount: snap.token_count,
      }))
      .filter(d => d.tokenCount != null && Number.isFinite(d.tokenCount));

    if (tokenData.length > 0) {
      const maxToken = Math.max(1, ...tokenData.map(d => Math.abs(d.tokenCount)));
      const tokenYScale = d3Scale.scaleLinear()
        .domain([0, maxToken])
        .range([innerHeight, 0]);

      const lineGen = d3Shape.line()
        .defined(d => d.tokenCount != null && Number.isFinite(d.tokenCount))
        .x(d => (xScale(String(d.index)) || 0) + xScale.bandwidth() / 2)
        .y(d => tokenYScale(Math.max(0, d.tokenCount)));

      const pathData = lineGen(tokenData);

      if (pathData) {
        g.append('path')
          .attr('class', 'token-line')
          .attr('d', pathData)
          .attr('fill', 'none')
          .attr('stroke', '#6fc')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.7);
      } else {
        // Single point fallback: render a small circle as a degenerate "line"
        g.append('path')
          .attr('class', 'token-line')
          .attr('d', `M${(xScale(String(tokenData[0].index)) || 0) + xScale.bandwidth() / 2},${tokenYScale(Math.max(0, tokenData[0].tokenCount))}L${(xScale(String(tokenData[0].index)) || 0) + xScale.bandwidth() / 2},${tokenYScale(Math.max(0, tokenData[0].tokenCount))}`)
          .attr('fill', 'none')
          .attr('stroke', '#6fc')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.7);
      }
    } else {
      // No valid token data at all — still produce the element
      g.append('path')
        .attr('class', 'token-line')
        .attr('d', 'M0,0L0,0')
        .attr('fill', 'none')
        .attr('stroke', '#6fc')
        .attr('stroke-width', 0)
        .attr('opacity', 0);
    }

    // Build screen reader table
    const srHeaders = ['Block', ...sorted.map(s => formatDateLabel(s.date))];
    const srRows = blocksSorted.map(block => {
      const row = [block.heading != null ? block.heading : ''];
      for (const snap of sorted) {
        const hashSet = new Set(snap.block_hashes || []);
        row.push(hashSet.has(block.hash) ? '●' : '○');
      }
      return row;
    });
    srTableHtml = createScreenReaderTable(srHeaders, srRows);

    // Cleanup function
    return () => {
      if (container) {
        d3Selection.select(container).selectAll('*').remove();
      }
    };
  });
</script>

{#if !snapshots || snapshots.length === 0 || !blocks || blocks.length === 0}
  <p data-testid="no-data">No data available</p>
{:else}
  <div data-testid="chart-container" bind:this={container} class="chart-scroll" style="overflow-x: auto; overflow-y: hidden;"></div>
  <div data-testid="date-range-note" style="font-size: 0.8rem; color: #888; padding: 0.5rem 0;">
    Snapshots span April to May 2026 — each column is one MEMORY.md revision.
  </div>
  <div data-testid="sr-table">{@html srTableHtml}</div>
{/if}
