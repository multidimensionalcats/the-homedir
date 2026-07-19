<script lang="ts">
  import { untrack } from 'svelte';

  let { text = '', decayDuration = 12, source = null, dwellMs = undefined } = $props();

  // Coerced full text for aria-label and word-count. Rendered into the
  // template via interpolation only (never {@html}) so XSS payloads stay
  // inert at mount and are never re-parsed at decay start.
  let ariaText = $derived(text == null ? '' : String(text));

  let hasSource = $derived(typeof source === 'string' && source.length > 0);

  let rootEl = $state<HTMLElement | null>(null);

  $effect(() => {
    // Track only the root binding; every prop feeding the decay machinery is
    // read via untrack() so prop changes never reset it.
    const root = rootEl;

    let destroyed = false;
    let observer: IntersectionObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const cleanup = () => {
      destroyed = true;
      clearTimer();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    if (!root) return cleanup;

    // prefers-reduced-motion: reduce → never decays. ZERO observers, ZERO
    // timers; the text stays permanently visible (CSS also enforces this).
    let prefersReduced = false;
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
      }
    } catch {
      prefersReduced = false;
    }
    if (prefersReduced) return cleanup;

    // --- Dwell threshold ---------------------------------------------------
    // dwellMs is honored VERBATIM iff it is a positive finite number that is
    // not -0. Everything else (0, -0, negatives, NaN, ±Infinity, strings,
    // null, undefined) falls back to the word-count heuristic.
    const rawDwell = untrack(() => dwellMs);
    let dwell: number;
    const isVerbatim =
      typeof rawDwell === 'number' &&
      Number.isFinite(rawDwell) &&
      rawDwell > 0 &&
      !Object.is(rawDwell, -0);
    if (isVerbatim) {
      dwell = rawDwell as number;
    } else {
      // Heuristic: clamp(wordCount * 350, 5000, 20000). wordCount = count of
      // whitespace-separated tokens of String(text). Empty/whitespace-only →
      // 0 words → 5000 floor.
      const coerced = untrack(() => (text == null ? '' : String(text)));
      const trimmed = coerced.trim();
      const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
      dwell = Math.min(20000, Math.max(5000, wordCount * 350));
    }

    // --- Decay duration ----------------------------------------------------
    // Seconds. default 12; NaN → 12; negative → clamp to 0; 0 and 30 verbatim.
    const rawDur = untrack(() => decayDuration);
    const durationS = Number.isNaN(rawDur) ? 12 : Math.max(0, rawDur);

    // --- Cumulative visibility clock (slice banking) -----------------------
    let inView = false;
    let enteredAt = 0;
    let accumulatedMs = 0;
    let done = false;

    // Decay is started via direct DOM manipulation, NOT reactive state.
    // $state mutations inside timer/observer callbacks flush asynchronously
    // (microtask batching), but decay must start SYNCHRONOUSLY from within
    // the timer callback — the established convention in this codebase (see
    // EvictedContent.svelte). Once started it is permanent and idempotent:
    // the observer is disconnected and the style attribute is never touched
    // again.
    const startDecay = () => {
      if (done || destroyed) return;
      done = true;
      clearTimer();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      // Inline-style animation names are NOT rewritten by Svelte's scoper, so
      // the keyframes resolve to the GLOBAL name `decayFade` (declared as
      // `-global-decayFade` in the style block below).
      root.style.animation = `decayFade ${durationS}s ease-in forwards`;
    };

    // Maximum safe setTimeout delay before 32-bit signed integer overflow.
    // Delays greater than this overflow to ~immediate firing in all browsers.
    const MAX_TIMER_MS = 2147483647; // 2^31 − 1

    // Arm/re-arm the single pending timer for the remaining dwell time. Only
    // ever runs while in view; exit clears it so decay never starts
    // off-screen.
    //
    // Overflow-safe: when the remaining dwell exceeds MAX_TIMER_MS, schedule
    // a capped timer whose callback re-evaluates how much genuine in-view time
    // has accumulated and re-arms if the threshold is not yet reached. This
    // prevents Number.MAX_SAFE_INTEGER (or any huge dwell) from overflowing to
    // ~immediate firing.
    const armTimer = () => {
      clearTimer();
      const remaining = dwell - accumulatedMs;
      if (remaining <= 0) {
        // Threshold already reached — but never start decay off-screen. This
        // path is only reached while in view (called from handleEnter), so
        // firing synchronously here is on-screen. Use a 0ms timer so the
        // "start synchronously in the timer callback" contract holds and
        // exit can still cancel it in the same tick.
        timer = setTimeout(startDecay, 0);
        return;
      }
      if (remaining > MAX_TIMER_MS) {
        // Cap the delay to avoid overflow. When the cap fires, re-evaluate:
        // add the elapsed in-view time since the last enter to accumulatedMs
        // and check whether the total dwell threshold is now reached.
        timer = setTimeout(() => {
          timer = null;
          if (done || destroyed || !inView) return;
          // Bank the time that has elapsed since we entered this in-view slice.
          const now = Date.now();
          const sliceSoFar = Math.max(0, now - enteredAt);
          accumulatedMs += sliceSoFar;
          // Reset the slice start to now so the next cap (or handleExit) does
          // not double-count what we just banked.
          enteredAt = now;
          // Re-arm: this will either schedule another capped timer or fire decay.
          armTimer();
        }, MAX_TIMER_MS);
        return;
      }
      timer = setTimeout(startDecay, remaining);
    };

    const handleEnter = () => {
      if (done) return;
      if (inView) return; // duplicate enter — never re-stamp the open slice
      inView = true;
      enteredAt = Date.now();
      armTimer();
    };

    const handleExit = () => {
      if (done) return;
      if (!inView) return; // exit-before-enter / duplicate exit — ignored
      inView = false;
      // Clock jumping backwards yields a negative slice — clamp to 0 so the
      // clock recovers exactly afterward.
      const slice = Math.max(0, Date.now() - enteredAt);
      accumulatedMs += slice;
      // Exit clears the pending timer — decay NEVER starts off-screen. If the
      // threshold was reached exactly at this exit banking, decay starts on
      // the NEXT enter (armTimer with remaining <= 0), not now.
      clearTimer();
    };

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        // Zombie invocations after unmount or decay start do nothing.
        if (destroyed || done) return;
        if (!entries) return;
        // Process entries strictly in order so a batched [enter, exit] or
        // [exit, enter] pair opens/closes its slice correctly.
        for (const entry of entries) {
          if (destroyed || done) return;
          if (!entry) continue;
          // A missing/non-true isIntersecting is an exit signal only if
          // currently in view — an entry missing the field must not open a
          // slice. `=== true` gates enters; anything else routes to exit
          // (which no-ops when not in view).
          if (entry.isIntersecting === true) {
            handleEnter();
          } else {
            handleExit();
          }
        }
      });
      observer.observe(root);
    }
    // Without IntersectionObserver there is no visibility signal — degrade to
    // never decaying (the text simply stays readable). Clean unmount via
    // cleanup below.

    return cleanup;
  });
</script>

<div
  bind:this={rootEl}
  class="decaying-quote"
  data-testid="decaying-quote"
  aria-label={ariaText}
  style="white-space: pre-wrap;"
>
  <span class="quote-text" style="white-space: pre-wrap;">{text}</span>
  {#if hasSource}
    <span class="quote-source" data-testid="quote-source">{source}</span>
  {/if}
</div>

<style>
  /* Declared as -global- so Svelte compiles it to the global name `decayFade`
     — inline-style animation names set via element.style are NOT rewritten by
     the scoper, so the keyframes must resolve globally. */
  @keyframes -global-decayFade {
    from { opacity: 1; visibility: visible; }
    to { opacity: 0; visibility: hidden; }
  }
  .decaying-quote:hover {
    animation-play-state: paused;
  }
  @media (prefers-reduced-motion: reduce) {
    .decaying-quote {
      animation: none;
      opacity: 1;
      visibility: visible;
    }
  }
  .quote-text {
    font-family: 'Source Serif 4', 'Newsreader', serif;
  }
  .quote-source {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.85em;
    display: block;
    margin-top: 0.5em;
    opacity: 0.7;
  }
</style>
