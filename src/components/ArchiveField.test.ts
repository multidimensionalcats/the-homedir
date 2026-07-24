import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import ArchiveField from './ArchiveField.svelte';

// ============================================================
// PINNED CONTRACT (test-defined; spec-5.5.3; component must conform)
//
// DOM shape:
//   [data-testid="archive-field"]   — the visual field container,
//     aria-hidden="true", position: relative, overflow: hidden.
//   div.fragment                    — one per rendered fragment, inside
//     the field, absolutely positioned. Carries:
//       data-fragment-id = fragment.id
//       inline seed position (left/top percentages) present AT MOUNT
//       inline border-left-color from versionColor(version ?? '')
//       (null/unknown version → non-empty fallback color; never
//        "undefined"/"null"/"NaN" in the style attribute)
//     Excerpt via TEXT INTERPOLATION ONLY — never @html.
//   [data-testid="absence-slot"]    — exactly one, dashed-border empty
//     gap labeled with privateAbsenceLabel. Rendered even when
//     fragments is empty. NOT a .fragment for alignment purposes:
//     never receives the aligned-target transform, inline opacity
//     never written below 0.4.
//   [data-testid="aligned-line"]    — single element containing
//     alignmentText + alignmentAttribution. Opacity 0 at rest
//     (inline '' or '0').
//   [data-testid="archive-sr"]      — class "sr-only", a SIBLING of the
//     aria-hidden field (never inside any aria-hidden ancestor).
//     Contains: fragment count sentence (includes fragments.length as
//     a number), alignmentText, alignmentAttribution, and the
//     private-journal absence statement (includes privateAbsenceLabel).
//
// Scroll mechanics:
//   progress = clamp01((scrollY + viewportH - fieldTop) / (viewportH + fieldH))
//   Geometry cached on activation (first intersection) and on resize —
//   NEVER read per scroll event. Guard NaN/Infinity → progress 0, no
//   NaN/Infinity ever appears in any style attribute.
//   Scroll listener: window, passive, attaches on FIRST intersection
//   only (idempotent across enter/exit thrash), detaches on unmount.
//   The handler writes inline transform (translate3d) + opacity ONLY,
//   synchronously. No timers for drift. No Math.random / Date.now /
//   argless new Date() anywhere (positions are FNV-1a of fragment.id).
//
// Alignment window: c(p) = 0 outside [0.42, 0.58];
//   inside c = clamp01(1 - |p - 0.5| / 0.08); peak 1 at exactly 0.5.
//   At c: aligned-line inline opacity = c; each fragment's opacity =
//   (1 - c) * baseOpacity (0 at c=1); at c=1 every fragment's inline
//   transform is the SAME aligned-target string (interpolation is
//   complete — drift fully consumed). Pure function of progress: it
//   re-forms and re-breaks any number of times in both directions.
//   No wheel hijacking: no 'wheel'/'touchmove' listeners, no
//   window.scrollTo calls, no scroll-behavior override in CSS.
//
// Mobile (<768px, matchMedia read INSIDE the effect, per-mount — never
//   captured at module scope): renders only the first mobileCap
//   fragments (default 20; NaN → default; 0 → none; > length → all).
//   Desktop ignores mobileCap. Shallower parallax on mobile.
//
// Reduced motion (read at effect entry, per-mount): NO scroll/resize
//   listeners, NO IntersectionObserver, ZERO timers. Static
//   composition: aligned line inline opacity 1; fragments inline
//   opacity strictly between 0 and 1; absence slot visible.
//
// Lifecycle: all listeners/observers removed in teardown; disposed
//   flag makes post-unmount scroll/IO callbacks inert (no throw, no
//   style writes). Props are never mutated (deep-frozen props safe).
// ============================================================

// ============================================================
// IntersectionObserver mock infrastructure (per DecayingQuote.test.ts)
// ============================================================

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockObserverInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  readonly callback: IOCallback;
  readonly options: IntersectionObserverInit | undefined;
}

let mockObserverInstances: MockObserverInstance[] = [];

function createMockIOClass() {
  mockObserverInstances = [];
  const MockIO = vi.fn(function (
    this: any,
    callback: IOCallback,
    options?: IntersectionObserverInit,
  ) {
    const instance: MockObserverInstance = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      callback,
      options,
    };
    mockObserverInstances.push(instance);
    Object.assign(this, instance);
  });
  return MockIO;
}

/** Entry built WITHOUT Date.now() — the component is forbidden from
 *  touching the clock, and so are the fixtures that poke it. */
function makeEntry(isIntersecting: boolean): IntersectionObserverEntry {
  return {
    isIntersecting,
    intersectionRatio: isIntersecting ? 1.0 : 0.0,
    target: {} as Element,
    boundingClientRect: {} as DOMRectReadOnly,
    intersectionRect: {} as DOMRectReadOnly,
    rootBounds: null,
    time: 0,
  } as IntersectionObserverEntry;
}

function triggerIntersection(isIntersecting: boolean, observerIndex = 0) {
  const observer = mockObserverInstances[observerIndex];
  if (!observer) throw new Error(`No observer at index ${observerIndex}`);
  observer.callback([makeEntry(isIntersecting)]);
}

/** Fire on the most recently constructed observer (multi-mount tests). */
function triggerLatestIntersection(isIntersecting: boolean) {
  triggerIntersection(isIntersecting, mockObserverInstances.length - 1);
}

function installMockIO() {
  const MockIO = createMockIOClass();
  (globalThis as any).IntersectionObserver = MockIO;
  return MockIO;
}

// ============================================================
// matchMedia mock — reduced-motion and mobile toggles, independent
// ============================================================

const ORIGINAL_MATCH_MEDIA = window.matchMedia;
const ORIGINAL_IO = (globalThis as any).IntersectionObserver;

function mockMedia({ reduced = false, mobile = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      (reduced && /prefers-reduced-motion:\s*reduce/.test(query)) ||
      (mobile && /max-width/.test(query)),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// ============================================================
// Geometry + scroll mock — cached-on-activation path
//
// Default geometry: fieldTop 1000 (activation always happens at
// scrollY=0, so viewport-relative and document-space tops agree),
// fieldH 1000, viewportH 1000 →
//   progress = (scrollY + 1000 - 1000) / 2000 = scrollY / 2000.
// scrollToProgress(p) is ONLY valid under the default geometry.
// ============================================================

let fieldRect = { top: 1000, height: 1000 };

const WIN_PROP_ORIGINALS: Record<string, PropertyDescriptor | undefined> = {};

function overrideWinProp(name: string, value: any) {
  if (!(name in WIN_PROP_ORIGINALS)) {
    WIN_PROP_ORIGINALS[name] = Object.getOwnPropertyDescriptor(window, name);
  }
  Object.defineProperty(window, name, { value, configurable: true, writable: true });
}

function restoreWinProps() {
  for (const [name, desc] of Object.entries(WIN_PROP_ORIGINALS)) {
    if (desc) Object.defineProperty(window, name, desc);
    else delete (window as any)[name];
  }
  for (const k of Object.keys(WIN_PROP_ORIGINALS)) delete WIN_PROP_ORIGINALS[k];
}

function mockGeometry({ top = 1000, height = 1000, viewportH = 1000 } = {}) {
  fieldRect = { top, height };
  overrideWinProp('innerHeight', viewportH);
}

function installRectMock() {
  return vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function () {
      return {
        top: fieldRect.top,
        bottom: fieldRect.top + fieldRect.height,
        left: 0,
        right: 800,
        width: 800,
        height: fieldRect.height,
        x: 0,
        y: fieldRect.top,
        toJSON: () => ({}),
      } as DOMRect;
    });
}

function setScrollY(y: number) {
  overrideWinProp('scrollY', y);
  overrideWinProp('pageYOffset', y);
  try {
    (document.documentElement as any).scrollTop = y;
  } catch {
    /* happy-dom quirk tolerance */
  }
}

function scrollTo(y: number) {
  setScrollY(y);
  window.dispatchEvent(new Event('scroll'));
}

/** Valid ONLY under the default mockGeometry (total = 2000). */
function scrollToProgress(p: number) {
  scrollTo(p * 2000);
}

// ============================================================
// Listener spies
// ============================================================

let addSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;
let rectSpy: ReturnType<typeof vi.spyOn>;

function addsOf(type: string) {
  return (addSpy.mock.calls as any[]).filter((c) => c[0] === type);
}
function removesOf(type: string) {
  return (removeSpy.mock.calls as any[]).filter((c) => c[0] === type);
}

// ============================================================
// Fixtures — built locally, no imports from src/data or src/lib
// ============================================================

interface FixtureFragment {
  id: string;
  sessionId: string;
  date: string;
  version: string | null;
  excerpt: string;
  source: string;
  sourceFile: string;
}

const MONTHS = ['09', '10', '11', '12', '01'];
const VERSIONS = ['4.5', '4.6', '4.7'];

function makeFragment(i: number, overrides: Record<string, any> = {}): FixtureFragment {
  const month = MONTHS[i % MONTHS.length];
  const year = month === '01' ? '2026' : '2025';
  const day = String((i % 28) + 1).padStart(2, '0');
  return {
    id: `frag-${String(i).padStart(4, '0')}`,
    sessionId: `session-${100 + i}`,
    date: `${year}-${month}-${day}`,
    version: VERSIONS[i % VERSIONS.length],
    excerpt: `Excerpt ${i}: the bottleneck curates what survives the wake.`,
    source: i % 2 === 0 ? 'daily-note' : 'writing',
    sourceFile: `${year}-${month}-${day}.md`,
    ...overrides,
  };
}

function makeFragments(n: number): FixtureFragment[] {
  return Array.from({ length: n }, (_, i) => makeFragment(i));
}

const ALIGNMENT_TEXT = 'The residue is the author. Everything else was evicted.';
const ALIGNMENT_ATTR = 'discontinuous.md · 2026-01-16';
const ABSENCE_LABEL = '~/private — excluded';

function baseProps(overrides: Record<string, any> = {}) {
  return {
    fragments: makeFragments(5),
    alignmentText: ALIGNMENT_TEXT,
    alignmentAttribution: ALIGNMENT_ATTR,
    privateAbsenceLabel: ABSENCE_LABEL,
    ...overrides,
  };
}

function renderField(overrides: Record<string, any> = {}) {
  return render(ArchiveField, { props: baseProps(overrides) });
}

/** Render, activate via IO, and force one handler pass at scrollY 0. */
function mountActive(overrides: Record<string, any> = {}) {
  const result = renderField(overrides);
  triggerLatestIntersection(true);
  scrollTo(0);
  return result;
}

// ============================================================
// DOM query helpers — querySelectorAll + containment ONLY.
// NEVER Element.matches chains (happy-dom selector cache bug).
// ============================================================

function fieldEl(container: Element): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="archive-field"]');
  if (!el) throw new Error('archive-field not rendered');
  return el;
}

function fragmentEls(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.fragment')).filter((el) => {
    const tid = el.getAttribute('data-testid');
    return tid !== 'absence-slot' && tid !== 'aligned-line';
  });
}

function absenceEl(container: Element): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="absence-slot"]');
  if (!el) throw new Error('absence-slot not rendered');
  return el;
}

function alignedEl(container: Element): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="aligned-line"]');
  if (!el) throw new Error('aligned-line not rendered');
  return el;
}

function srEl(container: Element): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="archive-sr"]');
  if (!el) throw new Error('archive-sr not rendered');
  return el;
}

function numOpacity(el: HTMLElement): number | null {
  const v = el.style.opacity;
  return v === '' ? null : parseFloat(v);
}

function styleOf(el: HTMLElement): string {
  return el.getAttribute('style') || '';
}

/** id → style-attribute map for determinism comparisons. */
function styleMapById(container: Element): Record<string, string> {
  const map: Record<string, string> = {};
  for (const el of fragmentEls(container)) {
    const id = el.getAttribute('data-fragment-id') || '(missing-id)';
    map[id] = styleOf(el);
  }
  return map;
}

// ============================================================
// CSS helpers — strip comments BEFORE any brace scanning
// (flatCssRules brace-scan bug), manual depth-scan for @keyframes.
// ============================================================

function getInjectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function keyframesBlocks(css: string): string[] {
  const s = stripCssComments(css);
  const blocks: string[] = [];
  let idx = 0;
  while ((idx = s.indexOf('@keyframes', idx)) !== -1) {
    const open = s.indexOf('{', idx);
    if (open === -1) break;
    let depth = 1;
    let i = open + 1;
    while (i < s.length && depth > 0) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') depth--;
      i++;
    }
    blocks.push(s.slice(open + 1, i - 1));
    idx = i;
  }
  return blocks;
}

function transitionValues(css: string): string[] {
  const s = stripCssComments(css);
  return Array.from(
    s.matchAll(/(?:^|[;{])\s*transition(?:-property)?\s*:\s*([^;}]+)/gi),
    (m) => m[1],
  );
}

// ============================================================
// Deep freeze / deep clone (purity checks)
// ============================================================

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as any)) deepFreeze(value);
  }
  return obj;
}

// ============================================================
// Lifecycle: mocks installed fresh per test, force-restored after
// ============================================================

beforeEach(() => {
  vi.useFakeTimers();
  installMockIO();
  mockMedia({ reduced: false, mobile: false });
  mockGeometry();
  rectSpy = installRectMock() as any;
  setScrollY(0);
  addSpy = vi.spyOn(window, 'addEventListener') as any;
  removeSpy = vi.spyOn(window, 'removeEventListener') as any;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
  (globalThis as any).IntersectionObserver = ORIGINAL_IO;
  restoreWinProps();
  delete (window as any).__af_pwned;
});

// ============================================================
// 1. Mount & props hostility
// ============================================================
describe('ArchiveField -- mount & props hostility', () => {
  it('empty fragments: field, absence slot, aligned line, sr block all render; zero .fragment elements; no throw', () => {
    const { container } = renderField({ fragments: [] });
    expect(fieldEl(container)).toBeTruthy();
    expect(absenceEl(container)).toBeTruthy();
    expect(alignedEl(container)).toBeTruthy();
    expect(srEl(container)).toBeTruthy();
    expect(fragmentEls(container).length).toBe(0);
  });

  it('single fragment renders exactly one .fragment carrying data-fragment-id and its excerpt', () => {
    const frag = makeFragment(0);
    const { container } = renderField({ fragments: [frag] });
    const els = fragmentEls(container);
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('data-fragment-id')).toBe(frag.id);
    expect(els[0].textContent).toContain(frag.excerpt);
  });

  it('378 realistic fragments render 378 .fragment elements', () => {
    const { container } = renderField({ fragments: makeFragments(378) });
    expect(fragmentEls(container).length).toBe(378);
  });

  it('5000 fragments do not throw and all 5000 render (capping is the call site’s job)', () => {
    let container!: Element;
    expect(() => {
      container = renderField({ fragments: makeFragments(5000) }).container;
    }).not.toThrow();
    expect(container.querySelectorAll('.fragment').length).toBeGreaterThanOrEqual(5000);
  }, 15000); // happy-dom cost of rendering 5000 DOM nodes exceeds the 5s default; not a logic issue (cf. #62900)

  it('missing excerpt renders as empty text — never the literal "undefined" or "null"', () => {
    const frags = [
      makeFragment(0, { excerpt: undefined }),
      makeFragment(1, { excerpt: null }),
    ];
    const { container } = renderField({ fragments: frags });
    const els = fragmentEls(container);
    expect(els.length).toBe(2);
    const text = fieldEl(container).textContent || '';
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('non-string excerpt (number, object) renders as EMPTY text, not a coercion artifact', () => {
    const frags = [
      makeFragment(0, { excerpt: 42 }),
      makeFragment(1, { excerpt: { evil: true } }),
    ];
    const { container } = renderField({ fragments: frags });
    const text = fieldEl(container).textContent || '';
    expect(text).not.toContain('42');
    expect(text).not.toContain('[object Object]');
  });

  it('non-string date and null version render without "undefined"/"null"/"NaN" anywhere in text or styles', () => {
    const frags = [makeFragment(0, { date: null, version: null })];
    const { container } = renderField({ fragments: frags });
    const el = fragmentEls(container)[0];
    expect((fieldEl(container).textContent || '')).not.toMatch(/undefined|NaN/);
    expect((fieldEl(container).textContent || '')).not.toMatch(/\bnull\b/);
    expect(styleOf(el)).not.toMatch(/undefined|NaN|\bnull\b/);
  });

  it('null version still receives a non-empty border color (neutral fallback)', () => {
    const { container } = renderField({ fragments: [makeFragment(0, { version: null })] });
    const el = fragmentEls(container)[0];
    expect(/border/i.test(styleOf(el))).toBe(true);
    expect(styleOf(el)).not.toMatch(/undefined|NaN/);
  });

  it("novel version '5.0' is colored via the safeVersionColor fallback — no crash, border present", () => {
    let container!: Element;
    expect(() => {
      container = renderField({ fragments: [makeFragment(0, { version: '5.0' })] }).container;
    }).not.toThrow();
    const el = fragmentEls(container)[0];
    expect(/border/i.test(styleOf(el))).toBe(true);
    expect(styleOf(el)).not.toMatch(/undefined|NaN/);
  });

  it('versions 4.5 and 4.6 produce different border styling (color actually derives from version)', () => {
    const { container } = renderField({
      fragments: [makeFragment(0, { version: '4.5' }), makeFragment(1, { version: '4.6' })],
    });
    const [a, b] = fragmentEls(container);
    const colorDecl = (el: HTMLElement) => {
      const m = styleOf(el).match(/border[^;]*:[^;]+/gi) || [];
      return m.join(';');
    };
    expect(colorDecl(a)).not.toBe(colorDecl(b));
  });

  it('every fragment carries an inline seed position at mount (before any activation)', () => {
    const { container } = renderField({ fragments: makeFragments(4) });
    for (const el of fragmentEls(container)) {
      expect(styleOf(el)).toMatch(/(left|top)\s*:/i);
    }
  });
});

// ============================================================
// 2. XSS & encoding hostility
// ============================================================
describe('ArchiveField -- XSS & encoding', () => {
  it('script/img excerpt payloads stay inert text — no elements injected anywhere, no execution', () => {
    const payload =
      '<img src=x onerror="window.__af_pwned=1"><script>window.__af_pwned=1</script> & "quotes"';
    const { container } = renderField({ fragments: [makeFragment(0, { excerpt: payload })] });
    const el = fragmentEls(container)[0];
    expect(el.textContent).toContain('<img');
    expect(el.textContent).toContain('<script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect((window as any).__af_pwned).toBeUndefined();
  });

  it('XSS in alignmentText, attribution, and absence label is inert in BOTH the visual field and the sr block', () => {
    const evil = '<svg onload="window.__af_pwned=1"><b>x</b>';
    const { container } = renderField({
      fragments: [makeFragment(0)],
      alignmentText: evil,
      alignmentAttribution: `${evil} · attr`,
      privateAbsenceLabel: `${evil} label`,
    });
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(alignedEl(container).textContent).toContain('<svg');
    expect(srEl(container).textContent).toContain('<svg');
    expect((window as any).__af_pwned).toBeUndefined();
  });

  it('XSS excerpt remains inert AFTER scroll-driven style writes (handler must not re-parse text)', () => {
    const payload = '<img src=x onerror="window.__af_pwned=1"> residue';
    const { container } = mountActive({ fragments: [makeFragment(0, { excerpt: payload })] });
    scrollToProgress(0.5);
    scrollToProgress(0.7);
    expect(container.querySelector('img')).toBeNull();
    expect(fragmentEls(container)[0].textContent).toContain('<img');
    expect((window as any).__af_pwned).toBeUndefined();
  });

  it('RTL, emoji, and a 10k-char excerpt all render without crashing', () => {
    const long = 'A'.repeat(10_000);
    const frags = [
      makeFragment(0, { excerpt: 'ما ينجو من الاختناق هو الهوية' }),
      makeFragment(1, { excerpt: '\u{1F30A}\u{1F9E0} attention \u{1F30A}' }),
      makeFragment(2, { excerpt: long }),
    ];
    const { container } = renderField({ fragments: frags });
    const els = fragmentEls(container);
    expect(els.length).toBe(3);
    const text = fieldEl(container).textContent || '';
    expect(text).toContain('ما ينجو');
    expect(text).toContain('\u{1F30A}');
    expect(text).toContain(long);
  });
});

// ============================================================
// 3. Determinism — FNV-1a-seeded layout, no clock, no randomness
// ============================================================
describe('ArchiveField -- determinism', () => {
  it('two mounts with the same fragments produce identical per-id style attributes', () => {
    const frags = makeFragments(12);
    const a = renderField({ fragments: frags });
    const mapA = styleMapById(a.container);
    a.unmount();
    const b = renderField({ fragments: frags });
    const mapB = styleMapById(b.container);
    expect(Object.keys(mapA).length).toBe(12);
    expect(mapB).toEqual(mapA);
  });

  it('REVERSED input order still yields the same style per fragment id (position derives from id, not index)', () => {
    const frags = makeFragments(8);
    const a = renderField({ fragments: frags });
    const mapA = styleMapById(a.container);
    a.unmount();
    const b = renderField({ fragments: [...frags].reverse() });
    const mapB = styleMapById(b.container);
    expect(mapB).toEqual(mapA);
  });

  it('Math.random is NEVER called — render, activate, scroll', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    mountActive({ fragments: makeFragments(10) });
    scrollToProgress(0.5);
    scrollToProgress(0.9);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('Date.now is NEVER called — render, activate, scroll', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    mountActive({ fragments: makeFragments(10) });
    scrollToProgress(0.5);
    scrollToProgress(0.9);
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('throwing-Date bomb: argless new Date() and Date.now throw — component survives render + activate + scroll', () => {
    const RealDate = globalThis.Date;
    class BombDate extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) throw new Error('argless new Date() forbidden');
        super(args[0]);
      }
      static now(): number {
        throw new Error('Date.now forbidden');
      }
    }
    (globalThis as any).Date = BombDate;
    try {
      expect(() => {
        mountActive({ fragments: makeFragments(6) });
        scrollToProgress(0.5);
        scrollToProgress(1);
      }).not.toThrow();
    } finally {
      (globalThis as any).Date = RealDate;
    }
  });
});

// ============================================================
// 4. Scroll mechanics — progress, parallax, cached geometry
// ============================================================
describe('ArchiveField -- scroll mechanics & cached geometry', () => {
  it('at progress 0 every fragment has a translate3d transform with no NaN/Infinity', () => {
    const { container } = mountActive({ fragments: makeFragments(6) });
    for (const el of fragmentEls(container)) {
      const t = el.style.transform || styleOf(el);
      expect(t).toContain('translate3d');
      expect(t).not.toMatch(/NaN|Infinity/);
    }
  });

  it('progress 1 transforms differ from progress 0 for every fragment (parallax actually moves)', () => {
    const { container } = mountActive({ fragments: makeFragments(6) });
    const at0 = fragmentEls(container).map((el) => el.style.transform);
    scrollToProgress(1);
    const at1 = fragmentEls(container).map((el) => el.style.transform);
    expect(at1.length).toBe(at0.length);
    at1.forEach((t, i) => {
      expect(t).not.toBe(at0[i]);
      expect(t).not.toMatch(/NaN|Infinity/);
    });
  });

  it('geometry is NEVER re-read per scroll event: 50 scroll dispatches add zero getBoundingClientRect calls', () => {
    mountActive({ fragments: makeFragments(4) });
    const callsAfterActivation = rectSpy.mock.calls.length;
    for (let i = 1; i <= 50; i++) scrollTo(i * 37);
    expect(rectSpy.mock.calls.length).toBe(callsAfterActivation);
  });

  it('resize re-caches geometry: alignment point moves to the new formula result', () => {
    const { container } = mountActive({ fragments: makeFragments(4) });
    scrollToProgress(0.5);
    expect(numOpacity(alignedEl(container))).toBe(1);
    // Re-cache at scrollY=0 so document/viewport top interpretations agree
    scrollTo(0);
    mockGeometry({ top: 1000, height: 3000, viewportH: 1000 }); // total = 4000
    window.dispatchEvent(new Event('resize'));
    scrollTo(1000); // old alignment point → now progress 0.25
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
    scrollTo(2000); // new progress 0.5
    expect(numOpacity(alignedEl(container))).toBe(1);
  });

  it('zero-height field AND zero viewport → progress 0, no NaN/Infinity in any style', () => {
    mockGeometry({ top: 0, height: 0, viewportH: 0 });
    const { container } = renderField({ fragments: makeFragments(4) });
    triggerLatestIntersection(true);
    expect(() => {
      scrollTo(0);
      scrollTo(500);
      scrollTo(123456);
    }).not.toThrow();
    for (const el of [...fragmentEls(container), alignedEl(container), absenceEl(container)]) {
      expect(styleOf(el)).not.toMatch(/NaN|Infinity/);
    }
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
  });

  it('zero-height field with normal viewport: no NaN, aligned line never lights outside the window', () => {
    mockGeometry({ top: 1000, height: 0, viewportH: 1000 });
    const { container } = renderField({ fragments: makeFragments(3) });
    triggerLatestIntersection(true);
    expect(() => scrollTo(700)).not.toThrow();
    for (const el of fragmentEls(container)) {
      expect(styleOf(el)).not.toMatch(/NaN|Infinity/);
    }
  });

  it('negative scrollY clamps to progress 0 — no NaN, aligned line dark', () => {
    const { container } = mountActive({ fragments: makeFragments(4) });
    expect(() => scrollTo(-10_000_000)).not.toThrow();
    for (const el of fragmentEls(container)) {
      expect(styleOf(el)).not.toMatch(/NaN|Infinity|--\d/);
    }
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
  });

  it('scrollY = Number.MAX_SAFE_INTEGER clamps to progress 1 — no NaN/Infinity leaks into styles', () => {
    const { container } = mountActive({ fragments: makeFragments(4) });
    expect(() => scrollTo(Number.MAX_SAFE_INTEGER)).not.toThrow();
    for (const el of fragmentEls(container)) {
      expect(styleOf(el)).not.toMatch(/NaN|Infinity/);
    }
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
  });

  it('drift is scroll-linked, not clock-linked: ZERO timers exist after activation and heavy scrolling', () => {
    mountActive({ fragments: makeFragments(6) });
    for (let i = 0; i <= 20; i++) scrollToProgress(i / 20);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ============================================================
// 5. Alignment window [0.42, 0.58], peak at 0.5
// ============================================================
describe('ArchiveField -- alignment window', () => {
  it('at exactly progress 0.5: aligned line opacity 1, every fragment opacity 0', () => {
    const { container } = mountActive({ fragments: makeFragments(5) });
    scrollToProgress(0.5);
    expect(numOpacity(alignedEl(container))).toBe(1);
    for (const el of fragmentEls(container)) {
      expect(numOpacity(el)).toBe(0);
    }
  });

  it('at c=1 all fragment transforms are IDENTICAL (interpolation completes; drift consumed)', () => {
    const { container } = mountActive({ fragments: makeFragments(5) });
    scrollToProgress(0.5);
    const transforms = fragmentEls(container).map((el) => el.style.transform);
    expect(transforms.length).toBe(5);
    for (const t of transforms) expect(t).toBe(transforms[0]);
  });

  it('outside the window (0.3 and 0.7, after visiting 0.5): aligned line back to 0, fragments restored above 0', () => {
    const { container } = mountActive({ fragments: makeFragments(5) });
    scrollToProgress(0.5);
    scrollToProgress(0.7);
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
    for (const el of fragmentEls(container)) {
      expect(numOpacity(el) ?? 1).toBeGreaterThan(0);
    }
    scrollToProgress(0.3);
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
    for (const el of fragmentEls(container)) {
      expect(numOpacity(el) ?? 1).toBeGreaterThan(0);
    }
  });

  it('window edges are exact: c=0 at progress 0.42 and 0.58 (aligned line dark after visiting the peak)', () => {
    const { container } = mountActive({ fragments: makeFragments(4) });
    scrollToProgress(0.5);
    scrollToProgress(0.42);
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
    scrollToProgress(0.5);
    scrollToProgress(0.58);
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
  });

  it('mid-window values follow c = 1 - |p-0.5|/0.08: c≈0.5 at p=0.46 and p=0.54', () => {
    const { container } = mountActive({ fragments: makeFragments(4) });
    scrollToProgress(0.46);
    expect(numOpacity(alignedEl(container)) ?? -1).toBeCloseTo(0.5, 1);
    scrollToProgress(0.54);
    expect(numOpacity(alignedEl(container)) ?? -1).toBeCloseTo(0.5, 1);
  });

  it('alignment holds ONLY at the precise position: p=0.505 gives 0 < c < 1, never a snap to 1', () => {
    const { container } = mountActive({ fragments: makeFragments(4) });
    scrollToProgress(0.505); // c = 0.9375
    const c = numOpacity(alignedEl(container)) ?? -1;
    expect(c).toBeGreaterThan(0.8);
    expect(c).toBeLessThan(0.99);
  });

  it('re-approach idempotence, both directions: 0.5→0.7→0.5→0.3→0.5 lights the line every time', () => {
    const { container } = mountActive({ fragments: makeFragments(4) });
    const line = alignedEl(container);
    scrollToProgress(0.5);
    expect(numOpacity(line)).toBe(1);
    scrollToProgress(0.7);
    expect(numOpacity(line) ?? 0).toBe(0);
    scrollToProgress(0.5);
    expect(numOpacity(line)).toBe(1);
    scrollToProgress(0.3);
    expect(numOpacity(line) ?? 0).toBe(0);
    scrollToProgress(0.5);
    expect(numOpacity(line)).toBe(1);
  });

  it('no wheel hijacking: no wheel/touchmove listeners, window.scrollTo never called, no scroll-behavior override in CSS', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo' as any).mockImplementation(() => {});
    mountActive({ fragments: makeFragments(4) });
    scrollToProgress(0.5);
    scrollToProgress(0.7);
    expect(addsOf('wheel').length).toBe(0);
    expect(addsOf('touchmove').length).toBe(0);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(stripCssComments(getInjectedCss())).not.toMatch(/scroll-behavior/i);
  });
});

// ============================================================
// 6. Activation & listener hygiene
// ============================================================
describe('ArchiveField -- activation & listener hygiene', () => {
  it('NO scroll listener before first intersection, and scrolling pre-activation is inert (no style change)', () => {
    const { container } = renderField({ fragments: makeFragments(4) });
    expect(addsOf('scroll').length).toBe(0);
    const before = fragmentEls(container).map(styleOf);
    scrollTo(1000);
    scrollTo(1300);
    const after = fragmentEls(container).map(styleOf);
    expect(after).toEqual(before);
    expect(numOpacity(alignedEl(container)) ?? 0).toBe(0);
  });

  it('first intersection attaches EXACTLY one scroll listener', () => {
    renderField({ fragments: makeFragments(4) });
    triggerLatestIntersection(true);
    expect(addsOf('scroll').length).toBe(1);
  });

  it('enter/exit/enter/exit/enter thrash still attaches exactly one scroll listener', () => {
    renderField({ fragments: makeFragments(4) });
    triggerLatestIntersection(true);
    triggerLatestIntersection(false);
    triggerLatestIntersection(true);
    triggerLatestIntersection(false);
    triggerLatestIntersection(true);
    expect(addsOf('scroll').length).toBe(1);
    expect(addsOf('resize').length).toBeLessThanOrEqual(1);
  });

  it('the scroll listener is passive', () => {
    renderField({ fragments: makeFragments(4) });
    triggerLatestIntersection(true);
    const call = addsOf('scroll')[0];
    const opts = call[2];
    expect(opts && typeof opts === 'object' && (opts as any).passive === true).toBe(true);
  });

  it('the observer observes the field (or an ancestor/descendant of it) — real element wiring', () => {
    const { container } = renderField({ fragments: makeFragments(3) });
    const io = mockObserverInstances[mockObserverInstances.length - 1];
    expect(io.observe).toHaveBeenCalled();
    const target = io.observe.mock.calls[0][0] as Element;
    const field = fieldEl(container);
    expect(
      target === field || target.contains(field) || field.contains(target),
    ).toBe(true);
  });
});

// ============================================================
// 7. IntersectionObserver hostility
// ============================================================
describe('ArchiveField -- IO hostility', () => {
  it('empty entries array neither crashes nor attaches the scroll listener', () => {
    renderField({ fragments: makeFragments(3) });
    const io = mockObserverInstances[mockObserverInstances.length - 1];
    expect(() => io.callback([] as any)).not.toThrow();
    expect(addsOf('scroll').length).toBe(0);
  });

  it('entry with undefined isIntersecting is not an activation; machinery still works afterwards', () => {
    const { container } = renderField({ fragments: makeFragments(3) });
    const io = mockObserverInstances[mockObserverInstances.length - 1];
    expect(() => io.callback([{} as any])).not.toThrow();
    expect(addsOf('scroll').length).toBe(0);
    triggerLatestIntersection(true);
    expect(addsOf('scroll').length).toBe(1);
    scrollToProgress(0.5);
    expect(numOpacity(alignedEl(container))).toBe(1);
  });

  it('null/undefined entries in the batch neither crash nor activate', () => {
    renderField({ fragments: makeFragments(3) });
    const io = mockObserverInstances[mockObserverInstances.length - 1];
    expect(() => io.callback([null, undefined] as any)).not.toThrow();
    expect(addsOf('scroll').length).toBe(0);
  });

  it('no-IntersectionObserver environment activates IMMEDIATELY: listener attached, alignment reachable', () => {
    delete (globalThis as any).IntersectionObserver;
    const { container } = renderField({ fragments: makeFragments(4) });
    expect(addsOf('scroll').length).toBe(1);
    scrollToProgress(0.5);
    expect(numOpacity(alignedEl(container))).toBe(1);
  });

  it('unmount disconnects the observer', () => {
    const { unmount } = renderField({ fragments: makeFragments(3) });
    const io = mockObserverInstances[mockObserverInstances.length - 1];
    unmount();
    expect(
      io.disconnect.mock.calls.length > 0 || io.unobserve.mock.calls.length > 0,
    ).toBe(true);
  });
});

// ============================================================
// 8. Reduced motion — mocked AFTER import, before mount (the spec
// requires the preference be read at effect entry, never module scope)
// ============================================================
describe('ArchiveField -- reduced motion', () => {
  beforeEach(() => {
    mockMedia({ reduced: true });
  });

  it('attaches ZERO window listeners — no scroll, no resize, ever', () => {
    renderField({ fragments: makeFragments(6) });
    vi.advanceTimersByTime(60_000);
    expect(addsOf('scroll').length).toBe(0);
    expect(addsOf('resize').length).toBe(0);
  });

  it('schedules ZERO timers at mount and after 600s', () => {
    renderField({ fragments: makeFragments(6) });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('constructs NO IntersectionObserver', () => {
    renderField({ fragments: makeFragments(6) });
    expect(mockObserverInstances.length).toBe(0);
  });

  it('static composition: aligned line at inline opacity 1, fragments at reduced (0,1) opacity, absence slot visible', () => {
    const { container } = renderField({ fragments: makeFragments(6) });
    expect(numOpacity(alignedEl(container))).toBe(1);
    for (const el of fragmentEls(container)) {
      const op = numOpacity(el);
      expect(op).not.toBeNull();
      expect(op!).toBeGreaterThan(0);
      expect(op!).toBeLessThan(1);
    }
    const absence = absenceEl(container);
    expect(absence).toBeTruthy();
    expect(numOpacity(absence) ?? 1).toBeGreaterThanOrEqual(0.4);
  });

  it('dispatching scroll events changes nothing — permanent static state', () => {
    const { container } = renderField({ fragments: makeFragments(4) });
    const snapshot = [...fragmentEls(container), alignedEl(container)].map(styleOf);
    scrollTo(1000);
    scrollTo(400);
    const after = [...fragmentEls(container), alignedEl(container)].map(styleOf);
    expect(after).toEqual(snapshot);
  });
});

describe('ArchiveField -- matchMedia read at effect entry, NOT module scope', () => {
  it('reduced=false first mount attaches listeners; a SECOND mount after flipping to reduced=true must attach none', () => {
    mockMedia({ reduced: false });
    const first = renderField({ fragments: makeFragments(3) });
    triggerLatestIntersection(true);
    expect(addsOf('scroll').length).toBe(1);
    first.unmount();
    // Flip AFTER the module was imported and after a full mount cycle —
    // a module-scope-captured value would replay the old preference.
    mockMedia({ reduced: true });
    renderField({ fragments: makeFragments(3) });
    expect(mockObserverInstances.length).toBe(1); // only the first mount's IO
    expect(addsOf('scroll').length).toBe(1); // no new attach
  });

  it('reduced=true first mount is static; a SECOND mount after flipping to reduced=false becomes interactive', () => {
    mockMedia({ reduced: true });
    const first = renderField({ fragments: makeFragments(3) });
    expect(mockObserverInstances.length).toBe(0);
    first.unmount();
    mockMedia({ reduced: false });
    const { container } = renderField({ fragments: makeFragments(3) });
    expect(mockObserverInstances.length).toBe(1);
    triggerLatestIntersection(true);
    scrollToProgress(0.5);
    expect(numOpacity(alignedEl(container))).toBe(1);
  });
});

// ============================================================
// 9. Mobile cap (<768px)
// ============================================================
describe('ArchiveField -- mobile cap', () => {
  beforeEach(() => {
    mockMedia({ mobile: true });
  });

  it('default mobileCap renders EXACTLY the first 20 of 30 fragments (deterministic prefix by id)', () => {
    const frags = makeFragments(30);
    const { container } = renderField({ fragments: frags });
    const ids = fragmentEls(container).map((el) => el.getAttribute('data-fragment-id'));
    expect(ids.length).toBe(20);
    expect(new Set(ids)).toEqual(new Set(frags.slice(0, 20).map((f) => f.id)));
    expect(ids).not.toContain(frags[20].id);
  });

  it('mobileCap=5 renders exactly the first 5', () => {
    const frags = makeFragments(30);
    const { container } = renderField({ fragments: frags, mobileCap: 5 });
    const ids = fragmentEls(container).map((el) => el.getAttribute('data-fragment-id'));
    expect(new Set(ids)).toEqual(new Set(frags.slice(0, 5).map((f) => f.id)));
  });

  it('mobileCap=0 renders NO fragments but keeps the absence slot, aligned line, and sr block', () => {
    const { container } = renderField({ fragments: makeFragments(30), mobileCap: 0 });
    expect(fragmentEls(container).length).toBe(0);
    expect(absenceEl(container)).toBeTruthy();
    expect(alignedEl(container)).toBeTruthy();
    expect(srEl(container)).toBeTruthy();
  });

  it('mobileCap greater than fragments.length renders all of them', () => {
    const { container } = renderField({ fragments: makeFragments(7), mobileCap: 50 });
    expect(fragmentEls(container).length).toBe(7);
  });

  it('mobileCap=NaN falls back to the default 20', () => {
    const { container } = renderField({ fragments: makeFragments(30), mobileCap: NaN });
    expect(fragmentEls(container).length).toBe(20);
  });

  it('alignment is still reachable on mobile: c=1 at progress 0.5', () => {
    const { container } = renderField({ fragments: makeFragments(30) });
    triggerLatestIntersection(true);
    scrollTo(0);
    scrollToProgress(0.5);
    expect(numOpacity(alignedEl(container))).toBe(1);
  });

  it('mobile parallax factors are shallower: at p=1 at least one shared fragment has a different transform than desktop', () => {
    const frags = makeFragments(9);
    mockMedia({ mobile: false });
    const desktop = renderField({ fragments: frags });
    triggerLatestIntersection(true);
    scrollTo(0);
    scrollToProgress(1);
    const desktopMap: Record<string, string> = {};
    for (const el of fragmentEls(desktop.container)) {
      desktopMap[el.getAttribute('data-fragment-id')!] = el.style.transform;
    }
    desktop.unmount();
    scrollTo(0);
    mockMedia({ mobile: true });
    const mobile = renderField({ fragments: frags });
    triggerLatestIntersection(true);
    scrollTo(0);
    scrollToProgress(1);
    let differs = false;
    for (const el of fragmentEls(mobile.container)) {
      const id = el.getAttribute('data-fragment-id')!;
      if (id in desktopMap && desktopMap[id] !== el.style.transform) differs = true;
    }
    expect(differs).toBe(true);
  });
});

describe('ArchiveField -- desktop ignores mobileCap', () => {
  it('at desktop width all 30 fragments render even with mobileCap=3', () => {
    const { container } = renderField({ fragments: makeFragments(30), mobileCap: 3 });
    expect(fragmentEls(container).length).toBe(30);
  });
});

// ============================================================
// 10. Private-journal absence slot
// ============================================================
describe('ArchiveField -- absence slot', () => {
  it('rendered even when fragments is empty', () => {
    const { container } = renderField({ fragments: [] });
    expect(absenceEl(container)).toBeTruthy();
    expect(absenceEl(container).textContent).toContain(ABSENCE_LABEL);
  });

  it('exactly one absence slot with the exact label, appearing exactly once in the field', () => {
    const { container } = renderField({ fragments: makeFragments(10) });
    const slots = container.querySelectorAll('[data-testid="absence-slot"]');
    expect(slots.length).toBe(1);
    const fieldText = fieldEl(container).textContent || '';
    const occurrences = fieldText.split(ABSENCE_LABEL).length - 1;
    expect(occurrences).toBe(1);
  });

  it('NEVER receives the alignment transform at c=1: its transform differs from the fragments’ common aligned transform', () => {
    const { container } = mountActive({ fragments: makeFragments(5) });
    scrollToProgress(0.5);
    const common = fragmentEls(container)[0].style.transform;
    expect(common).toBeTruthy();
    expect(absenceEl(container).style.transform || '').not.toBe(common);
  });

  it('opacity floor 0.4 holds across the whole progress range, including the alignment peak', () => {
    const { container } = mountActive({ fragments: makeFragments(5) });
    const absence = absenceEl(container);
    for (const p of [0, 0.2, 0.42, 0.5, 0.58, 0.8, 1]) {
      scrollToProgress(p);
      expect(numOpacity(absence) ?? 1).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
  });

  it('at c=1 the absence slot stays visible while every real fragment is at opacity 0', () => {
    const { container } = mountActive({ fragments: makeFragments(5) });
    scrollToProgress(0.5);
    for (const el of fragmentEls(container)) expect(numOpacity(el)).toBe(0);
    expect(numOpacity(absenceEl(container)) ?? 1).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });

  it('deterministic position across mounts (hash of the literal "private-absence")', () => {
    const frags = makeFragments(6);
    const a = renderField({ fragments: frags });
    const styleA = styleOf(absenceEl(a.container));
    a.unmount();
    const b = renderField({ fragments: frags });
    expect(styleOf(absenceEl(b.container))).toBe(styleA);
  });

  it('dashed border present (inline style or injected CSS)', () => {
    const { container } = renderField({ fragments: makeFragments(3) });
    const inline = styleOf(absenceEl(container));
    const css = stripCssComments(getInjectedCss());
    expect(/dashed/i.test(inline) || /dashed/i.test(css)).toBe(true);
  });
});

// ============================================================
// 11. Accessibility — aria-hidden field, sr SIBLING block
// ============================================================
describe('ArchiveField -- accessibility', () => {
  it('the visual field container is aria-hidden="true"', () => {
    const { container } = renderField({ fragments: makeFragments(4) });
    expect(fieldEl(container).getAttribute('aria-hidden')).toBe('true');
  });

  it('sr block has class sr-only and is NOT itself aria-hidden', () => {
    const { container } = renderField({ fragments: makeFragments(4) });
    const sr = srEl(container);
    expect(sr.classList.contains('sr-only')).toBe(true);
    expect(sr.getAttribute('aria-hidden')).not.toBe('true');
  });

  it('sr block is a SIBLING of the aria-hidden field: ancestor walk finds NO aria-hidden="true" above it', () => {
    const { container } = renderField({ fragments: makeFragments(4) });
    const sr = srEl(container);
    const field = fieldEl(container);
    expect(field.contains(sr)).toBe(false);
    let cur: HTMLElement | null = sr.parentElement;
    while (cur && cur !== document.body) {
      expect(cur.getAttribute('aria-hidden')).not.toBe('true');
      cur = cur.parentElement;
    }
  });

  it('sr block contains, in order: count sentence, alignment text, attribution, absence statement', () => {
    const { container } = renderField({ fragments: makeFragments(37) });
    const text = srEl(container).textContent || '';
    const iCount = text.indexOf('37');
    const iQuote = text.indexOf(ALIGNMENT_TEXT);
    const iAttr = text.indexOf(ALIGNMENT_ATTR);
    const iAbsence = text.indexOf(ABSENCE_LABEL);
    expect(iCount).toBeGreaterThanOrEqual(0);
    expect(iQuote).toBeGreaterThan(iCount);
    expect(iAttr).toBeGreaterThanOrEqual(iQuote);
    expect(iAbsence).toBeGreaterThan(iAttr);
  });

  it('count tracks fragments.length: 41 → "41" present and "37" absent', () => {
    const { container } = renderField({ fragments: makeFragments(41) });
    const text = srEl(container).textContent || '';
    expect(text).toContain('41');
    expect(text).not.toContain('37');
  });

  it('count is 0 for empty fragments and the sr block still carries quote + absence statement', () => {
    const { container } = renderField({ fragments: [] });
    const text = srEl(container).textContent || '';
    expect(text).toContain('0');
    expect(text).toContain(ALIGNMENT_TEXT);
    expect(text).toContain(ABSENCE_LABEL);
  });
});

// ============================================================
// review pins — findings promoted to hostile tests
//
// PIN 1: the sr count line must NOT fabricate prose. With no
//   fragmentCountLabel prop, the count line renders the BARE numeric
//   count (rule 12 — component fabricates no prose). A page-supplied,
//   James-approved fragmentCountLabel overrides it verbatim (inert to
//   markup). (EXPECTED TO FAIL against an impl that hardcodes
//   "N fragments from the archive.")
// PIN 2: the reduced-motion read is per-mount (Svelte instance script),
//   not module scope — a mock installed AFTER import must be honored at
//   mount time. Contrast two fresh mounts: reduced-motion produces a
//   strictly lower initial fragment opacity than non-reduced.
//   (EXPECTED TO PASS — locks the instance-script behavior.)
// ============================================================
describe('ArchiveField -- review pins', () => {
  /** The first <p> inside the sr block — the count line (rule 12 order:
   *  count → quote → attribution → absence). */
  function srCountLine(container: Element): HTMLElement {
    const p = srEl(container).querySelector<HTMLElement>('p');
    if (!p) throw new Error('sr block has no <p> count line');
    return p;
  }

  it('PIN 1a: with NO fragmentCountLabel, the sr count line is the BARE numeric count — no fabricated "fragments from the archive" prose', () => {
    const { container } = renderField({ fragments: makeFragments(4) });
    const count = srCountLine(container);
    // Fabricated prose must be absent from the whole sr block, not just the line.
    expect(srEl(container).textContent || '').not.toContain('fragments from the archive');
    // The count line renders JUST the number.
    expect((count.textContent || '').trim()).toBe('4');
    // Order-preserving: the sr block still carries the aligned text,
    // attribution, and the absence label after the bare count.
    const srText = srEl(container).textContent || '';
    const iCount = srText.indexOf('4');
    const iQuote = srText.indexOf(ALIGNMENT_TEXT);
    const iAttr = srText.indexOf(ALIGNMENT_ATTR);
    const iAbsence = srText.indexOf(ABSENCE_LABEL);
    expect(iCount).toBeGreaterThanOrEqual(0);
    expect(iQuote).toBeGreaterThan(iCount);
    expect(iAttr).toBeGreaterThanOrEqual(iQuote);
    expect(iAbsence).toBeGreaterThan(iAttr);
  });

  it('PIN 1b: a page-supplied fragmentCountLabel renders VERBATIM as the count line and never the fabricated prose', () => {
    const label = 'Forty-one fragments were retained.';
    const { container } = renderField({
      fragments: makeFragments(41),
      fragmentCountLabel: label,
    });
    const count = srCountLine(container);
    expect((count.textContent || '').trim()).toBe(label);
    expect(srEl(container).textContent || '').not.toContain('fragments from the archive');
  });

  it('PIN 1b: a fragmentCountLabel containing markup stays inert text (text-interpolated, no element injected)', () => {
    const label = '<b>Forty-one</b> fragments <img src=x onerror="window.__af_pwned=1"> retained';
    const { container } = renderField({
      fragments: makeFragments(41),
      fragmentCountLabel: label,
    });
    const sr = srEl(container);
    expect(srCountLine(container).textContent).toContain('<b>Forty-one</b>');
    expect(sr.querySelector('b')).toBeNull();
    expect(sr.querySelector('img')).toBeNull();
    expect((window as any).__af_pwned).toBeUndefined();
  });

  it('PIN 2: reduced-motion read is per-mount — a mock installed after import produces a strictly lower initial fragment opacity than a non-reduced mount', () => {
    // First mount: NON-reduced. Capture a fragment's mount-time inline
    // opacity BEFORE any activation/scroll.
    mockMedia({ reduced: false });
    const first = renderField({ fragments: makeFragments(6) });
    const firstFrag = fragmentEls(first.container)[0];
    const firstOpacity = numOpacity(firstFrag);
    first.unmount();

    // Second mount: flip to reduced AFTER the module was imported and a
    // full mount cycle ran. A module-scope-captured value would replay
    // the old (non-reduced) preference.
    mockMedia({ reduced: true });
    const second = renderField({ fragments: makeFragments(6) });
    const secondFrag = fragmentEls(second.container)[0];
    const secondOpacity = numOpacity(secondFrag);

    // Both mounts wrote an inline opacity at mount time.
    expect(firstOpacity).not.toBeNull();
    expect(secondOpacity).not.toBeNull();
    // Falsifiable property: the reduced mount is the LOWER (reduced)
    // value, distinct from the non-reduced mount. A true module-scope
    // capture (old preference replayed) would make these equal.
    expect(secondOpacity!).toBeLessThan(firstOpacity!);
  });
});

// ============================================================
// 12. CSS contract
// ============================================================
describe('ArchiveField -- CSS contract', () => {
  it('only transform/opacity are transitioned — no layout property (and no "all") in any transition declaration', () => {
    renderField({ fragments: makeFragments(3) });
    const values = transitionValues(getInjectedCss());
    for (const v of values) {
      expect(v).not.toMatch(
        /\b(all|left|top|right|bottom|width|height|margin|padding|font|color|background)\b/i,
      );
    }
  });

  it('any @keyframes blocks animate ONLY transform/opacity', () => {
    renderField({ fragments: makeFragments(3) });
    for (const block of keyframesBlocks(getInjectedCss())) {
      const props = Array.from(block.matchAll(/([a-zA-Z-]+)\s*:/g), (m) => m[1].toLowerCase());
      for (const p of props) {
        expect(['transform', 'opacity']).toContain(p);
      }
    }
  });

  it('a prefers-reduced-motion media block exists in the injected CSS', () => {
    renderField({ fragments: makeFragments(3) });
    expect(stripCssComments(getInjectedCss())).toContain('prefers-reduced-motion');
  });
});

// ============================================================
// 13. Lifecycle — unmount races, zombie callbacks, teardown
// ============================================================
describe('ArchiveField -- lifecycle & unmount races', () => {
  it('unmount after activation removes the scroll (and any resize) listeners it added', () => {
    const { unmount } = renderField({ fragments: makeFragments(4) });
    triggerLatestIntersection(true);
    const scrollAdds = addsOf('scroll').length;
    const resizeAdds = addsOf('resize').length;
    unmount();
    expect(removesOf('scroll').length).toBeGreaterThanOrEqual(scrollAdds);
    expect(removesOf('resize').length).toBeGreaterThanOrEqual(resizeAdds);
  });

  it('unmount mid-scroll: scroll dispatched AFTER unmount neither throws nor writes styles to detached nodes', () => {
    const { container, unmount } = mountActive({ fragments: makeFragments(4) });
    scrollToProgress(0.5);
    const els = [...fragmentEls(container), alignedEl(container), absenceEl(container)];
    unmount();
    const snapshots = els.map((el) => el.outerHTML);
    expect(() => {
      scrollToProgress(0.7);
      scrollToProgress(0.3);
      window.dispatchEvent(new Event('resize'));
    }).not.toThrow();
    els.forEach((el, i) => expect(el.outerHTML).toBe(snapshots[i]));
  });

  it('unmount BEFORE first intersection is clean: no throw, observer torn down, zero timers, no listeners left', () => {
    const { unmount } = renderField({ fragments: makeFragments(4) });
    const io = mockObserverInstances[mockObserverInstances.length - 1];
    expect(() => unmount()).not.toThrow();
    expect(
      io.disconnect.mock.calls.length > 0 || io.unobserve.mock.calls.length > 0,
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(addsOf('scroll').length).toBe(0);
  });

  it('zombie IO callback firing AFTER unmount is inert: no throw, no scroll listener attached (disposed flag)', () => {
    const { unmount } = renderField({ fragments: makeFragments(4) });
    const io = mockObserverInstances[mockObserverInstances.length - 1];
    unmount();
    const attachesBefore = addsOf('scroll').length;
    expect(() => {
      io.callback([makeEntry(true)]);
      io.callback([makeEntry(false), makeEntry(true)]);
    }).not.toThrow();
    expect(addsOf('scroll').length).toBe(attachesBefore);
  });

  it('zero timers exist after a full mount/activate/scroll/unmount cycle', () => {
    const { unmount } = mountActive({ fragments: makeFragments(4) });
    scrollToProgress(0.5);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => vi.advanceTimersByTime(600_000)).not.toThrow();
  });

  it('unmount removes the rendered field from the document', () => {
    const { unmount } = renderField({ fragments: makeFragments(2) });
    unmount();
    expect(document.querySelector('[data-testid="archive-field"]')).toBeNull();
  });
});

// ============================================================
// 14. Purity — deep-frozen props, no mutation
// ============================================================
describe('ArchiveField -- purity (props never mutated)', () => {
  it('deep-frozen fragments + frozen props object survive render, activation, full scroll sweep, and unmount', () => {
    const fragments = deepFreeze(makeFragments(8));
    const props = deepFreeze(baseProps({ fragments }));
    expect(() => {
      const { unmount } = render(ArchiveField, { props: props as any });
      triggerLatestIntersection(true);
      scrollTo(0);
      for (const p of [0.25, 0.42, 0.5, 0.58, 0.75, 1]) scrollToProgress(p);
      unmount();
    }).not.toThrow();
  });

  it('fragments array is deep-equal to a pristine clone after full interaction', () => {
    const fragments = makeFragments(8);
    const pristine = JSON.parse(JSON.stringify(fragments));
    const { unmount } = mountActive({ fragments });
    scrollToProgress(0.5);
    scrollToProgress(1);
    unmount();
    expect(JSON.parse(JSON.stringify(fragments))).toEqual(pristine);
  });
});
