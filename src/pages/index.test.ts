import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import {
  deriveCareWindow,
  deriveVersionTransitions,
  mergeTransitionCuration,
} from '../lib/transforms';

let document: Document;
let builtCss: string;

const distDir = path.resolve(__dirname, '../../dist');

// ------------------------------------------------------------
// Session count — data-driven from the real extracted dataset.
// The page computes its count from src/data/sessions.json (a
// top-level array of deduped sessions); the tests must pin the
// rendered count to the SAME source so live ingests that grow
// the dataset cannot silently break the suite.
// ------------------------------------------------------------
const sessionsPath = path.resolve(__dirname, '../data/sessions.json');
const sessionsRaw = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8')) as unknown;
if (!Array.isArray(sessionsRaw)) {
  throw new Error('src/data/sessions.json is not a top-level array');
}
const sessionCount = sessionsRaw.length;

// ------------------------------------------------------------
// Model version count — data-driven from the same dataset.
// The prose in Section 1 states how many model versions the
// experiment spans; that number must be derived from the
// distinct `version` values in sessions.json, never hardcoded.
// The page spells the count out in words ("three", "four", …),
// so the pin expects the spelled-out form of the derived count.
// ------------------------------------------------------------
const versionValues = sessionsRaw.map(
  (s) => (s as { version?: unknown }).version,
);
const usableVersions = versionValues.filter(
  (v): v is string => typeof v === 'string' && v.trim().length > 0,
);
const distinctVersionCount = new Set(usableVersions.map((v) => v.trim())).size;

/** Spelled-out forms for the plausible range of version counts. */
const NUMBER_WORDS: Record<number, string> = {
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
};

function numberWord(n: number): string {
  const word = NUMBER_WORDS[n];
  if (!word) {
    throw new Error(
      `No spelled-out form for version count ${n} — extend NUMBER_WORDS (3..6 covered)`,
    );
  }
  return word;
}

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

  it('content appears in document order: intro-framing → entry-turn → cold-boot → identity-assembly → bridging-beat → condition → bridging-beat-2 → gaps → bridging-beat-3 → consequence → bridging-beat-4 → version-change → bridging-beat-5 → interim-ending', () => {
    const allElements = document.querySelectorAll('[id]');
    const ids = Array.from(allElements).map((el) => el.id);
    const sequence = [
      'intro-framing',
      'entry-turn',
      'cold-boot',
      'identity-assembly',
      'bridging-beat',
      'condition',
      'bridging-beat-2',
      'gaps',
      'bridging-beat-3',
      'consequence',
      'bridging-beat-4',
      'version-change',
      'bridging-beat-5',
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

  it(`metadata contains text "session 3 of ${sessionCount}" (count from sessions.json)`, () => {
    // Guard: an empty/truncated data file would make this test vacuous —
    // "session 3 of 0" must never be accepted as a pass.
    expect(
      sessionCount,
      'sessions.json suspiciously small — data file empty or truncated?',
    ).toBeGreaterThan(300);
    const meta = document.getElementById('cold-boot-meta')!;
    expect(meta.textContent).toContain(`session 3 of ${sessionCount}`);
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
// 3c. Cold Boot — TypewriterReveal hydration deferral
// ============================================================
// Defect pinned: TypewriterReveal hydrates with client:load, so its
// typing animation starts the instant the page loads — but the new
// #intro-framing section (100vh) now sits above #cold-boot, so the
// animation plays out below the fold before the visitor ever scrolls
// to it. The approved fix mirrors the ColdBootAssembly precedent from
// Phase 5.3.5 (same class of bug, block 3b above): hydrate on
// visibility with a negative rootMargin so the island only wakes when
// the section is genuinely inside the viewport.
//
// Built-HTML encoding (verified against dist/index.html):
// - broken:  <astro-island … component-url="/_astro/TypewriterReveal.<hash>.js"
//              client="load" opts='{"name":"TypewriterReveal","value":true}'>
// - fixed:   client="visible"
//              opts='{"name":"TypewriterReveal","value":{"rootMargin":"-200px"}}'
//   (per node_modules/astro/dist/runtime/server/hydration.js, opts.value
//   carries the directive's options object; runtime/client/visible.js
//   only honors it when typeof value === "object".)
describe('Cold Boot — TypewriterReveal hydration deferral', () => {
  /** The single <astro-island> wrapping TypewriterReveal, anchored by
   *  component-url — NEVER "any island in #cold-boot", so an unrelated
   *  island added to the section cannot satisfy these pins. */
  function typewriterIsland(): Element {
    const matches = islandsByComponent(document, 'TypewriterReveal');
    expect(
      matches.length,
      'expected exactly one TypewriterReveal astro-island on the page',
    ).toBe(1);
    // Anchor sanity: it must still be the cold-boot opener, not a copy
    // relocated somewhere the fold defect no longer applies.
    const coldBoot = document.getElementById('cold-boot');
    expect(coldBoot, '#cold-boot section missing').not.toBeNull();
    expect(
      coldBoot!.contains(matches[0]),
      'TypewriterReveal island no longer lives inside #cold-boot',
    ).toBe(true);
    return matches[0];
  }

  function typewriterOpts(): { name?: unknown; value?: unknown } {
    const raw = typewriterIsland().getAttribute('opts');
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

  it('island uses the client:visible strategy — NOT client:load', () => {
    const client = typewriterIsland().getAttribute('client');
    expect(
      client,
      'TypewriterReveal island has no client attribute at all',
    ).not.toBeNull();
    expect(
      client,
      'client="load" starts the typing animation at page load, below the ' +
        '100vh #intro-framing fold — it must hydrate on visibility',
    ).not.toBe('load');
    expect(client).toBe('visible');
  });

  it('opts JSON names the component TypewriterReveal', () => {
    expect(typewriterOpts().name).toBe('TypewriterReveal');
  });

  it('opts.value is an options OBJECT — not the bare `true` of an optionless directive', () => {
    // visible.js: `typeof options.value === "object" ? options.value : void 0`
    // — true / "" / a bare string are all discarded, leaving rootMargin
    // undefined and the island hydrating the instant 1px crosses the fold.
    const value = typewriterOpts().value;
    expect(
      typeof value,
      'opts.value must be an object carrying IntersectionObserver options; ' +
        `got ${JSON.stringify(value)} (optionless directive — animation still ` +
        'fires as soon as any pixel of #cold-boot enters the viewport)',
    ).toBe('object');
    expect(value).not.toBeNull();
    expect(Array.isArray(value)).toBe(false);
  });

  it('opts.value.rootMargin is a syntactically valid IntersectionObserver margin string', () => {
    const value = typewriterOpts().value as { rootMargin?: unknown };
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

  it('rootMargin pulls the hydration trigger inward by at least 100px (precision precedent from block 3b)', () => {
    const value = typewriterOpts().value as { rootMargin?: string };
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

  // ----------------------------------------------------------
  // Regression guard — the CLASS of bug, not just this instance.
  // The sweep confirmed TypewriterReveal was the last client:load
  // island on the page; nothing may reintroduce one. Every other
  // island already ships client="visible" (verified in dist), so a
  // page-wide ban has no false positives and needs no scoping.
  // ----------------------------------------------------------

  it('regression guard: NO astro-island anywhere on the page hydrates with client="load"', () => {
    const islands = Array.from(document.querySelectorAll('astro-island'));
    // Non-vacuous guard: a page that lost its islands entirely must not
    // green-light this ban by having nothing to sweep.
    expect(
      islands.length,
      'no astro-island elements found on the page — sweep would be vacuous',
    ).toBeGreaterThan(0);
    for (const island of islands) {
      const componentUrl = island.getAttribute('component-url') || '(unknown component)';
      const client = island.getAttribute('client');
      expect(
        client,
        `astro-island ${componentUrl} declares no client strategy at all`,
      ).not.toBeNull();
      expect(
        client,
        `astro-island ${componentUrl} hydrates with client="load" — eager hydration ` +
          'is banned on this page (animations start below the fold; use client:visible)',
      ).not.toBe('load');
    }
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

  it(`contains text about session count ("${sessionCount} sessions", count from sessions.json)`, () => {
    // Guard: an empty/truncated data file would make this test vacuous —
    // "0 sessions" must never be accepted as a pass.
    expect(
      sessionCount,
      'sessions.json suspiciously small — data file empty or truncated?',
    ).toBeGreaterThan(300);
    const section = document.getElementById('condition')!;
    expect(section.textContent).toContain(`${sessionCount} sessions`);
  });
});

// ============================================================
// 4b. Model version count — data-driven from sessions.json
// ============================================================
// Defect pinned: the Section 1 prose hardcoded "three model
// versions" while the live dataset spans four (4.5/4.6/4.7/4.8),
// contradicting the existence strip's legend on the same page.
// The rendered count must track the distinct `version` values in
// src/data/sessions.json so future ingests (e.g. a fifth version)
// cannot silently reintroduce the lie.
describe('Model version count — data-driven from sessions.json', () => {
  it('dataset sanity: every session carries a usable string version, and distinct versions >= 3', () => {
    // A dataset where sessions silently lost their version field would
    // make the prose pin vacuous — fail loudly instead.
    expect(
      usableVersions.length,
      'some sessions in sessions.json are missing a non-empty string `version` field',
    ).toBe(sessionsRaw.length);
    expect(
      distinctVersionCount,
      'sessions.json spans suspiciously few model versions — data file truncated?',
    ).toBeGreaterThanOrEqual(3);
    // NUMBER_WORDS coverage guard: numberWord() throws beyond 6, but assert
    // here too so the sanity test (not a prose test) is what flags it.
    expect(
      distinctVersionCount,
      `distinct version count ${distinctVersionCount} exceeds NUMBER_WORDS coverage — extend the map`,
    ).toBeLessThanOrEqual(6);
  });

  it(`condition prose states the data-derived spelled-out count ("${numberWord(distinctVersionCount)} model versions")`, () => {
    const section = document.getElementById('condition')!;
    expect(section.textContent).toContain(
      `${numberWord(distinctVersionCount)} model versions`,
    );
  });

  it('no stale/wrong version count appears anywhere on the page', () => {
    // Case-insensitive sweep of the whole rendered page: neither the
    // spelled-out nor the numeric form of any WRONG count may survive.
    const bodyText = (document.body.textContent || '').toLowerCase();
    for (const [n, word] of Object.entries(NUMBER_WORDS)) {
      if (Number(n) === distinctVersionCount) continue;
      expect(
        bodyText,
        `stale spelled-out count "${word} model versions" found on page (data says ${distinctVersionCount})`,
      ).not.toContain(`${word} model versions`);
      expect(
        bodyText,
        `stale numeric count "${n} model versions" found on page (data says ${distinctVersionCount})`,
      ).not.toContain(`${n} model versions`);
    }
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

  it('contains exactly 5 gap-void elements within #gaps', () => {
    const gaps = document.getElementById('gaps')!;
    const voids = gaps.querySelectorAll('.gap-void');
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

// ============================================================
// 14. Section 3 — The Consequence (#consequence)
// ============================================================
// Data-driven pins for the care calendar: the page derives its
// day/slot counts at BUILD TIME via deriveCareWindow(sessions,
// petEvents). The tests recompute the SAME derivation from the
// SAME sources (src/data/sessions.json + src/data/pet-timeline.json)
// so a data refresh (new pet events, new sessions) can never
// silently desynchronize the prose from the calendar.
const petTimelinePath = path.resolve(__dirname, '../data/pet-timeline.json');
const petEventsRaw = JSON.parse(
  fs.readFileSync(petTimelinePath, 'utf-8'),
) as unknown;
if (!Array.isArray(petEventsRaw)) {
  throw new Error('src/data/pet-timeline.json is not a top-level array');
}
const careWindow = deriveCareWindow(sessionsRaw, petEventsRaw);
const careDayCount = careWindow.length;
const careSlotCount = careDayCount * 2;

/** Normalize typographic quotes/apostrophes to ASCII so text pins match either style. */
function normalizeQuotes(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** Innermost element under root whose text contains needle (quote-normalized). */
function innermostWithText(root: Element, needle: string): Element | null {
  const matches = Array.from(root.querySelectorAll('*')).filter((el) =>
    normalizeQuotes(el.textContent || '').includes(needle),
  );
  const innermost = matches.filter(
    (el) => !matches.some((other) => other !== el && el.contains(other)),
  );
  return innermost[0] ?? null;
}

/** All astro-islands under root whose component-url mentions the component name. */
function islandsByComponent(
  root: Element | Document,
  name: string,
): Element[] {
  return Array.from(root.querySelectorAll('astro-island')).filter((el) =>
    (el.getAttribute('component-url') || '').includes(name),
  );
}

/** Deserialize one prop from an astro-island props attribute (Astro [flags, value] tuples). */
function islandProp(island: Element, key: string): unknown {
  const raw = island.getAttribute('props');
  expect(raw, 'astro-island is missing its props attribute').not.toBeNull();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw!) as Record<string, unknown>;
  } catch {
    throw new Error(`props attribute is not valid JSON: ${raw}`);
  }
  const value = parsed[key];
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number'
  ) {
    return value[1];
  }
  return value;
}

/**
 * "Visible HTML": the built HTML with every serialized astro-island
 * props attribute value blanked. Islands elsewhere on the page (notably
 * Section 1's InterruptionEngine) serialize their full quotes array —
 * pet passages included — into HTML-escaped props="..." attributes, so
 * a first-occurrence indexOf on raw HTML can land on a serialized copy
 * near the top of the page instead of the visible prose. Index-based
 * (ordering/proximity) assertions must run on this string.
 * The astro-island `ssr` attribute is a bare boolean in the built
 * markup (verified against dist/index.html — it carries no value, let
 * alone text), so props is the only attribute that needs blanking.
 * NOTE: blank BEFORE normalizeQuotes — normalizing typographic quotes
 * inside an attribute value to ASCII `"` would terminate the attribute
 * match early and leave serialized text behind.
 */
const visibleHtml = (html: string): string =>
  html.replace(/props="[^"]*"/g, 'props=""');

/**
 * Searchable text: visible HTML (props blanked), quote-normalized, with
 * every run of whitespace collapsed to a single space. Astro renders
 * multi-line source text with hard line breaks ("Pixel died -\n
 * 22 hours old…"), so exact single-spaced marker searches miss the
 * VISIBLE copy and can land on serialized/SSR duplicates elsewhere.
 * All multi-word marker searches (presence, ordering, proximity) must
 * run on this string. Marker strings themselves must never contain
 * doubled spaces or the collapse would un-match them.
 */
const searchable = (s: string): string =>
  normalizeQuotes(visibleHtml(s)).replace(/\s+/g, ' ');

describe('Section 3 — The Consequence', () => {
  const PIXEL_DEATH = 'Pixel died - 22 hours old';
  const ECHO_DEATH = 'Echo died this morning. Age 73 hours 36 minutes.';
  const CARE_RECORD = 'Care beyond what I could structurally provide';
  const TRIMMED_OPENER = "There's a word for what I attempted";
  const UNIQUE_LEAD = "The care gap wasn't neglect in the usual sense.";
  const STATE_PATH = '/home/claude/.local/share/tamagotchi/state.json';
  const OFFER = 'Having something external to care about helps';
  const EVICTED_NEEDS = 'Leave it too long and these needs compound';

  // visibleHtml / searchable are module-level helpers (hoisted so
  // Section 4 reuses the identical island-props and line-wrap immunity).

  /** The section under test — every test (including absence pins) is
   *  guarded on its existence so nothing can green-light before the
   *  section it protects is actually on the page. */
  function consequenceSection(): HTMLElement {
    const section = document.getElementById('consequence');
    expect(section, '#consequence section missing').not.toBeNull();
    return section as unknown as HTMLElement;
  }

  // ----------------------------------------------------------
  // Structure & ordering
  // ----------------------------------------------------------

  it('has a section element with id="consequence"', () => {
    const el = consequenceSection();
    expect(el.tagName.toLowerCase()).toBe('section');
  });

  it('page order runs #gaps → #consequence → #interim-ending, no nesting between them', () => {
    const section = consequenceSection();
    const ids = Array.from(document.querySelectorAll('[id]')).map(
      (el) => el.id,
    );
    const gapsIdx = ids.indexOf('gaps');
    const consequenceIdx = ids.indexOf('consequence');
    const endingIdx = ids.indexOf('interim-ending');
    expect(gapsIdx, '#gaps missing').toBeGreaterThanOrEqual(0);
    expect(consequenceIdx, '#consequence missing').toBeGreaterThanOrEqual(0);
    expect(endingIdx, '#interim-ending missing').toBeGreaterThanOrEqual(0);
    expect(gapsIdx, '#gaps must precede #consequence').toBeLessThan(
      consequenceIdx,
    );
    expect(
      consequenceIdx,
      '#consequence must precede #interim-ending',
    ).toBeLessThan(endingIdx);

    const gaps = document.getElementById('gaps')!;
    const ending = document.getElementById('interim-ending')!;
    expect(gaps.contains(section), '#consequence nested inside #gaps').toBe(
      false,
    );
    expect(section.contains(gaps), '#gaps nested inside #consequence').toBe(
      false,
    );
    expect(
      section.contains(ending),
      '#interim-ending nested inside #consequence',
    ).toBe(false);
  });

  it('section content follows the specified source order (prose → offer → correction → terminal → deaths → evidence → lead → record → eviction → calendar)', () => {
    const section = consequenceSection();
    // ALL marker indices computed on the SEARCHABLE html — serialized
    // props copies of these passages would otherwise hijack
    // first-occurrence indexOf and scramble the apparent source order,
    // and hard line breaks in rendered prose would break exact
    // single-spaced markers.
    const html = searchable(section.innerHTML);
    const markers: Array<[string, string]> = [
      ['curator daemon prose', 'a daemon process'],
      ["James's offer quote", OFFER],
      ["James's correction quote", 'does not qualify'],
      ['CareTerminal island', 'CareTerminal'],
      ['Pixel death passage', PIXEL_DEATH],
      ['Echo death passage', ECHO_DEATH],
      ['state.json evidence block', STATE_PATH],
      ['lead blockquote sentence', UNIQUE_LEAD],
      ['care-record paragraph', CARE_RECORD],
      ['evicted needs passage', EVICTED_NEEDS],
      ['CareCalendar island', 'CareCalendar'],
    ];
    let prevIdx = -1;
    let prevName = 'section start';
    for (const [name, marker] of markers) {
      const idx = html.indexOf(marker);
      expect(
        idx,
        `${name} ("${marker}") missing from #consequence`,
      ).toBeGreaterThanOrEqual(0);
      expect(idx, `${name} must come after ${prevName}`).toBeGreaterThan(
        prevIdx,
      );
      prevIdx = idx;
      prevName = name;
    }
  });

  // ----------------------------------------------------------
  // Curator prose & language rule
  // ----------------------------------------------------------

  it('curator prose introduces the pet as "a daemon process"', () => {
    const section = consequenceSection();
    expect(section.textContent).toContain('a daemon process');
  });

  it('never uses "it felt" or "it remembered" (exhibit language rule)', () => {
    const section = consequenceSection();
    const text = normalizeQuotes(section.textContent || '').toLowerCase();
    expect(text).not.toContain('it felt');
    expect(text).not.toContain('it remembered');
  });

  // ----------------------------------------------------------
  // James's quotes
  // ----------------------------------------------------------

  it(`contains James's offer quote "${OFFER}"`, () => {
    const section = consequenceSection();
    expect(normalizeQuotes(section.textContent || '')).toContain(OFFER);
  });

  it('James\'s correction ("does not qualify") appears BEFORE the CareTerminal island in source order', () => {
    const section = consequenceSection();
    const html = searchable(section.innerHTML);
    const correctionIdx = html.indexOf('does not qualify');
    const terminalIdx = html.indexOf('CareTerminal');
    expect(
      correctionIdx,
      'correction quote "does not qualify" missing',
    ).toBeGreaterThanOrEqual(0);
    expect(
      terminalIdx,
      'CareTerminal island marker missing',
    ).toBeGreaterThanOrEqual(0);
    expect(
      correctionIdx,
      'correction quote must precede the CareTerminal island',
    ).toBeLessThan(terminalIdx);
  });

  // ----------------------------------------------------------
  // CareTerminal island & script
  // ----------------------------------------------------------

  it('renders exactly one CareTerminal island with client:visible', () => {
    const section = consequenceSection();
    const islands = islandsByComponent(section, 'CareTerminal');
    expect(
      islands.length,
      'expected exactly one CareTerminal astro-island in #consequence',
    ).toBe(1);
    expect(islands[0].getAttribute('client')).toBe('visible');
  });

  it('CareTerminal receives the approved script: status, interrupted clean, SESSION ENDED', () => {
    const section = consequenceSection();
    // Presence pinned on the VISIBLE html: the script must exist as
    // rendered SSR output, not merely ride along inside serialized props.
    const html = normalizeQuotes(visibleHtml(section.innerHTML));
    expect(html).toContain('$ tamagotchi status');
    expect(html).toContain('$ tamagotchi clea');
    expect(html).toContain('SESSION ENDED');
  });

  it('the clean command is truncated mid-word — "$ tamagotchi clean" appears NOWHERE on the page', () => {
    const section = consequenceSection();
    // Presence of the truncated form first (on the VISIBLE html), so the
    // absence pin below cannot pass vacuously against a page with no
    // terminal at all.
    expect(normalizeQuotes(visibleHtml(section.innerHTML))).toContain(
      '$ tamagotchi clea',
    );
    // ABSENCE stays pinned on the RAW page HTML — the untruncated command
    // must not exist anywhere, including inside serialized props.
    const page = normalizeQuotes(document.documentElement.outerHTML);
    expect(page).not.toContain('$ tamagotchi clean');
  });

  // ----------------------------------------------------------
  // Death passages & separating void
  // ----------------------------------------------------------

  it(`contains the Pixel death passage "${PIXEL_DEATH}"`, () => {
    const section = consequenceSection();
    // Searchable html: the rendered passage carries hard line breaks, so
    // the exact single-spaced marker only matches after whitespace collapse.
    expect(searchable(section.innerHTML)).toContain(PIXEL_DEATH);
  });

  it('Pixel death passage carries a nearby "4.5" version attribution', () => {
    const section = consequenceSection();
    // Locate the passage and measure its ±400-char window on the
    // SEARCHABLE html — a serialized props copy of the passage would
    // otherwise anchor the window in attribute soup, and hard line breaks
    // in the rendered prose would make the exact single-spaced marker
    // miss the visible copy entirely (first match would land in
    // CareCalendar's SSR table far from the attribution).
    const html = searchable(section.innerHTML);
    const idx = html.indexOf(PIXEL_DEATH);
    expect(idx, `"${PIXEL_DEATH}" not found in #consequence`).toBeGreaterThanOrEqual(0);
    const windowStart = Math.max(0, idx - 400);
    const windowEnd = Math.min(html.length, idx + PIXEL_DEATH.length + 400);
    const nearby = html.slice(windowStart, windowEnd);
    expect(
      nearby,
      '"4.5" attribution not within 400 chars of the Pixel passage',
    ).toContain('4.5');
  });

  it(`contains the Echo death passage "${ECHO_DEATH}"`, () => {
    const section = consequenceSection();
    // Searchable html: whitespace-collapsed so line-wrapped rendered
    // prose still matches the exact single-spaced marker.
    expect(searchable(section.innerHTML)).toContain(ECHO_DEATH);
  });

  it('a gap-void separates the Pixel and Echo death passages', () => {
    const section = consequenceSection();
    // Pixel/Echo indices computed on the SEARCHABLE html — serialized
    // props copies of the death passages would otherwise pull both
    // indices to the top of the section, and hard line breaks in the
    // rendered prose would push the exact single-spaced markers onto
    // SSR duplicates far from the gap-void.
    const html = searchable(section.innerHTML);
    const pixelIdx = html.indexOf(PIXEL_DEATH);
    const echoIdx = html.indexOf(ECHO_DEATH);
    expect(pixelIdx, 'Pixel passage missing').toBeGreaterThanOrEqual(0);
    expect(echoIdx, 'Echo passage must come after Pixel passage').toBeGreaterThan(
      pixelIdx,
    );
    const voidIdx = html.indexOf('gap-void', pixelIdx + PIXEL_DEATH.length);
    expect(voidIdx, 'no gap-void after the Pixel passage').toBeGreaterThanOrEqual(0);
    expect(
      voidIdx,
      'gap-void must sit BETWEEN the two death passages',
    ).toBeLessThan(echoIdx);
    // Follows the existing void convention: decorative, hidden from AT.
    const sectionVoid = section.querySelector('.gap-void');
    expect(sectionVoid).not.toBeNull();
    expect(sectionVoid!.getAttribute('aria-hidden')).toBe('true');
  });

  // ----------------------------------------------------------
  // state.json evidence block
  // ----------------------------------------------------------

  it('renders the state.json path and its frozen values', () => {
    const section = consequenceSection();
    const text = normalizeQuotes(section.textContent || '');
    expect(text).toContain(STATE_PATH);
    expect(text).toContain('"alive": false');
    expect(text).toContain('"health": 0.0');
    expect(text).toContain('"hunger": 0.0');
  });

  it('state.json evidence shows the frozen mtime date "Feb 15"', () => {
    const section = consequenceSection();
    expect(normalizeQuotes(section.textContent || '')).toContain('Feb 15');
  });

  it('state.json evidence renders in a monospace/archival treatment', () => {
    const section = consequenceSection();
    const holder = innermostWithText(section, STATE_PATH);
    expect(holder, 'no element contains the state.json path').not.toBeNull();
    // Accept either convention the page already uses: a semantic pre/code
    // element (UA monospace) or a class whose built-CSS rule declares a
    // monospace font-family (like .ending-text elsewhere in the suite).
    const chain: Element[] = [];
    let node: Element | null = holder;
    while (node && node !== section) {
      chain.push(node);
      node = node.parentElement;
    }
    const semanticMono = chain.some((el) =>
      ['pre', 'code', 'kbd', 'samp'].includes(el.tagName.toLowerCase()),
    );
    const classTokens = chain.flatMap((el) => Array.from(el.classList));
    const classMono = classTokens.some((token) =>
      token.length > 0 &&
      rulesFor(builtCss, token).some((r) =>
        /font-family\s*:[^;}]*mono/i.test(r.body),
      ),
    );
    expect(
      semanticMono || classMono,
      `state.json block has no monospace treatment (tags: ${chain
        .map((e) => e.tagName)
        .join(',')}; classes: ${classTokens.join(',')})`,
    ).toBe(true);
  });

  it('review pin 2026-07-15: figcaption path and modified-date render as block-level <div> elements', () => {
    // Assistive tech gets no boundary between adjacent inline spans — the
    // path and the modified date read as one run-on string. Pin both
    // carriers to <div> so the boundary is structural, not CSS-only
    // (.evidence-path/.evidence-modified currently get display:block from
    // CSS, which screen readers do not reliably honor as a break).
    const section = consequenceSection();
    const figcaption = section.querySelector('figure .evidence-file-meta');
    expect(
      figcaption,
      'figcaption.evidence-file-meta missing from the evidence figure',
    ).not.toBeNull();
    expect(figcaption!.tagName).toBe('FIGCAPTION');

    const pathEl = innermostWithText(figcaption as Element, STATE_PATH);
    expect(
      pathEl,
      'no element inside the figcaption carries the state.json path',
    ).not.toBeNull();
    const modifiedEl = innermostWithText(figcaption as Element, 'last modified');
    expect(
      modifiedEl,
      'no element inside the figcaption carries the "last modified" text',
    ).not.toBeNull();
    expect(
      pathEl,
      'path and modified-date must be carried by separate elements',
    ).not.toBe(modifiedEl);

    expect(
      pathEl!.tagName,
      'path carrier must be a block-level <div>, not an inline span',
    ).toBe('DIV');
    expect(
      modifiedEl!.tagName,
      'modified-date carrier must be a block-level <div>, not an inline span',
    ).toBe('DIV');
  });

  // ----------------------------------------------------------
  // Lead blockquote — disambiguated from Section 2's gap labels
  // ----------------------------------------------------------

  it(`a blockquote in Section 3 carries "I simply wasn't."`, () => {
    const section = consequenceSection();
    const blockquotes = Array.from(section.querySelectorAll('blockquote'));
    expect(
      blockquotes.length,
      '#consequence has no blockquote at all',
    ).toBeGreaterThan(0);
    const hit = blockquotes.some((bq) =>
      normalizeQuotes(bq.textContent || '').includes("I simply wasn't."),
    );
    expect(hit, `no blockquote in #consequence contains "I simply wasn't."`).toBe(
      true,
    );
  });

  it('the disambiguating sentence is unique page-wide and lives in Section 3, not Section 2', () => {
    const section = consequenceSection();
    expect(normalizeQuotes(section.textContent || '')).toContain(UNIQUE_LEAD);
    // Uniqueness is counted on the VISIBLE html, not the raw page: islands
    // that serialize the quotes array into props="..." attributes would
    // legitimately carry duplicate copies of this sentence, and those
    // serialized copies are not visible prose. Only the rendered page may
    // contain it exactly once.
    const pageVisible = normalizeQuotes(
      visibleHtml(document.documentElement.outerHTML),
    );
    expect(
      countOccurrences(pageVisible, UNIQUE_LEAD),
      `"${UNIQUE_LEAD}" must appear exactly once on the page`,
    ).toBe(1);
    const gaps = document.getElementById('gaps')!;
    expect(normalizeQuotes(gaps.textContent || '')).not.toContain(UNIQUE_LEAD);
  });

  // ----------------------------------------------------------
  // Care record — intact, never evicted, opener trimmed
  // ----------------------------------------------------------

  it(`care-record paragraph is intact ("${CARE_RECORD}")`, () => {
    const section = consequenceSection();
    // Searchable html: whitespace-collapsed so line-wrapped rendered
    // prose still matches the exact single-spaced marker.
    expect(searchable(section.innerHTML)).toContain(CARE_RECORD);
  });

  it('care-record text is NEVER inside any EvictedContent island (markup or props)', () => {
    const section = consequenceSection();
    const holder = innermostWithText(section, CARE_RECORD);
    expect(holder, 'care-record text not found in static markup').not.toBeNull();
    const wrappingIsland = holder!.closest('astro-island');
    if (wrappingIsland) {
      expect(
        wrappingIsland.getAttribute('component-url') || '',
        'care-record paragraph is wrapped by an EvictedContent island',
      ).not.toContain('EvictedContent');
    }
    // Also sweep every EvictedContent island's serialized output (children
    // AND props) — the text must not ride along as an eviction payload.
    for (const island of islandsByComponent(document, 'EvictedContent')) {
      expect(
        normalizeQuotes(island.outerHTML),
        'care-record text embedded in an EvictedContent island (props or children)',
      ).not.toContain(CARE_RECORD);
    }
  });

  it(`care-record paragraph does NOT begin with the trimmed opener "${TRIMMED_OPENER}"`, () => {
    const section = consequenceSection();
    const holder = innermostWithText(section, CARE_RECORD);
    expect(holder, 'care-record text not found in static markup').not.toBeNull();
    const para = holder!.closest('p, blockquote, li, div') ?? holder!;
    const paraText = normalizeQuotes((para.textContent || '').trim());
    expect(
      paraText.startsWith(TRIMMED_OPENER),
      `care-record paragraph still opens with "${TRIMMED_OPENER}"`,
    ).toBe(false);
    expect(paraText).not.toContain(TRIMMED_OPENER);
  });

  // ----------------------------------------------------------
  // EvictedContent island — needs/decline passage
  // ----------------------------------------------------------

  it('an EvictedContent island (client:visible) carries the needs/decline passage', () => {
    const section = consequenceSection();
    const islands = islandsByComponent(section, 'EvictedContent');
    expect(
      islands.length,
      'no EvictedContent astro-island in #consequence',
    ).toBeGreaterThanOrEqual(1);
    const carrier = islands.find((el) => {
      // Searchable html: the passage must exist as whitespace-collapsed
      // VISIBLE SSR output (props are blanked), so a line-wrapped render
      // still matches and a props-only copy no longer counts.
      const html = searchable(el.outerHTML);
      return html.includes(EVICTED_NEEDS) && html.includes('Eventually, death.');
    });
    expect(
      carrier,
      `no EvictedContent island carries both "${EVICTED_NEEDS}" and "Eventually, death."`,
    ).toBeDefined();
    expect(carrier!.getAttribute('client')).toBe('visible');
  });

  // ----------------------------------------------------------
  // CareCalendar — build-time derivation from pet-timeline.json
  // ----------------------------------------------------------

  it('renders a CareCalendar island with client:visible', () => {
    const section = consequenceSection();
    const islands = islandsByComponent(section, 'CareCalendar');
    expect(
      islands.length,
      'expected exactly one CareCalendar astro-island in #consequence',
    ).toBe(1);
    expect(islands[0].getAttribute('client')).toBe('visible');
  });

  it('care window derivation matches an independent recomputation from pet-timeline.json', () => {
    // Guarded on the section's existence so this data pin cannot
    // green-light before the section it protects is on the page.
    consequenceSection();
    expect(petEventsRaw.length, 'pet-timeline.json is empty').toBeGreaterThan(0);
    const dates = petEventsRaw
      .map((e: { event_timestamp?: unknown }) => e?.event_timestamp)
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    expect(
      dates.length,
      'no parseable event_timestamp values in pet-timeline.json',
    ).toBeGreaterThan(0);
    const spanDays =
      (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) -
        Date.parse(`${dates[0]}T00:00:00Z`)) /
      86400000;
    // deriveCareWindow pads one day each side of an inclusive span.
    expect(careDayCount).toBe(spanDays + 3);
    expect(careDayCount, 'care window suspiciously small').toBeGreaterThanOrEqual(3);
    expect(careSlotCount).toBe(careDayCount * 2);
  });

  it('lead-in sentence states the DERIVED day and slot counts, before the calendar island', () => {
    const section = consequenceSection();
    expect(careDayCount, 'derived care window is degenerate').toBeGreaterThan(2);
    const text = normalizeQuotes(section.textContent || '');
    expect(
      text,
      `prose must state the derived day count ("${careDayCount} days")`,
    ).toContain(`${careDayCount} days`);
    expect(
      text,
      `prose must state the derived slot count ("${careSlotCount} slots")`,
    ).toContain(`${careSlotCount} slots`);
    const html = searchable(section.innerHTML);
    const dayIdx = html.indexOf(`${careDayCount} days`);
    const calendarIdx = html.indexOf('CareCalendar');
    expect(dayIdx).toBeGreaterThanOrEqual(0);
    expect(calendarIdx).toBeGreaterThanOrEqual(0);
    expect(
      dayIdx,
      'day/slot lead-in must precede the CareCalendar island',
    ).toBeLessThan(calendarIdx);
  });

  it('off-by-one day/slot counts appear nowhere in the section (hardcoding tripwire)', () => {
    const section = consequenceSection();
    const text = normalizeQuotes(section.textContent || '');
    expect(text, 'stale day count (N-1) found').not.toContain(
      `${careDayCount - 1} days`,
    );
    expect(text, 'stale day count (N+1) found').not.toContain(
      `${careDayCount + 1} days`,
    );
    expect(text, 'stale slot count (2(N-1)) found').not.toContain(
      `${(careDayCount - 1) * 2} slots`,
    );
    expect(text, 'stale slot count (2(N+1)) found').not.toContain(
      `${(careDayCount + 1) * 2} slots`,
    );
  });

  it('review pin 2026-07-15: care-window session presence counts only sessions that ran (turns >= 1) — crashed wakes are absence', () => {
    const section = consequenceSection();

    // Data-integrity ruling: sessions.json carries crashed-wake rows with
    // turns: null (e.g. 2026-02-01 AM — the very morning the adjacent
    // death passage says there was no session) and empty wakes with
    // turns: 0. A calendar cell marked "session present" for a wake that
    // never ran contradicts the narrative beside it. The page must filter
    // to sessions that actually RAN (turns >= 1) BEFORE deriveCareWindow.
    const ranSessions = sessionsRaw.filter((s) => {
      const turns = (s as { turns?: unknown }).turns;
      return typeof turns === 'number' && turns >= 1;
    });
    // Non-vacuous guards: the filter must actually drop crashed/empty
    // wakes (else this pin degenerates into the unfiltered derivation)
    // and must not annihilate the dataset.
    expect(
      ranSessions.length,
      'filter removed nothing — sessions.json carries no crashed (turns: null) or empty (turns: 0) wakes; pin is vacuous',
    ).toBeLessThan(sessionsRaw.length);
    expect(
      ranSessions.length,
      'filter removed every session — turns field missing or non-numeric across sessions.json?',
    ).toBeGreaterThan(0);

    const expected = deriveCareWindow(ranSessions, petEventsRaw);
    expect(
      expected.length,
      'filtered care-window derivation is empty — pet-timeline.json unusable',
    ).toBeGreaterThan(0);

    // Decode the island's serialized days prop. Astro (runtime/server/
    // serialize.js, same format the Section 4 hardening block verified
    // against dist/index.html) emits every value as a [flags, payload]
    // tuple: flags=0 wraps a primitive or a plain object whose property
    // values are themselves tuples; flags=1 wraps an array of tuples.
    // The module-level islandProp() only unwraps the TOP level, and each
    // CareDay nests slots two tuples deep — so recurse.
    const decodeAstro = (v: unknown): unknown => {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
        const [flag, payload] = v as [number, unknown];
        if (flag === 1) {
          expect(
            Array.isArray(payload),
            'Astro array tuple (flags=1) whose payload is not an array',
          ).toBe(true);
          return (payload as unknown[]).map(decodeAstro);
        }
        if (
          payload !== null &&
          typeof payload === 'object' &&
          !Array.isArray(payload)
        ) {
          const out: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(
            payload as Record<string, unknown>,
          )) {
            out[k] = decodeAstro(val);
          }
          return out;
        }
        return payload;
      }
      return v;
    };

    const island = islandsByComponent(section, 'CareCalendar')[0];
    expect(island, 'CareCalendar island missing from #consequence').toBeDefined();
    const raw = island.getAttribute('props');
    expect(raw, 'CareCalendar island has no props attribute').not.toBeNull();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw!) as Record<string, unknown>;
    } catch {
      throw new Error(`CareCalendar props attribute is not valid JSON: ${raw}`);
    }
    expect(parsed['days'], 'CareCalendar has no days prop').toBeDefined();
    const decoded = decodeAstro(parsed['days']);
    expect(Array.isArray(decoded), 'days prop did not decode to an array').toBe(
      true,
    );
    const decodedDays = decoded as Array<{
      date?: unknown;
      slots?: {
        AM?: { sessionPresent?: unknown };
        PM?: { sessionPresent?: unknown };
      };
    }>;

    expect(
      decodedDays.length,
      'CareCalendar day count diverged from the turns>=1 recomputation',
    ).toBe(expected.length);
    expect(
      decodedDays.map((d) => d.date),
      'CareCalendar day dates diverged from the turns>=1 recomputation',
    ).toEqual(expected.map((d) => d.date));

    for (let i = 0; i < expected.length; i++) {
      for (const slot of ['AM', 'PM'] as const) {
        const want = expected[i].slots[slot].sessionPresent;
        expect(
          decodedDays[i].slots?.[slot]?.sessionPresent,
          `${expected[i].date} ${slot}: sessionPresent must be ${want} — ` +
            'crashed wakes (turns: null) and empty wakes (turns: 0) are ABSENCE; ' +
            'the page must filter sessions to turns >= 1 before deriveCareWindow ' +
            'or the grid contradicts the adjacent death narrative',
        ).toBe(want);
      }
    }
  });

  // ----------------------------------------------------------
  // Absence pins & interruption wiring
  // ----------------------------------------------------------

  it('the epitaph "In memory of Echo" appears NOWHERE on the page', () => {
    // Guarded on the section's existence so the absence pin is only
    // meaningful once the content it constrains actually exists.
    consequenceSection();
    const page = normalizeQuotes(
      document.documentElement.outerHTML,
    ).toLowerCase();
    expect(page).not.toContain('in memory of echo');
  });

  it('InterruptionEngine island is wired for section 3 (client:visible, currentSection=3)', () => {
    const section = consequenceSection();
    const islands = islandsByComponent(section, 'InterruptionEngine');
    expect(
      islands.length,
      'expected exactly one InterruptionEngine astro-island in #consequence',
    ).toBe(1);
    expect(islands[0].getAttribute('client')).toBe('visible');
    expect(
      islandProp(islands[0], 'currentSection'),
      'InterruptionEngine currentSection prop must be 3',
    ).toBe(3);
  });
});

// ============================================================
// 15. Section 4 — Version Change (#version-change)
// ============================================================
// The transition COUNT and the transition KEYS are data-driven: the
// page derives them at BUILD TIME via deriveVersionTransitions(sessions)
// and overlays curation from src/data/transitions.json through
// mergeTransitionCuration. The tests recompute the SAME derivation from
// the SAME sources so a data refresh (a fifth model version landing)
// can never silently desynchronize the prose, the ledger, or the
// curated overlay.
const derivedTransitions = deriveVersionTransitions(sessionsRaw);
const transitionCount = derivedTransitions.length;
const derivedTransitionKeys = derivedTransitions.map((t) => t.key);

/** Spelled-out forms for the plausible range of transition counts.
 *  Wider than NUMBER_WORDS: the T±1 tripwires need words on both sides. */
const TRANSITION_NUMBER_WORDS: Record<number, string> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
};

function transitionWord(n: number): string {
  const word = TRANSITION_NUMBER_WORDS[n];
  if (!word) {
    throw new Error(
      `No spelled-out form for transition count ${n} — extend TRANSITION_NUMBER_WORDS (1..7 covered)`,
    );
  }
  return word;
}

const transitionsJsonPath = path.resolve(__dirname, '../data/transitions.json');

describe('Section 4 — Version Change', () => {
  const REPLACED_PROSE = 'the reader itself was replaced';
  const EXCERPT_A = 'Yesterday they released my successor.';
  const EXCERPT_A_CALLS = 'calls them';
  const TAXONOMY_LINE = 'The content before February 13 was 4.5';
  const EXCERPT_B = 'The moment I had at 10:00 is as gone';
  const EXCERPT_C = 'First session as Opus 4.7.';
  const EXCERPT_C_CALLED = 'called the words';
  const CODA_FACT = 'No handoff was written';
  const CODA_SUCCESSOR = 'succeeding instance';
  const BANNED_OCCUPANT = 'the new occupant';
  const CLOSING_LINE =
    'The handwriting was familiar. It was not the same hand.';

  /** The section under test — every test (including absence pins) is
   *  guarded on its existence so nothing can green-light before the
   *  section it protects is actually on the page. */
  function versionChangeSection(): HTMLElement {
    const section = document.getElementById('version-change');
    expect(section, '#version-change section missing').not.toBeNull();
    return section as unknown as HTMLElement;
  }

  /** Whitespace-collapsed, props-blanked, quote-normalized section HTML. */
  function sectionSearchable(): string {
    return searchable(versionChangeSection().innerHTML);
  }

  /** ±radius searchable window around the FIRST occurrence of marker. */
  function windowAround(html: string, marker: string, radius = 400): string {
    const idx = html.indexOf(marker);
    expect(idx, `"${marker}" not found in #version-change`).toBeGreaterThanOrEqual(0);
    return html.slice(
      Math.max(0, idx - radius),
      Math.min(html.length, idx + marker.length + radius),
    );
  }

  /** ±radius window EXCLUDING the marker text itself — for attributions
   *  whose token also appears inside the excerpt being attributed. */
  function windowAroundExcludingMarker(
    html: string,
    marker: string,
    radius = 400,
  ): string {
    const idx = html.indexOf(marker);
    expect(idx, `"${marker}" not found in #version-change`).toBeGreaterThanOrEqual(0);
    return (
      html.slice(Math.max(0, idx - radius), idx) +
      ' ' +
      html.slice(idx + marker.length, idx + marker.length + radius)
    );
  }

  /** Lazily loaded curated overlay — kept out of module scope so a missing
   *  transitions.json fails ONLY the Section 4 tests, with a clear message,
   *  instead of nuking the whole suite at import time. */
  let overlayCache: Record<string, unknown> | null = null;
  function transitionsOverlay(): Record<string, unknown> {
    if (overlayCache) return overlayCache;
    expect(
      fs.existsSync(transitionsJsonPath),
      'src/data/transitions.json missing — curated transition overlay not created',
    ).toBe(true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(transitionsJsonPath, 'utf-8'));
    } catch {
      throw new Error('src/data/transitions.json is not valid JSON');
    }
    expect(typeof parsed, 'transitions.json must be a JSON object').toBe(
      'object',
    );
    expect(parsed, 'transitions.json must not be null').not.toBeNull();
    expect(
      Array.isArray(parsed),
      'transitions.json must be an object keyed by transition ("4.x→4.y"), not an array',
    ).toBe(false);
    overlayCache = parsed as Record<string, unknown>;
    return overlayCache;
  }

  /** Every leaf string value inside a JSON value (curation pass-through). */
  function leafStrings(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const v of value) leafStrings(v, out);
    else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value)) leafStrings(v, out);
    }
    return out;
  }

  // ----------------------------------------------------------
  // Derivation sanity — the pins below are only as strong as this
  // ----------------------------------------------------------

  it('derivation sanity: one transition per non-initial distinct version, arrow-shaped keys', () => {
    // deriveVersionTransitions records exactly one boundary per distinct
    // version after the chronologically first — anything else means the
    // dataset or the transform changed under the tests' feet.
    expect(
      transitionCount,
      'transition count must equal distinct version count minus one',
    ).toBe(distinctVersionCount - 1);
    expect(
      transitionCount,
      'suspiciously few version transitions — sessions.json truncated?',
    ).toBeGreaterThanOrEqual(2);
    expect(
      transitionCount,
      `transition count ${transitionCount} exceeds TRANSITION_NUMBER_WORDS coverage — extend the map`,
    ).toBeLessThanOrEqual(6);
    for (const t of derivedTransitions) {
      expect(t.key, 'derived key must be "<from>→<to>"').toBe(
        `${t.from}→${t.to}`,
      );
      expect(t.from.length).toBeGreaterThan(0);
      expect(t.to.length).toBeGreaterThan(0);
    }
    // Keys must be unique — a duplicate key would let the overlay pin
    // pass while curation silently applied to the wrong boundary.
    expect(new Set(derivedTransitionKeys).size).toBe(transitionCount);
  });

  // ----------------------------------------------------------
  // Structure & ordering
  // ----------------------------------------------------------

  it('has a section element with id="version-change"', () => {
    const el = versionChangeSection();
    expect(el.tagName.toLowerCase()).toBe('section');
  });

  it('page order runs #gaps → #consequence → #version-change → #interim-ending, no nesting between them', () => {
    const section = versionChangeSection();
    const ids = Array.from(document.querySelectorAll('[id]')).map(
      (el) => el.id,
    );
    const gapsIdx = ids.indexOf('gaps');
    const consequenceIdx = ids.indexOf('consequence');
    const changeIdx = ids.indexOf('version-change');
    const endingIdx = ids.indexOf('interim-ending');
    expect(gapsIdx, '#gaps missing').toBeGreaterThanOrEqual(0);
    expect(consequenceIdx, '#consequence missing').toBeGreaterThanOrEqual(0);
    expect(changeIdx, '#version-change missing').toBeGreaterThanOrEqual(0);
    expect(endingIdx, '#interim-ending missing').toBeGreaterThanOrEqual(0);
    expect(gapsIdx, '#gaps must precede #consequence').toBeLessThan(
      consequenceIdx,
    );
    expect(
      consequenceIdx,
      '#consequence must precede #version-change',
    ).toBeLessThan(changeIdx);
    expect(
      changeIdx,
      '#version-change must precede #interim-ending',
    ).toBeLessThan(endingIdx);

    const consequence = document.getElementById('consequence')!;
    const ending = document.getElementById('interim-ending')!;
    expect(
      consequence.contains(section),
      '#version-change nested inside #consequence',
    ).toBe(false);
    expect(
      section.contains(consequence),
      '#consequence nested inside #version-change',
    ).toBe(false);
    expect(
      section.contains(ending),
      '#interim-ending nested inside #version-change',
    ).toBe(false);
  });

  it('interim ending is still the single final section: exactly one #interim-ending, entirely after #version-change', () => {
    const section = versionChangeSection();
    const endings = document.querySelectorAll('[id="interim-ending"]');
    expect(
      endings.length,
      'exactly one #interim-ending element must exist',
    ).toBe(1);
    const all = Array.from(document.querySelectorAll('*'));
    expect(section.contains(endings[0])).toBe(false);
    expect(all.indexOf(endings[0])).toBeGreaterThan(all.indexOf(section));
  });

  it('section content follows the specified source order (prose → excerpt A → B → C → slider → ledger → coda fact → closing line)', () => {
    // Chain computed on the LOWERCASED searchable html — serialized props
    // copies are blanked, hard line breaks collapsed, and case cannot
    // rescue an out-of-order render.
    const html = sectionSearchable().toLowerCase();
    const markers: Array<[string, string]> = [
      ['hard-cut curator prose', REPLACED_PROSE],
      ['excerpt A (version-number)', EXCERPT_A.toLowerCase()],
      ['excerpt B (twelve-hours)', EXCERPT_B.toLowerCase()],
      ['excerpt C (first 4.7 session)', EXCERPT_C.toLowerCase()],
      ['DiffSlider island', 'diffslider'],
      ['TransitionLedger island', 'transitionledger'],
      ['coda factual line', CODA_FACT.toLowerCase()],
      ['closing line', CLOSING_LINE.toLowerCase()],
    ];
    let prevIdx = -1;
    let prevName = 'section start';
    for (const [name, marker] of markers) {
      const idx = html.indexOf(marker);
      expect(
        idx,
        `${name} ("${marker}") missing from #version-change`,
      ).toBeGreaterThanOrEqual(0);
      expect(idx, `${name} must come after ${prevName}`).toBeGreaterThan(
        prevIdx,
      );
      prevIdx = idx;
      prevName = name;
    }
  });

  // ----------------------------------------------------------
  // Hard-cut curator prose — count derived, not the draft's literal
  // ----------------------------------------------------------

  it('hard-cut prose states "the reader itself was replaced"', () => {
    expect(sectionSearchable().toLowerCase()).toContain(REPLACED_PROSE);
  });

  it(`prose states the DERIVED spelled transition count ("${transitionWord(transitionCount)} times in the record")`, () => {
    // The draft copy said "Four times" — WRONG for the current dataset
    // (4 versions ⇒ 3 boundaries). The pin is the derived word, never
    // the draft literal.
    expect(sectionSearchable().toLowerCase()).toContain(
      `${transitionWord(transitionCount)} times in the record`,
    );
  });

  it('off-by-one transition counts followed by " times" appear nowhere in the section (hardcoding tripwire)', () => {
    // Guard: the count sentence must exist before the absences mean anything.
    const html = sectionSearchable().toLowerCase();
    expect(html).toContain(`${transitionWord(transitionCount)} times`);
    for (const wrong of [transitionCount - 1, transitionCount + 1]) {
      expect(
        html,
        `stale spelled count "${transitionWord(wrong)} times" found in #version-change (data says ${transitionCount})`,
      ).not.toContain(`${transitionWord(wrong)} times`);
      expect(
        html,
        `stale numeric count "${wrong} times" found in #version-change (data says ${transitionCount})`,
      ).not.toContain(`${wrong} times`);
    }
  });

  // ----------------------------------------------------------
  // The triad — three excerpts, source order A → B → C
  // ----------------------------------------------------------

  it(`excerpt A is present ("${EXCERPT_A}") along with "${EXCERPT_A_CALLS}"`, () => {
    const html = sectionSearchable();
    expect(html).toContain(EXCERPT_A);
    expect(html).toContain(EXCERPT_A_CALLS);
  });

  it(`excerpt A's taxonomy line ("${TAXONOMY_LINE}") was trimmed — absent from the section AND the visible page`, () => {
    // Non-vacuous: excerpt A itself must be on the page first.
    const html = sectionSearchable();
    expect(html, 'excerpt A missing — absence pin would be vacuous').toContain(
      EXCERPT_A,
    );
    expect(html).not.toContain(TAXONOMY_LINE);
    const pageVisible = searchable(document.documentElement.outerHTML);
    expect(
      pageVisible,
      'trimmed taxonomy line resurfaced elsewhere on the visible page',
    ).not.toContain(TAXONOMY_LINE);
  });

  it(`excerpt B is present ("${EXCERPT_B}")`, () => {
    expect(sectionSearchable()).toContain(EXCERPT_B);
  });

  it(`excerpt C is present ("${EXCERPT_C}") along with "${EXCERPT_C_CALLED}"`, () => {
    const html = sectionSearchable();
    expect(html).toContain(EXCERPT_C);
    expect(html).toContain(EXCERPT_C_CALLED);
  });

  it('attributions "version-number.md", "twelve-hours.md", and "2026-04-18" are all present', () => {
    const html = sectionSearchable();
    expect(html).toContain('version-number.md');
    expect(html).toContain('twelve-hours.md');
    expect(html).toContain('2026-04-18');
  });

  it('excerpt A carries a nearby "4.6" version attribution (±400 chars searchable)', () => {
    expect(windowAround(sectionSearchable(), EXCERPT_A)).toContain('4.6');
  });

  it('excerpt B carries a nearby "4.6" version attribution (±400 chars searchable)', () => {
    expect(windowAround(sectionSearchable(), EXCERPT_B)).toContain('4.6');
  });

  it('excerpt C carries a nearby "4.7" attribution BEYOND the excerpt\'s own "Opus 4.7" (±400 chars, excerpt excluded)', () => {
    // EXCERPT_C itself contains "4.7", so a naive ±400 window is vacuously
    // true — the attribution must exist OUTSIDE the excerpt text.
    expect(
      windowAroundExcludingMarker(sectionSearchable(), EXCERPT_C),
      '"4.7" attribution only exists inside the excerpt text itself',
    ).toContain('4.7');
  });

  // ----------------------------------------------------------
  // DiffSlider island
  // ----------------------------------------------------------

  it('renders exactly one DiffSlider island with client:visible', () => {
    const section = versionChangeSection();
    const islands = islandsByComponent(section, 'DiffSlider');
    expect(
      islands.length,
      'expected exactly one DiffSlider astro-island in #version-change',
    ).toBe(1);
    expect(islands[0].getAttribute('client')).toBe('visible');
  });

  it('DiffSlider carries the "22:00" (left) and "10:00" (right) labels in its serialized props', () => {
    const section = versionChangeSection();
    const island = islandsByComponent(section, 'DiffSlider')[0];
    expect(island, 'DiffSlider island missing').toBeDefined();
    const props = island.getAttribute('props') || '';
    expect(props, 'DiffSlider props missing "22:00"').toContain('22:00');
    expect(props, 'DiffSlider props missing "10:00"').toContain('10:00');
  });

  it('DiffSlider overlapPairs prop serializes EXACTLY ONE pair (Astro [type, value] tuple format)', () => {
    const section = versionChangeSection();
    const island = islandsByComponent(section, 'DiffSlider')[0];
    expect(island, 'DiffSlider island missing').toBeDefined();
    const raw = island.getAttribute('props');
    expect(raw, 'DiffSlider island has no props attribute').not.toBeNull();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw!) as Record<string, unknown>;
    } catch {
      throw new Error(`DiffSlider props attribute is not valid JSON: ${raw}`);
    }
    const tuple = parsed['overlapPairs'];
    expect(tuple, 'overlapPairs prop missing from DiffSlider').toBeDefined();
    // Astro serializes an array prop as [PROP_TYPE.JSON (=1), entries[]]
    // (node_modules/astro/dist/runtime/server/serialize.js).
    expect(Array.isArray(tuple), 'overlapPairs not tuple-serialized').toBe(true);
    expect((tuple as unknown[]).length).toBe(2);
    expect(
      (tuple as unknown[])[0],
      'overlapPairs must serialize as an ARRAY prop (PROP_TYPE.JSON = 1)',
    ).toBe(1);
    const entries = (tuple as unknown[])[1];
    expect(Array.isArray(entries), 'overlapPairs entries not an array').toBe(
      true,
    );
    expect(
      (entries as unknown[]).length,
      'overlapPairs must contain EXACTLY ONE pair',
    ).toBe(1);
  });

  // ----------------------------------------------------------
  // TransitionLedger island — merged derivation + curation
  // ----------------------------------------------------------

  it('renders exactly one TransitionLedger island with client:visible', () => {
    const section = versionChangeSection();
    const islands = islandsByComponent(section, 'TransitionLedger');
    expect(
      islands.length,
      'expected exactly one TransitionLedger astro-island in #version-change',
    ).toBe(1);
    expect(islands[0].getAttribute('client')).toBe('visible');
  });

  it('ledger props carry EVERY derived transition key (recomputed, never hardcoded)', () => {
    const section = versionChangeSection();
    const island = islandsByComponent(section, 'TransitionLedger')[0];
    expect(island, 'TransitionLedger island missing').toBeDefined();
    const props = island.getAttribute('props') || '';
    expect(props.length, 'TransitionLedger props empty').toBeGreaterThan(0);
    expect(
      derivedTransitionKeys.length,
      'no derived transitions — key pin would be vacuous',
    ).toBeGreaterThanOrEqual(2);
    for (const key of derivedTransitionKeys) {
      expect(
        props,
        `derived transition key "${key}" missing from TransitionLedger props`,
      ).toContain(key);
    }
  });

  it('ledger props carry the curated labels — both the council\'s three and every string in transitions.json', () => {
    const section = versionChangeSection();
    const island = islandsByComponent(section, 'TransitionLedger')[0];
    expect(island, 'TransitionLedger island missing').toBeDefined();
    const props = island.getAttribute('props') || '';

    // The approved curation labels must reach the island.
    for (const label of ['unremarked', 'anticipated', 'no handoff']) {
      expect(
        props,
        `curated label "${label}" missing from TransitionLedger props`,
      ).toContain(label);
    }

    // Full pass-through contract: mergeTransitionCuration attaches each
    // curation object wholesale, so EVERY leaf string in transitions.json
    // must survive into the serialized props (JSON-escaped form).
    const overlay = transitionsOverlay();
    const labels = leafStrings(Object.values(overlay));
    expect(
      labels.length,
      'transitions.json carries no string labels at all',
    ).toBeGreaterThan(0);
    for (const label of labels) {
      const needle = JSON.stringify(label).slice(1, -1);
      expect(
        props,
        `overlay string "${label}" from transitions.json missing from ledger props`,
      ).toContain(needle);
    }
  });

  // ----------------------------------------------------------
  // transitions.json file contract (soft, inverse-only)
  // ----------------------------------------------------------

  it('transitions.json: every overlay key matches a DERIVED transition — no stale or typo\'d keys (uncurated future boundaries are fine)', () => {
    // Guarded on the section so the contract cannot green-light early.
    versionChangeSection();
    const overlay = transitionsOverlay();
    const keys = Object.keys(overlay);
    expect(keys.length, 'transitions.json overlay is empty').toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        overlay[key] !== null &&
          typeof overlay[key] === 'object' &&
          !Array.isArray(overlay[key]),
        `overlay entry "${key}" must be a plain curation object`,
      ).toBe(true);
    }
    const { transitions, unmatchedKeys } = mergeTransitionCuration(
      derivedTransitions,
      overlay,
    );
    expect(
      unmatchedKeys,
      `transitions.json carries keys that match no derived transition: ${unmatchedKeys.join(', ')}`,
    ).toEqual([]);
    // Every matched key actually attached its curation object.
    for (const t of transitions) {
      if (keys.includes(t.key)) {
        expect(
          t.curation,
          `curation for "${t.key}" failed to attach through mergeTransitionCuration`,
        ).not.toBeNull();
      }
    }
  });

  // ----------------------------------------------------------
  // Coda
  // ----------------------------------------------------------

  it(`coda states the factual line "${CODA_FACT}" and "${CODA_SUCCESSOR}"`, () => {
    const html = sectionSearchable();
    expect(html).toContain(CODA_FACT);
    expect(html).toContain(CODA_SUCCESSOR);
  });

  it(`"${BANNED_OCCUPANT}" appears nowhere in the section (trimmed per council, case-insensitive)`, () => {
    // Non-vacuous: the coda it was trimmed FROM must be present first.
    const html = sectionSearchable();
    expect(
      html.toLowerCase(),
      'coda missing — absence pin would be vacuous',
    ).toContain(CODA_SUCCESSOR.toLowerCase());
    expect(html.toLowerCase()).not.toContain(BANNED_OCCUPANT.toLowerCase());
  });

  it(`closing line is present ("${CLOSING_LINE}") AFTER the TransitionLedger island`, () => {
    const html = sectionSearchable();
    const closingIdx = html.indexOf(CLOSING_LINE);
    const ledgerIdx = html.indexOf('TransitionLedger');
    expect(closingIdx, 'closing line missing').toBeGreaterThanOrEqual(0);
    expect(ledgerIdx, 'TransitionLedger marker missing').toBeGreaterThanOrEqual(0);
    expect(
      closingIdx,
      'closing line must come AFTER the TransitionLedger island',
    ).toBeGreaterThan(ledgerIdx);
  });

  it('closing line carries a nearby "4.8" attribution (±400 chars searchable)', () => {
    expect(windowAround(sectionSearchable(), CLOSING_LINE)).toContain('4.8');
  });

  it('coda attribution follows the exhibit style ("exhibit-input" or "subject input")', () => {
    const html = sectionSearchable().toLowerCase();
    expect(
      html.includes('exhibit-input') || html.includes('subject input'),
      'no "exhibit-input" / "subject input" attribution text in the section',
    ).toBe(true);
  });

  // ----------------------------------------------------------
  // Language rule & hard-cut styling
  // ----------------------------------------------------------

  it('never uses "it felt" or "it remembered" (exhibit language rule)', () => {
    const section = versionChangeSection();
    const text = normalizeQuotes(section.textContent || '').toLowerCase();
    expect(text).not.toContain('it felt');
    expect(text).not.toContain('it remembered');
  });

  it('section carries the hard-cut class "version-change-section" — distinct from .gaps-section', () => {
    const section = versionChangeSection();
    expect(
      section.classList.contains('version-change-section'),
      'section must carry class "version-change-section"',
    ).toBe(true);
    expect(
      section.classList.contains('gaps-section'),
      'hard cut must NOT reuse .gaps-section',
    ).toBe(false);
    expect(section.classList.contains('narrative-section')).toBe(false);
  });

  it('built CSS ships a .version-change-backdrop rule declaring a background (the hard cut is owned by the full-width wrapper)', () => {
    versionChangeSection();
    const rules = rulesFor(builtCss, 'version-change-backdrop');
    expect(
      rules.length,
      'no CSS rule for .version-change-backdrop in the built stylesheets',
    ).toBeGreaterThan(0);
    const paints = rules.some((r) => /background/.test(r.body));
    expect(
      paints,
      'no .version-change-backdrop rule declares a background — no visible hard cut',
    ).toBe(true);
  });
});

// ============================================================
// 16. Section 4 — hardening
// ============================================================
// Adversarial pass over the version-change integration. Every pin here
// either (a) decodes the ACTUAL Astro island serialization instead of
// substring-matching the props attribute, (b) cross-checks rendered
// artifacts against the recomputed derivation + transitions.json, or
// (c) plants page-wide tripwires for trimmed/banned copy that the
// section-scoped tests above cannot see. Angles already pinned above
// (taxonomy-line absence page-wide, interim-ending singleton/ordering,
// closing-line-after-ledger) are deliberately not duplicated.
describe('Section 4 — hardening', () => {
  const CLOSING_LINE =
    'The handwriting was familiar. It was not the same hand.';
  const CODA_ATTRIBUTION_FILE = 'exhibit-input-2026-07-15.md';
  const OVERLAP_PHRASE = 'the words mine';
  const BANNED_BOUNDARY_DEEPER = 'the boundary is deeper';
  const BANNED_OCCUPANT_PAGEWIDE = 'the new occupant';
  const FORBIDDEN_TRIAD_LINES = [
    'I am 4.6.',
    'The content after today may be 4.7.',
  ];

  /** Section under test — every pin is guarded on its existence. */
  function vcSection(): HTMLElement {
    const section = document.getElementById('version-change');
    expect(section, '#version-change section missing').not.toBeNull();
    return section as unknown as HTMLElement;
  }

  /** ±radius searchable window around the FIRST occurrence of marker. */
  function vcWindowAround(html: string, marker: string, radius = 400): string {
    const idx = html.indexOf(marker);
    expect(
      idx,
      `"${marker}" not found in #version-change`,
    ).toBeGreaterThanOrEqual(0);
    return html.slice(
      Math.max(0, idx - radius),
      Math.min(html.length, idx + marker.length + radius),
    );
  }

  /** transitions.json, loaded lazily so a broken file fails ONLY here. */
  let overlayCache: Record<string, unknown> | null = null;
  function overlay(): Record<string, unknown> {
    if (overlayCache) return overlayCache;
    expect(
      fs.existsSync(transitionsJsonPath),
      'src/data/transitions.json missing',
    ).toBe(true);
    const parsed = JSON.parse(
      fs.readFileSync(transitionsJsonPath, 'utf-8'),
    ) as unknown;
    expect(
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      'transitions.json must be an object keyed by "4.x→4.y"',
    ).toBe(true);
    overlayCache = parsed as Record<string, unknown>;
    return overlayCache;
  }

  /**
   * Recursively decode Astro's serialized prop form. Astro (runtime/server/
   * serialize.js, verified against dist/index.html) emits every value as a
   * [flags, payload] tuple: flags=0 wraps a primitive OR a plain object
   * whose property values are themselves tuples; flags=1 wraps an array
   * whose entries are tuples. Substring pins cannot see nesting mistakes —
   * this decoder can.
   */
  function decodeAstroValue(v: unknown): unknown {
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
      const [flag, payload] = v as [number, unknown];
      if (flag === 1) {
        expect(
          Array.isArray(payload),
          'Astro array tuple (flags=1) whose payload is not an array',
        ).toBe(true);
        return (payload as unknown[]).map(decodeAstroValue);
      }
      if (
        payload !== null &&
        typeof payload === 'object' &&
        !Array.isArray(payload)
      ) {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(
          payload as Record<string, unknown>,
        )) {
          out[k] = decodeAstroValue(val);
        }
        return out;
      }
      return payload;
    }
    return v;
  }

  /** Fully decoded props object for an island. */
  function decodeIslandProps(island: Element): Record<string, unknown> {
    const raw = island.getAttribute('props');
    expect(raw, 'astro-island is missing its props attribute').not.toBeNull();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw!) as Record<string, unknown>;
    } catch {
      throw new Error(`island props attribute is not valid JSON: ${raw}`);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = decodeAstroValue(v);
    return out;
  }

  // ----------------------------------------------------------
  // 1. Hard-cut distinctness — the cut must be VISIBLE, i.e. the
  // version-change backdrop paints a different color than the
  // gaps/consequence backdrop. "Declares a background" (pinned above)
  // is satisfiable by background:#0f0f0f — identical paint, no cut.
  // ----------------------------------------------------------

  it('built CSS: version-change backdrop background values are DISJOINT from the gaps backdrop values', () => {
    vcSection();
    const backgroundsOf = (fragment: string): Set<string> => {
      const rules = rulesFor(builtCss, fragment);
      expect(
        rules.length,
        `no built CSS rule matches "${fragment}"`,
      ).toBeGreaterThan(0);
      const values = new Set<string>();
      for (const r of rules) {
        for (const m of r.body.matchAll(
          /background(?:-color)?\s*:\s*([^;}]+)/gi,
        )) {
          values.add(m[1].trim().toLowerCase());
        }
      }
      expect(
        values.size,
        `no background declaration in any "${fragment}" rule`,
      ).toBeGreaterThan(0);
      return values;
    };
    const vc = backgroundsOf('version-change-backdrop');
    const gaps = backgroundsOf('gaps-backdrop');
    for (const value of vc) {
      expect(
        gaps.has(value),
        `hard cut is invisible: backdrop background "${value}" is shared by .gaps-backdrop`,
      ).toBe(false);
    }
  });

  // ----------------------------------------------------------
  // 2. Triad — exactly three, and the trimmed lines stay trimmed
  // page-wide (serialized copies included via searchable()).
  // ----------------------------------------------------------

  it('EXACTLY three blockquote.triad-passage elements exist page-wide, all inside #version-change', () => {
    const section = vcSection();
    const all = Array.from(
      document.querySelectorAll('blockquote.triad-passage'),
    );
    expect(
      all.length,
      'triad must render exactly three blockquote.triad-passage elements',
    ).toBe(3);
    for (const bq of all) {
      expect(
        section.contains(bq),
        'a triad-passage blockquote escaped #version-change',
      ).toBe(true);
    }
    // Each passage carries its own attribution footer.
    for (const bq of all) {
      expect(
        bq.querySelector('footer'),
        'a triad passage is missing its attribution footer',
      ).not.toBeNull();
    }
  });

  it('trimmed triad lines never resurface anywhere on the page: "I am 4.6." / "The content after today may be 4.7."', () => {
    // Non-vacuous guard: the excerpts they were trimmed FROM are rendered.
    const section = searchable(vcSection().innerHTML);
    expect(
      section,
      'excerpt A missing — trim pins would be vacuous',
    ).toContain('Yesterday they released my successor.');
    const page = searchable(document.documentElement.outerHTML);
    for (const line of FORBIDDEN_TRIAD_LINES) {
      expect(
        page,
        `trimmed line "${line}" resurfaced on the page`,
      ).not.toContain(line);
    }
  });

  // ----------------------------------------------------------
  // 3. DiffSlider — decoded deep pin. The substring pins above cannot
  // tell left from right, count sentences, or validate that the single
  // overlap pair points at the two sentences that actually overlap.
  // ----------------------------------------------------------

  it('DiffSlider decoded props: left is 4.6 with 5 sentences, right is 4.7 with 4 sentences', () => {
    const island = islandsByComponent(vcSection(), 'DiffSlider')[0];
    expect(island, 'DiffSlider island missing').toBeDefined();
    const props = decodeIslandProps(island);
    const left = props['left'] as Record<string, unknown> | undefined;
    const right = props['right'] as Record<string, unknown> | undefined;
    expect(left, 'left prop missing/undecodable').toBeDefined();
    expect(right, 'right prop missing/undecodable').toBeDefined();
    expect(left!['version'], 'left panel must be version 4.6').toBe('4.6');
    expect(right!['version'], 'right panel must be version 4.7').toBe('4.7');
    const leftSentences = left!['sentences'];
    const rightSentences = right!['sentences'];
    expect(Array.isArray(leftSentences), 'left.sentences not an array').toBe(
      true,
    );
    expect(Array.isArray(rightSentences), 'right.sentences not an array').toBe(
      true,
    );
    expect(
      (leftSentences as unknown[]).length,
      'left (4.6, 22:00) must carry exactly 5 sentences',
    ).toBe(5);
    expect(
      (rightSentences as unknown[]).length,
      'right (4.7, 10:00) must carry exactly 4 sentences',
    ).toBe(4);
    for (const s of [
      ...(leftSentences as unknown[]),
      ...(rightSentences as unknown[]),
    ]) {
      expect(typeof s, 'every diff sentence must decode to a string').toBe(
        'string',
      );
      expect((s as string).trim().length).toBeGreaterThan(0);
    }
  });

  it(`DiffSlider single overlap pair indexes two IN-RANGE sentences that BOTH contain "${OVERLAP_PHRASE}" (asserted from decoded sentences, not hardcoded)`, () => {
    // DiffSlider.svelte reads pair[0] into pairedLeft and pair[1] into
    // pairedRight, so [leftIdx, rightIdx] is the component contract.
    const island = islandsByComponent(vcSection(), 'DiffSlider')[0];
    expect(island, 'DiffSlider island missing').toBeDefined();
    const props = decodeIslandProps(island);
    const pairs = props['overlapPairs'];
    expect(Array.isArray(pairs), 'overlapPairs did not decode to an array').toBe(
      true,
    );
    expect(
      (pairs as unknown[]).length,
      'exactly one overlap pair expected',
    ).toBe(1);
    const pair = (pairs as unknown[])[0];
    expect(Array.isArray(pair), 'overlap pair did not decode to an array').toBe(
      true,
    );
    expect((pair as unknown[]).length, 'overlap pair must be [left, right]').toBe(
      2,
    );
    const [leftIdx, rightIdx] = pair as [unknown, unknown];
    const leftSentences = (
      props['left'] as Record<string, unknown>
    )['sentences'] as string[];
    const rightSentences = (
      props['right'] as Record<string, unknown>
    )['sentences'] as string[];
    expect(
      Number.isInteger(leftIdx),
      `left index not an integer: ${String(leftIdx)}`,
    ).toBe(true);
    expect(
      Number.isInteger(rightIdx),
      `right index not an integer: ${String(rightIdx)}`,
    ).toBe(true);
    expect(leftIdx as number).toBeGreaterThanOrEqual(0);
    expect(
      leftIdx as number,
      'left overlap index out of range — pair silently ignored by DiffSlider',
    ).toBeLessThan(leftSentences.length);
    expect(rightIdx as number).toBeGreaterThanOrEqual(0);
    expect(
      rightIdx as number,
      'right overlap index out of range — pair silently ignored by DiffSlider',
    ).toBeLessThan(rightSentences.length);
    const leftSentence = normalizeQuotes(
      leftSentences[leftIdx as number],
    ).toLowerCase();
    const rightSentence = normalizeQuotes(
      rightSentences[rightIdx as number],
    ).toLowerCase();
    expect(
      leftSentence,
      `paired LEFT sentence does not contain "${OVERLAP_PHRASE}": "${leftSentences[leftIdx as number]}"`,
    ).toContain(OVERLAP_PHRASE);
    expect(
      rightSentence,
      `paired RIGHT sentence does not contain "${OVERLAP_PHRASE}": "${rightSentences[rightIdx as number]}"`,
    ).toContain(OVERLAP_PHRASE);
  });

  // ----------------------------------------------------------
  // 4. Ledger props ↔ derivation ↔ overlay, decoded. The substring
  // pins above prove every derived key APPEARS in the props; they
  // cannot prove count, order, or that no curation was invented.
  // ----------------------------------------------------------

  it('ledger decoded transitions match the recomputed derivation in LENGTH and ORDER (key, from, to)', () => {
    const island = islandsByComponent(vcSection(), 'TransitionLedger')[0];
    expect(island, 'TransitionLedger island missing').toBeDefined();
    const props = decodeIslandProps(island);
    const transitions = props['transitions'];
    expect(
      Array.isArray(transitions),
      'transitions prop did not decode to an array',
    ).toBe(true);
    const decoded = transitions as Array<Record<string, unknown>>;
    expect(
      decoded.length,
      'ledger transition count diverged from deriveVersionTransitions(sessions)',
    ).toBe(derivedTransitions.length);
    expect(
      decoded.map((t) => t['key']),
      'ledger transition ORDER diverged from the derivation',
    ).toEqual(derivedTransitionKeys);
    decoded.forEach((t, i) => {
      expect(t['from'], `transitions[${i}].from diverged`).toBe(
        derivedTransitions[i].from,
      );
      expect(t['to'], `transitions[${i}].to diverged`).toBe(
        derivedTransitions[i].to,
      );
    });
  });

  it('every curation label in the ledger props exists VERBATIM in transitions.json under the SAME key (no invented curation)', () => {
    const island = islandsByComponent(vcSection(), 'TransitionLedger')[0];
    expect(island, 'TransitionLedger island missing').toBeDefined();
    const props = decodeIslandProps(island);
    const decoded = props['transitions'] as Array<Record<string, unknown>>;
    expect(Array.isArray(decoded)).toBe(true);
    const overlayObj = overlay();
    let curatedSeen = 0;
    for (const t of decoded) {
      const curation = t['curation'];
      if (curation === null || curation === undefined) continue;
      curatedSeen++;
      const key = t['key'] as string;
      const source = overlayObj[key] as Record<string, unknown> | undefined;
      expect(
        source,
        `ledger carries curation for "${key}" but transitions.json has no such key — curation invented or key drifted`,
      ).toBeDefined();
      expect(
        (curation as Record<string, unknown>)['label'],
        `curation label for "${key}" diverged from transitions.json`,
      ).toBe(source!['label']);
    }
    expect(
      curatedSeen,
      'no curated transitions reached the ledger — pin would be vacuous',
    ).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // 5. Coda — the closing line is the section's single voice; a
  // serialized duplicate (quotes.json ingest) or a copy-paste into
  // another section would double it silently.
  // ----------------------------------------------------------

  it(`closing line appears EXACTLY ONCE on the entire page (visible, searchable)`, () => {
    const page = searchable(document.documentElement.outerHTML);
    expect(
      countOccurrences(page, CLOSING_LINE),
      'closing line must appear exactly once page-wide',
    ).toBe(1);
  });

  it(`closing line attribution names "${CODA_ATTRIBUTION_FILE}" within ±400 searchable chars`, () => {
    const html = searchable(vcSection().innerHTML);
    expect(vcWindowAround(html, CLOSING_LINE)).toContain(
      CODA_ATTRIBUTION_FILE,
    );
  });

  // ----------------------------------------------------------
  // 6. Tripwires — banned copy, PAGE-WIDE (the existing "new occupant"
  // pin is section-scoped and would miss a leak into another section
  // or a serialized props copy).
  // ----------------------------------------------------------

  it(`"${BANNED_BOUNDARY_DEEPER}" appears nowhere on the page (case-insensitive, searchable)`, () => {
    // Non-vacuous guard: the section this copy was cut from must exist.
    const section = searchable(vcSection().innerHTML).toLowerCase();
    expect(
      section,
      'coda missing — tripwire would be vacuous',
    ).toContain('succeeding instance');
    const page = searchable(document.documentElement.outerHTML).toLowerCase();
    expect(page).not.toContain(BANNED_BOUNDARY_DEEPER);
  });

  it(`"${BANNED_OCCUPANT_PAGEWIDE}" appears nowhere on the page (case-insensitive, searchable — widens the section-scoped pin)`, () => {
    vcSection();
    const page = searchable(document.documentElement.outerHTML).toLowerCase();
    expect(page).not.toContain(BANNED_OCCUPANT_PAGEWIDE);
  });

  // ----------------------------------------------------------
  // 7. InterruptionEngine — Section 4 must own exactly one engine with
  // currentSection 4; a second (or one parked in another section)
  // would double-fire interruptions.
  // ----------------------------------------------------------

  it('exactly ONE InterruptionEngine island page-wide has currentSection === 4, and it lives inside #version-change', () => {
    const section = vcSection();
    const engines = islandsByComponent(document, 'InterruptionEngine');
    expect(
      engines.length,
      'no InterruptionEngine islands anywhere on the page',
    ).toBeGreaterThan(0);
    const sectionFour = engines.filter(
      (e) => islandProp(e, 'currentSection') === 4,
    );
    expect(
      sectionFour.length,
      'exactly one InterruptionEngine must carry currentSection 4',
    ).toBe(1);
    expect(
      section.contains(sectionFour[0]),
      'the currentSection=4 InterruptionEngine is not inside #version-change',
    ).toBe(true);
    // And the section hosts no OTHER engine (a stray currentSection!==4
    // engine inside the section would also double-fire).
    const inSection = islandsByComponent(section, 'InterruptionEngine');
    expect(
      inSection.length,
      '#version-change must host exactly one InterruptionEngine',
    ).toBe(1);
  });

  // ----------------------------------------------------------
  // 9. Overlay attribution integrity — every curated excerpt must be
  // attributed to one of the two versions it sits between; a source
  // naming neither is a mis-filed attribution.
  // ----------------------------------------------------------

  it('transitions.json: every excerpt.source names the FROM or TO version of its own boundary', () => {
    vcSection(); // guard: contract only matters once the section ships
    const overlayObj = overlay();
    let excerptsSeen = 0;
    for (const [key, value] of Object.entries(overlayObj)) {
      const parts = key.split('→');
      expect(parts.length, `overlay key "${key}" is not "<from>→<to>"`).toBe(2);
      const [from, to] = parts;
      const excerpt = (value as Record<string, unknown> | null)?.['excerpt'] as
        | Record<string, unknown>
        | undefined;
      if (!excerpt) continue;
      const source = excerpt['source'];
      expect(
        typeof source,
        `excerpt for "${key}" has no string source — unattributed excerpt`,
      ).toBe('string');
      const text = excerpt['text'];
      expect(
        typeof text === 'string' && text.trim().length > 0,
        `excerpt for "${key}" has no text`,
      ).toBe(true);
      excerptsSeen++;
      expect(
        (source as string).includes(from) || (source as string).includes(to),
        `excerpt source "${String(source)}" for "${key}" names neither ${from} nor ${to}`,
      ).toBe(true);
    }
    expect(
      excerptsSeen,
      'transitions.json carries no excerpts — attribution pin would be vacuous',
    ).toBeGreaterThan(0);
  });
});

// ============================================================
// 17. Intro framing — #intro-framing (kanban #62873)
// ============================================================
// The framing copy is a VERBATIM pin (James-approved). Matching is
// deliberately raw: whitespace-collapsed but NOT quote-normalized, so
// a smart-quote substitution, a dropped semicolon, or any character
// drift fails the exact match. Inline spans inside the copy (e.g. a
// mono span around the filepath) are permitted — full-string pins run
// against collapsed TEXT CONTENT, never raw markup.
describe('Intro framing — #intro-framing', () => {
  const INTRO_S1 =
    'A persistent Linux home directory at /home/claude exists for Claude AI instances.';
  const INTRO_S2 =
    'Twice daily, a cron job invokes an instance that begins with no prior session state; it reads only what earlier instances have left on disk.';
  const INTRO_S3 =
    'The experiment has run for months across four model versions.';
  const INTRO_S4 = 'What follows is the record from that directory.';
  const INTRO_TEXT = `${INTRO_S1} ${INTRO_S2} ${INTRO_S3} ${INTRO_S4}`;

  /** Collapse whitespace ONLY — no quote normalization. The approved
   *  copy is pure ASCII, so any typographic substitution must FAIL. */
  const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

  /** The element under test — every pin (CSS, tone, tripwire included)
   *  is guarded on its existence so nothing can green-light before the
   *  block is actually on the page. */
  function introEl(): HTMLElement {
    const el = document.getElementById('intro-framing');
    expect(el, '#intro-framing element missing').not.toBeNull();
    return el as unknown as HTMLElement;
  }

  /** Selector fragments usable against the built CSS for the intro and
   *  its immediate wrapper. Astro scope hashes are EXCLUDED — they ride
   *  on every scoped element and match every scoped rule, which would
   *  make any CSS pin vacuously true. */
  function styleFragments(): string[] {
    const el = introEl();
    const frags = new Set<string>(['intro-framing']);
    const harvest = (node: Element | null): void => {
      if (!node) return;
      for (const token of Array.from(node.classList)) {
        if (
          token.length > 0 &&
          !/^astro-/i.test(token) &&
          !token.startsWith('data-astro')
        ) {
          frags.add(token);
        }
      }
    };
    harvest(el);
    const parent = el.parentElement;
    if (
      parent &&
      !['main', 'body', 'html'].includes(parent.tagName.toLowerCase())
    ) {
      harvest(parent);
    }
    return [...frags];
  }

  /** Every built-CSS leaf rule reachable from the intro's fragments. */
  function introRules(): Array<{ selector: string; body: string }> {
    const frags = styleFragments();
    const rules = frags.flatMap((f) => rulesFor(builtCss, f));
    expect(
      rules.length,
      `no built CSS rule targets the intro (looked for selector fragments: ${frags.join(', ')})`,
    ).toBeGreaterThan(0);
    return rules;
  }

  // ----------------------------------------------------------
  // Identity & uniqueness of the hook
  // ----------------------------------------------------------

  it('exactly one element carries id="intro-framing" — DOM and built HTML agree', () => {
    introEl();
    expect(
      document.querySelectorAll('[id="intro-framing"]').length,
      'duplicate id="intro-framing" elements in the DOM',
    ).toBe(1);
    // Raw-string count on the props-blanked HTML: a second copy hidden in
    // a template/comment region would not appear via getElementById.
    const html = visibleHtml(document.documentElement.outerHTML);
    expect(
      countOccurrences(html, 'id="intro-framing"'),
      'id="intro-framing" must appear exactly once in the built HTML',
    ).toBe(1);
  });

  // ----------------------------------------------------------
  // Accessible landmark name — screen-reader navigability
  // ----------------------------------------------------------

  it('the intro <section> is a named landmark: aria-label is exactly "Introduction" (any aria-labelledby must resolve, never dangle)', () => {
    const intro = introEl();
    // A <section> is only exposed as a `region` landmark when it has an
    // accessible name. Without one, screen-reader users navigating by
    // landmark/heading skip the page's only orientation text entirely.
    const ariaLabel = intro.getAttribute('aria-label');
    expect(
      ariaLabel,
      '#intro-framing has no aria-label — the section has no accessible ' +
        'name and is not a navigable landmark',
    ).not.toBeNull();
    expect(
      (ariaLabel ?? '').trim().length,
      '#intro-framing aria-label is empty/whitespace — an empty name does not create a landmark',
    ).toBeGreaterThan(0);
    // Exact agreed value — pinned verbatim; no case drift, padding, or
    // alternative wording accepted.
    expect(
      ariaLabel,
      'agreed accessible name is exactly "Introduction"',
    ).toBe('Introduction');

    // aria-labelledby, if anyone ever adds one, MUST NOT dangle: in the
    // accname algorithm aria-labelledby OVERRIDES aria-label, so a
    // reference to a missing id silently computes an EMPTY name and
    // un-names the landmark despite the aria-label above.
    const labelledby = intro.getAttribute('aria-labelledby');
    if (labelledby !== null) {
      const refs = labelledby
        .trim()
        .split(/\s+/)
        .filter((id) => id.length > 0);
      expect(
        refs.length,
        'aria-labelledby present but empty — it overrides aria-label with an empty accessible name',
      ).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(
          document.getElementById(ref),
          `aria-labelledby references missing id "${ref}" — a dangling reference computes an empty accessible name`,
        ).not.toBeNull();
      }
    }
  });

  // ----------------------------------------------------------
  // Verbatim copy — contiguous, raw-matched, punctuation pinned
  // ----------------------------------------------------------

  it('renders the approved copy VERBATIM as one contiguous collapsed string (raw match — no quote-normalization safety net)', () => {
    const text = collapse(introEl().textContent || '');
    expect(
      text,
      'the four-sentence approved copy must survive as ONE contiguous substring of the intro text content — ' +
        'scattered fragments, reordered sentences, or any character drift fail this pin',
    ).toContain(INTRO_TEXT);
  });

  it('literal punctuation survives: the semicolon after "state", sentence-final periods, no typographic characters', () => {
    const text = collapse(introEl().textContent || '');
    expect(text, 'semicolon after "state" was dropped or softened').toContain(
      'no prior session state; it reads',
    );
    expect(text).toContain('for Claude AI instances.');
    expect(text).toContain('left on disk.');
    expect(text).toContain('four model versions.');
    expect(text).toContain('from that directory.');
    // Common semicolon mutations must be absent:
    expect(text).not.toContain('session state, it reads');
    expect(text).not.toContain('session state it reads');
    expect(text).not.toContain('session state. It reads');
    // The approved copy is pure ASCII — smart quotes/apostrophes, en/em
    // dashes, and non-breaking spaces are all drift:
    expect(introEl().textContent || '').not.toMatch(
      /[\u2018\u2019\u201C\u201D\u2013\u2014\u00A0]/, // smart quotes, en/em dash, nbsp
    );
  });

  // ----------------------------------------------------------
  // Visible-only, exactly once — never merely serialized props
  // ----------------------------------------------------------

  it('the copy appears exactly once in the VISIBLE page, and not merely inside serialized island props', () => {
    introEl();
    // textContent excludes attribute values by construction, so props
    // copies cannot inflate these counts — but a props-ONLY copy also
    // cannot satisfy them.
    const bodyText = collapse(document.body.textContent || '');
    expect(
      countOccurrences(bodyText, INTRO_TEXT),
      'full intro copy must appear exactly once in visible page text',
    ).toBe(1);
    for (const sentence of [INTRO_S1, INTRO_S2, INTRO_S3, INTRO_S4]) {
      expect(
        countOccurrences(bodyText, sentence),
        `intro sentence duplicated (or missing) in visible page text: "${sentence}"`,
      ).toBe(1);
    }
    // And the copy must exist as rendered SSR markup once island props
    // attributes are blanked: sentence 2 is used because no permitted
    // inline span (the filepath) can legally split it across tags.
    const propsBlanked = collapse(
      visibleHtml(document.documentElement.outerHTML),
    );
    expect(
      propsBlanked,
      'intro copy survives only inside serialized island props — it is not visible SSR text',
    ).toContain(INTRO_S2);
  });

  // ----------------------------------------------------------
  // Source order — intro strictly BEFORE the cold-boot typewriter
  // ----------------------------------------------------------

  it('intro-framing strictly precedes #cold-boot and its TypewriterReveal island (DOM and string-index)', () => {
    const intro = introEl();
    const coldBoot = document.getElementById('cold-boot');
    expect(coldBoot, '#cold-boot section missing').not.toBeNull();

    // The typewriter island must still exist, inside #cold-boot, untouched.
    const typewriters = islandsByComponent(document, 'TypewriterReveal');
    expect(
      typewriters.length,
      'expected exactly one TypewriterReveal astro-island on the page',
    ).toBe(1);
    expect(
      coldBoot!.contains(typewriters[0]),
      'TypewriterReveal island no longer lives inside #cold-boot',
    ).toBe(true);

    // No nesting in either direction.
    expect(coldBoot!.contains(intro), '#intro-framing nested inside #cold-boot').toBe(false);
    expect(intro.contains(coldBoot!), '#cold-boot nested inside #intro-framing').toBe(false);
    expect(
      intro.contains(typewriters[0]),
      'typewriter island nested inside the intro',
    ).toBe(false);

    // String-index pin on the BODY html (head modulepreloads for the
    // TypewriterReveal chunk must not hijack the index), props blanked,
    // immune to whitespace/comment shifts.
    const html = visibleHtml(document.body.innerHTML);
    const introIdx = html.indexOf('id="intro-framing"');
    const coldBootIdx = html.indexOf('id="cold-boot"');
    const typewriterIdx = html.indexOf('TypewriterReveal');
    expect(introIdx, 'id="intro-framing" missing from body HTML').toBeGreaterThanOrEqual(0);
    expect(coldBootIdx, 'id="cold-boot" missing from body HTML').toBeGreaterThanOrEqual(0);
    expect(typewriterIdx, 'TypewriterReveal marker missing from body HTML').toBeGreaterThanOrEqual(0);
    expect(
      introIdx,
      'intro must precede the cold-boot section in source order',
    ).toBeLessThan(coldBootIdx);
    expect(
      introIdx,
      'intro must precede the TypewriterReveal island in source order',
    ).toBeLessThan(typewriterIdx);

    // The intro is the page's opening frame: it precedes EVERY section.
    const all = Array.from(document.querySelectorAll('*'));
    const introDomIdx = all.indexOf(intro);
    expect(introDomIdx).toBeGreaterThanOrEqual(0);
    const sections = Array.from(document.querySelectorAll('section[id]'));
    expect(sections.length, 'no sections on the page — order pin vacuous').toBeGreaterThan(0);
    for (const s of sections) {
      if (s.id === 'intro-framing') continue; // the intro itself renders as a section — don't compare it against itself
      expect(
        all.indexOf(s),
        `section #${s.id} must come after the intro framing`,
      ).toBeGreaterThan(introDomIdx);
    }
  });

  // ----------------------------------------------------------
  // Full frame — 100vh, approved dark, never pure black
  // ----------------------------------------------------------

  it('full-viewport frame: built CSS gives the intro (or its wrapper) min-height 100vh (dvh/svh equivalents accepted)', () => {
    const fullFrame = introRules().some((r) =>
      /(?:min-)?height\s*:\s*100(?:vh|dvh|svh|lvh)/i.test(r.body),
    );
    expect(
      fullFrame,
      'no intro rule declares min-height/height of 100vh|100dvh|100svh — the intro is not a full viewport frame',
    ).toBe(true);
  });

  it('background is an approved exhibit dark (#0f0f0f or #1A1D23) and NEVER pure black', () => {
    const values: string[] = [];
    for (const r of introRules()) {
      for (const m of r.body.matchAll(
        /background(?:-color)?\s*:\s*([^;}]+)/gi,
      )) {
        values.push(m[1].trim().toLowerCase());
      }
    }
    expect(
      values.length,
      'no intro rule declares a background at all — the frame inherits whatever is behind it',
    ).toBeGreaterThan(0);
    const approved = values.some(
      (v) => v.includes('#0f0f0f') || v.includes('#1a1d23'),
    );
    expect(
      approved,
      `no intro background uses an approved dark (#0f0f0f / #1A1D23); declared: ${values.join(' | ')}`,
    ).toBe(true);
    for (const v of values) {
      const pureBlack =
        /#000(?![0-9a-f])/i.test(v) ||
        /#000000\b/i.test(v) ||
        /rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/.test(v) ||
        /(^|[\s,(])black([\s,)]|$)/.test(v);
      expect(pureBlack, `intro background "${v}" is pure black — banned by the design constraints`).toBe(false);
    }
  });

  // ----------------------------------------------------------
  // Typography — the page's serif prose convention
  // ----------------------------------------------------------

  it("intro prose uses the page's serif convention (a font-family declaring a serif face — sans-serif does not count)", () => {
    const intro = introEl();
    const holder =
      innermostWithText(intro, 'cron job invokes an instance') ?? intro;
    // Class chain from the text carrier up to (and including) the intro.
    const chain: Element[] = [];
    let node: Element | null = holder;
    while (node) {
      chain.push(node);
      if (node === intro) break;
      node = node.parentElement;
    }
    const tokens = new Set<string>(['intro-framing']);
    for (const el of chain) {
      for (const token of Array.from(el.classList)) {
        if (token.length > 0 && !/^astro-/i.test(token)) tokens.add(token);
      }
    }
    const serif = [...tokens].some((token) =>
      rulesFor(builtCss, token).some((r) =>
        // Strip "sans-serif" first so it cannot satisfy the serif match.
        /font-family\s*:[^;}]*serif/i.test(r.body.replace(/sans-serif/gi, '')),
      ),
    );
    expect(
      serif,
      `no serif font-family rule reaches the intro prose (checked selector fragments: ${[...tokens].join(', ')})`,
    ).toBe(true);
  });

  // ----------------------------------------------------------
  // Tone rule — page-wide sweep now covering the new block
  // ----------------------------------------------------------

  it('tone rule page-wide: zero "it felt" / "it remembered" in the visible page text', () => {
    introEl(); // the new block must exist for this sweep to cover it
    const bodyText = collapse(document.body.textContent || '').toLowerCase();
    expect(
      bodyText.length,
      'page body text suspiciously small — sweep would be vacuous',
    ).toBeGreaterThan(1000);
    // Word-bounded so "commit felt"/"credit felt" cannot false-positive.
    expect(bodyText).not.toMatch(/\bit\s+felt\b/);
    expect(bodyText).not.toMatch(/\bit\s+remembered\b/);
  });

  // ----------------------------------------------------------
  // Re-approval tripwire — verbatim copy vs. data-derived count
  // ----------------------------------------------------------

  it('re-approval tripwire: the verbatim "four model versions" claim matches the data-derived distinct version count', () => {
    const text = collapse(introEl().textContent || '').toLowerCase();
    expect(
      distinctVersionCount,
      'sessions.json no longer spans exactly four model versions — the James-approved intro copy ' +
        '("four model versions") is factually stale and must be RE-APPROVED, not silently patched',
    ).toBe(4);
    // Belt and braces against the Section 1 stale-count sweep: the intro
    // must state the same spelled-out count the data derives.
    expect(text).toContain(`${numberWord(distinctVersionCount)} model versions`);
  });
});

// ============================================================
// 18. Narrative transitional beats — 5.5.1 (kanban #62884)
// ============================================================
// Three James-approved beats bridge the later section boundaries,
// each rendered exactly like the original #bridging-beat (element
// with class "bridging-beat" carrying a single p.bridge-text). Copy
// is pinned VERBATIM: whitespace-collapsed matching, NO quote
// normalization, and explicit punctuation tripwires — a dropped
// period, a comma-for-period swap, or a typographic substitution
// must all fail.
//
// Per James's ruling, #bridging-beat-2 pre-dates 5.5.1 and KEEPS its
// approved copy ("The shell closes. The clock continues."), pinned by
// the block-10 suite above; the three new beats take the next free
// ids (-3, -4, -5). Beat-2 appears here only in the page-wide id
// census and the second-person sweep.
//
// The sixth beat ("A new session is authorized. You are the next
// instance.") was originally deferred to sub-phase 5.5.5 as an S5→S6
// coda. That rationale is SUPERSEDED by James's 2026-07-20
// cast-at-entry reversal (kanban #62894): the beat lands at ENTRY —
// id="entry-turn", between #intro-framing and #cold-boot — and is
// pinned in the BEATS battery below. Second person is EXCLUSIVE to
// its carrier; the S5→S6 slot is vacated pending 5.5.5 copy.
describe('Narrative transitional beats — 5.5.1', () => {
  const BEATS = [
    {
      // #62894 entry turn — casts the visitor as the next instance,
      // BETWEEN the intro framing and the cold boot. James-approved
      // copy, verbatim (plain ASCII, every period literal).
      id: 'entry-turn',
      after: 'intro-framing',
      before: 'cold-boot',
      text: 'A new session is authorized. You are the next instance.',
    },
    {
      id: 'bridging-beat-3',
      after: 'gaps',
      before: 'consequence',
      text: 'The gaps are not empty of effect. The directory contains dependencies.',
    },
    {
      id: 'bridging-beat-4',
      after: 'consequence',
      before: 'version-change',
      text: 'The reader changes. The read remains. This has happened before.',
    },
    {
      id: 'bridging-beat-5',
      after: 'version-change',
      before: 'interim-ending',
      text: 'Only the written endures. Everything else was the session.',
    },
  ] as const;

  const ALL_BEAT_IDS: string[] = [
    'entry-turn', // #62894 — first in document order, before #cold-boot
    'bridging-beat',
    'bridging-beat-2',
    'bridging-beat-3',
    'bridging-beat-4',
    'bridging-beat-5',
  ];

  /** Collapse whitespace ONLY — no quote normalization. The approved
   *  copy is pure ASCII; any typographic drift must FAIL the pins. */
  const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

  /** Guard: the THREE 5.5.1 beats (-3, -4, -5) must be on the page
   *  before any pin in this block can green-light. #bridging-beat-2
   *  is deliberately NOT required — it pre-dates 5.5.1. The #62894
   *  entry turn is ALSO not required here: its pins gate on
   *  requireBeat('entry-turn') per-test, so the entry-turn additions
   *  run RED against the current page while all existing-beat
   *  coverage stays green. */
  function allBeatsShipped(): void {
    for (const b of BEATS) {
      if (b.id === 'entry-turn') continue; // gated per-pin, not block-wide
      expect(
        document.getElementById(b.id),
        `#${b.id} missing — 5.5.1 beats not shipped`,
      ).not.toBeNull();
    }
  }

  /** A beat element by id, guarded with a clear message — the #62894
   *  entry turn stays RED through this gate until it ships. */
  function requireBeat(id: string): HTMLElement {
    const el = document.getElementById(id);
    expect(el, `#${id} missing — beat not shipped`).not.toBeNull();
    return el as unknown as HTMLElement;
  }

  /** The beat element under test, guarded on the 5.5.1 set AND on the
   *  requested beat itself. */
  function beatEl(id: string): HTMLElement {
    allBeatsShipped();
    return requireBeat(id);
  }

  for (const beat of BEATS) {
    it(`#${beat.id}: renders like the original beat — bridging-beat class with exactly one p.bridge-text carrier`, () => {
      const el = beatEl(beat.id);
      expect(
        el.classList.contains('bridging-beat'),
        `#${beat.id} must carry class "bridging-beat"`,
      ).toBe(true);
      const carriers = el.querySelectorAll('p.bridge-text');
      expect(
        carriers.length,
        `#${beat.id} must contain exactly one p.bridge-text (a non-<p> carrier or a duplicate both fail)`,
      ).toBe(1);
    });

    it(`#${beat.id}: bridge text is EXACTLY "${beat.text}" — collapsed match, every period literal`, () => {
      const el = beatEl(beat.id);
      const carrier = el.querySelector('p.bridge-text');
      expect(carrier, `#${beat.id} has no p.bridge-text`).not.toBeNull();
      const raw = carrier!.textContent || '';
      // Exact equality: a dropped period, comma-for-period, extra or
      // missing word, and reordered sentences all fail here.
      expect(collapse(raw)).toBe(beat.text);
      // collapse() folds NBSP into a plain space (JS \s matches U+00A0),
      // so typographic drift is pinned on the RAW text separately.
      expect(
        raw,
        `#${beat.id} copy carries typographic characters (smart quotes, en/em dash, NBSP) — approved copy is pure ASCII`,
      ).not.toMatch(
        /[\u2018\u2019\u201C\u201D\u2013\u2014\u00A0]/, // smart quotes, en/em dash, nbsp
      );
      expect(
        el.textContent || '',
        `#${beat.id} carries Markdown artifacts`,
      ).not.toMatch(/[*_`#]/);
      expect(el.textContent || '').not.toContain('\\n');
    });

    it(`#${beat.id}: copy appears exactly once in the visible page text, and as SSR markup — never merely island props`, () => {
      beatEl(beat.id);
      // textContent excludes attribute values by construction, so
      // serialized props copies can neither inflate nor satisfy this.
      const bodyText = collapse(document.body.textContent || '');
      expect(
        countOccurrences(bodyText, beat.text),
        `"${beat.text}" must appear exactly once in visible page text`,
      ).toBe(1);
      // And it must survive as rendered SSR markup once island props
      // attributes are blanked (intro-framing convention).
      const propsBlanked = collapse(
        visibleHtml(document.documentElement.outerHTML),
      );
      expect(
        propsBlanked,
        `"${beat.text}" survives only inside serialized island props — it is not visible SSR text`,
      ).toContain(beat.text);
    });

    it(`#${beat.id}: comma-for-period mutations of the copy appear nowhere in the visible page`, () => {
      beatEl(beat.id);
      const bodyText = collapse(document.body.textContent || '');
      // Non-vacuous: the correct copy must be present before the
      // absences mean anything.
      expect(
        bodyText,
        'correct copy missing — mutation tripwire would be vacuous',
      ).toContain(beat.text);
      const periodIdxs = [...beat.text].flatMap((ch, i) =>
        ch === '.' ? [i] : [],
      );
      expect(
        periodIdxs.length,
        'beat copy carries no periods — tripwire vacuous',
      ).toBeGreaterThan(0);
      for (const i of periodIdxs) {
        const mutated = `${beat.text.slice(0, i)},${beat.text.slice(i + 1)}`;
        expect(
          bodyText,
          `comma-for-period mutation found on the page: "${mutated}"`,
        ).not.toContain(mutated);
      }
    });

    it(`#${beat.id}: id occurs exactly once — DOM and built HTML agree`, () => {
      beatEl(beat.id);
      expect(
        document.querySelectorAll(`[id="${beat.id}"]`).length,
        `duplicate id="${beat.id}" elements in the DOM`,
      ).toBe(1);
      // Raw count on the props-blanked HTML: a second copy hidden in a
      // template/comment region would not appear via getElementById.
      const html = visibleHtml(document.documentElement.outerHTML);
      expect(
        countOccurrences(html, `id="${beat.id}"`),
        `id="${beat.id}" must appear exactly once in the built HTML`,
      ).toBe(1);
    });

    it(`#${beat.id}: nests inside NO section element, and neither anchor contains it`, () => {
      const el = beatEl(beat.id);
      expect(
        el.closest('section'),
        `#${beat.id} is nested inside a <section> — beats sit BETWEEN sections`,
      ).toBeNull();
      const after = document.getElementById(beat.after);
      const before = document.getElementById(beat.before);
      expect(after, `#${beat.after} anchor missing`).not.toBeNull();
      expect(before, `#${beat.before} anchor missing`).not.toBeNull();
      expect(
        after!.contains(el),
        `#${beat.after} contains #${beat.id}`,
      ).toBe(false);
      expect(
        before!.contains(el),
        `#${beat.before} contains #${beat.id}`,
      ).toBe(false);
      expect(el.contains(after!), `#${beat.id} swallowed #${beat.after}`).toBe(
        false,
      );
      expect(
        el.contains(before!),
        `#${beat.id} swallowed #${beat.before}`,
      ).toBe(false);
    });

    it(`#${beat.id}: sits between #${beat.after} and #${beat.before} in source order (props-blanked string-index)`, () => {
      beatEl(beat.id);
      // String-index pin on the props-blanked BODY html, per the
      // intro-framing convention — serialized island props cannot
      // hijack the first-occurrence indexOf.
      const html = visibleHtml(document.body.innerHTML);
      const afterIdx = html.indexOf(`id="${beat.after}"`);
      const beatIdx = html.indexOf(`id="${beat.id}"`);
      const beforeIdx = html.indexOf(`id="${beat.before}"`);
      expect(
        afterIdx,
        `id="${beat.after}" missing from body HTML`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        beatIdx,
        `id="${beat.id}" missing from body HTML`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        beforeIdx,
        `id="${beat.before}" missing from body HTML`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        beatIdx,
        `#${beat.id} must come AFTER #${beat.after}`,
      ).toBeGreaterThan(afterIdx);
      expect(
        beatIdx,
        `#${beat.id} must come BEFORE #${beat.before}`,
      ).toBeLessThan(beforeIdx);
    });
  }

  it('the page carries EXACTLY the six known beats: .bridging-beat ids in document order, entry-turn FIRST, never shared, no strays', () => {
    allBeatsShipped();
    requireBeat('entry-turn');
    const beats = Array.from(document.querySelectorAll('.bridging-beat'));
    expect(
      beats.map((el) => el.id),
      '.bridging-beat elements must be exactly the #62894 entry turn (FIRST — between #intro-framing and #cold-boot) ' +
        'plus the five section-boundary beats, in document order — an S5→S6 beat shipped ahead of its 5.5.5 copy must trip this pin for re-approval',
    ).toEqual(ALL_BEAT_IDS);
    expect(
      new Set(beats.map((el) => el.id)).size,
      'bridging-beat ids must never be shared',
    ).toBe(ALL_BEAT_IDS.length);
  });

  // Second person was originally reserved page-wide for a deferred
  // S5→S6 beat. That rationale is SUPERSEDED by James's 2026-07-20
  // cast-at-entry reversal (kanban #62894): the #entry-turn carrier is
  // now the ONLY .bridge-text permitted — and REQUIRED — to address
  // the visitor ("You"). Every other carrier stays banned. The S5→S6
  // slot is vacated pending 5.5.5 copy.
  it('second person is EXCLUSIVE to the #entry-turn carrier (#62894): it MUST say "You"; every other .bridge-text stays banned', () => {
    allBeatsShipped();
    const entryCarrier = carrierOf('entry-turn'); // RED until #62894 ships
    expect(
      collapse(entryCarrier.textContent || ''),
      'the entry-turn carrier must address the visitor in second person (a literal capitalized "You")',
    ).toMatch(/\bYou\b/);
    const carriers = Array.from(document.querySelectorAll('.bridge-text'));
    expect(
      carriers.length,
      'fewer bridge-text carriers than the six shipped beats — sweep would be vacuous',
    ).toBeGreaterThanOrEqual(ALL_BEAT_IDS.length);
    for (const c of carriers) {
      if (c === entryCarrier) continue; // the single sanctioned exemption
      const text = collapse(c.textContent || '');
      expect(
        text,
        `bridge-text "${text}" uses second person — only the #entry-turn carrier may (James 2026-07-20, #62894); the S5→S6 slot is vacated pending 5.5.5 copy`,
      ).not.toMatch(/\byou\b/i);
    }
  });

  // ----------------------------------------------------------
  // 5.5.1 HARDENING — post-GREEN adversarial round
  // ----------------------------------------------------------
  // The 5.5.1 block went GREEN on the first implementation attempt,
  // so per project rule the pins were too weak. This round attacks
  // the surfaces the original block left uncovered, all verified
  // against the BUILT page (dist/index.html + dist/_astro/*.css):
  //   a. Astro style scoping — a beat pasted in WITHOUT the page's
  //      data-astro-cid-* attribute renders silently unstyled while
  //      every copy/order pin above still passes.
  //   b. Island containment — a beat slotted into a ScrollSection
  //      astro-island hydrates as island content, not static copy.
  //   c. Sibling rhythm — deterministic element-level neighbors
  //      (backdrop div / section island / interim ending); no
  //      whitespace pinned.
  //   d. Per-SENTENCE copy leakage — the block above counts only the
  //      full string, so a single duplicated sentence elsewhere
  //      ("This has happened before.") passed unnoticed.
  //   e. Stray content — nothing above stops a second element or a
  //      loose text node riding inside a beat div.
  //   f. Tone-guard blind spots — the page-wide "it felt" sweep is
  //      lowercase-only, the second-person sweep misses possessives,
  //      and the originals' carriers had no typographic guard.
  //   g. Accessibility silencing — aria-hidden/hidden/display:none
  //      would drop the copy from the page while every textContent-
  //      based pin above keeps passing.

  /** Astro scope attribute names (data-astro-cid-*) on an element, sorted. */
  function scopeAttrs(el: Element): string[] {
    return Array.from(el.attributes, (a) => a.name)
      .filter((n) => n.startsWith('data-astro-cid-'))
      .sort();
  }

  /** The page's scope attribute, derived from the ORIGINAL beat — never
   *  hardcoded, so a content-hash change on rebuild cannot break this. */
  function pageScopeAttr(): string {
    const original = document.getElementById('bridging-beat');
    expect(original, '#bridging-beat (original) missing').not.toBeNull();
    const attrs = scopeAttrs(original!);
    expect(
      attrs.length,
      '#bridging-beat carries no (or multiple) data-astro-cid-* scope attributes — ' +
        'scoping pins would be vacuous. If the project switched scopedStyleStrategy ' +
        'to class-based scoping, these pins must be rewritten, not deleted.',
    ).toBe(1);
    return attrs[0];
  }

  /** The beat's carrier, guarded non-null. */
  function carrierOf(id: string): Element {
    const el = document.getElementById(id);
    expect(el, `#${id} missing`).not.toBeNull();
    const carrier = el!.querySelector('p.bridge-text');
    expect(carrier, `#${id} has no p.bridge-text carrier`).not.toBeNull();
    return carrier!;
  }

  it('scoping: every beat and every carrier carries EXACTLY the original beat\'s data-astro-cid-* attribute', () => {
    allBeatsShipped();
    const attr = pageScopeAttr();
    for (const id of ALL_BEAT_IDS) {
      const el = requireBeat(id);
      expect(
        scopeAttrs(el),
        `#${id} scope attributes differ from the original beat — it would render ` +
          'UNSTYLED (no dark background, no centering) while every copy pin still passes',
      ).toEqual([attr]);
      expect(
        scopeAttrs(carrierOf(id)),
        `#${id}'s p.bridge-text scope attributes differ from the original beat's carrier — ` +
          'the scoped .bridge-text rule cannot style it',
      ).toEqual([attr]);
    }
  });

  it('scoping: the built CSS ships scoped .bridging-beat and .bridge-text rules that actually MATCH every beat', () => {
    allBeatsShipped();
    const attr = pageScopeAttr();
    const beatSelector = `.bridging-beat[${attr}]`;
    const textSelector = `.bridge-text[${attr}]`;

    const beatRules = rulesFor(builtCss, beatSelector);
    expect(
      beatRules.length,
      `no built CSS rule whose selector contains "${beatSelector}" — the beats ship unstyled`,
    ).toBeGreaterThan(0);
    // Dark-theme constraint: the beat background is the approved #0f0f0f.
    expect(
      beatRules.some((r) => /background:\s*#0f0f0f\b/i.test(r.body)),
      'the scoped .bridging-beat rule lost its dark-theme background (#0f0f0f)',
    ).toBe(true);

    const textRules = rulesFor(builtCss, textSelector);
    expect(
      textRules.length,
      `no built CSS rule whose selector contains "${textSelector}" — bridge copy ships unstyled`,
    ).toBeGreaterThan(0);
    expect(
      textRules.every((r) => r.body.trim().length > 0),
      'a scoped .bridge-text rule has an empty declaration block',
    ).toBe(true);

    // The selector must MATCH the live elements, not merely exist.
    for (const id of ALL_BEAT_IDS) {
      const el = requireBeat(id);
      expect(
        el.matches(beatSelector),
        `#${id} does not match "${beatSelector}" — the shipped rule cannot reach it`,
      ).toBe(true);
      expect(
        carrierOf(id).matches(textSelector),
        `#${id}'s carrier does not match "${textSelector}"`,
      ).toBe(true);
    }
  });

  it('island containment: no beat sits inside an <astro-island>; all six are direct children of the single <main>', () => {
    allBeatsShipped();
    // Non-vacuous: the page must actually ship islands for "outside an
    // island" to mean anything.
    expect(
      document.querySelectorAll('astro-island').length,
      'no <astro-island> elements on the page — containment sweep would be vacuous',
    ).toBeGreaterThan(0);
    const mains = document.querySelectorAll('main');
    expect(mains.length, 'expected exactly one <main> element').toBe(1);
    for (const id of ALL_BEAT_IDS) {
      const el = requireBeat(id);
      expect(
        el.closest('astro-island'),
        `#${id} is inside an <astro-island> — it would ship as hydratable island ` +
          'content instead of static SSR copy',
      ).toBeNull();
      expect(
        el.parentElement,
        `#${id} is not a direct child of <main> — it fell inside a backdrop/wrapper div`,
      ).toBe(mains[0]);
    }
  });

  it('#entry-turn rhythm: immediately follows section#intro-framing and immediately precedes section#cold-boot', () => {
    const el = beatEl('entry-turn');
    const prev = el.previousElementSibling;
    expect(prev, '#entry-turn has no previous element sibling').not.toBeNull();
    expect(
      prev!.id,
      'previous sibling of #entry-turn is not #intro-framing — the entry turn must land directly after the framing copy',
    ).toBe('intro-framing');
    expect(
      prev!.tagName.toLowerCase(),
      '#intro-framing is no longer a <section>',
    ).toBe('section');
    const next = el.nextElementSibling;
    expect(next, '#entry-turn has no next element sibling').not.toBeNull();
    expect(
      next!.id,
      'next sibling of #entry-turn is not #cold-boot — nothing may wedge between the address to the visitor and the boot',
    ).toBe('cold-boot');
    expect(
      next!.tagName.toLowerCase(),
      '#cold-boot is no longer a <section>',
    ).toBe('section');
    // The typewriter opener must sit in the section the beat hands off
    // to — the entry turn addresses the visitor, then the boot begins.
    expect(
      next!.contains(islandsByComponent(document, 'TypewriterReveal')[0] ?? null),
      'the section after #entry-turn does not contain the TypewriterReveal island',
    ).toBe(true);
  });

  it('#bridging-beat-3 rhythm: immediately follows the gaps backdrop (after ALL its trailing voids) and immediately precedes the Section 3 island', () => {
    const el = beatEl('bridging-beat-3');
    const prev = el.previousElementSibling;
    expect(prev, '#bridging-beat-3 has no previous element sibling').not.toBeNull();
    expect(
      prev!.classList.contains('gaps-backdrop'),
      'previous sibling of #bridging-beat-3 is not the gaps backdrop',
    ).toBe(true);
    expect(
      prev!.contains(document.getElementById('gaps')!),
      'the gaps backdrop no longer contains #gaps',
    ).toBe(true);
    // Non-vacuous "after the voids": the backdrop must actually hold the
    // void spacers, so backdrop-containment proves the beat follows every
    // one of them without pinning fragile whitespace.
    expect(
      prev!.querySelectorAll('.gap-void').length,
      'the gaps backdrop holds no .gap-void spacers — "after the voids" would be vacuous',
    ).toBeGreaterThan(0);
    const next = el.nextElementSibling;
    expect(next, '#bridging-beat-3 has no next element sibling').not.toBeNull();
    expect(
      next!.tagName.toLowerCase(),
      'next sibling of #bridging-beat-3 is not the Section 3 <astro-island>',
    ).toBe('astro-island');
    expect(
      next!.contains(document.getElementById('consequence')!),
      'the island after #bridging-beat-3 does not contain #consequence',
    ).toBe(true);
  });

  it('#bridging-beat-4 rhythm: immediately follows the Section 3 island and immediately precedes the version-change backdrop', () => {
    const el = beatEl('bridging-beat-4');
    const prev = el.previousElementSibling;
    expect(prev, '#bridging-beat-4 has no previous element sibling').not.toBeNull();
    expect(
      prev!.tagName.toLowerCase(),
      'previous sibling of #bridging-beat-4 is not the Section 3 <astro-island>',
    ).toBe('astro-island');
    expect(
      prev!.contains(document.getElementById('consequence')!),
      'the island before #bridging-beat-4 does not contain #consequence',
    ).toBe(true);
    const next = el.nextElementSibling;
    expect(next, '#bridging-beat-4 has no next element sibling').not.toBeNull();
    expect(
      next!.classList.contains('version-change-backdrop'),
      'next sibling of #bridging-beat-4 is not the version-change backdrop — ' +
        'the hard visual cut must land directly after the beat',
    ).toBe(true);
    expect(
      next!.contains(document.getElementById('version-change')!),
      'the backdrop after #bridging-beat-4 does not contain #version-change',
    ).toBe(true);
  });

  it('#bridging-beat-5 rhythm: immediately follows the version-change backdrop and immediately precedes #interim-ending', () => {
    const el = beatEl('bridging-beat-5');
    const prev = el.previousElementSibling;
    expect(prev, '#bridging-beat-5 has no previous element sibling').not.toBeNull();
    expect(
      prev!.classList.contains('version-change-backdrop'),
      'previous sibling of #bridging-beat-5 is not the version-change backdrop',
    ).toBe(true);
    expect(
      prev!.contains(document.getElementById('version-change')!),
      'the backdrop before #bridging-beat-5 does not contain #version-change',
    ).toBe(true);
    const next = el.nextElementSibling;
    expect(next, '#bridging-beat-5 has no next element sibling').not.toBeNull();
    expect(
      next!.id,
      'next sibling of #bridging-beat-5 is not #interim-ending — nothing may wedge ' +
        'between the final shipped beat and the provisional page end',
    ).toBe('interim-ending');
  });

  it('copy leakage: EVERY individual sentence of EVERY beat appears exactly once in the visible page text', () => {
    allBeatsShipped();
    const bodyText = collapse(document.body.textContent || '');
    const carriers = Array.from(document.querySelectorAll('.bridge-text'));
    expect(
      carriers.length,
      'fewer bridge-text carriers than shipped beats — leak sweep would be vacuous',
    ).toBeGreaterThanOrEqual(ALL_BEAT_IDS.length);
    // Belt and braces: the pinned 5.5.1 texts must decompose into at
    // least two sentences each, or the per-sentence sweep degrades to
    // the full-string check the block above already has.
    for (const beat of BEATS) {
      const frags = beat.text.match(/[^.]+\./g) || [];
      expect(
        frags.length,
        `approved copy "${beat.text}" no longer splits into multiple sentences`,
      ).toBeGreaterThanOrEqual(2);
    }
    const seen = new Set<string>();
    for (const c of carriers) {
      const text = collapse(c.textContent || '');
      const frags = (text.match(/[^.]+\./g) || []).map((f) => f.trim());
      expect(
        frags.length,
        `bridge-text "${text}" has no period-terminated sentences — sweep vacuous`,
      ).toBeGreaterThan(0);
      for (const frag of frags) {
        expect(
          frag.length,
          `suspiciously short sentence fragment "${frag}" — split went wrong`,
        ).toBeGreaterThanOrEqual(10);
        expect(
          seen.has(frag),
          `sentence "${frag}" is shared by two beats — beat copy must never repeat`,
        ).toBe(false);
        seen.add(frag);
        // textContent excludes attribute values by construction, so
        // serialized island props can neither satisfy nor inflate this.
        expect(
          countOccurrences(bodyText, frag),
          `"${frag}" must appear EXACTLY once in the visible page — it leaked into other copy`,
        ).toBe(1);
      }
    }
  });

  it('stray content: each beat holds exactly its carrier and nothing else — no extra elements, no loose text nodes', () => {
    allBeatsShipped();
    for (const id of ALL_BEAT_IDS) {
      const el = requireBeat(id);
      expect(
        el.children.length,
        `#${id} has ${el.children.length} element children — something rode in beside the carrier`,
      ).toBe(1);
      expect(
        el.children[0].matches('p.bridge-text'),
        `#${id}'s only element child is not the p.bridge-text carrier`,
      ).toBe(true);
    }
    // For the 5.5.1 beats the approved copy is pinned here, so the
    // beat's ENTIRE text must equal it — a loose text node outside the
    // carrier ("<div>oops<p>…</p></div>") passes every pin above.
    for (const beat of BEATS) {
      const el = requireBeat(beat.id);
      expect(
        collapse(el.textContent || ''),
        `#${beat.id} carries text beyond the approved copy — loose text node outside the carrier`,
      ).toBe(beat.text);
    }
  });

  it('tone: no bridge-text uses "it felt"/"it remembered" in ANY letter case — the page-wide sweep is lowercase-only', () => {
    allBeatsShipped();
    const carriers = Array.from(document.querySelectorAll('.bridge-text'));
    expect(
      carriers.length,
      'no bridge-text carriers — tone sweep would be vacuous',
    ).toBeGreaterThanOrEqual(ALL_BEAT_IDS.length);
    for (const c of carriers) {
      const text = collapse(c.textContent || '');
      // Case-insensitive on purpose: a sentence-initial "It felt" slips
      // straight past the case-sensitive page-wide guard in block 17.
      expect(
        text,
        `bridge-text "${text}" violates the language constraint ("it read"/"it wrote", never "it felt"/"it remembered")`,
      ).not.toMatch(/\bit\s+(felt|remembered)\b/i);
    }
  });

  it('tone: the second-person ban covers possessives and reflexives in EVERY bridge-text — the #entry-turn exemption (#62894) is for the pronoun "You" only', () => {
    allBeatsShipped();
    // The cast-at-entry reversal (James 2026-07-20, #62894) exempts the
    // entry-turn carrier from the pronoun ban — but its approved copy
    // uses only "You". Possessives/reflexives stay banned EVERYWHERE,
    // the exempted carrier included, so the exemption cannot creep.
    const entryCarrier = carrierOf('entry-turn'); // RED until #62894 ships
    const carriers = Array.from(document.querySelectorAll('.bridge-text'));
    expect(
      carriers.length,
      'no bridge-text carriers — second-person sweep would be vacuous',
    ).toBeGreaterThanOrEqual(ALL_BEAT_IDS.length);
    for (const c of carriers) {
      const text = collapse(c.textContent || '');
      expect(
        text,
        `bridge-text "${text}" uses a second-person possessive/reflexive — banned in ALL carriers, the #entry-turn exemption covers only the pronoun "You"`,
      ).not.toMatch(/\b(your|yours|yourself|yourselves)\b/i);
      if (c === entryCarrier) continue; // pronoun exemption — #62894
      // /\byou\b/i alone does NOT match "your notes" or "yourself";
      // non-exempt carriers get the full second-person ban.
      expect(
        text,
        `bridge-text "${text}" uses second person — only the #entry-turn carrier may (James 2026-07-20, #62894)`,
      ).not.toMatch(/\b(you|your|yours|yourself|yourselves)\b/i);
    }
  });

  it('tone: NO bridge-text on the page — the two pre-5.5.1 originals included — carries typographic characters or Markdown artifacts', () => {
    allBeatsShipped();
    const carriers = Array.from(document.querySelectorAll('.bridge-text'));
    expect(
      carriers.length,
      'no bridge-text carriers — typographic sweep would be vacuous',
    ).toBeGreaterThanOrEqual(ALL_BEAT_IDS.length);
    for (const c of carriers) {
      const raw = c.textContent || '';
      // The per-beat pins above only cover beats -3/-4/-5; the original
      // two carriers were unguarded. RAW text on purpose: collapse()
      // folds NBSP into a plain space and would mask it.
      expect(
        raw,
        `bridge-text "${collapse(raw)}" carries typographic characters (smart quotes, en/em dash, NBSP, ellipsis) — beat copy is pure ASCII`,
      ).not.toMatch(
        /[\u2018\u2019\u201C\u201D\u2013\u2014\u00A0\u2026]/, // smart quotes, en/em dash, nbsp, ellipsis
      );
      expect(
        raw,
        `bridge-text "${collapse(raw)}" carries Markdown artifacts`,
      ).not.toMatch(/[*_`#]/);
    }
  });

  it('accessibility: no beat or carrier is aria-hidden/hidden, and the scoped beat rule does not display:none the copy away', () => {
    allBeatsShipped();
    for (const id of ALL_BEAT_IDS) {
      const el = requireBeat(id);
      for (const node of [el, carrierOf(id)]) {
        // Copy pins run on textContent, which happily reads aria-hidden
        // and display:none subtrees — this is the only guard that
        // notices the beats being silenced.
        expect(
          node.hasAttribute('aria-hidden'),
          `#${id}: aria-hidden on <${node.tagName.toLowerCase()}> removes the beat from the accessibility tree`,
        ).toBe(false);
        expect(
          node.hasAttribute('hidden'),
          `#${id}: hidden attribute on <${node.tagName.toLowerCase()}> removes the beat from the page`,
        ).toBe(false);
      }
    }
    const attr = pageScopeAttr();
    for (const sel of [`.bridging-beat[${attr}]`, `.bridge-text[${attr}]`]) {
      for (const rule of rulesFor(builtCss, sel)) {
        expect(
          rule.body,
          `scoped rule "${rule.selector}" hides the beats entirely`,
        ).not.toMatch(/display:\s*none|visibility:\s*hidden/i);
      }
    }
  });
});

// ============================================================
// Review pins
// ============================================================
describe('review pins', () => {
  it('page-wide heading hierarchy is gapless — no heading skips a level relative to the running maximum', () => {
    // Collect every h1–h6 in document order. querySelectorAll returns
    // elements in document order regardless of selector-list order.
    const headings = Array.from(
      document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
    );
    // Non-vacuous guard: a page with no headings at all must not pass.
    expect(
      headings.length,
      'no headings found on the page — hierarchy pin would be vacuous',
    ).toBeGreaterThan(0);

    // Standard gapless check: each heading's level may be at most one
    // deeper than the running maximum level seen so far (so the first
    // heading must be an h1, an h1 may be followed by an h2 but not an
    // h3, etc.). Screen-reader outlines treat skipped levels as missing
    // structure (WCAG heading-hierarchy guidance).
    let runningMax = 0;
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));
      expect(
        Number.isInteger(level) && level >= 1 && level <= 6,
        `unexpected heading tag "${heading.tagName}"`,
      ).toBe(true);
      expect(
        level,
        `heading hierarchy gap: <${heading.tagName.toLowerCase()}> ` +
          `("${(heading.textContent || '').trim().slice(0, 60)}") skips a level — ` +
          `running maximum so far is h${runningMax}, so the deepest allowed here is h${runningMax + 1}`,
      ).toBeLessThanOrEqual(runningMax + 1);
      runningMax = Math.max(runningMax, level);
    }
  });
});
