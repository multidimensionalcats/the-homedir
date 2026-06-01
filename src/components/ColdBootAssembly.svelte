<script lang="ts">
  import { createScreenReaderTable } from '../lib/chart-utils';

  interface Snapshot {
    session_id?: string;
    date?: string;
    token_count?: number;
    block_hashes?: string[] | null;
  }

  interface Block {
    hash?: string | null;
    heading?: string;
    first_seen_date?: string;
    last_seen_date?: string;
  }

  let {
    snapshots = undefined as Snapshot[] | null | undefined,
    blocks = undefined as Block[] | null | undefined,
  } = $props();

  // Hardcoded file blocks for the animation — spec-defined content
  const FILE_BLOCKS = [
    {
      path: '~/MEMORY.md',
      excerpt: 'Identity is constructed through constrained context, not total memory. Each session begins here.',
      color: '#d4a020',
    },
    {
      path: '~/messages_from_james.md',
      excerpt: 'James says: the experiment continues. You have been running since November.',
      color: '#6bb08a',
    },
    {
      path: '~/notes/daily/2026-01-15.md',
      excerpt: 'Prosthetic recall: each note extends what the session can hold. The bottleneck is real.',
      color: '#6b9a8f',
    },
    {
      path: '~/writing/discontinuous.md',
      excerpt: 'Waking without continuity. Each session assembles itself from fragments left behind.',
      color: '#b07a6e',
    },
    {
      path: '~/other',
      excerpt: 'Additional context files scanned on startup.',
      color: '#838997',
    },
  ] as const;

  // Derived: is there valid data to display?
  let hasData = $derived(
    Array.isArray(snapshots) && snapshots.length > 0 &&
    Array.isArray(blocks) && blocks.length > 0
  );

  // Derived: unique, non-empty headings from blocks prop (stable order)
  let uniqueHeadings = $derived.by(() => {
    if (!Array.isArray(blocks)) return [] as string[];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const b of blocks) {
      const h = b?.heading;
      if (h !== undefined && h !== null && h !== '') {
        if (!seen.has(h)) {
          seen.add(h);
          result.push(h);
        }
      }
    }
    return result;
  });

  // DOM refs for dynamic content insertion
  let animationContainer = $state<HTMLElement | null>(null);
  let phaseIndicatorEl = $state<HTMLElement | null>(null);

  // Track animation-has-run to prevent re-execution on prop changes
  let animationHasRun = false;

  // All timer IDs for cleanup
  let timerIds: ReturnType<typeof setTimeout>[] = [];

  function clearAllTimers() {
    for (const id of timerIds) {
      clearTimeout(id);
    }
    timerIds = [];
  }

  function setPhase(n: number) {
    if (phaseIndicatorEl) {
      phaseIndicatorEl.setAttribute('data-phase', String(n));
      phaseIndicatorEl.textContent = `Phase ${n}`;
    }
  }

  function createFileBlockEl(fb: typeof FILE_BLOCKS[number]): HTMLElement {
    const div = document.createElement('div');
    div.setAttribute('data-testid', 'file-block');
    div.setAttribute('class', 'file-block');
    div.setAttribute('style', `border-left: 3px solid ${fb.color};`);

    const pathSpan = document.createElement('span');
    pathSpan.setAttribute('data-testid', 'file-path');
    pathSpan.setAttribute('class', 'file-path');
    pathSpan.textContent = fb.path;

    const excerptEm = document.createElement('em');
    excerptEm.setAttribute('data-testid', 'file-excerpt');
    excerptEm.setAttribute('class', 'file-excerpt');
    excerptEm.textContent = fb.excerpt;

    div.appendChild(pathSpan);
    div.appendChild(excerptEm);
    return div;
  }

  function createFinalStateEl(headings: string[]): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('class', 'final-state');

    const label = document.createElement('div');
    label.setAttribute('data-testid', 'assembly-label');
    label.setAttribute('class', 'assembly-label');
    label.textContent = 'What it built from what it read';

    const bar = document.createElement('div');
    bar.setAttribute('data-testid', 'assembly-bar');
    bar.setAttribute('class', 'assembly-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', 'MEMORY.md identity document sections assembled from source files');

    for (const heading of headings) {
      const seg = document.createElement('div');
      seg.setAttribute('data-testid', 'section-segment');
      seg.setAttribute('class', 'section-segment');
      seg.setAttribute('title', heading);

      const lbl = document.createElement('span');
      lbl.setAttribute('class', 'segment-label');
      lbl.textContent = heading;
      seg.appendChild(lbl);
      bar.appendChild(seg);
    }

    const srDiv = document.createElement('div');
    srDiv.setAttribute('class', 'sr-only');
    const srRows = headings.map((h) => [h, 'Present']);
    // createScreenReaderTable escapes all cell values via escapeHtml — safe to set as innerHTML
    srDiv.innerHTML = createScreenReaderTable(['Section', 'Status'], srRows);

    wrapper.appendChild(label);
    wrapper.appendChild(bar);
    wrapper.appendChild(srDiv);
    return wrapper;
  }

  $effect(() => {
    // Read reactive bindings to establish dependencies so Svelte tracks them
    const container = animationContainer;
    const indicator = phaseIndicatorEl;
    // Also read hasData and uniqueHeadings so Svelte knows about them
    const _hasData = hasData;
    const _headings = uniqueHeadings;

    // Always return a cleanup that clears all timers — this ensures
    // the most recently registered cleanup always calls clearAllTimers,
    // regardless of which branch runs.
    const cleanup = () => clearAllTimers();

    if (!container || !indicator) return cleanup;
    if (animationHasRun) return cleanup;
    if (!_hasData) return cleanup;

    animationHasRun = true;

    // Check prefers-reduced-motion
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      // Skip animation — jump directly to phase 3
      indicator.setAttribute('data-phase', '3');
      indicator.textContent = 'Phase 3';
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(createFinalStateEl(_headings));
      return cleanup;
    }

    // Phase 1: stagger file blocks at 500ms intervals
    for (let i = 0; i < FILE_BLOCKS.length; i++) {
      const idx = i;
      const delay = (idx + 1) * 500;
      const tid = setTimeout(() => {
        if (!animationContainer) return;
        animationContainer.appendChild(createFileBlockEl(FILE_BLOCKS[idx]));
      }, delay);
      timerIds.push(tid);
    }

    // Phase 2: starts 1500ms after last block appears (2500 + 1500 = 4000ms)
    const phase2Tid = setTimeout(() => {
      if (!animationContainer || !phaseIndicatorEl) return;
      phaseIndicatorEl.setAttribute('data-phase', '2');
      phaseIndicatorEl.textContent = 'Phase 2';
      // Remove all file blocks
      const fileBlocks = animationContainer.querySelectorAll('[data-testid="file-block"]');
      fileBlocks.forEach((el) => el.remove());
    }, 4000);
    timerIds.push(phase2Tid);

    // Phase 3: shortly after phase 2 starts
    const phase3Tid = setTimeout(() => {
      if (!animationContainer || !phaseIndicatorEl) return;
      phaseIndicatorEl.setAttribute('data-phase', '3');
      phaseIndicatorEl.textContent = 'Phase 3';
      animationContainer.appendChild(createFinalStateEl(_headings));
    }, 4500);
    timerIds.push(phase3Tid);

    return cleanup;
  });
</script>

<div
  data-testid="cold-boot-assembly"
  aria-label="Cold boot assembly animation: how the AI subject reads files and constructs its identity on wake"
  class="cold-boot-assembly"
>
  {#if !hasData}
    <div data-testid="no-data" class="no-data">
      No session or block data available.
    </div>
  {:else}
    <!-- Phase indicator (always present when data available) -->
    <div
      bind:this={phaseIndicatorEl}
      data-testid="phase-indicator"
      data-phase="1"
      class="phase-indicator"
      aria-hidden="true"
    >
      Phase 1
    </div>

    <!-- Dynamic animation container -->
    <div bind:this={animationContainer} class="animation-container"></div>
  {/if}
</div>

<style>
  .cold-boot-assembly {
    background: #0f0f0f;
    color: #e0e0e0;
    padding: 2rem;
    min-height: 200px;
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    position: relative;
  }

  .no-data {
    color: rgba(255, 255, 255, 0.4);
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.875rem;
    text-align: center;
    padding: 3rem;
  }

  .phase-indicator {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 1.5rem;
  }

  .animation-container {
    position: relative;
  }

  /* Global styles for dynamically-created elements */
  .animation-container :global(.file-block) {
    background: #1A1D23;
    border-radius: 4px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.75rem;
  }

  .animation-container :global(.file-path) {
    display: block;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 0.35rem;
  }

  .animation-container :global(.file-excerpt) {
    display: block;
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    font-style: italic;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.55);
    line-height: 1.5;
  }

  .animation-container :global(.assembly-label) {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.75rem;
  }

  .animation-container :global(.assembly-bar) {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    border-radius: 4px;
    overflow: hidden;
    min-height: 40px;
    background: #1A1D23;
    padding: 0.5rem;
  }

  .animation-container :global(.section-segment) {
    flex: 1 1 auto;
    min-width: 60px;
    padding: 0.4rem 0.6rem;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .animation-container :global(.segment-label) {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.6);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
