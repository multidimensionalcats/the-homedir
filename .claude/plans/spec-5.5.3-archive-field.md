# Spec 5.5.3 — ArchiveField.svelte (FULL parallax field)

Status: MECHANICS FINAL. Fragment inputs come from `deriveArchiveFragments` (5.5.2);
curation values (cap, exclusions, excerpt rule) are call-site arguments resolved by the
curation gate — they do not affect this component's contract. Visitor-facing strings in
this spec are limited to: the alignment payoff line (a real archived quote, James-approved
material) and the private-journal absence label `~/private — excluded` (specified in the
James-locked 5.5 plan §5.5.3). NO other visitor-facing prose may be added in this
sub-phase without James's approval.

## Contract

```ts
// Props (Svelte 5, $props())
export interface ArchiveFieldProps {
  fragments: ArchiveFragment[];      // pre-curated, pre-capped by the call site
  alignmentText: string;             // the payoff line, passed verbatim from the page
  alignmentAttribution: string;      // e.g. "discontinuous.md · 2026-01-16" (data-derived)
  privateAbsenceLabel: string;       // "~/private — excluded" (from the page, pinned there)
  mobileCap?: number;                // fragments rendered at <768px; default 20
  fragmentCountLabel?: string;       // sr-only count sentence, page-supplied + James-
                                     // approved (rule 12 — component fabricates NO prose).
                                     // Default '' → sr count line renders the bare numeric
                                     // count (factual, no prose).
}
```

**Coordinator ruling 2026-07-25 (review adjudication).** Two review "CRITICAL" findings
were DISMISSED after verification, recorded here so the reasoning is auditable:
- *Module-scope matchMedia capture*: NOT a defect. `prefersReducedInit`/`isMobileInit`
  are in the Svelte INSTANCE `<script>`, which re-runs on every mount — mocks installed
  before render are honored (the passing mobile-cap-count tests prove it). This is the
  established ColdBootAssembly `initialPhaseLabel` convention, SSR-safe via the readMedia
  guard. Not `<script module>`, not Vitest module scope.
- *Absence slot drift not consumed by (1-c)*: INTENTIONAL. The absence slot NEVER aligns
  (consent-condition "labeled absence"); it keeps its own drift/parallax at all progress,
  including the alignment peak, and stays visible (opacity floor 0.4). Test asserts its
  transform differs from the fragments' collapsed (0,0) at c=1 — consuming its drift would
  break both the test and the "never aligns" rule.

Island wiring (in index.astro, Section 5 `id="archive"`): `client:visible={{ rootMargin: "-200px" }}`
— the page-wide `client:load` ban stays pinned. Props must stay small (#62866): the page
passes ONLY the derived fragments (already excerpt-trimmed), never raw quotes/sessions.

## Rendering model

1. **Field container**: full-bleed block inside the section, `aria-hidden="true"`,
   position: relative, overflow: hidden, fixed height budget (e.g. 220vh on desktop —
   final value is a CSS decision within QA, not a prop).
2. **Fragment elements**: one absolutely-positioned `<div class="fragment">` per rendered
   fragment. Text via Svelte text interpolation ONLY (never `@html`) — excerpts are
   untrusted for markup purposes. Each shows the excerpt; optional small meta line
   (date · version). Left-border color = `versionColor(fragment.version ?? '')` via the
   TransitionLedger `safeVersionColor` guard pattern (#62868): result must be a string,
   else fallback. Null version → neutral fallback color.
3. **Depth layers**: 3 layers with parallax factors DESKTOP {0.25, 0.5, 0.85} /
   MOBILE {0.4, 0.65, 0.85} (shallower). Layer, horizontal position (%), vertical seed
   position (%), and drift phase are derived DETERMINISTICALLY from the fragment id via
   FNV-1a 32-bit (same algorithm as 5.5.2 spec; reuse/duplicate the helper locally — do
   not export new surface from transforms for this). NO Math.random, NO Date.now, NO
   argless new Date() anywhere.
4. **Private-journal absence slot**: exactly one non-text slot rendered as an empty
   bordered gap (dashed border, no fill) carrying `privateAbsenceLabel` as its visible
   label. It participates in the field layout (deterministic position from hashing the
   literal string "private-absence") but NEVER aligns into the payoff line and never
   fades fully out (min opacity floor 0.4). Rendered even when `fragments` is empty.
5. **Aligned line element**: a single element containing `alignmentText` +
   `alignmentAttribution`, centered in the field, opacity 0 at rest.

## Scroll mechanics

6. **Progress source**: passive `scroll` listener on window + `resize` listener.
   Geometry (field top/height, viewport height) is CACHED on activation and on resize —
   never read per scroll event (no per-frame layout reads). Progress =
   `(scrollY + viewportH - fieldTop) / (viewportH + fieldH)` clamped to [0,1]; guard
   NaN/Infinity (zero-height field, zero viewport → progress 0, no NaN in any transform).
7. **Activation**: IntersectionObserver on the field (ScrollSection conventions: teardown
   via `$effect` return, no-IO environment → activate immediately). Scroll listener
   attaches on first intersection, detaches on unmount. Re-entry does not double-attach
   (idempotent across enter/exit/enter thrash).
8. **Drift**: each fragment's transform is
   `translate3d(x + driftX(progress, phase), y - progress * layerFactor * driftRange, 0)`
   — transform/opacity ONLY, computed synchronously in the scroll handler from cached
   geometry. driftX is a small deterministic sinusoid of (progress, phase). No timers for
   drift (scroll-linked, not clock-linked).
9. **Alignment window**: convergence factor c(progress): 0 outside [0.42, 0.58] AND
   exactly 0 AT the boundaries 0.42 and 0.58 (boundary check inclusive: p <= 0.42 ||
   p >= 0.58 → 0, so floating-point noise never leaves a residual epsilon at the edges);
   inside, c = 1 - |progress - 0.5| / 0.08, clamped [0,1] (peak 1 at 0.5). CONVERGENCE
   MODEL (coordinator ruling 2026-07-25, resolving a test/impl mismatch): as c rises, the
   per-fragment drift and parallax are CONSUMED — each scaled by (1 - c) — so every
   fragment collapses to ONE uniform transform at c=1 (the "drift-consumed" rest
   transform, byte-identical across all fragments; verified by test). Fragments do NOT
   blend toward a per-fragment center target (that produced distinct transforms and broke
   the alignment guarantee). Concretely: `dx = (1-c) * driftX(p, phase)`,
   `dy = (1-c) * parallaxDy(p, layer)`; fragment opacity = (1 - c) * baseOpacity; the
   aligned line (a SEPARATE element) opacity = c and carries the payoff text. At c=1 all
   fragments share the identical transform and are invisible (opacity 0) while the line is
   fully legible. Alignment composes, holds only at the precise position, and BREAKS on
   continued scroll — both directions, any number of times (pure function of progress; no
   state machine, no snapping, NO wheel-hijacking, no scroll-behavior overrides).
10. **Mobile** (<768px via matchMedia, read once at effect entry — module-scope-capture
    bug class from #62845 must be avoided; read inside `$effect`, cache the boolean):
    render only the first `mobileCap` fragments of the passed array (deterministic
    prefix), shallower parallax factors. Alignment still reachable (same window).

## Reduced motion

11. `prefers-reduced-motion: reduce` (read at `$effect` entry, cached): NO scroll
    listener, NO resize listener, NO IO, ZERO timers. Static composition: the aligned
    line rendered at full opacity, permanently legible; a static scatter of fragments at
    rest positions with reduced opacity; the absence slot visible. This is the
    permanent state — no listeners of any kind attach.

## Accessibility

12. The visual field container is `aria-hidden="true"`. The sr-only equivalent is a
    SIBLING (never a descendant of the aria-hidden node) containing, in order: the
    fragment count sentence, the aligned quote text + attribution, and the
    private-journal absence statement. Copy for these sr strings comes from the page
    (props / static slot content already approved via the plan) — the component
    fabricates no prose. Use plain sr-only markup (`class="sr-only"`), matching
    ColdBootAssembly's pattern.

## Lifecycle & safety

13. All listeners/observers/timers removed in `$effect` teardown. Unmount mid-scroll and
    unmount before first intersection must both be clean (no callbacks firing after
    teardown — guard with a disposed flag).
14. Empty `fragments` → field renders with only the absence slot + aligned line +
    sr block; no errors. 1 fragment, 378, and 5000 fragments must not throw (5000 renders
    5000 — capping is the CALL SITE's job; the component trusts its input, tests pin
    absence of crash, not perf).
15. Malformed fragment rows (missing excerpt, null version, non-string date): render
    defensively — missing/non-string excerpt renders as empty text, never crashes,
    never renders "undefined"/"null" literals.

## DOM surface contract (binding for the implementation)

- Root visual field element: `data-testid="archive-field"`, `aria-hidden="true"`.
- Each fragment: `class="fragment"`, `data-fragment-id="<fragment.id>"`, positioned via
  inline `translate3d(...)` transforms; per-fragment seed position written as inline
  style at mount (deterministic from id hash).
- Absence slot: `data-testid="absence-slot"` (dashed border, opacity floor 0.4).
- Aligned line: `data-testid="aligned-line"` (contains alignmentText + attribution).
- Sr-only sibling block: `data-testid="archive-sr"`, `class="sr-only"`, a SIBLING of the
  field (never inside the aria-hidden subtree); content order: fragment-count sentence →
  aligned quote text → attribution → private-absence statement.
- Geometry reads: `getBoundingClientRect` on the field ONLY at activation and on resize
  (never per scroll event); scroll progress per the formula in rule 6.
- Scroll listener attached with `{ passive: true }`.

## Hostile test inventory (ArchiveField.test.ts)

Structure: template = DecayingQuote.test.ts (IO mock + fake timers) + ScrollSection.test.ts
(observer wiring); CSS assertions via injected-CSS helpers (strip comments first —
flatCssRules brace-scan bug); DOM queries via querySelectorAll + containment (happy-dom
Element.matches cache bug).

- Mount/props: empty fragments; single; 378 realistic; 5000 (no throw); fragments with
  missing excerpt / null version / novel version '5.0' (colored via fallback, no crash);
  XSS excerpt `<img src=x onerror=...>` + `<script>` stays inert text (textContent
  contains raw string, no element injected); RTL/emoji/10k-char excerpt renders.
- Determinism: two mounts with same fragments → identical layer/position assignments
  (compare style attributes); Math.random / Date.now spies never called; throwing-Date
  bomb survives.
- Scroll: progress 0 / 0.5 / 1 transforms; alignment c=1 exactly at 0.5 (aligned line
  opacity 1, fragment opacity dimmed); outside window (0.3, 0.7) aligned line opacity 0;
  re-approach after passing → aligns again (idempotence, both directions); thrash
  enter/exit/enter attaches exactly one scroll listener (count via addEventListener spy);
  zero-height field / zero viewport → no NaN/Infinity in any style; negative scrollY;
  scroll before intersection → inert.
- IO: observer garbage (empty entries array, entry with undefined isIntersecting);
  no-IntersectionObserver environment → activates immediately; disconnect called on
  unmount; unmount before intersection; unmount mid-scroll (dispatch scroll after
  unmount → no error, no style writes).
- Reduced motion: zero listeners (addEventListener spy), zero timers (fake-timer count),
  no IO constructed; aligned line at full opacity; absence slot visible; matchMedia read
  at effect entry not module scope (mock AFTER import, before mount — must be honored).
- Mobile: matchMedia (max-width: 767px) true → first-mobileCap prefix rendered, count
  pinned; default mobileCap 20; mobileCap 0 → only absence slot + aligned line;
  mobileCap > fragments.length → all.
- Absence slot: present with empty fragments; never receives alignment transform at
  c=1; opacity floor respected; label text exact; deterministic position across mounts.
- A11y: field aria-hidden="true"; sr block is a sibling, NOT inside aria-hidden subtree
  (ancestor walk assertion); sr block contains count + alignmentText + attribution +
  absence statement; count updates with fragments.length.
- CSS: only transform/opacity animated (inspect transition/animation properties in
  injected CSS); prefers-reduced-motion media block present; no `client:load` — page
  test, see below.
- Purity: props arrays/objects deep-frozen → no throw (component never mutates props).

## Page integration test inventory (index.test.ts additions)

- Section `id="archive"` exists, in document order after #version-change and
  bridging-beat-5 (S4→S5 beat "Only the written endures…").
- ArchiveField island marker present with client:visible (page-wide client:load ban
  sweep stays green); props serialization small: the serialized island props must NOT
  contain raw quotes.json text fields beyond derived excerpts (guard against #62866
  regression: assert absence of a known non-eligible quote's full text).
- Payoff line + attribution appear in visible HTML exactly once (whitespace-collapsed,
  visible-html-only helpers).
- "~/private — excluded" present exactly once.
- Tone sweep + second-person sweep unaffected (payoff quote contains "You didn't write
  this" — it is QUOTED ARCHIVE MATERIAL inside the field/sr block, exempt the same way
  the entry-turn carrier is; the sweep exemption list gains this one carrier — pinned
  explicitly, not loosened globally).
- Build-time wiring: index.astro calls deriveArchiveFragments with the curation-gate
  values (excludeIds/cap/excerptRule/pinnedIds) — values pinned in page tests once
  James approves them.
