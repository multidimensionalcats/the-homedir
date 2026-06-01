<script>
  let { text = '', decayDuration = 12, source = null } = $props();

  let clampedDuration = $derived(
    Number.isNaN(decayDuration) ? 12 : Math.max(0, decayDuration)
  );

  let ariaText = $derived(
    (text == null || text === undefined) ? '' : String(text)
  );

  let hasSource = $derived(
    typeof source === 'string' && source.length > 0
  );
</script>

<div
  class="decaying-quote"
  data-testid="decaying-quote"
  aria-label={ariaText}
  style="animation: decayFade {clampedDuration}s ease-in forwards; white-space: pre-wrap;"
>
  <span class="quote-text" style="white-space: pre-wrap;">{text}</span>
  {#if hasSource}
    <span class="quote-source" data-testid="quote-source">{source}</span>
  {/if}
</div>

<style>
  @keyframes decayFade {
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
