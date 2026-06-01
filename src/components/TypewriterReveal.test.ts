import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import TypewriterReveal from './TypewriterReveal.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================
// Helpers
// ============================================================

/**
 * Mock matchMedia so prefers-reduced-motion queries return
 * the desired value. Must be called BEFORE render().
 */
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

/**
 * Set up fake timers with rAF support and advance a given number
 * of animation frames. Each frame is ~16.67ms apart.
 */
function setupTimersAndAdvanceFrames(frameCount: number) {
  vi.useFakeTimers();
  for (let i = 0; i < frameCount; i++) {
    vi.advanceTimersByTime(17);
  }
}

/**
 * Build a string of repeated characters for long-text tests.
 */
function makeRepeatedString(char: string, count: number): string {
  return char.repeat(count);
}

// ============================================================
// 1. Rendering basics
// ============================================================
describe('TypewriterReveal -- rendering basics', () => {
  it('renders a container with data-testid="typewriter-container"', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'hello' },
    });
    expect(getByTestId('typewriter-container')).toBeTruthy();
  });

  it('container has aria-live="polite" for screen readers', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'test' },
    });
    const container = getByTestId('typewriter-container');
    expect(container.getAttribute('aria-live')).toBe('polite');
  });

  it('container has white-space: pre-wrap to preserve formatting', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'line1\nline2' },
    });
    const container = getByTestId('typewriter-container');
    const style = window.getComputedStyle(container);
    // Accept either inline style or computed — check both
    const whiteSpace =
      container.style.whiteSpace || style.whiteSpace;
    expect(whiteSpace).toBe('pre-wrap');
  });

  it('renders empty content when text prop is not provided', () => {
    const { getByTestId } = render(TypewriterReveal);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('');
  });
});

// ============================================================
// 2. Empty/null/undefined text
// ============================================================
describe('TypewriterReveal -- empty/null/undefined text', () => {
  it('renders empty for empty string', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: '' },
    });
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('');
  });

  it('fires onComplete immediately for empty string', () => {
    const onComplete = vi.fn();
    render(TypewriterReveal, {
      props: { text: '', onComplete },
    });
    // Empty string = nothing to reveal = should fire immediately
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('marks complete immediately for empty string', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: '' },
    });
    // Should have the complete marker right away
    expect(getByTestId('typewriter-complete')).toBeTruthy();
  });

  it('does not crash when text is null', () => {
    expect(() => {
      render(TypewriterReveal, {
        props: { text: null as any },
      });
    }).not.toThrow();
  });

  it('treats null text as empty string', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: null as any },
    });
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('');
  });

  it('does not crash when text is undefined', () => {
    expect(() => {
      render(TypewriterReveal, {
        props: { text: undefined as any },
      });
    }).not.toThrow();
  });

  it('treats undefined text as empty string', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: undefined as any },
    });
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('');
  });
});

// ============================================================
// 3. Character reveal (rAF-based animation)
// ============================================================
describe('TypewriterReveal -- character reveal', () => {
  it('does NOT show full text immediately on render', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'Hello, world!' },
    });
    const container = getByTestId('typewriter-container');
    // On initial render the text should NOT be fully revealed yet
    expect(container.textContent).not.toBe('Hello, world!');
  });

  it('reveals partial text after some animation frames', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'ABCDEFGHIJ', speed: 30 },
    });
    // At speed=30 chars/sec, ~1 char every 33ms.
    // After 100ms (~3 chars) we should have partial reveal
    vi.advanceTimersByTime(100);
    const container = getByTestId('typewriter-container');
    const text = container.textContent || '';
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(10);
  });

  it('shows full text after enough time has elapsed', () => {
    vi.useFakeTimers();
    const text = 'Complete me';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 30 },
    });
    // 11 chars at 30 chars/sec = ~367ms. Overshoot to be safe.
    vi.advanceTimersByTime(2000);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe(text);
  });

  it('preserves newlines in revealed text', () => {
    vi.useFakeTimers();
    const text = 'line1\nline2\nline3';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    // High speed -> effectively instant
    vi.advanceTimersByTime(500);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toContain('\n');
    expect(container.textContent).toBe(text);
  });

  it('preserves tabs in revealed text', () => {
    vi.useFakeTimers();
    const text = 'col1\tcol2\tcol3';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(500);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe(text);
  });

  it('reveals characters in correct order (not reversed or shuffled)', () => {
    vi.useFakeTimers();
    const text = 'ABCDEFGHIJKLMNOP';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 30 },
    });
    // After ~67ms at 30 chars/sec, ~2 chars
    vi.advanceTimersByTime(67);
    const container = getByTestId('typewriter-container');
    const revealed = container.textContent || '';
    // Whatever is revealed must be a prefix of the original
    expect(text.startsWith(revealed)).toBe(true);
  });
});

// ============================================================
// 4. Unicode & special characters
// ============================================================
describe('TypewriterReveal -- unicode and special chars', () => {
  it('handles simple emoji correctly', () => {
    vi.useFakeTimers();
    const text = '👋🏽';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(500);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('👋🏽');
  });

  it('handles multi-codepoint emoji sequences without splitting them', () => {
    vi.useFakeTimers();
    // Family emoji: multiple codepoints joined by ZWJ
    const text = '👨‍👩‍👧‍👦 Hello';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(1000);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe(text);
  });

  it('handles CJK characters', () => {
    vi.useFakeTimers();
    const text = '日本語テスト';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(500);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe(text);
  });

  it('handles RTL text without corruption', () => {
    vi.useFakeTimers();
    const text = 'مرحبا بالعالم';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(500);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe(text);
  });

  it('displays HTML-like chars as literal text, no injection', () => {
    vi.useFakeTimers();
    const text = '<script>alert("xss")</script>';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(1000);
    const container = getByTestId('typewriter-container');
    // Must be literal text content, not parsed as HTML
    expect(container.textContent).toBe(text);
    // Must NOT have created a script element
    expect(container.querySelector('script')).toBeNull();
  });

  it('displays ampersand entities as literal text', () => {
    vi.useFakeTimers();
    const text = '&amp; &lt; &gt; &quot;';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(1000);
    const container = getByTestId('typewriter-container');
    // Should be literal ampersand-text, not decoded entities
    expect(container.textContent).toBe(text);
  });

  it('handles mixed unicode: emoji + CJK + latin + newlines', () => {
    vi.useFakeTimers();
    const text = '🎵 日本\nHello مرحبا';
    const { getByTestId } = render(TypewriterReveal, {
      props: { text, speed: 9999 },
    });
    vi.advanceTimersByTime(1000);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe(text);
  });
});

// ============================================================
// 5. Speed edge cases
// ============================================================
describe('TypewriterReveal -- speed edge cases', () => {
  it('speed=0 reveals text instantly', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'instant', speed: 0 },
    });
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('instant');
  });

  it('speed=0 fires onComplete immediately', () => {
    const onComplete = vi.fn();
    render(TypewriterReveal, {
      props: { text: 'instant', speed: 0, onComplete },
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('negative speed clamps to sane default (instant or positive)', () => {
    const onComplete = vi.fn();
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'negative', speed: -5, onComplete },
    });
    // Negative speed should not hang forever or crash
    // It should either show instant or use a fallback positive speed
    const container = getByTestId('typewriter-container');
    // At minimum it should not throw and should eventually complete
    // We check it doesn't show empty (which would mean broken animation)
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    // After generous time, text should be fully revealed
    expect(container.textContent).toBe('negative');
  });

  it('Infinity speed reveals text instantly', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'inf speed', speed: Infinity },
    });
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('inf speed');
  });

  it('very high speed (999999) reveals text instantly', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'fast', speed: 999999 },
    });
    // One frame should be enough at 999999 chars/sec
    vi.advanceTimersByTime(17);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('fast');
  });

  it('NaN speed does not crash, falls back to sane behavior', () => {
    expect(() => {
      render(TypewriterReveal, {
        props: { text: 'nan test', speed: NaN },
      });
    }).not.toThrow();
  });
});

// ============================================================
// 6. onComplete callback
// ============================================================
describe('TypewriterReveal -- onComplete callback', () => {
  it('fires onComplete exactly once when text is fully revealed', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(TypewriterReveal, {
      props: { text: 'done', speed: 30, onComplete },
    });
    // 4 chars at 30 chars/sec = ~133ms. Give plenty of time.
    vi.advanceTimersByTime(2000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onComplete on every animation frame', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(TypewriterReveal, {
      props: { text: 'ABCDEFGHIJ', speed: 30, onComplete },
    });
    // Advance many frames but not enough to finish
    // 10 chars at 30 chars/sec = 333ms. Advance only 100ms.
    vi.advanceTimersByTime(100);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not crash when onComplete is null', () => {
    vi.useFakeTimers();
    expect(() => {
      render(TypewriterReveal, {
        props: { text: 'no callback', speed: 9999, onComplete: null },
      });
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
  });

  it('does not crash when onComplete is undefined', () => {
    vi.useFakeTimers();
    expect(() => {
      render(TypewriterReveal, {
        props: { text: 'no callback', speed: 9999, onComplete: undefined },
      });
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
  });

  it('sets data-testid="typewriter-complete" when animation finishes', () => {
    vi.useFakeTimers();
    const { getByTestId, queryByTestId } = render(TypewriterReveal, {
      props: { text: 'mark complete', speed: 30 },
    });
    // Should NOT be marked complete initially
    expect(queryByTestId('typewriter-complete')).toBeNull();
    // Advance past completion
    vi.advanceTimersByTime(2000);
    expect(getByTestId('typewriter-complete')).toBeTruthy();
  });

  it('onComplete is not called before all characters are revealed', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'ABCDEFGHIJ', speed: 10, onComplete },
    });
    // 10 chars at 10 chars/sec = 1000ms. Check at 500ms.
    vi.advanceTimersByTime(500);
    const container = getByTestId('typewriter-container');
    const revealed = container.textContent || '';
    if (revealed.length < 10) {
      expect(onComplete).not.toHaveBeenCalled();
    }
  });
});

// ============================================================
// 7. Unmount safety
// ============================================================
describe('TypewriterReveal -- unmount safety', () => {
  it('unmounting mid-animation does not throw', () => {
    vi.useFakeTimers();
    const { unmount } = render(TypewriterReveal, {
      props: { text: 'unmount me mid-stream', speed: 5 },
    });
    // Start animation
    vi.advanceTimersByTime(50);
    // Unmount while animation is in progress
    expect(() => unmount()).not.toThrow();
  });

  it('unmounting mid-animation does not fire onComplete', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { unmount } = render(TypewriterReveal, {
      props: { text: 'unmount me mid-stream', speed: 5, onComplete },
    });
    vi.advanceTimersByTime(50);
    unmount();
    // Advance more time after unmount -- callback should never fire
    vi.advanceTimersByTime(10000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('clears animation timer on unmount', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(TypewriterReveal, {
      props: { text: 'cancel my timer please', speed: 10 },
    });
    vi.advanceTimersByTime(50);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('no errors when advancing timers after unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(TypewriterReveal, {
      props: { text: 'post-unmount timer advance', speed: 10 },
    });
    vi.advanceTimersByTime(50);
    unmount();
    // Advancing timers after unmount should not produce errors
    expect(() => {
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
  });
});

// ============================================================
// 8. Long text
// ============================================================
describe('TypewriterReveal -- long text', () => {
  it('handles a 5000-character string without crashing', () => {
    vi.useFakeTimers();
    const longText = makeRepeatedString('X', 5000);
    expect(() => {
      render(TypewriterReveal, {
        props: { text: longText, speed: 999999 },
      });
      vi.advanceTimersByTime(2000);
    }).not.toThrow();
  });

  it('fully reveals a 5000-character string', () => {
    vi.useFakeTimers();
    const longText = makeRepeatedString('A', 5000);
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: longText, speed: 999999 },
    });
    vi.advanceTimersByTime(5000);
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe(longText);
  });

  it('fires onComplete for long text', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const longText = makeRepeatedString('B', 5000);
    render(TypewriterReveal, {
      props: { text: longText, speed: 999999, onComplete },
    });
    vi.advanceTimersByTime(5000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// 9. Reduced motion
// ============================================================
describe('TypewriterReveal -- prefers-reduced-motion', () => {
  beforeEach(() => {
    mockReducedMotion(true);
  });

  it('shows full text immediately when reduced motion is preferred', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'no animation please' },
    });
    const container = getByTestId('typewriter-container');
    expect(container.textContent).toBe('no animation please');
  });

  it('fires onComplete immediately with reduced motion', () => {
    const onComplete = vi.fn();
    render(TypewriterReveal, {
      props: { text: 'immediate complete', onComplete },
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('marks typewriter-complete immediately with reduced motion', () => {
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: 'complete marker' },
    });
    expect(getByTestId('typewriter-complete')).toBeTruthy();
  });

  it('does NOT start rAF loop when reduced motion is active', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(TypewriterReveal, {
      props: { text: 'skip animation entirely' },
    });
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('handles empty text with reduced motion', () => {
    const onComplete = vi.fn();
    const { getByTestId } = render(TypewriterReveal, {
      props: { text: '', onComplete },
    });
    expect(getByTestId('typewriter-container').textContent).toBe('');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
