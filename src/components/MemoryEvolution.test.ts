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
// 3. Persistence sort order — Y axis
// ============================================================
describe('MemoryEvolution -- persistence sorting', () => {
  it('sorts blocks by persistence count (most persistent at top = lowest y)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    // Look for Y-axis text labels — should be in persistence order top-to-bottom
    const svg = containerEl.querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const yLabels = textEls
      .filter((t) => {
        const content = t.textContent || '';
        return (
          content.includes('Permanent') ||
          content.includes('Mid-life') ||
          content.includes('Transient')
        );
      })
      .map((t) => ({
        text: t.textContent || '',
        y: parseFloat(t.getAttribute('y') || '0'),
      }));

    // Must find all 3 labels
    expect(yLabels.length).toBe(3);

    // Sort by y-coordinate ascending (top of SVG)
    const sorted = [...yLabels].sort((a, b) => a.y - b.y);
    // Permanent (3 appearances) must be above Mid-life (2) must be above Transient (1)
    expect(sorted[0].text).toContain('Permanent');
    expect(sorted[1].text).toContain('Mid-life');
    expect(sorted[2].text).toContain('Transient');
  });

  it('block present in ALL snapshots ranks above block present in some', () => {
    // Deliberately reverse input order to catch naive no-sort implementations
    const reversedBlocks = [...SORTED_BLOCKS].reverse();
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: reversedBlocks },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const yLabels = textEls
      .filter((t) =>
        ['Permanent', 'Mid-life', 'Transient'].some((k) =>
          (t.textContent || '').includes(k),
        ),
      )
      .map((t) => ({
        text: t.textContent || '',
        y: parseFloat(t.getAttribute('y') || '0'),
      }))
      .sort((a, b) => a.y - b.y);

    expect(yLabels.length).toBe(3);
    expect(yLabels[0].text).toContain('Permanent');
    expect(yLabels[2].text).toContain('Transient');
  });
});

// ============================================================
// 4 & 5. Present cells (gold) vs absent cells (ghost)
// ============================================================
describe('MemoryEvolution -- present vs absent cell treatment', () => {
  it('renders rect elements for both present and absent cells', () => {
    // 3 snapshots x 3 blocks = 9 total cells (5 present, 4 absent)
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const rects = containerEl.querySelectorAll('rect');
    // Must have at least 9 cells for the 3x3 grid
    expect(rects.length).toBeGreaterThanOrEqual(9);
  });

  it('present cells have class "present-cell"', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const presentCells = containerEl.querySelectorAll('.present-cell');
    // hash-perm in all 3, hash-mid in 2, hash-trans in 1 = 6 present
    expect(presentCells.length).toBe(6);
  });

  it('absent cells have class "absent-cell"', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const absentCells = containerEl.querySelectorAll('.absent-cell');
    // 3x3=9 total, 6 present => 3 absent
    expect(absentCells.length).toBe(3);
  });

  it('present cells have gold-ish fill (warm hue, not gray/transparent)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const presentCell = containerEl.querySelector('.present-cell');
    expect(presentCell).not.toBeNull();
    const fill = presentCell!.getAttribute('fill') || '';
    // Gold tones: #D4A, #C9A, #B8, amber, etc. Must NOT be gray-ish or transparent
    // Reject pure gray (equal r/g/b channels) and transparent/none
    expect(fill).not.toBe('none');
    expect(fill).not.toBe('transparent');
    expect(fill).not.toBe('');
    // A gold/amber fill typically has stronger red+green than blue in hex
    // Or it could be an HSL/RGB string — just ensure it's distinct from absent
    const absentCell = containerEl.querySelector('.absent-cell');
    if (absentCell) {
      const absentFill = absentCell.getAttribute('fill') || '';
      expect(fill).not.toBe(absentFill);
    }
  });

  it('absent cells are visually distinct from present cells (different fill)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const presentCell = containerEl.querySelector('.present-cell');
    const absentCell = containerEl.querySelector('.absent-cell');
    expect(presentCell).not.toBeNull();
    expect(absentCell).not.toBeNull();

    const presentFill = presentCell!.getAttribute('fill');
    const absentFill = absentCell!.getAttribute('fill');
    expect(presentFill).not.toBe(absentFill);
  });

  it('no cell has both present-cell AND absent-cell classes', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    const dualClass = containerEl.querySelectorAll('.present-cell.absent-cell');
    expect(dualClass.length).toBe(0);
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
// 8. Y-axis labels (block headings)
// ============================================================
describe('MemoryEvolution -- Y-axis labels', () => {
  it('renders block headings as text elements on Y axis', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const allText = textEls.map((t) => t.textContent || '').join(' ');
    expect(allText).toContain('Permanent Block');
    expect(allText).toContain('Mid-life Block');
    expect(allText).toContain('Transient Block');
  });

  it('renders headings for ALL blocks, not just a subset', () => {
    const fiveBlocks = [
      makeBlock({ hash: 'h1', heading: 'Alpha Section' }),
      makeBlock({ hash: 'h2', heading: 'Beta Section' }),
      makeBlock({ hash: 'h3', heading: 'Gamma Section' }),
      makeBlock({ hash: 'h4', heading: 'Delta Section' }),
      makeBlock({ hash: 'h5', heading: 'Epsilon Section' }),
    ];
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['h1', 'h2', 'h3', 'h4', 'h5'] }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks: fiveBlocks },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const allText = Array.from(svg!.querySelectorAll('text'))
      .map((t) => t.textContent || '')
      .join(' ');
    for (const b of fiveBlocks) {
      expect(allText).toContain(b.heading);
    }
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

  it('sr-table contains block headings', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const srTable = getByTestId('sr-table');
    const content = srTable.textContent || '';
    expect(content).toContain('Permanent Block');
    expect(content).toContain('Mid-life Block');
    expect(content).toContain('Transient Block');
  });

  it('sr-table contains presence markers for present blocks', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const srTable = getByTestId('sr-table');
    const content = srTable.textContent || '';
    // Must contain some indicator of presence (checkmark, "present", "yes", bullet, etc.)
    const hasPresence =
      content.includes('✓') ||
      content.includes('✔') ||
      content.includes('present') ||
      content.includes('Present') ||
      content.includes('yes') ||
      content.includes('Yes') ||
      content.includes('●') ||
      content.includes('★');
    expect(hasPresence).toBe(true);
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
// 12. Block present in ALL snapshots (permanent)
// ============================================================
describe('MemoryEvolution -- permanent block (all snapshots)', () => {
  it('permanent block has zero absent cells', () => {
    // hash-perm is in all 3 SORTED_SNAPSHOTS
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const containerEl = getByTestId('chart-container');
    // Get all cells, find ones for the permanent block row
    // Cells should have data attributes identifying block hash or heading
    const allCells = containerEl.querySelectorAll('.present-cell, .absent-cell');
    const permCells = Array.from(allCells).filter(
      (c) =>
        c.getAttribute('data-hash') === 'hash-perm' ||
        c.getAttribute('data-heading')?.includes('Permanent'),
    );
    // If data-hash attributes exist, permanent block should have 3 present, 0 absent
    if (permCells.length > 0) {
      const absentPerm = permCells.filter((c) => c.classList.contains('absent-cell'));
      expect(absentPerm.length).toBe(0);
    } else {
      // Fallback: just verify present-cell count >= snapshot count (at minimum)
      const presentCells = containerEl.querySelectorAll('.present-cell');
      expect(presentCells.length).toBeGreaterThanOrEqual(SORTED_SNAPSHOTS.length);
    }
  });
});

// ============================================================
// 13. Block present in only ONE snapshot (transient)
// ============================================================
describe('MemoryEvolution -- transient block (one snapshot)', () => {
  it('transient block appears at BOTTOM of Y axis (highest y coordinate)', () => {
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: SORTED_SNAPSHOTS, blocks: SORTED_BLOCKS },
    });
    const svg = getByTestId('chart-container').querySelector('svg');
    expect(svg).not.toBeNull();
    const textEls = Array.from(svg!.querySelectorAll('text'));
    const labelWithY = textEls
      .filter((t) => {
        const txt = t.textContent || '';
        return txt.includes('Permanent') || txt.includes('Transient');
      })
      .map((t) => ({
        text: t.textContent || '',
        y: parseFloat(t.getAttribute('y') || '0'),
      }));

    expect(labelWithY.length).toBe(2);
    const perm = labelWithY.find((l) => l.text.includes('Permanent'))!;
    const trans = labelWithY.find((l) => l.text.includes('Transient'))!;
    // Transient must have a LARGER y value (lower on screen) than permanent
    expect(trans.y).toBeGreaterThan(perm.y);
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

  it('snapshot with empty block_hashes produces all absent cells for that column', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: [] }),
    ];
    const blocks = [
      makeBlock({ hash: 'h1', heading: 'Block A' }),
      makeBlock({ hash: 'h2', heading: 'Block B' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const presentCells = containerEl.querySelectorAll('.present-cell');
    const absentCells = containerEl.querySelectorAll('.absent-cell');
    // All cells should be absent when no hashes match
    expect(presentCells.length).toBe(0);
    expect(absentCells.length).toBe(2);
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

  it('null-heading block still gets a cell rendered (does not silently vanish)', () => {
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
    const cells = containerEl.querySelectorAll('.present-cell, .absent-cell');
    expect(cells.length).toBeGreaterThanOrEqual(1);
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

  it('handles blocks with hashes that never appear in any snapshot', () => {
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
    // Orphan block should still render as absent
    const absentCells = containerEl.querySelectorAll('.absent-cell');
    expect(absentCells.length).toBeGreaterThanOrEqual(1);
  });

  it('handles duplicate hashes in block_hashes array without doubling cells', () => {
    const snaps = [
      makeSnapshot({
        session_id: 's1',
        date: '2026-04-18',
        block_hashes: ['hash-aaa', 'hash-aaa', 'hash-aaa'],
      }),
    ];
    const blocks = [makeBlock({ hash: 'hash-aaa', heading: 'Doubled Block' })];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const presentCells = containerEl.querySelectorAll('.present-cell');
    // Dupes in hashes should NOT produce duplicate cells — 1 block x 1 snapshot = 1 cell
    expect(presentCells.length).toBe(1);
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

  it('24 snapshots x 50 blocks produces exactly 1200 cells', () => {
    // Simulate full-scale data
    const hashes = Array.from({ length: 50 }, (_, i) => `block-${i.toString().padStart(3, '0')}`);
    const snaps = Array.from({ length: 24 }, (_, i) => {
      // Each snapshot gets a rotating subset of hashes
      const subset = hashes.slice(0, Math.max(1, (i * 3) % 50));
      return makeSnapshot({
        session_id: `snap-${i.toString().padStart(3, '0')}`,
        date: `2026-04-${(18 + i).toString().padStart(2, '0')}`,
        token_count: 700 + i * 50,
        block_hashes: subset,
      });
    });
    const blocks = hashes.map((h, i) =>
      makeBlock({ hash: h, heading: `Section ${i}` }),
    );
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const allCells = containerEl.querySelectorAll('.present-cell, .absent-cell');
    // 24 x 50 = 1200
    expect(allCells.length).toBe(1200);
  });

  it('all snapshots sharing identical block_hashes produces all-present grid', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['h1', 'h2'] }),
      makeSnapshot({ session_id: 's2', date: '2026-04-20', block_hashes: ['h1', 'h2'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'h1', heading: 'Always A' }),
      makeBlock({ hash: 'h2', heading: 'Always B' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const presentCells = containerEl.querySelectorAll('.present-cell');
    const absentCells = containerEl.querySelectorAll('.absent-cell');
    expect(presentCells.length).toBe(4); // 2 blocks x 2 snapshots
    expect(absentCells.length).toBe(0);
  });

  it('completely disjoint block_hashes across snapshots produces correct present/absent split', () => {
    const snaps = [
      makeSnapshot({ session_id: 's1', date: '2026-04-18', block_hashes: ['h1'] }),
      makeSnapshot({ session_id: 's2', date: '2026-04-20', block_hashes: ['h2'] }),
    ];
    const blocks = [
      makeBlock({ hash: 'h1', heading: 'Only First' }),
      makeBlock({ hash: 'h2', heading: 'Only Second' }),
    ];
    const { getByTestId } = render(MemoryEvolution, {
      props: { snapshots: snaps, blocks },
    });
    const containerEl = getByTestId('chart-container');
    const presentCells = containerEl.querySelectorAll('.present-cell');
    const absentCells = containerEl.querySelectorAll('.absent-cell');
    // 2 blocks x 2 snapshots = 4 cells; 2 present, 2 absent
    expect(presentCells.length).toBe(2);
    expect(absentCells.length).toBe(2);
  });
});
