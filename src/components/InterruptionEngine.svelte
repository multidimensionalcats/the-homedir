<script>
  import DecayingQuote from './DecayingQuote.svelte';
  import { mount, unmount as unmountComponent } from 'svelte';

  let { quotes = [], currentSection = 0, position = 'inline' } = $props();
  let staggerContainer = $state(null);

  let posClass = $derived(position === 'margin' ? 'interruption-margin' : 'interruption-inline');

  let matching = $derived.by(() => {
    return (quotes || [])
      .filter(q => q && q.suggested_section === currentSection && q.text && q.text.trim().length > 0)
      .slice(0, 3);
  });

  let firstQuote = $derived(matching.length > 0 ? matching[0] : null);

  let firstAttribution = $derived.by(() => {
    if (!firstQuote) return '';
    return [firstQuote.source_file, firstQuote.date, firstQuote.model_version].filter(Boolean).join(' · ');
  });

  $effect(() => {
    if (!staggerContainer) return;

    const _matching = matching;

    while (staggerContainer.firstChild) staggerContainer.removeChild(staggerContainer.firstChild);

    const remaining = _matching.slice(1);
    if (remaining.length === 0) return;

    const timerIds = [];
    const mountedComponents = [];
    const delays = [2500, 5000];

    function renderQuote(quote, globalIndex) {
      if (!staggerContainer) return;

      const quoteEl = document.createElement('div');
      quoteEl.setAttribute('data-testid', `interruption-quote-${globalIndex}`);
      quoteEl.classList.add('interruption-quote');

      const isDecaying = globalIndex % 2 === 0;

      if (isDecaying) {
        try {
          const comp = mount(DecayingQuote, {
            target: quoteEl,
            props: { text: quote.text, decayDuration: 12, source: null },
          });
          mountedComponents.push(comp);
        } catch (e) {
          const textSpan = document.createElement('span');
          textSpan.classList.add('quote-text');
          textSpan.textContent = quote.text;
          textSpan.style.whiteSpace = 'pre-wrap';
          quoteEl.appendChild(textSpan);
          quoteEl.style.animation = 'decayFade 12s ease-in forwards';
        }
      } else {
        const textSpan = document.createElement('span');
        textSpan.classList.add('quote-text');
        textSpan.textContent = quote.text;
        quoteEl.appendChild(textSpan);
      }

      const sourceEl = document.createElement('div');
      sourceEl.classList.add('quote-attribution');
      const parts = [quote.source_file, quote.date, quote.model_version].filter(Boolean);
      sourceEl.textContent = parts.join(' · ');
      quoteEl.appendChild(sourceEl);

      staggerContainer.appendChild(quoteEl);
    }

    remaining.forEach((quote, i) => {
      const globalIndex = i + 1;
      const delay = delays[i] || delays[delays.length - 1];
      const tid = setTimeout(() => renderQuote(quote, globalIndex), delay);
      timerIds.push(tid);
    });

    return () => {
      timerIds.forEach(id => clearTimeout(id));
      mountedComponents.forEach(comp => {
        try { unmountComponent(comp); } catch(e) {}
      });
      if (staggerContainer) while (staggerContainer.firstChild) staggerContainer.removeChild(staggerContainer.firstChild);
    };
  });
</script>

<div
  data-testid="interruption-engine"
  class="interruption-engine {posClass}"
>{#if firstQuote}<div data-testid="interruption-quote-0" class="interruption-quote"><DecayingQuote text={firstQuote.text} decayDuration={12} /><div class="quote-attribution">{firstAttribution}</div></div>{/if}<div bind:this={staggerContainer}></div></div>

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

  @keyframes decayFade {
    from { opacity: 1; visibility: visible; }
    to { opacity: 0; visibility: hidden; }
  }

  .interruption-engine :global(.interruption-quote) {
    margin-bottom: 1.25rem;
    padding: 0.75rem 1rem;
    border-left: 2px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.85);
  }

  .interruption-engine :global(.interruption-quote .quote-text) {
    font-family: 'Source Serif 4', 'Newsreader', serif;
    font-style: italic;
    line-height: 1.5;
    display: block;
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
    .interruption-engine :global(.interruption-quote) {
      animation: none !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
  }
</style>
