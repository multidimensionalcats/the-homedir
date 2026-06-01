import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import ColdBootAssembly from './ColdBootAssembly.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

const STANDARD_SNAPSHOTS = [
  makeSnapshot({ session_id: 'sess-001', date: '2026-01-10', block_hashes: ['hash-0', 'hash-1'] }),
  makeSnapshot({ session_id: 'sess-002', date: '2026-02-01', block_hashes: ['hash-0', 'hash-2'] }),
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
});

// ============================================================
// 2. Phase 1 — File Block Appearance (staggered)
// ============================================================
describe('ColdBootAssembly -- Phase 1: file block stagger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows 0 file blocks immediately before any timers fire', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(0);
  });

  it('shows exactly 1 file block after ~500ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(550);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(1);
  });

  it('shows exactly 2 file blocks after ~1000ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(1050);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(2);
  });

  it('shows exactly 3 file blocks after ~1500ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(1550);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(3);
  });

  it('shows all 5 file blocks after ~2500ms', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(5);
  });

  it('never shows more than 5 file blocks regardless of how much time passes', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Advance far past any plausible stagger
    vi.advanceTimersByTime(10000);
    const blocks = queryAllByTestId('file-block');
    // Blocks might have transformed away in phase 3, but must not exceed 5
    expect(blocks.length).toBeLessThanOrEqual(5);
  });

  it('each file block has a data-testid="file-path" element', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    for (const block of blocks) {
      expect(block.querySelector('[data-testid="file-path"]')).not.toBeNull();
    }
  });

  it('each file block has a data-testid="file-excerpt" element', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    for (const block of blocks) {
      expect(block.querySelector('[data-testid="file-excerpt"]')).not.toBeNull();
    }
  });

  it('first file block shows ~/MEMORY.md as filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(600);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const firstPath = blocks[0].querySelector('[data-testid="file-path"]');
    expect(firstPath).not.toBeNull();
    expect(firstPath!.textContent).toContain('MEMORY.md');
  });

  it('second file block shows ~/messages_from_james.md as filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(1100);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const secondPath = blocks[1].querySelector('[data-testid="file-path"]');
    expect(secondPath).not.toBeNull();
    expect(secondPath!.textContent).toContain('messages_from_james.md');
  });

  it('third file block shows a daily note filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(1600);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const thirdPath = blocks[2].querySelector('[data-testid="file-path"]');
    expect(thirdPath).not.toBeNull();
    // Should contain notes/daily or a date-like path
    expect(thirdPath!.textContent).toMatch(/notes\/daily|2026-/);
  });

  it('fourth file block shows ~/writing/discontinuous.md as filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2100);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    const fourthPath = blocks[3].querySelector('[data-testid="file-path"]');
    expect(fourthPath).not.toBeNull();
    expect(fourthPath!.textContent).toContain('discontinuous.md');
  });

  it('blocks appear in order — MEMORY.md is first, not last', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    const paths = Array.from(blocks).map(
      (b) => b.querySelector('[data-testid="file-path"]')?.textContent || '',
    );
    // MEMORY.md must be first
    expect(paths[0]).toContain('MEMORY.md');
  });

  it('file-excerpt elements contain non-empty text', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    for (const block of blocks) {
      const excerpt = block.querySelector('[data-testid="file-excerpt"]');
      expect(excerpt).not.toBeNull();
      expect((excerpt!.textContent || '').trim().length).toBeGreaterThan(0);
    }
  });

  it('MEMORY.md block excerpt mentions identity or context', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(600);
    const blocks = queryAllByTestId('file-block');
    const firstExcerpt = blocks[0].querySelector('[data-testid="file-excerpt"]');
    expect(firstExcerpt).not.toBeNull();
    const text = (firstExcerpt!.textContent || '').toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    // Excerpt should be about identity or context (as per spec)
    const hasRelevantContent = text.includes('identity') || text.includes('context') || text.includes('memory');
    expect(hasRelevantContent).toBe(true);
  });

  it('file blocks have colored left borders matching spec colors', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    expect(blocks.length).toBe(5);

    // Each block should have some form of color indication
    // Check via inline style, CSS class, or border-left color
    const specColors = ['#d4a020', '#6bb08a', '#6b9a8f', '#b07a6e', '#838997'];
    const allColorsFound = specColors.every((color) => {
      return Array.from(blocks).some((block) => {
        const style = (block as HTMLElement).getAttribute('style') || '';
        const classAttr = block.getAttribute('class') || '';
        // Look for the color in style or child elements
        const innerHtml = block.innerHTML;
        return (
          style.includes(color) ||
          innerHtml.includes(color)
        );
      });
    });
    expect(allColorsFound).toBe(true);
  });

  it('file blocks do NOT all appear at exactly the same time (stagger is real)', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // At exactly 300ms, we should have fewer than 5 blocks
    vi.advanceTimersByTime(300);
    const blocksAtStart = queryAllByTestId('file-block').length;
    // At 2600ms we should have all 5
    vi.advanceTimersByTime(2300);
    const blocksAtEnd = queryAllByTestId('file-block').length;
    // The count must have grown — proving stagger
    expect(blocksAtEnd).toBeGreaterThan(blocksAtStart);
  });
});

// ============================================================
// 3. Phase Indicator
// ============================================================
describe('ColdBootAssembly -- phase indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('phase indicator exists in the DOM', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('phase-indicator')).toBeTruthy();
  });

  it('phase indicator starts at phase 1', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const indicator = getByTestId('phase-indicator');
    expect(indicator.getAttribute('data-phase')).toBe('1');
  });

  it('phase indicator transitions from 1 to 2 during assembly', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Advance past all 5 blocks (2500ms) + 1500ms transition start
    vi.advanceTimersByTime(4200);
    const indicator = getByTestId('phase-indicator');
    const phase = indicator.getAttribute('data-phase');
    // Should be 2 or 3 by now
    expect(['2', '3']).toContain(phase);
  });

  it('phase indicator reaches phase 3 (final state)', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Advance far past all animation
    vi.advanceTimersByTime(10000);
    const indicator = getByTestId('phase-indicator');
    expect(indicator.getAttribute('data-phase')).toBe('3');
  });

  it('phase never regresses — does not go from 3 back to 1', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    const phaseAfter = getByTestId('phase-indicator').getAttribute('data-phase');
    // Advance even more
    vi.advanceTimersByTime(10000);
    const phaseWayAfter = getByTestId('phase-indicator').getAttribute('data-phase');
    expect(phaseWayAfter).toBe(phaseAfter);
    expect(phaseWayAfter).toBe('3');
  });
});

// ============================================================
// 4. Phase 2 — Assembly Transition
// ============================================================
describe('ColdBootAssembly -- Phase 2: assembly transition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('section headings from blocks prop appear after phase 2 starts', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Past phase 1 (2500ms) + phase 2 start (1500ms) + some transition time
    vi.advanceTimersByTime(5000);
    const root = getByTestId('cold-boot-assembly');
    const text = root.textContent || '';
    // At least one of the headings should appear somewhere
    const hasAnyHeading = STANDARD_BLOCKS.some((b) => text.includes(b.heading));
    expect(hasAnyHeading).toBe(true);
  });

  it('transition starts after all 5 blocks are visible, not before', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // At 1000ms (only 2 blocks visible), phase should still be 1
    vi.advanceTimersByTime(1000);
    const blocks = queryAllByTestId('file-block');
    // We don't expect phase 2 elements during phase 1
    const assemblyBar = queryAllByTestId('assembly-bar');
    expect(assemblyBar.length).toBe(0);
  });

  it('phase 2 begins approximately 1500ms after block 5 appears (~4000ms total)', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // All 5 blocks appear by ~2500ms; phase 2 starts ~1500ms later = ~4000ms
    vi.advanceTimersByTime(2600);
    // Confirm all 5 blocks are present
    expect(queryAllByTestId('file-block').length).toBe(5);

    // Just before transition should start
    const phaseBefore = getByTestId('phase-indicator').getAttribute('data-phase');
    expect(phaseBefore).toBe('1');

    // Advance past transition trigger
    vi.advanceTimersByTime(1600);
    const phaseAfter = getByTestId('phase-indicator').getAttribute('data-phase');
    expect(['2', '3']).toContain(phaseAfter);
  });
});

// ============================================================
// 5. Phase 3 — Final State
// ============================================================
describe('ColdBootAssembly -- Phase 3: final state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function advanceToFinalState(queryAllByTestId: any, getByTestId: any) {
    vi.advanceTimersByTime(10000);
  }

  it('assembly bar is present in final state', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    advanceToFinalState(queryAllByTestId, getByTestId);
    expect(getByTestId('assembly-bar')).toBeTruthy();
  });

  it('assembly label shows "What it built from what it read"', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    advanceToFinalState(queryAllByTestId, getByTestId);
    const label = getByTestId('assembly-label');
    expect(label).toBeTruthy();
    expect(label.textContent).toContain('What it built from what it read');
  });

  it('section segments are present in the final bar', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBeGreaterThan(0);
  });

  it('section segments use headings derived from blocks prop', () => {
    const { getByTestId, queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    const root = getByTestId('cold-boot-assembly');
    const text = root.textContent || '';
    // At least some of the known section headings should appear in the bar
    const headingsInOutput = STANDARD_BLOCKS.filter((b) => text.includes(b.heading));
    expect(headingsInOutput.length).toBeGreaterThan(0);
  });

  it('assembly bar is NOT present before phase 3 starts (at t=0)', () => {
    const { queryByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // No timers advanced — assembly bar should not yet exist
    expect(queryByTestId('assembly-bar')).toBeNull();
  });

  it('assembly label is NOT present before phase 3 starts', () => {
    const { queryByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(queryByTestId('assembly-label')).toBeNull();
  });

  it('file blocks are absent or transformed in final state', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    // In final state, file blocks should either be gone or replaced by the bar
    // The spec says file blocks morph/transform — so count should be 0 in phase 3
    const fileBlocks = queryAllByTestId('file-block');
    expect(fileBlocks.length).toBe(0);
  });
});

// ============================================================
// 6. Reduced Motion
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

  it('shows final state immediately without timers', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('assembly-bar')).toBeTruthy();
  });

  it('shows assembly label immediately without timers', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const label = getByTestId('assembly-label');
    expect(label.textContent).toContain('What it built from what it read');
  });

  it('phase indicator is immediately at phase 3 with reduced motion', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const indicator = getByTestId('phase-indicator');
    expect(indicator.getAttribute('data-phase')).toBe('3');
  });

  it('does NOT show staggered file blocks with reduced motion (goes directly to final)', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // No timers needed — with reduced motion everything should be immediate
    const fileBlocks = queryAllByTestId('file-block');
    // In final state, file blocks are absent (they've been "transformed")
    expect(fileBlocks.length).toBe(0);
  });

  it('section segments are present immediately with reduced motion', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBeGreaterThan(0);
  });

  it('does not start setTimeout or setInterval animations with reduced motion', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Any setTimeout calls should not be for animation stagger delays
    // (500, 1000, 1500ms stagger timers should not be set)
    const animationTimerCalls = setTimeoutSpy.mock.calls.filter(
      ([_fn, delay]) => typeof delay === 'number' && delay >= 500,
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
// 7. Malformed Data
// ============================================================
describe('ColdBootAssembly -- malformed data', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('blocks with missing heading field do not crash', () => {
    const blocks = [
      makeBlock({ heading: undefined }),
      makeBlock({ heading: 'Valid Heading' }),
    ];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('blocks with empty string heading are handled gracefully', () => {
    const blocks = [
      makeBlock({ heading: '' }),
      makeBlock({ heading: 'Real Section' }),
    ];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('snapshots with missing block_hashes do not crash', () => {
    const snapshots = [
      makeSnapshot({ block_hashes: undefined }),
      makeSnapshot({ block_hashes: [] }),
    ];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('snapshots with null block_hashes do not crash', () => {
    const snapshots = [makeSnapshot({ block_hashes: null })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('duplicate headings in blocks are deduplicated in the final bar', () => {
    const blocks = [
      makeBlock({ hash: 'h1', heading: 'Identity & Context' }),
      makeBlock({ hash: 'h2', heading: 'Identity & Context' }),
      makeBlock({ hash: 'h3', heading: 'Identity & Context' }),
      makeBlock({ hash: 'h4', heading: 'Workflow' }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    const segments = queryAllByTestId('section-segment');
    // Only 2 unique headings: "Identity & Context" + "Workflow"
    expect(segments.length).toBe(2);
  });

  it('blocks array present but snapshots empty — shows no-data', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: [], blocks: STANDARD_BLOCKS },
    });
    expect(getByTestId('no-data')).toBeTruthy();
  });

  it('single block in array renders exactly one section segment', () => {
    const blocks = [makeBlock({ heading: 'Only Section' })];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    const segments = queryAllByTestId('section-segment');
    expect(segments.length).toBe(1);
  });

  it('snapshot with missing session_id does not crash', () => {
    const snapshots = [makeSnapshot({ session_id: undefined })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('snapshot with missing date does not crash', () => {
    const snapshots = [makeSnapshot({ date: undefined })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('block with null hash does not crash', () => {
    const blocks = [makeBlock({ hash: null }), makeBlock({ hash: 'valid' })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('all blocks with empty headings — assembly bar still renders without crashing', () => {
    const blocks = [
      makeBlock({ heading: '' }),
      makeBlock({ heading: '' }),
    ];
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    // Should not crash — container still present
    expect(getByTestId('cold-boot-assembly')).toBeTruthy();
  });
});

// ============================================================
// 8. Single Execution — animation only runs once
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
      vi.advanceTimersByTime(60000);
    }).not.toThrow();
  });

  it('phase stays at 3 after reaching final state, not cycling back', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    expect(getByTestId('phase-indicator').getAttribute('data-phase')).toBe('3');
    vi.advanceTimersByTime(10000);
    expect(getByTestId('phase-indicator').getAttribute('data-phase')).toBe('3');
    vi.advanceTimersByTime(30000);
    expect(getByTestId('phase-indicator').getAttribute('data-phase')).toBe('3');
  });

  it('assembly bar does not flicker or disappear after reaching final state', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    expect(getByTestId('assembly-bar')).toBeTruthy();
    vi.advanceTimersByTime(10000);
    expect(getByTestId('assembly-bar')).toBeTruthy();
  });

  it('section segment count does not change once phase 3 is reached', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    const count1 = queryAllByTestId('section-segment').length;
    vi.advanceTimersByTime(10000);
    const count2 = queryAllByTestId('section-segment').length;
    expect(count2).toBe(count1);
  });
});

// ============================================================
// 9. Boundary Conditions
// ============================================================
describe('ColdBootAssembly -- boundary conditions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('very large blocks array (50+ items) renders without crashing', () => {
    const blocks = Array.from({ length: 55 }, (_, i) =>
      makeBlock({ hash: `hash-${i}`, heading: `Section ${i}` }),
    );
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('section segment count is bounded even with 50 unique headings', () => {
    const blocks = Array.from({ length: 50 }, (_, i) =>
      makeBlock({ hash: `hash-${i}`, heading: `Section ${i}` }),
    );
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    const segments = queryAllByTestId('section-segment');
    // Segments should be <= 50 (one per unique heading, no duplicates)
    expect(segments.length).toBeLessThanOrEqual(50);
    expect(segments.length).toBeGreaterThan(0);
  });

  it('block heading with extremely long string does not overflow container or crash', () => {
    const longHeading = 'A'.repeat(500);
    const blocks = [makeBlock({ heading: longHeading })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('block heading with unicode renders correctly', () => {
    const blocks = [makeBlock({ heading: '日本語セクション' })];
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    const root = getByTestId('cold-boot-assembly');
    expect(root.textContent).toContain('日本語セクション');
  });

  it('block heading with emoji renders correctly', () => {
    const blocks = [makeBlock({ heading: '🧠 Identity' })];
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    const root = getByTestId('cold-boot-assembly');
    expect(root.textContent).toContain('🧠 Identity');
  });

  it('block heading with RTL text renders without crashing', () => {
    const blocks = [makeBlock({ heading: 'هوية ومعرفة' })];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots: STANDARD_SNAPSHOTS, blocks },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('blocks prop change after mount does NOT restart animation', async () => {
    const { queryAllByTestId, rerender, getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Advance to phase 3
    vi.advanceTimersByTime(10000);
    expect(getByTestId('phase-indicator').getAttribute('data-phase')).toBe('3');

    // Change blocks prop
    const newBlocks = makeBlocks(['New Section A', 'New Section B']);
    await rerender({ snapshots: STANDARD_SNAPSHOTS, blocks: newBlocks });

    // Phase should remain 3 — animation does not restart
    expect(getByTestId('phase-indicator').getAttribute('data-phase')).toBe('3');
  });

  it('snapshots prop change after mount does NOT restart animation', async () => {
    const { rerender, getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    expect(getByTestId('phase-indicator').getAttribute('data-phase')).toBe('3');

    const newSnapshots = [makeSnapshot({ session_id: 'brand-new', date: '2026-05-01' })];
    await rerender({ snapshots: newSnapshots, blocks: STANDARD_BLOCKS });

    // Animation already ran — phase stays at 3
    expect(getByTestId('phase-indicator').getAttribute('data-phase')).toBe('3');
  });

  it('very large snapshots array (100+ items) renders without crashing', () => {
    const snapshots = Array.from({ length: 100 }, (_, i) =>
      makeSnapshot({ session_id: `sess-${i}`, date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });
});

// ============================================================
// 10. Unmount Safety
// ============================================================
describe('ColdBootAssembly -- unmount safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('unmounting during phase 1 does not throw', () => {
    const { unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(700); // mid-phase 1
    expect(() => unmount()).not.toThrow();
  });

  it('unmounting during phase 2 does not throw', () => {
    const { unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(3500); // mid-phase 2
    expect(() => unmount()).not.toThrow();
  });

  it('advancing timers after unmount does not throw', () => {
    const { unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(500);
    unmount();
    expect(() => {
      vi.advanceTimersByTime(20000);
    }).not.toThrow();
  });

  it('animation timers are cleaned up on unmount (clearTimeout called)', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(500);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});

// ============================================================
// 11. Adversarial edge cases
// ============================================================
describe('ColdBootAssembly -- adversarial edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('blocks array with all-undefined headings does not produce section segments', () => {
    const blocks = [
      makeBlock({ heading: undefined }),
      makeBlock({ heading: undefined }),
    ];
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    const segments = queryAllByTestId('section-segment');
    // No valid headings → no valid segments
    expect(segments.length).toBe(0);
  });

  it('blocks with XSS in heading do not execute script', () => {
    const xssString = '<script>window.__xss_test__ = true;</script>Identity';
    const blocks = [
      makeBlock({ heading: xssString }),
    ];
    render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks },
    });
    vi.advanceTimersByTime(10000);
    expect((window as any).__xss_test__).toBeUndefined();
    // Verify the raw XSS string was treated as text, not parsed
    const segments = document.querySelectorAll('[data-testid="section-segment"]');
    expect(segments.length).toBeGreaterThan(0);
    const segmentText = segments[0].textContent || '';
    expect(segmentText).toContain('<script>');
  });

  it('snapshot block_hashes containing non-existent hashes does not crash', () => {
    const snapshots = [
      makeSnapshot({ block_hashes: ['does-not-exist-1', 'does-not-exist-2'] }),
    ];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('exactly 1 snapshot with all valid data renders without crashing', () => {
    const snapshots = [makeSnapshot()];
    expect(() => {
      render(ColdBootAssembly, {
        props: { snapshots, blocks: STANDARD_BLOCKS },
      });
      vi.advanceTimersByTime(10000);
    }).not.toThrow();
  });

  it('all file block filepaths are distinct (no duplicates rendered)', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    const paths = Array.from(blocks).map(
      (b) => b.querySelector('[data-testid="file-path"]')?.textContent || '',
    );
    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(paths.length);
  });

  it('phase-indicator data-phase is always a numeric string (1, 2, or 3) — never undefined', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    const validPhases = new Set(['1', '2', '3']);

    // Check at multiple time points
    [0, 500, 1000, 2000, 3000, 4500, 7000, 10000].forEach((t) => {
      vi.advanceTimersByTime(t === 0 ? 0 : 500);
      const phase = getByTestId('phase-indicator').getAttribute('data-phase');
      expect(validPhases.has(phase || '')).toBe(true);
    });
  });

  it('assembly-bar segments are ordered consistently (not random order on re-render)', () => {
    const { queryAllByTestId, unmount } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    const segments1 = Array.from(queryAllByTestId('section-segment')).map(
      (s) => s.textContent || '',
    );
    unmount();
    vi.useRealTimers();
    vi.useFakeTimers();

    const { queryAllByTestId: queryAll2 } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(10000);
    const segments2 = Array.from(queryAll2('section-segment')).map(
      (s) => s.textContent || '',
    );

    expect(segments1).toEqual(segments2);
  });

  it('does not render a phase-indicator with data-phase="0" at any point', () => {
    const { getByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    // Right at mount
    const phaseAtMount = getByTestId('phase-indicator').getAttribute('data-phase');
    expect(phaseAtMount).not.toBe('0');
    expect(phaseAtMount).not.toBeNull();
  });

  it('each file excerpt is italic or styled differently from the filepath', () => {
    const { queryAllByTestId } = render(ColdBootAssembly, {
      props: { snapshots: STANDARD_SNAPSHOTS, blocks: STANDARD_BLOCKS },
    });
    vi.advanceTimersByTime(2600);
    const blocks = queryAllByTestId('file-block');
    for (const block of blocks) {
      const excerpt = block.querySelector('[data-testid="file-excerpt"]') as HTMLElement;
      expect(excerpt).not.toBeNull();
      // Check the element or its computed style indicates italic or special styling
      const tagName = excerpt.tagName.toLowerCase();
      const style = excerpt.getAttribute('style') || '';
      const classAttr = excerpt.getAttribute('class') || '';
      // Should be an em/i tag, or have italic in class/style, or be wrapped in an italic element
      const isItalicEl = tagName === 'em' || tagName === 'i';
      const hasItalicStyle = style.includes('italic') || classAttr.includes('italic');
      const hasItalicParent = excerpt.closest('em') !== null || excerpt.closest('i') !== null;
      expect(isItalicEl || hasItalicStyle || hasItalicParent).toBe(true);
    }
  });
});
