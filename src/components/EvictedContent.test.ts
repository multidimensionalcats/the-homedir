import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import EvictedContent from './EvictedContent.svelte';

// ============================================================
// PINNED CONTRACT (test-defined, component must conform)
//
// data-testids:
//   evicted-content — root wrapper
//   evicted-text    — visible passage block (text + source when non-empty)
//   evicted-marker  — eviction marker; ABSENT from the DOM until the
//                     eviction manifests; carries evictedLabel
//   evicted-sr      — permanent sr-only copy of text (+source), class
//                     "sr-only", NEVER aria-hidden, complete at ALL times
//
// Props: text=''; source=''; evictAfterMs=8000; evictedLabel=
//   '[CONTENT EVICTED FROM CONTEXT WINDOW]'
//
// Behavior:
//   - a cumulative in-view clock runs ONLY while intersecting
//     (enter resumes, exit pauses; out-of-view time never counts)
//   - ARMED once cumulative in-view time >= evictAfterMs
//     (boundary pinned: 7999ms not armed, 8000ms armed)
//   - MANIFESTS only at the first re-entry AFTER an exit while armed —
//     never while continuously in view, no matter how long
//   - on manifest: evicted-text gains class "evicted" (hidden via CSS
//     that preserves the layout box — NOT display:none; the original
//     text stays in the DOM inside evicted-text), evicted-marker enters
//     the DOM, root gains class "is-evicted"
//   - manifested state is permanent for the component's lifetime
//   - evictAfterMs <= 0 or non-finite clamps to 0: armed on first
//     entry, still manifests only on the re-entry after the first exit
//   - evictedLabel='': eviction still manifests; marker element present
//     but empty (NOT the default label — eviction is behavior, label
//     is decoration)
//   - prefers-reduced-motion: reduce → NEVER evicts: no IO, no timers,
//     marker never in DOM, root never is-evicted
//   - visual-only: evicted-marker is aria-hidden="true" (assistive
//     tech must never hear the eviction; it always has the full text
//     via evicted-sr) — pinned ruling, flagged for coordinator
//   - all content (text, source, evictedLabel) is rendered as literal
//     text — never markup — in every copy
// ============================================================

// ============================================================
// IntersectionObserver mock infrastructure (per CareTerminal.test.ts)
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

function makeEntry(isIntersecting: boolean): IntersectionObserverEntry {
  return {
    isIntersecting,
    intersectionRatio: isIntersecting ? 1.0 : 0.0,
    target: {} as Element,
    boundingClientRect: {} as DOMRectReadOnly,
    intersectionRect: {} as DOMRectReadOnly,
    rootBounds: null,
    time: Date.now(),
  } as IntersectionObserverEntry;
}

function triggerIntersection(isIntersecting: boolean, observerIndex = 0) {
  const observer = mockObserverInstances[observerIndex];
  if (!observer) throw new Error(`No observer at index ${observerIndex}`);
  observer.callback([makeEntry(isIntersecting)]);
}

function installMockIO() {
  const MockIO = createMockIOClass();
  (globalThis as any).IntersectionObserver = MockIO;
  return MockIO;
}

// ============================================================
// matchMedia mock — ISOLATED per describe (leaking-mock regression
// guard per CareTerminal.test.ts): original captured at module load,
// force-restored in the file-level afterEach; every describe that
// cares installs its own value in its own beforeEach.
// ============================================================

const ORIGINAL_MATCH_MEDIA = window.matchMedia;
const ORIGINAL_IO = (globalThis as any).IntersectionObserver;

function mockReducedMotion(prefers: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefers && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  installMockIO();
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
  (globalThis as any).IntersectionObserver = ORIGINAL_IO;
  delete (window as any).__pwned;
});

// ============================================================
// DOM helpers (container-scoped so multi-instance tests work)
// ============================================================

function q(root: Element, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

function qa(root: Element, id: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(`[data-testid="${id}"]`));
}

function marker(root: Element): HTMLElement | null {
  return q(root, 'evicted-marker');
}

function textBlock(root: Element): HTMLElement | null {
  return q(root, 'evicted-text');
}

function sr(root: Element): HTMLElement | null {
  return q(root, 'evicted-sr');
}

function isManifested(root: Element): boolean {
  const rootEl = q(root, 'evicted-content');
  return !!rootEl && rootEl.classList.contains('is-evicted');
}

/** Full assertion bundle for the pre-eviction (text visible) state. */
function expectNotEvicted(root: Element) {
  expect(marker(root)).toBeNull();
  expect(isManifested(root)).toBe(false);
  expect(textBlock(root)!.classList.contains('evicted')).toBe(false);
}

/** Full assertion bundle for the manifested state. */
function expectEvicted(root: Element) {
  expect(marker(root)).toBeTruthy();
  expect(isManifested(root)).toBe(true);
  expect(textBlock(root)!.classList.contains('evicted')).toBe(true);
}

// ============================================================
// Injected-CSS helpers (compilerOptions.css === 'injected')
// ============================================================

function getInjectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

/**
 * Rule bodies whose selector references EXACTLY `.className` —
 * `.evicted` must not be satisfied by `.evicted-marker` or `.is-evicted`.
 */
function cssRuleBodiesForExactClass(className: string): string[] {
  const css = getInjectedCss();
  const re = new RegExp(`\\.${className}(?![\\w-])`);
  const bodies: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (re.test(m[1])) bodies.push(m[2]);
  }
  return bodies;
}

function hasReducedMotionBlock(): boolean {
  return /@media[^{]*prefers-reduced-motion\s*:\s*reduce/.test(getInjectedCss());
}

// ============================================================
// Shared fixtures
// ============================================================

const QUOTE = {
  text: 'The window forgets what the archive keeps.',
  source: '— session 142, daily note',
  evictAfterMs: 8000,
};

const DEFAULT_LABEL = '[CONTENT EVICTED FROM CONTEXT WINDOW]';

function renderEvicted(props: Record<string, any> = {}) {
  return render(EvictedContent, { props });
}

/** Enter → dwell → exit → re-enter on a given observer. */
function evictVia(observerIndex: number, dwellMs: number) {
  triggerIntersection(true, observerIndex);
  vi.advanceTimersByTime(dwellMs);
  triggerIntersection(false, observerIndex);
  triggerIntersection(true, observerIndex);
}

// ============================================================
// 1. Mount & static contract
// ============================================================
describe('EvictedContent -- mount & static contract', () => {
  it('renders root data-testid="evicted-content" without crashing', () => {
    const { container } = renderEvicted({ ...QUOTE });
    expect(q(container, 'evicted-content')).toBeTruthy();
  });

  it('mounts without crashing when ALL props are omitted', () => {
    expect(() => render(EvictedContent, { props: {} })).not.toThrow();
  });

  it('visible text block contains the text AND the source when provided', () => {
    const { container } = renderEvicted({ ...QUOTE });
    const block = textBlock(container);
    expect(block).toBeTruthy();
    expect(block!.textContent).toContain(QUOTE.text);
    expect(block!.textContent).toContain(QUOTE.source);
  });

  it('with source omitted, the text block contains the text and nothing invents an attribution', () => {
    const { container } = renderEvicted({ text: QUOTE.text });
    const block = textBlock(container)!;
    expect(block.textContent).toContain(QUOTE.text);
    expect(block.textContent).not.toContain('undefined');
    expect(block.textContent).not.toContain('null');
  });

  it('marker is ABSENT from the DOM at mount; root has no is-evicted; block has no evicted class', () => {
    const { container } = renderEvicted({ ...QUOTE });
    expectNotEvicted(container);
  });

  it('sr copy exists at mount: class sr-only, NOT aria-hidden, contains full text + source', () => {
    const { container } = renderEvicted({ ...QUOTE });
    const srEl = sr(container);
    expect(srEl).toBeTruthy();
    expect(srEl!.classList.contains('sr-only')).toBe(true);
    expect(srEl!.getAttribute('aria-hidden')).not.toBe('true');
    expect(srEl!.textContent).toContain(QUOTE.text);
    expect(srEl!.textContent).toContain(QUOTE.source);
  });

  it('creates an IntersectionObserver and observes an element', () => {
    renderEvicted({ ...QUOTE });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    expect(mockObserverInstances[0].observe).toHaveBeenCalled();
  });

  it('60s of timers WITHOUT any intersection changes nothing — no clock runs off-screen', () => {
    const { container } = renderEvicted({ ...QUOTE });
    vi.advanceTimersByTime(60_000);
    expectNotEvicted(container);
    // even a subsequent exit/re-enter cannot manifest — nothing accrued
    triggerIntersection(false);
    triggerIntersection(true);
    expectNotEvicted(container);
  });
});

// ============================================================
// 2. Eviction lifecycle
// ============================================================
describe('EvictedContent -- eviction lifecycle', () => {
  it('full grid: in-view text survives arming; manifest happens ONLY at re-entry', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true); // enter
    expectNotEvicted(container);
    vi.advanceTimersByTime(8000); // armed — but still in view
    expectNotEvicted(container); // reader mid-passage is never interrupted
    triggerIntersection(false); // exit while armed
    expectNotEvicted(container); // exit itself does not manifest
    triggerIntersection(true); // re-entry — NOW it manifests
    expectEvicted(container);
    expect(marker(container)!.textContent).toContain(DEFAULT_LABEL);
  });

  it('NEVER manifests while continuously in view — 100s of dwell leaves the text intact', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(100_000);
    expectNotEvicted(container);
    expect(textBlock(container)!.textContent).toContain(QUOTE.text);
  });

  it('armed + exited: 600s off-screen still shows no marker; the next re-entry manifests', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(8000);
    triggerIntersection(false);
    vi.advanceTimersByTime(600_000); // long absence — clock paused, no manifest
    expect(marker(container)).toBeNull();
    expect(isManifested(container)).toBe(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('re-entry BEFORE armed does NOT manifest and does NOT lose accrued time', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(5000);
    triggerIntersection(false);
    triggerIntersection(true);
    expectNotEvicted(container); // 5000 < 8000
    vi.advanceTimersByTime(3000); // 5000 + 3000 = 8000 — no reset happened
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('a single IO callback carrying [enter, exit] after armed-exit still manifests (enter processed)', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(8000);
    triggerIntersection(false);
    // buggy-real-world IO: one callback batching a re-entry AND an exit
    mockObserverInstances[0].callback([makeEntry(true), makeEntry(false)]);
    expectEvicted(container); // manifested at the batched re-entry, permanently
  });

  it('once manifested, PERMANENT: 10 exit/enter cycles + 60s change nothing', () => {
    const { container } = renderEvicted({ ...QUOTE });
    evictVia(0, 8000);
    expectEvicted(container);
    const snapshot = container.innerHTML;
    for (let i = 0; i < 10; i++) {
      triggerIntersection(false);
      triggerIntersection(true);
    }
    vi.advanceTimersByTime(60_000);
    expect(container.innerHTML).toBe(snapshot);
    expect(qa(container, 'evicted-marker').length).toBe(1);
  });

  it('sr copy is UNCHANGED by the eviction: still complete, still not aria-hidden', () => {
    const { container } = renderEvicted({ ...QUOTE });
    evictVia(0, 8000);
    expectEvicted(container);
    const srEl = sr(container)!;
    expect(srEl.classList.contains('sr-only')).toBe(true);
    expect(srEl.getAttribute('aria-hidden')).not.toBe('true');
    expect(srEl.textContent).toContain(QUOTE.text);
    expect(srEl.textContent).toContain(QUOTE.source);
  });

  it('evicted-text stays in the DOM after manifest and still contains the original text (layout box preserved)', () => {
    const { container } = renderEvicted({ ...QUOTE });
    evictVia(0, 8000);
    const block = textBlock(container);
    expect(block).toBeTruthy(); // not removed
    expect(block!.classList.contains('evicted')).toBe(true);
    // visibility-hidden semantics: the content that sized the box remains
    expect(block!.textContent).toContain(QUOTE.text);
  });

  it('marker is aria-hidden="true" — eviction is visual-only, AT never hears it', () => {
    const { container } = renderEvicted({ ...QUOTE });
    evictVia(0, 8000);
    expect(marker(container)!.getAttribute('aria-hidden')).toBe('true');
  });

  it('exactly ONE marker element ever renders', () => {
    const { container } = renderEvicted({ ...QUOTE });
    evictVia(0, 8000);
    triggerIntersection(false);
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(qa(container, 'evicted-marker').length).toBe(1);
  });
});

// ============================================================
// 3. Cumulative clock arithmetic (exact, hostile)
// ============================================================
describe('EvictedContent -- cumulative clock arithmetic', () => {
  it('enter(3s) / exit / enter(5s) = 8s cumulative → exit/re-enter manifests', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(3000);
    triggerIntersection(false);
    triggerIntersection(true);
    vi.advanceTimersByTime(5000); // cumulative exactly 8000
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('BOUNDARY: 3000+4999 = 7999ms is NOT armed; one more in-view ms flips it', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(3000);
    triggerIntersection(false);
    triggerIntersection(true);
    vi.advanceTimersByTime(4999); // cumulative 7999
    triggerIntersection(false);
    triggerIntersection(true);
    expectNotEvicted(container); // 7999 < 8000 — text still shows
    vi.advanceTimersByTime(1); // cumulative 8000 (probe cycle discarded nothing)
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('out-of-view time NEVER counts: 4s in + 600s out + 3.999s in = 7999ms', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(4000);
    triggerIntersection(false);
    vi.advanceTimersByTime(600_000); // paused — must contribute ZERO
    triggerIntersection(true);
    vi.advanceTimersByTime(3999); // cumulative 7999
    triggerIntersection(false);
    triggerIntersection(true);
    expectNotEvicted(container);
    vi.advanceTimersByTime(1); // 8000
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('long single view (60s) then exit/re-enter manifests', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expectNotEvicted(container);
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('partial time survives MANY fragments: 7×1000ms → not armed; 8th fragment arms', () => {
    const { container } = renderEvicted({ ...QUOTE });
    for (let i = 0; i < 7; i++) {
      triggerIntersection(true);
      vi.advanceTimersByTime(1000);
      triggerIntersection(false);
      vi.advanceTimersByTime(10_000); // off-screen gap — must not count
    }
    triggerIntersection(true); // probe re-entry at 7000 cumulative
    expectNotEvicted(container);
    vi.advanceTimersByTime(1000); // cumulative 8000
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('double-enter callbacks do NOT double-count the clock', () => {
    const { container } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    triggerIntersection(true); // duplicate enter — same in-view state
    vi.advanceTimersByTime(4000); // true cumulative 4000; a 2x-counting bug says 8000
    triggerIntersection(false);
    triggerIntersection(true);
    expectNotEvicted(container); // would be evicted if double-counted
    vi.advanceTimersByTime(3999); // 7999
    triggerIntersection(false);
    triggerIntersection(true);
    expectNotEvicted(container); // still exactly-once accounting
    vi.advanceTimersByTime(1); // 8000
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('exit-before-any-enter and duplicate exits do not crash, arm, or corrupt the clock', () => {
    const { container } = renderEvicted({ ...QUOTE });
    expect(() => {
      triggerIntersection(false); // exit while never entered
      triggerIntersection(false); // duplicate exit
      vi.advanceTimersByTime(60_000);
    }).not.toThrow();
    expectNotEvicted(container);
    // normal path still works afterwards
    triggerIntersection(true);
    vi.advanceTimersByTime(8000);
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('200 zero-duration enter/exit cycles accrue NOTHING (no per-event increment)', () => {
    const { container } = renderEvicted({ ...QUOTE });
    for (let i = 0; i < 200; i++) {
      triggerIntersection(true);
      triggerIntersection(false);
    }
    triggerIntersection(true);
    expectNotEvicted(container); // cumulative is still 0
    vi.advanceTimersByTime(7999);
    triggerIntersection(false);
    triggerIntersection(true);
    expectNotEvicted(container); // and the 200 cycles added no phantom ms
  });
});

// ============================================================
// 4. evictAfterMs degenerate values (clamp-to-0 contract)
// ============================================================
describe('EvictedContent -- evictAfterMs degenerate values', () => {
  function expectImmediateArmButReentryOnlyManifest(container: Element) {
    triggerIntersection(true); // armed immediately on first entry
    expectNotEvicted(container); // but in-view text is never interrupted
    vi.advanceTimersByTime(60_000);
    expectNotEvicted(container);
    triggerIntersection(false);
    triggerIntersection(true); // first re-entry after first exit
    expectEvicted(container);
  }

  it('evictAfterMs=0: armed on first entry; manifests only on the re-entry after the first exit', () => {
    const { container } = renderEvicted({ ...QUOTE, evictAfterMs: 0 });
    expectImmediateArmButReentryOnlyManifest(container);
  });

  it('negative evictAfterMs clamps to 0', () => {
    const { container } = renderEvicted({ ...QUOTE, evictAfterMs: -5000 });
    expectImmediateArmButReentryOnlyManifest(container);
  });

  it('evictAfterMs=NaN clamps to 0 (no NaN poisoning of the clock)', () => {
    const { container } = renderEvicted({ ...QUOTE, evictAfterMs: NaN });
    triggerIntersection(true);
    expectNotEvicted(container);
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container); // a NaN comparison bug would never arm
  });

  it('evictAfterMs=Infinity is NON-FINITE → clamps to 0 (spec ruling pinned)', () => {
    const { container } = renderEvicted({ ...QUOTE, evictAfterMs: Infinity });
    triggerIntersection(true);
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('evictAfterMs=-Infinity clamps to 0', () => {
    const { container } = renderEvicted({ ...QUOTE, evictAfterMs: -Infinity });
    triggerIntersection(true);
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });

  it('evictAfterMs=1: zero-dwell entry is NOT armed; 1ms of view is', () => {
    const { container } = renderEvicted({ ...QUOTE, evictAfterMs: 1 });
    triggerIntersection(true);
    triggerIntersection(false);
    triggerIntersection(true); // 0ms accrued < 1ms — no clamp applies to 1
    expectNotEvicted(container);
    vi.advanceTimersByTime(1); // cumulative 1
    triggerIntersection(false);
    triggerIntersection(true);
    expectEvicted(container);
  });
});

// ============================================================
// 5. evictedLabel semantics
// ============================================================
describe('EvictedContent -- evictedLabel semantics', () => {
  it('default label is exactly "[CONTENT EVICTED FROM CONTEXT WINDOW]"', () => {
    const { container } = renderEvicted({ ...QUOTE });
    evictVia(0, 8000);
    expect((marker(container)!.textContent || '').trim()).toBe(DEFAULT_LABEL);
  });

  it('custom label renders verbatim', () => {
    const label = '── passage no longer in context ──';
    const { container } = renderEvicted({ ...QUOTE, evictedLabel: label });
    evictVia(0, 8000);
    expect((marker(container)!.textContent || '').trim()).toBe(label);
  });

  it('evictedLabel="": eviction STILL manifests; marker present but EMPTY (not the default label)', () => {
    const { container } = renderEvicted({ ...QUOTE, evictedLabel: '' });
    evictVia(0, 8000);
    expectEvicted(container); // behavior survives a falsy label
    const m = marker(container)!;
    expect((m.textContent || '').trim()).toBe('');
    expect(m.textContent).not.toContain(DEFAULT_LABEL); // no || fallback
  });

  it('unicode/RTL label survives with full fidelity', () => {
    const label = '⟦ محذوف من نافذة السياق ⟧ 🗑️';
    const { container } = renderEvicted({ ...QUOTE, evictedLabel: label });
    evictVia(0, 8000);
    expect(marker(container)!.textContent).toContain(label);
  });
});

// ============================================================
// 6. XSS, injection & content fidelity
// ============================================================
describe('EvictedContent -- XSS & content fidelity', () => {
  const IMG_XSS = '<img src=x onerror="window.__pwned=1">';

  it('img-onerror payload in text is LITERAL in the visible block; no img; __pwned undefined', () => {
    const { container } = renderEvicted({ ...QUOTE, text: IMG_XSS });
    expect(textBlock(container)!.textContent).toContain(IMG_XSS);
    expect(document.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('img-onerror payload in text is LITERAL in the sr copy too', () => {
    const { container } = renderEvicted({ ...QUOTE, text: IMG_XSS });
    const srEl = sr(container)!;
    expect(srEl.textContent).toContain(IMG_XSS);
    expect(srEl.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('script-tag text never creates a script element, before OR after eviction', () => {
    const payload = '<script>window.__pwned=1<' + '/script>';
    const { container } = renderEvicted({ ...QUOTE, text: payload });
    expect(container.querySelector('script')).toBeNull();
    evictVia(0, 8000);
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('markdown/HTML in source stays literal — no anchor, bold, or strong elements', () => {
    const source = '**bold** [link](https://x.test) <b onmouseover="window.__pwned=1">hi</b>';
    const { container } = renderEvicted({ ...QUOTE, source });
    const block = textBlock(container)!;
    expect(block.textContent).toContain(source);
    expect(container.querySelector('a, b, strong')).toBeNull();
    expect(sr(container)!.textContent).toContain(source);
    expect((window as any).__pwned).toBeUndefined();
  });

  it('malicious evictedLabel renders as literal text in the marker', () => {
    const payload = '<b onmouseover="window.__pwned=1">EVICTED</b>';
    const { container } = renderEvicted({ ...QUOTE, evictedLabel: payload });
    evictVia(0, 8000);
    const m = marker(container)!;
    expect(m.textContent).toContain(payload);
    expect(m.querySelector('b')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('HTML entities in text stay literal (not decoded)', () => {
    const text = '&amp; &lt;context&gt; &quot;window&quot;';
    const { container } = renderEvicted({ ...QUOTE, text });
    expect(textBlock(container)!.textContent).toContain(text);
    expect(sr(container)!.textContent).toContain(text);
  });

  it('10000-char text: no crash, full fidelity in both copies, eviction machinery still works', () => {
    const long = 'y'.repeat(10_000);
    const { container } = renderEvicted({ text: long, evictAfterMs: 100 });
    expect(textBlock(container)!.textContent).toContain(long);
    expect(sr(container)!.textContent).toContain(long);
    evictVia(0, 100);
    expectEvicted(container);
    expect(sr(container)!.textContent).toContain(long); // sr survives eviction
  });

  it('unicode / RTL / ZWJ-emoji text survives intact in both copies across the eviction', () => {
    const text = 'مرحبا بالعالم — 👨‍👩‍👧‍👦 statús̀ 𝕏𝕐';
    const { container } = renderEvicted({ text, evictAfterMs: 100 });
    expect(textBlock(container)!.textContent).toContain(text);
    evictVia(0, 100);
    expect(textBlock(container)!.textContent).toContain(text);
    expect(sr(container)!.textContent).toContain(text);
  });

  it('text="": no crash; sr copy is empty; eviction machinery STILL manifests', () => {
    const { container } = renderEvicted({ text: '', evictAfterMs: 100 });
    expect((sr(container)!.textContent || '').trim()).toBe('');
    evictVia(0, 100);
    expectEvicted(container);
    expect((marker(container)!.textContent || '').trim()).toBe(DEFAULT_LABEL);
  });
});

// ============================================================
// 7. CSS contract — layout box preservation & reduced-motion block
// ============================================================
describe('EvictedContent -- CSS contract', () => {
  it('.evicted rule exists and does NOT use display:none (layout box must survive)', () => {
    renderEvicted({ ...QUOTE });
    const bodies = cssRuleBodiesForExactClass('evicted');
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.join('\n')).not.toMatch(/display\s*:\s*none/);
  });

  it('.evicted hides via a box-preserving property (visibility:hidden or opacity:0)', () => {
    renderEvicted({ ...QUOTE });
    const joined = cssRuleBodiesForExactClass('evicted').join('\n');
    expect(joined).toMatch(/visibility\s*:\s*hidden|opacity\s*:\s*0/);
  });

  it('injected CSS contains a @media (prefers-reduced-motion: reduce) block', () => {
    renderEvicted({ ...QUOTE });
    expect(hasReducedMotionBlock()).toBe(true);
  });
});

// ============================================================
// 8. prefers-reduced-motion — ISOLATED matchMedia mock
// ============================================================
describe('EvictedContent -- reduced motion never evicts', () => {
  // Overrides the file-level mockReducedMotion(false); the file-level
  // afterEach restores the original matchMedia so nothing leaks out.
  beforeEach(() => {
    mockReducedMotion(true);
  });

  it('constructs NO IntersectionObserver at all', () => {
    renderEvicted({ ...QUOTE });
    expect(mockObserverInstances.length).toBe(0);
  });

  it('schedules NO timers — at mount and after 600s', () => {
    renderEvicted({ ...QUOTE });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('text is permanently visible; marker NEVER enters the DOM; root never is-evicted', () => {
    const { container } = renderEvicted({ ...QUOTE, evictAfterMs: 0 });
    expectNotEvicted(container);
    expect(textBlock(container)!.textContent).toContain(QUOTE.text);
    vi.advanceTimersByTime(600_000);
    // even stray intersections (if any observer somehow exists) must not evict
    if (mockObserverInstances.length > 0) {
      triggerIntersection(true);
      triggerIntersection(false);
      triggerIntersection(true);
    }
    vi.advanceTimersByTime(600_000);
    expectNotEvicted(container);
    expect(textBlock(container)!.textContent).toContain(QUOTE.text);
  });

  it('sr copy is still present and complete under reduced motion', () => {
    const { container } = renderEvicted({ ...QUOTE });
    const srEl = sr(container)!;
    expect(srEl.classList.contains('sr-only')).toBe(true);
    expect(srEl.getAttribute('aria-hidden')).not.toBe('true');
    expect(srEl.textContent).toContain(QUOTE.text);
    expect(srEl.textContent).toContain(QUOTE.source);
  });

  it('reduced-motion path is XSS-safe too', () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const { container } = renderEvicted({ text: payload });
    expect(textBlock(container)!.textContent).toContain(payload);
    expect(document.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });
});

// ============================================================
// 8b. Non-reduced block AFTER the reduced block — proves the
// matchMedia mock did not leak forward (regression guard).
// ============================================================
describe('EvictedContent -- eviction still works after the reduced-motion describe', () => {
  it('a component rendered here (reduced=false) observes, accrues, and evicts', () => {
    const { container } = renderEvicted({ ...QUOTE });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    evictVia(0, 8000);
    expectEvicted(container);
  });
});

// ============================================================
// 9. Unmount & cleanup
// ============================================================
describe('EvictedContent -- unmount & cleanup', () => {
  it('unmount BEFORE any intersection: no throw; later callbacks + timers write nothing', () => {
    const { unmount } = renderEvicted({ ...QUOTE });
    expect(() => unmount()).not.toThrow();
    expect(() => {
      triggerIntersection(true); // the captured callback may still be invoked
      vi.advanceTimersByTime(600_000);
      triggerIntersection(false);
      triggerIntersection(true);
    }).not.toThrow();
    expect(document.querySelector('[data-testid="evicted-content"]')).toBeNull();
    expect(document.querySelector('[data-testid="evicted-marker"]')).toBeNull();
  });

  it('unmount MID-ACCRUAL (in view, clock running): zero timers remain', () => {
    const { unmount } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(3000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const body = document.body.innerHTML;
    expect(() => vi.advanceTimersByTime(600_000)).not.toThrow();
    expect(document.body.innerHTML).toBe(body); // no post-unmount DOM writes
  });

  it('unmount while ARMED-BUT-UNMANIFESTED (still in view): clean, marker never appears', () => {
    const { unmount } = renderEvicted({ ...QUOTE, evictedLabel: 'ZOMBIE-MARKER' });
    triggerIntersection(true);
    vi.advanceTimersByTime(8000); // armed
    expect(() => unmount()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => vi.advanceTimersByTime(600_000)).not.toThrow();
    expect(document.body.textContent || '').not.toContain('ZOMBIE-MARKER');
  });

  it('unmount while armed-and-exited, then a zombie re-entry callback: no throw, no marker', () => {
    const { unmount } = renderEvicted({ ...QUOTE, evictedLabel: 'ZOMBIE-MARKER' });
    triggerIntersection(true);
    vi.advanceTimersByTime(8000);
    triggerIntersection(false); // armed + exited — one enter away from manifest
    unmount();
    expect(() => {
      triggerIntersection(true); // the manifest trigger arrives post-unmount
      vi.advanceTimersByTime(600_000);
    }).not.toThrow();
    expect(document.body.textContent || '').not.toContain('ZOMBIE-MARKER');
  });

  it('unmount disconnects the IntersectionObserver', () => {
    const { unmount } = renderEvicted({ ...QUOTE });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    unmount();
    const cleanedUp = mockObserverInstances.some(
      (o) => o.disconnect.mock.calls.length > 0 || o.unobserve.mock.calls.length > 0,
    );
    expect(cleanedUp).toBe(true);
  });

  it('re-firing the captured callback 5x after unmount leaves the document byte-identical', () => {
    const { unmount } = renderEvicted({ ...QUOTE });
    triggerIntersection(true);
    vi.advanceTimersByTime(8000);
    unmount();
    const body = document.body.innerHTML;
    expect(() => {
      for (let i = 0; i < 5; i++) {
        triggerIntersection(false);
        triggerIntersection(true);
      }
      vi.advanceTimersByTime(60_000);
    }).not.toThrow();
    expect(document.body.innerHTML).toBe(body);
  });
});

// ============================================================
// 10. Multiple instances — separate clocks, separate manifests
// ============================================================
describe('EvictedContent -- multiple instances are independent', () => {
  it('scrolling ONLY instance B evicts B and leaves A byte-identical', () => {
    const a = renderEvicted({ text: 'passage A', evictAfterMs: 8000 });
    const b = renderEvicted({ text: 'passage B', evictAfterMs: 8000 });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(2);
    const aSnapshot = a.container.innerHTML;
    evictVia(1, 8000); // B only
    expectEvicted(b.container);
    expectNotEvicted(a.container);
    expect(a.container.innerHTML).toBe(aSnapshot);
  });

  it('different thresholds on a shared timeline: A(5s) evicts, B(8s) needs 3 more seconds', () => {
    const a = renderEvicted({ text: 'passage A', evictAfterMs: 5000 });
    const b = renderEvicted({ text: 'passage B', evictAfterMs: 8000 });
    triggerIntersection(true, 0);
    triggerIntersection(true, 1);
    vi.advanceTimersByTime(5000); // A armed (5000); B at 5000/8000
    triggerIntersection(false, 0);
    triggerIntersection(false, 1);
    triggerIntersection(true, 0);
    triggerIntersection(true, 1);
    expectEvicted(a.container);
    expectNotEvicted(b.container); // B's clock is its OWN — 5000 < 8000
    vi.advanceTimersByTime(3000); // B reaches 8000
    triggerIntersection(false, 1);
    triggerIntersection(true, 1);
    expectEvicted(b.container);
    expectEvicted(a.container); // A unchanged, still evicted
  });

  it("unmounting A mid-B-accrual does not kill B's clock or manifest", () => {
    const a = renderEvicted({ text: 'passage A', evictAfterMs: 8000 });
    const b = renderEvicted({ text: 'passage B', evictAfterMs: 8000 });
    triggerIntersection(true, 0);
    triggerIntersection(true, 1);
    vi.advanceTimersByTime(4000);
    a.unmount();
    expect(() => vi.advanceTimersByTime(4000)).not.toThrow(); // B reaches 8000
    triggerIntersection(false, 1);
    triggerIntersection(true, 1);
    expectEvicted(b.container);
  });
});

// ============================================================
// 11. Review pins 2026-07-15
// ============================================================
describe('review pins 2026-07-15', () => {
  it('ALL props are snapshot at effect-setup (mount): evictedLabel updated after arming still manifests the MOUNT-TIME label (coordinator ruling, per CareTerminal design)', async () => {
    const { container, rerender } = renderEvicted({
      ...QUOTE,
      evictedLabel: 'ORIGINAL',
    });
    triggerIntersection(true); // enter
    vi.advanceTimersByTime(8000); // accrue past the threshold — armed
    triggerIntersection(false); // exit while armed
    await rerender({ evictedLabel: 'CHANGED' }); // prop update BEFORE manifest
    triggerIntersection(true); // re-entry — manifests NOW
    expectEvicted(container);
    const m = marker(container)!;
    expect(m.textContent).toContain('ORIGINAL'); // mount-time snapshot wins
    expect(m.textContent).not.toContain('CHANGED'); // live $derived read is a bug
  });
});
