<script>
  let { children, sectionId = 0, threshold = 0.3, onEnter = null, onExit = null } = $props();

  let container = $state(null);

  $effect(() => {
    if (!container) return;

    // Clamp threshold: NaN → 0.3, < 0 → 0, > 1 → 1
    let clampedThreshold = threshold;
    if (typeof clampedThreshold !== 'number' || Number.isNaN(clampedThreshold)) {
      clampedThreshold = 0.3;
    } else if (clampedThreshold < 0) {
      clampedThreshold = 0;
    } else if (clampedThreshold > 1) {
      clampedThreshold = 1;
    }

    // SSR / test environment fallback: no IntersectionObserver available
    if (typeof IntersectionObserver === 'undefined') {
      if (onEnter) {
        onEnter(sectionId);
      }
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (onEnter) {
              onEnter(sectionId);
            }
          } else {
            if (onExit) {
              onExit(sectionId);
            }
          }
        }
      },
      { threshold: clampedThreshold }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  });
</script>

<div bind:this={container} data-section-id={sectionId} data-testid="scroll-section-{sectionId}">
  {@render children?.()}
</div>
