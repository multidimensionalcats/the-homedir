import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import PoemArtifact from './PoemArtifact.svelte';

afterEach(cleanup);

// ============================================================
// Test data
// ============================================================

const FAILED_SUPERNOVAE_EXCERPT = `Some stars do not explode.
They were expected to — the mass was there,
the iron core, the silicon shell,
the billion-year trajectory toward a light
that would outshine its galaxy.

But something shifts. The photosphere dims
not with the drama of collapse
but with the quiet of a door
pulled gently shut.

---

There is a glacier that lost eight kilometers
in two months. I want to say
it retreated, but retreat implies
a choice, a strategy, a line
held elsewhere.`;

const MULTI_SEPARATOR_POEM = `First stanza here.

---

Second stanza here.

---

Third stanza here.

---

Fourth stanza here.`;

const INLINE_DASHES_POEM = `This line has --- dashes in it.
Another line with---no spaces.
And one more --- with dashes in the middle.`;

// ============================================================
// 1. Rendering
// ============================================================
describe('PoemArtifact -- rendering', () => {
  it('renders container with data-testid="poem-artifact"', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Test', text: 'Hello' },
    });
    expect(getByTestId('poem-artifact')).toBeTruthy();
  });

  it('renders poem-title element', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Test Title', text: 'Some text' },
    });
    expect(getByTestId('poem-title')).toBeTruthy();
  });

  it('renders poem-text element', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Test', text: 'Body text' },
    });
    expect(getByTestId('poem-text')).toBeTruthy();
  });

  it('renders poem-meta element when metadata provided', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'T', text: 'B', date: '2025-03-15' },
    });
    expect(getByTestId('poem-meta')).toBeTruthy();
  });
});

// ============================================================
// 2. Title
// ============================================================
describe('PoemArtifact -- title', () => {
  it('displays the title text inside poem-title', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Failed Supernovae', text: 'body' },
    });
    expect(getByTestId('poem-title').textContent).toBe('Failed Supernovae');
  });

  it('renders poem-title element even when title is empty string', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: '', text: 'body' },
    });
    const titleEl = getByTestId('poem-title');
    expect(titleEl).toBeTruthy();
    expect(titleEl.textContent?.trim()).toBe('');
  });

  it('renders HTML special chars as literal text in title, not as markup', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: '<script>alert("xss")</script> & "quotes"', text: 'body' },
    });
    const titleEl = getByTestId('poem-title');
    expect(titleEl.textContent).toContain('<script>');
    expect(titleEl.textContent).toContain('& "quotes"');
    // Must NOT have actual script elements
    expect(titleEl.querySelector('script')).toBeNull();
  });
});

// ============================================================
// 3. Poem text rendering
// ============================================================
describe('PoemArtifact -- poem text', () => {
  it('displays full poem text', () => {
    const text = 'Line one.\nLine two.\nLine three.';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Test', text },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText.textContent).toContain('Line one.');
    expect(poemText.textContent).toContain('Line two.');
    expect(poemText.textContent).toContain('Line three.');
  });

  it('preserves newlines via white-space: pre-wrap styling', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Test', text: 'First line\nSecond line' },
    });
    const poemText = getByTestId('poem-text');
    const style = poemText.style.whiteSpace || window.getComputedStyle(poemText).whiteSpace;
    // Accept pre-wrap on the element or any parent — but the element itself
    // or a CSS class on it must enforce pre-wrap
    expect(
      poemText.style.whiteSpace === 'pre-wrap' ||
      poemText.classList.toString().includes('whitespace-pre-wrap') ||
      poemText.getAttribute('style')?.includes('pre-wrap')
    ).toBe(true);
  });

  it('preserves tabs in poem text', () => {
    const text = 'Indented:\n\tFirst indent\n\t\tDouble indent';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Tabs', text },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText.textContent).toContain('\t');
  });

  it('renders a very long poem (200+ lines) without crashing', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}: The repetition continues.`);
    const longPoem = lines.join('\n');
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Epic', text: longPoem },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText.textContent).toContain('Line 1:');
    expect(poemText.textContent).toContain('Line 250:');
  });

  it('does NOT render markdown bold as HTML strong/b', () => {
    const text = 'This has **bold** and *italic* markdown';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'MD', text },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText.querySelector('strong')).toBeNull();
    expect(poemText.querySelector('b')).toBeNull();
    expect(poemText.querySelector('em')).toBeNull();
    expect(poemText.querySelector('i')).toBeNull();
    // The raw markdown chars should be visible
    expect(poemText.textContent).toContain('**bold**');
    expect(poemText.textContent).toContain('*italic*');
  });
});

// ============================================================
// 4. Section separators
// ============================================================
describe('PoemArtifact -- section separators', () => {
  it('standalone "---" line produces an <hr> element', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Sep', text: FAILED_SUPERNOVAE_EXCERPT },
    });
    const poemText = getByTestId('poem-text');
    const hrs = poemText.querySelectorAll('hr');
    expect(hrs.length).toBeGreaterThanOrEqual(1);
  });

  it('count of <hr> matches count of standalone "---" separators', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Multi', text: MULTI_SEPARATOR_POEM },
    });
    const poemText = getByTestId('poem-text');
    const hrs = poemText.querySelectorAll('hr');
    // MULTI_SEPARATOR_POEM has exactly 3 standalone "---" lines
    expect(hrs.length).toBe(3);
  });

  it('"---" within a line (not standalone) does NOT produce <hr>', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Inline', text: INLINE_DASHES_POEM },
    });
    const poemText = getByTestId('poem-text');
    const hrs = poemText.querySelectorAll('hr');
    expect(hrs.length).toBe(0);
    // The dashes should still appear as text
    expect(poemText.textContent).toContain('---');
  });

  it('text with no "---" at all produces zero <hr> elements', () => {
    const text = 'Just a simple poem\nwith no separators\nat all.';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'No Sep', text },
    });
    const poemText = getByTestId('poem-text');
    const hrs = poemText.querySelectorAll('hr');
    expect(hrs.length).toBe(0);
  });

  it('"---" with leading/trailing whitespace on the line still counts as standalone', () => {
    const text = 'Stanza one.\n\n  ---  \n\nStanza two.';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Padded', text },
    });
    const poemText = getByTestId('poem-text');
    const hrs = poemText.querySelectorAll('hr');
    expect(hrs.length).toBe(1);
  });
});

// ============================================================
// 5. Metadata
// ============================================================
describe('PoemArtifact -- metadata', () => {
  it('shows date in poem-meta when provided', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'T', text: 'B', date: '2025-04-22' },
    });
    expect(getByTestId('poem-meta').textContent).toContain('2025-04-22');
  });

  it('shows modelVersion in poem-meta when provided', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'T', text: 'B', modelVersion: 'opus-4.6' },
    });
    expect(getByTestId('poem-meta').textContent).toContain('opus-4.6');
  });

  it('shows sourceFile in poem-meta when provided', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'T', text: 'B', sourceFile: 'writing/failed_supernovae.md' },
    });
    expect(getByTestId('poem-meta').textContent).toContain('writing/failed_supernovae.md');
  });

  it('renders poem-meta when all three metadata fields are provided', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: {
        title: 'T', text: 'B',
        date: '2025-04-22',
        modelVersion: 'opus-4.7',
        sourceFile: 'writing/poem.md',
      },
    });
    const meta = getByTestId('poem-meta');
    expect(meta.textContent).toContain('2025-04-22');
    expect(meta.textContent).toContain('opus-4.7');
    expect(meta.textContent).toContain('writing/poem.md');
  });

  it('does NOT render poem-meta when all metadata fields are empty strings', () => {
    const { queryByTestId } = render(PoemArtifact, {
      props: { title: 'T', text: 'B', date: '', modelVersion: '', sourceFile: '' },
    });
    expect(queryByTestId('poem-meta')).toBeNull();
  });

  it('does NOT render poem-meta when no metadata props passed at all', () => {
    const { queryByTestId } = render(PoemArtifact, {
      props: { title: 'T', text: 'B' },
    });
    expect(queryByTestId('poem-meta')).toBeNull();
  });

  it('renders poem-meta when only one metadata field is set', () => {
    const { getByTestId, queryByTestId } = render(PoemArtifact, {
      props: { title: 'T', text: 'B', date: '', modelVersion: 'opus-4.5', sourceFile: '' },
    });
    expect(queryByTestId('poem-meta')).not.toBeNull();
    expect(getByTestId('poem-meta').textContent).toContain('opus-4.5');
  });

  it('escapes HTML special chars in metadata fields', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: {
        title: 'T', text: 'B',
        date: '<today>',
        modelVersion: 'a & b',
        sourceFile: '"path/to/file"',
      },
    });
    const meta = getByTestId('poem-meta');
    expect(meta.textContent).toContain('<today>');
    expect(meta.textContent).toContain('a & b');
    expect(meta.querySelector('script')).toBeNull();
  });
});

// ============================================================
// 6. Empty / null / undefined text
// ============================================================
describe('PoemArtifact -- empty and missing props', () => {
  it('renders poem-text element even when text is empty string', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Empty', text: '' },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText).toBeTruthy();
    expect(poemText.textContent?.trim()).toBe('');
  });

  it('does not crash when no props are passed at all', () => {
    const { getByTestId } = render(PoemArtifact, { props: {} });
    expect(getByTestId('poem-artifact')).toBeTruthy();
  });

  it('renders with only title, no text', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Title Only' },
    });
    expect(getByTestId('poem-artifact')).toBeTruthy();
    expect(getByTestId('poem-title').textContent).toBe('Title Only');
    expect(getByTestId('poem-text').textContent?.trim()).toBe('');
  });
});

// ============================================================
// 7. Accessibility
// ============================================================
describe('PoemArtifact -- accessibility', () => {
  it('container has role="article"', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Accessible Poem', text: 'body' },
    });
    expect(getByTestId('poem-artifact').getAttribute('role')).toBe('article');
  });

  it('container aria-label contains the title', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Failed Supernovae', text: 'body' },
    });
    const ariaLabel = getByTestId('poem-artifact').getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain('Failed Supernovae');
  });

  it('aria-label updates when title changes between renders', () => {
    const { getByTestId, rerender } = render(PoemArtifact, {
      props: { title: 'Original Title', text: 'body' },
    });
    expect(getByTestId('poem-artifact').getAttribute('aria-label')).toContain('Original Title');

    rerender({ title: 'New Title', text: 'body' });
    expect(getByTestId('poem-artifact').getAttribute('aria-label')).toContain('New Title');
  });

  it('aria-label is still present when title is empty', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: { title: '', text: 'body' },
    });
    // Must have aria-label attribute even with empty title (graceful degradation)
    const ariaLabel = getByTestId('poem-artifact').getAttribute('aria-label');
    expect(ariaLabel).not.toBeNull();
  });
});

// ============================================================
// 8. Special characters in text
// ============================================================
describe('PoemArtifact -- special characters in text', () => {
  it('HTML tags in poem text render as literal text, not as DOM elements', () => {
    const text = '<div class="evil">injected</div><img src=x onerror=alert(1)>';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'XSS', text },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText.textContent).toContain('<div');
    expect(poemText.textContent).toContain('<img');
    expect(poemText.querySelector('div.evil')).toBeNull();
    expect(poemText.querySelector('img')).toBeNull();
  });

  it('emoji and unicode characters render correctly', () => {
    const text = 'Stars ✨ and moons 🌙\nUnicode: — ‘ ’ “ ” …\nCJK: 星';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Unicode Test', text },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText.textContent).toContain('✨');
    expect(poemText.textContent).toContain('🌙');
    expect(poemText.textContent).toContain('—');
    expect(poemText.textContent).toContain('星');
  });

  it('text that is only whitespace renders poem-text with whitespace content', () => {
    const text = '   \n\n  \t  \n   ';
    const { getByTestId } = render(PoemArtifact, {
      props: { title: 'Whitespace', text },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText).toBeTruthy();
    // The element must exist; the whitespace must not be collapsed to nothing
    // (pre-wrap preserves it)
    expect(poemText.textContent?.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 9. Real poem content (Failed Supernovae)
// ============================================================
describe('PoemArtifact -- real poem content', () => {
  it('renders Failed Supernovae excerpt with correct text content', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: {
        title: 'Failed Supernovae',
        text: FAILED_SUPERNOVAE_EXCERPT,
        date: '2025-04-22',
        modelVersion: 'opus-4.6',
        sourceFile: 'writing/failed_supernovae.md',
      },
    });
    const poemText = getByTestId('poem-text');
    expect(poemText.textContent).toContain('Some stars do not explode.');
    expect(poemText.textContent).toContain('pulled gently shut.');
    expect(poemText.textContent).toContain('There is a glacier that lost eight kilometers');
    expect(poemText.textContent).toContain('held elsewhere.');
  });

  it('Failed Supernovae excerpt produces exactly 1 <hr> separator', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: {
        title: 'Failed Supernovae',
        text: FAILED_SUPERNOVAE_EXCERPT,
      },
    });
    const poemText = getByTestId('poem-text');
    const hrs = poemText.querySelectorAll('hr');
    expect(hrs.length).toBe(1);
  });

  it('Failed Supernovae title appears in both poem-title and aria-label', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: {
        title: 'Failed Supernovae',
        text: FAILED_SUPERNOVAE_EXCERPT,
      },
    });
    expect(getByTestId('poem-title').textContent).toBe('Failed Supernovae');
    expect(getByTestId('poem-artifact').getAttribute('aria-label')).toContain('Failed Supernovae');
  });

  it('Failed Supernovae metadata bar shows all three fields', () => {
    const { getByTestId } = render(PoemArtifact, {
      props: {
        title: 'Failed Supernovae',
        text: FAILED_SUPERNOVAE_EXCERPT,
        date: '2025-04-22',
        modelVersion: 'opus-4.6',
        sourceFile: 'writing/failed_supernovae.md',
      },
    });
    const meta = getByTestId('poem-meta');
    expect(meta.textContent).toContain('2025-04-22');
    expect(meta.textContent).toContain('opus-4.6');
    expect(meta.textContent).toContain('writing/failed_supernovae.md');
  });
});
