<script lang="ts" module>
  // Injected raw CSS for the morph choreography. Injected as a plain <style>
  // element (unscoped by Svelte) so dynamically-created elements are covered
  // and the compiler cannot prune selectors it never sees in the template.
  // Transition declarations name their properties explicitly — never `all`.
  const ANIMATION_CSS = `
@keyframes cold-boot-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Base geometry so the morph collapse has a height to transition from */
.cold-boot-assembly .file-block {
  max-height: 12rem;
  overflow: hidden;
}

/* Phase 1: each appended file block fades in via an opacity transition */
.cold-boot-assembly .file-block.block-fade-in {
  opacity: 1;
  transition: opacity 600ms ease-in;
  transition-property: opacity;
  transition-duration: 600ms;
  animation: cold-boot-fade-in 600ms ease-in;
}

/* Phase 2: blocks collapse in place — opacity to 0, max-height and margin
   collapse. Declared after .block-fade-in so it wins the transition. */
.cold-boot-assembly .file-block.morphing {
  opacity: 0;
  max-height: 0;
  margin-bottom: 0;
  margin-top: 0;
  padding-top: 0;
  padding-bottom: 0;
  transition: opacity 1800ms ease, max-height 1800ms ease, margin 1800ms ease, padding 1800ms ease;
  transition-property: opacity, max-height, margin, padding;
  transition-duration: 1800ms;
}

/* Phase 3: blocks settled */
.cold-boot-assembly .file-block.morphed {
  opacity: 0;
  max-height: 0;
  margin-bottom: 0;
  margin-top: 0;
}

/* Final state crossfades in during phase 2 — fades from opacity 0 to 1 */
.cold-boot-assembly .final-state.emerging {
  opacity: 1;
  transition: opacity 1800ms ease;
  transition-property: opacity;
  transition-duration: 1800ms;
  animation: cold-boot-fade-in 1800ms ease;
}
`;

  // Module-scoped singleton for the injected animation <style>. All mounted
  // instances share ONE element via reference counting: created when the
  // first animating instance acquires it, removed from document.head only
  // when the last holder releases it. Repeated mount/unmount cycles can
  // therefore never accumulate style elements.
  let sharedStyleEl: HTMLStyleElement | null = null;
  let styleRefCount = 0;

  function acquireAnimationStyle(): void {
    if (styleRefCount === 0) {
      sharedStyleEl = document.createElement('style');
      sharedStyleEl.textContent = ANIMATION_CSS;
      document.head.appendChild(sharedStyleEl);
    }
    styleRefCount += 1;
  }

  function releaseAnimationStyle(): void {
    if (styleRefCount === 0) return;
    styleRefCount -= 1;
    if (styleRefCount === 0 && sharedStyleEl) {
      sharedStyleEl.remove();
      sharedStyleEl = null;
    }
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
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

  interface RetainedSection {
    heading: string;
    count: number;
  }

  let {
    snapshots = undefined as Snapshot[] | null | undefined,
    blocks = undefined as Block[] | null | undefined,
    filesRead = 19,
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

  // Archival palette for section segments, cycled by index
  const SEGMENT_PALETTE = [
    '#d4a020', '#7ea7c8', '#6b9a8f', '#8e7cc0', '#c4a36e', '#6bb08a',
    '#569672', '#7bc4a0', '#b07a6e', '#9e7e9a', '#7f8b96', '#ca6c6b',
    '#838997',
  ] as const;

  // Timeline (ms) — contractual values
  const BLOCK_INTERVAL_MS = 900; // block i appended at (i+1)*900
  const MORPH_START_MS = 9500; // phase 2: crossfade begins
  const FINAL_STATE_MS = 11300; // phase 3: settled

  const PHASE_TEXT: Record<number, string> = {
    1: 'READING',
    2: 'CONDENSING',
    3: 'RETAINED',
  };

  // Derived: is there valid data to display?
  let hasData = $derived(
    Array.isArray(snapshots) && snapshots.length > 0 &&
    Array.isArray(blocks) && blocks.length > 0
  );

  // Derived: latest snapshot by plain string comparison of `date`.
  // Missing/null/undefined/non-string dates sort lowest. Garbage strings
  // participate lexically (dates are never parsed). Ties: last in array
  // order wins.
  let latestSnapshot = $derived.by(() => {
    if (!Array.isArray(snapshots)) return null;
    let best: Snapshot | null = null;
    let bestKey: string | null = null;
    let found = false;
    for (const s of snapshots) {
      const key = s && typeof (s as Snapshot).date === 'string'
        ? (s as Snapshot).date as string
        : null;
      if (!found) {
        best = s ?? null;
        bestKey = key;
        found = true;
        continue;
      }
      if (key === null) {
        // Missing date is lowest; still wins a tie against another missing date
        if (bestKey === null) {
          best = s ?? null;
        }
      } else if (bestKey === null || key >= bestKey) {
        best = s ?? null;
        bestKey = key;
      }
    }
    return best;
  });

  // Derived: sections retained in the latest snapshot.
  // Hashes map through blocks (hash -> heading); empty/null/undefined
  // headings are dropped; first-seen order preserved; count = occurrences
  // (duplicate hashes count each time; distinct hashes sharing a heading sum).
  // Fallback: if nothing resolves, use all blocks' unique non-empty headings
  // with count = number of blocks carrying that heading.
  let retainedSections = $derived.by(() => {
    const blockList: Block[] = Array.isArray(blocks) ? blocks : [];

    const hashToHeading = new Map<unknown, string>();
    for (const b of blockList) {
      const hash = b?.hash;
      const heading = b?.heading;
      if (hash === null || hash === undefined) continue;
      if (heading === null || heading === undefined || (heading as unknown) === '') continue;
      if (!hashToHeading.has(hash)) {
        hashToHeading.set(hash, String(heading));
      }
    }

    const snap = latestSnapshot;
    const hashes = snap && Array.isArray(snap.block_hashes) ? snap.block_hashes : [];
    const order: string[] = [];
    const counts = new Map<string, number>();
    for (const h of hashes) {
      const heading = h === null || h === undefined ? undefined : hashToHeading.get(h);
      if (heading === undefined) continue;
      if (!counts.has(heading)) {
        counts.set(heading, 0);
        order.push(heading);
      }
      counts.set(heading, (counts.get(heading) as number) + 1);
    }
    if (order.length > 0) {
      return order.map((h): RetainedSection => ({ heading: h, count: counts.get(h) as number }));
    }

    // FALLBACK — all blocks' unique non-empty headings
    const fbOrder: string[] = [];
    const fbCounts = new Map<string, number>();
    for (const b of blockList) {
      const heading = b?.heading;
      if (heading === null || heading === undefined || (heading as unknown) === '') continue;
      const key = String(heading);
      if (!fbCounts.has(key)) {
        fbCounts.set(key, 0);
        fbOrder.push(key);
      }
      fbCounts.set(key, (fbCounts.get(key) as number) + 1);
    }
    return fbOrder.map((h): RetainedSection => ({ heading: h, count: fbCounts.get(h) as number }));
  });

  // DOM refs for dynamic content insertion
  let animationContainer = $state<HTMLElement | null>(null);
  let phaseIndicatorEl = $state<HTMLElement | null>(null);
  let liveRegionEl = $state<HTMLElement | null>(null);

  // Track animation-has-run to prevent re-execution on prop changes
  let animationHasRun = false;

  // All timer IDs for cleanup
  let timerIds: ReturnType<typeof setTimeout>[] = [];

  // Whether this instance holds a reference on the shared animation <style>
  let styleAcquired = false;

  // Initial phase label, computed at component init so reduced-motion users
  // don't flash "READING" for a cycle before the effect rewrites it.
  // Residual window: prerendered/built HTML always says READING until hydration.
  const initialPhaseLabel = (() => {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        if (window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true) {
          return PHASE_TEXT[3];
        }
      }
    } catch {
      // fall through to the default
    }
    return PHASE_TEXT[1];
  })();

  function clearAllTimers() {
    for (const id of timerIds) {
      clearTimeout(id);
    }
    timerIds = [];
  }

  function setPhaseState(el: HTMLElement, phase: 1 | 2 | 3) {
    el.setAttribute('data-phase', String(phase));
    el.textContent = PHASE_TEXT[phase];
    // Mirror the phase into the polite live region for screen readers.
    // untrack: this can run synchronously inside the effect and must not
    // register the binding as a dependency.
    const live = untrack(() => liveRegionEl);
    if (live) live.textContent = PHASE_TEXT[phase];
  }

  function createFileBlockEl(fb: typeof FILE_BLOCKS[number]): HTMLElement {
    const div = document.createElement('div');
    div.setAttribute('data-testid', 'file-block');
    // block-fade-in is the entry fade class — distinct from the morph classes
    div.setAttribute('class', 'file-block block-fade-in');
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

  function createFinalStateEl(
    sections: RetainedSection[],
    filesReadCount: number,
    emerging: boolean
  ): HTMLElement {
    const wrapper = document.createElement('div');
    // .emerging goes on the final-state wrapper element itself
    wrapper.setAttribute('class', emerging ? 'final-state emerging' : 'final-state');

    const n = sections.length;
    const caption = document.createElement('div');
    caption.setAttribute('data-testid', 'assembly-caption');
    caption.setAttribute('class', 'assembly-caption');
    caption.textContent =
      `${filesReadCount} file${filesReadCount === 1 ? '' : 's'} read. ` +
      `${n} section${n === 1 ? '' : 's'} retained.`;

    const bar = document.createElement('div');
    bar.setAttribute('data-testid', 'assembly-bar');
    bar.setAttribute('class', 'assembly-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', 'MEMORY.md identity document sections assembled from source files');

    sections.forEach((section, i) => {
      const seg = document.createElement('div');
      seg.setAttribute('data-testid', 'section-segment');
      seg.setAttribute('class', 'section-segment');
      seg.setAttribute('title', section.heading);
      seg.setAttribute(
        'style',
        `flex-grow: ${section.count}; background: ${SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]};`
      );

      const lbl = document.createElement('span');
      lbl.setAttribute('class', 'segment-label');
      // Headings are untrusted — always textContent, never innerHTML
      lbl.textContent = section.heading;
      seg.appendChild(lbl);
      bar.appendChild(seg);
    });

    // Codebase convention: the wrapper carries the sr-table testid and the
    // sr-only class (the inner table from createScreenReaderTable also
    // carries sr-only itself).
    const srDiv = document.createElement('div');
    srDiv.setAttribute('data-testid', 'sr-table');
    srDiv.setAttribute('class', 'sr-only');
    const srRows = sections.map((s) => [s.heading, String(s.count)]);
    // Safe: createScreenReaderTable escapes every header and cell through
    // escapeHtml (verified in chart-utils.ts) — untrusted headings are inert.
    srDiv.innerHTML = createScreenReaderTable(['Section', 'Blocks'], srRows);

    wrapper.appendChild(caption);
    wrapper.appendChild(bar);
    wrapper.appendChild(srDiv);
    return wrapper;
  }

  $effect(() => {
    // Track only the DOM bindings — data props are read via untrack() so
    // prop changes never re-trigger (and never restart) the animation.
    const container = animationContainer;
    const indicator = phaseIndicatorEl;

    const cleanup = () => {
      clearAllTimers();
      if (styleAcquired) {
        releaseAnimationStyle();
        styleAcquired = false;
      }
    };

    if (!container || !indicator) return cleanup;
    if (animationHasRun) return cleanup;
    if (!untrack(() => hasData)) return cleanup;

    animationHasRun = true;

    // Snapshot the derived data once — the animation depicts the boot as of start
    const sections = untrack(() => retainedSections);
    const filesReadCount = untrack(() => filesRead);

    // prefers-reduced-motion — absent matchMedia means motion is allowed
    let prefersReduced = false;
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
      }
    } catch {
      prefersReduced = false;
    }

    if (prefersReduced) {
      // Skip animation — jump straight to the settled final state
      setPhaseState(indicator, 3);
      container.appendChild(createFinalStateEl(sections, filesReadCount, false));
      return cleanup;
    }

    // Inject the morph/fade CSS — shared, reference-counted across instances
    acquireAnimationStyle();
    styleAcquired = true;

    // Phase 1 (READING): file block i appended at exactly (i+1)*900ms
    FILE_BLOCKS.forEach((fb, i) => {
      const tid = setTimeout(() => {
        container.appendChild(createFileBlockEl(fb));
      }, (i + 1) * BLOCK_INTERVAL_MS);
      timerIds.push(tid);
    });

    // Dwell: 4500ms → 9500ms, nothing changes.

    // Phase 2 (CONDENSING) at exactly 9500ms: blocks collapse in place
    // while the final state emerges in the same tick — a real crossfade.
    // File blocks are never removed.
    const morphTid = setTimeout(() => {
      setPhaseState(indicator, 2);
      container
        .querySelectorAll('[data-testid="file-block"]')
        .forEach((el) => el.classList.add('morphing'));
      container.appendChild(createFinalStateEl(sections, filesReadCount, true));
    }, MORPH_START_MS);
    timerIds.push(morphTid);

    // Phase 3 (RETAINED) at exactly 11300ms: blocks settle to .morphed,
    // final state fully visible.
    const settleTid = setTimeout(() => {
      setPhaseState(indicator, 3);
      container
        .querySelectorAll('[data-testid="file-block"]')
        .forEach((el) => el.classList.add('morphed'));
    }, FINAL_STATE_MS);
    timerIds.push(settleTid);

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
      {initialPhaseLabel}
    </div>

    <!-- Screen-reader phase announcements: mirrors the visible (aria-hidden)
         phase indicator. Deliberately a sibling of the animation container. -->
    <div bind:this={liveRegionEl} class="sr-only" aria-live="polite">
      {initialPhaseLabel}
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

  .animation-container :global(.assembly-caption) {
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
    border-radius: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .animation-container :global(.segment-label) {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    color: rgba(15, 15, 15, 0.85);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
