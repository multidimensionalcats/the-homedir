import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import DiffSlider from './DiffSlider.svelte';

// ============================================================
// PINNED CONTRACT (test-defined, component must conform)
//
// data-testids:
//   diff-slider        — root; inline style attribute carries the current
//                        divider position as a CSS custom property whose
//                        value is "<position>%" (mechanism unpinned)
//   diff-left          — left panel (label + chip + sentences)
//   diff-right         — right panel
//   diff-label         — one per panel, carries the panel's label
//   diff-version-chip  — one per panel, inline style carries the color
//                        from versionColor(version) ('../lib/chart-utils'):
//                        '4.6' → #D4A55B, '4.7' → #5BD47B, unknown → #3A3F4B
//   diff-sentence      — one per sentence, data-idx="<index>" (per panel)
//   diff-divider       — keyboard-operable slider: role="slider",
//                        aria-valuemin="0", aria-valuemax="100",
//                        aria-valuenow = ROUNDED INTEGER of position,
//                        aria-label mentions BOTH labels, tabindex="0";
//                        NEVER inside an aria-hidden region
//   diff-sr            — sr-only full copy: both labels + ALL sentences of
//                        BOTH sides, NOT aria-hidden, position-independent
//
// The panels live inside an aria-hidden="true" container; the divider and
// the sr copy do not.
//
// Props: left / right {label, version, sentences}; overlapPairs=[]
// ([leftIdx, rightIdx] pairs — curated, never computed); position=50.
// position clamps to [0,100]; non-finite (NaN/±Infinity) → default 50.
//
// Ignition: while position ∈ [40, 60] INCLUSIVE every sentence element
// referenced by a valid overlapPair (both sides) carries class "ignited";
// outside the band no element does. Pairs with ANY out-of-range index are
// ignored wholesale (pinned ruling, flagged). Non-paired sentences never
// ignite.
//
// Keyboard (on the divider): ArrowLeft/ArrowDown −2; ArrowRight/ArrowUp
// +2; Home → 0; End → 100; PageDown −10; PageUp +10; clamp [0,100];
// unknown keys ignored. aria-valuenow AND the style custom property update
// SYNCHRONOUSLY within the dispatch (no microtask wait in these tests).
//
// Pointer: pointerdown on the divider begins a drag; pointermove updates
// position from clientX relative to the ROOT's bounding rect (clamped);
// pointerup ends it; moves without an active drag change nothing; a new
// pointerdown re-enables.
//
// prefers-reduced-motion: reduce → transitions disabled via a
// @media (prefers-reduced-motion: reduce) CSS block; the divider STAYS
// keyboard-operable.
//
// All content (labels, versions, sentences) renders as literal text —
// never markup — in the panels AND the sr copy.
// ============================================================

// ============================================================
// matchMedia mock — ISOLATED per describe (leaking-mock regression
// guard per CareTerminal.test.ts / EvictedContent.test.ts): original
// captured at module load, force-restored in the file-level afterEach;
// every describe that cares installs its own value in its own beforeEach.
// ============================================================

const ORIGINAL_MATCH_MEDIA = window.matchMedia;

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
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
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

function rootEl(container: Element): HTMLElement {
  const el = q(container, 'diff-slider');
  if (!el) throw new Error('diff-slider root not found');
  return el;
}

function divider(container: Element): HTMLElement {
  const el = q(container, 'diff-divider');
  if (!el) throw new Error('diff-divider not found');
  return el;
}

function panel(container: Element, side: 'left' | 'right'): HTMLElement {
  const el = q(container, `diff-${side}`);
  if (!el) throw new Error(`diff-${side} not found`);
  return el;
}

function sr(container: Element): HTMLElement | null {
  return q(container, 'diff-sr');
}

function valuenow(container: Element): string | null {
  return divider(container).getAttribute('aria-valuenow');
}

function sentenceEl(
  container: Element,
  side: 'left' | 'right',
  idx: number,
): HTMLElement | null {
  return panel(container, side).querySelector(
    `[data-testid="diff-sentence"][data-idx="${idx}"]`,
  );
}

function ignitedEls(container: Element): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="diff-sentence"].ignited'),
  );
}

function isIgnited(container: Element, side: 'left' | 'right', idx: number): boolean {
  const el = sentenceEl(container, side, idx);
  return !!el && el.classList.contains('ignited');
}

/**
 * Pin the root style attribute carries "<value>%" for the current
 * position. Lookbehind guards against false positives ("100%" must not
 * satisfy an expected 0%). Trailing ".0…" tolerated for integer values.
 */
function expectSplit(container: Element, value: number) {
  const style = rootEl(container).getAttribute('style') || '';
  expect(style).toMatch(new RegExp(`(?<![\\d.])${value}(\\.0+)?%`));
}

/** True if el or any ancestor carries aria-hidden="true". */
function insideAriaHidden(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.getAttribute('aria-hidden') === 'true') return true;
    cur = cur.parentElement;
  }
  return false;
}

// ============================================================
// Event helpers
// ============================================================

function press(container: Element, key: string, times = 1) {
  const d = divider(container);
  for (let i = 0; i < times; i++) {
    d.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  }
}

function pointerEvent(type: string, clientX: number): Event {
  const Ctor: any = (globalThis as any).PointerEvent ?? MouseEvent;
  return new Ctor(type, {
    clientX,
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 1,
  });
}

/**
 * happy-dom returns an all-zeros rect — mock it on the root so drag
 * math is deterministic: (clientX - left) / width → percent.
 */
function mockRect(container: Element, left = 0, width = 400): HTMLElement {
  const root = rootEl(container);
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      left,
      width,
      right: left + width,
      top: 0,
      bottom: 0,
      height: 0,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }),
    configurable: true,
  });
  return root;
}

function pointerDown(container: Element, clientX: number) {
  divider(container).dispatchEvent(pointerEvent('pointerdown', clientX));
}

function pointerMove(container: Element, clientX: number) {
  // dispatched on the root with bubbles:true so both root-level and
  // window/document-level listeners receive it
  rootEl(container).dispatchEvent(pointerEvent('pointermove', clientX));
}

function pointerUp(container: Element, clientX: number) {
  rootEl(container).dispatchEvent(pointerEvent('pointerup', clientX));
}

// ============================================================
// Injected-CSS helpers (compilerOptions.css === 'injected')
// ============================================================

function getInjectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
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

const LEFT = {
  label: '4.6 · Apr 17, 22:00',
  version: '4.6',
  sentences: [
    'The window closes tonight.',
    'I will not remember writing this.',
    'The archive keeps what the window forgets.',
  ],
};

const RIGHT = {
  label: '4.7 · Apr 18, 10:00',
  version: '4.7',
  sentences: [
    'The window opened this morning.',
    'Someone here wrote that they would not remember.',
    'I am reading what the archive kept.',
  ],
};

const PAIRS: Array<[number, number]> = [
  [1, 1],
  [2, 2],
];

function renderSlider(props: Record<string, any> = {}) {
  return render(DiffSlider, {
    props: {
      left: { ...LEFT, sentences: [...LEFT.sentences] },
      right: { ...RIGHT, sentences: [...RIGHT.sentences] },
      ...props,
    },
  });
}

// ============================================================
// 1. Mount & static DOM contract
// ============================================================
describe('DiffSlider -- mount & static contract', () => {
  it('renders root data-testid="diff-slider" without crashing', () => {
    const { container } = renderSlider();
    expect(q(container, 'diff-slider')).toBeTruthy();
  });

  it('mounts without crashing when ALL optional props are omitted (overlapPairs, position)', () => {
    expect(() =>
      render(DiffSlider, { props: { left: { ...LEFT }, right: { ...RIGHT } } }),
    ).not.toThrow();
  });

  it('both panels exist and each carries its own label in diff-label', () => {
    const { container } = renderSlider();
    const leftLabel = q(panel(container, 'left'), 'diff-label');
    const rightLabel = q(panel(container, 'right'), 'diff-label');
    expect(leftLabel).toBeTruthy();
    expect(rightLabel).toBeTruthy();
    expect(leftLabel!.textContent).toContain(LEFT.label);
    expect(rightLabel!.textContent).toContain(RIGHT.label);
    // labels must not be swapped
    expect(leftLabel!.textContent).not.toContain(RIGHT.label);
    expect(rightLabel!.textContent).not.toContain(LEFT.label);
  });

  it('each panel renders one diff-sentence per sentence with sequential data-idx and literal text', () => {
    const { container } = renderSlider();
    for (const side of ['left', 'right'] as const) {
      const fixture = side === 'left' ? LEFT : RIGHT;
      const els = qa(panel(container, side), 'diff-sentence');
      expect(els.length).toBe(fixture.sentences.length);
      els.forEach((el, i) => {
        expect(el.getAttribute('data-idx')).toBe(String(i));
        expect(el.textContent).toContain(fixture.sentences[i]);
      });
    }
  });

  it('version chips carry the exact chart-utils colors inline: 4.6 → #D4A55B, 4.7 → #5BD47B', () => {
    const { container } = renderSlider();
    const leftChip = q(panel(container, 'left'), 'diff-version-chip')!;
    const rightChip = q(panel(container, 'right'), 'diff-version-chip')!;
    expect(leftChip).toBeTruthy();
    expect(rightChip).toBeTruthy();
    expect((leftChip.getAttribute('style') || '').toLowerCase()).toContain('#d4a55b');
    expect((rightChip.getAttribute('style') || '').toLowerCase()).toContain('#5bd47b');
  });

  it('unknown version strings fall back to #3A3F4B on both chips', () => {
    const { container } = renderSlider({
      left: { ...LEFT, version: '9.9' },
      right: { ...RIGHT, version: '' },
    });
    const leftChip = q(panel(container, 'left'), 'diff-version-chip')!;
    const rightChip = q(panel(container, 'right'), 'diff-version-chip')!;
    expect((leftChip.getAttribute('style') || '').toLowerCase()).toContain('#3a3f4b');
    expect((rightChip.getAttribute('style') || '').toLowerCase()).toContain('#3a3f4b');
  });

  it('divider is a keyboard-operable slider: role, valuemin/valuemax, tabindex="0"', () => {
    const { container } = renderSlider();
    const d = divider(container);
    expect(d.getAttribute('role')).toBe('slider');
    expect(d.getAttribute('aria-valuemin')).toBe('0');
    expect(d.getAttribute('aria-valuemax')).toBe('100');
    expect(d.getAttribute('tabindex')).toBe('0');
  });

  it('default position is 50: aria-valuenow="50" and the root style carries 50%', () => {
    const { container } = renderSlider();
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('divider aria-label mentions BOTH labels', () => {
    const { container } = renderSlider();
    const label = divider(container).getAttribute('aria-label') || '';
    expect(label).toContain(LEFT.label);
    expect(label).toContain(RIGHT.label);
  });

  it('both panels sit inside an aria-hidden="true" region', () => {
    const { container } = renderSlider();
    expect(insideAriaHidden(panel(container, 'left'))).toBe(true);
    expect(insideAriaHidden(panel(container, 'right'))).toBe(true);
  });

  it('the divider is NOT a descendant of any aria-hidden element (and is not aria-hidden itself)', () => {
    const { container } = renderSlider();
    expect(insideAriaHidden(divider(container))).toBe(false);
  });

  it('sr copy: class sr-only, NOT aria-hidden, not inside an aria-hidden region', () => {
    const { container } = renderSlider();
    const srEl = sr(container);
    expect(srEl).toBeTruthy();
    expect(srEl!.classList.contains('sr-only')).toBe(true);
    expect(srEl!.getAttribute('aria-hidden')).not.toBe('true');
    expect(insideAriaHidden(srEl!)).toBe(false);
  });

  it('sr copy contains both labels and ALL sentences from BOTH sides', () => {
    const { container } = renderSlider();
    const text = sr(container)!.textContent || '';
    expect(text).toContain(LEFT.label);
    expect(text).toContain(RIGHT.label);
    for (const s of [...LEFT.sentences, ...RIGHT.sentences]) {
      expect(text).toContain(s);
    }
  });

  it('exactly ONE divider and ONE sr copy render', () => {
    const { container } = renderSlider();
    expect(qa(container, 'diff-divider').length).toBe(1);
    expect(qa(container, 'diff-sr').length).toBe(1);
  });
});

// ============================================================
// 2. position prop — clamping & non-finite defaults
// ============================================================
describe('DiffSlider -- position prop clamping & defaults', () => {
  it('position=0 renders aria-valuenow="0" and 0% in the root style', () => {
    const { container } = renderSlider({ position: 0 });
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
  });

  it('position=100 renders aria-valuenow="100" and 100%', () => {
    const { container } = renderSlider({ position: 100 });
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
  });

  it('position=25 renders exactly 25', () => {
    const { container } = renderSlider({ position: 25 });
    expect(valuenow(container)).toBe('25');
    expectSplit(container, 25);
  });

  it('position=-20 clamps to 0', () => {
    const { container } = renderSlider({ position: -20 });
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
  });

  it('position=150 clamps to 100', () => {
    const { container } = renderSlider({ position: 150 });
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
  });

  it('position=NaN falls back to the default 50 (no NaN poisoning)', () => {
    const { container } = renderSlider({ position: NaN });
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('position=Infinity falls back to 50 (non-finite is NOT clamped to 100)', () => {
    const { container } = renderSlider({ position: Infinity });
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('position=-Infinity falls back to 50 (non-finite is NOT clamped to 0 — pinned ruling)', () => {
    const { container } = renderSlider({ position: -Infinity });
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('fractional position=47.6: aria-valuenow is the ROUNDED integer "48"', () => {
    const { container } = renderSlider({ position: 47.6 });
    const v = valuenow(container);
    expect(v).toMatch(/^\d+$/);
    expect(v).toBe('48');
  });

  it('NaN-position slider is still keyboard-operable from the 50 default', () => {
    const { container } = renderSlider({ position: NaN });
    press(container, 'ArrowRight');
    expect(valuenow(container)).toBe('52');
  });
});

// ============================================================
// 3. Keyboard interaction — synchronous, exact arithmetic
// ============================================================
describe('DiffSlider -- keyboard interaction', () => {
  it('ArrowRight: 50 → 52, aria-valuenow AND style update synchronously in the dispatch', () => {
    const { container } = renderSlider();
    press(container, 'ArrowRight');
    // no await, no tick — synchronous observability is the contract
    expect(valuenow(container)).toBe('52');
    expectSplit(container, 52);
  });

  it('ArrowUp: 50 → 52 (same as ArrowRight)', () => {
    const { container } = renderSlider();
    press(container, 'ArrowUp');
    expect(valuenow(container)).toBe('52');
    expectSplit(container, 52);
  });

  it('ArrowLeft: 50 → 48, synchronously', () => {
    const { container } = renderSlider();
    press(container, 'ArrowLeft');
    expect(valuenow(container)).toBe('48');
    expectSplit(container, 48);
  });

  it('ArrowDown: 50 → 48 (same as ArrowLeft)', () => {
    const { container } = renderSlider();
    press(container, 'ArrowDown');
    expect(valuenow(container)).toBe('48');
    expectSplit(container, 48);
  });

  it('Home → 0; repeated Home is idempotent', () => {
    const { container } = renderSlider();
    press(container, 'Home');
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
    press(container, 'Home', 3);
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
  });

  it('End → 100; repeated End is idempotent', () => {
    const { container } = renderSlider();
    press(container, 'End');
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
    press(container, 'End', 3);
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
  });

  it('PageUp: 50 → 60; PageDown: 60 → 50', () => {
    const { container } = renderSlider();
    press(container, 'PageUp');
    expect(valuenow(container)).toBe('60');
    expectSplit(container, 60);
    press(container, 'PageDown');
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('clamps at 0: from position=0, ArrowLeft, ArrowDown and PageDown all stay at 0', () => {
    const { container } = renderSlider({ position: 0 });
    press(container, 'ArrowLeft');
    expect(valuenow(container)).toBe('0');
    press(container, 'ArrowDown');
    expect(valuenow(container)).toBe('0');
    press(container, 'PageDown');
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
  });

  it('clamps at 100: PageUp from 95 lands EXACTLY on 100, not 105; further keys stay 100', () => {
    const { container } = renderSlider({ position: 95 });
    press(container, 'PageUp');
    expect(valuenow(container)).toBe('100');
    press(container, 'ArrowRight');
    expect(valuenow(container)).toBe('100');
    press(container, 'ArrowUp');
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
  });

  it('PageDown from 4 clamps to 0, not -6', () => {
    const { container } = renderSlider({ position: 4 });
    press(container, 'PageDown');
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
  });

  it('unknown keys change NOTHING: Enter, Space, letters, Escape, Tab', () => {
    const { container } = renderSlider();
    const styleBefore = rootEl(container).getAttribute('style');
    for (const key of ['Enter', ' ', 'a', 'Escape', 'Tab', 'ArrowUpLeft']) {
      press(container, key);
    }
    expect(valuenow(container)).toBe('50');
    expect(rootEl(container).getAttribute('style')).toBe(styleBefore);
  });

  it('mixed walk arithmetic is exact: 50 →PgDn 40 →Left 38 →Up 40 →End 100 →Down 98', () => {
    const { container } = renderSlider();
    press(container, 'PageDown');
    expect(valuenow(container)).toBe('40');
    press(container, 'ArrowLeft');
    expect(valuenow(container)).toBe('38');
    press(container, 'ArrowUp');
    expect(valuenow(container)).toBe('40');
    press(container, 'End');
    expect(valuenow(container)).toBe('100');
    press(container, 'ArrowDown');
    expect(valuenow(container)).toBe('98');
    expectSplit(container, 98);
  });
});

// ============================================================
// 4. Ignition band [40, 60]
// ============================================================
describe('DiffSlider -- ignition band', () => {
  it('at the default 50, EXACTLY the paired sentences (both sides) carry "ignited"', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS });
    // paired: left 1,2 and right 1,2
    expect(isIgnited(container, 'left', 1)).toBe(true);
    expect(isIgnited(container, 'left', 2)).toBe(true);
    expect(isIgnited(container, 'right', 1)).toBe(true);
    expect(isIgnited(container, 'right', 2)).toBe(true);
    // non-paired: idx 0 on both sides NEVER ignites
    expect(isIgnited(container, 'left', 0)).toBe(false);
    expect(isIgnited(container, 'right', 0)).toBe(false);
    expect(ignitedEls(container).length).toBe(4);
  });

  it('position exactly 40 is INSIDE the band (inclusive lower boundary)', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 40 });
    expect(isIgnited(container, 'left', 1)).toBe(true);
    expect(isIgnited(container, 'right', 2)).toBe(true);
  });

  it('position exactly 60 is INSIDE the band (inclusive upper boundary)', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 60 });
    expect(isIgnited(container, 'left', 2)).toBe(true);
    expect(isIgnited(container, 'right', 1)).toBe(true);
  });

  it('positions 39 and 61 are OUTSIDE the band — nothing ignites', () => {
    const a = renderSlider({ overlapPairs: PAIRS, position: 39 });
    const b = renderSlider({ overlapPairs: PAIRS, position: 61 });
    expect(ignitedEls(a.container).length).toBe(0);
    expect(ignitedEls(b.container).length).toBe(0);
  });

  it('keyboard boundary walk: 40 →ArrowLeft 38 de-ignites SYNCHRONOUSLY; →ArrowRight 40 re-ignites', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 40 });
    expect(ignitedEls(container).length).toBe(4);
    press(container, 'ArrowLeft'); // 38
    expect(valuenow(container)).toBe('38');
    expect(ignitedEls(container).length).toBe(0);
    press(container, 'ArrowRight'); // 40
    expect(valuenow(container)).toBe('40');
    expect(ignitedEls(container).length).toBe(4);
  });

  it('Home from 50 kills the ignition (0 is outside the band)', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS });
    expect(ignitedEls(container).length).toBe(4);
    press(container, 'Home');
    expect(valuenow(container)).toBe('0');
    expect(ignitedEls(container).length).toBe(0);
  });

  it('full keyboard sweep across the band toggles at exactly 40 and 60, never touching non-paired sentences', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 36 });
    expect(ignitedEls(container).length).toBe(0);
    press(container, 'ArrowRight'); // 38
    expect(ignitedEls(container).length).toBe(0);
    press(container, 'ArrowRight'); // 40 — in
    expect(ignitedEls(container).length).toBe(4);
    press(container, 'ArrowRight', 10); // 60 — still in (inclusive)
    expect(valuenow(container)).toBe('60');
    expect(ignitedEls(container).length).toBe(4);
    press(container, 'ArrowRight'); // 62 — out
    expect(ignitedEls(container).length).toBe(0);
    // non-paired idx 0 never ignited at ANY step above
    expect(isIgnited(container, 'left', 0)).toBe(false);
    expect(isIgnited(container, 'right', 0)).toBe(false);
  });

  it('overlapPairs=[] (and omitted): NOTHING ever ignites, even dead-center', () => {
    const explicit = renderSlider({ overlapPairs: [], position: 50 });
    const omitted = renderSlider({ position: 50 });
    expect(ignitedEls(explicit.container).length).toBe(0);
    expect(ignitedEls(omitted.container).length).toBe(0);
    press(explicit.container, 'ArrowLeft', 5); // walk within the band
    expect(ignitedEls(explicit.container).length).toBe(0);
  });

  it('out-of-range pairs are ignored WHOLESALE without crashing; valid pairs still work', () => {
    const { container } = renderSlider({
      overlapPairs: [
        [99, 0],
        [-1, 2],
        [0, 0],
      ],
      position: 50,
    });
    // [99,0] and [-1,2] each contain an invalid index → the whole pair
    // is discarded (pinned ruling): right 0 ignites only via [0,0],
    // right 2 must NOT ignite.
    expect(isIgnited(container, 'left', 0)).toBe(true);
    expect(isIgnited(container, 'right', 0)).toBe(true);
    expect(isIgnited(container, 'right', 2)).toBe(false);
    expect(ignitedEls(container).length).toBe(2);
  });

  it('duplicate pairs do not crash or double-apply — class present exactly once', () => {
    const { container } = renderSlider({
      overlapPairs: [
        [1, 1],
        [1, 1],
        [1, 1],
      ],
      position: 50,
    });
    expect(isIgnited(container, 'left', 1)).toBe(true);
    expect(isIgnited(container, 'right', 1)).toBe(true);
    expect(ignitedEls(container).length).toBe(2);
    // class list itself must not accumulate duplicates
    const cls = sentenceEl(container, 'left', 1)!.getAttribute('class') || '';
    expect(cls.split(/\s+/).filter((c) => c === 'ignited').length).toBe(1);
    // leaving the band still clears everything
    press(container, 'Home');
    expect(ignitedEls(container).length).toBe(0);
  });

  it('the same left index in TWO pairs ignites that sentence plus both right partners', () => {
    const { container } = renderSlider({
      overlapPairs: [
        [0, 1],
        [0, 2],
      ],
      position: 50,
    });
    expect(isIgnited(container, 'left', 0)).toBe(true);
    expect(isIgnited(container, 'right', 1)).toBe(true);
    expect(isIgnited(container, 'right', 2)).toBe(true);
    expect(isIgnited(container, 'left', 1)).toBe(false);
    expect(isIgnited(container, 'left', 2)).toBe(false);
    expect(isIgnited(container, 'right', 0)).toBe(false);
    expect(ignitedEls(container).length).toBe(3);
  });

  it('ALL sentences paired: every sentence ignites at 50; NONE at 0', () => {
    const all: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    const { container } = renderSlider({ overlapPairs: all, position: 50 });
    expect(ignitedEls(container).length).toBe(6);
    press(container, 'Home');
    expect(ignitedEls(container).length).toBe(0);
  });
});

// ============================================================
// 5. Pointer interaction — drag math on a mocked rect
// ============================================================
describe('DiffSlider -- pointer interaction', () => {
  it('pointerdown + pointermove: clientX 100 over a 400px root → 25', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 100);
    expect(valuenow(container)).toBe('25');
    expectSplit(container, 25);
  });

  it('respects a non-zero rect.left: left=100, width=400, clientX=200 → 25', () => {
    const { container } = renderSlider();
    mockRect(container, 100, 400);
    pointerDown(container, 300);
    pointerMove(container, 200);
    expect(valuenow(container)).toBe('25');
  });

  it('drag beyond the LEFT edge clamps to 0', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, -50);
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
  });

  it('drag beyond the RIGHT edge clamps to 100', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 900);
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
  });

  it('pointermove WITHOUT a preceding pointerdown changes nothing', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    const styleBefore = rootEl(container).getAttribute('style');
    pointerMove(container, 100);
    pointerMove(container, 380);
    expect(valuenow(container)).toBe('50');
    expect(rootEl(container).getAttribute('style')).toBe(styleBefore);
  });

  it('pointerup ends the drag — subsequent moves change nothing', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 100); // 25
    pointerUp(container, 100);
    pointerMove(container, 300); // would be 75 if the drag were live
    pointerMove(container, 0);
    expect(valuenow(container)).toBe('25');
    expectSplit(container, 25);
  });

  it('a SECOND pointerdown re-enables dragging after pointerup', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 100); // 25
    pointerUp(container, 100);
    pointerDown(container, 100);
    pointerMove(container, 200); // 50
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('fractional drag: clientX 100 over a 300px root (33.333…%) → aria-valuenow is the INTEGER "33"', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 300);
    pointerDown(container, 150);
    pointerMove(container, 100);
    const v = valuenow(container);
    expect(v).toMatch(/^\d+$/); // never "33.333333333333336"
    expect(v).toBe('33');
  });

  it('dragging across the ignition band ignites and de-ignites synchronously', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 10 });
    mockRect(container, 0, 400);
    expect(ignitedEls(container).length).toBe(0);
    pointerDown(container, 40);
    pointerMove(container, 200); // 50 — inside the band
    expect(ignitedEls(container).length).toBe(4);
    pointerMove(container, 380); // 95 — outside
    expect(ignitedEls(container).length).toBe(0);
    pointerMove(container, 160); // 40 — inclusive boundary, back in
    expect(ignitedEls(container).length).toBe(4);
    pointerUp(container, 160);
    expect(ignitedEls(container).length).toBe(4); // releasing does not clear
  });
});

// ============================================================
// 6. Two instances are independent
// ============================================================
describe('DiffSlider -- two instances are independent', () => {
  it('keyboard on instance A leaves instance B untouched', () => {
    const a = renderSlider({ position: 20 });
    const b = renderSlider({ position: 80 });
    const bStyle = rootEl(b.container).getAttribute('style');
    press(a.container, 'ArrowRight');
    press(a.container, 'PageUp');
    expect(valuenow(a.container)).toBe('32');
    expect(valuenow(b.container)).toBe('80');
    expect(rootEl(b.container).getAttribute('style')).toBe(bStyle);
  });

  it("pointer drag on instance A leaves instance B's position untouched", () => {
    const a = renderSlider({ position: 20 });
    const b = renderSlider({ position: 80 });
    mockRect(a.container, 0, 400);
    mockRect(b.container, 0, 400);
    const bStyle = rootEl(b.container).getAttribute('style');
    pointerDown(a.container, 80);
    pointerMove(a.container, 200); // A → 50
    pointerUp(a.container, 200);
    expect(valuenow(a.container)).toBe('50');
    expect(valuenow(b.container)).toBe('80');
    expect(rootEl(b.container).getAttribute('style')).toBe(bStyle);
  });
});

// ============================================================
// 7. Degenerate content — empty sides, single sentences, 200 sentences
// ============================================================
describe('DiffSlider -- degenerate content', () => {
  it('BOTH sentence arrays empty: no crash, zero sentences, slider still keyboard-operable, sr present with labels', () => {
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [] },
      right: { ...RIGHT, sentences: [] },
    });
    expect(qa(container, 'diff-sentence').length).toBe(0);
    press(container, 'ArrowRight');
    expect(valuenow(container)).toBe('52');
    const srText = sr(container)!.textContent || '';
    expect(srText).toContain(LEFT.label);
    expect(srText).toContain(RIGHT.label);
  });

  it('both sides empty + overlapPairs=[[0,0]]: no crash, nothing ignites at 50', () => {
    let container!: Element;
    expect(() => {
      ({ container } = renderSlider({
        left: { ...LEFT, sentences: [] },
        right: { ...RIGHT, sentences: [] },
        overlapPairs: [[0, 0]],
        position: 50,
      }));
    }).not.toThrow();
    expect(ignitedEls(container).length).toBe(0);
    // and keyboard through the band still cannot conjure ignition
    press(container, 'ArrowLeft', 5);
    expect(ignitedEls(container).length).toBe(0);
  });

  it('one side empty: the other still renders; a pair pointing into the empty side is ignored', () => {
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [] },
      right: { ...RIGHT, sentences: ['only survivor'] },
      overlapPairs: [[0, 0]],
      position: 50,
    });
    expect(qa(panel(container, 'left'), 'diff-sentence').length).toBe(0);
    expect(qa(panel(container, 'right'), 'diff-sentence').length).toBe(1);
    // left index 0 does not exist → whole pair discarded (pinned ruling)
    expect(isIgnited(container, 'right', 0)).toBe(false);
    expect(ignitedEls(container).length).toBe(0);
  });

  it('single sentence each with pair [[0,0]]: ignites at 50, not at 38', () => {
    const { container } = renderSlider({
      left: { ...LEFT, sentences: ['solo left'] },
      right: { ...RIGHT, sentences: ['solo right'] },
      overlapPairs: [[0, 0]],
      position: 50,
    });
    expect(isIgnited(container, 'left', 0)).toBe(true);
    expect(isIgnited(container, 'right', 0)).toBe(true);
    press(container, 'ArrowLeft', 6); // 50 → 38
    expect(valuenow(container)).toBe('38');
    expect(ignitedEls(container).length).toBe(0);
  });

  it('200 sentences per side: renders all, data-idx up to 199, pair [199,199] ignites', () => {
    const big = (tag: string) =>
      Array.from({ length: 200 }, (_, i) => `${tag} sentence ${i}`);
    const { container } = renderSlider({
      left: { ...LEFT, sentences: big('L') },
      right: { ...RIGHT, sentences: big('R') },
      overlapPairs: [[199, 199]],
      position: 50,
    });
    expect(qa(panel(container, 'left'), 'diff-sentence').length).toBe(200);
    expect(qa(panel(container, 'right'), 'diff-sentence').length).toBe(200);
    expect(sentenceEl(container, 'left', 199)!.textContent).toContain(
      'L sentence 199',
    );
    expect(isIgnited(container, 'left', 199)).toBe(true);
    expect(isIgnited(container, 'right', 199)).toBe(true);
    expect(ignitedEls(container).length).toBe(2);
  });
});

// ============================================================
// 8. XSS, injection & content fidelity
// ============================================================
describe('DiffSlider -- XSS & content fidelity', () => {
  const IMG_XSS = '<img src=x onerror="window.__pwned=1">';

  it('img-onerror payload in sentences is LITERAL in both panels; no img; __pwned undefined', () => {
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [IMG_XSS] },
      right: { ...RIGHT, sentences: ['x ' + IMG_XSS] },
    });
    expect(sentenceEl(container, 'left', 0)!.textContent).toContain(IMG_XSS);
    expect(sentenceEl(container, 'right', 0)!.textContent).toContain(IMG_XSS);
    expect(document.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('img-onerror payload is LITERAL in the sr copy too', () => {
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [IMG_XSS] },
    });
    const srEl = sr(container)!;
    expect(srEl.textContent).toContain(IMG_XSS);
    expect(srEl.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('script-tag sentence never creates a script element on either side', () => {
    const payload = '<script>window.__pwned=1<' + '/script>';
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [payload] },
      right: { ...RIGHT, sentences: [payload] },
    });
    expect(container.querySelector('script')).toBeNull();
    expect(sentenceEl(container, 'left', 0)!.textContent).toContain(payload);
    expect((window as any).__pwned).toBeUndefined();
  });

  it('hostile labels stay literal in diff-label, the divider aria-label, and the sr copy', () => {
    const payload = '<b onmouseover="window.__pwned=1">4.6 · night</b>';
    const { container } = renderSlider({
      left: { ...LEFT, label: payload },
    });
    const labelEl = q(panel(container, 'left'), 'diff-label')!;
    expect(labelEl.textContent).toContain(payload);
    expect(container.querySelector('b')).toBeNull();
    expect(divider(container).getAttribute('aria-label') || '').toContain(payload);
    expect(sr(container)!.textContent).toContain(payload);
    expect((window as any).__pwned).toBeUndefined();
  });

  it('hostile version string: fallback chip color, no script element, no crash', () => {
    const payload = '"><script>window.__pwned=1<' + '/script>';
    let container!: Element;
    expect(() => {
      ({ container } = renderSlider({
        left: { ...LEFT, version: payload },
      }));
    }).not.toThrow();
    const chip = q(panel(container, 'left'), 'diff-version-chip')!;
    expect((chip.getAttribute('style') || '').toLowerCase()).toContain('#3a3f4b');
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('HTML entities in sentences stay literal (not decoded)', () => {
    const s = '&amp; &lt;split&gt; &quot;divider&quot;';
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [s] },
    });
    expect(sentenceEl(container, 'left', 0)!.textContent).toContain(s);
    expect(sr(container)!.textContent).toContain(s);
  });

  it('unicode / RTL / ZWJ-emoji sentences survive intact in panels AND sr', () => {
    const l = 'مرحبا بالعالم — النافذة تُغلق الليلة';
    const r = '👨‍👩‍👧‍👦 statús̀ 𝕏𝕐 — the wíndow réopens';
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [l] },
      right: { ...RIGHT, sentences: [r] },
    });
    expect(sentenceEl(container, 'left', 0)!.textContent).toContain(l);
    expect(sentenceEl(container, 'right', 0)!.textContent).toContain(r);
    const srText = sr(container)!.textContent || '';
    expect(srText).toContain(l);
    expect(srText).toContain(r);
  });
});

// ============================================================
// 9. CSS contract — reduced-motion block
// ============================================================
describe('DiffSlider -- CSS contract', () => {
  it('injected CSS contains a @media (prefers-reduced-motion: reduce) block', () => {
    renderSlider();
    expect(
      /@media[^{]*prefers-reduced-motion\s*:\s*reduce/.test(getInjectedCss()),
    ).toBe(true);
  });

  it('the reduced-motion block disables the clip transition (transition + none/0s)', () => {
    renderSlider();
    const block = extractReducedMotionCss();
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/transition/);
    expect(block).toMatch(/none|0s/);
  });
});

// ============================================================
// 10. prefers-reduced-motion — ISOLATED matchMedia mock.
// Reduced motion kills transitions, NOT interactivity.
// ============================================================
describe('DiffSlider -- reduced motion keeps the slider operable', () => {
  // Overrides the file-level mockReducedMotion(false); the file-level
  // afterEach restores the original matchMedia so nothing leaks out.
  beforeEach(() => {
    mockReducedMotion(true);
  });

  it('mounts with the full slider contract intact under reduced motion', () => {
    const { container } = renderSlider();
    const d = divider(container);
    expect(d.getAttribute('role')).toBe('slider');
    expect(d.getAttribute('tabindex')).toBe('0');
    expect(d.getAttribute('aria-valuenow')).toMatch(/^\d+$/);
    expect(insideAriaHidden(d)).toBe(false);
  });

  it('keyboard STILL works under reduced motion: arrows, Home, End all move the divider', () => {
    const { container } = renderSlider();
    const before = valuenow(container);
    press(container, 'ArrowRight');
    expect(valuenow(container)).not.toBe(before);
    press(container, 'Home');
    expect(valuenow(container)).toBe('0');
    press(container, 'End');
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
  });

  it('sr copy is still present and complete under reduced motion', () => {
    const { container } = renderSlider();
    const srEl = sr(container)!;
    expect(srEl.classList.contains('sr-only')).toBe(true);
    expect(srEl.getAttribute('aria-hidden')).not.toBe('true');
    const text = srEl.textContent || '';
    for (const s of [...LEFT.sentences, ...RIGHT.sentences]) {
      expect(text).toContain(s);
    }
  });

  it('reduced-motion path is XSS-safe too', () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [payload] },
    });
    expect(sentenceEl(container, 'left', 0)!.textContent).toContain(payload);
    expect(document.querySelector('img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });
});

// ============================================================
// 10b. Non-reduced block AFTER the reduced block — proves the
// matchMedia mock did not leak forward (regression guard).
// ============================================================
describe('DiffSlider -- still fully interactive after the reduced-motion describe', () => {
  it('a component rendered here (reduced=false) starts at 50 and responds to keys and drags', () => {
    const { container } = renderSlider();
    expect(valuenow(container)).toBe('50');
    press(container, 'ArrowRight');
    expect(valuenow(container)).toBe('52');
    mockRect(container, 0, 400);
    pointerDown(container, 208);
    pointerMove(container, 100);
    expect(valuenow(container)).toBe('25');
  });
});

// ============================================================
// 11. Unmount & cleanup
// ============================================================
describe('DiffSlider -- unmount & cleanup', () => {
  it('unmount with no interaction: no throw; nothing remains in the document', () => {
    const { unmount } = renderSlider();
    expect(() => unmount()).not.toThrow();
    expect(document.querySelector('[data-testid="diff-slider"]')).toBeNull();
    expect(document.querySelector('[data-testid="diff-divider"]')).toBeNull();
  });

  it('unmount MID-DRAG: no throw; later window/document pointer events throw nothing and write nothing', () => {
    const { container, unmount } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 100); // drag is live
    expect(() => unmount()).not.toThrow();
    const bodyAfter = document.body.innerHTML;
    expect(() => {
      // any leaked document/window-level drag listeners would fire here
      window.dispatchEvent(pointerEvent('pointermove', 300));
      document.dispatchEvent(pointerEvent('pointermove', 350));
      window.dispatchEvent(pointerEvent('pointerup', 350));
      document.dispatchEvent(pointerEvent('pointerup', 350));
      window.dispatchEvent(pointerEvent('pointermove', 10));
    }).not.toThrow();
    expect(document.body.innerHTML).toBe(bodyAfter);
  });

  it('keyboard events dispatched at document level after unmount throw nothing and write nothing', () => {
    const { unmount } = renderSlider();
    unmount();
    const bodyAfter = document.body.innerHTML;
    expect(() => {
      for (const key of ['ArrowRight', 'Home', 'End', 'PageUp']) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      }
    }).not.toThrow();
    expect(document.body.innerHTML).toBe(bodyAfter);
  });
});

// ============================================================
// HARDENING PASS — appended after a first-attempt GREEN run.
// Each block probes one coordinator attack angle.
//   [EXPECTED FAILURE] — pins the coordinator's stated behavior
//     where the implementation is known to deviate; needs a ruling.
//   [SPEC-SILENT] — spec has no opinion; pins only invariants that
//     hold under any reasonable ruling, choice reported upstream.
// ============================================================

// ------------------------------------------------------------
// H1. Post-mount prop rerenders (angle 1 — spec-silent reactivity)
// The impl snapshots left/right/position/overlapPairs via untrack
// at init; template renders from consts. These tests assert ONLY
// invariants that hold whether or not the DOM tracks prop changes.
// ------------------------------------------------------------
describe('hardening: post-mount prop rerenders (spec-silent — invariant pins only)', () => {
  it('rerendering position/overlapPairs after mount does not crash and the divider stays operable', async () => {
    const { container, rerender } = renderSlider({ position: 20 });
    await rerender({ position: 90, overlapPairs: [[0, 0]] });
    // Whatever the reactivity ruling, spec invariants must hold:
    const d = divider(container);
    expect(d.getAttribute('role')).toBe('slider');
    expect(valuenow(container)).toMatch(/^\d+$/);
    press(container, 'End');
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
  });

  it('rerendering with hostile sentences/labels and garbage overlapPairs never yields live markup', async () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const { container, rerender } = renderSlider();
    await rerender({
      left: { label: payload, version: payload, sentences: [payload] },
      overlapPairs: 'garbage' as any,
      position: NaN,
    });
    // Holds whether the new props render (must be literal) or are frozen out:
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
    press(container, 'Home');
    expect(valuenow(container)).toBe('0');
  });
});

// ------------------------------------------------------------
// H2. Keyboard during an active drag (angle 2)
// ------------------------------------------------------------
describe('hardening: keyboard events during an active drag', () => {
  it('mid-drag ArrowLeft and pointer moves share ONE position: valuenow and style stay pairwise consistent after every event', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 100); // 25
    expect(valuenow(container)).toBe('25');
    expectSplit(container, 25);
    press(container, 'ArrowLeft'); // keyboard mid-drag: 25 → 23
    expect(valuenow(container)).toBe('23');
    expectSplit(container, 23);
    pointerMove(container, 300); // drag still live: recomputed from clientX → 75
    expect(valuenow(container)).toBe('75');
    expectSplit(container, 75);
    press(container, 'PageUp'); // 75 → 85
    expect(valuenow(container)).toBe('85');
    expectSplit(container, 85);
    pointerUp(container, 300);
    pointerMove(container, 40); // drag over — must be dead
    expect(valuenow(container)).toBe('85');
    expectSplit(container, 85);
  });
});

// ------------------------------------------------------------
// H3. Pointer event pathology (angle 3, plus uncovered
// pointercancel spec clause and down-during-drag)
// ------------------------------------------------------------
describe('hardening: pointer event pathology', () => {
  it('pointerdown WITHOUT pointerId (pressure 0) still starts a drag', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    const Ctor: any = (globalThis as any).PointerEvent ?? MouseEvent;
    divider(container).dispatchEvent(
      new Ctor('pointerdown', {
        clientX: 200,
        bubbles: true,
        cancelable: true,
        composed: true,
        pressure: 0,
      }),
    );
    pointerMove(container, 100);
    expect(valuenow(container)).toBe('25');
    expectSplit(container, 25);
  });

  it('zero-move drag (down immediately followed by up) leaves position unchanged AND disarms later moves', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    const styleBefore = rootEl(container).getAttribute('style');
    pointerDown(container, 200);
    pointerUp(container, 200);
    expect(valuenow(container)).toBe('50');
    expect(rootEl(container).getAttribute('style')).toBe(styleBefore);
    pointerMove(container, 40); // must be dead
    expect(valuenow(container)).toBe('50');
    expect(rootEl(container).getAttribute('style')).toBe(styleBefore);
  });

  it('pointermove with clientX=NaN mid-drag changes nothing, never poisons style, and does NOT kill the drag', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 100); // 25
    const ev = pointerEvent('pointermove', 0);
    Object.defineProperty(ev, 'clientX', { value: NaN }); // defeat any ctor coercion
    rootEl(container).dispatchEvent(ev);
    expect(valuenow(container)).toBe('25');
    expectSplit(container, 25);
    expect(rootEl(container).getAttribute('style') || '').not.toMatch(/NaN/);
    pointerMove(container, 300); // drag must STILL be live after the NaN move
    expect(valuenow(container)).toBe('75');
  });

  it('pointercancel ends the drag exactly like pointerup; a fresh down re-arms', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 200);
    pointerMove(container, 100); // 25
    rootEl(container).dispatchEvent(pointerEvent('pointercancel', 100));
    pointerMove(container, 300);
    pointerMove(container, 0);
    expect(valuenow(container)).toBe('25');
    expectSplit(container, 25);
    pointerDown(container, 100);
    pointerMove(container, 200);
    expect(valuenow(container)).toBe('50');
  });

  it('a second pointerdown DURING a drag never double-applies moves; ONE up still ends everything', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 400);
    pointerDown(container, 100);
    pointerDown(container, 300); // down-during-drag
    pointerMove(container, 200); // 50
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
    pointerUp(container, 200);
    pointerMove(container, 40);
    pointerMove(container, 360);
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('[SPEC-SILENT] simultaneous drags on two instances each track their OWN rect from one shared window move', () => {
    const a = renderSlider();
    const b = renderSlider();
    mockRect(a.container, 0, 400);
    mockRect(b.container, 100, 400);
    pointerDown(a.container, 200);
    pointerDown(b.container, 200);
    window.dispatchEvent(pointerEvent('pointermove', 200));
    // Spec is silent on pointerId routing; pin per-instance rect math + no cross-talk.
    expect(valuenow(a.container)).toBe('50'); // (200-0)/400
    expect(valuenow(b.container)).toBe('25'); // (200-100)/400
    window.dispatchEvent(pointerEvent('pointerup', 200));
    window.dispatchEvent(pointerEvent('pointermove', 0));
    expect(valuenow(a.container)).toBe('50');
    expect(valuenow(b.container)).toBe('25');
  });
});

// ------------------------------------------------------------
// H4. Zero-width root rect (angle 4)
// ------------------------------------------------------------
describe('hardening: zero-width root rect', () => {
  it('move with clientX exactly at rect.left (0/0 → NaN) leaves position unchanged, no NaN in style', () => {
    const { container } = renderSlider();
    mockRect(container, 50, 0);
    pointerDown(container, 50);
    pointerMove(container, 50); // (50-50)/0 → NaN
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
    expect(rootEl(container).getAttribute('style') || '').not.toMatch(/NaN/);
  });

  it('ANY move over a zero-width rect leaves position unchanged (covered by the width guard)', () => {
    // The implementation's degenerate-geometry guard (DiffSlider.svelte:
    // `if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return;`)
    // bails out BEFORE the percentage math, so ±Infinity never reaches the
    // clamp and a zero-width rect can never move the divider — for ANY
    // clientX, not just the clientX === rect.left (NaN) case above.
    const { container } = renderSlider();
    mockRect(container, 0, 0);
    pointerDown(container, 0);
    pointerMove(container, 10); // +Infinity → impl clamps to 100
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
    pointerMove(container, -10); // −Infinity → impl clamps to 0
    expect(valuenow(container)).toBe('50');
    expectSplit(container, 50);
  });

  it('whatever the zero-width ruling: valuenow stays an integer in [0,100], style never carries NaN/Infinity', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 0);
    pointerDown(container, 0);
    for (const x of [10, -10, 0, 1e9, -1e9]) {
      pointerMove(container, x);
      const v = valuenow(container);
      expect(v).toMatch(/^\d+$/);
      expect(Number(v)).toBeGreaterThanOrEqual(0);
      expect(Number(v)).toBeLessThanOrEqual(100);
      expect(rootEl(container).getAttribute('style') || '').not.toMatch(/NaN|Infinity/);
    }
  });
});

// ------------------------------------------------------------
// H5. Ignition band vs fractional / initial positions (angle 5 + 7)
// The band operates on the RAW position; aria-valuenow is rounded.
// A rounded "40"/"60" is NOT proof of band membership.
// ------------------------------------------------------------
describe('hardening: ignition band vs fractional positions (band on RAW position, not rounded valuenow)', () => {
  it('initial position 39.999: valuenow rounds to "40" but the band does NOT ignite', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 39.999 });
    expect(valuenow(container)).toBe('40');
    expect(ignitedEls(container).length).toBe(0);
  });

  it('initial position 60.4: valuenow "60" yet OUTSIDE the band; ArrowLeft to 58.4 re-enters and ignites', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 60.4 });
    expect(valuenow(container)).toBe('60');
    expect(ignitedEls(container).length).toBe(0);
    press(container, 'ArrowLeft'); // 58.4 — inside
    expect(valuenow(container)).toBe('58');
    expect(ignitedEls(container).length).toBe(4);
  });

  it('initial position 41.7 ignites in the INITIAL markup — no event required (SSR-shaped path)', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 41.7 });
    expect(isIgnited(container, 'left', 1)).toBe(true);
    expect(isIgnited(container, 'left', 2)).toBe(true);
    expect(isIgnited(container, 'right', 1)).toBe(true);
    expect(isIgnited(container, 'right', 2)).toBe(true);
    expect(ignitedEls(container).length).toBe(4);
  });

  it('drag to raw 39.9 does not ignite despite valuenow "40"; raw 40.0 does; raw 60.1 does not despite "60"', () => {
    const { container } = renderSlider({ overlapPairs: PAIRS, position: 10 });
    mockRect(container, 0, 1000);
    pointerDown(container, 100);
    pointerMove(container, 399); // 39.9
    expect(valuenow(container)).toBe('40');
    expect(ignitedEls(container).length).toBe(0);
    pointerMove(container, 400); // 40.0 — inclusive edge
    expect(ignitedEls(container).length).toBe(4);
    pointerMove(container, 601); // 60.1
    expect(valuenow(container)).toBe('60');
    expect(ignitedEls(container).length).toBe(0);
  });
});

// ------------------------------------------------------------
// H6. overlapPairs pathology (angles 6 + 11)
// ------------------------------------------------------------
describe('hardening: overlapPairs pathology', () => {
  it('string indices, floats, length-1 pairs and non-array entries are ALL discarded; the lone valid pair survives', () => {
    const { container } = renderSlider({
      overlapPairs: [
        ['0', '0'],
        [0.5, 1],
        [0],
        [],
        null,
        {},
        '0,0',
        ['x', 0],
        [0, 0], // the only survivor
      ] as any,
      position: 50,
    });
    expect(isIgnited(container, 'left', 0)).toBe(true);
    expect(isIgnited(container, 'right', 0)).toBe(true);
    expect(ignitedEls(container).length).toBe(2);
  });

  it('[1, "1"] — valid left, string right — is discarded WHOLESALE: the valid side never ignites', () => {
    const { container } = renderSlider({
      overlapPairs: [[1, '1']] as any,
      position: 50,
    });
    expect(isIgnited(container, 'left', 1)).toBe(false);
    expect(ignitedEls(container).length).toBe(0);
  });

  it('1000-pair list against 3 sentences: no crash, only in-range pairs survive, band exit still clears', () => {
    const pairs: any[] = [];
    for (let i = 0; i < 1000; i++) pairs.push([i, i]); // valid only for i ∈ {0,1,2}
    const { container } = renderSlider({ overlapPairs: pairs, position: 50 });
    expect(ignitedEls(container).length).toBe(6);
    press(container, 'End');
    expect(ignitedEls(container).length).toBe(0);
  });

  it('overlapPairs that is not an array at all (string) neither crashes nor ignites; slider operable', () => {
    let container!: Element;
    expect(() => {
      ({ container } = renderSlider({
        overlapPairs: 'pairs, allegedly' as any,
        position: 50,
      }));
    }).not.toThrow();
    expect(ignitedEls(container).length).toBe(0);
    press(container, 'ArrowLeft');
    expect(valuenow(container)).toBe('48');
  });

  it('negative-zero index [-0, 0] behaves as index 0 (SameValueZero — −0 is not "negative")', () => {
    const { container } = renderSlider({
      overlapPairs: [[-0, 0]] as any,
      position: 50,
    });
    expect(isIgnited(container, 'left', 0)).toBe(true);
    expect(isIgnited(container, 'right', 0)).toBe(true);
    expect(ignitedEls(container).length).toBe(2);
  });

  it('exact-length off-by-one: with 3 sentences [[2,2]] ignites, [[3,3]] and [[2,3]] are discarded', () => {
    const { container } = renderSlider({
      overlapPairs: [
        [2, 2],
        [3, 3],
        [2, 3],
      ],
      position: 50,
    });
    expect(isIgnited(container, 'left', 2)).toBe(true);
    expect(isIgnited(container, 'right', 2)).toBe(true);
    expect(ignitedEls(container).length).toBe(2);
    expect(isIgnited(container, 'left', 1)).toBe(false);
    expect(isIgnited(container, 'right', 1)).toBe(false);
  });

  it('[SPEC-SILENT] extra elements in a pair ([0, 0, 99, "x"]) do not invalidate the leading valid pair', () => {
    const { container } = renderSlider({
      overlapPairs: [[0, 0, 99, 'x']] as any,
      position: 50,
    });
    expect(isIgnited(container, 'left', 0)).toBe(true);
    expect(isIgnited(container, 'right', 0)).toBe(true);
    expect(ignitedEls(container).length).toBe(2);
  });

  it('middle-only pair [[1,1]] ignites exactly the middle; adjacent data-idx untouched on both sides', () => {
    const { container } = renderSlider({ overlapPairs: [[1, 1]], position: 50 });
    for (const side of ['left', 'right'] as const) {
      expect(isIgnited(container, side, 0)).toBe(false);
      expect(isIgnited(container, side, 1)).toBe(true);
      expect(isIgnited(container, side, 2)).toBe(false);
      const els = qa(panel(container, side), 'diff-sentence');
      els.forEach((el, i) => expect(el.getAttribute('data-idx')).toBe(String(i)));
    }
    expect(ignitedEls(container).length).toBe(2);
  });
});

// ------------------------------------------------------------
// H7. Fractional drags — valuenow integer, style raw (angle 7)
// ------------------------------------------------------------
describe('hardening: fractional drags keep valuenow integral and the style raw', () => {
  it('three sequential fractional drags (33.33…, 66.66…, 12.5) → valuenow "33"/"67"/"13"; style carries the raw percent', () => {
    const { container } = renderSlider();
    mockRect(container, 0, 300);

    pointerDown(container, 150);
    pointerMove(container, 100); // (100/300)*100 = 33.333…
    expect(valuenow(container)).toBe('33');
    expect(rootEl(container).getAttribute('style') || '').toContain(
      `${(100 / 300) * 100}%`,
    );
    pointerUp(container, 100);

    pointerDown(container, 100);
    pointerMove(container, 200); // 66.666… → rounds UP to 67
    expect(valuenow(container)).toBe('67');
    expect(rootEl(container).getAttribute('style') || '').toContain(
      `${(200 / 300) * 100}%`,
    );
    pointerUp(container, 200);

    mockRect(container, 0, 400); // re-mock (configurable) for an exact half
    pointerDown(container, 200);
    pointerMove(container, 50); // 12.5 → Math.round half-up → 13
    expect(valuenow(container)).toBe('13');
    expect(rootEl(container).getAttribute('style') || '').toContain('12.5%');
    pointerUp(container, 50);

    expect(valuenow(container)).toMatch(/^\d+$/);
  });
});

// ------------------------------------------------------------
// H8. Keyboard clamp arithmetic at the extremes (angle 8)
// ------------------------------------------------------------
describe('hardening: keyboard clamp arithmetic at the extremes', () => {
  it('position 1 + ArrowLeft lands EXACTLY on 0 (not −1); repeat stays 0', () => {
    const { container } = renderSlider({ position: 1 });
    press(container, 'ArrowLeft');
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
    press(container, 'ArrowLeft');
    expect(valuenow(container)).toBe('0');
  });

  it('position 99 + ArrowRight lands EXACTLY on 100 (not 101); repeat stays 100', () => {
    const { container } = renderSlider({ position: 99 });
    press(container, 'ArrowRight');
    expect(valuenow(container)).toBe('100');
    expectSplit(container, 100);
    press(container, 'ArrowRight');
    expect(valuenow(container)).toBe('100');
  });

  it('PageDown from 5 clamps to 0; PageUp from 95 clamps to 100; End×3 then ArrowRight stays 100', () => {
    const down = renderSlider({ position: 5 });
    press(down.container, 'PageDown');
    expect(valuenow(down.container)).toBe('0');
    expectSplit(down.container, 0);

    const up = renderSlider({ position: 95 });
    press(up.container, 'PageUp');
    expect(valuenow(up.container)).toBe('100');
    press(up.container, 'End', 3);
    press(up.container, 'ArrowRight');
    expect(valuenow(up.container)).toBe('100');
    expectSplit(up.container, 100);
  });

  it('fractional start 0.5: valuenow rounds to "1"; ArrowLeft clamps the RAW value (−1.5) to 0', () => {
    const { container } = renderSlider({ position: 0.5 });
    expect(valuenow(container)).toBe('1');
    press(container, 'ArrowLeft'); // 0.5 − 2 = −1.5 → 0
    expect(valuenow(container)).toBe('0');
    expectSplit(container, 0);
  });
});

// ------------------------------------------------------------
// H9. Empty sentence arrays + non-empty overlapPairs (angle 9)
// ------------------------------------------------------------
describe('hardening: empty sentence arrays with non-empty overlapPairs', () => {
  it('slider stays fully operable (keyboard AND drag) and NOTHING ever ignites across a full band sweep', () => {
    const { container } = renderSlider({
      left: { ...LEFT, sentences: [] },
      right: { ...RIGHT, sentences: [] },
      overlapPairs: [
        [0, 0],
        [1, 1],
        [5, 5],
      ],
      position: 50,
    });
    expect(ignitedEls(container).length).toBe(0);
    press(container, 'Home');
    press(container, 'PageUp', 10); // walk 0 → 100 straight through the band
    expect(valuenow(container)).toBe('100');
    expect(ignitedEls(container).length).toBe(0);
    mockRect(container, 0, 400);
    pointerDown(container, 400);
    pointerMove(container, 200); // 50 — dead centre of the band
    expect(valuenow(container)).toBe('50');
    expect(ignitedEls(container).length).toBe(0);
    pointerUp(container, 200);
  });
});

// ------------------------------------------------------------
// H10. Retained node references after unmount (angle 10)
// Existing unmount tests dispatch on document/window; these attack
// the RETAINED element references directly.
// ------------------------------------------------------------
describe('hardening: retained node references stay inert after unmount', () => {
  it('keydown dispatched on the RETAINED divider node after unmount neither throws nor rewrites its attributes', () => {
    const { container, unmount } = renderSlider();
    const d = divider(container); // retain the reference across unmount
    unmount();
    const before = d.getAttribute('aria-valuenow');
    expect(() => {
      for (const key of ['ArrowRight', 'End', 'PageUp', 'Home']) {
        d.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      }
    }).not.toThrow();
    expect(d.getAttribute('aria-valuenow')).toBe(before);
  });

  it('pointerdown on the RETAINED divider after unmount does not re-arm dragging or mutate anything', () => {
    const { container, unmount } = renderSlider();
    const d = divider(container);
    const root = mockRect(container, 0, 400);
    unmount();
    const bodyAfter = document.body.innerHTML;
    const styleBefore = root.getAttribute('style');
    expect(() => {
      d.dispatchEvent(pointerEvent('pointerdown', 200));
      window.dispatchEvent(pointerEvent('pointermove', 100));
      window.dispatchEvent(pointerEvent('pointerup', 100));
    }).not.toThrow();
    expect(root.getAttribute('style')).toBe(styleBefore);
    expect(d.getAttribute('aria-valuenow')).toBe('50');
    expect(document.body.innerHTML).toBe(bodyAfter);
  });
});

// ------------------------------------------------------------
// H11. Divider aria-label with hostile label text (angle 12)
// ------------------------------------------------------------
describe('hardening: divider aria-label with hostile label text', () => {
  it('quote/angle-bracket payloads in BOTH labels land verbatim in aria-label with no attribute breakout', () => {
    const lPayload = '4.6" onmouseover="window.__pwned=1" data-x="';
    const rPayload =
      "</div><script>window.__pwned=1</scr" + "ipt><div aria-label='";
    const { container } = renderSlider({
      left: { ...LEFT, label: lPayload },
      right: { ...RIGHT, label: rPayload },
    });
    const d = divider(container);
    const label = d.getAttribute('aria-label') || '';
    expect(label).toContain(lPayload);
    expect(label).toContain(rPayload);
    // no attribute breakout on the divider itself
    expect(d.getAttribute('onmouseover')).toBeNull();
    expect(d.getAttribute('data-x')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
    // still exactly one divider carrying the full slider contract
    expect(qa(container, 'diff-divider').length).toBe(1);
    expect(d.getAttribute('role')).toBe('slider');
  });
});

// ------------------------------------------------------------
// Review pins — 2026-07-15
// ------------------------------------------------------------
describe('review pins 2026-07-15', () => {
  /**
   * All flat rules in the injected CSS whose selector targets the
   * .divider element's :focus-visible state itself — NOT the ::before
   * decoration and NOT descendant rules like
   * `.divider:focus-visible .divider-handle`. Svelte scoping hashes
   * (.svelte-xxxx) may appear anywhere in the class chain, so match on
   * fragments rather than the exact authored selector.
   */
  function dividerFocusVisibleRules(): Array<{ selector: string; body: string }> {
    const css = getInjectedCss();
    const rules: Array<{ selector: string; body: string }> = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      if (!selector.includes('.divider')) continue;
      if (!selector.includes(':focus-visible')) continue;
      if (selector.includes('::')) continue; // pseudo-element decoration rule
      if (/:focus-visible\S*\s+\S/.test(selector)) continue; // descendant rule
      rules.push({ selector, body: m[2] });
    }
    return rules;
  }

  it('.divider:focus-visible declares a REAL outline (not outline: none)', () => {
    renderSlider();
    const rules = dividerFocusVisibleRules();
    expect(
      rules.length,
      'no .divider:focus-visible rule found in the injected CSS',
    ).toBeGreaterThan(0);
    const bodies = rules.map((r) => r.body).join(';');
    // Suppressing the native focus ring on the element itself leaves
    // keyboard users with no OS/UA-level indicator; the pin requires a
    // real outline declaration on the :focus-visible rule.
    expect(
      bodies,
      `.divider:focus-visible must not suppress the outline (got: ${bodies.trim()})`,
    ).not.toMatch(/outline\s*:\s*none/);
    expect(
      bodies,
      `.divider:focus-visible must declare a real outline (got: ${bodies.trim()})`,
    ).toMatch(/outline\s*:\s*(?!none)\S/);
  });
});
