import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import CareTerminal from './CareTerminal.svelte';

// ============================================================
// PINNED CONTRACT (test-defined, component must conform)
//
// data-testids:
//   care-terminal       — root terminal box
//   terminal-animated   — animated region, aria-hidden="true" at ALL times
//   terminal-line       — one per script line (inside terminal-animated)
//   terminal-cursor     — block cursor element (inside terminal-animated)
//   terminal-interrupt  — the interruptText line (inside care-terminal)
//   sr-transcript       — sr-only full transcript (lines + interruptText)
//
// cursor classes: 'blinking' while typing; after the final line
// completes the cursor carries 'frozen' and NOT 'blinking'.
//
// Timing convention (t=0 is the first IO intersection):
//   - at t=0 nothing is typed
//   - first char of line 0 appears at t = charDelay
//   - char k of a line appears charDelay after char k-1
//     (a line of length L completes L*charDelay after its start)
//   - line N+1's first char appears lineDelay + charDelay after
//     line N's last char
//   - interruptText appears interruptDelay after the final char
//     of the final line (for lines=[]: interruptDelay after trigger)
// ============================================================

// ============================================================
// IntersectionObserver mock infrastructure (per ScrollSection.test.ts)
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

function triggerIntersection(isIntersecting: boolean, observerIndex = 0) {
  const observer = mockObserverInstances[observerIndex];
  if (!observer) throw new Error(`No observer at index ${observerIndex}`);
  const entry = {
    isIntersecting,
    intersectionRatio: isIntersecting ? 1.0 : 0.0,
    target: {} as Element,
    boundingClientRect: {} as DOMRectReadOnly,
    intersectionRect: {} as DOMRectReadOnly,
    rootBounds: null,
    time: Date.now(),
  } as IntersectionObserverEntry;
  observer.callback([entry]);
}

function installMockIO() {
  const MockIO = createMockIOClass();
  (globalThis as any).IntersectionObserver = MockIO;
  return MockIO;
}

// ============================================================
// matchMedia mock — ISOLATED per describe.
// A past bug was a matchMedia mock leaking between describe blocks:
// the original is captured once at module load and force-restored in
// the file-level afterEach; every describe that cares installs its own
// value in its own beforeEach (never relies on a previous block).
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

// File-level baseline: every test gets fake timers, a fresh IO mock and
// an explicit reduced-motion=false — no test depends on leakage.
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

/** Text of each terminal-line, with any cursor element's text stripped. */
function lineTexts(root: Element): string[] {
  return qa(root, 'terminal-line').map((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('[data-testid="terminal-cursor"]')
      .forEach((c) => c.remove());
    return clone.textContent ?? '';
  });
}

/** All typed script text so far, concatenated across lines. */
function typedText(root: Element): string {
  return lineTexts(root).join('');
}

// ============================================================
// Injected-CSS helpers (compilerOptions.css === 'injected')
// ============================================================

function getInjectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

function cssRuleBodiesFor(className: string): string[] {
  const css = getInjectedCss();
  const bodies: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes('.' + className)) bodies.push(m[2]);
  }
  return bodies;
}

/** Contents of every `@media (prefers-reduced-motion: reduce)` block. */
function extractReducedMotionCss(): string {
  const css = getInjectedCss();
  const out: string[] = [];
  for (const m of css.matchAll(
    /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/g,
  )) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out.join('\n');
}

// ============================================================
// Shared fixtures
// ============================================================

const AB_CD = {
  lines: ['ab', 'cd'],
  charDelay: 10,
  lineDelay: 100,
  interruptDelay: 50,
};
// AB_CD timeline: a@10, ab@20, c@130 (20+100+10), cd@140, interrupt@190

function renderTerminal(props: Record<string, any> = {}) {
  return render(CareTerminal, { props });
}

// ============================================================
// 1. Mount & pre-trigger state
// ============================================================
describe('CareTerminal -- mount & pre-trigger', () => {
  it('renders root data-testid="care-terminal" without crashing', () => {
    const { container } = renderTerminal({ lines: ['$ hello'] });
    expect(q(container, 'care-terminal')).toBeTruthy();
  });

  it('mounts without crashing when all props are omitted', () => {
    expect(() => render(CareTerminal, { props: {} })).not.toThrow();
  });

  it('types NOTHING before the component intersects, even after 60s', () => {
    const { container } = renderTerminal({ ...AB_CD });
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('');
    expect(q(container, 'terminal-interrupt')).toBeNull();
  });

  it('creates an IntersectionObserver and observes an element', () => {
    renderTerminal({ lines: ['x'] });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    expect(mockObserverInstances[0].observe).toHaveBeenCalled();
  });

  it('animated region has aria-hidden="true" from mount onward', () => {
    const { container } = renderTerminal({ ...AB_CD });
    const animated = q(container, 'terminal-animated');
    expect(animated).toBeTruthy();
    expect(animated!.getAttribute('aria-hidden')).toBe('true');
    triggerIntersection(true);
    vi.advanceTimersByTime(15); // mid-typing
    expect(animated!.getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(60_000); // final state
    expect(animated!.getAttribute('aria-hidden')).toBe('true');
  });

  it('sr transcript exists BEFORE any animation with full lines + interruptText', () => {
    const { container } = renderTerminal({
      lines: ['$ tamagotchi status', '$ tamagotchi clea'],
      interruptText: 'SESSION ENDED',
    });
    // no intersection triggered, no timers advanced
    const sr = q(container, 'sr-transcript');
    expect(sr).toBeTruthy();
    const srText = sr!.textContent || '';
    expect(srText).toContain('$ tamagotchi status');
    expect(srText).toContain('$ tamagotchi clea');
    expect(srText).toContain('SESSION ENDED');
  });

  it('sr transcript carries an sr-only class and is NOT aria-hidden', () => {
    const { container } = renderTerminal({ lines: ['x'] });
    const sr = q(container, 'sr-transcript')!;
    expect(sr.classList.contains('sr-only')).toBe(true);
    expect(sr.getAttribute('aria-hidden')).not.toBe('true');
  });

  it('sr transcript stays complete mid-animation (does not mirror progress)', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(10); // only "a" typed
    const srText = q(container, 'sr-transcript')!.textContent || '';
    expect(srText).toContain('ab');
    expect(srText).toContain('cd');
    expect(srText).toContain('SESSION ENDED');
  });

  it('injected CSS uses a dark terminal background (#0f0f0f or #1A1D23) and a mono font stack', () => {
    renderTerminal({ lines: ['x'] });
    const css = getInjectedCss().toLowerCase();
    expect(/#0f0f0f|#1a1d23/.test(css)).toBe(true);
    expect(/font-family[^;]*mono/.test(css)).toBe(true);
  });
});

// ============================================================
// 2. Exact timer arithmetic
// ============================================================
describe('CareTerminal -- exact timer arithmetic', () => {
  it('["ab","cd"] @ charDelay=10/lineDelay=100/interruptDelay=50: every boundary is exact', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true); // t=0

    expect(typedText(container)).toBe(''); // t=0: nothing
    vi.advanceTimersByTime(9); // t=9
    expect(typedText(container)).toBe('');
    vi.advanceTimersByTime(1); // t=10
    expect(typedText(container)).toBe('a');
    vi.advanceTimersByTime(9); // t=19
    expect(typedText(container)).toBe('a');
    vi.advanceTimersByTime(1); // t=20 — line 1 complete
    expect(typedText(container)).toBe('ab');
    vi.advanceTimersByTime(109); // t=129 — still in lineDelay+charDelay window
    expect(typedText(container)).toBe('ab');
    vi.advanceTimersByTime(1); // t=130 — first char of line 2
    expect(typedText(container)).toBe('abc');
    vi.advanceTimersByTime(9); // t=139
    expect(typedText(container)).toBe('abc');
    vi.advanceTimersByTime(1); // t=140 — final char
    expect(typedText(container)).toBe('abcd');
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(49); // t=189
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=190
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('default delays (24/400/900) with a single line "hi": boundaries at 24/48/948', () => {
    const { container } = renderTerminal({ lines: ['hi'] });
    triggerIntersection(true);
    vi.advanceTimersByTime(23);
    expect(typedText(container)).toBe('');
    vi.advanceTimersByTime(1); // t=24
    expect(typedText(container)).toBe('h');
    vi.advanceTimersByTime(23); // t=47
    expect(typedText(container)).toBe('h');
    vi.advanceTimersByTime(1); // t=48
    expect(typedText(container)).toBe('hi');
    vi.advanceTimersByTime(899); // t=947
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=948
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('10 one-char lines @ 5/20/10: 9 lines at t=229, all 10 at t=230, interrupt at t=240', () => {
    const lines = Array.from({ length: 10 }, (_, i) => String(i));
    const { container } = renderTerminal({
      lines,
      charDelay: 5,
      lineDelay: 20,
      interruptDelay: 10,
    });
    triggerIntersection(true);
    // line k (1 char) completes at 5 + 25k
    vi.advanceTimersByTime(229);
    expect(typedText(container)).toBe('012345678');
    vi.advanceTimersByTime(1); // t=230
    expect(typedText(container)).toBe('0123456789');
    vi.advanceTimersByTime(9); // t=239
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=240
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('intermediate typed text is always a strict prefix of the full script', () => {
    const lines = ['first line', 'second line'];
    const full = lines.join('');
    const { container } = renderTerminal({
      lines,
      charDelay: 7,
      lineDelay: 31,
      interruptDelay: 13,
    });
    triggerIntersection(true);
    let prev = '';
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(7);
      const now = typedText(container);
      expect(full.startsWith(now)).toBe(true);
      expect(now.length).toBeGreaterThanOrEqual(prev.length);
      prev = now;
    }
  });

  it('after completion, each terminal-line holds exactly its input text in order', () => {
    const lines = ['$ tamagotchi feed', '  Echo fed → 100%', '$ tamagotchi clea'];
    const { container } = renderTerminal({
      lines,
      charDelay: 1,
      lineDelay: 5,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(lineTexts(container)).toEqual(lines);
  });

  it('does NOT truncate or "complete" the already-truncated last line', () => {
    const { container } = renderTerminal({
      lines: ['$ tamagotchi clea'],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(lineTexts(container)).toEqual(['$ tamagotchi clea']);
    expect(typedText(container)).not.toContain('clean'); // no helpful completion
    expect(typedText(container)).not.toContain('…');
    expect(typedText(container)).not.toContain('...');
  });

  it('DOM stabilizes after the interrupt — 10 more minutes changes nothing', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(190);
    const snapshot = container.innerHTML;
    vi.advanceTimersByTime(600_000);
    expect(container.innerHTML).toBe(snapshot);
  });
});

// ============================================================
// 3. Empty / single / degenerate lines
// ============================================================
describe('CareTerminal -- empty and degenerate lines', () => {
  it('lines=[] : ONLY the interrupt appears, exactly interruptDelay after trigger', () => {
    const { container } = renderTerminal({
      lines: [],
      interruptDelay: 300,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(299);
    expect(q(container, 'terminal-interrupt')).toBeNull();
    expect(typedText(container)).toBe('');
    vi.advanceTimersByTime(1); // t=300
    const interrupt = q(container, 'terminal-interrupt');
    expect(interrupt).toBeTruthy();
    expect(interrupt!.textContent).toContain('SESSION ENDED');
    expect(typedText(container)).toBe('');
  });

  it('lines prop omitted entirely behaves like lines=[]', () => {
    const { container } = renderTerminal({ interruptDelay: 100 });
    triggerIntersection(true);
    vi.advanceTimersByTime(99);
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(typedText(container)).toBe('');
  });

  it('single empty-string line [""] does not stall: interrupt still arrives, no chars typed', () => {
    const { container } = renderTerminal({
      lines: [''],
      charDelay: 10,
      lineDelay: 100,
      interruptDelay: 50,
    });
    triggerIntersection(true);
    // generous budget: empty line has 0 chars to type
    vi.advanceTimersByTime(10 + 100 + 50);
    expect(typedText(container)).toBe('');
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it('an empty line SANDWICHED between lines does not break the sequence', () => {
    const { container } = renderTerminal({
      lines: ['a', '', 'b'],
      charDelay: 5,
      lineDelay: 10,
      interruptDelay: 10,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(typedText(container)).toBe('ab');
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('single one-char line completes and freezes correctly', () => {
    const { container } = renderTerminal({
      lines: ['x'],
      charDelay: 10,
      interruptDelay: 20,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10);
    expect(typedText(container)).toBe('x');
    vi.advanceTimersByTime(19);
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });
});

// ============================================================
// 4. Long lines & hostile delay values
// ============================================================
describe('CareTerminal -- long lines & delay edge cases', () => {
  it('a 5000-char line completes at EXACTLY 5000ms with charDelay=1 (off-by-one pinned)', () => {
    const long = 'x'.repeat(5000);
    const { container } = renderTerminal({
      lines: [long],
      charDelay: 1,
      interruptDelay: 100,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(4999);
    expect(typedText(container).length).toBe(4999);
    expect(long.startsWith(typedText(container))).toBe(true);
    vi.advanceTimersByTime(1); // t=5000
    expect(typedText(container)).toBe(long);
    vi.advanceTimersByTime(99); // t=5099
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=5100
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('charDelay=0 does not throw or hang, and eventually completes fully', () => {
    const { container } = renderTerminal({
      lines: ['fast', 'done'],
      charDelay: 0,
      lineDelay: 10,
      interruptDelay: 10,
    });
    expect(() => {
      triggerIntersection(true);
      vi.advanceTimersByTime(10_000);
    }).not.toThrow();
    expect(typedText(container)).toBe('fastdone');
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('negative charDelay does not throw or infinite-loop, and eventually completes', () => {
    const { container } = renderTerminal({
      lines: ['neg'],
      charDelay: -5,
      lineDelay: 10,
      interruptDelay: 10,
    });
    expect(() => {
      triggerIntersection(true);
      vi.advanceTimersByTime(10_000);
    }).not.toThrow();
    expect(typedText(container)).toBe('neg');
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('negative interruptDelay does not throw; interrupt still eventually renders', () => {
    const { container } = renderTerminal({
      lines: ['x'],
      charDelay: 5,
      interruptDelay: -100,
    });
    expect(() => {
      triggerIntersection(true);
      vi.advanceTimersByTime(10_000);
    }).not.toThrow();
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });
});

// ============================================================
// 5. Unicode / encoding fidelity
// ============================================================
describe('CareTerminal -- unicode & encoding fidelity', () => {
  it('emoji + arrow line renders with full fidelity in animated region AND sr transcript', () => {
    const line = '🜁 fed Echo → 100%';
    const { container } = renderTerminal({
      lines: [line],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(typedText(container)).toBe(line);
    expect(q(container, 'sr-transcript')!.textContent).toContain(line);
  });

  it('RTL text survives typing intact', () => {
    const line = 'مرحبا بالعالم — status: alive';
    const { container } = renderTerminal({
      lines: [line],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(typedText(container)).toBe(line);
    expect(q(container, 'sr-transcript')!.textContent).toContain(line);
  });

  it('combining characters are preserved exactly (no mark/base separation in final text)', () => {
    const line = 'café statús̀ nẽé'; // includes combining marks
    const { container } = renderTerminal({
      lines: [line],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(typedText(container)).toBe(line);
    expect(q(container, 'sr-transcript')!.textContent).toContain(line);
  });

  it('ZWJ emoji sequence line is not corrupted', () => {
    const line = '👨‍👩‍👧‍👦 family check-in';
    const { container } = renderTerminal({
      lines: [line],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(typedText(container)).toBe(line);
  });

  it('unicode interruptText renders with full fidelity', () => {
    const { container } = renderTerminal({
      lines: ['x'],
      charDelay: 1,
      interruptDelay: 5,
      interruptText: '⏻ SESSIÓN TERMINÉE ⏻',
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect(q(container, 'terminal-interrupt')!.textContent).toContain(
      '⏻ SESSIÓN TERMINÉE ⏻',
    );
  });
});

// ============================================================
// 6. XSS / injection (rule 7: textContent only, never innerHTML)
// ============================================================
describe('CareTerminal -- XSS & injection', () => {
  const IMG_XSS = '<img src=x onerror="window.__pwned=1">';

  it('img-onerror payload renders as LITERAL text; no img element; __pwned stays undefined', () => {
    const { container } = renderTerminal({
      lines: ['$ echo ' + IMG_XSS, IMG_XSS],
      charDelay: 1,
      lineDelay: 5,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toContain(IMG_XSS);
    expect(document.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('img payload in the SR transcript is also literal text with no img element', () => {
    const { container } = renderTerminal({ lines: [IMG_XSS] });
    // sr transcript is full before any animation — no trigger needed
    const sr = q(container, 'sr-transcript')!;
    expect(sr.textContent).toContain(IMG_XSS);
    expect(sr.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('script-tag line never creates a script element', () => {
    const payload = '<script>window.__pwned=1<' + '/script>';
    const { container } = renderTerminal({
      lines: [payload],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe(payload);
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('malicious interruptText is rendered as literal text, not markup', () => {
    const payload = '<b onmouseover="window.__pwned=1">SESSION ENDED</b>';
    const { container } = renderTerminal({
      lines: [],
      interruptDelay: 10,
      interruptText: payload,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    const interrupt = q(container, 'terminal-interrupt')!;
    expect(interrupt.textContent).toContain(payload);
    expect(interrupt.querySelector('b')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('HTML entities in lines stay literal (not decoded)', () => {
    const line = '&amp; &lt;fed&gt; &quot;Echo&quot;';
    const { container } = renderTerminal({
      lines: [line],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe(line);
  });
});

// ============================================================
// 7. Interrupt line semantics
// ============================================================
describe('CareTerminal -- interrupt line', () => {
  it('default interruptText is "SESSION ENDED"', () => {
    const { container } = renderTerminal({
      lines: ['x'],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    expect((q(container, 'terminal-interrupt')!.textContent || '').trim()).toBe(
      'SESSION ENDED',
    );
  });

  it('interrupt renders INSIDE the terminal box, on its own line (not inside a terminal-line)', () => {
    const { container } = renderTerminal({
      lines: ['x'],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    const interrupt = q(container, 'terminal-interrupt')!;
    expect(q(container, 'care-terminal')!.contains(interrupt)).toBe(true);
    expect(interrupt.closest('[data-testid="terminal-line"]')).toBeNull();
  });

  it('interrupt element carries a class styled visually distinct (letter-spacing / opacity / color)', () => {
    const { container } = renderTerminal({
      lines: ['x'],
      charDelay: 1,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10_000);
    const interrupt = q(container, 'terminal-interrupt')!;
    expect(interrupt.classList.length).toBeGreaterThan(0);
    const styled = Array.from(interrupt.classList).some((c) =>
      cssRuleBodiesFor(c).join('\n').match(/letter-spacing|opacity|color/),
    );
    expect(styled).toBe(true);
  });

  it('interruptText="" renders NO interrupt element (no stray empty styled line)', () => {
    const { container } = renderTerminal({
      lines: ['x'],
      charDelay: 1,
      interruptDelay: 5,
      interruptText: '',
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(q(container, 'terminal-interrupt')).toBeNull();
  });

  it('exactly ONE interrupt element ever renders, even long after completion', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
  });

  it('interrupt never appears while lines are still typing', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    for (const t of [10, 20, 100, 5]) {
      vi.advanceTimersByTime(t); // through t=135, mid line 2
      expect(q(container, 'terminal-interrupt')).toBeNull();
    }
  });
});

// ============================================================
// 8. Cursor & CSS blink
// ============================================================
describe('CareTerminal -- cursor & blink CSS', () => {
  it('cursor exists and carries "blinking" while typing', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(15); // mid line 1
    const cursor = q(container, 'terminal-cursor');
    expect(cursor).toBeTruthy();
    expect(cursor!.classList.contains('blinking')).toBe(true);
    expect(q(container, 'terminal-animated')!.contains(cursor!)).toBe(true);
  });

  it('cursor STILL EXISTS after final char but is frozen: class "frozen", not "blinking"', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(140); // final char just landed
    const cursor = q(container, 'terminal-cursor');
    expect(cursor).toBeTruthy();
    expect(cursor!.classList.contains('frozen')).toBe(true);
    expect(cursor!.classList.contains('blinking')).toBe(false);
  });

  it('cursor stays frozen after the interrupt renders', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    const cursor = q(container, 'terminal-cursor');
    expect(cursor).toBeTruthy();
    expect(cursor!.classList.contains('frozen')).toBe(true);
    expect(cursor!.classList.contains('blinking')).toBe(false);
  });

  it('blink is implemented via CSS @keyframes referenced by the .blinking rule', () => {
    renderTerminal({ lines: ['x'] });
    const css = getInjectedCss();
    expect(css).toMatch(/@keyframes\s+[\w-]+/);
    const blinkBodies = cssRuleBodiesFor('blinking').join('\n');
    expect(blinkBodies).toMatch(/animation/);
  });

  it('injected CSS contains a prefers-reduced-motion: reduce block that disables the blink animation', () => {
    renderTerminal({ lines: ['x'] });
    const block = extractReducedMotionCss();
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/animation/);
    expect(block).toMatch(/none|0s|paused/);
  });
});

// ============================================================
// 9. IntersectionObserver — single-shot trigger
// ============================================================
describe('CareTerminal -- IO single-shot behavior', () => {
  it('rapid enter/exit/enter causes a SINGLE start — no doubled characters', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    triggerIntersection(false);
    triggerIntersection(true);
    vi.advanceTimersByTime(20);
    expect(typedText(container)).toBe('ab'); // not 'aabb', not restarted
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
    expect(qa(container, 'terminal-line').length).toBe(2);
  });

  it('exit/re-enter MID-TYPING does not restart the animation', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(10);
    expect(typedText(container)).toBe('a');
    triggerIntersection(false);
    triggerIntersection(true);
    vi.advanceTimersByTime(10); // t=20 in the ORIGINAL timeline
    expect(typedText(container)).toBe('ab'); // a restart would show 'a' here
  });

  it('two immediate intersections before any timer fires still single-start', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
  });

  it('re-intersecting AFTER full completion changes nothing', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    const snapshot = container.innerHTML;
    triggerIntersection(false);
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    expect(container.innerHTML).toBe(snapshot);
  });
});

// ============================================================
// 10. prefers-reduced-motion — ISOLATED matchMedia mock
// ============================================================
describe('CareTerminal -- reduced motion', () => {
  // Runs AFTER the file-level beforeEach, overriding its
  // mockReducedMotion(false). The file-level afterEach restores the
  // original matchMedia, so nothing leaks OUT of this block either.
  beforeEach(() => {
    mockReducedMotion(true);
  });

  it('renders the FULL final state immediately on mount — no IO trigger, no timers', () => {
    const { container } = renderTerminal({
      lines: ['$ tamagotchi feed', '$ tamagotchi clea'],
      interruptText: 'SESSION ENDED',
    });
    // no triggerIntersection, no advanceTimersByTime
    expect(typedText(container)).toBe('$ tamagotchi feed$ tamagotchi clea');
    const interrupt = q(container, 'terminal-interrupt');
    expect(interrupt).toBeTruthy();
    expect(interrupt!.textContent).toContain('SESSION ENDED');
  });

  it('schedules NO animation timers under reduced motion', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    renderTerminal({
      lines: ['abcdef'],
      charDelay: 50,
      lineDelay: 400,
      interruptDelay: 900,
    });
    const animationTimers = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => typeof delay === 'number' && delay >= 50,
    );
    expect(animationTimers.length).toBe(0);
  });

  it('DOM is static under reduced motion — advancing 60s changes nothing', () => {
    const { container } = renderTerminal({
      lines: ['one', 'two'],
    });
    const snapshot = container.innerHTML;
    vi.advanceTimersByTime(60_000);
    if (mockObserverInstances.length > 0) {
      triggerIntersection(true); // even a stray intersection must not animate
    }
    vi.advanceTimersByTime(60_000);
    expect(container.innerHTML).toBe(snapshot);
  });

  it('lines=[] under reduced motion shows the interrupt immediately, nothing else', () => {
    const { container } = renderTerminal({ lines: [] });
    expect(typedText(container)).toBe('');
    const interrupt = q(container, 'terminal-interrupt');
    expect(interrupt).toBeTruthy();
    expect(interrupt!.textContent).toContain('SESSION ENDED');
  });

  it('no element anywhere carries the "blinking" class under reduced motion', () => {
    const { container } = renderTerminal({ lines: ['x', 'y'] });
    expect(container.querySelector('.blinking')).toBeNull();
  });

  it('sr transcript is still present and complete under reduced motion', () => {
    const { container } = renderTerminal({
      lines: ['alpha', 'beta'],
      interruptText: 'HALTED',
    });
    const srText = q(container, 'sr-transcript')!.textContent || '';
    expect(srText).toContain('alpha');
    expect(srText).toContain('beta');
    expect(srText).toContain('HALTED');
  });

  it('reduced-motion final state is XSS-safe too', () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const { container } = renderTerminal({ lines: [payload] });
    expect(typedText(container)).toContain(payload);
    expect(document.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });
});

// ============================================================
// 10b. Non-reduced block AFTER the reduced block — proves the
// matchMedia mock did not leak forward (regression guard for the
// past leaking-mock bug).
// ============================================================
describe('CareTerminal -- animation still runs after the reduced-motion describe', () => {
  it('a component rendered here (reduced=false) does NOT show final state at t=0', () => {
    const { container } = renderTerminal({ ...AB_CD });
    expect(typedText(container)).toBe('');
    expect(q(container, 'terminal-interrupt')).toBeNull();
    triggerIntersection(true);
    vi.advanceTimersByTime(10);
    expect(typedText(container)).toBe('a');
  });
});

// ============================================================
// 11. Unmount & timer cleanup
// ============================================================
describe('CareTerminal -- unmount & timer cleanup', () => {
  it('unmount BEFORE trigger: no throw; later intersection + timers do nothing', () => {
    const { unmount } = renderTerminal({ ...AB_CD });
    expect(() => unmount()).not.toThrow();
    expect(() => {
      // observer callback may still be invoked by the (mock) browser
      triggerIntersection(true);
      vi.advanceTimersByTime(60_000);
    }).not.toThrow();
    expect(document.querySelector('[data-testid="terminal-line"]')).toBeNull();
    expect(document.querySelector('[data-testid="terminal-interrupt"]')).toBeNull();
  });

  it('unmount MID-LINE clears ALL pending timers', () => {
    const { unmount } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(15); // mid line 1
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount mid-line: advancing fake timers afterwards throws nothing and writes nothing', () => {
    const { unmount } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(15);
    unmount();
    const bodyAfterUnmount = document.body.innerHTML;
    expect(() => vi.advanceTimersByTime(600_000)).not.toThrow();
    expect(document.body.innerHTML).toBe(bodyAfterUnmount);
  });

  it('unmount during the lineDelay pause is clean', () => {
    const { unmount } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(60); // between line 1 (done @20) and line 2 (starts @130)
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => vi.advanceTimersByTime(600_000)).not.toThrow();
  });

  it('unmount BETWEEN last line and interrupt: interrupt never renders anywhere', () => {
    const { unmount } = renderTerminal({ ...AB_CD, interruptText: 'ZOMBIE-INTERRUPT' });
    triggerIntersection(true);
    vi.advanceTimersByTime(160); // typing done @140, interrupt due @190
    unmount();
    expect(() => vi.advanceTimersByTime(600_000)).not.toThrow();
    expect(document.body.textContent || '').not.toContain('ZOMBIE-INTERRUPT');
  });

  it('unmount disconnects the IntersectionObserver', () => {
    const { unmount } = renderTerminal({ ...AB_CD });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(1);
    unmount();
    const cleanedUp = mockObserverInstances.some(
      (o) => o.disconnect.mock.calls.length > 0 || o.unobserve.mock.calls.length > 0,
    );
    expect(cleanedUp).toBe(true);
  });

  it('clearTimeout is actually called on mid-animation unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(15);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});

// ============================================================
// 12. Multiple instances — timers must not cross-talk
// ============================================================
describe('CareTerminal -- two instances are independent', () => {
  it('each instance types its own script on its own clock', () => {
    const a = render(CareTerminal, {
      props: { lines: ['aaaa'], charDelay: 10, interruptDelay: 1000 },
    });
    const b = render(CareTerminal, {
      props: { lines: ['zz'], charDelay: 100, interruptDelay: 1000 },
    });
    expect(mockObserverInstances.length).toBeGreaterThanOrEqual(2);
    triggerIntersection(true, 0); // instance A
    triggerIntersection(true, 1); // instance B
    vi.advanceTimersByTime(40); // A done (4×10); B first char due @100
    expect(typedText(a.container)).toBe('aaaa');
    expect(typedText(b.container)).toBe('');
    vi.advanceTimersByTime(60); // t=100 — B: 'z'
    expect(typedText(b.container)).toBe('z');
    expect(typedText(a.container)).toBe('aaaa'); // A untouched by B's timers
    vi.advanceTimersByTime(100); // t=200 — B: 'zz'
    expect(typedText(b.container)).toBe('zz');
    expect(typedText(a.container)).toBe('aaaa');
  });

  it("unmounting instance A mid-B-typing does not kill B's animation", () => {
    const a = render(CareTerminal, {
      props: { lines: ['a'], charDelay: 5, interruptDelay: 5 },
    });
    const b = render(CareTerminal, {
      props: { lines: ['bb'], charDelay: 50, interruptDelay: 20 },
    });
    triggerIntersection(true, 0);
    triggerIntersection(true, 1);
    vi.advanceTimersByTime(50); // A fully done incl. interrupt; B: 'b'
    expect(typedText(b.container)).toBe('b');
    a.unmount();
    expect(() => vi.advanceTimersByTime(50)).not.toThrow(); // t=100: B done
    expect(typedText(b.container)).toBe('bb');
    vi.advanceTimersByTime(20);
    expect(q(b.container, 'terminal-interrupt')).toBeTruthy();
  });

  it('triggering only instance B leaves instance A completely idle', () => {
    const a = render(CareTerminal, {
      props: { lines: ['idle'], charDelay: 5, interruptDelay: 5 },
    });
    const b = render(CareTerminal, {
      props: { lines: ['busy'], charDelay: 5, interruptDelay: 5 },
    });
    triggerIntersection(true, 1); // only B
    vi.advanceTimersByTime(60_000);
    expect(typedText(a.container)).toBe('');
    expect(q(a.container, 'terminal-interrupt')).toBeNull();
    expect(typedText(b.container)).toBe('busy');
    expect(q(b.container, 'terminal-interrupt')).toBeTruthy();
  });
});

// ============================================================
// HARDENING PASS (post-first-attempt-GREEN)
// Blocks below probe non-finite delays, IO re-fire, missing IO,
// prop mutation, empty-line arithmetic, code-point timing,
// degenerate reduced-motion combos, aria-hidden persistence,
// keyframe contracts, and post-completion timer hygiene.
// ============================================================

// ============================================================
// H1. Non-finite & sub-millisecond delay clamps
// Spec: charDelay<=0 clamps to 1ms; negative lineDelay/interruptDelay
// clamp to >=0; animation must complete in finite fake-timer time and
// event ORDER (chars -> freeze -> interrupt) must always hold.
// ============================================================
describe('hardening: non-finite & sub-ms delay clamps', () => {
  it('charDelay=NaN / lineDelay=NaN / interruptDelay=NaN: finite completion with order preserved', () => {
    const full = 'abc';
    const { container } = renderTerminal({
      lines: ['ab', 'c'],
      charDelay: NaN,
      lineDelay: NaN,
      interruptDelay: NaN,
    });
    triggerIntersection(true);
    let sawInterrupt = false;
    for (let t = 0; t < 50; t++) {
      vi.advanceTimersByTime(1);
      const text = typedText(container);
      // never garbage, never out of order
      expect(full.startsWith(text)).toBe(true);
      const cursor = q(container, 'terminal-cursor');
      expect(cursor).toBeTruthy();
      // never both states at once
      expect(
        cursor!.classList.contains('blinking') &&
          cursor!.classList.contains('frozen'),
      ).toBe(false);
      // frozen implies typing is complete
      if (cursor!.classList.contains('frozen')) {
        expect(text).toBe(full);
      }
      // interrupt implies complete AND frozen — never earlier
      const interrupt = q(container, 'terminal-interrupt');
      if (interrupt) {
        sawInterrupt = true;
        expect(text).toBe(full);
        expect(cursor!.classList.contains('frozen')).toBe(true);
      }
    }
    // NaN delays must not produce a never-firing chain
    expect(sawInterrupt).toBe(true);
    expect(typedText(container)).toBe(full);
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('charDelay=Infinity / lineDelay=Infinity / interruptDelay=Infinity: still completes in finite time', () => {
    const { container } = renderTerminal({
      lines: ['ab', 'cd'],
      charDelay: Infinity,
      lineDelay: Infinity,
      interruptDelay: Infinity,
    });
    triggerIntersection(true);
    // chars never appear synchronously at the trigger instant
    expect(typedText(container)).toBe('');
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
    const cursor = q(container, 'terminal-cursor')!;
    expect(cursor.classList.contains('frozen')).toBe(true);
    expect(cursor.classList.contains('blinking')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('charDelay=-Infinity clamps to EXACTLY 1ms; lineDelay=-Infinity clamps to 0 (spec arithmetic)', () => {
    // -Infinity <= 0, so the spec's "charDelay<=0 clamps to 1ms" applies
    // and the full timing grid is spec-mandated: x@1, y@2, z@(2+0+1)=3,
    // interrupt@3+5=8.
    const { container } = renderTerminal({
      lines: ['xy', 'z'],
      charDelay: -Infinity,
      lineDelay: -Infinity,
      interruptDelay: 5,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(1);
    expect(typedText(container)).toBe('x');
    vi.advanceTimersByTime(1); // t=2
    expect(typedText(container)).toBe('xy');
    vi.advanceTimersByTime(1); // t=3
    expect(typedText(container)).toBe('xyz');
    vi.advanceTimersByTime(4); // t=7
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=8
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('charDelay=0.5 clamps to the 1ms floor — sub-ms delays are not honored', () => {
    // AMENDED SPEC: any charDelay < 1 (including positive sub-ms values
    // like 0.5) clamps to 1ms — sub-millisecond setTimeout delays are
    // illusory in browsers, so the contract is a 1ms floor.
    // Timing grid for a 6-char line: chars at t=1,2,3,4,5,6 exactly.
    const { container } = renderTerminal({
      lines: ['abcdef'],
      charDelay: 0.5,
      interruptDelay: 100,
    });
    triggerIntersection(true);
    // at t=3 exactly 3 chars typed — NOT the full line (0.5ms would
    // have finished all 6 by now if honored)
    vi.advanceTimersByTime(3);
    expect(typedText(container)).toBe('abc');
    // off-by-one probe: at t=5 only 5 chars, line not yet complete
    vi.advanceTimersByTime(2); // t=5
    expect(typedText(container)).toBe('abcde');
    // at t=6 the full line
    vi.advanceTimersByTime(1); // t=6
    expect(typedText(container)).toBe('abcdef');
    // interrupt exactly interruptDelay after the final char (t=106)
    vi.advanceTimersByTime(99); // t=105
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=106
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });
});

// ============================================================
// H2. IO callback re-fire AFTER disconnect
// A mocked (or buggy) IO can keep invoking the captured callback
// after the component has disconnected. The single-shot guarantee
// must survive arbitrary re-invocation, not just enter/exit/enter.
// ============================================================
describe('hardening: IO callback re-fire after disconnect', () => {
  it('firing the captured callback 5x synchronously yields ONE timeline, ONE cursor', () => {
    const { container } = renderTerminal({ ...AB_CD });
    for (let i = 0; i < 5; i++) triggerIntersection(true);
    vi.advanceTimersByTime(20);
    expect(typedText(container)).toBe('ab'); // not 'aabb...' x5
    expect(qa(container, 'terminal-cursor').length).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-line').length).toBe(2);
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
    expect(qa(container, 'terminal-cursor').length).toBe(1);
  });

  it('re-firing the callback 5x AFTER full completion mutates nothing', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(60_000);
    const snapshot = container.innerHTML;
    for (let i = 0; i < 5; i++) {
      triggerIntersection(true);
      triggerIntersection(false);
    }
    vi.advanceTimersByTime(60_000);
    expect(container.innerHTML).toBe(snapshot);
  });

  it('a single callback invocation carrying MULTIPLE intersecting entries starts once', () => {
    const { container } = renderTerminal({ ...AB_CD });
    const observer = mockObserverInstances[0];
    const mk = (isIntersecting: boolean) =>
      ({
        isIntersecting,
        intersectionRatio: isIntersecting ? 1.0 : 0.0,
        target: {} as Element,
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRect: {} as DOMRectReadOnly,
        rootBounds: null,
        time: Date.now(),
      }) as IntersectionObserverEntry;
    observer.callback([mk(false), mk(true), mk(true), mk(true)]);
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-line').length).toBe(2);
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
    expect(qa(container, 'terminal-cursor').length).toBe(1);
  });
});

// ============================================================
// H3. Missing IntersectionObserver global
// SPEC GAP: the spec does not define behavior when IO is absent.
// Pins are limited to no-crash + eventual completion (determinism),
// per hardening rules. Coordinator ruling requested on whether
// "degrade to immediate start" is the desired contract.
// ============================================================
describe('hardening: missing IntersectionObserver global', () => {
  it('IO deleted from globalThis: mount does not crash and the animation still completes', () => {
    delete (globalThis as any).IntersectionObserver;
    let container!: Element;
    expect(() => {
      ({ container } = renderTerminal({ ...AB_CD }));
    }).not.toThrow();
    // nothing may appear synchronously at mount regardless of strategy
    expect(typedText(container)).toBe('');
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
  });

  it('IO replaced by a non-function garbage value: no crash, animation completes', () => {
    (globalThis as any).IntersectionObserver = { observe: 'not callable' };
    let container!: Element;
    expect(() => {
      ({ container } = renderTerminal({ ...AB_CD }));
    }).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
  });
});

// ============================================================
// H4. Prop mutation mid-animation
// SPEC GAP: the spec defines snapshot semantics only for IO re-entry,
// not for prop updates. These tests pin no-crash + an unbroken
// animated timeline only. NOTE (for coordinator ruling): the animated
// region types the ORIGINAL lines while the sr-transcript reactively
// shows the NEW lines — a visible/AT divergence that these tests
// deliberately do NOT adjudicate.
// ============================================================
describe('hardening: prop mutation mid-animation', () => {
  it('replacing lines + all delays mid-typing neither crashes nor alters the running timeline', async () => {
    const { container, rerender } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(10);
    expect(typedText(container)).toBe('a');
    await rerender({
      lines: ['XXXX', 'YYYY'],
      charDelay: 999,
      lineDelay: 999,
      interruptDelay: 999,
    });
    // original clock: 'ab' at t=20, not 999ms cadence, not 'XXXX'
    vi.advanceTimersByTime(10);
    expect(typedText(container)).toBe('ab');
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-line').length).toBe(2);
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
  });

  it('mutating interruptText mid-typing does not crash; exactly one interrupt ever renders', async () => {
    const { container, rerender } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(10);
    await rerender({ ...AB_CD, interruptText: 'CHANGED MID-FLIGHT' });
    vi.advanceTimersByTime(60_000);
    expect(typedText(container)).toBe('abcd');
    // determinism pin only: one interrupt element, whatever its text
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
  });

  it('mutating lines to a NON-ARRAY mid-typing does not crash and the timeline survives', async () => {
    const { container, rerender } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(10);
    await rerender({ ...AB_CD, lines: 'not-an-array' as any });
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(typedText(container)).toBe('abcd');
    expect(qa(container, 'terminal-interrupt').length).toBe(1);
  });
});

// ============================================================
// H5. Empty-line boundary arithmetic (exact, not budgeted)
// Spec: empty lines complete instantly at their start instant; the
// next line's first char lands lineDelay + charDelay after that;
// interrupt lands interruptDelay after the final (possibly instant)
// completion. Existing tests only used generous budgets here.
// ============================================================
describe('hardening: empty-line boundary arithmetic', () => {
  it('["", "b"]: empty line 0 completes at trigger; "b" at EXACTLY lineDelay+charDelay', () => {
    const { container } = renderTerminal({
      lines: ['', 'b'],
      charDelay: 10,
      lineDelay: 100,
      interruptDelay: 50,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(109); // t=109
    expect(typedText(container)).toBe('');
    vi.advanceTimersByTime(1); // t=110 = 0 + 100 + 10
    expect(typedText(container)).toBe('b');
    vi.advanceTimersByTime(49); // t=159
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=160 = 110 + 50
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(lineTexts(container)).toEqual(['', 'b']);
  });

  it('[""]: interrupt at EXACTLY interruptDelay after trigger; cursor frozen from trigger', () => {
    const { container } = renderTerminal({
      lines: [''],
      charDelay: 10,
      lineDelay: 100,
      interruptDelay: 300,
    });
    triggerIntersection(true);
    // line completed instantly => cursor is frozen immediately
    const cursor = q(container, 'terminal-cursor')!;
    expect(cursor.classList.contains('frozen')).toBe(true);
    expect(cursor.classList.contains('blinking')).toBe(false);
    vi.advanceTimersByTime(299);
    expect(q(container, 'terminal-interrupt')).toBeNull();
    expect(typedText(container)).toBe('');
    vi.advanceTimersByTime(1); // t=300
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(typedText(container)).toBe('');
  });

  it('["a","","b"]: full grid — a@5, empty@25 (instant), b@50, interrupt@60', () => {
    const { container } = renderTerminal({
      lines: ['a', '', 'b'],
      charDelay: 5,
      lineDelay: 20,
      interruptDelay: 10,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(5); // t=5: 'a'
    expect(typedText(container)).toBe('a');
    vi.advanceTimersByTime(44); // t=49: empty line done @25, b due @50
    expect(typedText(container)).toBe('a');
    vi.advanceTimersByTime(1); // t=50 = 25 + 20 + 5
    expect(typedText(container)).toBe('ab');
    vi.advanceTimersByTime(9); // t=59
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=60
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(lineTexts(container)).toEqual(['a', '', 'b']);
    expect(qa(container, 'terminal-line').length).toBe(3);
  });

  it('["",""]: both instant — line 1 completes at lineDelay, interrupt at lineDelay+interruptDelay', () => {
    const { container } = renderTerminal({
      lines: ['', ''],
      charDelay: 10,
      lineDelay: 100,
      interruptDelay: 50,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(149); // t=149: line 1 done @100, interrupt due @150
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=150
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(typedText(container)).toBe('');
    expect(qa(container, 'terminal-line').length).toBe(2);
  });

  it('lines=[]: cursor exists at trigger, is frozen (never blinking), and survives the interrupt', () => {
    const { container } = renderTerminal({ lines: [], interruptDelay: 40 });
    triggerIntersection(true);
    const cursor = q(container, 'terminal-cursor');
    expect(cursor).toBeTruthy();
    expect(cursor!.classList.contains('frozen')).toBe(true);
    expect(cursor!.classList.contains('blinking')).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(q(container, 'terminal-cursor')).toBeTruthy(); // still in DOM post-interrupt
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });
});

// ============================================================
// H6. Code-point timing (spec-mandated character units)
// Existing unicode tests checked fidelity, never the CLOCK.
// ============================================================
describe('hardening: code-point timing', () => {
  it('ZWJ family emoji (7 code points) types on a 7-tick clock, code-point-aligned at every step', () => {
    const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'; // 👨‍👩‍👧‍👦
    const cps = Array.from(FAMILY);
    expect(cps.length).toBe(7); // guard: 4 emoji + 3 ZWJ
    const { container } = renderTerminal({
      lines: [FAMILY],
      charDelay: 10,
      interruptDelay: 40,
    });
    triggerIntersection(true);
    for (let k = 1; k <= 7; k++) {
      vi.advanceTimersByTime(9);
      expect(typedText(container)).toBe(cps.slice(0, k - 1).join(''));
      vi.advanceTimersByTime(1); // t = 10k
      expect(typedText(container)).toBe(cps.slice(0, k).join(''));
    }
    // completion at exactly 7 x charDelay = 70; interrupt at 110
    vi.advanceTimersByTime(39); // t=109
    expect(q(container, 'terminal-interrupt')).toBeNull();
    vi.advanceTimersByTime(1); // t=110
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });

  it('astral-plane pair "𝕏𝕐" is 2 ticks, never a lone surrogate mid-typing', () => {
    const line = '\u{1D54F}\u{1D550}'; // 𝕏𝕐 — 2 code points, 4 UTF-16 units
    const { container } = renderTerminal({
      lines: [line],
      charDelay: 10,
      interruptDelay: 20,
    });
    triggerIntersection(true);
    vi.advanceTimersByTime(10);
    expect(typedText(container)).toBe('\u{1D54F}'); // whole code point, not half
    vi.advanceTimersByTime(9); // t=19
    expect(typedText(container)).toBe('\u{1D54F}');
    vi.advanceTimersByTime(1); // t=20 — NOT 40 (UTF-16-unit clock would be 4 ticks)
    expect(typedText(container)).toBe(line);
    vi.advanceTimersByTime(20); // t=40
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
  });
});

// ============================================================
// H7. Reduced motion x degenerate props (combo attack)
// ============================================================
describe('hardening: reduced motion degenerate combos', () => {
  beforeEach(() => {
    mockReducedMotion(true);
  });

  it('reduced motion + lines=[] + interruptText="": fully empty final state, no cursor, no timers, no IO', () => {
    const { container } = renderTerminal({ lines: [], interruptText: '' });
    expect(qa(container, 'terminal-line').length).toBe(0);
    expect(q(container, 'terminal-interrupt')).toBeNull();
    expect(q(container, 'terminal-cursor')).toBeNull();
    expect(container.querySelector('.blinking')).toBeNull();
    expect((q(container, 'sr-transcript')!.textContent || '')).toBe('');
    expect(mockObserverInstances.length).toBe(0); // no IO constructed at all
    expect(vi.getTimerCount()).toBe(0);
    const snapshot = container.innerHTML;
    vi.advanceTimersByTime(60_000);
    expect(container.innerHTML).toBe(snapshot);
  });

  it('reduced motion NEVER constructs an IntersectionObserver, even with a real script', () => {
    const { container } = renderTerminal({
      lines: ['$ tamagotchi feed', '$ tamagotchi clea'],
    });
    expect(mockObserverInstances.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // animated region stays aria-hidden in the reduced-motion path too
    expect(q(container, 'terminal-animated')!.getAttribute('aria-hidden')).toBe('true');
    expect(q(container, 'terminal-cursor')).toBeNull();
  });
});

// ============================================================
// H8. aria-hidden persistence & keyframe naming contract
// ============================================================
describe('hardening: aria-hidden persistence & keyframe contract', () => {
  it('animated region is aria-hidden="true" at EVERY 10ms step through typing, freeze, and interrupt', () => {
    const { container } = renderTerminal({ ...AB_CD });
    const animated = q(container, 'terminal-animated')!;
    expect(animated.getAttribute('aria-hidden')).toBe('true'); // pre-trigger
    triggerIntersection(true);
    // steps cover mid-line (t=10..20), lineDelay pause (20..130),
    // line 2 (130..140), freeze window (140..190), post-interrupt (190..250)
    for (let step = 0; step < 25; step++) {
      vi.advanceTimersByTime(10);
      expect(animated.getAttribute('aria-hidden')).toBe('true');
    }
    expect(q(container, 'terminal-interrupt')).toBeTruthy(); // we really got past it
    expect(animated.getAttribute('aria-hidden')).toBe('true');
  });

  it('.blinking animation-name resolves to a DECLARED @keyframes and is not a bare collision-prone "blink"', () => {
    renderTerminal({ lines: ['x'] });
    const css = getInjectedCss();
    const declared = Array.from(css.matchAll(/@keyframes\s+([\w-]+)/g)).map(
      (m) => m[1],
    );
    expect(declared.length).toBeGreaterThan(0);
    const blinkBody = cssRuleBodiesFor('blinking').join('\n');
    const ref = blinkBody.match(/animation(?:-name)?\s*:\s*([a-zA-Z_-][\w-]*)/);
    expect(ref).toBeTruthy();
    // the name the class animates with must actually exist
    expect(declared).toContain(ref![1]);
    // a bare global "blink" would collide with any other component's global keyframes
    expect(ref![1]).not.toBe('blink');
    expect(ref![1]).not.toBe('none');
  });
});

// ============================================================
// H9. Timer hygiene after NATURAL completion (not just unmount)
// Spec mandates cleanup on unmount; a timer still pending after the
// interrupt has fired would be a leak. Pinned as zero.
// ============================================================
describe('hardening: timer hygiene after natural completion', () => {
  it('timer count is ZERO immediately after the interrupt fires (t=190 exactly, no over-advance)', () => {
    const { container } = renderTerminal({ ...AB_CD });
    triggerIntersection(true);
    vi.advanceTimersByTime(190);
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interruptText="": timer count is ZERO right after the final char (no phantom interrupt timer)', () => {
    const { container } = renderTerminal({ ...AB_CD, interruptText: '' });
    triggerIntersection(true);
    vi.advanceTimersByTime(140); // final char of 'cd'
    expect(typedText(container)).toBe('abcd');
    expect(q(container, 'terminal-interrupt')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lines=[]: timer count is ZERO right after the trigger-relative interrupt', () => {
    const { container } = renderTerminal({ lines: [], interruptDelay: 300 });
    triggerIntersection(true);
    vi.advanceTimersByTime(300);
    expect(q(container, 'terminal-interrupt')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
