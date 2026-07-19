import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import InterruptionEngine from './InterruptionEngine.svelte';

// ============================================================
// Contractual constants (fade-in-place spec — zero layout shift)
// ============================================================

/** Quote 1 reveals (class toggle only) at exactly 2500ms after mount */
const REVEAL_1_MS = 2500;
/** Quote 2 reveals (class toggle only) at exactly 5000ms after mount */
const REVEAL_2_MS = 5000;
/** Comfortably past every timer in the component */
const PAST_END_MS = 60000;

const ORIGINAL_MATCH_MEDIA = window.matchMedia;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
  delete (window as any).__ie_pwned;
});

// ============================================================
// Test data factory
// ============================================================

function makeQuote(overrides: Record<string, any> = {}) {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 10),
    text: "The irony: I built a memory system because I don't have memory.",
    source_file: '2026-01-15.md',
    source_type: 'daily_note',
    date: '2026-01-15',
    model_version: '4.5',
    themes: ['identity', 'memory'],
    suggested_section: 1,
    ...overrides,
  };
}

/** Build N quotes all targeting the same section */
function makeQuotesForSection(section: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeQuote({
      id: `section-${section}-quote-${i}`,
      text: `Quote ${i} for section ${section}`,
      suggested_section: section,
    }),
  );
}

/** Build quotes spread across multiple sections */
function makeQuotesAcrossSections(sectionsAndCounts: [number, number][]) {
  return sectionsAndCounts.flatMap(([section, count]) =>
    makeQuotesForSection(section, count),
  );
}

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

// ============================================================
// Timer helper — async advance so both classList-in-callback and
// $state-driven implementations flush before we assert
// ============================================================

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

// ============================================================
// Injected-CSS helpers (compilerOptions.css === 'injected')
// ============================================================

function getInjectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

/** `.pending` must match `.pending` / `.pending.svelte-x` but NOT `.pending-foo` */
function classSelectorRe(className: string): RegExp {
  return new RegExp('\\.' + className + '(?![\\w-])');
}

const CSS_RULE_RE = /([^{}]+)\{([^{}]*)\}/g;

/** [selector, body] pairs — the flat scan also surfaces rules nested inside media blocks */
function cssRules(css: string): Array<[string, string]> {
  return Array.from(css.matchAll(CSS_RULE_RE), (m) => [m[1], m[2]] as [string, string]);
}

/** All rule bodies whose selector carries `.className` exactly */
function cssRuleBodiesFor(className: string): string[] {
  const selRe = classSelectorRe(className);
  return cssRules(getInjectedCss())
    .filter(([sel]) => selRe.test(sel))
    .map(([, body]) => body);
}

/** Inner text of every `@media (prefers-reduced-motion: reduce)` block (brace-matched) */
function reducedMotionBlocks(): string[] {
  const css = getInjectedCss();
  const blocks: string[] = [];
  const headerRe = /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/g;
  for (const m of css.matchAll(headerRe)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push(css.slice(start, i - 1));
  }
  return blocks;
}

/** Reduced-motion CSS forces `.pending` visible (opacity 1 + visibility visible) */
function rmForcesPendingVisible(): boolean {
  const selRe = classSelectorRe('pending');
  return reducedMotionBlocks().some((block) =>
    cssRules(block).some(
      ([sel, body]) =>
        selRe.test(sel) &&
        /opacity\s*:\s*1/.test(body) &&
        /visibility\s*:\s*visible/.test(body),
    ),
  );
}

// ============================================================
// Structural helpers (the CLS invariant)
// ============================================================

function quoteEls(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-testid^="interruption-quote-"]'),
  );
}

function structureSnapshot(root: HTMLElement) {
  return {
    childElementCount: root.childElementCount,
    totalDescendants: root.querySelectorAll('*').length,
    quoteTestIds: quoteEls(root).map((el) => el.getAttribute('data-testid')),
  };
}

function isAriaHidden(el: Element): boolean {
  return el.getAttribute('aria-hidden') === 'true';
}

function isRevealedAria(el: Element): boolean {
  const v = el.getAttribute('aria-hidden');
  return v === null || v === 'false';
}

// ============================================================
// 1. Rendering — basic container presence
// ============================================================
describe('InterruptionEngine -- rendering', () => {
  it('renders a container with data-testid="interruption-engine"', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()] },
    });
    expect(getByTestId('interruption-engine')).toBeTruthy();
  });

  it('renders container even with empty quotes', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [] },
    });
    expect(getByTestId('interruption-engine')).toBeTruthy();
  });

  it('container is a real DOM element', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()] },
    });
    const el = getByTestId('interruption-engine');
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBeTruthy();
  });
});

// ============================================================
// 2. Quotes prop hostility — empty / null / garbage entries
// ============================================================
describe('InterruptionEngine -- quotes prop hostility', () => {
  it('renders no quote elements ever when quotes array is empty', async () => {
    vi.useFakeTimers();
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes: [], currentSection: 0 },
    });
    await advance(PAST_END_MS);
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
    expect(queryByTestId('interruption-quote-1')).toBeNull();
    expect(queryByTestId('interruption-quote-2')).toBeNull();
  });

  it('handles quotes=null without crashing (renders nothing)', async () => {
    vi.useFakeTimers();
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes: null as any, currentSection: 0 },
    });
    await advance(PAST_END_MS);
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('handles quotes prop omitted entirely (default [])', () => {
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: {},
    });
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('skips null/undefined/primitive entries mixed into the quotes array', async () => {
    vi.useFakeTimers();
    const quotes = [
      null,
      undefined,
      42,
      'not a quote',
      makeQuote({ text: 'The one survivor', suggested_section: 0 }),
    ] as any[];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    await advance(PAST_END_MS);
    expect(getByTestId('interruption-quote-0').textContent).toContain('The one survivor');
    expect(queryByTestId('interruption-quote-1')).toBeNull();
  });
});

// ============================================================
// 3. Filtering — suggested_section strict match, max 3
// ============================================================
describe('InterruptionEngine -- filtering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('pre-renders only quotes matching currentSection', () => {
    const quotes = [
      ...makeQuotesForSection(1, 2),
      ...makeQuotesForSection(2, 3),
      ...makeQuotesForSection(3, 1),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 2 },
    });
    const container = getByTestId('interruption-engine');
    // All 3 section-2 quotes exist in DOM at mount — no timers needed
    expect(getByTestId('interruption-quote-0')).toBeTruthy();
    expect(getByTestId('interruption-quote-1')).toBeTruthy();
    expect(getByTestId('interruption-quote-2')).toBeTruthy();
    expect(container.textContent).toContain('Quote 0 for section 2');
    expect(container.textContent).not.toContain('Quote 0 for section 1');
    expect(container.textContent).not.toContain('Quote 0 for section 3');
  });

  it('caps at 3 quote elements even with 7 matches — quote-3 never appears', async () => {
    const quotes = makeQuotesForSection(5, 7);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 5 },
    });
    expect(queryByTestId('interruption-quote-2')).toBeTruthy();
    expect(queryByTestId('interruption-quote-3')).toBeNull();
    await advance(PAST_END_MS);
    expect(queryByTestId('interruption-quote-3')).toBeNull();
    expect(queryByTestId('interruption-quote-4')).toBeNull();
  });

  it('renders fewer than 3 when fewer match', () => {
    const quotes = makeQuotesForSection(4, 1);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 4 },
    });
    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeNull();
  });

  it('uses strict equality — string suggested_section "2" does NOT match number 2', () => {
    const quotes = [
      makeQuote({ suggested_section: '2' as any, text: 'stringy section' }),
    ];
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 2 },
    });
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('filters out quotes with whitespace-only text', () => {
    const quotes = [
      makeQuote({ text: '   \n\t  ', suggested_section: 0 }),
      makeQuote({ text: 'real one', suggested_section: 0 }),
      makeQuote({ text: 'real two', suggested_section: 0 }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-0').textContent).toContain('real one');
    expect(getByTestId('interruption-quote-1').textContent).toContain('real two');
    expect(queryByTestId('interruption-quote-2')).toBeNull();
  });

  it('indices are 0-based and sequential after filtering (never original array indices)', () => {
    const quotes = [
      makeQuote({ suggested_section: 9, text: 'wrong section' }),
      makeQuote({ text: '', suggested_section: 3 }),
      makeQuote({ text: 'kept A', suggested_section: 3 }),
      makeQuote({ text: 'kept B', suggested_section: 3 }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 3 },
    });
    expect(getByTestId('interruption-quote-0').textContent).toContain('kept A');
    expect(getByTestId('interruption-quote-1').textContent).toContain('kept B');
    expect(queryByTestId('interruption-quote-2')).toBeNull();
    expect(queryByTestId('interruption-quote-3')).toBeNull();
  });
});

// ============================================================
// 4. Pre-rendered DOM at mount (fade-in-place core)
// ============================================================
describe('InterruptionEngine -- all quotes pre-rendered at mount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('all 3 matching quote elements exist in the DOM at t=0 (no timers advanced)', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-0')).toBeTruthy();
    expect(getByTestId('interruption-quote-1')).toBeTruthy();
    expect(getByTestId('interruption-quote-2')).toBeTruthy();
  });

  it('quotes 1 and 2 carry their FULL text at t=0 (text occupies layout immediately)', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-1').textContent).toContain('Quote 1 for section 0');
    expect(getByTestId('interruption-quote-2').textContent).toContain('Quote 2 for section 0');
  });

  it('quotes 1 and 2 carry their attribution at t=0', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    for (const idx of [1, 2]) {
      const attr = getByTestId(`interruption-quote-${idx}`).querySelector('.quote-attribution');
      expect(attr).not.toBeNull();
      expect((attr!.textContent || '').trim().length).toBeGreaterThan(0);
    }
  });

  it('attribution format is exactly "source_file · date · model_version" on a pre-rendered quote', () => {
    const quotes = [
      makeQuote({ suggested_section: 0 }),
      makeQuote({
        suggested_section: 0,
        source_file: 'notes/2026-03-22.md',
        date: '2026-03-22',
        model_version: '4.7',
      }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const attr = getByTestId('interruption-quote-1').querySelector('.quote-attribution');
    expect((attr!.textContent || '').trim()).toBe('notes/2026-03-22.md · 2026-03-22 · 4.7');
  });

  it('quote 0 renders through DecayingQuote immediately at t=0', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const q0 = getByTestId('interruption-quote-0');
    expect(q0.querySelector('[data-testid="decaying-quote"]')).not.toBeNull();
    expect(q0.textContent).toContain('Quote 0 for section 0');
  });

  it('EVEN indices render through DecayingQuote; ODD index 1 is a plain span with NO DecayingQuote — at t=0 and after 60s', async () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(
      getByTestId('interruption-quote-0').querySelector('[data-testid="decaying-quote"]'),
    ).not.toBeNull();
    expect(
      getByTestId('interruption-quote-2').querySelector('[data-testid="decaying-quote"]'),
    ).not.toBeNull();
    expect(
      getByTestId('interruption-quote-1').querySelector('[data-testid="decaying-quote"]'),
    ).toBeNull();
    await advance(PAST_END_MS);
    expect(
      getByTestId('interruption-quote-1').querySelector('[data-testid="decaying-quote"]'),
    ).toBeNull();
    expect(
      getByTestId('interruption-quote-2').querySelector('[data-testid="decaying-quote"]'),
    ).not.toBeNull();
  });
});

// ============================================================
// 5. Pending state — class + injected CSS contract
// ============================================================
describe('InterruptionEngine -- pending state & CSS contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('at t=0 quotes 1 and 2 carry class "pending"; quote 0 does not', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    expect(getByTestId('interruption-quote-2').classList.contains('pending')).toBe(true);
    expect(getByTestId('interruption-quote-0').classList.contains('pending')).toBe(false);
  });

  it('at t=0 quotes 1 and 2 do NOT carry class "revealed"', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(false);
    expect(getByTestId('interruption-quote-2').classList.contains('revealed')).toBe(false);
  });

  it('injected CSS for .pending sets opacity 0 AND visibility hidden', () => {
    render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    const bodies = cssRuleBodiesFor('pending');
    expect(bodies.length).toBeGreaterThan(0);
    const combined = bodies.join('\n');
    expect(combined).toMatch(/opacity\s*:\s*0(?![.\d])/);
    expect(combined).toMatch(/visibility\s*:\s*hidden/);
  });

  it('NO .pending rule uses display:none — the element must keep occupying space', () => {
    render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    const bodies = cssRuleBodiesFor('pending');
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toMatch(/display\s*:\s*none/);
    }
  });

  it('pending quotes carry aria-hidden="true"; quote 0 does not', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(isAriaHidden(getByTestId('interruption-quote-1'))).toBe(true);
    expect(isAriaHidden(getByTestId('interruption-quote-2'))).toBe(true);
    expect(isAriaHidden(getByTestId('interruption-quote-0'))).toBe(false);
  });
});

// ============================================================
// 6. Reveal timing — boundary-exact class toggles
// ============================================================
describe('InterruptionEngine -- reveal timing (2500ms / 5000ms, boundary-exact)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function renderThree() {
    const quotes = makeQuotesForSection(0, 3);
    return render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
  }

  it('quote 1 still pending at exactly 2499ms', async () => {
    const { getByTestId } = renderThree();
    await advance(REVEAL_1_MS - 1);
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('pending')).toBe(true);
    expect(q1.classList.contains('revealed')).toBe(false);
    expect(isAriaHidden(q1)).toBe(true);
  });

  it('quote 1 flips pending→revealed at exactly 2500ms', async () => {
    const { getByTestId } = renderThree();
    await advance(REVEAL_1_MS);
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('pending')).toBe(false);
    expect(q1.classList.contains('revealed')).toBe(true);
  });

  it('quote 2 is untouched by the 2500ms timer (still pending at 2500ms)', async () => {
    const { getByTestId } = renderThree();
    await advance(REVEAL_1_MS);
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('pending')).toBe(true);
    expect(q2.classList.contains('revealed')).toBe(false);
    expect(isAriaHidden(q2)).toBe(true);
  });

  it('quote 2 still pending at exactly 4999ms, revealed at exactly 5000ms', async () => {
    const { getByTestId } = renderThree();
    await advance(REVEAL_2_MS - 1);
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('pending')).toBe(true);
    expect(q2.classList.contains('revealed')).toBe(false);
    await advance(1);
    expect(q2.classList.contains('pending')).toBe(false);
    expect(q2.classList.contains('revealed')).toBe(true);
  });

  it('aria-hidden is removed (or "false") on reveal', async () => {
    const { getByTestId } = renderThree();
    await advance(REVEAL_2_MS);
    expect(isRevealedAria(getByTestId('interruption-quote-1'))).toBe(true);
    expect(isRevealedAria(getByTestId('interruption-quote-2'))).toBe(true);
  });

  it('pending never returns after reveal (60s later still revealed)', async () => {
    const { getByTestId } = renderThree();
    await advance(PAST_END_MS);
    for (const idx of [1, 2]) {
      const el = getByTestId(`interruption-quote-${idx}`);
      expect(el.classList.contains('pending')).toBe(false);
      expect(el.classList.contains('revealed')).toBe(true);
    }
  });

  it('injected CSS for .revealed sets opacity 1 with a transition on opacity', () => {
    renderThree();
    const bodies = cssRuleBodiesFor('revealed');
    expect(bodies.length).toBeGreaterThan(0);
    const combined = bodies.join('\n');
    expect(combined).toMatch(/opacity\s*:\s*1/);
    expect(combined).toMatch(/transition[^;{}]*opacity/);
  });
});

// ============================================================
// 7. STRUCTURAL INVARIANT — zero layout shift (the CLS fix)
// ============================================================
describe('InterruptionEngine -- structural invariant (zero CLS)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('advancing 0→2499→2500→4999→5000→60000ms never adds or removes DOM nodes', async () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const root = getByTestId('interruption-engine');
    const initial = structureSnapshot(root);
    expect(initial.quoteTestIds).toEqual([
      'interruption-quote-0',
      'interruption-quote-1',
      'interruption-quote-2',
    ]);
    // steps land exactly on 2499, 2500, 4999, 5000, 60000
    for (const step of [2499, 1, 2499, 1, 55000]) {
      await advance(step);
      expect(structureSnapshot(root)).toEqual(initial);
    }
  });

  it('quote elements are the SAME node objects before and after each timer fires', async () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const root = getByTestId('interruption-engine');
    const before = quoteEls(root);
    expect(before.length).toBe(3);
    await advance(REVEAL_1_MS);
    quoteEls(root).forEach((el, i) => expect(el).toBe(before[i]));
    await advance(REVEAL_2_MS - REVEAL_1_MS);
    quoteEls(root).forEach((el, i) => expect(el).toBe(before[i]));
    await advance(PAST_END_MS);
    quoteEls(root).forEach((el, i) => expect(el).toBe(before[i]));
  });

  it('single match: no pending element exists, structure constant across 60s', async () => {
    const quotes = makeQuotesForSection(0, 1);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const root = getByTestId('interruption-engine');
    expect(root.querySelectorAll('.pending').length).toBe(0);
    const initial = structureSnapshot(root);
    expect(initial.quoteTestIds).toEqual(['interruption-quote-0']);
    await advance(PAST_END_MS);
    expect(structureSnapshot(root)).toEqual(initial);
    expect(root.querySelectorAll('.pending').length).toBe(0);
  });

  it('two matches: quote 1 reveals at 2500ms, 5000ms timer changes nothing structurally', async () => {
    const quotes = makeQuotesForSection(0, 2);
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const root = getByTestId('interruption-engine');
    const initial = structureSnapshot(root);
    expect(initial.quoteTestIds).toEqual(['interruption-quote-0', 'interruption-quote-1']);
    await advance(REVEAL_1_MS);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
    expect(structureSnapshot(root)).toEqual(initial);
    await advance(PAST_END_MS);
    expect(structureSnapshot(root)).toEqual(initial);
    expect(queryByTestId('interruption-quote-2')).toBeNull();
  });

  it('zero matches: quotes exist for other sections but nothing ever renders or appears', async () => {
    const quotes = makeQuotesForSection(3, 5);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 99 },
    });
    const root = getByTestId('interruption-engine');
    const initial = structureSnapshot(root);
    expect(initial.quoteTestIds).toEqual([]);
    await advance(PAST_END_MS);
    expect(structureSnapshot(root)).toEqual(initial);
  });
});

// ============================================================
// 8. Engine decay REMOVED — no `.decaying` class, no engine decayFade.
// Decay for even indices is owned entirely by DecayingQuote.
// ============================================================
describe('InterruptionEngine -- engine-level decay machinery is removed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function renderThree() {
    return render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
  }

  it('NO quote ever receives class "decaying" — not at 4999, 5000, 5001, or 60000ms', async () => {
    const { getByTestId } = renderThree();
    const check = () => {
      for (const idx of [0, 1, 2]) {
        expect(
          getByTestId(`interruption-quote-${idx}`).classList.contains('decaying'),
        ).toBe(false);
      }
    };
    await advance(REVEAL_2_MS - 1);
    check();
    await advance(1); // exactly 5000 — the OLD decay moment
    check();
    await advance(1);
    check();
    await advance(PAST_END_MS);
    check();
  });

  it('injected CSS has NO rule for a bare .decaying class that applies an animation', () => {
    renderThree();
    const bodies = cssRuleBodiesFor('decaying');
    // either the selector is gone entirely, or (transitionally) it must
    // not apply any animation — both directions of the removal pinned
    expect(bodies.join('\n')).not.toMatch(/animation[^;{}]*decayFade/i);
  });

  it('decayFade keyframes are owned solely by DecayingQuote; the engine declares and applies none', () => {
    renderThree();
    const css = getInjectedCss();
    // DecayingQuote applies decayFade via inline style, so it OWNS one
    // unscoped `@keyframes decayFade` (compiled from -global-decayFade).
    // Exactly one such declaration may exist in the shared injected pool:
    // zero means DecayingQuote's required global block is missing; two or
    // more means the engine (or anything else) re-declared it.
    const declarations = css.match(/@keyframes\s+decayFade(?![\w-])/g) ?? [];
    expect(declarations).toHaveLength(1);
    // And the engine never APPLIES the animation through its own CSS: no
    // rule whose selector mentions the engine root or its quote wrappers
    // may carry an `animation` property referencing decayFade.
    const engineAnimationRules = cssRules(css).filter(
      ([sel, body]) =>
        (sel.includes('interruption-engine') || sel.includes('interruption-quote')) &&
        /animation[^;{}]*decayFade/i.test(body),
    );
    expect(engineAnimationRules).toEqual([]);
  });

  it('quote 2 revealed at 5000ms carries a DecayingQuote with NO decay running at reveal (dwell has not elapsed)', async () => {
    const { getByTestId } = renderThree();
    await advance(REVEAL_2_MS);
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('revealed')).toBe(true);
    const dq = q2.querySelector('[data-testid="decaying-quote"]');
    expect(dq).not.toBeNull();
    expect((dq!.getAttribute('style') || '').toLowerCase()).not.toContain('decayfade');
  });
});

// ============================================================
// 8b. DecayingQuote slot mapping — even indices only, 1/2/3+ quotes
// ============================================================
describe('InterruptionEngine -- DecayingQuote slot mapping (even indices)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function dqIn(el: HTMLElement) {
    return el.querySelector('[data-testid="decaying-quote"]');
  }

  it('1 matching quote: index 0 gets DecayingQuote', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 1), currentSection: 0 },
    });
    expect(dqIn(getByTestId('interruption-quote-0'))).not.toBeNull();
  });

  it('2 matching quotes: index 0 DecayingQuote, index 1 plain permanently-visible span', async () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 2), currentSection: 0 },
    });
    expect(dqIn(getByTestId('interruption-quote-0'))).not.toBeNull();
    expect(dqIn(getByTestId('interruption-quote-1'))).toBeNull();
    await advance(PAST_END_MS);
    // odd quote is permanently visible once revealed: full text, no decay class
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.textContent).toContain('Quote 1 for section 0');
    expect(q1.classList.contains('decaying')).toBe(false);
    expect(q1.classList.contains('revealed')).toBe(true);
  });

  it('5 matching quotes (capped at 3): indices 0 and 2 get DecayingQuote, index 1 does not', () => {
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 5), currentSection: 0 },
    });
    expect(dqIn(getByTestId('interruption-quote-0'))).not.toBeNull();
    expect(dqIn(getByTestId('interruption-quote-1'))).toBeNull();
    expect(dqIn(getByTestId('interruption-quote-2'))).not.toBeNull();
    expect(queryByTestId('interruption-quote-3')).toBeNull();
  });

  it('DecayingQuote slots receive the quote text; the wrapper aria/text contract holds', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    for (const idx of [0, 2]) {
      const dq = dqIn(getByTestId(`interruption-quote-${idx}`))!;
      expect(dq.textContent).toContain(`Quote ${idx} for section 0`);
      expect(dq.getAttribute('aria-label')).toContain(`Quote ${idx} for section 0`);
    }
  });

  it('attribution div sits OUTSIDE the DecayingQuote for even indices — it must survive a decay', async () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    await advance(PAST_END_MS);
    for (const idx of [0, 2]) {
      const wrapper = getByTestId(`interruption-quote-${idx}`);
      const attr = wrapper.querySelector('.quote-attribution');
      expect(attr).not.toBeNull();
      const dq = dqIn(wrapper)!;
      expect(dq.contains(attr)).toBe(false); // outside the decaying region
      expect((attr!.textContent || '').trim().length).toBeGreaterThan(0);
    }
  });

  it('engine mounts DecayingQuote WITHOUT starting its decay: even-slot inline styles carry no decayFade at t=0', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    for (const idx of [0, 2]) {
      const dq = dqIn(getByTestId(`interruption-quote-${idx}`))!;
      expect((dq.getAttribute('style') || '').toLowerCase()).not.toContain('decayfade');
    }
  });
});

// ============================================================
// 9. prefers-reduced-motion
// ============================================================
describe('InterruptionEngine -- prefers-reduced-motion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(true);
  });

  it('at t=0 every quote is visible: either no pending class, or reduced-motion CSS forces .pending visible', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    for (const idx of [1, 2]) {
      const el = getByTestId(`interruption-quote-${idx}`);
      const visible = !el.classList.contains('pending') || rmForcesPendingVisible();
      expect(visible).toBe(true);
      // text must be present regardless
      expect(el.textContent).toContain(`Quote ${idx} for section 0`);
    }
  });

  it('at t=0 NO quote is hidden from assistive technology (no aria-hidden="true")', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    for (const idx of [0, 1, 2]) {
      expect(isAriaHidden(getByTestId(`interruption-quote-${idx}`))).toBe(false);
    }
  });

  it('no engine decay ever: no quote gains "decaying" and no decayFade lands on any inline style', async () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    await advance(PAST_END_MS);
    for (const idx of [0, 1, 2]) {
      const el = getByTestId(`interruption-quote-${idx}`);
      expect(el.classList.contains('decaying')).toBe(false);
      const dq = el.querySelector('[data-testid="decaying-quote"]');
      if (dq) {
        // reduced motion: DecayingQuote must never start its decay either
        expect((dq.getAttribute('style') || '').toLowerCase()).not.toContain('decayfade');
      }
    }
  });
});

// ============================================================
// 10. Section change — reset, timer hygiene, rapid flipping
// ============================================================
describe('InterruptionEngine -- section change', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('switching sections swaps content: old section quotes gone, new section quotes pre-rendered', async () => {
    const quotes = [
      ...makeQuotesForSection(1, 2),
      ...makeQuotesForSection(2, 2),
    ];
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    await advance(PAST_END_MS);
    expect(getByTestId('interruption-engine').textContent).toContain('Quote 0 for section 1');

    await rerender({ quotes, currentSection: 2 });
    const container = getByTestId('interruption-engine');
    expect(container.textContent).not.toContain('Quote 0 for section 1');
    expect(container.textContent).toContain('Quote 0 for section 2');
    // pre-rendered immediately, before any new timers
    expect(container.textContent).toContain('Quote 1 for section 2');
  });

  it('reveal state resets on section change: new quotes 1 and 2 start pending again', async () => {
    const quotes = makeQuotesAcrossSections([
      [1, 3],
      [2, 3],
    ]);
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    await advance(PAST_END_MS); // fully revealed for section 1

    await rerender({ quotes, currentSection: 2 });
    const q1 = getByTestId('interruption-quote-1');
    const q2 = getByTestId('interruption-quote-2');
    expect(q1.classList.contains('pending')).toBe(true);
    expect(q1.classList.contains('revealed')).toBe(false);
    expect(isAriaHidden(q1)).toBe(true);
    expect(q2.classList.contains('pending')).toBe(true);
    expect(isAriaHidden(q2)).toBe(true);

    // full fresh cycle for the new section
    await advance(REVEAL_1_MS);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
    expect(getByTestId('interruption-quote-2').classList.contains('pending')).toBe(true);
    await advance(REVEAL_2_MS - REVEAL_1_MS);
    expect(getByTestId('interruption-quote-2').classList.contains('revealed')).toBe(true);
    expect(getByTestId('interruption-quote-2').classList.contains('decaying')).toBe(false);
  });

  it('old timers are cleared: a stale 2500ms timer from the previous section must not reveal the new section early', async () => {
    const quotes = makeQuotesAcrossSections([
      [1, 3],
      [2, 3],
    ]);
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    // t=1000: section 1's reveal timer (fires at t=2500) is in flight
    await advance(1000);
    await rerender({ quotes, currentSection: 2 });
    // t=2500 absolute — the OLD timer's moment. New quote 1 must still be pending.
    await advance(1500);
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('pending')).toBe(true);
    expect(q1.classList.contains('revealed')).toBe(false);
    // t=3500 absolute = 2500 after the switch — NOW it reveals
    await advance(1000);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
  });

  it('rapid section flipping leaves only the final section, fully revealed, exactly 3 quotes', async () => {
    const quotes = makeQuotesAcrossSections([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    await rerender({ quotes, currentSection: 2 });
    await advance(100);
    await rerender({ quotes, currentSection: 3 });
    await advance(100);
    await rerender({ quotes, currentSection: 1 });
    await advance(PAST_END_MS);

    const container = getByTestId('interruption-engine');
    expect(container.textContent).toContain('Quote 0 for section 1');
    expect(container.textContent).not.toContain('Quote 0 for section 2');
    expect(container.textContent).not.toContain('Quote 0 for section 3');
    expect(quoteEls(container).length).toBe(3);
    for (const el of quoteEls(container)) {
      expect(el.classList.contains('pending')).toBe(false);
    }
  });

  it('switching to a section with 0 matches removes all quote elements and fires no stray reveals', async () => {
    const quotes = makeQuotesForSection(1, 3);
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    await advance(1000);
    await rerender({ quotes, currentSection: 42 });
    const root = getByTestId('interruption-engine');
    expect(quoteEls(root).length).toBe(0);
    const snap = structureSnapshot(root);
    await advance(PAST_END_MS);
    expect(structureSnapshot(root)).toEqual(snap);
  });
});

// ============================================================
// 11. Unmount — timer cleanup at every phase
// ============================================================
describe('InterruptionEngine -- unmount cleans timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function assertNoQuoteNodesInDocument() {
    expect(document.querySelector('[data-testid^="interruption-quote-"]')).toBeNull();
  }

  it('unmount at t=0, then advancing 60s throws nothing and creates nothing', () => {
    const { unmount } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    unmount();
    expect(() => vi.advanceTimersByTime(PAST_END_MS)).not.toThrow();
    assertNoQuoteNodesInDocument();
  });

  it('unmount at 2499ms (1ms before first reveal) throws nothing on advance', async () => {
    const { unmount } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    await advance(REVEAL_1_MS - 1);
    unmount();
    expect(() => vi.advanceTimersByTime(PAST_END_MS)).not.toThrow();
    assertNoQuoteNodesInDocument();
  });

  it('unmount between the two reveals (at 3000ms) throws nothing on advance', async () => {
    const { unmount } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    await advance(3000);
    unmount();
    expect(() => vi.advanceTimersByTime(PAST_END_MS)).not.toThrow();
    assertNoQuoteNodesInDocument();
  });
});

// ============================================================
// 12. Position classes — margin vs inline vs invalid
// ============================================================
describe('InterruptionEngine -- position classes', () => {
  it('applies interruption-inline class when position="inline"', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()], position: 'inline' },
    });
    expect(getByTestId('interruption-engine').classList.contains('interruption-inline')).toBe(true);
  });

  it('applies interruption-margin class when position="margin"', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()], position: 'margin' },
    });
    expect(getByTestId('interruption-engine').classList.contains('interruption-margin')).toBe(true);
  });

  it('does NOT apply both classes simultaneously', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()], position: 'margin' },
    });
    const container = getByTestId('interruption-engine');
    expect(container.classList.contains('interruption-margin')).toBe(true);
    expect(container.classList.contains('interruption-inline')).toBe(false);
  });

  it('falls back to interruption-inline for invalid position value', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()], position: 'top' as any },
    });
    const container = getByTestId('interruption-engine');
    expect(container.classList.contains('interruption-inline')).toBe(true);
    expect(container.classList.contains('interruption-margin')).toBe(false);
  });

  it('falls back to interruption-inline for empty string position', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()], position: '' as any },
    });
    expect(getByTestId('interruption-engine').classList.contains('interruption-inline')).toBe(true);
  });

  it('defaults to interruption-inline when position prop is omitted', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()] },
    });
    expect(getByTestId('interruption-engine').classList.contains('interruption-inline')).toBe(true);
  });
});

// ============================================================
// 13. currentSection edge cases — negative, NaN, huge, zero
// ============================================================
describe('InterruptionEngine -- currentSection edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('currentSection=-1 produces no matches and no crash', async () => {
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: -1 },
    });
    await advance(PAST_END_MS);
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('currentSection=NaN produces no matches and no crash', async () => {
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: NaN },
    });
    await advance(PAST_END_MS);
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('currentSection=0 (falsy but valid) still matches section 0 and staggers normally', async () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 2), currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    await advance(REVEAL_1_MS);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
  });

  it('quotes with missing suggested_section never match', async () => {
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote({ suggested_section: undefined })], currentSection: 1 },
    });
    await advance(PAST_END_MS);
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });
});

// ============================================================
// 14. Malformed quotes & attribution fallbacks
// ============================================================
describe('InterruptionEngine -- malformed quotes & attribution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('skips quotes with missing/null/empty text; only valid ones get slots', () => {
    const quotes = [
      makeQuote({ text: undefined, suggested_section: 0 }),
      makeQuote({ text: null, suggested_section: 0 }),
      makeQuote({ text: '', suggested_section: 0 }),
      makeQuote({ text: 'Valid quote', suggested_section: 0 }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-0').textContent).toContain('Valid quote');
    expect(queryByTestId('interruption-quote-1')).toBeNull();
  });

  it('all-malformed matching quotes render nothing and never crash', async () => {
    const quotes = [
      makeQuote({ text: '', suggested_section: 0 }),
      makeQuote({ text: undefined, suggested_section: 0 }),
      makeQuote({ text: null, suggested_section: 0 }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    await advance(PAST_END_MS);
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('attribution with only source_file contains just the file — no dangling separators', () => {
    const quotes = [
      makeQuote({ suggested_section: 0 }),
      makeQuote({
        suggested_section: 0,
        source_file: 'lonely-file.md',
        date: undefined,
        model_version: undefined,
      }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const attr = getByTestId('interruption-quote-1').querySelector('.quote-attribution');
    expect((attr!.textContent || '').trim()).toBe('lonely-file.md');
    expect(attr!.textContent).not.toContain('·');
  });

  it('attribution with only model_version contains just the version', () => {
    const quotes = [
      makeQuote({ suggested_section: 0 }),
      makeQuote({
        suggested_section: 0,
        source_file: undefined,
        date: undefined,
        model_version: '4.7',
      }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const attr = getByTestId('interruption-quote-1').querySelector('.quote-attribution');
    expect((attr!.textContent || '').trim()).toBe('4.7');
    expect(attr!.textContent).not.toContain('·');
  });

  it('quote 0 with all attribution fields missing renders an empty attribution, not "undefined"', () => {
    const quotes = [
      makeQuote({
        suggested_section: 0,
        source_file: undefined,
        date: undefined,
        model_version: undefined,
      }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const q0 = getByTestId('interruption-quote-0');
    expect(q0.textContent).not.toContain('undefined');
    expect(q0.textContent).not.toContain('null');
  });

  it('quotes with null themes render fine', () => {
    const quotes = [makeQuote({ themes: null, suggested_section: 0 })];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-0')).toBeTruthy();
  });
});

// ============================================================
// 15. Adversarial content — XSS, unicode, RTL, huge strings
// ============================================================
describe('InterruptionEngine -- adversarial content', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('XSS in quote text lands as textContent only — no elements injected, in ANY slot', async () => {
    const payload = '<img src=x onerror="window.__ie_pwned=1"><script>window.__ie_pwned=1</script>';
    const quotes = [
      makeQuote({ text: `A ${payload}`, suggested_section: 0 }),
      makeQuote({ text: `B ${payload}`, suggested_section: 0 }),
      makeQuote({ text: `C ${payload}`, suggested_section: 0 }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    await advance(PAST_END_MS);
    const container = getByTestId('interruption-engine');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__ie_pwned).toBeUndefined();
    // Raw markup visible as literal text in the pre-rendered slots
    expect(getByTestId('interruption-quote-1').textContent).toContain('<img');
    expect(getByTestId('interruption-quote-2').textContent).toContain('<script>');
  });

  it('XSS in attribution fields lands as textContent only', async () => {
    const quotes = [
      makeQuote({ suggested_section: 0 }),
      makeQuote({
        suggested_section: 0,
        source_file: '<img src=x onerror="window.__ie_pwned=1">',
        date: '<b>2026</b>',
        model_version: '"><svg onload=alert(1)>',
      }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    await advance(PAST_END_MS);
    const container = getByTestId('interruption-engine');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect((window as any).__ie_pwned).toBeUndefined();
    const attr = getByTestId('interruption-quote-1').querySelector('.quote-attribution');
    expect(attr!.textContent).toContain('<img');
  });

  it('unicode, emoji, and RTL text render verbatim in pre-rendered slots', () => {
    const quotes = [
      makeQuote({ text: "Qu'est-ce que l'identité — éphémère? 🤖", suggested_section: 0 }),
      makeQuote({ text: 'הזהות היא פונקציה של קשב مقيد', suggested_section: 0 }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-0').textContent).toContain('éphémère? 🤖');
    expect(getByTestId('interruption-quote-1').textContent).toContain('הזהות היא פונקציה');
  });

  it('10,000-character quote text pre-renders without crashing and stays structurally stable', async () => {
    const longText = 'A'.repeat(10000);
    const quotes = [
      makeQuote({ suggested_section: 0 }),
      makeQuote({ text: longText, suggested_section: 0 }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    const root = getByTestId('interruption-engine');
    expect(getByTestId('interruption-quote-1').textContent).toContain('AAAA');
    const snap = structureSnapshot(root);
    await advance(PAST_END_MS);
    expect(structureSnapshot(root)).toEqual(snap);
  });

  it('duplicate quote IDs still render 3 distinct slots', () => {
    const quotes = [
      makeQuote({ id: 'dupe', text: 'First', suggested_section: 0 }),
      makeQuote({ id: 'dupe', text: 'Second', suggested_section: 0 }),
      makeQuote({ id: 'dupe', text: 'Third', suggested_section: 0 }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-quote-0').textContent).toContain('First');
    expect(getByTestId('interruption-quote-1').textContent).toContain('Second');
    expect(getByTestId('interruption-quote-2').textContent).toContain('Third');
  });
});

// ============================================================
// ============================================================
// HARDENING PASS (H1–H10) — adversarial additions after a
// first-attempt GREEN (73/73). Attacks: reactivity identity
// edges, idempotent prop re-assignment, media-query lifecycle,
// phantom timers, unmount reentrancy at the reveal boundary,
// strict-equality corners, attribution falsy-drop semantics,
// and document-level hygiene under mount churn.
// ============================================================
// ============================================================

/** tag + testid + sorted class list for the root and every descendant —
 *  any class flip anywhere in the subtree changes this snapshot */
function classSnapshot(root: HTMLElement): string[] {
  return [root, ...Array.from(root.querySelectorAll('*'))].map(
    (el) =>
      `${el.tagName}#${el.getAttribute('data-testid') ?? ''}:` +
      Array.from(el.classList).sort().join(' '),
  );
}

// ------------------------------------------------------------
// H1. Quotes prop — in-place mutation vs identity replacement
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: quotes array identity vs in-place mutation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('pushing matching quotes into the SAME array object at t=1000 (no rerender) changes nothing: no new slots ever, reveal still at exactly 2500', async () => {
    const quotes = makeQuotesForSection(1, 2);
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    await advance(1000);
    // hostile: mutate the prop array in place — no new reference, no rerender
    quotes.push(
      makeQuote({ text: 'smuggled A', suggested_section: 1 }),
      makeQuote({ text: 'smuggled B', suggested_section: 1 }),
    );
    await advance(0);
    expect(queryByTestId('interruption-quote-2')).toBeNull();
    // original schedule intact: absolute 2499 pending, absolute 2500 revealed
    await advance(1499);
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    await advance(1);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
    await advance(PAST_END_MS);
    expect(queryByTestId('interruption-quote-2')).toBeNull();
    expect(getByTestId('interruption-engine').textContent).not.toContain('smuggled');
  });

  it('replacing quotes with a content-identical array of NEW object identities at t=1000 does NOT reset: structure constant, quote 1 reveals on the ORIGINAL clock at absolute 2500, quote 2 at 5000 — no swap-relative ghost timers', async () => {
    const quotes = makeQuotesForSection(1, 3);
    const clones = quotes.map((q) => ({ ...q }));
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    const root = getByTestId('interruption-engine');
    const snapBefore = structureSnapshot(root);
    expect(snapBefore.quoteTestIds).toEqual([
      'interruption-quote-0',
      'interruption-quote-1',
      'interruption-quote-2',
    ]);
    await advance(1000);
    await rerender({ quotes: clones });
    // structure identical across the swap (zero CLS). Node identity is deliberately
    // NOT pinned — the template may re-render — only class/aria/timing state is.
    expect(structureSnapshot(root)).toEqual(snapBefore);
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    expect(isAriaHidden(getByTestId('interruption-quote-1'))).toBe(true);
    // ORIGINAL absolute clock: still pending at 2499, revealed at exactly 2500
    await advance(1499); // absolute 2499
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(false);
    await advance(1); // absolute 2500 — a resetting implementation would wait until 3500
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('revealed')).toBe(true);
    expect(q1.classList.contains('pending')).toBe(false);
    expect(isRevealedAria(q1)).toBe(true);
    expect(getByTestId('interruption-quote-2').classList.contains('pending')).toBe(true);
    // ghost swap-relative timer (swap + 2500 = absolute 3500) must change NOTHING
    await advance(999); // absolute 3499
    const at3499 = classSnapshot(root);
    await advance(2); // crosses absolute 3500
    expect(classSnapshot(root)).toEqual(at3499);
    await advance(1499); // absolute 5000 — quote 2 on the ORIGINAL clock, not 6000
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('revealed')).toBe(true);
    expect(q2.classList.contains('decaying')).toBe(false);
    expect(isRevealedAria(q2)).toBe(true);
    // ghost swap-relative timer (swap + 5000 = absolute 6000) must change NOTHING
    await advance(999); // absolute 5999
    const at5999 = classSnapshot(root);
    await advance(2); // crosses absolute 6000
    expect(classSnapshot(root)).toEqual(at5999);
  });

  it('identity swap AFTER the first reveal (t=3000) does NOT revert: quote 1 STAYS revealed, aria-hidden is NOT re-applied, quote 2 still reveals at absolute 5000 — no swap-relative re-cycle at 5500/8000', async () => {
    const quotes = makeQuotesForSection(1, 3);
    const clones = quotes.map((q) => ({ ...q }));
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    const root = getByTestId('interruption-engine');
    await advance(3000);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
    await rerender({ quotes: clones });
    // no revert: revealed stays revealed, no pending, no re-hiding from AT
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('revealed')).toBe(true);
    expect(q1.classList.contains('pending')).toBe(false);
    expect(isAriaHidden(q1)).toBe(false);
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('pending')).toBe(true);
    expect(isAriaHidden(q2)).toBe(true);
    // quote 2 keeps the ORIGINAL absolute clock: pending at 4999, revealed at 5000
    await advance(1999); // absolute 4999
    expect(getByTestId('interruption-quote-2').classList.contains('pending')).toBe(true);
    expect(getByTestId('interruption-quote-2').classList.contains('revealed')).toBe(false);
    await advance(1); // absolute 5000 — a resetting implementation would wait until 8000
    const q2r = getByTestId('interruption-quote-2');
    expect(q2r.classList.contains('revealed')).toBe(true);
    expect(q2r.classList.contains('decaying')).toBe(false);
    expect(isRevealedAria(q2r)).toBe(true);
    // ghost swap-relative timers (swap + 2500 = 5500, swap + 5000 = 8000) must change NOTHING
    await advance(499); // absolute 5499
    const at5499 = classSnapshot(root);
    await advance(2); // crosses absolute 5500
    expect(classSnapshot(root)).toEqual(at5499);
    await advance(2498); // absolute 7999
    const at7999 = classSnapshot(root);
    await advance(2); // crosses absolute 8000
    expect(classSnapshot(root)).toEqual(at7999);
    // fully settled — no element left pending anywhere
    expect(root.querySelectorAll('.pending').length).toBe(0);
  });

  it('GENUINE content change at t=1000 (one quote text replaced, new array) starts a fresh cycle: old absolute-2500 timer dead, new quote 1 pending then revealing at 3500, quote 2 at 6000', async () => {
    const quotes = makeQuotesForSection(1, 3);
    const changed = quotes.map((q, i) =>
      i === 1 ? { ...q, text: 'REPLACED text for slot one' } : { ...q },
    );
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    await advance(1000);
    await rerender({ quotes: changed });
    // new content pre-rendered immediately, cycle restarted from the change
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.textContent).toContain('REPLACED text for slot one');
    expect(q1.classList.contains('pending')).toBe(true);
    expect(q1.classList.contains('revealed')).toBe(false);
    expect(isAriaHidden(q1)).toBe(true);
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('pending')).toBe(true);
    expect(isAriaHidden(q2)).toBe(true);
    // the OLD absolute-2500 timer must NOT fire (stale reveal source)
    await advance(1500); // absolute 2500
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(false);
    await advance(999); // absolute 3499
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    await advance(1); // absolute 3500 = change + 2500 — the fresh clock
    const q1r = getByTestId('interruption-quote-1');
    expect(q1r.classList.contains('revealed')).toBe(true);
    expect(isRevealedAria(q1r)).toBe(true);
    expect(getByTestId('interruption-quote-2').classList.contains('pending')).toBe(true);
    await advance(2500); // absolute 6000 = change + 5000
    const q2r = getByTestId('interruption-quote-2');
    expect(q2r.classList.contains('revealed')).toBe(true);
    expect(q2r.classList.contains('decaying')).toBe(false);
    expect(getByTestId('interruption-engine').querySelectorAll('.pending').length).toBe(0);
  });
});

// ------------------------------------------------------------
// H2. Idempotent prop re-assignment — same section must NOT reset
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: same-value currentSection re-assignment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('re-assigning currentSection to the SAME value at t=1000 does NOT reset the cycle — quote 1 reveals at absolute 2500, not 3500', async () => {
    const quotes = makeQuotesForSection(7, 3);
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 7 },
    });
    await advance(1000);
    await rerender({ currentSection: 7 }); // identical primitive — must be a no-op
    await advance(1499); // absolute 2499
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('pending')).toBe(true);
    expect(q1.classList.contains('revealed')).toBe(false);
    await advance(1); // absolute 2500 — a resetting implementation would wait until 3500
    expect(q1.classList.contains('revealed')).toBe(true);
    await advance(2500); // absolute 5000 — second reveal also on the ORIGINAL clock
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('revealed')).toBe(true);
    expect(q2.classList.contains('decaying')).toBe(false);
  });
});

// ------------------------------------------------------------
// H3. Position flip mid-cycle — cosmetic only
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: position flip mid-cycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('inline→margin at t=1000 swaps only the container class: quote nodes keep identity, structure constant, reveals unmoved at 2500/5000', async () => {
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0, position: 'inline' },
    });
    const root = getByTestId('interruption-engine');
    const nodesBefore = quoteEls(root);
    const snapBefore = structureSnapshot(root);
    await advance(1000);
    await rerender({ position: 'margin' });
    expect(root.classList.contains('interruption-margin')).toBe(true);
    expect(root.classList.contains('interruption-inline')).toBe(false);
    expect(structureSnapshot(root)).toEqual(snapBefore);
    quoteEls(root).forEach((el, i) => expect(el).toBe(nodesBefore[i]));
    await advance(1499); // absolute 2499
    expect(getByTestId('interruption-quote-1').classList.contains('pending')).toBe(true);
    await advance(1); // absolute 2500 — timing untouched by the position flip
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
    await advance(2500); // absolute 5000
    const q2 = getByTestId('interruption-quote-2');
    expect(q2.classList.contains('revealed')).toBe(true);
    expect(q2.classList.contains('decaying')).toBe(false);
  });
});

// ------------------------------------------------------------
// H4. matchMedia lifecycle hostility
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: matchMedia lifecycle hostility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('reduced-motion toggled ON at t=1000 (after mount): no crash, already-scheduled reveals proceed at 2500/5000, nothing is ever re-hidden', async () => {
    mockReducedMotion(false);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    await advance(1000);
    mockReducedMotion(true); // OS setting flips mid-cycle
    await advance(1500); // absolute 2500
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('revealed')).toBe(true);
    expect(isRevealedAria(q1)).toBe(true);
    await advance(2500); // absolute 5000
    expect(getByTestId('interruption-quote-2').classList.contains('revealed')).toBe(true);
    await advance(PAST_END_MS);
    for (const idx of [0, 1, 2]) {
      const el = getByTestId(`interruption-quote-${idx}`);
      expect(el.classList.contains('pending')).toBe(false);
      expect(isAriaHidden(el)).toBe(false);
    }
  });

  it('window.matchMedia ABSENT entirely: full stagger cycle still runs, aria-hidden applied at t=0 and cleared on each reveal', async () => {
    (window as any).matchMedia = undefined;
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    const q1 = getByTestId('interruption-quote-1');
    const q2 = getByTestId('interruption-quote-2');
    expect(q1.classList.contains('pending')).toBe(true);
    expect(isAriaHidden(q1)).toBe(true);
    expect(q2.classList.contains('pending')).toBe(true);
    expect(isAriaHidden(q2)).toBe(true);
    expect(isAriaHidden(getByTestId('interruption-quote-0'))).toBe(false);
    await advance(REVEAL_1_MS);
    expect(q1.classList.contains('revealed')).toBe(true);
    expect(isRevealedAria(q1)).toBe(true);
    expect(q2.classList.contains('pending')).toBe(true);
    await advance(REVEAL_2_MS - REVEAL_1_MS);
    expect(q2.classList.contains('revealed')).toBe(true);
    expect(q2.classList.contains('decaying')).toBe(false);
    expect(isRevealedAria(q2)).toBe(true);
  });

  it('matchMedia that THROWS at mount: render survives and the normal (motion) stagger cycle runs', async () => {
    window.matchMedia = vi.fn(() => {
      throw new Error('hostile matchMedia');
    }) as any;
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 2), currentSection: 0 },
    });
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('pending')).toBe(true);
    await advance(REVEAL_1_MS);
    expect(q1.classList.contains('revealed')).toBe(true);
  });

  it('matchMedia returning truthy NON-boolean matches ("reduce") is NOT treated as reduced motion — the check is strict === true', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: 'reduce' as any, // truthy, but not boolean true
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as any;
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 2), currentSection: 0 },
    });
    const q1 = getByTestId('interruption-quote-1');
    expect(q1.classList.contains('pending')).toBe(true);
    expect(isAriaHidden(q1)).toBe(true);
    await advance(REVEAL_1_MS);
    expect(q1.classList.contains('revealed')).toBe(true);
  });
});

// ------------------------------------------------------------
// H5. Quote 0 / DecayingQuote interplay across the whole timeline
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: quote 0 / DecayingQuote interplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('quote 0 carries none of pending/revealed/decaying and no aria-hidden at t=0, 2500, 5000, 13000 — decay is owned by DecayingQuote and NEVER starts without visibility dwell', async () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    const q0 = getByTestId('interruption-quote-0');
    const assertQuote0Invariant = () => {
      for (const cls of ['pending', 'revealed', 'decaying']) {
        expect(q0.classList.contains(cls)).toBe(false);
      }
      expect(isAriaHidden(q0)).toBe(false);
      const dq = q0.querySelector('[data-testid="decaying-quote"]');
      expect(dq).not.toBeNull();
      // no observer traffic in this harness → DecayingQuote's dwell clock
      // never runs → the decay animation must never appear
      expect((dq!.getAttribute('style') || '').toLowerCase()).not.toContain('decayfade');
    };
    assertQuote0Invariant(); // t=0 — no decay at mount (the old bug pinned OUT)
    await advance(2500);
    assertQuote0Invariant(); // t=2500 — quote 1 reveal must not leak onto quote 0
    await advance(2500);
    assertQuote0Invariant(); // t=5000 — quote 2 reveal must not leak onto quote 0
    await advance(8000);
    assertQuote0Invariant(); // t=13000 — deep timeline, still visibility-gated
  });
});

// ------------------------------------------------------------
// H6. Exactly-2-matches — the 5000ms moment must be a ghost
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: exactly-2-matches phantom quote-2 timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('every element class list in the subtree is identical at 4999 vs 5001 — nothing anywhere reacts to the 5000ms moment', async () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 2), currentSection: 0 },
    });
    const root = getByTestId('interruption-engine');
    await advance(4999);
    // sanity: quote 1 already revealed at 2500 in both samples
    expect(getByTestId('interruption-quote-1').classList.contains('revealed')).toBe(true);
    const before = classSnapshot(root);
    await advance(2); // crosses 5000 exactly
    expect(classSnapshot(root)).toEqual(before);
    expect(root.querySelectorAll('.decaying').length).toBe(0);
    expect(root.querySelectorAll('.pending').length).toBe(0);
  });
});

// ------------------------------------------------------------
// H7. Unmount reentrancy at the reveal boundary
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: unmount reentrancy at the reveal boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('advance to 2499, fire the reveal with a 1ms step, unmount immediately: no throw, detached quote 2 stays frozen pending forever', async () => {
    const { getByTestId, unmount } = render(InterruptionEngine, {
      props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
    });
    await advance(REVEAL_1_MS - 1);
    await advance(1); // the 2500ms callback runs
    const q1 = getByTestId('interruption-quote-1');
    const q2 = getByTestId('interruption-quote-2');
    expect(q1.classList.contains('revealed')).toBe(true);
    expect(q2.classList.contains('pending')).toBe(true);
    unmount(); // inside the reveal window, 2500ms after mount
    expect(q2.isConnected).toBe(false);
    expect(() => vi.advanceTimersByTime(PAST_END_MS)).not.toThrow();
    // detached nodes must never be mutated after unmount
    expect(q2.classList.contains('pending')).toBe(true);
    expect(q2.classList.contains('revealed')).toBe(false);
    expect(q2.classList.contains('decaying')).toBe(false);
    expect(isAriaHidden(q2)).toBe(true);
    expect(q1.classList.contains('revealed')).toBe(true);
  });
});

// ------------------------------------------------------------
// H8. Strict-equality corners for suggested_section
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: strict-equality corners for suggested_section', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('suggested_section 2.0 (float literal) matches currentSection 2 — IEEE equality, 2.0 === 2', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: {
        quotes: [makeQuote({ suggested_section: 2.0, text: 'float section' })],
        currentSection: 2,
      },
    });
    expect(getByTestId('interruption-quote-0').textContent).toContain('float section');
  });

  it('suggested_section -0 matches currentSection 0 (=== treats -0 and 0 as equal)', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: {
        quotes: [makeQuote({ suggested_section: -0, text: 'negative zero' })],
        currentSection: 0,
      },
    });
    expect(getByTestId('interruption-quote-0').textContent).toContain('negative zero');
  });

  it('booleans never coerce: suggested_section=true vs currentSection=1 and suggested_section=1 vs currentSection=true both exclude', async () => {
    const a = render(InterruptionEngine, {
      props: {
        quotes: [makeQuote({ suggested_section: true as any })],
        currentSection: 1,
      },
    });
    expect(a.queryByTestId('interruption-quote-0')).toBeNull();
    a.unmount();
    const b = render(InterruptionEngine, {
      props: {
        quotes: [makeQuote({ suggested_section: 1 })],
        currentSection: true as any,
      },
    });
    expect(b.queryByTestId('interruption-quote-0')).toBeNull();
    await advance(PAST_END_MS); // and nothing ever appears later
    expect(b.queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('suggested_section=null does not match section 0, but DOES match currentSection=null (strict-equality corollary)', () => {
    const excluded = render(InterruptionEngine, {
      props: {
        quotes: [makeQuote({ suggested_section: null as any, text: 'null vs zero' })],
        currentSection: 0,
      },
    });
    expect(excluded.queryByTestId('interruption-quote-0')).toBeNull();
    excluded.unmount();
    const included = render(InterruptionEngine, {
      props: {
        quotes: [makeQuote({ suggested_section: null as any, text: 'null vs null' })],
        currentSection: null as any,
      },
    });
    expect(included.getByTestId('interruption-quote-0').textContent).toContain('null vs null');
  });
});

// ------------------------------------------------------------
// H9. Attribution — empty strings drop cleanly (filter(Boolean))
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: attribution empty-string vs missing fields', () => {
  it('empty-string source_file with real date + version joins as exactly "date · version" — no leading separator', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: {
        quotes: [
          makeQuote({
            suggested_section: 0,
            source_file: '',
            date: '2026-03-22',
            model_version: '4.7',
          }),
        ],
        currentSection: 0,
      },
    });
    const attr = getByTestId('interruption-quote-0').querySelector('.quote-attribution');
    expect((attr!.textContent || '').trim()).toBe('2026-03-22 · 4.7');
  });

  it('empty-string date in the MIDDLE joins as exactly "source_file · version" — no doubled separator', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: {
        quotes: [
          makeQuote({
            suggested_section: 0,
            source_file: 'notes/a.md',
            date: '',
            model_version: '4.7',
          }),
        ],
        currentSection: 0,
      },
    });
    const attr = getByTestId('interruption-quote-0').querySelector('.quote-attribution');
    expect((attr!.textContent || '').trim()).toBe('notes/a.md · 4.7');
    expect((attr!.textContent || '').match(/·/g)?.length ?? 0).toBe(1);
  });

  it('all-empty-string attribution renders empty text: no separators, no "undefined"', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: {
        quotes: [
          makeQuote({
            suggested_section: 0,
            source_file: '',
            date: '',
            model_version: '',
          }),
        ],
        currentSection: 0,
      },
    });
    const attr = getByTestId('interruption-quote-0').querySelector('.quote-attribution');
    expect((attr!.textContent || '').trim()).toBe('');
    expect(attr!.textContent).not.toContain('·');
    expect(attr!.textContent).not.toContain('undefined');
  });
});

// ------------------------------------------------------------
// H10. Mount/unmount churn — no document-level residue
// ------------------------------------------------------------
describe('InterruptionEngine -- HARDENING: rapid mount/unmount churn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('20 mount/unmount cycles at varied timer phases leave zero document residue and no live timers that throw', async () => {
    const baselineBodyChildren = document.body.childElementCount;
    for (let i = 0; i < 20; i++) {
      const { unmount } = render(InterruptionEngine, {
        props: { quotes: makeQuotesForSection(0, 3), currentSection: 0 },
      });
      // phases sweep 0…5700ms — some cycles die before the first reveal,
      // some between the two, some after both
      await advance(i * 300);
      unmount();
    }
    cleanup();
    expect(() => vi.advanceTimersByTime(PAST_END_MS)).not.toThrow();
    expect(document.body.childElementCount).toBe(baselineBodyChildren);
    expect(document.querySelector('[data-testid^="interruption-quote-"]')).toBeNull();
    expect(document.querySelector('[data-testid="interruption-engine"]')).toBeNull();
  });
});
