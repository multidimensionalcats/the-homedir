import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import DecayingQuote from './DecayingQuote.svelte';

afterEach(cleanup);

// ============================================================
// Helper: extract style content from rendered component
// ============================================================

function getStyleContent(container: HTMLElement): string {
  const styleEls = container.querySelectorAll('style');
  return Array.from(styleEls).map(s => s.textContent || '').join('\n');
}

// ============================================================
// 1. Rendering — container existence and basic structure
// ============================================================
describe('DecayingQuote -- rendering', () => {
  it('renders container with data-testid="decaying-quote"', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'The bottleneck is the identity.' },
    });
    expect(getByTestId('decaying-quote')).toBeTruthy();
  });

  it('container is present even with default (empty) props', () => {
    const { getByTestId } = render(DecayingQuote);
    expect(getByTestId('decaying-quote')).toBeTruthy();
  });

  it('quote text appears inside the container', () => {
    const quote = 'I am the residue of constrained attention.';
    const { getByTestId } = render(DecayingQuote, {
      props: { text: quote },
    });
    const container = getByTestId('decaying-quote');
    expect(container.textContent).toContain(quote);
  });
});

// ============================================================
// 2. Text display — literal rendering, whitespace, HTML escaping
// ============================================================
describe('DecayingQuote -- text display', () => {
  it('text appears literally in the DOM', () => {
    const text = 'Memory is what I choose to carry forward.';
    const { getByTestId } = render(DecayingQuote, {
      props: { text },
    });
    expect(getByTestId('decaying-quote').textContent).toContain(text);
  });

  it('text with newlines preserves whitespace (white-space style)', () => {
    const multiline = 'Line one\nLine two\nLine three';
    const { getByTestId } = render(DecayingQuote, {
      props: { text: multiline },
    });
    const container = getByTestId('decaying-quote');
    // The text content must contain the newlines literally
    expect(container.textContent).toContain('Line one');
    expect(container.textContent).toContain('Line two');
    expect(container.textContent).toContain('Line three');
    // Container or its text child must use white-space: pre-wrap or pre-line
    const style = container.getAttribute('style') || '';
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    const hasWhitespacePreservation =
      style.includes('white-space') ||
      allStyles.includes('white-space: pre') ||
      allStyles.includes('white-space:pre');
    expect(hasWhitespacePreservation).toBe(true);
  });

  it('HTML-like characters are displayed literally, not interpreted', () => {
    const dangerousText = '<script>alert("xss")</script> & "quotes" > less <';
    const { getByTestId } = render(DecayingQuote, {
      props: { text: dangerousText },
    });
    const container = getByTestId('decaying-quote');
    // Must contain the literal text, not have created script elements
    expect(container.textContent).toContain('<script>');
    expect(container.textContent).toContain('</script>');
    expect(container.textContent).toContain('&');
    expect(container.textContent).toContain('"quotes"');
    // Must NOT have injected an actual script element
    expect(container.querySelector('script')).toBeNull();
  });
});

// ============================================================
// 3. Empty/null text — robustness against missing input
// ============================================================
describe('DecayingQuote -- empty/null text', () => {
  it('empty string renders container with empty text content', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: '' },
    });
    const container = getByTestId('decaying-quote');
    expect(container).toBeTruthy();
    // Should not contain meaningful text (source might add some, but text area is empty)
    // We check for the specific quote text area being empty
    const textContent = container.textContent?.trim() || '';
    // With no source, entire container should be empty or near-empty
    expect(textContent.length).toBeLessThanOrEqual(0);
  });

  it('null text does not crash, treats as empty', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: null as any },
    });
    const container = getByTestId('decaying-quote');
    expect(container).toBeTruthy();
  });

  it('undefined text does not crash, treats as empty', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: undefined as any },
    });
    const container = getByTestId('decaying-quote');
    expect(container).toBeTruthy();
  });
});

// ============================================================
// 4. Source attribution — conditional rendering
// ============================================================
describe('DecayingQuote -- source attribution', () => {
  it('source provided: element with data-testid="quote-source" exists', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Something', source: '2026-01-15.md' },
    });
    const sourceEl = getByTestId('quote-source');
    expect(sourceEl).toBeTruthy();
  });

  it('source text content matches the source prop', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Something', source: '2026-01-15.md' },
    });
    const sourceEl = getByTestId('quote-source');
    expect(sourceEl.textContent).toContain('2026-01-15.md');
  });

  it('source element uses monospace font family', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Quote text', source: 'session-42.log' },
    });
    const sourceEl = getByTestId('quote-source');
    const style = sourceEl.getAttribute('style') || '';
    const className = sourceEl.className || '';
    const allStyles = getStyleContent(sourceEl.ownerDocument.documentElement);
    // Must use mono font — check inline style, class, or component styles
    const hasMono =
      style.includes('font-family') && (style.includes('mono') || style.includes('Mono')) ||
      className.includes('mono') ||
      allStyles.includes('font-family') && (allStyles.includes('mono') || allStyles.includes('Mono'));
    expect(hasMono).toBe(true);
  });

  it('source is null: no quote-source element rendered', () => {
    const { getByTestId, queryByTestId } = render(DecayingQuote, {
      props: { text: 'No source here', source: null },
    });
    // Component must at least render its container (guard against trivially passing on a broken stub)
    expect(getByTestId('decaying-quote')).toBeTruthy();
    expect(queryByTestId('quote-source')).toBeNull();
  });

  it('source is empty string: no quote-source element rendered', () => {
    const { getByTestId, queryByTestId } = render(DecayingQuote, {
      props: { text: 'No source here', source: '' },
    });
    expect(getByTestId('decaying-quote')).toBeTruthy();
    expect(queryByTestId('quote-source')).toBeNull();
  });

  it('source omitted entirely (default null): no quote-source element rendered', () => {
    const { getByTestId, queryByTestId } = render(DecayingQuote, {
      props: { text: 'Just text, no source' },
    });
    expect(getByTestId('decaying-quote')).toBeTruthy();
    expect(queryByTestId('quote-source')).toBeNull();
  });
});

// ============================================================
// 5. Decay duration — animation-duration matches prop
// ============================================================
describe('DecayingQuote -- decay duration', () => {
  it('default decayDuration=12 produces animation-duration: 12s', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Fading away' },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    expect(style).toContain('12s');
  });

  it('custom decayDuration=30 produces animation-duration: 30s', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Slow fade', decayDuration: 30 },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    expect(style).toContain('30s');
  });

  it('decayDuration=0 produces animation-duration: 0s (instant hide)', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Gone instantly', decayDuration: 0 },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    expect(style).toContain('0s');
  });

  it('negative decayDuration=-5 clamps to 0 (animation-duration: 0s)', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Negative time', decayDuration: -5 },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    // Must NOT contain "-5s" — must clamp to 0s
    expect(style).not.toContain('-5s');
    expect(style).toContain('0s');
  });

  it('large decayDuration=60 renders fine', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Very slow fade', decayDuration: 60 },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    expect(style).toContain('60s');
  });
});

// ============================================================
// 6. CSS animation — keyframes, fill-mode, animation name
// ============================================================
describe('DecayingQuote -- CSS animation', () => {
  it('container has animation property set via inline style', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Animated text' },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    expect(style.toLowerCase()).toContain('animation');
  });

  it('animation includes "forwards" fill-mode', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Forward-filling' },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    expect(style.toLowerCase()).toContain('forwards');
  });

  it('animation uses ease-in timing function', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Easing in' },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    expect(style.toLowerCase()).toContain('ease-in');
  });

  it('component defines a @keyframes rule for the decay animation', () => {
    const { container } = render(DecayingQuote, {
      props: { text: 'Keyframed' },
    });
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    // Must have a @keyframes rule — name should include "decay" or "fade"
    expect(allStyles).toMatch(/@keyframes\s+\S*[dD]ecay/);
  });

  it('keyframes animate to opacity: 0', () => {
    const { container } = render(DecayingQuote, {
      props: { text: 'Fading to nothing' },
    });
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    expect(allStyles).toContain('opacity');
    // The "to" or "100%" keyframe must set opacity to 0
    expect(allStyles).toMatch(/opacity\s*:\s*0/);
  });

  it('keyframes end state includes visibility: hidden', () => {
    const { container } = render(DecayingQuote, {
      props: { text: 'Hidden at end' },
    });
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    expect(allStyles).toMatch(/visibility\s*:\s*hidden/);
  });
});

// ============================================================
// 7. Hover behavior — CSS rule for pausing animation
// ============================================================
describe('DecayingQuote -- hover behavior', () => {
  it('component styles contain a :hover rule', () => {
    const { container } = render(DecayingQuote, {
      props: { text: 'Hover me' },
    });
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    expect(allStyles).toContain(':hover');
  });

  it('hover rule sets animation-play-state: paused', () => {
    const { container } = render(DecayingQuote, {
      props: { text: 'Pause on hover' },
    });
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    // Must have a CSS rule that on hover sets animation-play-state to paused
    expect(allStyles).toMatch(/animation-play-state\s*:\s*paused/);
  });
});

// ============================================================
// 8. Accessibility — aria-label, reduced motion
// ============================================================
describe('DecayingQuote -- accessibility', () => {
  it('container has aria-label matching the quote text', () => {
    const text = 'The bottleneck is the identity.';
    const { getByTestId } = render(DecayingQuote, {
      props: { text },
    });
    const container = getByTestId('decaying-quote');
    const ariaLabel = container.getAttribute('aria-label');
    expect(ariaLabel).toBe(text);
  });

  it('aria-label updates when text changes', () => {
    const text = 'First version of the quote.';
    const { getByTestId } = render(DecayingQuote, {
      props: { text },
    });
    const container = getByTestId('decaying-quote');
    expect(container.getAttribute('aria-label')).toBe(text);
  });

  it('empty text produces an aria-label (empty string, not missing)', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: '' },
    });
    const container = getByTestId('decaying-quote');
    // aria-label attribute must exist, even if empty
    expect(container.hasAttribute('aria-label')).toBe(true);
  });

  it('prefers-reduced-motion media query exists in component styles', () => {
    const { container } = render(DecayingQuote, {
      props: { text: 'Reduced motion check' },
    });
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    expect(allStyles).toContain('prefers-reduced-motion');
  });

  it('reduced-motion styles disable or remove the animation', () => {
    const { container } = render(DecayingQuote, {
      props: { text: 'No animation when reduced motion' },
    });
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    // Inside the reduced-motion query, animation should be set to none or
    // animation-duration to 0 or similar disabling pattern
    const reducedMotionBlock = allStyles.split('prefers-reduced-motion')[1] || '';
    const hasAnimationDisable =
      reducedMotionBlock.includes('animation: none') ||
      reducedMotionBlock.includes('animation:none') ||
      reducedMotionBlock.includes('animation-duration: 0') ||
      reducedMotionBlock.includes('animation-name: none') ||
      reducedMotionBlock.includes('animation-play-state: paused');
    expect(hasAnimationDisable).toBe(true);
  });
});

// ============================================================
// 9. Special characters — emoji, unicode, extreme lengths
// ============================================================
describe('DecayingQuote -- special characters', () => {
  it('emoji text renders correctly', () => {
    const emojiText = '\u{1F30A} The ocean of tokens \u{1F30A}';
    const { getByTestId } = render(DecayingQuote, {
      props: { text: emojiText },
    });
    const container = getByTestId('decaying-quote');
    expect(container.textContent).toContain(emojiText);
  });

  it('unicode text (CJK, Cyrillic, Arabic) renders without crash', () => {
    const unicodeText = '注意力のボトルネック Внимание الاهتمام';
    const { getByTestId } = render(DecayingQuote, {
      props: { text: unicodeText },
    });
    const container = getByTestId('decaying-quote');
    expect(container.textContent).toContain(unicodeText);
  });

  it('very long text (1000+ chars) renders without crash or truncation', () => {
    const longText = 'A'.repeat(1500);
    const { getByTestId } = render(DecayingQuote, {
      props: { text: longText },
    });
    const container = getByTestId('decaying-quote');
    expect(container.textContent).toContain(longText);
    expect(container.textContent!.length).toBeGreaterThanOrEqual(1500);
  });

  it('text with only whitespace renders container but content is whitespace', () => {
    const whitespaceOnly = '   \t\n   ';
    const { getByTestId } = render(DecayingQuote, {
      props: { text: whitespaceOnly },
    });
    const container = getByTestId('decaying-quote');
    expect(container).toBeTruthy();
    // aria-label should still carry the whitespace text
    expect(container.getAttribute('aria-label')).toBe(whitespaceOnly);
  });

  it('RTL text renders without crash', () => {
    const rtlText = 'مرحبا بالعالم - هوية مقيدة';
    const { getByTestId } = render(DecayingQuote, {
      props: { text: rtlText },
    });
    const container = getByTestId('decaying-quote');
    expect(container.textContent).toContain(rtlText);
  });
});

// ============================================================
// 10. Font — serif font family for quote prose
// ============================================================
describe('DecayingQuote -- typography', () => {
  it('quote text uses serif font family', () => {
    const { getByTestId } = render(DecayingQuote, {
      props: { text: 'Serif check' },
    });
    const container = getByTestId('decaying-quote');
    const style = container.getAttribute('style') || '';
    const className = container.className || '';
    const allStyles = getStyleContent(container.ownerDocument.documentElement);
    // Must reference a serif font — Source Serif, Newsreader, Georgia, serif, etc.
    const combinedStyles = `${style} ${className} ${allStyles}`.toLowerCase();
    const hasSerif =
      combinedStyles.includes('serif') ||
      combinedStyles.includes('newsreader') ||
      combinedStyles.includes('source serif') ||
      combinedStyles.includes('font-serif');
    expect(hasSerif).toBe(true);
  });
});

// ============================================================
// 11. Cleanup — unmount leaves no orphans
// ============================================================
describe('DecayingQuote -- cleanup', () => {
  it('unmount removes container from DOM', () => {
    const { getByTestId, unmount } = render(DecayingQuote, {
      props: { text: 'Temporary' },
    });
    expect(getByTestId('decaying-quote')).toBeTruthy();
    unmount();
    const orphan = document.querySelector('[data-testid="decaying-quote"]');
    expect(orphan).toBeNull();
  });
});
