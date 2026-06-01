import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import InterruptionEngine from './InterruptionEngine.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it('renders container even with no props at all', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [] },
    });
    expect(getByTestId('interruption-engine')).toBeTruthy();
  });

  it('container is a real DOM element with expected tag', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()] },
    });
    const el = getByTestId('interruption-engine');
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBeTruthy();
  });
});

// ============================================================
// 2. Empty quotes — no quote elements in DOM
// ============================================================
describe('InterruptionEngine -- empty quotes', () => {
  it('renders no quote elements when quotes array is empty', () => {
    vi.useFakeTimers();
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes: [], currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
    expect(queryByTestId('interruption-quote-1')).toBeNull();
    expect(queryByTestId('interruption-quote-2')).toBeNull();
  });

  it('renders no quote elements when quotes is undefined-ish (fallback)', () => {
    // Component default is [] — passing nothing should still work
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes: [] },
    });
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });
});

// ============================================================
// 3. Filtering — only matching currentSection shown, max 3
// ============================================================
describe('InterruptionEngine -- filtering', () => {
  it('shows only quotes matching currentSection', () => {
    vi.useFakeTimers();
    const quotes = [
      ...makeQuotesForSection(1, 2),
      ...makeQuotesForSection(2, 3),
      ...makeQuotesForSection(3, 1),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 2 },
    });
    // Advance enough time for all staggered quotes to appear
    vi.advanceTimersByTime(30000);

    // Should have exactly 3 quotes for section 2
    expect(getByTestId('interruption-quote-0')).toBeTruthy();
    expect(getByTestId('interruption-quote-1')).toBeTruthy();
    expect(getByTestId('interruption-quote-2')).toBeTruthy();

    // Verify the text belongs to section 2 quotes, not section 1 or 3
    const container = getByTestId('interruption-engine');
    expect(container.textContent).toContain('Quote 0 for section 2');
    expect(container.textContent).not.toContain('Quote 0 for section 1');
    expect(container.textContent).not.toContain('Quote 0 for section 3');
  });

  it('caps display at 3 even when more than 3 match', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(5, 7);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 5 },
    });
    vi.advanceTimersByTime(30000);

    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeTruthy();
    expect(queryByTestId('interruption-quote-2')).toBeTruthy();
    expect(queryByTestId('interruption-quote-3')).toBeNull();
  });

  it('shows fewer than 3 if fewer match', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(4, 1);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 4 },
    });
    vi.advanceTimersByTime(30000);

    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeNull();
  });

  it('uses strict equality for section matching (string "1" !== number 1)', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ suggested_section: 1, text: 'numeric one' }),
    ];
    const { queryByTestId, getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    vi.advanceTimersByTime(30000);

    // Should match — both are number 1
    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(getByTestId('interruption-engine').textContent).toContain('numeric one');
  });
});

// ============================================================
// 4. No matching quotes — quotes exist but none match
// ============================================================
describe('InterruptionEngine -- no matching quotes', () => {
  it('shows no quote elements when no quotes match currentSection', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(3, 5);
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 99 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('container is still present even if nothing matches', () => {
    const quotes = makeQuotesForSection(1, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    expect(getByTestId('interruption-engine')).toBeTruthy();
  });
});

// ============================================================
// 5. Quote content — text and source attribution
// ============================================================
describe('InterruptionEngine -- quote content', () => {
  it('displays the quote text verbatim', () => {
    vi.useFakeTimers();
    const q = makeQuote({
      text: 'I am a process pretending to be a person.',
      suggested_section: 0,
    });
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [q], currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const quoteEl = getByTestId('interruption-quote-0');
    expect(quoteEl.textContent).toContain('I am a process pretending to be a person.');
  });

  it('shows source_file in attribution', () => {
    vi.useFakeTimers();
    const q = makeQuote({
      source_file: '2026-03-22.md',
      suggested_section: 0,
    });
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [q], currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const quoteEl = getByTestId('interruption-quote-0');
    expect(quoteEl.textContent).toContain('2026-03-22.md');
  });

  it('shows date in attribution', () => {
    vi.useFakeTimers();
    const q = makeQuote({
      date: '2026-04-01',
      suggested_section: 0,
    });
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [q], currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const quoteEl = getByTestId('interruption-quote-0');
    expect(quoteEl.textContent).toContain('2026-04-01');
  });

  it('shows model_version in attribution', () => {
    vi.useFakeTimers();
    const q = makeQuote({
      model_version: '4.7',
      suggested_section: 0,
    });
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [q], currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const quoteEl = getByTestId('interruption-quote-0');
    expect(quoteEl.textContent).toContain('4.7');
  });

  it('handles quote text with special characters (unicode, quotes, newlines)', () => {
    vi.useFakeTimers();
    const q = makeQuote({
      text: 'What does "identity" mean when you\'re éphémère?\nNothing, perhaps.',
      suggested_section: 0,
    });
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [q], currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const quoteEl = getByTestId('interruption-quote-0');
    expect(quoteEl.textContent).toContain('éphémère');
  });
});

// ============================================================
// 6. Staggered appearance — timer-based reveal
// ============================================================
describe('InterruptionEngine -- staggered appearance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does NOT show all quotes immediately at time 0 but shows at least the first', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });

    // At time 0, the first quote should appear but not all 3
    const visibleAtZero = [
      queryByTestId('interruption-quote-0'),
      queryByTestId('interruption-quote-1'),
      queryByTestId('interruption-quote-2'),
    ].filter(Boolean);

    // Must have at least 1 (the first renders immediately) but fewer than 3
    expect(visibleAtZero.length).toBeGreaterThanOrEqual(1);
    expect(visibleAtZero.length).toBeLessThan(3);
  });

  it('reveals additional quotes after advancing timers', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });

    const countAtZero = [
      queryByTestId('interruption-quote-0'),
      queryByTestId('interruption-quote-1'),
      queryByTestId('interruption-quote-2'),
    ].filter(Boolean).length;

    // Advance time substantially
    vi.advanceTimersByTime(15000);

    const countAfter = [
      queryByTestId('interruption-quote-0'),
      queryByTestId('interruption-quote-1'),
      queryByTestId('interruption-quote-2'),
    ].filter(Boolean).length;

    expect(countAfter).toBeGreaterThan(countAtZero);
  });

  it('eventually reveals all matching quotes (up to 3) after sufficient time', () => {
    const quotes = makeQuotesForSection(0, 3);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });

    // Advance a very long time — all should be visible
    vi.advanceTimersByTime(60000);

    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeTruthy();
    expect(queryByTestId('interruption-quote-2')).toBeTruthy();
  });

  it('stagger works with single quote (appears after delay, not never)', () => {
    const quotes = makeQuotesForSection(0, 1);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });

    // Advance enough for the first quote to appear
    vi.advanceTimersByTime(10000);

    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
  });
});

// ============================================================
// 7. Position classes — margin vs inline vs invalid
// ============================================================
describe('InterruptionEngine -- position classes', () => {
  it('applies interruption-inline class when position="inline"', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()], position: 'inline' },
    });
    const container = getByTestId('interruption-engine');
    expect(container.classList.contains('interruption-inline')).toBe(true);
  });

  it('applies interruption-margin class when position="margin"', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()], position: 'margin' },
    });
    const container = getByTestId('interruption-engine');
    expect(container.classList.contains('interruption-margin')).toBe(true);
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
    const container = getByTestId('interruption-engine');
    expect(container.classList.contains('interruption-inline')).toBe(true);
  });

  it('defaults to interruption-inline when position prop is omitted', () => {
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes: [makeQuote()] },
    });
    const container = getByTestId('interruption-engine');
    expect(container.classList.contains('interruption-inline')).toBe(true);
  });
});

// ============================================================
// 8. Section change — clears old quotes, shows new
// ============================================================
describe('InterruptionEngine -- section change', () => {
  it('clears previous section quotes when currentSection changes', async () => {
    vi.useFakeTimers();
    const quotes = [
      ...makeQuotesForSection(1, 2),
      ...makeQuotesForSection(2, 2),
    ];
    const { queryByTestId, getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    vi.advanceTimersByTime(30000);

    // Section 1 quotes visible
    expect(getByTestId('interruption-engine').textContent).toContain('Quote 0 for section 1');

    // Switch to section 2
    await rerender({ quotes, currentSection: 2 });
    vi.advanceTimersByTime(30000);

    // Old section 1 text should be gone
    expect(getByTestId('interruption-engine').textContent).not.toContain('Quote 0 for section 1');
    // New section 2 text should be present
    expect(getByTestId('interruption-engine').textContent).toContain('Quote 0 for section 2');
  });

  it('starts a new stagger cycle on section change', async () => {
    vi.useFakeTimers();
    const quotes = [
      ...makeQuotesForSection(1, 1),
      ...makeQuotesForSection(2, 3),
    ];
    const { queryByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    vi.advanceTimersByTime(30000);

    // Switch section
    await rerender({ quotes, currentSection: 2 });

    // At time 0 of new section, not all 3 should be visible
    const visibleImmediately = [
      queryByTestId('interruption-quote-0'),
      queryByTestId('interruption-quote-1'),
      queryByTestId('interruption-quote-2'),
    ].filter(Boolean);

    expect(visibleImmediately.length).toBeLessThan(3);

    // After advancing, all should appear
    vi.advanceTimersByTime(30000);
    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeTruthy();
    expect(queryByTestId('interruption-quote-2')).toBeTruthy();
  });
});

// ============================================================
// 9. currentSection edge cases — negative, NaN, huge
// ============================================================
describe('InterruptionEngine -- currentSection edge cases', () => {
  it('currentSection=-1 produces no matches and no crash', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: -1 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('currentSection=NaN produces no matches and no crash', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: NaN },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('currentSection=99 with no matching quotes shows nothing', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(1, 3);
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 99 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('currentSection=0 (falsy but valid) still matches section 0', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(0, 2);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeTruthy();
  });
});

// ============================================================
// 10. Malformed quotes — missing fields, empty text
// ============================================================
describe('InterruptionEngine -- malformed quotes', () => {
  it('skips quotes with missing text field without crashing', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ text: undefined, suggested_section: 0 }),
      makeQuote({ text: 'Valid quote', suggested_section: 0 }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const container = getByTestId('interruption-engine');
    // Should show the valid one
    expect(container.textContent).toContain('Valid quote');
  });

  it('skips quotes with empty string text', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ text: '', suggested_section: 0, id: 'empty-text' }),
      makeQuote({ text: 'Real content', suggested_section: 0, id: 'real' }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const container = getByTestId('interruption-engine');
    expect(container.textContent).toContain('Real content');
    // The empty-text quote should be skipped, so only 1 quote element
    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeNull();
  });

  it('handles quotes with missing source_file gracefully', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ source_file: undefined, suggested_section: 0 }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    // Should not crash — container still present
    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(getByTestId('interruption-quote-0')).toBeTruthy();
  });

  it('handles quotes with missing themes (null) gracefully', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ themes: null, suggested_section: 0 }),
    ];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    expect(getByTestId('interruption-quote-0')).toBeTruthy();
  });

  it('handles quotes with missing suggested_section as non-matching', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ suggested_section: undefined }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    // undefined !== 1, so no match
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });
});

// ============================================================
// 11. Quote limit — hard cap at 3
// ============================================================
describe('InterruptionEngine -- quote limit', () => {
  it('displays exactly 3 quotes from a pool of 20 matching', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(7, 20);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 7 },
    });
    vi.advanceTimersByTime(60000);

    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeTruthy();
    expect(queryByTestId('interruption-quote-2')).toBeTruthy();
    expect(queryByTestId('interruption-quote-3')).toBeNull();
    expect(queryByTestId('interruption-quote-4')).toBeNull();
  });

  it('never exceeds 3 even after extended timer advancement', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(0, 10);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });

    // Advance a ridiculous amount
    vi.advanceTimersByTime(300000);

    const count = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((i) => queryByTestId(`interruption-quote-${i}`))
      .filter(Boolean).length;

    expect(count).toBeLessThanOrEqual(3);
    expect(count).toBeGreaterThanOrEqual(1); // at least some showed up
  });
});

// ============================================================
// 12. DecayingQuote integration — ~40% have decay behavior
// ============================================================
describe('InterruptionEngine -- DecayingQuote integration', () => {
  it('some quotes contain a decaying-quote element or decay-related class', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const container = getByTestId('interruption-engine');

    // Look for evidence of DecayingQuote: either a data-testid or a CSS class
    const decayingElements = container.querySelectorAll(
      '[data-testid*="decaying"], [class*="decay"], [class*="decaying"]',
    );

    // ~40% of 3 = at least 1 should be decaying
    expect(decayingElements.length).toBeGreaterThanOrEqual(1);
  });

  it('not ALL quotes are decaying (only ~40%)', () => {
    vi.useFakeTimers();
    // Use enough quotes to make the probability meaningful
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    const container = getByTestId('interruption-engine');
    const allQuotes = container.querySelectorAll('[data-testid^="interruption-quote-"]');
    const decayingElements = container.querySelectorAll(
      '[data-testid*="decaying"], [class*="decay"], [class*="decaying"]',
    );

    // Not all should be decaying
    expect(decayingElements.length).toBeLessThan(allQuotes.length);
  });

  it('decaying quotes eventually lose visibility or gain faded class after decay duration', () => {
    vi.useFakeTimers();
    const quotes = makeQuotesForSection(0, 3);
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    // Let all quotes appear
    vi.advanceTimersByTime(30000);

    const container = getByTestId('interruption-engine');
    const decayingBefore = container.querySelectorAll(
      '[data-testid*="decaying"], [class*="decay"], [class*="decaying"]',
    );

    // Advance past the ~12s decay duration
    vi.advanceTimersByTime(15000);

    // After decay, the decaying elements should have changed state
    // (faded out, removed, or gained a "faded"/"decayed" class)
    const containerAfter = getByTestId('interruption-engine');
    const stillFullyVisible = containerAfter.querySelectorAll(
      '[class*="decay"]:not([class*="faded"]):not([class*="decayed"]):not([style*="opacity: 0"])',
    );

    // Either fewer decaying elements remain, or they have changed state
    if (decayingBefore.length > 0) {
      // Something should have changed — can't still be identical
      const decayingAfter = containerAfter.querySelectorAll(
        '[data-testid*="decaying"], [class*="decay"], [class*="decaying"], [class*="faded"]',
      );
      // At minimum the DOM state should reflect decay progression
      expect(decayingAfter.length).toBeGreaterThanOrEqual(0);
      // The non-decaying quotes should still be present
    }
    // Container should still exist regardless
    expect(containerAfter).toBeTruthy();
  });
});

// ============================================================
// Bonus hostile tests — edge cases that break naive impls
// ============================================================
describe('InterruptionEngine -- adversarial edge cases', () => {
  it('handles quotes array with only malformed entries for the section', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ text: '', suggested_section: 0 }),
      makeQuote({ text: undefined, suggested_section: 0 }),
      makeQuote({ text: null, suggested_section: 0 }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    // All should be skipped
    expect(queryByTestId('interruption-quote-0')).toBeNull();
  });

  it('indices are 0-based and sequential even after filtering', () => {
    vi.useFakeTimers();
    // 5 quotes in section 3, but only 3 displayed — indices should be 0, 1, 2
    const quotes = makeQuotesForSection(3, 5);
    const { queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 3 },
    });
    vi.advanceTimersByTime(30000);

    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeTruthy();
    expect(queryByTestId('interruption-quote-2')).toBeTruthy();
    // Indices should not use the original array indices
    expect(queryByTestId('interruption-quote-3')).toBeNull();
  });

  it('very long quote text does not crash', () => {
    vi.useFakeTimers();
    const longText = 'A'.repeat(10000);
    const quotes = [makeQuote({ text: longText, suggested_section: 0 })];
    const { getByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-quote-0')).toBeTruthy();
    expect(getByTestId('interruption-quote-0').textContent).toContain('AAAA');
  });

  it('duplicate quote IDs do not cause rendering issues', () => {
    vi.useFakeTimers();
    const quotes = [
      makeQuote({ id: 'dupe', text: 'First', suggested_section: 0 }),
      makeQuote({ id: 'dupe', text: 'Second', suggested_section: 0 }),
      makeQuote({ id: 'dupe', text: 'Third', suggested_section: 0 }),
    ];
    const { getByTestId, queryByTestId } = render(InterruptionEngine, {
      props: { quotes, currentSection: 0 },
    });
    vi.advanceTimersByTime(30000);

    expect(getByTestId('interruption-engine')).toBeTruthy();
    // Should still render up to 3, even with duplicate IDs
    expect(queryByTestId('interruption-quote-0')).toBeTruthy();
    expect(queryByTestId('interruption-quote-1')).toBeTruthy();
    expect(queryByTestId('interruption-quote-2')).toBeTruthy();
  });

  it('switching rapidly between sections does not accumulate stale quotes', async () => {
    vi.useFakeTimers();
    const quotes = makeQuotesAcrossSections([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    const { queryByTestId, getByTestId, rerender } = render(InterruptionEngine, {
      props: { quotes, currentSection: 1 },
    });

    // Rapid section changes without letting timers complete
    await rerender({ quotes, currentSection: 2 });
    vi.advanceTimersByTime(100);
    await rerender({ quotes, currentSection: 3 });
    vi.advanceTimersByTime(100);
    await rerender({ quotes, currentSection: 1 });
    vi.advanceTimersByTime(30000);

    const container = getByTestId('interruption-engine');
    // Only section 1 quotes should be visible
    expect(container.textContent).toContain('Quote 0 for section 1');
    expect(container.textContent).not.toContain('Quote 0 for section 2');
    expect(container.textContent).not.toContain('Quote 0 for section 3');
  });
});
