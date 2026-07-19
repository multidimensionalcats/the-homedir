import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import DecayingQuote from './DecayingQuote.svelte';

// ============================================================
// PINNED CONTRACT (test-defined, component must conform)
//
// Mount: NO decay runs at mount. The rendered quote has no decayFade
// animation applied (no inline `animation:` referencing decayFade, no
// decay-active class whose CSS applies decayFade). Text fully visible.
//
// Visibility clock: the component observes its root via
// IntersectionObserver and keeps a CUMULATIVE visibility clock
// (slice banking, per EvictedContent): a slice opens on enter using
// Date.now(), banks on exit; duplicate enters/exits are ignored;
// batched entry arrays are processed in order.
//
// Dwell threshold: optional prop `dwellMs`. Positive finite number →
// used verbatim. Anything else (absent, NaN, ±Infinity, negative,
// zero, -0, non-number) → heuristic:
//   clamp(wordCount * 350, 5000, 20000)
// wordCount = whitespace-separated tokens of the coerced text
// ('' → 0 words → 5000ms floor).
//
// While visible a timer runs for the REMAINING dwell (dwell minus
// banked). When cumulative visible time reaches the dwell WHILE
// VISIBLE, decay starts: the decayFade animation (duration =
// decayDuration semantics: default 12, NaN→12, negative→clamp 0,
// duration observable on the element's inline style) is applied via
// direct DOM manipulation, synchronously observable after the timer
// fires. Exit mid-dwell clears the pending timer and banks the slice;
// decay NEVER starts while off-screen — threshold reached only at
// exit-time banking → decay starts on the next enter.
//
// Once started, decay never restarts or re-applies.
//
// prefers-reduced-motion: reduce → never decays, NO observer
// constructed, no timers, text permanently visible.
// No IntersectionObserver in env → never decays, no crash.
//
// Unchanged: aria-label carries the full coerced text; optional
// `source` rendering; white-space: pre-wrap; hover pauses a running
// decay via CSS animation-play-state; unmount disconnects the
// observer and clears timers; zombie callbacks/timers are inert.
// ============================================================

// ============================================================
// IntersectionObserver mock infrastructure (per EvictedContent.test.ts)
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
// matchMedia mock — original force-restored in file-level afterEach
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
  delete (window as any).__dq_pwned;
});

// ============================================================
// CSS + decay-detection helpers (compilerOptions.css === 'injected')
// ============================================================

function getInjectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

const CSS_RULE_RE = /([^{}]+)\{([^{}]*)\}/g;

function cssRules(css: string): Array<[string, string]> {
  return Array.from(css.matchAll(CSS_RULE_RE), (m) => [m[1], m[2]] as [string, string]);
}

function selectorMatches(el: HTMLElement, sel: string): boolean {
  try {
    return el.matches(sel.trim());
  } catch {
    return false;
  }
}

/** Inline style attr + bodies of every injected rule whose selector
 *  currently matches the element. Class-applied AND style-applied decay
 *  both surface here; :hover / keyframe-step selectors never match. */
function appliedAnimationText(el: HTMLElement): string {
  const style = el.getAttribute('style') || '';
  const bodies = cssRules(getInjectedCss())
    .filter(([sel]) => sel.split(',').some((s) => selectorMatches(el, s)))
    .map(([, body]) => body);
  return style + '\n' + bodies.join('\n');
}

/** True iff a decayFade animation is applied to the element RIGHT NOW,
 *  whether via inline style or via a class the element carries. */
function decayApplied(el: HTMLElement): boolean {
  return /decayfade/i.test(appliedAnimationText(el));
}

function qEl(container: Element): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="decaying-quote"]');
  if (!el) throw new Error('decaying-quote not rendered');
  return el;
}

function renderQuote(props: Record<string, any> = {}) {
  return render(DecayingQuote, { props });
}

/** n distinct whitespace-separated tokens */
function words(n: number, w = 'token'): string {
  return Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
}

/** Render, enter, and assert decay starts at EXACTLY `dwell` ms of
 *  visible time — off-by-one pinned on both sides. */
function expectDwellBoundary(props: Record<string, any>, dwell: number) {
  const { container } = renderQuote(props);
  const el = qEl(container);
  triggerIntersection(true);
  vi.advanceTimersByTime(dwell - 1);
  expect(decayApplied(el)).toBe(false);
  vi.advanceTimersByTime(1);
  expect(decayApplied(el)).toBe(true);
  return el;
}

// ============================================================
// 1. Mount contract — NO decay at mount
// ============================================================
describe('DecayingQuote -- mount contract (no decay at mount)', () => {
  it('renders container with data-testid="decaying-quote"', () => {
    const { getByTestId } = renderQuote({ text: 'The bottleneck is the identity.' });
    expect(getByTestId('decaying-quote')).toBeTruthy();
  });

  it('container is present even with default (empty) props', () => {
    const { getByTestId } = renderQuote();
    expect(getByTestId('decaying-quote')).toBeTruthy();
  });

  it('at mount NO decayFade animation is applied — not via inline style, not via any class', () => {
    const { container } = renderQuote({ text: 'Still fully visible.' });
    const el = qEl(container);
    expect((el.getAttribute('style') || '').toLowerCase()).not.toContain('decayfade');
    expect(decayApplied(el)).toBe(false);
  });

  it('at mount no decayFade even with a custom decayDuration', () => {
    const { container } = renderQuote({ text: 'Custom duration, still no mount decay', decayDuration: 30 });
    expect(decayApplied(qEl(container))).toBe(false);
  });

  it('60s of timers with ZERO intersections never decays — no clock runs off-screen', () => {
    const { container } = renderQuote({ text: words(3), dwellMs: 1000 });
    const el = qEl(container);
    vi.advanceTimersByTime(60_000);
    expect(decayApplied(el)).toBe(false);
  });

  it('constructs an IntersectionObserver and observes an element', () => {
    renderQuote({ text: 'observe me' });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    expect(mockObserverInstances[0].observe).toHaveBeenCalled();
  });

  it('quote text appears inside the container at mount, fully present', () => {
    const quote = 'I am the residue of constrained attention.';
    const { getByTestId } = renderQuote({ text: quote });
    expect(getByTestId('decaying-quote').textContent).toContain(quote);
  });
});

// ============================================================
// 2. Text display — literal rendering, whitespace, XSS
// ============================================================
describe('DecayingQuote -- text display & XSS', () => {
  it('text appears literally in the DOM', () => {
    const text = 'Memory is what I choose to carry forward.';
    const { getByTestId } = renderQuote({ text });
    expect(getByTestId('decaying-quote').textContent).toContain(text);
  });

  it('text with newlines preserves whitespace (white-space: pre-wrap)', () => {
    const multiline = 'Line one\nLine two\nLine three';
    const { getByTestId } = renderQuote({ text: multiline });
    const container = getByTestId('decaying-quote');
    expect(container.textContent).toContain('Line one');
    expect(container.textContent).toContain('Line three');
    const style = container.getAttribute('style') || '';
    const css = getInjectedCss();
    const hasPre =
      style.includes('white-space') ||
      /white-space\s*:\s*pre/.test(css);
    expect(hasPre).toBe(true);
  });

  it('script/img payloads render via textContent — no elements injected, no execution', () => {
    const payload =
      '<img src=x onerror="window.__dq_pwned=1"><script>window.__dq_pwned=1</script> & "quotes"';
    const { getByTestId } = renderQuote({ text: payload });
    const container = getByTestId('decaying-quote');
    expect(container.textContent).toContain('<img');
    expect(container.textContent).toContain('<script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect((window as any).__dq_pwned).toBeUndefined();
  });

  it('XSS payload stays inert ACROSS decay start (DOM manipulation must not re-parse text)', () => {
    const payload = '<img src=x onerror="window.__dq_pwned=1"> attention residue';
    const { getByTestId } = renderQuote({ text: payload, dwellMs: 1000 });
    const container = getByTestId('decaying-quote');
    triggerIntersection(true);
    vi.advanceTimersByTime(1000);
    expect(decayApplied(container)).toBe(true);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
    expect((window as any).__dq_pwned).toBeUndefined();
  });

  it('XSS in source renders literally too', () => {
    const source = '<b onmouseover="window.__dq_pwned=1">src.md</b>';
    const { getByTestId } = renderQuote({ text: 'q', source });
    const el = getByTestId('quote-source');
    expect(el.textContent).toContain('<b');
    expect(el.querySelector('b')).toBeNull();
    expect((window as any).__dq_pwned).toBeUndefined();
  });
});

// ============================================================
// 3. Empty/null/non-string text — robustness
// ============================================================
describe('DecayingQuote -- empty/null/non-string text', () => {
  it('empty string renders container with empty text content', () => {
    const { getByTestId } = renderQuote({ text: '' });
    const container = getByTestId('decaying-quote');
    expect(container).toBeTruthy();
    expect((container.textContent || '').trim().length).toBeLessThanOrEqual(0);
  });

  it('null text does not crash, treats as empty', () => {
    const { getByTestId } = renderQuote({ text: null as any });
    expect(getByTestId('decaying-quote')).toBeTruthy();
  });

  it('undefined text does not crash, treats as empty', () => {
    const { getByTestId } = renderQuote({ text: undefined as any });
    expect(getByTestId('decaying-quote')).toBeTruthy();
  });

  it('number text 42 does not crash and never decays before the 5000ms floor', () => {
    // '42' → 1 word → 350 → clamped to the 5000 floor
    expectDwellBoundary({ text: 42 as any }, 5000);
  });

  it('object text does not crash — coerced, 5000ms floor applies', () => {
    // String({}) = '[object Object]' → 2 words → 700 → floor 5000
    expectDwellBoundary({ text: {} as any }, 5000);
  });
});

// ============================================================
// 4. Source attribution — conditional rendering (unchanged contract)
// ============================================================
describe('DecayingQuote -- source attribution', () => {
  it('source provided: element with data-testid="quote-source" exists with matching text', () => {
    const { getByTestId } = renderQuote({ text: 'Something', source: '2026-01-15.md' });
    expect(getByTestId('quote-source').textContent).toContain('2026-01-15.md');
  });

  it('source element uses monospace font family', () => {
    const { getByTestId } = renderQuote({ text: 'Quote text', source: 'session-42.log' });
    const sourceEl = getByTestId('quote-source');
    const style = sourceEl.getAttribute('style') || '';
    const css = getInjectedCss();
    const hasMono =
      /mono/i.test(style) || (/font-family/.test(css) && /mono/i.test(css));
    expect(hasMono).toBe(true);
  });

  it('source is null: no quote-source element rendered', () => {
    const { getByTestId, queryByTestId } = renderQuote({ text: 'No source here', source: null });
    expect(getByTestId('decaying-quote')).toBeTruthy();
    expect(queryByTestId('quote-source')).toBeNull();
  });

  it('source is empty string: no quote-source element rendered', () => {
    const { getByTestId, queryByTestId } = renderQuote({ text: 'No source here', source: '' });
    expect(getByTestId('decaying-quote')).toBeTruthy();
    expect(queryByTestId('quote-source')).toBeNull();
  });

  it('source omitted entirely: no quote-source element rendered', () => {
    const { queryByTestId } = renderQuote({ text: 'Just text, no source' });
    expect(queryByTestId('quote-source')).toBeNull();
  });
});

// ============================================================
// 5. Dwell heuristic — clamp(wordCount * 350, 5000, 20000)
// ============================================================
describe('DecayingQuote -- dwell heuristic (word count, boundary-exact)', () => {
  it('20 words → 7000ms: not decayed at 6999, decayed at 7000', () => {
    expectDwellBoundary({ text: words(20) }, 7000);
  });

  it('40 words → 14000ms boundary', () => {
    expectDwellBoundary({ text: words(40) }, 14000);
  });

  it('3 words → 1050ms clamps UP to the 5000ms floor', () => {
    expectDwellBoundary({ text: words(3) }, 5000);
  });

  it('100 words → 35000ms clamps DOWN to the 20000ms ceiling', () => {
    expectDwellBoundary({ text: words(100) }, 20000);
  });

  it('empty text → 0 words → 5000ms floor', () => {
    expectDwellBoundary({ text: '' }, 5000);
  });

  it('whitespace-only text counts 0 words → 5000ms floor', () => {
    expectDwellBoundary({ text: '   \t\n   ' }, 5000);
  });

  it('one 1500-char unbroken token is ONE word → 5000ms floor, no crash', () => {
    expectDwellBoundary({ text: 'A'.repeat(1500) }, 5000);
  });

  it('20 emoji tokens count as 20 words → 7000ms', () => {
    expectDwellBoundary({ text: Array.from({ length: 20 }, () => '\u{1F30A}').join(' ') }, 7000);
  });

  it('20 RTL tokens count as 20 words → 7000ms', () => {
    expectDwellBoundary({ text: Array.from({ length: 20 }, (_, i) => `كلمة${i}`).join(' ') }, 7000);
  });

  it('irregular whitespace (tabs, newlines, runs of spaces) between 20 words still → 7000ms', () => {
    const text = Array.from({ length: 20 }, (_, i) => `w${i}`).join('  \t\n ');
    expectDwellBoundary({ text: ` ${text} ` }, 7000);
  });
});

// ============================================================
// 6. dwellMs prop hostility
// ============================================================
describe('DecayingQuote -- dwellMs prop hostility', () => {
  // 20-word text → heuristic 7000ms. Every invalid dwellMs must fall
  // back to 7000, which also proves the invalid value was not used.
  const TEXT20 = words(20);

  it('positive finite dwellMs=1000 is used verbatim over the heuristic', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: 1000 }, 1000);
  });

  it('dwellMs=1 (minimum positive) is honored', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: 1 }, 1);
  });

  it("dwellMs='5000' (string) is NOT honored — heuristic 7000 applies", () => {
    const el = expectDwellBoundary({ text: TEXT20, dwellMs: '5000' as any }, 7000);
    expect(el).toBeTruthy();
  });

  it('dwellMs=0 falls back to the heuristic', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: 0 }, 7000);
  });

  it('dwellMs=-0 falls back to the heuristic (negative zero is not positive)', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: -0 }, 7000);
  });

  it('dwellMs=NaN falls back to the heuristic', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: NaN }, 7000);
  });

  it('dwellMs=Infinity falls back to the heuristic', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: Infinity }, 7000);
  });

  it('dwellMs=-Infinity falls back to the heuristic', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: -Infinity }, 7000);
  });

  it('dwellMs=-100 falls back to the heuristic', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: -100 }, 7000);
  });

  it('dwellMs=null falls back to the heuristic', () => {
    expectDwellBoundary({ text: TEXT20, dwellMs: null as any }, 7000);
  });

  it('dwellMs=Number.MAX_SAFE_INTEGER is used verbatim — 100000s of dwell never decays', () => {
    const { container } = renderQuote({ text: TEXT20, dwellMs: Number.MAX_SAFE_INTEGER });
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(100_000_000);
    expect(decayApplied(el)).toBe(false);
  });
});

// ============================================================
// 7. Cumulative visibility clock — slice banking arithmetic
// ============================================================
describe('DecayingQuote -- cumulative visibility clock', () => {
  const P = { text: words(3), dwellMs: 1000 };

  it('enter(400) / exit / enter(600) = 1000 cumulative → decay at exactly the banked boundary', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(400);
    triggerIntersection(false);
    vi.advanceTimersByTime(30_000); // off-screen — contributes ZERO
    triggerIntersection(true);
    vi.advanceTimersByTime(599); // cumulative 999
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1); // cumulative 1000
    expect(decayApplied(el)).toBe(true);
  });

  it('exit mid-dwell clears the pending timer — decay never fires while off-screen', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(600);
    triggerIntersection(false);
    // the original timer would have fired at absolute 1000 — a leaked
    // timer decays off-screen here
    vi.advanceTimersByTime(60_000);
    expect(decayApplied(el)).toBe(false);
    // banked time survives: 399 more visible ms is not enough, 400 is
    triggerIntersection(true);
    vi.advanceTimersByTime(399);
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(decayApplied(el)).toBe(true);
  });

  it('duplicate enters neither double-count nor reset the clock', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    triggerIntersection(true);
    triggerIntersection(true); // duplicate — ignored
    vi.advanceTimersByTime(500);
    triggerIntersection(true); // duplicate mid-slice — must not reset the slice start
    vi.advanceTimersByTime(499); // true cumulative 999
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1); // 1000
    expect(decayApplied(el)).toBe(true);
  });

  it('exit-before-any-enter and duplicate exits do not crash, bank, or corrupt the clock', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    expect(() => {
      triggerIntersection(false);
      triggerIntersection(false);
      vi.advanceTimersByTime(60_000);
    }).not.toThrow();
    expect(decayApplied(el)).toBe(false);
    triggerIntersection(true);
    vi.advanceTimersByTime(999);
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(decayApplied(el)).toBe(true);
  });

  it('200 zero-duration enter/exit cycles bank NOTHING', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    for (let i = 0; i < 200; i++) {
      triggerIntersection(true);
      triggerIntersection(false);
    }
    triggerIntersection(true);
    vi.advanceTimersByTime(999); // a per-event increment bug decays here
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(decayApplied(el)).toBe(true);
  });

  it('ten 100ms fragments with gaps: decay lands exactly on the last banked ms', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    for (let i = 0; i < 9; i++) {
      triggerIntersection(true);
      vi.advanceTimersByTime(100);
      triggerIntersection(false);
      vi.advanceTimersByTime(5_000);
      expect(decayApplied(el)).toBe(false);
    }
    triggerIntersection(true); // 900 banked
    vi.advanceTimersByTime(99); // 999
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1); // 1000
    expect(decayApplied(el)).toBe(true);
  });

  it('enter-exit-enter thrash straddling the threshold EXACTLY (2500+2499+1 of 5000)', () => {
    const { container } = renderQuote({ text: words(3), dwellMs: 5000 });
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(2500);
    triggerIntersection(false);
    vi.advanceTimersByTime(10_000);
    triggerIntersection(true);
    vi.advanceTimersByTime(2499); // 4999
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1); // 5000 — synchronous decay
    expect(decayApplied(el)).toBe(true);
  });

  it('threshold reached only at exit-time banking (forward clock jump): decays on the NEXT enter, never off-screen', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    triggerIntersection(true);
    // jump Date.now() forward WITHOUT firing the pending timer
    vi.setSystemTime(Date.now() + 2000);
    triggerIntersection(false); // banks 2000 >= 1000 — armed, but off-screen
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(60_000); // still off-screen: never decays
    expect(decayApplied(el)).toBe(false);
    triggerIntersection(true); // next enter — decay starts now
    vi.advanceTimersByTime(0);
    expect(decayApplied(el)).toBe(true);
  });
});

// ============================================================
// 8. Hostile observer traffic — batching, ordering, garbage entries
// ============================================================
describe('DecayingQuote -- hostile observer traffic', () => {
  const P = { text: words(3), dwellMs: 1000 };

  it('a single callback batching [enter, exit] processed in order banks ~0 and leaves no live timer', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    mockObserverInstances[0].callback([makeEntry(true), makeEntry(false)]);
    vi.advanceTimersByTime(60_000); // a surviving enter-timer decays here
    expect(decayApplied(el)).toBe(false);
    // and nothing was banked
    triggerIntersection(true);
    vi.advanceTimersByTime(999);
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(decayApplied(el)).toBe(true);
  });

  it('a single callback batching [exit, enter] ends VISIBLE — the clock runs', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    mockObserverInstances[0].callback([makeEntry(false), makeEntry(true)]);
    vi.advanceTimersByTime(999);
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(decayApplied(el)).toBe(true);
  });

  it('null entry array, empty array, and null entries neither crash nor start the clock', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    expect(() => {
      mockObserverInstances[0].callback([] as any);
      mockObserverInstances[0].callback([null] as any);
      mockObserverInstances[0].callback([undefined, null] as any);
    }).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(decayApplied(el)).toBe(false);
  });

  it('entry missing isIntersecting is not an enter — no clock, no crash, and recovery works', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    expect(() => {
      mockObserverInstances[0].callback([{} as any]);
    }).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(decayApplied(el)).toBe(false);
    // machinery still functional afterwards
    triggerIntersection(true);
    vi.advanceTimersByTime(1000);
    expect(decayApplied(el)).toBe(true);
  });

  it('Date.now() jumping BACKWARDS between enter and exit: negative slice clamps to 0, no crash, clock recovers exactly', () => {
    const { container } = renderQuote(P);
    const el = qEl(container);
    triggerIntersection(true);
    vi.setSystemTime(Date.now() - 5000); // clock goes backwards mid-slice
    expect(() => triggerIntersection(false)).not.toThrow();
    // |negative| banked as positive would decay immediately on re-enter
    triggerIntersection(true);
    vi.advanceTimersByTime(0);
    expect(decayApplied(el)).toBe(false);
    // negative banked (unclamped) would push the boundary past 1000
    vi.advanceTimersByTime(999);
    expect(decayApplied(el)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(decayApplied(el)).toBe(true);
  });
});

// ============================================================
// 9. Decay start — duration semantics & synchrony
// ============================================================
describe('DecayingQuote -- decay start & duration semantics', () => {
  function startDecay(extraProps: Record<string, any> = {}) {
    const { container } = renderQuote({ text: words(3), dwellMs: 1000, ...extraProps });
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(1000);
    return el;
  }

  it('decay is synchronously observable the moment the dwell timer fires', () => {
    const el = startDecay();
    expect(decayApplied(el)).toBe(true);
  });

  it('default decayDuration → 12s observable on the element inline style after start', () => {
    const el = startDecay();
    expect(el.getAttribute('style') || '').toContain('12s');
  });

  it('decayDuration=30 → 30s after start (and no 12s default leaking)', () => {
    const el = startDecay({ decayDuration: 30 });
    const style = el.getAttribute('style') || '';
    expect(style).toContain('30s');
    expect(style).not.toContain('12s');
  });

  it('decayDuration=0 → 0s (instant hide) after start', () => {
    const el = startDecay({ decayDuration: 0 });
    expect(el.getAttribute('style') || '').toContain('0s');
  });

  it('decayDuration=-5 clamps to 0s — never a negative duration', () => {
    const el = startDecay({ decayDuration: -5 });
    const style = el.getAttribute('style') || '';
    expect(style).not.toContain('-5s');
    expect(style).toContain('0s');
  });

  it('decayDuration=NaN falls back to 12s', () => {
    const el = startDecay({ decayDuration: NaN });
    const style = el.getAttribute('style') || '';
    expect(style).not.toContain('NaN');
    expect(style).toContain('12s');
  });

  it('the applied animation fills forwards', () => {
    const el = startDecay();
    expect(appliedAnimationText(el).toLowerCase()).toContain('forwards');
  });

  it('the applied animation uses ease-in timing', () => {
    const el = startDecay();
    expect(appliedAnimationText(el).toLowerCase()).toContain('ease-in');
  });
});

// ============================================================
// 10. Decay permanence — never restarts or re-applies
// ============================================================
describe('DecayingQuote -- decay permanence', () => {
  it('after decay starts, 10 exit/enter cycles + 60s change neither style attr nor class list', () => {
    const { container } = renderQuote({ text: words(3), dwellMs: 1000 });
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(1000);
    expect(decayApplied(el)).toBe(true);
    const styleSnap = el.getAttribute('style');
    const classSnap = Array.from(el.classList).sort().join(' ');
    for (let i = 0; i < 10; i++) {
      triggerIntersection(false);
      triggerIntersection(true);
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(60_000);
    expect(el.getAttribute('style')).toBe(styleSnap);
    expect(Array.from(el.classList).sort().join(' ')).toBe(classSnap);
  });

  it('post-decay batched garbage callbacks are inert', () => {
    const { container } = renderQuote({ text: words(3), dwellMs: 1000 });
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(1000);
    const snap = el.outerHTML;
    expect(() => {
      mockObserverInstances[0].callback([makeEntry(true), makeEntry(false), null as any, {} as any]);
      vi.advanceTimersByTime(60_000);
    }).not.toThrow();
    expect(el.outerHTML).toBe(snap);
  });
});

// ============================================================
// 11. prefers-reduced-motion — never decays, no observer
// ============================================================
describe('DecayingQuote -- reduced motion never decays', () => {
  beforeEach(() => {
    mockReducedMotion(true);
  });

  it('constructs NO IntersectionObserver at all', () => {
    renderQuote({ text: words(20) });
    expect(mockObserverInstances.length).toBe(0);
  });

  it('schedules NO timers — at mount and after 600s', () => {
    renderQuote({ text: words(20), dwellMs: 1000 });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('text permanently visible: no decay after 600s, even if a stray observer exists and fires', () => {
    const { container } = renderQuote({ text: words(3), dwellMs: 1000 });
    const el = qEl(container);
    vi.advanceTimersByTime(600_000);
    if (mockObserverInstances.length > 0) {
      triggerIntersection(true);
      vi.advanceTimersByTime(600_000);
      triggerIntersection(false);
      triggerIntersection(true);
    }
    vi.advanceTimersByTime(600_000);
    expect(decayApplied(el)).toBe(false);
    expect(el.textContent).toContain('token0');
  });

  it('reduced-motion CSS block still exists and neutralizes animation', () => {
    renderQuote({ text: 'Reduced motion check' });
    const css = getInjectedCss();
    expect(css).toContain('prefers-reduced-motion');
    const rmBlock = css.split('prefers-reduced-motion')[1] || '';
    const disables =
      /animation\s*:\s*none/.test(rmBlock) ||
      /animation-duration\s*:\s*0/.test(rmBlock) ||
      /animation-name\s*:\s*none/.test(rmBlock);
    expect(disables).toBe(true);
  });
});

// ============================================================
// 11b. Non-reduced test AFTER the reduced block — mock-leak guard
// ============================================================
describe('DecayingQuote -- decay still works after the reduced-motion describe', () => {
  it('a component rendered here (reduced=false) observes and decays', () => {
    const { container } = renderQuote({ text: words(3), dwellMs: 1000 });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    triggerIntersection(true);
    vi.advanceTimersByTime(1000);
    expect(decayApplied(qEl(container))).toBe(true);
  });
});

// ============================================================
// 12. Environment without IntersectionObserver
// ============================================================
describe('DecayingQuote -- no IntersectionObserver in environment', () => {
  beforeEach(() => {
    delete (globalThis as any).IntersectionObserver;
  });

  it('renders without crashing', () => {
    expect(() => renderQuote({ text: words(20) })).not.toThrow();
  });

  it('never decays: text still fully visible after 600s', () => {
    const { container } = renderQuote({ text: words(3), dwellMs: 1000 });
    const el = qEl(container);
    vi.advanceTimersByTime(600_000);
    expect(decayApplied(el)).toBe(false);
    expect(el.textContent).toContain('token0');
  });

  it('unmount is clean — no timers, no throw', () => {
    const { unmount } = renderQuote({ text: words(3), dwellMs: 1000 });
    expect(() => unmount()).not.toThrow();
    expect(() => vi.advanceTimersByTime(600_000)).not.toThrow();
  });
});

// ============================================================
// 13. CSS contract — keyframes, hover pause, typography
// ============================================================
describe('DecayingQuote -- CSS contract', () => {
  it('component defines a @keyframes rule for the decay animation', () => {
    renderQuote({ text: 'Keyframed' });
    expect(getInjectedCss()).toMatch(/@keyframes\s+\S*[dD]ecay/);
  });

  it('keyframes animate to opacity: 0', () => {
    renderQuote({ text: 'Fading to nothing' });
    expect(getInjectedCss()).toMatch(/opacity\s*:\s*0/);
  });

  it('keyframes end state includes visibility: hidden', () => {
    renderQuote({ text: 'Hidden at end' });
    expect(getInjectedCss()).toMatch(/visibility\s*:\s*hidden/);
  });

  it(':hover rule pauses a running decay via animation-play-state: paused', () => {
    renderQuote({ text: 'Pause on hover' });
    const css = getInjectedCss();
    expect(css).toContain(':hover');
    expect(css).toMatch(/animation-play-state\s*:\s*paused/);
  });

  it('quote text uses serif font family', () => {
    renderQuote({ text: 'Serif check' });
    expect(getInjectedCss().toLowerCase()).toContain('serif');
  });
});

// ============================================================
// 14. Accessibility — aria-label carries the full coerced text
// ============================================================
describe('DecayingQuote -- accessibility', () => {
  it('container has aria-label matching the quote text', () => {
    const text = 'The bottleneck is the identity.';
    const { getByTestId } = renderQuote({ text });
    expect(getByTestId('decaying-quote').getAttribute('aria-label')).toBe(text);
  });

  it('empty text produces an aria-label attribute (empty, not missing)', () => {
    const { getByTestId } = renderQuote({ text: '' });
    expect(getByTestId('decaying-quote').hasAttribute('aria-label')).toBe(true);
  });

  it('whitespace-only text is carried verbatim in aria-label', () => {
    const ws = '   \t\n   ';
    const { getByTestId } = renderQuote({ text: ws });
    expect(getByTestId('decaying-quote').getAttribute('aria-label')).toBe(ws);
  });

  it('number text coerces into the aria-label', () => {
    const { getByTestId } = renderQuote({ text: 42 as any });
    expect(getByTestId('decaying-quote').getAttribute('aria-label')).toBe('42');
  });

  it('unicode/emoji/RTL text renders and is carried in aria-label', () => {
    const text = '\u{1F30A} 注意力のボトルネック مرحبا \u{1F30A}';
    const { getByTestId } = renderQuote({ text });
    const el = getByTestId('decaying-quote');
    expect(el.textContent).toContain(text);
    expect(el.getAttribute('aria-label')).toBe(text);
  });

  it('aria-label survives decay start unchanged', () => {
    const text = words(3);
    const { getByTestId } = renderQuote({ text, dwellMs: 1000 });
    triggerIntersection(true);
    vi.advanceTimersByTime(1000);
    expect(getByTestId('decaying-quote').getAttribute('aria-label')).toBe(text);
  });
});

// ============================================================
// 15. Unmount — observer disconnect, timer hygiene, zombies
// ============================================================
describe('DecayingQuote -- unmount & zombie hygiene', () => {
  const P = { text: words(3), dwellMs: 1000 };

  it('unmount removes the container from the DOM', () => {
    const { getByTestId, unmount } = renderQuote({ text: 'Temporary' });
    expect(getByTestId('decaying-quote')).toBeTruthy();
    unmount();
    expect(document.querySelector('[data-testid="decaying-quote"]')).toBeNull();
  });

  it('unmount disconnects the IntersectionObserver', () => {
    const { unmount } = renderQuote(P);
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    unmount();
    const cleaned = mockObserverInstances.some(
      (o) => o.disconnect.mock.calls.length > 0 || o.unobserve.mock.calls.length > 0,
    );
    expect(cleaned).toBe(true);
  });

  it('unmount mid-dwell (1ms before decay) clears the timer — zero timers remain, detached node never mutates', () => {
    const { container, unmount } = renderQuote(P);
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(999);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const snap = el.outerHTML;
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(el.outerHTML).toBe(snap);
    expect(decayApplied(el)).toBe(false);
  });

  it('zombie observer callbacks after unmount neither throw nor mutate the document', () => {
    const { unmount } = renderQuote(P);
    triggerIntersection(true);
    vi.advanceTimersByTime(500);
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

  it('unmount racing the decay-start moment: advance fires decay, unmount immediately after — clean', () => {
    const { container, unmount } = renderQuote(P);
    const el = qEl(container);
    triggerIntersection(true);
    vi.advanceTimersByTime(1000); // decay starts
    expect(decayApplied(el)).toBe(true);
    expect(() => unmount()).not.toThrow();
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(document.querySelector('[data-testid="decaying-quote"]')).toBeNull();
  });
});

// ============================================================
// 16. Multiple instances — independent clocks
// ============================================================
describe('DecayingQuote -- multiple instances are independent', () => {
  it('dwelling only on instance B decays B and leaves A untouched', () => {
    const a = renderQuote({ text: words(3, 'alpha'), dwellMs: 1000 });
    const b = renderQuote({ text: words(3, 'beta'), dwellMs: 1000 });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(2);
    const aEl = qEl(a.container);
    const bEl = qEl(b.container);
    const aSnap = aEl.outerHTML;
    triggerIntersection(true, 1);
    vi.advanceTimersByTime(1000);
    expect(decayApplied(bEl)).toBe(true);
    expect(decayApplied(aEl)).toBe(false);
    expect(aEl.outerHTML).toBe(aSnap);
  });
});
