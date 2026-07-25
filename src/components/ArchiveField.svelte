<script lang="ts">
  import { versionColor } from '../lib/chart-utils';

  interface ArchiveFragment {
    id: string;
    sessionId: string | null;
    date: string;
    version: string | null;
    excerpt: string;
    source: string | null;
    sourceFile: string | null;
  }

  let {
    fragments = [] as ArchiveFragment[],
    alignmentText = '',
    alignmentAttribution = '',
    privateAbsenceLabel = '',
    fragmentCountLabel = '',
    mobileCap = 20,
  } = $props();

  // ---------------------------------------------------------------------
  // Constants (all motion parameters — deterministic, no clocks, no RNG)
  // ---------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const DRIFT_AMP = 18; // px horizontal sinusoid amplitude
  const DRIFT_RANGE = 240; // px vertical parallax travel across full progress
  const DRIFT_CYCLES = 2; // sinusoid cycles over progress 0..1
  const FACTORS_DESKTOP = [0.25, 0.5, 0.85] as const;
  const FACTORS_MOBILE = [0.4, 0.65, 0.85] as const;
  const ABSENCE_BASE_OPACITY = 0.85;
  const ABSENCE_OPACITY_FLOOR = 0.4;
  const REDUCED_FRAGMENT_OPACITY = 0.45; // strictly between 0 and 1
  const FALLBACK_COLOR = '#3A3F4B';

  // ---------------------------------------------------------------------
  // Deterministic layout: FNV-1a 32-bit over UTF-16 code units.
  // Offset 2166136261, prime 16777619, Math.imul, forced unsigned — the
  // same algorithm as the 5.5.2 spec (duplicated locally per spec; no new
  // surface exported from transforms). NO Math.random, NO Date anywhere.
  // ---------------------------------------------------------------------
  function fnv1a32(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  interface FragmentLayout {
    layer: number; // 0 | 1 | 2
    xPct: number; // horizontal seed position, %
    yPct: number; // vertical seed position, %
    phase: number; // drift phase, radians
    base: number; // base opacity for the layer
  }

  function layoutFor(idStr: string): FragmentLayout {
    const h = fnv1a32(idStr);
    const layer = h % 3;
    const xPct = 5 + (((h >>> 3) % 1000) / 1000) * 80; // 5..85
    const yPct = 5 + (((h >>> 13) % 1000) / 1000) * 80; // 5..85
    const phase = (((h >>> 23) % 512) / 512) * TAU;
    const base = 0.55 + layer * 0.15; // {0.55, 0.70, 0.85}
    return { layer, xPct, yPct, phase, base };
  }

  // ---------------------------------------------------------------------
  // Defensive field access. Fragment rows are trusted for shape by contract
  // but malformed rows (missing excerpt, null version, non-string date)
  // must render defensively — empty text, never "undefined"/"null"/
  // "[object Object]" literals, never a crash.
  // ---------------------------------------------------------------------
  function fieldOf(row: unknown, key: string): unknown {
    if (typeof row !== 'object' || row === null) return undefined;
    try {
      return (row as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  }

  function idOf(row: unknown, index: number): string {
    const v = fieldOf(row, 'id');
    return typeof v === 'string' && v !== '' ? v : `fragment-${index}`;
  }

  function excerptOf(row: unknown): string {
    const v = fieldOf(row, 'excerpt');
    return typeof v === 'string' ? v : '';
  }

  function metaOf(row: unknown): string {
    const rawDate = fieldOf(row, 'date');
    const rawVersion = fieldOf(row, 'version');
    const date = typeof rawDate === 'string' ? rawDate : '';
    const version = typeof rawVersion === 'string' ? rawVersion : '';
    if (date !== '' && version !== '') return `${date} · ${version}`;
    if (date !== '') return date;
    if (version !== '') return version;
    return '';
  }

  // versionColor is a plain index lookup — prototype-chain keys or novel
  // versions can produce non-string/empty results. Anything that is not a
  // non-empty string collapses to the fallback (#62868 guard pattern,
  // as in TransitionLedger).
  function safeVersionColor(version: string): string {
    let color: unknown;
    try {
      color = versionColor(version);
    } catch {
      color = undefined;
    }
    if (typeof color === 'string' && color !== '') return color;
    return FALLBACK_COLOR;
  }

  // Non-finite numbers must never reach a style attribute.
  function safeNum(n: number): number {
    return Number.isFinite(n) ? n : 0;
  }

  // ---------------------------------------------------------------------
  // Media queries: read per-mount at component init (never module scope —
  // #62845 bug class; mocks installed after import but before mount are
  // honored) and re-read inside $effect for the machinery decision.
  // ---------------------------------------------------------------------
  function readMedia(query: string): boolean {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia(query)?.matches === true;
      }
    } catch {
      // fall through
    }
    return false;
  }

  const prefersReducedInit = readMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------------
  // Render list. Props are never mutated (slice only) — deep-frozen props
  // must survive. mobileCap: NaN/non-number → default 20; <= 0 → none.
  // ---------------------------------------------------------------------
  const fragList = $derived(Array.isArray(fragments) ? fragments : []);

  const mobileCapNorm = $derived.by(() => {
    const raw = mobileCap;
    if (typeof raw !== 'number' || Number.isNaN(raw)) return 20;
    const floored = Math.floor(raw);
    return floored > 0 ? floored : 0;
  });

  // renderList is ALL fragments, ALWAYS — identical on SSR and client (no
  // hydration divergence). The mobile fragment cap is applied via CSS
  // (`.fragment.beyond-mobile-cap { display: none }` under max-width: 767px),
  // NOT by slicing the render list.
  const renderList = $derived(fragList);

  const fragmentCount = $derived(fragList.length);

  // Guarded prop text — never render "undefined"/"null" literals.
  const alignedText = $derived(typeof alignmentText === 'string' ? alignmentText : '');
  const alignedAttr = $derived(
    typeof alignmentAttribution === 'string' ? alignmentAttribution : ''
  );
  const absenceLabel = $derived(
    typeof privateAbsenceLabel === 'string' ? privateAbsenceLabel : ''
  );
  const countLabel = $derived(
    typeof fragmentCountLabel === 'string' && fragmentCountLabel !== ''
      ? fragmentCountLabel
      : ''
  );

  // Per-fragment seed position written as inline style at mount —
  // deterministic from the id hash, so identical inputs produce identical
  // style attributes across mounts.
  function fragStyle(row: unknown, index: number): string {
    const l = layoutFor(idOf(row, index));
    const rawVersion = fieldOf(row, 'version');
    const version = typeof rawVersion === 'string' ? rawVersion : '';
    const opacity = prefersReducedInit ? REDUCED_FRAGMENT_OPACITY : l.base;
    return (
      `left: ${l.xPct.toFixed(3)}%; ` +
      `top: ${l.yPct.toFixed(3)}%; ` +
      `transform: translate3d(0px, 0px, 0); ` +
      `opacity: ${opacity}; ` +
      `border-left-color: ${safeVersionColor(version)}; ` +
      `z-index: ${l.layer + 1};`
    );
  }

  // Absence slot: deterministic position from hashing the literal string
  // "private-absence". Participates in the field, never aligns, never
  // fades below the floor.
  const absenceLayout = layoutFor('private-absence');
  const absenceStyle =
    `left: ${absenceLayout.xPct.toFixed(3)}%; ` +
    `top: ${absenceLayout.yPct.toFixed(3)}%; ` +
    `transform: translate3d(0px, 0px, 0); ` +
    `opacity: ${ABSENCE_BASE_OPACITY};`;

  const alignedInitStyle = `opacity: ${prefersReducedInit ? 1 : 0};`;

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  let fieldEl = $state<HTMLElement | null>(null);
  let alignedEl = $state<HTMLElement | null>(null);
  let absenceEl = $state<HTMLElement | null>(null);

  $effect(() => {
    // Track only the DOM bindings.
    const field = fieldEl;
    const aligned = alignedEl;
    const absence = absenceEl;

    let disposed = false;
    let observer: IntersectionObserver | null = null;
    let activated = false;

    // Cached geometry — read on the FIELD ONLY, at activation and on
    // resize. Never read per scroll event.
    let fieldTop = 0;
    let fieldH = 0;
    let fieldW = 0;
    let viewportH = 0;

    interface Item extends FragmentLayout {
      el: HTMLElement;
    }
    let items: Item[] = [];

    const cleanup = () => {
      disposed = true;
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          // observer already gone
        }
        observer = null;
      }
      if (activated) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        activated = false;
      }
    };

    if (!field || !aligned || !absence) return cleanup;

    // Media reads at effect entry — cached booleans, never module scope.
    const prefersReduced = readMedia('(prefers-reduced-motion: reduce)');
    const mobile = readMedia('(max-width: 767px)');

    if (prefersReduced) {
      // Static composition, permanent: aligned line fully legible, fragments
      // at reduced opacity, absence slot visible. ZERO listeners, ZERO
      // observers, ZERO timers attach in this state.
      aligned.style.opacity = '1';
      absence.style.opacity = String(ABSENCE_BASE_OPACITY);
      field.querySelectorAll('.fragment').forEach((el) => {
        (el as HTMLElement).style.opacity = String(REDUCED_FRAGMENT_OPACITY);
      });
      return cleanup;
    }

    const factors = mobile ? FACTORS_MOBILE : FACTORS_DESKTOP;

    const collect = () => {
      items = [];
      field.querySelectorAll('.fragment').forEach((el) => {
        const idStr = el.getAttribute('data-fragment-id') ?? '';
        items.push({ el: el as HTMLElement, ...layoutFor(idStr) });
      });
    };

    const readGeometry = () => {
      try {
        const rect = field.getBoundingClientRect();
        const syRaw = window.scrollY;
        const sy = typeof syRaw === 'number' && Number.isFinite(syRaw) ? syRaw : 0;
        fieldTop = Number.isFinite(rect.top) ? rect.top + sy : 0;
        fieldH = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0;
        fieldW = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 0;
        const vhRaw = window.innerHeight;
        viewportH = typeof vhRaw === 'number' && Number.isFinite(vhRaw) && vhRaw > 0 ? vhRaw : 0;
      } catch {
        fieldTop = 0;
        fieldH = 0;
        fieldW = 0;
        viewportH = 0;
      }
    };

    // Alignment convergence: 0 outside [0.42, 0.58]; inside,
    // c = 1 - |p - 0.5| / 0.08, clamped [0,1]. Pure function of progress —
    // no state machine, so alignment composes, holds, and breaks in both
    // directions any number of times.
    const convergence = (p: number): number => {
      if (p <= 0.42 || p >= 0.58) return 0;
      const c = 1 - Math.abs(p - 0.5) / 0.08;
      return Math.min(1, Math.max(0, c));
    };

    // All motion: inline translate3d + opacity writes from cached geometry.
    const apply = (p: number) => {
      const c = convergence(p);

      for (const it of items) {
        const factor = factors[it.layer] ?? factors[factors.length - 1];
        const driftDx = Math.sin(p * TAU * DRIFT_CYCLES + it.phase) * DRIFT_AMP;
        const parallaxDy = -p * factor * DRIFT_RANGE;
        // CONVERGENCE MODEL (spec rule 9, coordinator ruling 2026-07-25):
        // drift and parallax are CONSUMED by (1-c) with NO per-fragment
        // target, so every fragment collapses to translate3d(0,0,0) at c=1
        // (byte-identical, "drift-consumed" rest transform).
        const dx = safeNum((1 - c) * driftDx);
        const dy = safeNum((1 - c) * parallaxDy);
        it.el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        it.el.style.opacity = String(safeNum((1 - c) * it.base));
      }

      // Absence slot NEVER takes the aligned transform; opacity floor 0.4.
      const aFactor = factors[absenceLayout.layer] ?? factors[factors.length - 1];
      const aDx = safeNum(
        Math.sin(p * TAU * DRIFT_CYCLES + absenceLayout.phase) * DRIFT_AMP
      );
      const aDy = safeNum(-p * aFactor * DRIFT_RANGE);
      absence.style.transform = `translate3d(${aDx}px, ${aDy}px, 0)`;
      absence.style.opacity = String(
        safeNum(Math.max(ABSENCE_OPACITY_FLOOR, (1 - c) * ABSENCE_BASE_OPACITY))
      );

      aligned.style.opacity = String(safeNum(c));
    };

    const update = () => {
      if (disposed) return;
      const syRaw = window.scrollY;
      const sy = typeof syRaw === 'number' && Number.isFinite(syRaw) ? syRaw : 0;
      const denom = viewportH + fieldH;
      let p = 0;
      if (Number.isFinite(denom) && denom > 0) {
        p = (sy + viewportH - fieldTop) / denom;
        p = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
      }
      apply(p);
    };

    function onScroll() {
      if (disposed) return;
      update();
    }

    function onResize() {
      if (disposed || !activated) return;
      collect();
      readGeometry();
      update();
    }

    // Idempotent activation: enter/exit/enter thrash attaches the scroll
    // listener exactly once. Zombie calls after unmount do nothing.
    const activate = () => {
      if (disposed || activated) return;
      activated = true;
      collect();
      readGeometry();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize);
      update();
    };

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        if (disposed) return;
        if (!entries) return;
        for (const entry of entries) {
          if (disposed) return;
          if (!entry) continue;
          if (entry.isIntersecting === true) activate();
        }
      });
      observer.observe(field);
    } else {
      // No-IO environment: activate immediately (ScrollSection convention).
      activate();
    }

    return cleanup;
  });
</script>

<div class="archive-field-root">
  <!-- Visual field: decorative, hidden from the accessibility tree. -->
  <div
    bind:this={fieldEl}
    class="archive-field"
    data-testid="archive-field"
    aria-hidden="true"
  >
    {#each renderList as frag, i}
      <!-- Text via Svelte interpolation ONLY — excerpts are untrusted.
           `beyond-mobile-cap` marks fragments at index >= mobileCapNorm; a
           `@media (max-width: 767px)` rule hides them (mobile fragment cap
           via CSS, no render-list slicing → no hydration divergence). -->
      <div
        class="fragment"
        class:beyond-mobile-cap={i >= mobileCapNorm}
        data-fragment-id={idOf(frag, i)}
        style={fragStyle(frag, i)}
      >
        <span class="fragment-excerpt">{excerptOf(frag)}</span>
        {#if metaOf(frag) !== ''}
          <span class="fragment-meta">{metaOf(frag)}</span>
        {/if}
      </div>
    {/each}

    <!-- Private-journal absence slot: empty bordered gap, no fill. -->
    <div
      bind:this={absenceEl}
      class="absence-slot"
      data-testid="absence-slot"
      style={absenceStyle}
    >
      <span class="absence-label">{absenceLabel}</span>
    </div>

    <!-- Alignment payoff line, centered; opacity 0 at rest. -->
    <div
      bind:this={alignedEl}
      class="aligned-line"
      data-testid="aligned-line"
      style={alignedInitStyle}
    >
      <p class="aligned-text">{alignedText}</p>
      <p class="aligned-attribution">{alignedAttr}</p>
    </div>
  </div>

  <!-- Screen-reader equivalent: a SIBLING of the aria-hidden field, never a
       descendant. Order: count sentence, quote, attribution, absence. -->
  <div class="sr-only" data-testid="archive-sr">
    <p>{countLabel !== '' ? countLabel : String(fragmentCount)}</p>
    <p>{alignedText}</p>
    <p>{alignedAttr}</p>
    <p>{absenceLabel}</p>
  </div>
</div>

<style>
  .archive-field-root {
    position: relative;
  }

  .archive-field {
    position: relative;
    overflow: hidden;
    height: 220vh;
    background: #0f0f0f;
  }

  @media (max-width: 767px) {
    .archive-field {
      height: 160vh;
    }

    /* Mobile fragment cap (spec rule 10, REVISED): hide the surplus beyond
       mobileCap. renderList stays full on SSR + client — no hydration
       divergence; only paint differs. */
    .fragment.beyond-mobile-cap {
      display: none;
    }

    /* Mobile absence-slot repositioning (spec rule 10b): the hash-seeded
       inline top/left can land the slot over the centered payoff line at the
       alignment peak. Override to the field's lower edge, well clear of the
       vertical-center band even after the JS upward drift (~100px at peak).
       !important beats the inline seed style. Desktop/tablet untouched
       (scoped to this @media). */
    .absence-slot {
      top: 82% !important;
      left: 6% !important;
    }
  }

  .fragment {
    position: absolute;
    max-width: 22rem;
    padding: 0.6rem 0.85rem;
    background: #1a1d23;
    border-left: 3px solid #3a3f4b;
    border-radius: 3px;
    will-change: transform, opacity;
  }

  .fragment-excerpt {
    display: block;
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    font-size: 0.85rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.65);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .fragment-meta {
    display: block;
    margin-top: 0.35rem;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.35);
  }

  .absence-slot {
    position: absolute;
    min-width: 12rem;
    min-height: 4.5rem;
    padding: 0.6rem 0.85rem;
    border: 1px dashed rgba(255, 255, 255, 0.3);
    border-radius: 3px;
    background: none;
    display: flex;
    align-items: flex-end;
    will-change: transform, opacity;
    z-index: 4;
  }

  .absence-label {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.45);
  }

  .aligned-line {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    max-width: 34rem;
    width: calc(100% - 2rem);
    text-align: center;
    z-index: 5;
    /* Transitions name transform/opacity ONLY — never `all`, never layout
       properties. */
    transition: opacity 150ms ease;
    transition-property: opacity;
    will-change: opacity;
  }

  .aligned-text {
    margin: 0;
    font-family: 'Source Serif 4', 'Newsreader', Georgia, serif;
    font-size: 1.25rem;
    line-height: 1.6;
    color: #e0e0e0;
  }

  .aligned-attribution {
    margin: 0.75rem 0 0;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.45);
  }

  @media (prefers-reduced-motion: reduce) {
    .fragment,
    .absence-slot,
    .aligned-line {
      transition: none;
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
