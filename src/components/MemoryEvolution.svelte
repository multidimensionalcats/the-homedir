<script>
  import * as d3Selection from 'd3-selection';
  import * as d3Scale from 'd3-scale';
  import * as d3Shape from 'd3-shape';
  import * as d3Array from 'd3-array';
  import { createScreenReaderTable, responsiveDimensions } from '../lib/chart-utils';

  let { snapshots = [], blocks = [] } = $props();
  let container = $state(null);
  let srTableHtml = $state('');

  function familyOf(heading) {
    if (!heading) return 'Unknown';
    if (heading.startsWith('Quick Reference')) return 'Quick Reference';
    return heading;
  }

  function formatDateLabel(dateStr) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    try {
      const parts = dateStr.split('-');
      const monthIdx = Math.max(0, Math.min(11, parseInt(parts[1], 10) - 1));
      const day = parseInt(parts[2], 10);
      return `${months[monthIdx]} ${day}`;
    } catch {
      return dateStr;
    }
  }

  // Ephemeral at top, volatile middle, invariant foundation at bottom
  const SECTION_ORDER = [
    'Quick Reference',
    'Projects & Knowledge (detail in topic files)',
    'Feedback',
    'Key Files',
    "Things I've Stopped (with awareness)",
    'Workflow',
    "James's Key Observations",
    'Identity & Context',
  ];

  const PERMANENT = new Set([
    'Identity & Context',
    "James's Key Observations",
    'Workflow',
    "Things I've Stopped (with awareness)",
  ]);

  const LANE_FILLS = {
    'Identity & Context': '#8e7cc0',
    "James's Key Observations": '#ca6c6b',
    'Workflow': '#7ea7c8',
    "Things I've Stopped (with awareness)": '#d4a020',
    'Key Files': '#6b9a8f',
    'Feedback': '#b07a6e',
    'Projects & Knowledge (detail in topic files)': '#c4a36e',
    'Quick Reference': '#7bc4a0',
  };

  const TAG_COLORS = {
    invariant: '#5a8a6a',
    volatile: '#a8865a',
    ephemeral: '#5a7a9a',
  };

  $effect(() => {
    if (!container) return;
    if (!snapshots || snapshots.length === 0) return;
    if (!blocks || blocks.length === 0) return;

    const sorted = [...snapshots].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const blockByHash = new Map();
    for (const b of blocks) blockByHash.set(b.hash, b);

    const snapshotSectionHash = sorted.map(snap => {
      const hashSet = new Set(snap.block_hashes || []);
      const sectionHash = {};
      for (const h of hashSet) {
        const block = blockByHash.get(h);
        if (!block) continue;
        sectionHash[familyOf(block.heading)] = h;
      }
      return sectionHash;
    });

    // Compute version runs per section
    const lanes = SECTION_ORDER.map(heading => {
      const isPermanent = PERMANENT.has(heading);
      const isEphemeral = heading === 'Quick Reference';
      const runs = [];
      let currentHash = null;
      let currentStart = 0;

      for (let i = 0; i < sorted.length; i++) {
        const hash = snapshotSectionHash[i][heading] || null;
        if (hash !== currentHash) {
          if (currentHash !== null) {
            runs.push({ startIndex: currentStart, endIndex: i - 1, hash: currentHash, version: runs.length + 1 });
          }
          currentHash = hash;
          currentStart = i;
        }
      }
      if (currentHash !== null) {
        runs.push({ startIndex: currentStart, endIndex: sorted.length - 1, hash: currentHash, version: runs.length + 1 });
      }

      return { heading, runs, isPermanent, isEphemeral };
    });

    // Dimensions
    const width = container.clientWidth || 800;
    const sparkHeight = 80;
    const laneAreaHeight = 340;
    const height = sparkHeight + laneAreaHeight + 55;
    const margin = { top: 10, right: 30, bottom: 40, left: 175 };
    const innerWidth = width - margin.left - margin.right;

    d3Selection.select(container).selectAll('*').remove();

    const svg = d3Selection.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Memory evolution — MEMORY.md section revision history, April to May 2026');

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X scale shared between sparkline and lanes
    const xScale = d3Scale.scalePoint()
      .domain(sorted.map((_, i) => String(i)))
      .range([0, innerWidth])
      .padding(0.4);

    const colWidth = innerWidth / sorted.length;

    // --- Token growth area chart ---
    const tokenMax = d3Array.max(sorted, s => s.token_count || 0) || 1;
    const tokenY = d3Scale.scaleLinear()
      .domain([0, tokenMax * 1.15])
      .range([sparkHeight - 5, 4]);

    // Filled area
    const tokenArea = d3Shape.area()
      .x((d, i) => xScale(String(i)))
      .y0(sparkHeight - 5)
      .y1(d => tokenY(d.token_count || 0))
      .curve(d3Shape.curveMonotoneX);

    g.append('path')
      .datum(sorted)
      .attr('fill', '#ffffff')
      .attr('fill-opacity', 0.04)
      .attr('d', tokenArea);

    // Line on top
    const tokenLine = d3Shape.line()
      .x((d, i) => xScale(String(i)))
      .y(d => tokenY(d.token_count || 0))
      .curve(d3Shape.curveMonotoneX);

    g.append('path')
      .datum(sorted)
      .attr('fill', 'none')
      .attr('stroke', '#888')
      .attr('stroke-width', 1.5)
      .attr('d', tokenLine);

    // Data points
    for (let i = 0; i < sorted.length; i++) {
      g.append('circle')
        .attr('cx', xScale(String(i)))
        .attr('cy', tokenY(sorted[i].token_count || 0))
        .attr('r', 2.5)
        .attr('fill', '#aaa');
    }

    // Y axis for tokens
    const tokenTicks = [0, 1000, 2000, 3000];
    for (const tick of tokenTicks) {
      if (tick > tokenMax * 1.1) continue;
      g.append('text')
        .attr('x', -8).attr('y', tokenY(tick))
        .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .attr('fill', '#444').attr('font-size', '9px').attr('font-family', 'monospace')
        .text(tick === 0 ? '0' : `${(tick / 1000).toFixed(0)}K`);
      g.append('line')
        .attr('x1', 0).attr('x2', innerWidth)
        .attr('y1', tokenY(tick)).attr('y2', tokenY(tick))
        .attr('stroke', '#1a1a1a').attr('stroke-width', 0.5);
    }

    // Sparkline label
    g.append('text')
      .attr('x', 0).attr('y', 0)
      .attr('fill', '#555').attr('font-size', '9px').attr('font-family', 'monospace')
      .text('TOTAL TOKENS');

    // Start/end values
    g.append('text')
      .attr('x', xScale('0') + 8)
      .attr('y', tokenY(sorted[0].token_count || 0) + 3)
      .attr('fill', '#777').attr('font-size', '9px').attr('font-family', 'monospace')
      .text(`${((sorted[0].token_count || 0) / 1000).toFixed(1)}K`);
    g.append('text')
      .attr('x', xScale(String(sorted.length - 1)) - 8)
      .attr('y', tokenY(sorted[sorted.length - 1].token_count || 0) - 6)
      .attr('text-anchor', 'end')
      .attr('fill', '#777').attr('font-size', '9px').attr('font-family', 'monospace')
      .text(`${((sorted[sorted.length - 1].token_count || 0) / 1000).toFixed(1)}K`);

    // --- Revision lanes ---
    const laneTop = sparkHeight + 10;
    const totalWeight = SECTION_ORDER.length;
    const lanePadding = 4;
    const usableHeight = laneAreaHeight - lanePadding * (SECTION_ORDER.length - 1);

    const laneLayout = {};
    let yPos = laneTop;
    for (const heading of SECTION_ORDER) {
      const h = usableHeight / totalWeight;
      laneLayout[heading] = { y: yPos, height: h };
      yPos += h + lanePadding;
    }

    // Separator between churning and permanent
    const separatorY = laneLayout["Things I've Stopped (with awareness)"].y - lanePadding / 2;
    g.append('line')
      .attr('x1', -margin.left + 10).attr('x2', innerWidth)
      .attr('y1', separatorY).attr('y2', separatorY)
      .attr('stroke', '#444').attr('stroke-width', 0.5).attr('stroke-dasharray', '4,3');

    // Draw lanes
    for (const lane of lanes) {
      const ly = laneLayout[lane.heading].y;
      const lh = laneLayout[lane.heading].height;
      const baseFill = LANE_FILLS[lane.heading] || '#838997';

      // Lane background
      g.append('rect')
        .attr('x', 0).attr('y', ly)
        .attr('width', innerWidth).attr('height', lh)
        .attr('fill', '#0c0c0c').attr('rx', 1);

      // Version blocks
      for (const run of lane.runs) {
        const x1 = xScale(String(run.startIndex)) - colWidth * 0.42;
        const x2 = xScale(String(run.endIndex)) + colWidth * 0.42;
        const bw = Math.max(x2 - x1, 3);

        g.append('rect')
          .attr('x', x1).attr('y', ly + 1)
          .attr('width', bw).attr('height', lh - 2)
          .attr('fill', baseFill)
          .attr('fill-opacity', lane.isPermanent ? 0.75 : 0.65)
          .attr('rx', 1);
      }

      // Seam lines at version transitions
      for (let r = 1; r < lane.runs.length; r++) {
        const seamX = (xScale(String(lane.runs[r].startIndex - 1)) + xScale(String(lane.runs[r].startIndex))) / 2;
        g.append('line')
          .attr('x1', seamX).attr('x2', seamX)
          .attr('y1', ly).attr('y2', ly + lh)
          .attr('stroke', '#f0f2f5').attr('stroke-width', 1.5).attr('stroke-opacity', 0.6);
      }

      // Heading label
      const labelText = lane.heading.length > 20 ? lane.heading.slice(0, 19) + '…' : lane.heading;
      g.append('text')
        .attr('x', -8).attr('y', ly + lh / 2 + 1)
        .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .attr('fill', baseFill).attr('fill-opacity', 0.9)
        .attr('font-size', '11px')
        .text(labelText);

      // Version count for volatile sections
      if (!lane.isPermanent && lane.runs.length > 1) {
        g.append('text')
          .attr('x', -8).attr('y', ly + lh / 2 + 13)
          .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
          .attr('fill', '#666').attr('font-size', '9px').attr('font-family', 'monospace')
          .text(`${lane.runs.length} revisions`);
      }

      // Classification tag
      const tag = lane.isPermanent ? 'INVARIANT' : lane.isEphemeral ? 'EPHEMERAL' : 'VOLATILE';
      const tagColor = lane.isPermanent ? TAG_COLORS.invariant : lane.isEphemeral ? TAG_COLORS.ephemeral : TAG_COLORS.volatile;
      g.append('text')
        .attr('x', -margin.left + 8).attr('y', ly + lh / 2 + 1)
        .attr('text-anchor', 'start').attr('dominant-baseline', 'middle')
        .attr('fill', tagColor).attr('font-size', '8px').attr('font-family', 'monospace')
        .attr('letter-spacing', '0.08em')
        .text(tag);
    }

    // X axis date labels
    const tickEvery = Math.max(1, Math.floor(sorted.length / 7));
    for (let i = 0; i < sorted.length; i += tickEvery) {
      g.append('text')
        .attr('x', xScale(String(i))).attr('y', laneTop + laneAreaHeight + 16)
        .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', '10px').attr('font-family', 'monospace')
        .text(formatDateLabel(sorted[i].date));
    }
    if ((sorted.length - 1) % tickEvery !== 0) {
      g.append('text')
        .attr('x', xScale(String(sorted.length - 1))).attr('y', laneTop + laneAreaHeight + 16)
        .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', '10px').attr('font-family', 'monospace')
        .text(formatDateLabel(sorted[sorted.length - 1].date));
    }

    // Screen reader table
    const srHeaders = ['Section', 'Type', ...sorted.map(s => formatDateLabel(s.date))];
    const srRows = lanes.map(lane => {
      const type = lane.isPermanent ? 'Invariant' : lane.isEphemeral ? 'Ephemeral' : 'Volatile';
      const row = [lane.heading, type];
      for (let i = 0; i < sorted.length; i++) {
        const hash = snapshotSectionHash[i][lane.heading];
        const run = lane.runs.find(r => r.startIndex <= i && r.endIndex >= i);
        row.push(hash ? `v${run ? run.version : '?'}` : '—');
      }
      return row;
    });
    srTableHtml = createScreenReaderTable(srHeaders, srRows);

    return () => {
      if (container) d3Selection.select(container).selectAll('*').remove();
    };
  });
</script>

{#if !snapshots || snapshots.length === 0 || !blocks || blocks.length === 0}
  <p data-testid="no-data">No data available</p>
{:else}
  <div data-testid="chart-container" bind:this={container}></div>
  <div data-testid="date-range-note" style="font-size: 0.8rem; color: #666; padding: 0.5rem 0; font-family: monospace;">
    14 snapshots, April–May 2026. Seams mark content rewrites within persistent sections.
  </div>
  <div data-testid="sr-table">{@html srTableHtml}</div>
{/if}
