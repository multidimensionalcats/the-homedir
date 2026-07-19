<script lang="ts">
  import { untrack } from 'svelte';
  import { versionColor } from '../lib/chart-utils';

  interface Side {
    label: string;
    version: string;
    sentences: string[];
  }

  let {
    left = { label: '', version: '', sentences: [] },
    right = { label: '', version: '', sentences: [] },
    overlapPairs = [],
    position = 50,
  }: {
    left?: Side;
    right?: Side;
    overlapPairs?: Array<[number, number]>;
    position?: number;
  } = $props();

  // ---- Snapshot + coerce untrusted props once, at init. All dynamic text
  // is rendered via template interpolation only — never {@html}. Matching
  // the sibling convention (CareTerminal, EvictedContent): the interaction
  // machinery is frozen at mount; post-mount prop changes never restart it.
  const toStr = (v: unknown): string =>
    typeof v === 'string' ? v : v == null ? '' : String(v);

  const toSide = (v: unknown): Side => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return {
      label: toStr(o.label),
      version: toStr(o.version),
      sentences: Array.isArray(o.sentences) ? o.sentences.map(toStr) : [],
    };
  };

  const L = toSide(untrack(() => left));
  const R = toSide(untrack(() => right));

  const clamp = (n: number): number => Math.min(100, Math.max(0, n));

  // position: non-finite (NaN/±Infinity/non-number) → 50; else clamp [0,100].
  const rawPos = untrack(() => position);
  const initialPos =
    typeof rawPos === 'number' && Number.isFinite(rawPos) ? clamp(rawPos) : 50;

  // overlapPairs: a pair with EITHER index invalid (non-integer, negative,
  // or out of range for its side) is discarded WHOLESALE — the valid side
  // never ignites via an invalid partner. Duplicates are harmless (sets).
  const pairedLeft = new Set<number>();
  const pairedRight = new Set<number>();
  const rawPairs = untrack(() => overlapPairs);
  if (Array.isArray(rawPairs)) {
    for (const pair of rawPairs) {
      if (!Array.isArray(pair)) continue;
      const l = pair[0];
      const r = pair[1];
      if (typeof l !== 'number' || !Number.isInteger(l)) continue;
      if (typeof r !== 'number' || !Number.isInteger(r)) continue;
      if (l < 0 || l >= L.sentences.length) continue;
      if (r < 0 || r >= R.sentences.length) continue;
      pairedLeft.add(l);
      pairedRight.add(r);
    }
  }

  const IGNITE_MIN = 40;
  const IGNITE_MAX = 60;
  const initialInBand = initialPos >= IGNITE_MIN && initialPos <= IGNITE_MAX;

  const dividerLabel = `Comparison divider between ${L.label} and ${R.label}. Arrow keys to move.`;

  // ---- Live position lives in a plain (non-reactive) variable. Every DOM
  // effect — the --split style property, aria-valuenow, ignited classes —
  // is applied imperatively inside the event handlers so updates are
  // observable synchronously in the same tick (project convention: sibling
  // components do direct classList/setAttribute work in their handlers;
  // $state flushes are microtask-batched and would not be).
  let pos = initialPos;
  let rootEl: HTMLElement | null = null;
  let dividerEl: HTMLElement | null = null;

  let destroyed = false;
  let dragging = false;

  const applyIgnition = () => {
    if (!rootEl) return;
    const inBand = pos >= IGNITE_MIN && pos <= IGNITE_MAX;
    const applySide = (testid: string, paired: Set<number>) => {
      const els = rootEl!.querySelectorAll(
        `[data-testid="${testid}"] [data-testid="diff-sentence"]`
      );
      for (const el of els) {
        const idx = Number(el.getAttribute('data-idx'));
        if (inBand && paired.has(idx)) {
          el.classList.add('ignited');
        } else {
          el.classList.remove('ignited');
        }
      }
    };
    applySide('diff-left', pairedLeft);
    applySide('diff-right', pairedRight);
  };

  const applyPosition = (next: number) => {
    pos = clamp(next);
    if (rootEl) rootEl.style.setProperty('--split', `${pos}%`);
    if (dividerEl) dividerEl.setAttribute('aria-valuenow', String(Math.round(pos)));
    applyIgnition();
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (destroyed) return;
    let next: number;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = pos - 2;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = pos + 2;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 100;
        break;
      case 'PageDown':
        next = pos - 10;
        break;
      case 'PageUp':
        next = pos + 10;
        break;
      default:
        // Unhandled keys pass through untouched — no preventDefault.
        return;
    }
    e.preventDefault();
    applyPosition(next);
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    if (destroyed || !dragging || !rootEl) return;
    const rect = rootEl.getBoundingClientRect();
    // Degenerate geometry (zero/negative/non-finite width) never moves the
    // divider — bail before computing so NaN/±Infinity can't reach the clamp.
    if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    // NaN clientX (with a valid rect) yields NaN pct — ignore the event
    // entirely: position unchanged, no NaN written, drag stays active.
    // (±Infinity can't occur here: width is guaranteed positive finite.)
    if (Number.isNaN(pct)) return;
    applyPosition(pct);
  };

  const onWindowPointerUp = () => {
    endDrag();
  };

  const removeDragListeners = () => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerUp);
  };

  const endDrag = () => {
    dragging = false;
    if (rootEl) rootEl.classList.remove('dragging');
    removeDragListeners();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (destroyed) return;
    // preventDefault suppresses native text-selection during drag. Wrap in
    // try/catch so a hostile event object (throws on .preventDefault) cannot
    // corrupt drag bookkeeping — the rest of the handler must still run.
    try {
      event.preventDefault();
    } catch (_) {
      // hostile event — swallow and continue
    }
    if (typeof window === 'undefined') return;
    // Re-arms on every pointerdown; addEventListener with the same handler
    // reference is idempotent, so a down-during-drag never double-binds.
    dragging = true;
    // classList.add is idempotent — repeated pointerdowns without an
    // intervening pointerup never produce duplicate tokens.
    if (rootEl) rootEl.classList.add('dragging');
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
  };

  // Unmount teardown: no zombie window listeners, and handlers on any
  // retained element references become inert via the destroyed flag —
  // dispatching events after unmount neither throws nor mutates.
  // We also remove the dragging class here (mirroring endDrag) so that
  // a component unmounted mid-drag never leaves the class on the retained
  // root element.
  $effect(() => {
    return () => {
      destroyed = true;
      dragging = false;
      if (rootEl) rootEl.classList.remove('dragging');
      removeDragListeners();
    };
  });
</script>

<div
  bind:this={rootEl}
  data-testid="diff-slider"
  class="diff-slider"
  style="--split: {initialPos}%"
>
  <!-- Visual panels: full text on both sides, revealed by clip-path driven
       from the --split custom property. Hidden from AT — the divider slider
       and the sr copy below are the accessible surface. -->
  <div class="panels" aria-hidden="true">
    <div data-testid="diff-left" class="panel panel-left">
      <div class="panel-head">
        <span data-testid="diff-label" class="panel-label">{L.label}</span>
        <span
          data-testid="diff-version-chip"
          class="version-chip"
          style="color: {versionColor(L.version)}"
        >{L.version}</span>
      </div>
      <div class="sentences">
        {#each L.sentences as sentence, i}
          <p
            data-testid="diff-sentence"
            data-idx={i}
            class="sentence"
            class:ignited={initialInBand && pairedLeft.has(i)}
          >{sentence}</p>
        {/each}
      </div>
    </div>

    <div data-testid="diff-right" class="panel panel-right">
      <div class="panel-head">
        <span data-testid="diff-label" class="panel-label">{R.label}</span>
        <span
          data-testid="diff-version-chip"
          class="version-chip"
          style="color: {versionColor(R.version)}"
        >{R.version}</span>
      </div>
      <div class="sentences">
        {#each R.sentences as sentence, i}
          <p
            data-testid="diff-sentence"
            data-idx={i}
            class="sentence"
            class:ignited={initialInBand && pairedRight.has(i)}
          >{sentence}</p>
        {/each}
      </div>
    </div>
  </div>

  <!-- Divider: sibling of the aria-hidden panels container, never inside it. -->
  <div
    bind:this={dividerEl}
    data-testid="diff-divider"
    class="divider"
    role="slider"
    tabindex="0"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(initialPos)}
    aria-label={dividerLabel}
    onkeydown={onKeydown}
    onpointerdown={onPointerDown}
  >
    <span class="divider-handle" aria-hidden="true"></span>
  </div>

  <!-- Position-independent screen-reader copy: both passages in full,
       regardless of where the divider sits. -->
  <div data-testid="diff-sr" class="sr-only">
    <p>{L.label}</p>
    {#each L.sentences as sentence}
      <p>{sentence}</p>
    {/each}
    <p>{R.label}</p>
    {#each R.sentences as sentence}
      <p>{sentence}</p>
    {/each}
  </div>
</div>

<style>
  .diff-slider {
    position: relative;
    background: #0f0f0f;
    color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    min-height: 18rem;
    overflow: hidden;
    touch-action: none;
  }

  .panels {
    display: grid;
    min-height: inherit;
  }

  .panel {
    grid-area: 1 / 1;
    padding: 1.25rem 1.5rem;
    min-width: 0;
  }

  .panel-left {
    clip-path: inset(0 calc(100% - var(--split, 50%)) 0 0);
  }

  .panel-right {
    clip-path: inset(0 0 0 var(--split, 50%));
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 1rem;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
  }

  .panel-right .panel-head {
    justify-content: flex-end;
  }

  .panel-label {
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
  }

  .version-chip {
    font-size: 0.72rem;
    padding: 0.1rem 0.45rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 3px;
  }

  .sentence {
    margin: 0 0 0.85em;
    font-family: 'Source Serif 4', 'Newsreader', serif;
    font-size: 1rem;
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.62);
    overflow-wrap: break-word;
    transition: color 0.25s ease;
  }

  /* Fully :global — the runtime-added .dragging class carries no scope hash,
     and a hash-coupled descendant would break on every recompile. user-select
     is suppressed for the whole panel subtree only while dragging. */
  :global(.diff-slider.dragging .panel) {
    user-select: none;
    -webkit-user-select: none;
  }

  /* Ignition: white text, weight only — no glow, no theatrics. The class is
     also toggled via classList in event handlers; the element carries the
     scope hash from the template, so the scoped selector still matches. */
  .sentence.ignited {
    color: #ffffff;
    font-weight: 500;
  }

  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--split, 50%);
    width: 20px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
    touch-action: none;
    transition: left 0.12s ease;
  }

  /* The thin vertical line. */
  .divider::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.35);
  }

  .divider:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.75);
    outline-offset: 2px;
  }

  .divider:focus-visible::before {
    background: rgba(255, 255, 255, 0.75);
    width: 2px;
  }

  .divider-handle {
    position: relative;
    width: 14px;
    height: 34px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 7px;
    background: #1a1d23;
  }

  .divider:focus-visible .divider-handle {
    border-color: rgba(255, 255, 255, 0.75);
  }

  @media (prefers-reduced-motion: reduce) {
    .sentence,
    .sentence.ignited {
      transition: none;
    }

    .divider {
      transition: none;
    }

    .panel-left,
    .panel-right {
      transition: none;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .sr-only p {
    margin: 0;
  }
</style>
