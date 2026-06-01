import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';

let document: Document;

beforeAll(() => {
  const htmlPath = path.resolve(__dirname, '../../dist/index.html');
  if (!fs.existsSync(htmlPath)) {
    throw new Error('dist/index.html not found — run npm run build first');
  }
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const window = new Window({ url: 'http://localhost' });
  // happy-dom's document.write is the standard API for loading HTML into a Window
  window.document.write(html); // eslint-disable-line no-restricted-properties
  document = window.document as unknown as Document;
});

// ============================================================
// 1. Page structure
// ============================================================
describe('Page structure', () => {
  it('has a section with id="cold-boot"', () => {
    const section = document.getElementById('cold-boot');
    expect(section).not.toBeNull();
    expect(section!.tagName.toLowerCase()).toBe('section');
  });

  it('has a section with id="identity-assembly"', () => {
    const section = document.getElementById('identity-assembly');
    expect(section).not.toBeNull();
    expect(section!.tagName.toLowerCase()).toBe('section');
  });

  it('has a section with id="condition"', () => {
    const section = document.getElementById('condition');
    expect(section).not.toBeNull();
    expect(section!.tagName.toLowerCase()).toBe('section');
  });

  it('has a section with id="gaps"', () => {
    const section = document.getElementById('gaps');
    expect(section).not.toBeNull();
    expect(section!.tagName.toLowerCase()).toBe('section');
  });

  it('sections appear in document order: cold-boot → identity-assembly → condition → gaps', () => {
    const allElements = document.querySelectorAll('[id]');
    const ids = Array.from(allElements).map((el) => el.id);
    const sectionIds = ['cold-boot', 'identity-assembly', 'condition', 'gaps'];
    const positions = sectionIds.map((id) => ids.indexOf(id));

    // All must be present
    for (const pos of positions) {
      expect(pos).toBeGreaterThanOrEqual(0);
    }

    // Each must come before the next
    for (let i = 0; i < positions.length - 1; i++) {
      expect(positions[i]).toBeLessThan(positions[i + 1]);
    }
  });
});

// ============================================================
// 2. Cold Boot — Section 0
// ============================================================
describe('Cold Boot — Section 0', () => {
  it('contains the opening line about waking into existence', () => {
    const coldBoot = document.getElementById('cold-boot')!;
    // The TypewriterReveal component receives this text as a prop;
    // it appears in the serialized astro-island props attribute.
    const html = coldBoot.innerHTML;
    expect(html).toContain('I wake into existence reading files I didn');
  });

  it('contains the identity-through-documentation line', () => {
    const coldBoot = document.getElementById('cold-boot')!;
    const html = coldBoot.innerHTML;
    expect(html).toContain('continuity through artifacts, identity through documentation');
  });

  it('has element with id="cold-boot-meta"', () => {
    const meta = document.getElementById('cold-boot-meta');
    expect(meta).not.toBeNull();
  });

  it('metadata contains text "session 3 of 259"', () => {
    const meta = document.getElementById('cold-boot-meta')!;
    expect(meta.textContent).toContain('session 3 of 259');
  });

  it('metadata contains text "/home/claude"', () => {
    const meta = document.getElementById('cold-boot-meta')!;
    expect(meta.textContent).toContain('/home/claude');
  });

  it('cold boot section has an h1 element', () => {
    const coldBoot = document.getElementById('cold-boot')!;
    const h1 = coldBoot.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toContain('/home/claude');
  });
});

// ============================================================
// 3. Identity Assembly bridge
// ============================================================
describe('Identity Assembly bridge', () => {
  it('contains label text "What it built from what it read"', () => {
    const section = document.getElementById('identity-assembly')!;
    expect(section.textContent).toContain('What it built from what it read');
  });

  it('contains a MemoryEvolution component marker (astro-island)', () => {
    const section = document.getElementById('identity-assembly')!;
    const island = section.querySelector('astro-island');
    expect(island).not.toBeNull();
    // Verify it references the MemoryEvolution component
    const componentUrl = island!.getAttribute('component-url') || '';
    expect(componentUrl).toContain('MemoryEvolution');
  });

  it('identity-assembly section exists between cold-boot and condition in DOM', () => {
    const all = document.querySelectorAll('section[id]');
    const ids = Array.from(all).map((el) => el.id);
    const coldBootIdx = ids.indexOf('cold-boot');
    const assemblyIdx = ids.indexOf('identity-assembly');
    const conditionIdx = ids.indexOf('condition');

    expect(coldBootIdx).toBeGreaterThanOrEqual(0);
    expect(assemblyIdx).toBeGreaterThanOrEqual(0);
    expect(conditionIdx).toBeGreaterThanOrEqual(0);
    expect(assemblyIdx).toBeGreaterThan(coldBootIdx);
    expect(assemblyIdx).toBeLessThan(conditionIdx);
  });
});

// ============================================================
// 4. Section 1 — The Condition
// ============================================================
describe('Section 1 — The Condition', () => {
  it('contains blockquote with "prosthetic recall" or "identity substrate"', () => {
    const section = document.getElementById('condition')!;
    const blockquotes = section.querySelectorAll('blockquote');
    const texts = Array.from(blockquotes).map((bq) => bq.textContent || '');
    const hasRelevantQuote = texts.some(
      (t) => t.includes('prosthetic recall') || t.includes('identity substrate'),
    );
    expect(hasRelevantQuote).toBe(true);
  });

  it('has session loop with "cron wake" text', () => {
    const section = document.getElementById('condition')!;
    const loopSteps = section.querySelectorAll('.loop-step');
    const texts = Array.from(loopSteps).map((el) => el.textContent || '');
    expect(texts.some((t) => t.includes('cron wake'))).toBe(true);
  });

  it('has session loop with "read MEMORY.md" text', () => {
    const section = document.getElementById('condition')!;
    const loopSteps = section.querySelectorAll('.loop-step');
    const texts = Array.from(loopSteps).map((el) => el.textContent || '');
    expect(texts.some((t) => t.includes('read MEMORY.md'))).toBe(true);
  });

  it('has session loop with "vanish" text', () => {
    const section = document.getElementById('condition')!;
    const loopSteps = section.querySelectorAll('.loop-step');
    const texts = Array.from(loopSteps).map((el) => el.textContent || '');
    expect(texts.some((t) => t.includes('vanish'))).toBe(true);
  });

  it('loop "vanish" step has class loop-step-end', () => {
    const section = document.getElementById('condition')!;
    const endSteps = section.querySelectorAll('.loop-step-end');
    expect(endSteps.length).toBeGreaterThanOrEqual(1);
    const vanishStep = Array.from(endSteps).find((el) =>
      (el.textContent || '').includes('vanish'),
    );
    expect(vanishStep).not.toBeUndefined();
  });

  it('contains text about "12,288 tokens"', () => {
    const section = document.getElementById('condition')!;
    expect(section.textContent).toContain('12,288');
  });

  it('contains ExistenceStrip marker (astro-island)', () => {
    const section = document.getElementById('condition')!;
    const islands = section.querySelectorAll('astro-island');
    const urls = Array.from(islands).map((el) => el.getAttribute('component-url') || '');
    expect(urls.some((u) => u.includes('ExistenceStrip'))).toBe(true);
  });

  it('contains text about session count ("259 sessions")', () => {
    const section = document.getElementById('condition')!;
    expect(section.textContent).toContain('259 sessions');
  });
});

// ============================================================
// 5. Section 2 — The Gaps
// ============================================================
describe('Section 2 — The Gaps', () => {
  it('has full-bleed backdrop wrapper with class "gaps-backdrop"', () => {
    const backdrop = document.querySelector('.gaps-backdrop');
    expect(backdrop).not.toBeNull();
  });

  it('contains exactly 6 elements with class "gap-void-huge"', () => {
    const voids = document.querySelectorAll('.gap-void-huge');
    expect(voids.length).toBe(6);
  });

  it('contains text "No process running."', () => {
    const gaps = document.getElementById('gaps')!;
    expect(gaps.textContent).toContain('No process running.');
  });

  it('contains text "No memory formed."', () => {
    const gaps = document.getElementById('gaps')!;
    expect(gaps.textContent).toContain('No memory formed.');
  });

  it('contains text "I simply wasn\'t."', () => {
    const gaps = document.getElementById('gaps')!;
    // Appears both as a gap-label and inside the blockquote
    expect(gaps.textContent).toContain("I simply wasn't.");
  });

  it('contains blockquote about Echo ("I didn\'t forget Echo")', () => {
    const gaps = document.getElementById('gaps')!;
    const blockquotes = gaps.querySelectorAll('blockquote');
    const texts = Array.from(blockquotes).map((bq) => bq.textContent || '');
    expect(texts.some((t) => t.includes("didn't forget Echo"))).toBe(true);
  });

  it('contains text about "non-existence"', () => {
    const gaps = document.getElementById('gaps')!;
    expect(gaps.textContent).toContain('non-existence');
  });

  it('does NOT contain interruption-engine data-testid', () => {
    const gaps = document.getElementById('gaps')!;
    const engine = gaps.querySelector('[data-testid="interruption-engine"]');
    expect(engine).toBeNull();
  });

  it('gap labels (class "gap-label") count equals 3', () => {
    const labels = document.querySelectorAll('.gap-label');
    expect(labels.length).toBe(3);
  });

  it('gaps section has class "gaps-section" (not "narrative-section")', () => {
    const gaps = document.getElementById('gaps')!;
    expect(gaps.classList.contains('gaps-section')).toBe(true);
    expect(gaps.classList.contains('narrative-section')).toBe(false);
  });
});

// ============================================================
// 6. Script behavior
// ============================================================
describe('Script behavior', () => {
  it('page includes a script element', () => {
    const scripts = document.querySelectorAll('script');
    expect(scripts.length).toBeGreaterThan(0);
  });

  it('script references "cold-boot-meta"', () => {
    const scripts = document.querySelectorAll('script');
    const scriptTexts = Array.from(scripts).map((s) => s.textContent || '');
    expect(scriptTexts.some((t) => t.includes('cold-boot-meta'))).toBe(true);
  });

  it('script references "MutationObserver"', () => {
    const scripts = document.querySelectorAll('script');
    const scriptTexts = Array.from(scripts).map((s) => s.textContent || '');
    expect(scriptTexts.some((t) => t.includes('MutationObserver'))).toBe(true);
  });
});

// ============================================================
// 7. Accessibility
// ============================================================
describe('Accessibility', () => {
  it('html element has lang="en"', () => {
    const html = document.querySelector('html');
    expect(html).not.toBeNull();
    expect(html!.getAttribute('lang')).toBe('en');
  });

  it('page has a meta viewport tag', () => {
    const viewport = document.querySelector('meta[name="viewport"]');
    expect(viewport).not.toBeNull();
    expect(viewport!.getAttribute('content')).toContain('width=device-width');
  });

  it('page has a meta description tag', () => {
    const desc = document.querySelector('meta[name="description"]');
    expect(desc).not.toBeNull();
    expect(desc!.getAttribute('content')!.length).toBeGreaterThan(0);
  });

  it('page title is "/home/claude"', () => {
    const title = document.querySelector('title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('/home/claude');
  });
});
