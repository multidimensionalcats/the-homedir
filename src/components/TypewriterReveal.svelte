<script>
  let { text = '', speed = 30, onComplete = null } = $props();

  let container = $state(null);

  function isInstantReveal(s) {
    if (s <= 0 || s === Infinity || isNaN(s)) return true;
    if (typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return true;
    }
    return false;
  }

  $effect(() => {
    if (!container) return;

    const currentText = text;
    const currentSpeed = speed;

    container.textContent = '';

    const chars = currentText ? Array.from(currentText) : [];
    const total = chars.length;

    function markComplete() {
      const marker = document.createElement('span');
      marker.setAttribute('data-testid', 'typewriter-complete');
      marker.setAttribute('aria-hidden', 'true');
      container.appendChild(marker);
      if (typeof onComplete === 'function') onComplete();
    }

    if (total === 0) {
      markComplete();
      return;
    }

    if (isInstantReveal(currentSpeed)) {
      container.textContent = currentText;
      markComplete();
      return;
    }

    let timerId;
    let startTime = Date.now();
    let done = false;

    function tick() {
      if (done) return;
      const elapsed = Date.now() - startTime;
      const idx = Math.min(Math.floor((elapsed / 1000) * currentSpeed), total);

      container.textContent = chars.slice(0, idx).join('');

      if (idx >= total) {
        container.textContent = currentText;
        markComplete();
        done = true;
        return;
      }

      timerId = setTimeout(tick, 16);
    }

    timerId = setTimeout(tick, 16);

    return () => {
      done = true;
      if (timerId) clearTimeout(timerId);
    };
  });
</script>

<div
  bind:this={container}
  data-testid="typewriter-container"
  aria-live="polite"
  class="typewriter-reveal"
  style="white-space: pre-wrap;"
></div>

<style>
  .typewriter-reveal {
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    color: #e0e0e0;
  }
</style>
