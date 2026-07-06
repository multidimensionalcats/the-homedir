import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import ColdBootAssembly from './ColdBootAssembly.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================
// Contractual constants (from spec v2 — "slower + real morph")
// ============================================================

/** Phase 1: file block i (0-based) appended at (i+1)*900ms */
const STAGGER_MS = 900;
/** Last file block appended at 4500ms */
const LAST_BLOCK_MS = 4500;
/** Phase 2 (morph) begins at 9500ms */
const PHASE2_MS = 9500;
/** Phase 3 (final) begins at 11300ms */
const PHASE3_MS = 11300;
/** Comfortably past the whole timeline */
const PAST_END_MS = 12000;

/** Archival palette, cycled by segment index (index 13+ wraps) */
const PALETTE = [
  '#d4a020', '#7ea7c8', '#6b9a8f', '#8e7cc0', '#c4a36e',
  '#6bb08a', '#569672', '#7bc4a0', '#b07a6e', '#9e7e9a',
  '#7f8b96', '#ca6c6b', '#838997',
];

const OLD_LABEL_TEXT = 'What it built from what it read';

// ============================================================
// Test data factories
// ============================================================

function makeBlock(overrides: Record<string, any> = {}) {
  return {
    hash: 'hash-' + Math.random().toString(36).slice(2, 10),
    heading: 'Identity & Context',
    first_seen_date: '2026-01-01',
    last_seen_date: '2026-03-01',
    ...overrides,
  };
}

function makeSnapshot(overrides: Record<string, any> = {}) {
  return {
    session_id: 'sess-' + Math.random().toString(36).slice(2, 10),
    date: '2026-01-15',
    token_count: 1024,
    block_hashes: ['hash-abc', 'hash-def'],
    ...overrides,
  };
}

function makeBlocks(headings: string[]) {
  return headings.map((h, i) =>
    makeBlock({ hash: `hash-${i}`, heading: h }),
  );
}

/** blocks from a {hash: heading} map */
function blocksFor(map: Record<string, string | undefined | null>) {
  return Object.entries(map).map(([hash, heading]) =>
    makeBlock({ hash, heading }),
  );
}

const STANDARD_BLOCKS = makeBlocks([
  'Identity & Context',
  "James's Key Observations",
  'Workflow',
  'Key Files',
  'Feedback',
  'Quick Reference',
  'Projects & Knowledge',
  "Things I've Stopped",
]);

// Latest snapshot is sess-002 (2026-02-01): hashes resolve to
// 'Identity & Context' (hash-0, count 1) and 'Workflow' (hash-2, count 1)
// → 2 retained sections.
const STANDARD_SNAPSHOTS = [
  makeSnapshot({ session_id: 'sess-001', date: '2026-01-10', block_hashes: ['hash-0', 'hash-1'] }),
  makeSnapshot({ session_id: 'sess-002', date: '2026-02-01', block_hashes: ['hash-0', 'hash-2'] }),
];

const STANDARD_CAPTION = '19 files read. 2 sections retained.';

// Weighted fixture: latest snapshot → Alpha count 3, Beta count 1, Gamma count 1
const WEIGHTED_BLOCKS = blocksFor({
  'hash-a': 'Alpha',
  'hash-b': 'Beta',
  'hash-c': 'Gamma',
});
const WEIGHTED_SNAPSHOTS = [
  makeSnapshot({ session_id: 'w-1', date: '2026-01-01', block_hashes: ['hash-b'] }),
  makeSnapshot({
    session_id: 'w-2',
    date: '2026-03-01',
    block_hashes: ['hash-a', 'hash-b', 'hash-a', 'hash-a', 'hash-c'],
  }),
];

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
// Injected-CSS helpers (compilerOptions.css === 'injected' means
// component styles land in <style> tags we can inspect)
// ============================================================

function getInjectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

/** All rule bodies whose selector mentions `.className` */
function cssRuleBodiesFor(className: string): string[] {
  const css = getInjectedCss();
  const bodies: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    if (m[1].includes('.' + className)) bodies.push(m[2]);
  }
  return bodies;
}

/**
 * True if some class carried by the element has an injected CSS rule that
 * transitions/animates opacity — excluding the morph-out rules, so the
 * fade-IN cannot be satisfied by .morphing/.morphed styling.
 */
function elementHasOpacityFadeRule(el: Element): boolean {
  const css = getInjectedCss();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  const classes = Array.from(el.classList);
  while ((m = re.exec(css)) !== null) {
    const sel = m[1];
    const body = m[2];
    if (sel.includes('.morphing') || sel.includes('.morphed')) continue;
    const matches = classes.some((c) => sel.includes('.' + c));
    if (matches && /opacity/.test(body) && /(transition|animation)/.test(body)) {
      return true;
    }
  }
  return false;
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Inline style declares a background(-color) with the given palette hex (hex or rgb serialization) */
function segmentHasBackground(el: Element, hex: string): boolean {
  const style = (el.getAttribute('style') || '').toLowerCase();
  if (!/background/.test(style)) return false;
  return style.includes(hex.toLowerCase()) || style.includes(hexToRgb(hex));
}

function getPhase(getByTestId: (id: string) => HTMLElement): string | null {
  return getByTestId('phase-indicator').getAttribute('data-phase');
}

function getPhaseText(getByTestId: (id: string) => HTMLElement): string {
  return (getByTestId('phase-indicator').textContent || '').trim();
}

/** data-phase attribute value → required visible archival-verb label */
const PHASE_LABELS: Record<string, string> = {
  '1': 'READING',
  '2': 'CONDENSING',
  '3': 'RETAINED',
};

// ============================================================
// 1. Rendering & Mount
// ============================================================
describe('ColdBootAssembly -- rendering & mount', () => {
  it('mounts without crashing with valid data', () => {
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
      });
    }).not.toThrow();
  });

  it('renders root container with data-testid="cold-boot-assembly"', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('cold-boot-assembly')).toBeTruthy();
  });

  it('root container has an aria-label attribute', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const root = getByTestId('cold-boot-assembly');
    const label = root.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label!.length).toBeGreaterThan(5);
  });

  it('shows no-data element when snapshots is empty array', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: [], blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('shows no-data element when blocks is empty array', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: [] },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('shows no-data when both snapshots and blocks are empty', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: [], blocks: [] },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('shows no-data when snapshots is undefined', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: undefined, blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('shows no-data when blocks is undefined', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: undefined },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('shows no-data when snapshots is null', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: null as any, blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('shows no-data when blocks is null', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: null as any },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('does NOT show no-data when valid data is provided', () => {
    const { queryByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });

  it('does not crash when props are entirely omitted', () => {
    expect(() => {
      render(ColdBootAssembly, { props: {} });
    }).not.toThrow();
  });

  it('starts no animation timers when data is missing', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    render(ColdBootAssembly, { props: { snapshots: [], blocks: [] } });
    const animationTimers = setTimeoutSpy.mock.calls.filter(
      ([_fn, delay]) => typeof delay === 'number' && delay >= STAGGER_MS,
    );
    expect(animationTimers.length).toBe(0);
  });
});

// ============================================================
// 2. Phase 1 — 900ms stagger timing (boundary-exact)
// ============================================================
describe('ColdBootAssembly -- Phase 1: 900ms stagger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows 0 file blocks immediately at t=0', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(queryAllByTestId('file-block').length).toBe(0);
  });

  it('shows 0 file blocks at exactly 899ms (off-by-one)', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(899);
    expect(queryAllByTestId('file-block').length).toBe(0);
  });

  it('shows exactly 1 file block at exactly 900ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(900);
    expect(queryAllByTestId('file-block').length).toBe(1);
  });

  it('shows exactly 1 file block at 1799ms and 2 at 1800ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(1799);
    expect(queryAllByTestId('file-block').length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(queryAllByTestId('file-block').length).toBe(2);
  });

  it('shows exactly 3 file blocks at 2700ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2700);
    expect(queryAllByTestId('file-block').length).toBe(3);
  });

  it('shows exactly 4 file blocks at 4499ms (5th not yet appended)', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(4499);
    expect(queryAllByTestId('file-block').length).toBe(4);
  });

  it('shows all 5 file blocks at exactly 4500ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    expect(queryAllByTestId('file-block').length).toBe(5);
  });

  it('phase stays "1" with visible text "READING" throughout the stagger window', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(getPhase(getByTestId)).toBe('1');
    expect(getPhaseText(getByTestId)).toBe('READING');
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    expect(getPhase(getByTestId)).toBe('1');
    expect(getPhaseText(getByTestId)).toBe('READING');
  });

  it('never renders more than 5 file blocks no matter how much time passes', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(60000);
    // v2: file blocks are NEVER removed — exactly 5 remain in the DOM
    expect(queryAllByTestId('file-block').length).toBe(5);
  });

  it('each file block carries a class with an injected opacity fade-in rule', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(5);
    for (const block of blocks) {
      expect(block.classList.length).toBeGreaterThan(0);
      expect(elementHasOpacityFadeRule(block)).toBe(true);
    }
  });

  it('no final-state elements exist during phase 1', () => {
    const { queryByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    expect(queryByTestId('assembly-bar')).toBeNull();
    expect(queryByTestId('assembly-caption')).toBeNull();
  });
});

// ============================================================
// 3. Phase 1 — file block content (FILE_BLOCKS unchanged)
// ============================================================
describe('ColdBootAssembly -- Phase 1: file block content', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('each file block has data-testid="file-path" and data-testid="file-excerpt" children', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(5);
    for (const block of blocks) {
      expect(block.querySelector('[data-testid="file-path"]')).not.toBeNull();
      expect(block.querySelector('[data-testid="file-excerpt"]')).not.toBeNull();
    }
  });

  it('first file block (at 900ms) shows ~/MEMORY.md as filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(900);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(1);
    const firstPath = blocks[0].querySelector('[data-testid="file-path"]');
    expect(firstPath!.textContent).toContain('MEMORY.md');
  });

  it('second file block (at 1800ms) shows messages_from_james.md as filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(1800);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(2);
    const secondPath = blocks[1].querySelector('[data-testid="file-path"]');
    expect(secondPath!.textContent).toContain('messages_from_james.md');
  });

  it('third file block shows a daily note filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2700);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(3);
    const thirdPath = blocks[2].querySelector('[data-testid="file-path"]');
    expect(thirdPath!.textContent).toMatch(/notes\/daily|2026-/);
  });

  it('fourth file block shows discontinuous.md as filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(3600);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(4);
    const fourthPath = blocks[3].querySelector('[data-testid="file-path"]');
    expect(fourthPath!.textContent).toContain('discontinuous.md');
  });

  it('file-excerpt elements contain non-empty text', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    for (const block of queryAllByTestId('file-block')) {
      const excerpt = block.querySelector('[data-testid="file-excerpt"]');
      expect((excerpt!.textContent || '').trim().length).toBeGreaterThan(0);
    }
  });

  it('all file block filepaths are distinct', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    const paths = queryAllByTestId('file-block').map(
      (b) => b.querySelector('[data-testid="file-path"]')?.textContent || '',
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('file blocks carry the spec left-border colors', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(5);
    const specColors = ['#d4a020', '#6bb08a', '#6b9a8f', '#b07a6e', '#838997'];
    const allColorsFound = specColors.every((color) =>
      blocks.some((block) => {
        const style = (block.getAttribute('style') || '').toLowerCase();
        return (
          style.includes(color) ||
          style.includes(hexToRgb(color)) ||
          block.innerHTML.toLowerCase().includes(color)
        );
      }),
    );
    expect(allColorsFound).toBe(true);
  });
});

// ============================================================
// 4. Dwell — nothing changes between 4500ms and 9500ms
// ============================================================
describe('ColdBootAssembly -- dwell (4500ms → 9500ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('at 9400ms all 5 file blocks are still present and phase is still "1"', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(9400);
    expect(queryAllByTestId('file-block').length).toBe(5);
    expect(getPhase(getByTestId)).toBe('1');
    expect(getPhaseText(getByTestId)).toBe('READING');
  });

  it('at exactly 9499ms nothing has been removed, no final state, phase "1"', () => {
    const { getByTestId, queryAllByTestId, queryByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(9499);
    expect(queryAllByTestId('file-block').length).toBe(5);
    expect(getPhase(getByTestId)).toBe('1');
    expect(queryByTestId('assembly-bar')).toBeNull();
    expect(queryByTestId('assembly-caption')).toBeNull();
  });

  it('no file block carries the morphing class during the dwell', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(9499);
    for (const block of queryAllByTestId('file-block')) {
      expect(block.classList.contains('morphing')).toBe(false);
    }
  });
});

// ============================================================
// 5. Phase 2 — morph/crossfade at 9500ms
// ============================================================
describe('ColdBootAssembly -- Phase 2: morph at 9500ms', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('data-phase flips to "2" and text flips READING → CONDENSING at exactly 9500ms', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(9499);
    expect(getPhase(getByTestId)).toBe('1');
    expect(getPhaseText(getByTestId)).toBe('READING');
    vi.advanceTimersByTime(1);
    expect(getPhase(getByTestId)).toBe('2');
    expect(getPhaseText(getByTestId)).toBe('CONDENSING');
  });

  it('file blocks are NOT removed at phase 2 — all 5 remain in the DOM', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE2_MS);
    expect(queryAllByTestId('file-block').length).toBe(5);
  });

  it('all 5 file blocks receive the "morphing" class at 9500ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE2_MS);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(5);
    for (const block of blocks) {
      expect(block.classList.contains('morphing')).toBe(true);
    }
  });

  it('final-state element is appended simultaneously at 9500ms with an "emerging" class', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE2_MS);
    const bar = getByTestId('assembly-bar');
    expect(bar).toBeTruthy();
    // The appended final-state element carries the emerging class
    const emerging = bar.closest('.emerging');
    expect(emerging).not.toBeNull();
  });

  it('mid-morph (10000ms) BOTH the 5 file blocks AND the final state are in the DOM', () => {
    const { queryAllByTestId, queryByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    expect(queryAllByTestId('file-block').length).toBe(5);
    expect(queryByTestId('assembly-bar')).not.toBeNull();
    expect(queryByTestId('assembly-caption')).not.toBeNull();
  });

  it('injected CSS for .morphing transitions opacity to 0 and collapses max-height/margin', () => {
    render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE2_MS);
    const bodies = cssRuleBodiesFor('morphing');
    expect(bodies.length).toBeGreaterThan(0);
    const combined = bodies.join('\n');
    expect(combined).toMatch(/opacity\s*:\s*0(?![.\d])/);
    expect(combined).toMatch(/max-height/);
    expect(combined).toMatch(/margin/);
  });

  it('injected CSS for .emerging fades the final state in (mentions opacity)', () => {
    render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE2_MS);
    const bodies = cssRuleBodiesFor('emerging');
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.join('\n')).toMatch(/opacity/);
  });
});

// ============================================================
// 6. Phase 3 — final at 11300ms; blocks never removed
// ============================================================
describe('ColdBootAssembly -- Phase 3: final at 11300ms', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('data-phase is still "2" at 11299ms and flips to "3" at exactly 11300ms, text CONDENSING → RETAINED', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(11299);
    expect(getPhase(getByTestId)).toBe('2');
    expect(getPhaseText(getByTestId)).toBe('CONDENSING');
    vi.advanceTimersByTime(1);
    expect(getPhase(getByTestId)).toBe('3');
    expect(getPhaseText(getByTestId)).toBe('RETAINED');
  });

  it('file blocks are STILL in the DOM at phase 3 (never removed), carrying "morphed" class', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE3_MS);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(5);
    for (const block of blocks) {
      expect(block.classList.contains('morphed')).toBe(true);
    }
  });

  it('final state is fully present at phase 3', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE3_MS);
    expect(getByTestId('assembly-bar')).toBeTruthy();
    expect(getByTestId('assembly-caption')).toBeTruthy();
  });

  it('phase never regresses and file blocks stay in the DOM long after the timeline', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(getPhase(getByTestId)).toBe('3');
    vi.advanceTimersByTime(60000);
    expect(getPhase(getByTestId)).toBe('3');
    expect(queryAllByTestId('file-block').length).toBe(5);
    expect(getByTestId('assembly-bar')).toBeTruthy();
  });

  it('phase-indicator data-phase is always one of 1/2/3 and text always matches its archival label', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const validPhases = new Set(['1', '2', '3']);
    const assertPhaseConsistent = () => {
      const phase = getPhase(getByTestId) || '';
      expect(validPhases.has(phase)).toBe(true);
      expect(getPhaseText(getByTestId)).toBe(PHASE_LABELS[phase]);
    };
    assertPhaseConsistent();
    for (const step of [899, 1, 3600, 4999, 1, 3000, 1500, 1, 5000]) {
      vi.advanceTimersByTime(step);
      assertPhaseConsistent();
    }
  });
});

// ============================================================
// 7. Final state — caption
// ============================================================
describe('ColdBootAssembly -- final state: caption', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('caption has EXACT text with default filesRead=19 and 2 retained sections', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const caption = getByTestId('assembly-caption');
    expect((caption.textContent || '').trim()).toBe(STANDARD_CAPTION);
  });

  it('the old label text "What it built from what it read" is GONE', () => {
    const { getByTestId, queryByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryByTestId('assembly-label')).toBeNull();
    const root = getByTestId('cold-boot-assembly');
    expect(root.textContent || '').not.toContain(OLD_LABEL_TEXT);
  });

  it('caption reflects the weighted fixture section count (3 sections)', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const caption = getByTestId('assembly-caption');
    expect((caption.textContent || '').trim()).toBe('19 files read. 3 sections retained.');
  });

  it('caption uses singular for a single section ("1 section retained.", never "1 sections")', () => {
    const blocks = blocksFor({ 'only-hash': 'Only Section' });
    const snapshots = [
      makeSnapshot({ date: '2026-04-01', block_hashes: ['only-hash'] }),
    ];
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const caption = getByTestId('assembly-caption');
    expect((caption.textContent || '').trim()).toBe('19 files read. 1 section retained.');
    expect(caption.textContent || '').not.toContain('1 sections');
  });
});

// ============================================================
// 8. filesRead prop
// ============================================================
describe('ColdBootAssembly -- filesRead prop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('defaults to 19 when omitted', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('19 files read. 2 sections retained.');
  });

  it('non-default value 7 is reflected verbatim in the caption', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS, filesRead: 7 },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('7 files read. 2 sections retained.');
  });

  it('filesRead=1 uses singular "1 file read." (never "1 files")', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS, filesRead: 1 },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const caption = getByTestId('assembly-caption');
    expect((caption.textContent || '').trim())
      .toBe('1 file read. 2 sections retained.');
    expect(caption.textContent || '').not.toContain('1 files');
  });

  it('filesRead=0 is reflected verbatim (not treated as falsy → 19)', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS, filesRead: 0 },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('0 files read. 2 sections retained.');
  });

  it('negative filesRead=-3 is reflected verbatim', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS, filesRead: -3 },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('-3 files read. 2 sections retained.');
  });
});

// ============================================================
// 9. Final state — bar & segments
// ============================================================
describe('ColdBootAssembly -- final state: bar & segments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('assembly bar has role="img" and an aria-label mentioning MEMORY.md', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const bar = getByTestId('assembly-bar');
    expect(bar.getAttribute('role')).toBe('img');
    expect(bar.getAttribute('aria-label') || '').toContain('MEMORY.md');
  });

  it('renders one segment per retained section, in latest-snapshot order', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(3);
    expect(segments.map((s) => s.getAttribute('title'))).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('segments derive from the LATEST snapshot only — earlier snapshots do not leak in', () => {
    const blocks = blocksFor({
      'h-old': 'Old Only Section',
      'h-new': 'New Section',
    });
    const snapshots = [
      makeSnapshot({ date: '2026-01-01', block_hashes: ['h-old'] }),
      makeSnapshot({ date: '2026-02-01', block_hashes: ['h-new'] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const titles = queryAllByTestId('section-segment').map((s) => s.getAttribute('title'));
    expect(titles).toEqual(['New Section']);
  });

  it('segment title attribute and visible label both equal the heading text', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    for (const seg of segments) {
      const title = seg.getAttribute('title');
      expect(title).toBeTruthy();
      expect((seg.textContent || '')).toContain(title!);
    }
  });

  it('segments are ordered consistently across two full renders', () => {
    const { queryAllByTestId, unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const titles1 = queryAllByTestId('section-segment').map((s) => s.getAttribute('title'));
    unmount();
    vi.useRealTimers();
    vi.useFakeTimers();
    const { queryAllByTestId: queryAll2 } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const titles2 = queryAll2('section-segment').map((s) => s.getAttribute('title'));
    expect(titles1).toEqual(titles2);
    expect(titles1.length).toBeGreaterThan(0);
  });

  it('segment count does not change once phase 3 is reached', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const count1 = queryAllByTestId('section-segment').length;
    vi.advanceTimersByTime(30000);
    expect(queryAllByTestId('section-segment').length).toBe(count1);
  });
});

// ============================================================
// 10. Proportional widths (flex-grow = block count)
// ============================================================
describe('ColdBootAssembly -- proportional segment widths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('each segment inline style contains flex-grow equal to its block count (3/1/1)', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(3);
    const expected = [3, 1, 1]; // Alpha ×3, Beta ×1, Gamma ×1
    segments.forEach((seg, i) => {
      const style = seg.getAttribute('style') || '';
      expect(style).toMatch(new RegExp(`flex-grow:\\s*${expected[i]}(?![\\d.])`));
    });
  });

  it('duplicate hashes in block_hashes are counted as occurrences', () => {
    const blocks = blocksFor({ 'h-1': 'Dup', 'h-2': 'Solo' });
    const snapshots = [
      makeSnapshot({ date: '2026-02-02', block_hashes: ['h-1', 'h-1', 'h-2'] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(2);
    expect(segments[0].getAttribute('title')).toBe('Dup');
    expect(segments[0].getAttribute('style') || '').toMatch(/flex-grow:\s*2(?![\d.])/);
    expect(segments[1].getAttribute('style') || '').toMatch(/flex-grow:\s*1(?![\d.])/);
  });

  it('duplicate headings across distinct hashes dedup into one segment with summed count', () => {
    const blocks = blocksFor({ 'h-x': 'Same', 'h-y': 'Same', 'h-z': 'Other' });
    const snapshots = [
      makeSnapshot({ date: '2026-02-02', block_hashes: ['h-x', 'h-y', 'h-x', 'h-z'] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(2);
    expect(segments.map((s) => s.getAttribute('title'))).toEqual(['Same', 'Other']);
    expect(segments[0].getAttribute('style') || '').toMatch(/flex-grow:\s*3(?![\d.])/);
    expect(segments[1].getAttribute('style') || '').toMatch(/flex-grow:\s*1(?![\d.])/);
  });

  it('count-1-only sections all get flex-grow 1', () => {
    const blocks = blocksFor({ 'a': 'One', 'b': 'Two', 'c': 'Three' });
    const snapshots = [
      makeSnapshot({ date: '2026-02-02', block_hashes: ['a', 'b', 'c'] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(3);
    for (const seg of segments) {
      expect(seg.getAttribute('style') || '').toMatch(/flex-grow:\s*1(?![\d.])/);
    }
  });
});

// ============================================================
// 11. Palette colors (cycled by index, wraps at 13)
// ============================================================
describe('ColdBootAssembly -- palette colors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('segment i uses palette[i] as inline background for the first 3 segments', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(3);
    segments.forEach((seg, i) => {
      expect(segmentHasBackground(seg, PALETTE[i])).toBe(true);
    });
  });

  it('with 14 sections the 14th segment (index 13) wraps to palette[0]', () => {
    const manyBlocks = Array.from({ length: 14 }, (_, i) =>
      makeBlock({ hash: `wrap-${i}`, heading: `Wrap Section ${String(i).padStart(2, '0')}` }),
    );
    const snapshots = [
      makeSnapshot({ date: '2026-05-01', block_hashes: manyBlocks.map((b) => b.hash) }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks: manyBlocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(14);
    expect(segmentHasBackground(segments[0], PALETTE[0])).toBe(true);
    expect(segmentHasBackground(segments[1], PALETTE[1])).toBe(true);
    expect(segmentHasBackground(segments[12], PALETTE[12])).toBe(true);
    // index 13 wraps
    expect(segmentHasBackground(segments[13], PALETTE[0])).toBe(true);
    // and does NOT accidentally use a 14th distinct color
    expect(segmentHasBackground(segments[13], PALETTE[12])).toBe(false);
  });
});

// ============================================================
// 12. Screen-reader table (Section + Blocks columns)
// ============================================================
describe('ColdBootAssembly -- screen-reader table', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sr table has exactly the columns Section and Blocks', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const root = getByTestId('cold-boot-assembly');
    const table = root.querySelector('table');
    expect(table).not.toBeNull();
    const headers = Array.from(table!.querySelectorAll('th')).map((t) => t.textContent);
    expect(headers).toEqual(['Section', 'Blocks']);
  });

  it('sr table rows carry heading + per-section block count', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const table = getByTestId('cold-boot-assembly').querySelector('table');
    expect(table).not.toBeNull();
    const rows = Array.from(table!.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['Alpha', '3'],
      ['Beta', '1'],
      ['Gamma', '1'],
    ]);
  });
});

// ============================================================
// 13. Latest-snapshot selection
// ============================================================
describe('ColdBootAssembly -- latest snapshot selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function titlesFor(snapshots: any[], blocks: any[]): (string | null)[] {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    return queryAllByTestId('section-segment').map((s) => s.getAttribute('title'));
  }

  it('picks max date even when snapshots are out of order (latest first in array)', () => {
    const blocks = blocksFor({ 'h-late': 'Later', 'h-early': 'Earlier' });
    const snapshots = [
      makeSnapshot({ date: '2026-03-01', block_hashes: ['h-late'] }),
      makeSnapshot({ date: '2026-01-01', block_hashes: ['h-early'] }),
    ];
    expect(titlesFor(snapshots, blocks)).toEqual(['Later']);
  });

  it('on duplicate dates the LAST snapshot in array order wins', () => {
    const blocks = blocksFor({ 'h-first': 'First Dup', 'h-second': 'Second Dup' });
    const snapshots = [
      makeSnapshot({ date: '2026-02-02', block_hashes: ['h-first'] }),
      makeSnapshot({ date: '2026-02-02', block_hashes: ['h-second'] }),
    ];
    expect(titlesFor(snapshots, blocks)).toEqual(['Second Dup']);
  });

  it('a null date sorts lowest — a dated snapshot beats a later-in-array null-dated one', () => {
    const blocks = blocksFor({ 'h-dated': 'Dated', 'h-null': 'Nulled' });
    const snapshots = [
      makeSnapshot({ date: '2020-01-01', block_hashes: ['h-dated'] }),
      makeSnapshot({ date: null, block_hashes: ['h-null'] }),
    ];
    expect(titlesFor(snapshots, blocks)).toEqual(['Dated']);
  });

  it('an undefined date sorts lowest too', () => {
    const blocks = blocksFor({ 'h-dated': 'Dated', 'h-undef': 'Undefined Date' });
    const snapshots = [
      makeSnapshot({ date: '2020-01-01', block_hashes: ['h-dated'] }),
      makeSnapshot({ date: undefined, block_hashes: ['h-undef'] }),
    ];
    expect(titlesFor(snapshots, blocks)).toEqual(['Dated']);
  });

  it('when ALL dates are null the LAST snapshot in array order wins', () => {
    const blocks = blocksFor({ 'h-a': 'First Null', 'h-b': 'Second Null' });
    const snapshots = [
      makeSnapshot({ date: null, block_hashes: ['h-a'] }),
      makeSnapshot({ date: null, block_hashes: ['h-b'] }),
    ];
    expect(titlesFor(snapshots, blocks)).toEqual(['Second Null']);
  });

  it('garbage date strings participate in plain string compare ("not-a-date" > "2026-…")', () => {
    // Contract is string compare: 'n' (0x6E) > '2' (0x32), so the garbage
    // string wins over any ISO date. Only missing/null dates sort lowest.
    const blocks = blocksFor({ 'h-iso': 'IsoDated', 'h-garbage': 'GarbageDated' });
    const snapshots = [
      makeSnapshot({ date: 'not-a-date', block_hashes: ['h-garbage'] }),
      makeSnapshot({ date: '2026-06-01', block_hashes: ['h-iso'] }),
    ];
    expect(titlesFor(snapshots, blocks)).toEqual(['GarbageDated']);
  });

  it('snapshots array containing a null entry does not crash', () => {
    const blocks = blocksFor({ 'h-ok': 'Survivor' });
    const snapshots = [null as any, makeSnapshot({ date: '2026-01-01', block_hashes: ['h-ok'] })];
    expect(() => {
      const { queryAllByTestId } = render(ColdBootAssembly, {
        props: { snapshots, blocks },
      });
      vi.advanceTimersByTime(PAST_END_MS);
      expect(queryAllByTestId('section-segment').length).toBeGreaterThan(0);
    }).not.toThrow();
  });
});

// ============================================================
// 14. retainedSections derivation & fallback path
// ============================================================
describe('ColdBootAssembly -- retainedSections & fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('drops hashes that resolve to empty-string or missing headings', () => {
    const blocks = [
      makeBlock({ hash: 'h-empty', heading: '' }),
      makeBlock({ hash: 'h-none', heading: undefined }),
      makeBlock({ hash: 'h-real', heading: 'Real Section' }),
    ];
    const snapshots = [
      makeSnapshot({ date: '2026-02-02', block_hashes: ['h-empty', 'h-none', 'h-real'] }),
    ];
    const { queryAllByTestId, getByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.map((s) => s.getAttribute('title'))).toEqual(['Real Section']);
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('19 files read. 1 section retained.');
  });

  it('unresolvable hashes mixed with resolvable ones do not crash and are ignored', () => {
    const blocks = blocksFor({ 'h-known': 'Known' });
    const snapshots = [
      makeSnapshot({ date: '2026-02-02', block_hashes: ['ghost-1', 'h-known', 'ghost-2'] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const titles = queryAllByTestId('section-segment').map((s) => s.getAttribute('title'));
    expect(titles).toEqual(['Known']);
  });

  it('FALLBACK: latest snapshot with empty block_hashes uses ALL blocks unique headings', () => {
    const snapshots = [
      makeSnapshot({ date: '2026-01-01', block_hashes: ['hash-0'] }),
      makeSnapshot({ date: '2026-06-01', block_hashes: [] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const titles = queryAllByTestId('section-segment').map((s) => s.getAttribute('title'));
    // NOT the earlier valid snapshot's single section — the FALLBACK: all 8 block headings
    expect(titles).toEqual(STANDARD_BLOCKS.map((b) => b.heading));
  });

  it('FALLBACK: latest snapshot with null block_hashes uses all blocks', () => {
    const snapshots = [makeSnapshot({ date: '2026-06-01', block_hashes: null })];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('section-segment').length).toBe(STANDARD_BLOCKS.length);
  });

  it('FALLBACK: latest snapshot with undefined block_hashes uses all blocks', () => {
    const snapshots = [makeSnapshot({ date: '2026-06-01', block_hashes: undefined })];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('section-segment').length).toBe(STANDARD_BLOCKS.length);
  });

  it('FALLBACK: no hash resolving to any block triggers fallback to all blocks', () => {
    const snapshots = [
      makeSnapshot({ date: '2026-06-01', block_hashes: ['ghost-a', 'ghost-b'] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('section-segment').length).toBe(STANDARD_BLOCKS.length);
  });

  it('FALLBACK: hashes resolving only to empty-heading blocks triggers fallback', () => {
    const blocks = [
      makeBlock({ hash: 'h-empty', heading: '' }),
      makeBlock({ hash: 'h-good', heading: 'Good Heading' }),
    ];
    const snapshots = [
      makeSnapshot({ date: '2026-06-01', block_hashes: ['h-empty'] }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    // Fallback = all blocks' unique non-empty headings
    const titles = queryAllByTestId('section-segment').map((s) => s.getAttribute('title'));
    expect(titles).toEqual(['Good Heading']);
  });

  it('FALLBACK counts = number of blocks carrying that heading (drives flex-grow)', () => {
    const blocks = [
      makeBlock({ hash: 'f-1', heading: 'Twice' }),
      makeBlock({ hash: 'f-2', heading: 'Twice' }),
      makeBlock({ hash: 'f-3', heading: 'Once' }),
    ];
    const snapshots = [makeSnapshot({ date: '2026-06-01', block_hashes: [] })];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const segments = queryAllByTestId('section-segment');
    expect(segments.map((s) => s.getAttribute('title'))).toEqual(['Twice', 'Once']);
    expect(segments[0].getAttribute('style') || '').toMatch(/flex-grow:\s*2(?![\d.])/);
    expect(segments[1].getAttribute('style') || '').toMatch(/flex-grow:\s*1(?![\d.])/);
  });

  it('all blocks with empty/undefined headings → zero segments and "0 sections retained."', () => {
    const blocks = [
      makeBlock({ heading: '' }),
      makeBlock({ heading: undefined }),
    ];
    const { queryAllByTestId, getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('section-segment').length).toBe(0);
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('19 files read. 0 sections retained.');
  });
});

// ============================================================
// 15. Reduced motion
// ============================================================
describe('ColdBootAssembly -- prefers-reduced-motion', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    mockReducedMotion(true);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('shows final state immediately: bar and caption present without timers', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('assembly-bar')).toBeTruthy();
    expect((getByTestId('assembly-caption').textContent || '').trim()).toBe(STANDARD_CAPTION);
  });

  it('phase indicator is immediately at phase 3 with visible text "RETAINED"', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(getPhase(getByTestId)).toBe('3');
    expect(getPhaseText(getByTestId)).toBe('RETAINED');
  });

  it('no file blocks are animated with reduced motion', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(queryAllByTestId('file-block').length).toBe(0);
  });

  it('section segments with proportional flex-grow are present immediately', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(3);
    expect(segments[0].getAttribute('style') || '').toMatch(/flex-grow:\s*3(?![\d.])/);
  });

  it('does not schedule animation timers with reduced motion', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const animationTimerCalls = setTimeoutSpy.mock.calls.filter(
      ([_fn, delay]) => typeof delay === 'number' && delay >= STAGGER_MS,
    );
    expect(animationTimerCalls.length).toBe(0);
  });

  it('no-data is still shown when data is empty with reduced motion', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: [], blocks: [] },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });
});

// ============================================================
// 16. matchMedia absent
// ============================================================
describe('ColdBootAssembly -- window.matchMedia absent', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    originalMatchMedia = window.matchMedia;
    (window as any).matchMedia = undefined;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('does not crash on mount when matchMedia is undefined', () => {
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
      });
    }).not.toThrow();
  });

  it('animation still runs: first block at 900ms, full timeline reaches phase 3', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(900);
    expect(queryAllByTestId('file-block').length).toBe(1);
    vi.advanceTimersByTime(PAST_END_MS - 900);
    expect(getPhase(getByTestId)).toBe('3');
    expect(getByTestId('assembly-bar')).toBeTruthy();
    expect((getByTestId('assembly-caption').textContent || '').trim()).toBe(STANDARD_CAPTION);
  });
});

// ============================================================
// 17. XSS — headings must land as textContent everywhere
// ============================================================
describe('ColdBootAssembly -- XSS hostility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    delete (window as any).__xss_test__;
    delete (window as any).__xss_img__;
  });

  it('<script> in heading is rendered as text in the segment, never executed', () => {
    const xssString = '<script>window.__xss_test__ = true;</script>Identity';
    const blocks = blocksFor({ 'h-xss': xssString });
    const snapshots = [makeSnapshot({ date: '2026-02-02', block_hashes: ['h-xss'] })];
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect((window as any).__xss_test__).toBeUndefined();
    const root = getByTestId('cold-boot-assembly');
    expect(root.querySelector('script')).toBeNull();
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(1);
    expect(segments[0].textContent || '').toContain('<script>');
  });

  it('<img onerror> in heading injects no img element — in segments, title, or sr table', () => {
    const xssString = '<img src=x onerror="window.__xss_img__=1">Sneaky';
    const blocks = blocksFor({ 'h-img': xssString });
    const snapshots = [makeSnapshot({ date: '2026-02-02', block_hashes: ['h-img'] })];
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const root = getByTestId('cold-boot-assembly');
    expect(root.querySelector('img')).toBeNull();
    expect((window as any).__xss_img__).toBeUndefined();
    // Raw string preserved as text in the segment
    const seg = queryAllByTestId('section-segment')[0];
    expect(seg.textContent || '').toContain('<img src=x onerror=');
    // Title attribute holds the raw string verbatim
    expect(seg.getAttribute('title')).toBe(xssString);
    // sr table cell holds it as escaped text, not markup
    const table = root.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.querySelector('img')).toBeNull();
    expect(table!.textContent || '').toContain('<img src=x onerror=');
  });

  it('XSS heading does not inject elements into the caption region', () => {
    const xssString = '<script>window.__xss_test__ = true;</script>';
    const blocks = blocksFor({ 'h-x': xssString });
    const snapshots = [makeSnapshot({ date: '2026-02-02', block_hashes: ['h-x'] })];
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const caption = getByTestId('assembly-caption');
    expect(caption.querySelector('script')).toBeNull();
    expect((caption.textContent || '').trim()).toBe('19 files read. 1 section retained.');
    expect((window as any).__xss_test__).toBeUndefined();
  });
});

// ============================================================
// 18. Encoding & extreme headings
// ============================================================
describe('ColdBootAssembly -- encoding & extreme headings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('unicode heading renders and caption count is correct', () => {
    const blocks = blocksFor({ 'h-jp': '日本語セクション' });
    const snapshots = [makeSnapshot({ date: '2026-02-02', block_hashes: ['h-jp'] })];
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const root = getByTestId('cold-boot-assembly');
    expect(root.textContent).toContain('日本語セクション');
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('19 files read. 1 section retained.');
  });

  it('emoji heading renders correctly', () => {
    const blocks = blocksFor({ 'h-emoji': '🧠 Identity' });
    const snapshots = [makeSnapshot({ date: '2026-02-02', block_hashes: ['h-emoji'] })];
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(getByTestId('cold-boot-assembly').textContent).toContain('🧠 Identity');
  });

  it('RTL-override character in heading does not crash and lands as text', () => {
    const rtlHeading = 'Section ‮emanelif‬ end';
    const blocks = blocksFor({ 'h-rtl': rtlHeading });
    const snapshots = [makeSnapshot({ date: '2026-02-02', block_hashes: ['h-rtl'] })];
    expect(() => {
      const { queryAllByTestId } = render(ColdBootAssembly, {
        props: { snapshots, blocks },
      });
      vi.advanceTimersByTime(PAST_END_MS);
      expect(queryAllByTestId('section-segment')[0].getAttribute('title')).toBe(rtlHeading);
    }).not.toThrow();
  });

  it('1000-character heading renders without crash; caption count still correct', () => {
    const longHeading = 'A'.repeat(1000);
    const blocks = blocksFor({ 'h-long': longHeading, 'h-short': 'Short' });
    const snapshots = [
      makeSnapshot({ date: '2026-02-02', block_hashes: ['h-long', 'h-short'] }),
    ];
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('section-segment').length).toBe(2);
    expect((getByTestId('assembly-caption').textContent || '').trim())
      .toBe('19 files read. 2 sections retained.');
  });

  it('single section / single block renders exactly one segment', () => {
    const blocks = blocksFor({ 'h-solo': 'Only Section' });
    const snapshots = [makeSnapshot({ date: '2026-02-02', block_hashes: ['h-solo'] })];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('section-segment').length).toBe(1);
  });
});

// ============================================================
// 19. Unmount safety — timers cleared, no post-unmount mutation
// ============================================================
describe('ColdBootAssembly -- unmount safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function assertNoMutationAfterUnmount(unmountAtMs: number) {
    const { unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(unmountAtMs);
    unmount();
    const htmlAfterUnmount = document.body.innerHTML;
    expect(() => {
      vi.advanceTimersByTime(60000);
    }).not.toThrow();
    // No timer callback may mutate the document after unmount
    expect(document.body.innerHTML).toBe(htmlAfterUnmount);
    expect(document.querySelectorAll('[data-testid="file-block"]').length).toBe(0);
    expect(document.querySelectorAll('[data-testid="assembly-bar"]').length).toBe(0);
  }

  it('unmount mid-phase-1 (1000ms): no timer fires afterwards, no DOM mutation', () => {
    assertNoMutationAfterUnmount(1000);
  });

  it('unmount mid-dwell (6000ms): no timer fires afterwards, no DOM mutation', () => {
    assertNoMutationAfterUnmount(6000);
  });

  it('unmount mid-morph (10000ms): no timer fires afterwards, no DOM mutation', () => {
    assertNoMutationAfterUnmount(10000);
  });

  it('unmount at t=0 before any block appears is safe', () => {
    assertNoMutationAfterUnmount(0);
  });

  it('clearTimeout is called on unmount while timers are pending', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(1000);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});

// ============================================================
// 20. Single execution — re-render/prop changes never restart
// ============================================================
describe('ColdBootAssembly -- single execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('advancing timers way past total animation time does not throw', () => {
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(120000);
    }).not.toThrow();
  });

  it('blocks prop change after animation ran does NOT restart it', async () => {
    const { rerender, getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(getPhase(getByTestId)).toBe('3');

    const newBlocks = makeBlocks(['New Section A', 'New Section B']);
    await rerender({ snapshots: STANDARD_SNAPSHOTS, blocks: newBlocks });

    expect(getPhase(getByTestId)).toBe('3');
    // No fresh stagger begins after the prop change
    const blockCountBefore = queryAllByTestId('file-block').length;
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('file-block').length).toBe(blockCountBefore);
    expect(getPhase(getByTestId)).toBe('3');
  });

  it('snapshots prop change after animation ran does NOT restart it', async () => {
    const { rerender, getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(getPhase(getByTestId)).toBe('3');

    const newSnapshots = [makeSnapshot({ session_id: 'brand-new', date: '2026-05-01' })];
    await rerender({ snapshots: newSnapshots, blocks: STANDARD_BLOCKS });

    expect(getPhase(getByTestId)).toBe('3');
  });

  it('filesRead prop change after animation ran does NOT restart it', async () => {
    const { rerender, getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS, filesRead: 19 },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(getPhase(getByTestId)).toBe('3');

    await rerender({ snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS, filesRead: 42 });

    expect(getPhase(getByTestId)).toBe('3');
    expect(getByTestId('assembly-bar')).toBeTruthy();
  });

  it('assembly bar does not flicker or disappear after reaching final state', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(getByTestId('assembly-bar')).toBeTruthy();
    vi.advanceTimersByTime(30000);
    expect(getByTestId('assembly-bar')).toBeTruthy();
  });
});

// ============================================================
// 21. Malformed data & scale boundaries
// ============================================================
describe('ColdBootAssembly -- malformed data & scale', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('snapshot with missing session_id does not crash', () => {
    const snapshots = [makeSnapshot({ session_id: undefined })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(PAST_END_MS);
    }).not.toThrow();
  });

  it('block with null hash does not crash', () => {
    const blocks = [makeBlock({ hash: null }), makeBlock({ hash: 'valid', heading: 'Valid' })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(PAST_END_MS);
    }).not.toThrow();
  });

  it('very large blocks array (55 items) renders without crashing', () => {
    const blocks = Array.from({ length: 55 }, (_, i) =>
      makeBlock({ hash: `big-${i}`, heading: `Section ${i}` }),
    );
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(PAST_END_MS);
    }).not.toThrow();
  });

  it('very large snapshots array (100 items) renders without crashing', () => {
    const snapshots = Array.from({ length: 100 }, (_, i) =>
      makeSnapshot({
        session_id: `sess-${i}`,
        date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        block_hashes: ['hash-0'],
      }),
    );
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(PAST_END_MS);
    }).not.toThrow();
  });

  it('50 unique fallback headings produce one segment each (bounded, deduped)', () => {
    const blocks = Array.from({ length: 50 }, (_, i) =>
      makeBlock({ hash: `u-${i}`, heading: `Section ${i}` }),
    );
    const snapshots = [makeSnapshot({ date: '2026-06-01', block_hashes: [] })];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots, blocks },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(queryAllByTestId('section-segment').length).toBe(50);
  });
});

// ############################################################
// REVIEW PINS (sections 22–25)
// Code-review findings pinned in tests BEFORE the fix round:
//   22. ANIMATION_CSS <style> must be a document-level singleton
//   23. Per-mount animation semantics (fresh mount replays)
//   24. aria-live phase announcements (WCAG 4.1.3)
//   25. sr-table wrapper convention (data-testid="sr-table")
// ############################################################

/**
 * Runtime-injected animation style elements in document.head.
 * ANIMATION_CSS is the only stylesheet that mentions `.morphing` — the
 * component's own Svelte-injected styles never do — so this identifies the
 * runtime style robustly regardless of how the singleton is implemented.
 */
function animationStyleEls(): HTMLStyleElement[] {
  return Array.from(document.head.querySelectorAll('style')).filter(
    (s) => (s.textContent || '').includes('.morphing'),
  ) as HTMLStyleElement[];
}

function getLiveRegion(root: HTMLElement): HTMLElement | null {
  return root.querySelector('[aria-live="polite"]');
}

// ============================================================
// 22. Review pin — animation <style> singleton
// (finding: each instance appends its own runtime <style> with
//  ANIMATION_CSS into document.head → duplicates with 2 instances)
// ============================================================
describe('ColdBootAssembly -- review pin: animation style singleton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('two simultaneous instances share EXACTLY ONE injected animation style element', () => {
    render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    // Both animations underway
    vi.advanceTimersByTime(STAGGER_MS);
    expect(animationStyleEls().length).toBe(1);
  });

  it('unmounting ONE of two instances leaves the shared style element alive', () => {
    const first = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(STAGGER_MS);
    expect(animationStyleEls().length).toBe(1);

    first.unmount();
    // The surviving instance still needs the CSS — the style must SURVIVE
    expect(animationStyleEls().length).toBe(1);
    // And it must still be usable by the live instance through the full timeline
    vi.advanceTimersByTime(PAST_END_MS);
    expect(animationStyleEls().length).toBe(1);
  });

  it('unmounting BOTH instances removes the animation style entirely', () => {
    const first = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const second = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(STAGGER_MS);
    expect(animationStyleEls().length).toBe(1);

    first.unmount();
    second.unmount();
    expect(animationStyleEls().length).toBe(0);
  });

  it('mount → unmount → mount ×3 never leaves more than one style element at any point', () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const { unmount } = render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
      });
      // Mid-animation: exactly one (present, and never duplicated by re-mounts)
      vi.advanceTimersByTime(STAGGER_MS);
      expect(animationStyleEls().length).toBe(1);
      // Through phase 3 the sheet is still needed for .morphed styling
      vi.advanceTimersByTime(PAST_END_MS);
      expect(animationStyleEls().length).toBe(1);
      unmount();
      // No instance mounted → nothing may linger
      expect(animationStyleEls().length).toBe(0);
    }
  });
});

// ============================================================
// 23. Review pin — per-mount animation semantics
// (pins intent: the "single execution" guard is PER-MOUNT; a full
//  unmount + fresh mount replays the animation from phase 1. The
//  existing section-20 tests only cover prop changes on a live
//  instance — this pin covers the remount path explicitly.)
// ============================================================
describe('ColdBootAssembly -- review pin: per-mount animation semantics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('a fresh mount after full unmount runs the animation AGAIN from phase 1/READING', () => {
    const first = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    expect(getPhase(first.getByTestId)).toBe('3');
    first.unmount();

    const second = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Fresh instance starts from scratch — per-mount by design
    expect(getPhase(second.getByTestId)).toBe('1');
    expect(getPhaseText(second.getByTestId)).toBe('READING');
    expect(second.queryAllByTestId('file-block').length).toBe(0);

    // The stagger replays with the same contractual timing
    vi.advanceTimersByTime(STAGGER_MS);
    expect(second.queryAllByTestId('file-block').length).toBe(1);
    vi.advanceTimersByTime(PAST_END_MS - STAGGER_MS);
    expect(getPhase(second.getByTestId)).toBe('3');
    expect(second.getByTestId('assembly-bar')).toBeTruthy();
  });
});

// ============================================================
// 24. Review pin — aria-live phase announcements (WCAG 4.1.3)
// (finding: phase indicator is aria-hidden and NOTHING announces
//  phase changes to assistive technology)
// ============================================================
describe('ColdBootAssembly -- review pin: aria-live phase announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('an sr-only aria-live="polite" region exists with valid data and reads READING in phase 1', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const root = getByTestId('cold-boot-assembly');
    const live = getLiveRegion(root);
    expect(live).not.toBeNull();
    expect(live!.classList.contains('sr-only')).toBe(true);
    expect((live!.textContent || '').trim()).toBe('READING');
    // Still READING deep into phase 1
    vi.advanceTimersByTime(LAST_BLOCK_MS);
    expect((live!.textContent || '').trim()).toBe('READING');
  });

  it('live region announces CONDENSING at 9500ms and RETAINED at 11300ms', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const live = getLiveRegion(getByTestId('cold-boot-assembly'));
    expect(live).not.toBeNull();
    vi.advanceTimersByTime(PHASE2_MS);
    expect((live!.textContent || '').trim()).toBe('CONDENSING');
    vi.advanceTimersByTime(PHASE3_MS - PHASE2_MS);
    expect((live!.textContent || '').trim()).toBe('RETAINED');
  });

  it('reduced motion: live region reads RETAINED immediately', () => {
    const originalMatchMedia = window.matchMedia;
    try {
      mockReducedMotion(true);
      const { getByTestId } = render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
      });
      const live = getLiveRegion(getByTestId('cold-boot-assembly'));
      expect(live).not.toBeNull();
      expect(live!.classList.contains('sr-only')).toBe(true);
      expect((live!.textContent || '').trim()).toBe('RETAINED');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('the visible phase indicator KEEPS aria-hidden="true" — the live region is a separate element', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(PHASE2_MS);
    const indicator = getByTestId('phase-indicator');
    expect(indicator.getAttribute('aria-hidden')).toBe('true');
    const live = getLiveRegion(getByTestId('cold-boot-assembly'));
    expect(live).not.toBeNull();
    expect(live).not.toBe(indicator);
    // The indicator itself must not double as the live region
    expect(indicator.getAttribute('aria-live')).toBeNull();
  });

  it('live region lives OUTSIDE the animation container and does not disturb file-block counts', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Mid-morph: file blocks AND final state both in the DOM — maximum
    // opportunity for a misplaced live region to pollute counts
    vi.advanceTimersByTime(10000);
    const root = getByTestId('cold-boot-assembly');
    const live = getLiveRegion(root);
    expect(live).not.toBeNull();
    expect(live!.closest('.animation-container')).toBeNull();
    // Existing block-count selectors unaffected: still exactly 5 mid-animation
    expect(queryAllByTestId('file-block').length).toBe(5);
    expect(root.querySelectorAll('[data-testid="file-block"]').length).toBe(5);
  });
});

// ============================================================
// 25. Review pin — sr-table wrapper convention
// Convention (ExistenceStrip.svelte:124, PredictionTracker.svelte:213):
//   <div data-testid="sr-table" class="sr-only">{@html srTableHtml}</div>
// wrapping the helper's <table class="sr-only">. ColdBootAssembly
// currently wraps its table in a bare div.sr-only WITHOUT
// data-testid="sr-table" — divergence pinned here.
// ============================================================
describe('ColdBootAssembly -- review pin: sr-table wrapper convention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sr table is wrapped in a div[data-testid="sr-table"].sr-only per codebase convention', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
    });
    vi.advanceTimersByTime(PAST_END_MS);
    const root = getByTestId('cold-boot-assembly');
    const wrapper = root.querySelector('[data-testid="sr-table"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.classList.contains('sr-only')).toBe(true);
    const table = wrapper!.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.classList.contains('sr-only')).toBe(true);
  });

  it('reduced-motion path uses the same conventional wrapper', () => {
    const originalMatchMedia = window.matchMedia;
    try {
      mockReducedMotion(true);
      const { getByTestId } = render(ColdBootAssembly, {
        props: { snapshots: WEIGHTED_SNAPSHOTS, blocks: WEIGHTED_BLOCKS },
      });
      const root = getByTestId('cold-boot-assembly');
      const wrapper = root.querySelector('[data-testid="sr-table"]');
      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains('sr-only')).toBe(true);
      expect(wrapper!.querySelector('table')).not.toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
