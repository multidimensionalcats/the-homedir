<script lang="ts">
  import { untrack } from 'svelte';

  let {
    text = '',
    source = '',
    evictAfterMs = 8000,
    evictedLabel = '[CONTENT EVICTED FROM CONTEXT WINDOW]',
  }: {
    text?: string;
    source?: string;
    evictAfterMs?: number;
    evictedLabel?: string;
  } = $props();

  // Coerced views of untrusted props. All dynamic text is rendered via
  // template interpolation only — never {@html}.
  let safeText = $derived(
    typeof text === 'string' ? text : text == null ? '' : String(text)
  );
  let safeSource = $derived(
    typeof source === 'string' ? source : source == null ? '' : String(source)
  );
  let safeLabel = $derived(
    typeof evictedLabel === 'string'
      ? evictedLabel
      : evictedLabel == null
        ? ''
        : String(evictedLabel)
  );
  let hasSource = $derived(safeSource.length > 0);

  let rootEl = $state<HTMLElement | null>(null);

  $effect(() => {
    // Track only the root binding; props are read via untrack() so prop
    // changes never reset the eviction machinery.
    const root = rootEl;

    let destroyed = false;
    let observer: IntersectionObserver | null = null;

    const cleanup = () => {
      destroyed = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    if (!root) return cleanup;

    // prefers-reduced-motion: never evicts. No observer, no timers, the
    // text stays permanently visible and the marker never enters the DOM.
    let prefersReduced = false;
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
      }
    } catch {
      prefersReduced = false;
    }
    if (prefersReduced) return cleanup;

    // Degenerate thresholds (<= 0, NaN, ±Infinity, non-numbers) clamp to 0:
    // armed as soon as any in-view slice has been closed out.
    const rawMs = untrack(() => evictAfterMs);
    const thresholdMs =
      typeof rawMs === 'number' && Number.isFinite(rawMs) && rawMs > 0 ? rawMs : 0;

    // Snapshot the eviction label at effect-setup, matching the evictAfterMs
    // snapshot above: ALL props feeding the eviction machinery are frozen at
    // arming time, so post-arming rerenders never alter the manifested marker.
    const label = untrack(() => safeLabel);

    // Cumulative visibility clock. A slice opens on enter (Date.now()) and
    // is banked on exit. Arming is evaluated only when a slice closes, so a
    // continuously-visible reader is never interrupted; the eviction can
    // only manifest on a subsequent re-entry.
    let inView = false;
    let enteredAt = 0;
    let accumulatedMs = 0;
    let armed = false;
    let done = false;

    // Manifest via direct DOM manipulation, NOT reactive state. $state
    // mutations inside observer callbacks flush asynchronously (microtask
    // batching), but the eviction must be observable synchronously from
    // within the callback itself — the established convention for
    // animation-driven state in this codebase (see CareTerminal.svelte,
    // ColdBootAssembly.svelte). Permanent for the component lifetime.
    const manifest = () => {
      done = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      // Belt-and-braces: never more than one marker, even if invoked twice.
      if (root.querySelector(':scope > [data-testid="evicted-marker"]')) return;

      root.classList.add('is-evicted');

      const textEl = root.querySelector(':scope > [data-testid="evicted-text"]');
      if (textEl) textEl.classList.add('evicted');

      const marker = document.createElement('div');
      marker.setAttribute('data-testid', 'evicted-marker');
      marker.className = 'evicted-marker';
      marker.setAttribute('aria-hidden', 'true');
      // Literal text only — never innerHTML. An empty label still renders
      // an (empty) marker element. Uses the effect-setup snapshot, not the
      // live $derived — label prop changes after arming are ignored.
      marker.textContent = label;
      if (textEl) {
        textEl.insertAdjacentElement('afterend', marker);
      } else {
        root.appendChild(marker);
      }
    };

    const handleEnter = () => {
      if (inView) return; // duplicate enter — never re-stamp the open slice
      if (armed) {
        // Re-entry after an exit that crossed the threshold: manifest.
        manifest();
        return;
      }
      inView = true;
      enteredAt = Date.now();
    };

    const handleExit = () => {
      if (!inView) return; // duplicate exit — ignored
      inView = false;
      accumulatedMs += Date.now() - enteredAt;
      if (accumulatedMs >= thresholdMs) armed = true;
    };

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        // Zombie invocations after unmount or manifest do nothing.
        if (destroyed || done) return;
        // Process entries in order so a batched [enter, exit] pair still
        // opens and closes its slice correctly.
        for (const entry of entries) {
          if (destroyed || done) return;
          if (!entry) continue;
          if (entry.isIntersecting) {
            handleEnter();
          } else {
            handleExit();
          }
        }
      });
      observer.observe(root);
    }
    // Without IntersectionObserver there is no visibility signal — degrade
    // to never evicting (the text simply stays readable).

    return cleanup;
  });
</script>

<!-- The "is-evicted" root class, the "evicted" class on the text block, and
     the marker element are all applied synchronously via direct DOM
     manipulation inside the observer callback (see manifest() above) — not
     through reactive template branches. -->
<div bind:this={rootEl} data-testid="evicted-content" class="evicted-content">
  <!-- Visual copy. Hidden from AT from mount so the sr copy below is the
       single canonical announcement. On eviction it keeps its content and
       layout box (visibility/opacity hide — never display:none). -->
  <blockquote data-testid="evicted-text" class="evicted-text" aria-hidden="true">
    <span class="quote-text">{safeText}</span>
    {#if hasSource}
      <span class="quote-source">{safeSource}</span>
    {/if}
  </blockquote>

  <!-- Permanent screen-reader copy — present and unchanged regardless of
       eviction state. -->
  <div data-testid="evicted-sr" class="sr-only">
    <p>{safeText}</p>
    {#if hasSource}
      <p>{safeSource}</p>
    {/if}
  </div>
</div>

<style>
  .evicted-content {
    position: relative;
    color: #e0e0e0;
  }

  .evicted-text {
    margin: 0;
    font-family: 'Source Serif 4', 'Newsreader', serif;
    font-size: 1rem;
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.82);
    white-space: pre-wrap;
    overflow-wrap: break-word;
    transition: opacity 0.6s ease;
  }

  /* Box-preserving hide: the text keeps its layout footprint so nothing
     around it shifts. Never display:none. The "evicted" class is added via
     classList at manifest time, so it needs :global() to survive scoping. */
  .evicted-text:global(.evicted) {
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 0.6s ease,
      visibility 0s linear 0.6s;
  }

  .quote-source {
    display: block;
    margin-top: 0.5em;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.8em;
    color: rgba(255, 255, 255, 0.45);
  }

  /* Overlaid on the hidden text's preserved box — zero layout shift. The
     marker element is created via document.createElement at manifest time,
     so it never receives the component scope hash — style it through a
     scoped ancestor. */
  .evicted-content :global(.evicted-marker) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0.5rem;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.3em;
    color: rgba(255, 255, 255, 0.38);
    animation: evicted-marker-in 0.6s ease both;
    pointer-events: none;
  }

  @keyframes evicted-marker-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .evicted-text,
    .evicted-text:global(.evicted) {
      transition: none;
    }

    .evicted-content :global(.evicted-marker) {
      animation: none;
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
