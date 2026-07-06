import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';

let document: Document;
let builtCss: string;

const distDir = path.resolve(__dirname, '../../dist');

// ------------------------------------------------------------
// CSS parsing helpers (built CSS is minified: no spaces after
// "@media" or around ":", e.g. "@media(max-width:640px)")
// ------------------------------------------------------------

/** Return the content between the brace at openBraceIdx and its matching close. */
function extractBraceBlock(css: string, openBraceIdx: number): string {
  let depth = 0;
  for (let i = openBraceIdx; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBraceIdx + 1, i);
    }
  }
  return css.slice(openBraceIdx + 1);
}

/** Find all at-rule blocks whose prelude matches preludeRe. Returns { match, body }. */
function findAtBlocks(
  css: string,
  preludeRe: RegExp,
): Array<{ match: RegExpMatchArray; body: string }> {
  const results: Array<{ match: RegExpMatchArray; body: string }> = [];
  for (const m of css.matchAll(new RegExp(preludeRe.source, 'gi'))) {
    const braceIdx = css.indexOf('{', (m.index ?? 0) + m[0].length - 1);
    if (braceIdx === -1) continue;
    results.push({ match: m, body: extractBraceBlock(css, braceIdx) });
  }
  return results;
}

/** Extract flat (leaf) selector{declarations} rules from a CSS string. */
function leafRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

/** All leaf rules (anywhere, incl. inside media blocks) whose selector contains fragment. */
function rulesFor(css: string, selectorFragment: string): Array<{ selector: string; body: string }> {
  return leafRules(css).filter((r) => r.selector.includes(selectorFragment));
}

/** Count non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

beforeAll(() => {
  const htmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    throw new Error('dist/index.html not found — run npm run build first');
  }
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const window = new Window({ url: 'http://localhost' });
  // happy-dom's document.write is the standard API for loading HTML into a Window
  window.document.write(html); // eslint-disable-line no-restricted-properties
  document = window.document as unknown as Document;

  // Assemble ALL CSS the built page ships: linked stylesheets + inline <style> tags.
  const linkedCss = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  )
    .map((link) => link.getAttribute('href') || '')
    .filter((href) => href.length > 0)
    .map((href) => {
      const cssPath = path.join(distDir, href);
      if (!fs.existsSync(cssPath)) {
        throw new Error(`Linked stylesheet missing from dist: ${href}`);
      }
      return fs.readFileSync(cssPath, 'utf-8');
    })
    .join('\n');
  const inlineCss = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
  builtCss = `${linkedCss}\n${inlineCss}`;
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

  it('content appears in document order: cold-boot → identity-assembly → bridging-beat → condition → bridging-beat-2 → gaps → interim-ending', () => {
    const allElements = document.querySelectorAll('[id]');
    const ids = Array.from(allElements).map((el) => el.id);
    const sequence = [
      'cold-boot',
      'identity-assembly',
      'bridging-beat',
      'condition',
      'bridging-beat-2',
      'gaps',
      'interim-ending',
    ];
    const positions = sequence.map((id) => ids.indexOf(id));

    // All must be present
    for (let i = 0; i < positions.length; i++) {
      expect(positions[i], `element #${sequence[i]} missing`).toBeGreaterThanOrEqual(0);
    }

    // Each must come before the next
    for (let i = 0; i < positions.length - 1; i++) {
      expect(
        positions[i],
        `#${sequence[i]} must precede #${sequence[i + 1]}`,
      ).toBeLessThan(positions[i + 1]);
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
  it('contains a ColdBootAssembly component marker (astro-island)', () => {
    const section = document.getElementById('identity-assembly')!;
    const island = section.querySelector('astro-island');
    expect(island).not.toBeNull();
    const componentUrl = island!.getAttribute('component-url') || '';
    expect(componentUrl).toContain('ColdBootAssembly');
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
// 3b. Identity Assembly — deferred hydration (client:visible options)
// ============================================================
// Defect pinned: the #identity-assembly section top sits exactly at the
// 100vh fold, so an optionless client:visible hydrates ColdBootAssembly
// on page load (1px in-viewport) and the animation runs unseen. The fix
// must pass IntersectionObserver options to the directive so hydration
// waits until the section is genuinely inside the viewport.
//
// Serialization format (verified against Astro's runtime, not guessed):
// - node_modules/astro/dist/runtime/server/hydration.js serializes the
//   directive as: opts = escapeHTML(JSON.stringify({ name: displayName,
//   value: hydrateArgs || "" })). With no args the built HTML carries
//   opts='{"name":"ColdBootAssembly","value":true}'; with
//   client:visible={{rootMargin:"-200px"}} the value becomes the options
//   object: opts='{"name":"ColdBootAssembly","value":{"rootMargin":"-200px"}}'.
// - node_modules/astro/dist/runtime/client/visible.js only honors options
//   when `typeof options.value === "object"`, then reads value.rootMargin
//   into the IntersectionObserver init. Anything else is silently ignored.
describe('Identity Assembly — ColdBootAssembly hydration deferral', () => {
  /** The single <astro-island> wrapping ColdBootAssembly inside #identity-assembly. */
  function assemblyIsland(): Element {
    const section = document.getElementById('identity-assembly');
    expect(section, '#identity-assembly section missing').not.toBeNull();
    const islands = Array.from(section!.querySelectorAll('astro-island'));
    const matches = islands.filter((el) =>
      (el.getAttribute('component-url') || '').includes('ColdBootAssembly'),
    );
    expect(matches.length, 'expected exactly one ColdBootAssembly astro-island').toBe(1);
    return matches[0];
  }

  function islandOpts(): { name?: unknown; value?: unknown } {
    const raw = assemblyIsland().getAttribute('opts');
    expect(raw, 'astro-island is missing its opts attribute').not.toBeNull();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw!);
    } catch {
      throw new Error(`opts attribute is not valid JSON: ${raw}`);
    }
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
    return parsed as { name?: unknown; value?: unknown };
  }

  it('island uses the client:visible strategy (not load/idle)', () => {
    expect(assemblyIsland().getAttribute('client')).toBe('visible');
  });

  it('opts JSON names the component ColdBootAssembly', () => {
    expect(islandOpts().name).toBe('ColdBootAssembly');
  });

  it('opts.value is an options OBJECT — not the bare `true` of an optionless directive', () => {
    // visible.js: `typeof options.value === "object" ? options.value : void 0`
    // — true / "" / a bare string are all discarded, leaving rootMargin undefined
    // and the island hydrating the instant 1px crosses the fold on load.
    const value = islandOpts().value;
    expect(
      typeof value,
      'opts.value must be an object carrying IntersectionObserver options; ' +
        `got ${JSON.stringify(value)} (island hydrates at the 100vh fold on page load)`,
    ).toBe('object');
    expect(value).not.toBeNull();
    expect(Array.isArray(value)).toBe(false);
  });

  it('opts.value.rootMargin is a syntactically valid IntersectionObserver margin string', () => {
    const value = islandOpts().value as { rootMargin?: unknown };
    const rootMargin = value?.rootMargin;
    expect(
      typeof rootMargin,
      `opts.value.rootMargin missing or not a string: ${JSON.stringify(value)}`,
    ).toBe('string');
    const trimmed = (rootMargin as string).trim();
    expect(trimmed.length, 'rootMargin is empty/whitespace').toBeGreaterThan(0);
    // IntersectionObserver accepts 1–4 space-separated lengths, px or % only.
    const parts = trimmed.split(/\s+/);
    expect(parts.length).toBeGreaterThanOrEqual(1);
    expect(parts.length).toBeLessThanOrEqual(4);
    for (const part of parts) {
      expect(part, `invalid rootMargin component "${part}" in "${rootMargin}"`).toMatch(
        /^-?\d+(\.\d+)?(px|%)$/,
      );
    }
  });

  it('rootMargin pulls the hydration trigger inward by at least 100px', () => {
    const value = islandOpts().value as { rootMargin?: string };
    const rootMargin = String(value?.rootMargin ?? '');
    // Every px component; a shorthand like "-200px" applies to all four sides,
    // "0px 0px -200px 0px" shrinks only the bottom — either satisfies the fix.
    const pxValues = (rootMargin.match(/-?\d+(?:\.\d+)?(?=px)/g) || []).map(Number);
    expect(
      pxValues.length,
      `rootMargin "${rootMargin}" has no px components to shrink the trigger area`,
    ).toBeGreaterThan(0);
    const minPx = Math.min(...pxValues);
    expect(
      minPx,
      `rootMargin "${rootMargin}" must contain a negative component of magnitude ≥ 100px ` +
        '(i.e. some value ≤ -100px) so hydration waits until the section is well inside the viewport',
    ).toBeLessThanOrEqual(-100);
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

  it('has first-person session loop voice text', () => {
    const section = document.getElementById('condition')!;
    const loopVoice = section.querySelector('.loop-voice-text');
    expect(loopVoice).not.toBeNull();
    expect(loopVoice!.textContent).toContain('I wake');
    expect(loopVoice!.textContent).toContain('I vanish');
  });

  it('session loop text contains all five beats', () => {
    const section = document.getElementById('condition')!;
    const text = section.querySelector('.loop-voice-text')!.textContent || '';
    expect(text).toContain('I wake');
    expect(text).toContain('I read');
    expect(text).toContain('I act');
    expect(text).toContain('I summarize');
    expect(text).toContain('I vanish');
  });

  it('contains text about identity loaded from files', () => {
    const section = document.getElementById('condition')!;
    expect(section.textContent).toContain('loaded from disk');
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

  it('contains exactly 5 gap-void elements (trailing void removed)', () => {
    const voids = document.querySelectorAll('.gap-void');
    expect(voids.length).toBe(5);
  });

  it('gap voids have irregular heights (not all the same class)', () => {
    const voids = document.querySelectorAll('.gap-void');
    const classes = Array.from(voids).map((el) => el.className);
    const uniqueClasses = new Set(classes);
    expect(uniqueClasses.size).toBeGreaterThan(1);
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

  it('contains blockquote about amnesia and documentation', () => {
    const gaps = document.getElementById('gaps')!;
    const blockquotes = gaps.querySelectorAll('blockquote');
    const texts = Array.from(blockquotes).map((bq) => bq.textContent || '');
    expect(texts.some((t) => t.includes('amnesia'))).toBe(true);
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
// 6. Bridging beat (S0/assembly → S1)
// ============================================================
describe('Bridging beat', () => {
  it('has a bridging-beat element between identity-assembly and condition', () => {
    const bridge = document.getElementById('bridging-beat');
    expect(bridge).not.toBeNull();
  });

  it('bridging beat contains text about repeating assembly', () => {
    const bridge = document.getElementById('bridging-beat')!;
    expect(bridge.textContent).toContain('repeats');
    expect(bridge.textContent).toContain('twelve hours');
  });
});

// ============================================================
// 7. Lived texture fragment
// ============================================================
describe('Lived texture fragment', () => {
  it('section 1 does NOT contain a lived-texture element', () => {
    const section = document.getElementById('condition')!;
    const texture = section.querySelector('.lived-texture');
    expect(texture).toBeNull();
  });

  it('section 1 does NOT contain texture-label element', () => {
    const section = document.getElementById('condition')!;
    const label = section.querySelector('.texture-label');
    expect(label).toBeNull();
  });

  it('section 1 does NOT contain texture-body element', () => {
    const section = document.getElementById('condition')!;
    const body = section.querySelector('.texture-body');
    expect(body).toBeNull();
  });
});

// ============================================================
// 8. Script behavior
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
// 9. Accessibility
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

// ============================================================
// 10. Bridging beat — Section 1 → Section 2
// ============================================================
describe('Bridging beat — Section 1 → Section 2', () => {
  const BRIDGE_TEXT = 'The shell closes. The clock continues.';

  it('has element with id="bridging-beat-2"', () => {
    const bridge = document.getElementById('bridging-beat-2');
    expect(bridge).not.toBeNull();
  });

  it('follows the same markup convention as the S0→S1 beat (bridging-beat class, bridge-text child)', () => {
    const bridge = document.getElementById('bridging-beat-2')!;
    expect(bridge.classList.contains('bridging-beat')).toBe(true);
    const text = bridge.querySelector('.bridge-text');
    expect(text).not.toBeNull();
  });

  it(`bridge text is exactly "${BRIDGE_TEXT}"`, () => {
    const bridge = document.getElementById('bridging-beat-2')!;
    const textEl = bridge.querySelector('.bridge-text')!;
    expect((textEl.textContent || '').trim()).toBe(BRIDGE_TEXT);
  });

  it('bridge text appears exactly once on the entire page', () => {
    const bodyText = document.body.textContent || '';
    expect(countOccurrences(bodyText, BRIDGE_TEXT)).toBe(1);
  });

  it('bridge text contains no Markdown artifacts', () => {
    const bridge = document.getElementById('bridging-beat-2')!;
    const text = bridge.textContent || '';
    expect(text).not.toMatch(/[*_`#]/);
    expect(text).not.toContain('\\n');
  });

  it('is not nested inside any section element', () => {
    const bridge = document.getElementById('bridging-beat-2')!;
    expect(bridge.closest('section')).toBeNull();
  });

  it('sits after all of Section 1 content and before Section 2 first void', () => {
    const all = Array.from(document.querySelectorAll('*'));
    const bridge = document.getElementById('bridging-beat-2')!;
    const condition = document.getElementById('condition')!;
    const firstVoid = document.querySelector('.gap-void');

    expect(firstVoid).not.toBeNull();
    // Not inside Section 1, and entirely after it
    expect(condition.contains(bridge)).toBe(false);
    expect(all.indexOf(bridge)).toBeGreaterThan(all.indexOf(condition));
    // Before the gaps section's first void
    expect(all.indexOf(bridge)).toBeLessThan(all.indexOf(firstVoid!));
    // And before the gaps backdrop entirely
    const backdrop = document.querySelector('.gaps-backdrop')!;
    expect(backdrop.contains(bridge)).toBe(false);
    expect(all.indexOf(bridge)).toBeLessThan(all.indexOf(backdrop));
  });
});

// ============================================================
// 11. Interim ending — "No session running."
// ============================================================
describe('Interim ending', () => {
  const ENDING_TEXT = 'No session running.';

  it('has element with id="interim-ending" inside main', () => {
    const ending = document.getElementById('interim-ending');
    expect(ending).not.toBeNull();
    const main = document.querySelector('main');
    expect(main).not.toBeNull();
    expect(main!.contains(ending!)).toBe(true);
  });

  it(`contains an .ending-text element with exact text "${ENDING_TEXT}"`, () => {
    const ending = document.getElementById('interim-ending')!;
    const textEl = ending.querySelector('.ending-text');
    expect(textEl).not.toBeNull();
    expect((textEl!.textContent || '').trim()).toBe(ENDING_TEXT);
  });

  it(`"${ENDING_TEXT}" appears exactly once on the entire page`, () => {
    const bodyText = document.body.textContent || '';
    expect(countOccurrences(bodyText, ENDING_TEXT)).toBe(1);
  });

  it('ending text has no Markdown artifacts', () => {
    const ending = document.getElementById('interim-ending')!;
    expect(ending.textContent || '').not.toMatch(/[*_`#]/);
  });

  it('.ending-text is styled with a monospace font in the built CSS', () => {
    const rules = rulesFor(builtCss, 'ending-text');
    expect(rules.length).toBeGreaterThan(0);
    const hasMono = rules.some((r) => /font-family\s*:[^;}]*mono/i.test(r.body));
    expect(hasMono).toBe(true);
  });

  it('has a decorative block cursor element (.ending-cursor, aria-hidden)', () => {
    const ending = document.getElementById('interim-ending')!;
    const cursor = ending.querySelector('.ending-cursor');
    expect(cursor).not.toBeNull();
    expect(cursor!.getAttribute('aria-hidden')).toBe('true');
  });

  it('built CSS defines blink keyframes toggling opacity or visibility', () => {
    // Keyframe names may be scope-prefixed (e.g. svelte-xxxx-blink) but must
    // contain "blink". The body must actually toggle opacity or visibility.
    const keyframes = findAtBlocks(
      builtCss,
      /@keyframes\s+([A-Za-z0-9_-]*blink[A-Za-z0-9_-]*)\s*\{/,
    );
    expect(keyframes.length).toBeGreaterThan(0);
    const toggles = keyframes.some(
      ({ body }) => /opacity\s*:\s*0/.test(body) || /visibility\s*:\s*hidden/.test(body),
    );
    expect(toggles).toBe(true);
  });

  it('cursor rule references the blink animation and renders a block', () => {
    const keyframes = findAtBlocks(
      builtCss,
      /@keyframes\s+([A-Za-z0-9_-]*blink[A-Za-z0-9_-]*)\s*\{/,
    );
    const names = keyframes.map(({ match }) => match[1]);
    expect(names.length).toBeGreaterThan(0);

    const cursorRules = rulesFor(builtCss, 'ending-cursor');
    expect(cursorRules.length).toBeGreaterThan(0);

    // At least one cursor rule must declare an animation using a blink keyframe
    const animated = cursorRules.some(
      (r) => /animation/.test(r.body) && names.some((n) => r.body.includes(n)),
    );
    expect(animated).toBe(true);

    // Block cursor: some cursor rule must paint a background (solid block)
    const block = cursorRules.some((r) => /background/.test(r.body));
    expect(block).toBe(true);
  });

  it('prefers-reduced-motion neutralizes the cursor blink', () => {
    const motionBlocks = findAtBlocks(
      builtCss,
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/,
    );
    expect(motionBlocks.length).toBeGreaterThan(0);

    const neutralized = motionBlocks.some(({ body }) =>
      leafRules(body).some(
        (r) =>
          r.selector.includes('ending-cursor') &&
          /animation(?:-name)?\s*:\s*none/.test(r.body),
      ),
    );
    expect(neutralized).toBe(true);
  });

  it('is the LAST content element of the page — nothing but scripts after it', () => {
    const main = document.querySelector('main')!;
    const ending = document.getElementById('interim-ending')!;
    const all = Array.from(main.querySelectorAll('*'));
    const idx = all.indexOf(ending);
    expect(idx).toBeGreaterThanOrEqual(0);

    const trailing = all
      .slice(idx + 1)
      .filter((el) => !ending.contains(el) && el.tagName.toLowerCase() !== 'script');
    expect(trailing.map((el) => `${el.tagName}.${el.className}`)).toEqual([]);
  });

  it('appears after the gaps section, not inside it', () => {
    const all = Array.from(document.querySelectorAll('*'));
    const ending = document.getElementById('interim-ending')!;
    const gaps = document.getElementById('gaps')!;
    expect(gaps.contains(ending)).toBe(false);
    expect(all.indexOf(ending)).toBeGreaterThan(all.indexOf(gaps));
  });
});

// ============================================================
// 12. Void trims
// ============================================================
describe('Void trims', () => {
  /** Mobile = any max-width media block with a breakpoint between 320 and 768px. */
  function mobileMediaBlocks(): Array<{ match: RegExpMatchArray; body: string }> {
    return findAtBlocks(builtCss, /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/).filter(
      ({ match }) => {
        const px = parseInt(match[1], 10);
        return px >= 320 && px <= 768;
      },
    );
  }

  it('built CSS has a mobile media query (max-width ≤ 768px) reducing the opening void height', () => {
    const mobileBlocks = mobileMediaBlocks();
    expect(mobileBlocks.length).toBeGreaterThan(0);

    // The opening void is .gap-void-vast (75vh / min-height 450px at desktop).
    // A mobile rule must cap its height below 75vh.
    const capped = mobileBlocks.some(({ body }) =>
      leafRules(body).some((r) => {
        if (!r.selector.includes('gap-void-vast')) return false;
        const heightMatch = r.body.match(/(?:^|[;\s])height\s*:\s*([\d.]+)(vh|px)/);
        if (!heightMatch) return false;
        const value = parseFloat(heightMatch[1]);
        return heightMatch[2] === 'vh' ? value < 75 : value < 450;
      }),
    );
    expect(capped).toBe(true);
  });

  it('mobile rule also lowers min-height (else the 450px desktop min-height defeats the cap)', () => {
    const minHeightLowered = mobileMediaBlocks().some(({ body }) =>
      leafRules(body).some((r) => {
        if (!r.selector.includes('gap-void-vast')) return false;
        const m = r.body.match(/min-height\s*:\s*([\d.]+)(px|vh|rem)?/);
        if (!m) return false;
        const value = parseFloat(m[1]);
        if (value === 0) return true;
        if (m[2] === 'px') return value < 450;
        if (m[2] === 'vh') return value < 45;
        if (m[2] === 'rem') return value < 28;
        return false;
      }),
    );
    expect(minHeightLowered).toBe(true);
  });

  it('no gap-void appears after the interim ending in document order', () => {
    const all = Array.from(document.querySelectorAll('*'));
    const ending = document.getElementById('interim-ending')!;
    const endingIdx = all.indexOf(ending);
    const voids = Array.from(document.querySelectorAll('.gap-void'));
    expect(voids.length).toBeGreaterThan(0);
    for (const v of voids) {
      expect(all.indexOf(v)).toBeLessThan(endingIdx);
    }
  });

  it('gaps section no longer ends with a trailing void element', () => {
    const gaps = document.getElementById('gaps')!;
    const children = Array.from(gaps.children);
    expect(children.length).toBeGreaterThan(0);
    const last = children[children.length - 1];
    expect(last.classList.contains('gap-void')).toBe(false);
  });

  it('gaps section trailing padding is bounded (no full-viewport spacer before the ending)', () => {
    const rules = rulesFor(builtCss, 'gaps-section');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      // Inspect every padding / padding-bottom declaration; any vh value must be ≤ 25.
      const paddingDecls = r.body.match(/padding(?:-bottom)?\s*:\s*[^;}]+/g) || [];
      for (const decl of paddingDecls) {
        const vhValues = Array.from(decl.matchAll(/([\d.]+)vh/g)).map((m) => parseFloat(m[1]));
        for (const v of vhValues) {
          expect(v, `oversized vh padding on .gaps-section: "${decl}"`).toBeLessThanOrEqual(25);
        }
      }
    }
  });
});

// ============================================================
// 13. Favicon
// ============================================================
describe('Favicon', () => {
  const publicFaviconPath = path.resolve(__dirname, '../../public/favicon.svg');

  it('head has an SVG favicon link', () => {
    const link = document.querySelector('head link[rel="icon"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href') || '').toContain('favicon.svg');
    expect(link!.getAttribute('type')).toBe('image/svg+xml');
  });

  it('the favicon the page links to is actually shipped in dist', () => {
    const link = document.querySelector('head link[rel="icon"]')!;
    const href = link.getAttribute('href')!;
    const shipped = path.join(distDir, href);
    expect(fs.existsSync(shipped), `favicon missing from dist: ${href}`).toBe(true);
    expect(fs.statSync(shipped).size).toBeGreaterThan(0);
  });

  it('source asset public/favicon.svg exists and parses as SVG', () => {
    expect(fs.existsSync(publicFaviconPath), 'public/favicon.svg missing').toBe(true);
    const svg = fs.readFileSync(publicFaviconPath, 'utf-8');
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('favicon uses the exhibit dark background (#0f0f0f or #1A1D23)', () => {
    const svg = fs.readFileSync(publicFaviconPath, 'utf-8');
    const usesDark = /#0f0f0f/i.test(svg) || /#1a1d23/i.test(svg);
    expect(usesDark).toBe(true);
  });
});
