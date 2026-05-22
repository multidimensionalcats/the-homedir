import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import MemoryEvolution from './MemoryEvolution.svelte';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

/** Minimal valid snapshot */
function makeSnapshot(overrides: Record<string, any> = {}) {
  return {
    session_id: 'snap-001',
    date: '2026-04-18',
    token_count: 768,
    block_hashes: ['hash-aaa', 'hash-bbb'],
    ...overrides,
  };
}

/** Minimal valid block */
function makeBlock(overrides: Record<string, any> = {}) {
  return {
    hash: 'hash-aaa',
    heading: 'Identity & Context',
    first_seen_date: '2026-04-18',
    last_seen_date: '2026-05-10',
    ...overrides,
  };
}

// ---- Persistence-sorted fixtures ----
// 3 snapshots, 3 blocks with different persistence levels:
//   blockPermanent (hash-perm) appears in ALL 3 snapshots
//   blockMid       (hash-mid)  appears in 2/3 snapshots
//   blockTransient (hash-trans) appears in 1/3 snapshots
const SORTED_SNAPSHOTS = [
  makeSnapshot({
    session_id: 'snap-001',
    date: '2026-04-18',
    token_count: 700,
    block_hashes: ['hash-perm', 'hash-mid', 'hash-trans'],
  }),
  makeSnapshot({
    session_id: 'snap-002',
    date: '2026-04-20',
    token_count: 900,
    block_hashes: ['hash-perm', 'hash-mid'],
  }),
  makeSnapshot({
    session_id: 'snap-003',
    date: '2026-04-22',
    token_count: 1100,
    block_hashes: ['hash-perm'],
  }),
];

const SORTED_BLOCKS = [
  makeBlock({ hash: 'hash-perm', heading: 'Permanent Block', first_seen_date: '2026-04-18', last_seen_date: '2026-04-22' }),
  makeBlock({ hash: 'hash-mid', heading: 'Mid-life Block', first_seen_date: '2026-04-18', last_seen_date: '2026-04-20' }),
  makeBlock({ hash: 'hash-trans', heading: 'Transient Block', first_seen_date: '2026-04-18', last_seen_date: '2026-04-18' }),
];

// ---- Section-order fixtures ----
// Blocks with headings matching SECTION_ORDER entries so familyOf() maps them into lanes
const SECTION_SNAPSHOTS = [
  makeSnapshot({
    session_id: 'snap-001', date: '2026-04-18', token_count: 700,
    block_hashes: ['hash-id', 'hash-wf', 'hash-qr'],
  }),
  makeSnapshot({
    session_id: 'snap-002', date: '2026-04-20', token_count: 900,
    block_hashes: ['hash-id', 'hash-wf', 'hash-qr2'],
  }),
  makeSnapshot({
    session_id: 'snap-003', date: '2026-04-22', token_count: 1100,
    block_hashes: ['hash-id', 'hash-wf', 'hash-qr3'],
  }),
];

const SECTION_BLOCKS = [
  makeBlock({ hash: 'hash-id', heading: 'Identity & Context' }),
  makeBlock({ hash: 'hash-wf', heading: 'Workflow' }),
  makeBlock({ hash: 'hash-qr', heading: 'Quick Reference: Current Situation (May 10)' }),
  makeBlock({ hash: 'hash-qr2', heading: 'Quick Reference: Current Situation (May 12)' }),
  makeBlock({ hash: 'hash-qr3', heading: 'Quick Reference: Current Situation (May 14)' }),
];

// ============================================================
// 1. No-data rendering
// ============================================================
describe('MemoryEvolution -- no-data states', () => {
  it('renders data-testid="no-data" when snapshots is empty array', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: [], blocks: [makeBlock()] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('renders data-testid="no-data" when blocks is empty array', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: [makeSnapshot()], blocks: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('renders data-testid="no-data" when BOTH props are empty arrays', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: [], blocks: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('renders data-testid="no-data" when snapshots is undefined', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: undefined as any, blocks: [makeBlock()] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('renders data-testid="no-data" when blocks is undefined', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: [makeSnapshot()], blocks: undefined as any },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when both snapshots and blocks have entries', () => {
    const { queryByTestId, getByTestId } = render(MemoryEvolution, {
      props: { snapshots: [makeSnapshot()], blocks: [makeBlock()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
    // Must also verify the chart actually rendered (not just an empty div)
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});

// ============================================================
// 2. SVG structure and ARIA
// ============================================================
describe('MemoryEvolution -- SVG structure', () => {
  it('creates an SVG element inside data-testid="chart-container"', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('SVG has role="img"', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
  });

  it('SVG has a non-empty aria-label', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const ariaLabel = svg!.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel!.length).toBeGreaterThan(5);
  });
});

// ============================================================
// 3. Section ordering (fixed SECTION_ORDER lanes)
// ============================================================
describe('MemoryEvolution -- section ordering', () => {
  it('renders SECTION_ORDER heading labels in the SVG', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const allText = Array.from(svg!.querySelectorAll('text'))
      .map((t) => t.textContent || '')
      .join(' ');
    // These are section headings from SECTION_ORDER (possibly truncated)
    expect(allText).toContain('Identity & Context');
    expect(allText).toContain('Quick Reference');
    expect(allText).toContain('Workflow');
  });

  it('section labels are at different Y positions (distinct lanes)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const sectionLabels = textEls
      .filter((t) => {
        const content = t.textContent || '';
        return (
          content.includes('Identity & Context') ||
          content.includes('Quick Reference') ||
          content.includes('Workflow')
        );
      })
      .map((t) => ({
        text: t.textContent || '',
        y: parseFloat(t.getAttribute('y') || '0'),
      }));

    expect(sectionLabels.length).toBe(3);
    // All three must have distinct Y positions
    const yValues = new Set(sectionLabels.map((l) => l.y));
    expect(yValues.size).toBe(3);
  });

  it('ephemeral sections at lowest Y (top), invariant at highest Y (bottom)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const labelWithY = textEls
      .filter((t) => {
        const txt = t.textContent || '';
        return txt.includes('Quick Reference') || txt.includes('Identity & Context');
      })
      .map((t) => ({
        text: t.textContent || '',
        y: parseFloat(t.getAttribute('y') || '0'),
      }));

    expect(labelWithY.length).toBe(2);
    const qr = labelWithY.find((l) => l.text.includes('Quick Reference'))!;
    const id = labelWithY.find((l) => l.text.includes('Identity & Context'))!;
    // Quick Reference (EPHEMERAL) at top = lower Y; Identity & Context (INVARIANT) at bottom = higher Y
    expect(qr.y).toBeLessThan(id.y);
  });
});

// ============================================================
// 4 & 5. Revision lane structure
// ============================================================
describe('MemoryEvolution -- revision lane structure', () => {
  it('renders multiple rect elements (background + run blocks)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // 8 sections x 1 background rect + run blocks for present sections
    expect(rects.length).toBeGreaterThanOrEqual(8);
  });

  it('rects have different colored fills for different sections', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const rects = Array.from(containerEl.querySelectorAll('rect'));
    const fills = new Set(rects.map((r) => r.getAttribute('fill')).filter(Boolean));
    // Must have at least 3 distinct fill colors (background #0c0c0c + different lane fills)
    expect(fills.size).toBeGreaterThanOrEqual(3);
  });

  it('background rects exist with fill #0c0c0c', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const rects = Array.from(containerEl.querySelectorAll('rect'));
    const bgRects = rects.filter((r) => r.getAttribute('fill') === '#0c0c0c');
    // One background rect per section in SECTION_ORDER = 8
    expect(bgRects.length).toBe(8);
  });

  it('seam lines exist when a section has multiple version runs', () => {
    // Quick Reference has 3 different hashes across 3 snapshots = 3 runs = 2 seams
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const lines = Array.from(containerEl.querySelectorAll('line'));
    const seamLines = lines.filter((l) => l.getAttribute('stroke') === '#f0f2f5');
    // Quick Reference changes hash each snapshot: 3 runs => 2 seams
    expect(seamLines.length).toBeGreaterThanOrEqual(2);
  });

  it('version-run rects have LANE_FILLS colors (not all background color)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const rects = Array.from(containerEl.querySelectorAll('rect'));
    const nonBgRects = rects.filter((r) => {
      const fill = r.getAttribute('fill') || '';
      return fill !== '#0c0c0c' && fill !== '';
    });
    // There should be run rects for Identity & Context, Workflow, Quick Reference
    expect(nonBgRects.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// 6. Token count line
// ============================================================
describe('MemoryEvolution -- token count line', () => {
  it('renders a path or line element for token counts', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    // Token line could be <path> or <line> or <polyline> — check for .token-line class
    const tokenLine = svg!.querySelector('.token-line');
    expect(tokenLine).not.toBeNull();
    // It should be a path, line, or polyline element
    const tagName = tokenLine!.tagName.toLowerCase();
    expect(['path', 'line', 'polyline']).toContain(tagName);
  });

  it('token line has a non-empty d attribute (if path) or coordinate attrs', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    const tokenLine = svg!.querySelector('.token-line');
    expect(tokenLine).not.toBeNull();
    if (tokenLine!.tagName.toLowerCase() === 'path') {
      const d = tokenLine!.getAttribute('d');
      expect(d).toBeTruthy();
      expect(d!.length).toBeGreaterThan(3);
    } else {
      // line or polyline — must have positional attributes
      const hasCoords =
        tokenLine!.getAttribute('x1') ||
        tokenLine!.getAttribute('points') ||
        tokenLine!.getAttribute('x');
      expect(hasCoords).toBeTruthy();
    }
  });
});

// ============================================================
// 7. X-axis labels (snapshot dates)
// ============================================================
describe('MemoryEvolution -- X-axis labels', () => {
  it('renders snapshot dates as text elements', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const allText = textEls.map((t) => t.textContent || '').join(' ');
    // At least one date from the data must appear (possibly formatted)
    const hasDate =
      allText.includes('Apr 18') ||
      allText.includes('4/18') ||
      allText.includes('2026-04-18') ||
      allText.includes('04-18') ||
      allText.includes('Apr') ||
      allText.includes('18');
    expect(hasDate).toBe(true);
  });

  it('renders date labels for multiple distinct snapshots', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const allText = textEls.map((t) => t.textContent || '').join(' ');
    // Must contain references to at least 2 different dates
    const datePatterns = ['Apr 18', '4/18', '04-18', 'Apr 20', '4/20', '04-20', 'Apr 22', '4/22', '04-22'];
    const matchCount = datePatterns.filter((p) => allText.includes(p)).length;
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// 8. Y-axis labels (section headings from SECTION_ORDER)
// ============================================================
describe('MemoryEvolution -- Y-axis labels', () => {
  it('renders section headings from SECTION_ORDER as Y-axis text', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const allText = Array.from(svg!.querySelectorAll('text'))
      .map((t) => t.textContent || '')
      .join(' ');
    // Section headings from SECTION_ORDER (component truncates long ones with ...)
    expect(allText).toContain('Identity & Context');
    expect(allText).toContain('Workflow');
    expect(allText).toContain('Quick Reference');
    expect(allText).toContain('Feedback');
  });

  it('renders classification tags (INVARIANT, VOLATILE, EPHEMERAL) as text', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const allText = Array.from(svg!.querySelectorAll('text'))
      .map((t) => t.textContent || '')
      .join(' ');
    expect(allText).toContain('INVARIANT');
    expect(allText).toContain('VOLATILE');
    expect(allText).toContain('EPHEMERAL');
  });
});

// ============================================================
// 9. Screen reader table
// ============================================================
describe('MemoryEvolution -- screen reader table', () => {
  it('renders a screen reader table with data-testid="sr-table"', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const srTable = getByTestId('sr-table');
    expect(srTable).toBeTruthy();
  });

  it('sr-table contains section headings from SECTION_ORDER', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const srTable = getByTestId('sr-table');
    const content = srTable.textContent || '';
    expect(content).toContain('Identity & Context');
    expect(content).toContain('Workflow');
    expect(content).toContain('Quick Reference');
  });

  it('sr-table contains version markers (v1, v2, etc.) for present sections', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const srTable = getByTestId('sr-table');
    const content = srTable.textContent || '';
    // Version markers like v1, v2, v3 for present content
    const hasVersion = content.includes('v1') || content.includes('v2') || content.includes('v3');
    expect(hasVersion).toBe(true);
  });

  it('sr-table contains absence markers distinct from presence markers', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const srTable = getByTestId('sr-table');
    const content = srTable.textContent || '';
    // Must contain some indicator of absence
    const hasAbsence =
      content.includes('—') ||
      content.includes('-') ||
      content.includes('∅') ||
      content.includes('absent') ||
      content.includes('Absent') ||
      content.includes('no') ||
      content.includes('No') ||
      content.includes('○');
    expect(hasAbsence).toBe(true);
  });

  it('sr-table has a table element with thead and tbody', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const srTable = getByTestId('sr-table');
    const table = srTable.querySelector('table') || (srTable.tagName === 'TABLE' ? srTable : null);
    expect(table).not.toBeNull();
    // Must have header row(s) and body
    const headers = table!.querySelectorAll('th');
    expect(headers.length).toBeGreaterThan(0);
    const rows = table!.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 10. Date range annotation
// ============================================================
describe('MemoryEvolution -- date range annotation', () => {
  it('renders "April" and "May" somewhere in the component text', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const container = getByTestId('chart-container');
    // Check the entire component subtree for the annotation text
    const root = container.closest('[data-testid]')?.parentElement || container;
    const fullText = root.textContent || '';
    const hasAprilMay =
      fullText.includes('April') && fullText.includes('May');
    expect(hasAprilMay).toBe(true);
  });

  it('has a date-range annotation element with data-testid="date-range-note"', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const note = getByTestId('date-range-note');
    expect(note).toBeTruthy();
    const text = note.textContent || '';
    // Must reference the date range
    expect(text.toLowerCase()).toMatch(/april|apr/);
    expect(text.toLowerCase()).toMatch(/may/);
  });
});

// ============================================================
// 11. Single snapshot edge case
// ============================================================
describe('MemoryEvolution -- single snapshot', () => {
  it('renders SVG with one column when given a single snapshot', () => {
    const singleSnap = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['hash-aaa'] }),
    ];
    const singleBlock = [makeBlock({ hash: 'hash-aaa', heading: 'Only Block' })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: singleSnap, blocks: singleBlock },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = containerEl.querySelectorAll('rect');
    // 1 snapshot x 1 block = at least 1 rect
    expect(rects.length).toBeGreaterThanOrEqual(1);
  });

  it('single snapshot still produces token count line element', () => {
    const singleSnap = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', token_count: 500, block_hashes: ['hash-aaa'] }),
    ];
    const singleBlock = [makeBlock({ hash: 'hash-aaa', heading: 'Only Block' })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: singleSnap, blocks: singleBlock },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    // Even with one point, the token line element should exist (could be a dot/circle or degenerate path)
    const tokenLine = svg!.querySelector('.token-line');
    expect(tokenLine).not.toBeNull();
  });
});

// ============================================================
// 12. Invariant sections
// ============================================================
describe('MemoryEvolution -- invariant sections', () => {
  it('renders INVARIANT classification tag in SVG text', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const allText = Array.from(svg!.querySelectorAll('text'))
      .map((t) => t.textContent || '')
      .join(' ');
    expect(allText).toContain('INVARIANT');
  });
});

// ============================================================
// 13. Ephemeral sections
// ============================================================
describe('MemoryEvolution -- ephemeral sections', () => {
  it('EPHEMERAL tag is at lower Y than INVARIANT tags (ephemeral at top, invariant at bottom)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SECTION_SNAPSHOTS, blocks: SECTION_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const ephemeralEls = textEls.filter((t) => (t.textContent || '') === 'EPHEMERAL');
    const invariantEls = textEls.filter((t) => (t.textContent || '') === 'INVARIANT');

    expect(ephemeralEls.length).toBeGreaterThanOrEqual(1);
    expect(invariantEls.length).toBeGreaterThanOrEqual(1);

    const ephemeralY = parseFloat(ephemeralEls[0].getAttribute('y') || '0');
    // All INVARIANT tags should have higher Y (further down) than EPHEMERAL
    for (const inv of invariantEls) {
      const invY = parseFloat(inv.getAttribute('y') || '0');
      expect(ephemeralY).toBeLessThan(invY);
    }
  });
});

// ============================================================
// 14. Empty block_hashes in a snapshot
// ============================================================
describe('MemoryEvolution -- empty block_hashes', () => {
  it('handles snapshot with empty block_hashes without crashing', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: [] }),
      makeSnapshot({ session_id: 's2', date: '2026-04-20', block_hashes: ['hash-aaa'] }),
    ];
    const blocks = [makeBlock({ hash: 'hash-aaa', heading: 'Survivor' })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('empty block_hashes snapshot still renders lane structure with rects', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: [] }),
    ];
    const blocks = [
      makeBlock({ hash: 'h1', heading: 'Identity & Context' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // Lane backgrounds still render even when no hashes match
    expect(rects.length).toBeGreaterThanOrEqual(8);
  });
});

// ============================================================
// 15. Null/undefined token_count
// ============================================================
describe('MemoryEvolution -- null/undefined token_count', () => {
  it('handles null token_count without crashing', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', token_count: null }),
    ];
    const blocks = [makeBlock()];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles undefined token_count without crashing', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', token_count: undefined }),
    ];
    const blocks = [makeBlock()];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles mix of valid and null token_counts', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', token_count: 500 }),
      makeSnapshot({ session_id: 's2', date: '2026-04-20', token_count: null }),
      makeSnapshot({ session_id: 's3', date: '2026-04-22', token_count: 1200 }),
    ];
    const blocks = [makeBlock()];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    // Token line should still exist (skipping null points or interpolating)
    const tokenLine = svg!.querySelector('.token-line');
    expect(tokenLine).not.toBeNull();
  });
});

// ============================================================
// 16. Null heading in blocks
// ============================================================
describe('MemoryEvolution -- null heading', () => {
  it('handles block with null heading without crashing', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['hash-null'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'hash-null', heading: null }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles block with empty string heading without crashing', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['hash-empty'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'hash-empty', heading: '' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('null-heading block still renders lanes with rects (does not crash)', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['hash-null'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'hash-null', heading: null }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // Lane backgrounds still rendered (8 sections in SECTION_ORDER)
    expect(rects.length).toBeGreaterThanOrEqual(8);
  });
});

// ============================================================
// 17. Container binding
// ============================================================
describe('MemoryEvolution -- container binding', () => {
  it('creates SVG inside data-testid="chart-container" div', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    expect(containerEl.tagName).toBe('DIV');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('chart-container is a div not an SVG itself', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    expect(containerEl.tagName).not.toBe('SVG');
    expect(containerEl.tagName).toBe('DIV');
  });
});

// ============================================================
// 18. Cleanup on destroy
// ============================================================
describe('MemoryEvolution -- cleanup', () => {
  it('removes chart-container from DOM after unmount', () => {
    const { getByTestId, unmount } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    expect(getByTestId('chart-container')).toBeTruthy();

    unmount();

    const orphan = document.querySelector('[data-testid="chart-container"]');
    expect(orphan).toBeNull();
  });

  it('SVG is removed from document after unmount', () => {
    const { unmount, getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });

    // Verify SVG exists BEFORE unmount — this ensures the cleanup is real, not vacuous
    const containerEl = getByTestId('chart-container');
    const svgBefore = containerEl.querySelector('svg');
    expect(svgBefore).not.toBeNull();

    unmount();

    // No leftover SVG from this component
    const orphanSvg = document.querySelector('[data-testid="chart-container"] svg');
    expect(orphanSvg).toBeNull();
  });
});

// ============================================================
// Adversarial: malformed / extreme data
// ============================================================
describe('MemoryEvolution -- adversarial inputs', () => {
  it('handles snapshot with block_hashes containing hashes not in blocks array', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['hash-unknown', 'hash-ghost'] }),
    ];
    const blocks = [makeBlock({ hash: 'hash-aaa', heading: 'Known Block' })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles blocks with hashes that never appear in any snapshot (no crash, rects exist)', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: [] }),
    ];
    const blocks = [
      makeBlock({ hash: 'hash-orphan', heading: 'Orphan Block' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    // Lane backgrounds still render
    const rects = containerEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(8);
  });

  it('handles duplicate hashes in block_hashes array (no crash, rects exist)', () => {
    const snaps = [
      makeSnapshot({
        session_id: 's1',
        date: '2026-04-18',
        block_hashes: ['hash-aaa', 'hash-aaa', 'hash-aaa'],
      }),
    ];
    const blocks = [makeBlock({ hash: 'hash-aaa', heading: 'Identity & Context' })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = containerEl.querySelectorAll('rect');
    // Background rects + at least one run rect for Identity & Context
    expect(rects.length).toBeGreaterThanOrEqual(9);
  });

  it('handles snapshots not sorted by date (out-of-order input)', () => {
    const outOfOrder = [
      makeSnapshot({ session_id: 's3', date: '2026-04-22', token_count: 1100, block_hashes: ['h1'] }),
      makeSnapshot({ session_id: 's1', date: '2026-04-18', token_count: 700, block_hashes: ['h1'] }),
      makeSnapshot({ session_id: 's2', date: '2026-04-20', token_count: 900, block_hashes: ['h1'] }),
    ];
    const blocks = [makeBlock({ hash: 'h1', heading: 'Survivor' })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: outOfOrder, blocks },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    // X-axis labels should still be in chronological order
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const dateTexts = textEls
      .map((t) => t.textContent || '')
      .filter((t) => t.match(/\d/));
    // They should exist and the component should not crash
    expect(dateTexts.length).toBeGreaterThan(0);
  });

  it('handles block heading with Unicode and emoji characters', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['hash-uni'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'hash-uni', heading: '🧠 Identité & Contexte — العربية' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles extremely long heading without crashing', () => {
    const longHeading = 'A'.repeat(500);
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['hash-long'] }),
    ];
    const blocks = [makeBlock({ hash: 'hash-long', heading: longHeading })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles token_count of 0 without crashing', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', token_count: 0, block_hashes: ['hash-aaa'] }),
    ];
    const blocks = [makeBlock()];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('handles negative token_count without crashing', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', token_count: -100, block_hashes: ['hash-aaa'] }),
    ];
    const blocks = [makeBlock()];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('all snapshots sharing identical block_hashes still renders lane rects', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['h1', 'h2'] }),
      makeSnapshot({ session_id: 's2', date: '2026-04-20', block_hashes: ['h1', 'h2'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'h1', heading: 'Identity & Context' }),
      makeBlock({ hash: 'h2', heading: 'Workflow' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = containerEl.querySelectorAll('rect');
    // 8 background rects + at least 2 run rects (Identity & Context + Workflow)
    expect(rects.length).toBeGreaterThanOrEqual(10);
  });

  it('completely disjoint block_hashes across snapshots renders lane rects', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['h1'] }),
      makeSnapshot({ session_id: 's2', date: '2026-04-20', block_hashes: ['h2'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'h1', heading: 'Identity & Context' }),
      makeBlock({ hash: 'h2', heading: 'Workflow' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const rects = containerEl.querySelectorAll('rect');
    // 8 background rects + at least 2 run rects
    expect(rects.length).toBeGreaterThanOrEqual(10);
  });
});
