<script>
  import { untrack } from 'svelte';
  import DecayingQuote from './DecayingQuote.svelte';

  let { quotes = [], currentSection = 0, position = 'inline' } = $props();

  let posClass = $derived(position === 'margin' ? 'interruption-margin' : 'interruption-inline');

  let matching = $derived.by(() => {
    return (quotes || [])
      .filter(q => q && q.suggested_section === currentSection && q.text && q.text.trim().length > 0)
      .slice(0, 3);
  });

  function attribution(q) {
    return [q.source_file, q.date, q.model_version].filter(Boolean).join(' · ');
  }

  function prefersReducedMotion() {
    try {
      return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
      );
    } catch (e) {
      return false;
    }
  }

  const reducedMotion = prefersReducedMotion();

  // Highest staggered quote index that has been revealed (0 = none yet).
  let revealedThrough = $state(0);

  // Content key for the reveal cycle: the current section value plus the
  // texts of the matching quotes. The cycle must key on CONTENT, never on
  // the identity of the `matching` array — `matching` is rebuilt as a fresh
  // array whenever any upstream dependency pings, even when nothing the
  // reveal cycle cares about has changed (same-value section assignment,
  // cosmetic `position` flips, content-identical quote replacement).
  // A string derived is value-compared by Svelte, so equal recomputations
  // do not propagate to the effect below.
  let revealKey = $derived(
    JSON.stringify([currentSection, ...matching.map(q => q.text)])
  );

  // Non-reactive bookkeeping for the reveal cycle. Timers are managed
  // manually (not via the effect's teardown) so a spurious effect re-run
  // can never clear an in-flight stagger.
  let lastRevealKey = null;
  let revealTimers = [];

  function clearRevealTimers() {
    revealTimers.forEach(id => clearTimeout(id));
    revealTimers = [];
  }

  $effect(() => {
    // Sole reactive dependency: the content key.
    const key = revealKey;

    // Spurious invalidation (identical content): keep the existing timers
    // and revealed state — reveals stay on their original absolute clock.
    if (key === lastRevealKey) return;
    lastRevealKey = key;

    // Genuine content change or section switch: fresh cycle from now.
    clearRevealTimers();
    revealedThrough = 0;

    // Under reduced motion quotes are never hidden, so there is nothing to
    // reveal. With fewer than two matches there are no staggered quotes.
    // `matching` is read via untrack so its identity never becomes a
    // dependency of this effect; any count change also changes the key.
    const count = untrack(() => matching.length);
    if (reducedMotion || count < 2) return;

    revealTimers.push(setTimeout(() => { revealedThrough = 1; }, 2500));
    if (count >= 3) {
      revealTimers.push(setTimeout(() => { revealedThrough = 2; }, 5000));
    }
  });

  // Unmount-only cleanup: this effect reads no reactive state, so it runs
  // once and its teardown fires only when the component is destroyed.
  $effect(() => {
    return () => {
      clearRevealTimers();
    };
  });

  function isPending(i) {
    return !reducedMotion && i > 0 && i > revealedThrough;
  }

  function isRevealed(i) {
    return !reducedMotion && i > 0 && i <= revealedThrough;
  }

  function isDecaying(i) {
    return isRevealed(i) && i % 2 === 0;
  }
</script>

<div
  data-testid="interruption-engine"
  class="interruption-engine {posClass}"
>{#each matching as quote, i (i)}<div
    data-testid="interruption-quote-{i}"
    class="interruption-quote"
    class:pending={isPending(i)}
    class:revealed={isRevealed(i)}
    class:decaying={isDecaying(i)}
    aria-hidden={isPending(i) ? 'true' : undefined}
  >{#if i === 0}<DecayingQuote text={quote.text} decayDuration={12} />{:else}<span class="quote-text">{quote.text}</span>{/if}<div class="quote-attribution">{attribution(quote)}</div></div>{/each}</div>

<style>
  .interruption-engine {
    position: relative;
  }

  .interruption-inline {
    margin: 1.5rem 0;
  }

  .interruption-margin {
    position: absolute;
    right: -14rem;
    top: 0;
    width: 12rem;
  }

  @keyframes -global-decayFade {
    from { opacity: 1; visibility: visible; }
    to { opacity: 0; visibility: hidden; }
  }

  .interruption-engine :global(.interruption-quote) {
    margin-bottom: 1.25rem;
    padding: 0.75rem 1rem;
    border-left: 2px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.85);
  }

  /* Staggered quotes occupy layout from mount; hidden without display:none
     so revealing them causes zero layout shift. */
  .interruption-engine :global(.interruption-quote.pending) {
    opacity: 0;
    visibility: hidden;
  }

  .interruption-engine :global(.interruption-quote.revealed) {
    opacity: 1;
    visibility: visible;
    transition: opacity 0.6s ease, visibility 0.6s ease;
  }

  .interruption-engine :global(.interruption-quote.decaying) {
    animation: decayFade 12s ease-in forwards;
  }

  .interruption-engine :global(.interruption-quote .quote-text) {
    font-family: 'Source Serif 4', 'Newsreader', serif;
    font-style: italic;
    line-height: 1.5;
    display: block;
    white-space: pre-wrap;
  }

  .interruption-engine :global(.quote-attribution) {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.45);
    margin-top: 0.5rem;
  }

  @media (max-width: 1200px) {
    .interruption-margin {
      position: relative;
      right: auto;
      width: 100%;
      margin: 1.5rem 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .interruption-engine :global(.interruption-quote),
    .interruption-engine :global(.interruption-quote *) {
      animation: none !important;
      transition: none !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
  }
</style>
