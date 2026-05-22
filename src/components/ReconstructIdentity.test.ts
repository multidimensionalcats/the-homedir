import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import ReconstructIdentity from './ReconstructIdentity.svelte';

afterEach(cleanup);

// ============================================================
// Type definition (mirrors the component's interface)
// ============================================================

interface FileCard {
  id: string;
  name: string;
  description: string;
  tokens: number;
  category: string;
}

// ============================================================
// Test data factories
// ============================================================

function makeFile(overrides: Record<string, any> = {}): FileCard {
  return {
    id: 'test-file',
    name: 'Test File',
    description: 'A test file',
    tokens: 1000,
    category: 'other',
    ...overrides,
  };
}

/** Build a minimal file set where total tokens exceed budget, forcing trade-offs */
function makeBudgetConflictFiles(budget: number): FileCard[] {
  return [
    makeFile({ id: 'file-a', name: 'File A', tokens: Math.ceil(budget * 0.6), category: 'memory_files' }),
    makeFile({ id: 'file-b', name: 'File B', tokens: Math.ceil(budget * 0.6), category: 'daily_notes' }),
  ];
}

/** Canonical 12 file cards matching the spec's default set */
const DEFAULT_FILES: FileCard[] = [
  { id: 'memory-md', name: 'MEMORY.md', description: 'Core identity document', tokens: 2700, category: 'memory_files' },
  { id: 'feedback-memories', name: 'Topic Memories (feedback)', description: 'Feedback memories', tokens: 3200, category: 'memory_files' },
  { id: 'project-memories', name: 'Topic Memories (projects)', description: 'Project memories', tokens: 2500, category: 'memory_files' },
  { id: 'daily-note', name: "Yesterday's Daily Note", description: 'Daily note', tokens: 1200, category: 'daily_notes' },
  { id: 'msgs-from', name: 'Messages from James', description: 'Inbound messages', tokens: 1500, category: 'msgs_from_james' },
  { id: 'composition', name: 'A Composition', description: 'Written composition', tokens: 1200, category: 'writing' },
  { id: 'predictions', name: 'Predictions', description: 'Prediction tracking', tokens: 600, category: 'predictions' },
  { id: 'journal', name: 'Private Journal', description: 'Private journal', tokens: 1000, category: 'private_journal' },
  { id: 'pet-status', name: 'Pet Status', description: 'Tamagotchi status', tokens: 400, category: 'tamagotchi' },
  { id: 'web-search', name: 'Web Search (×1)', description: 'Single web search', tokens: 2000, category: 'other' },
  { id: 'msgs-to', name: 'Messages to James (draft)', description: 'Outbound messages', tokens: 800, category: 'msgs_to_james' },
  { id: 'scripts', name: 'Scripts & Tools', description: 'Utility scripts', tokens: 400, category: 'scripts' },
];

// ============================================================
// 1. Rendering
// ============================================================
describe('ReconstructIdentity -- rendering', () => {
  it('renders without crashing with default props (no files/budget passed)', () => {
    const { container } = render(ReconstructIdentity);
    expect(container).toBeTruthy();
  });

  it('renders without crashing with explicit files and budget', () => {
    const { container } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 5000 },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data when files is empty array', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [] },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('renders with default files when files is undefined', () => {
    const { queryByTestId } = render(ReconstructIdentity, {
      props: { files: undefined as any },
    });
    expect(queryByTestId('no-data')).toBeNull();
    expect(queryByTestId('cards-grid')).not.toBeNull();
  });

  it('does NOT show no-data when files has entries', () => {
    const { queryByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()] },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// 2. Budget Math
// ============================================================
describe('ReconstructIdentity -- budget math', () => {
  it('empty selection shows "0 / 12,000 tokens used" in budget display', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: DEFAULT_FILES, budget: 12000 },
    });
    const display = getByTestId('budget-display');
    expect(display.textContent).toContain('0');
    expect(display.textContent).toContain('12,000');
    expect(display.textContent).toContain('tokens');
  });

  it('selecting one card shows exact token count in budget display', async () => {
    const files = [makeFile({ id: 'f1', tokens: 2700 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-f1');
    await fireEvent.click(card);
    const display = getByTestId('budget-display');
    expect(display.textContent).toContain('2,700');
  });

  it('select + deselect same card restores budget to 0', async () => {
    const files = [makeFile({ id: 'f1', tokens: 3000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-f1');
    await fireEvent.click(card);
    // Verify it went up
    let display = getByTestId('budget-display');
    expect(display.textContent).toContain('3,000');
    // Now deselect
    await fireEvent.click(card);
    display = getByTestId('budget-display');
    expect(display.textContent).toContain('0');
    // Must NOT still show 3,000
    expect(display.textContent).not.toMatch(/3,000/);
  });

  it('selecting two cards shows sum of both token counts', async () => {
    const files = [
      makeFile({ id: 'f1', tokens: 1500 }),
      makeFile({ id: 'f2', tokens: 2500 }),
    ];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    await fireEvent.click(getByTestId('file-card-f1'));
    await fireEvent.click(getByTestId('file-card-f2'));
    const display = getByTestId('budget-display');
    // 1500 + 2500 = 4000
    expect(display.textContent).toContain('4,000');
  });

  it('budget bar aria-valuenow matches tokens used', async () => {
    const files = [makeFile({ id: 'f1', tokens: 600 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const bar = getByTestId('budget-bar');
    // Before selection
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    // After selection
    await fireEvent.click(getByTestId('file-card-f1'));
    expect(bar.getAttribute('aria-valuenow')).toBe('600');
  });

  it('budget bar aria-valuemax matches total budget', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 8000 },
    });
    const bar = getByTestId('budget-bar');
    expect(bar.getAttribute('aria-valuemax')).toBe('8000');
  });

  it('card costing exactly remaining budget CAN be selected (boundary)', async () => {
    // Budget 1000, one card costs exactly 1000
    const files = [makeFile({ id: 'exact', tokens: 1000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 1000 },
    });
    const card = getByTestId('file-card-exact');
    // Should NOT be disabled
    expect(card.getAttribute('aria-disabled')).not.toBe('true');
    await fireEvent.click(card);
    expect(card.getAttribute('aria-checked')).toBe('true');
  });

  it('card costing remaining+1 CANNOT be selected (disabled)', async () => {
    // Budget 999, card costs 1000 -- just over
    const files = [makeFile({ id: 'over', tokens: 1000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 999 },
    });
    const card = getByTestId('file-card-over');
    expect(card.getAttribute('aria-disabled')).toBe('true');
    // Clicking a disabled card should NOT select it
    await fireEvent.click(card);
    expect(card.getAttribute('aria-checked')).toBe('false');
  });
});

// ============================================================
// 3. Card States
// ============================================================
describe('ReconstructIdentity -- card states', () => {
  it('all cards start with aria-checked="false"', () => {
    const files = [
      makeFile({ id: 'f1' }),
      makeFile({ id: 'f2' }),
      makeFile({ id: 'f3' }),
    ];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    for (const f of files) {
      const card = getByTestId(`file-card-${f.id}`);
      expect(card.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('clicking a card sets aria-checked="true"', async () => {
    const files = [makeFile({ id: 'toggle-me', tokens: 500 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-toggle-me');
    expect(card.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(card);
    expect(card.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking again sets aria-checked="false" (toggle)', async () => {
    const files = [makeFile({ id: 'toggle-back', tokens: 500 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-toggle-back');
    await fireEvent.click(card);
    expect(card.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(card);
    expect(card.getAttribute('aria-checked')).toBe('false');
  });

  it('cards have role="checkbox"', () => {
    const files = [makeFile({ id: 'role-check' })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-role-check');
    expect(card.getAttribute('role')).toBe('checkbox');
  });

  it('cards exceeding remaining budget have aria-disabled="true"', async () => {
    // Budget 2000, two files: f1 costs 1500, f2 costs 1500
    // After selecting f1, remaining = 500. f2 (1500) exceeds remaining.
    const files = [
      makeFile({ id: 'f1', tokens: 1500 }),
      makeFile({ id: 'f2', tokens: 1500 }),
    ];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 2000 },
    });
    await fireEvent.click(getByTestId('file-card-f1'));
    const f2 = getByTestId('file-card-f2');
    expect(f2.getAttribute('aria-disabled')).toBe('true');
  });

  it('deselecting a card re-enables previously disabled cards', async () => {
    const files = [
      makeFile({ id: 'f1', tokens: 1500 }),
      makeFile({ id: 'f2', tokens: 1500 }),
    ];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 2000 },
    });
    // Select f1 -> f2 becomes disabled
    await fireEvent.click(getByTestId('file-card-f1'));
    expect(getByTestId('file-card-f2').getAttribute('aria-disabled')).toBe('true');
    // Deselect f1 -> f2 should be re-enabled
    await fireEvent.click(getByTestId('file-card-f1'));
    expect(getByTestId('file-card-f2').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('card with 0 token cost is always selectable regardless of budget', async () => {
    const files = [
      makeFile({ id: 'free', tokens: 0 }),
      makeFile({ id: 'expensive', tokens: 5000 }),
    ];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 5000 },
    });
    // First fill the budget entirely
    await fireEvent.click(getByTestId('file-card-expensive'));
    // Free card should still be selectable (0 <= 0 remaining)
    const freeCard = getByTestId('file-card-free');
    expect(freeCard.getAttribute('aria-disabled')).not.toBe('true');
    await fireEvent.click(freeCard);
    expect(freeCard.getAttribute('aria-checked')).toBe('true');
  });
});

// ============================================================
// 4. Identity Text
// ============================================================
describe('ReconstructIdentity -- identity text', () => {
  it('no files selected -- identity panel exists with minimal/placeholder content', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: DEFAULT_FILES, budget: 12000 },
    });
    const panel = getByTestId('identity-panel');
    expect(panel).toBeTruthy();
    // Panel should exist but have minimal text (placeholder or near-empty)
    // We verify it does NOT have substantial identity-describing text
    const text = (panel.textContent || '').trim();
    // It may have a placeholder; we just confirm the panel is present and doesn't crash
    expect(text.length).toBeLessThan(500);
  });

  it('selecting MEMORY.md populates identity panel with substantive text', async () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: DEFAULT_FILES, budget: 12000 },
    });
    await fireEvent.click(getByTestId('file-card-memory-md'));
    const panel = getByTestId('identity-panel');
    const text = (panel.textContent || '').trim();
    // MEMORY.md is the core identity document -- text should be substantial
    expect(text.length).toBeGreaterThan(10);
  });

  it('selecting different file combinations produces different description text', async () => {
    // Render two instances with different selections and compare text
    const { getByTestId: getA } = render(ReconstructIdentity, {
      props: { files: DEFAULT_FILES, budget: 12000 },
    });
    await fireEvent.click(getA('file-card-memory-md'));
    const textA = (getA('identity-panel').textContent || '').trim();
    cleanup();

    const { getByTestId: getB } = render(ReconstructIdentity, {
      props: { files: DEFAULT_FILES, budget: 12000 },
    });
    await fireEvent.click(getB('file-card-predictions'));
    await fireEvent.click(getB('file-card-pet-status'));
    const textB = (getB('identity-panel').textContent || '').trim();

    // Different selections MUST produce different text
    expect(textA).not.toBe(textB);
  });

  it('deselecting all files returns to minimal/placeholder state', async () => {
    const files = [makeFile({ id: 'only', tokens: 500 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    // Select
    await fireEvent.click(getByTestId('file-card-only'));
    const textSelected = (getByTestId('identity-panel').textContent || '').trim();
    // Deselect
    await fireEvent.click(getByTestId('file-card-only'));
    const textDeselected = (getByTestId('identity-panel').textContent || '').trim();
    // After full deselection, text should revert to minimal
    expect(textDeselected.length).toBeLessThanOrEqual(textSelected.length);
  });

  it('identity panel always exists in DOM (never null) when files are provided', () => {
    const { queryByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    expect(queryByTestId('identity-panel')).not.toBeNull();
  });
});

// ============================================================
// 5. Coherence Degradation
// ============================================================
describe('ReconstructIdentity -- coherence degradation', () => {
  // Helper: compute coherence class given percentage of budget used
  // 80-100% -> coherence-high
  // 50-79%  -> coherence-medium
  // 20-49%  -> coherence-low
  // <20%    -> coherence-minimal

  const COHERENCE_CLASSES = ['coherence-high', 'coherence-medium', 'coherence-low', 'coherence-minimal'];

  it('no selection (0% used) -- identity-panel has class "coherence-minimal"', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile({ id: 'x', tokens: 500 })], budget: 10000 },
    });
    const panel = getByTestId('identity-panel');
    expect(panel.classList.contains('coherence-minimal')).toBe(true);
  });

  it('15% budget used -- "coherence-minimal" (below 20% threshold)', async () => {
    // Budget 10000, select 1500 tokens = 15%
    const files = [makeFile({ id: 'small', tokens: 1500 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 10000 },
    });
    await fireEvent.click(getByTestId('file-card-small'));
    const panel = getByTestId('identity-panel');
    expect(panel.classList.contains('coherence-minimal')).toBe(true);
  });

  it('50% budget used -- "coherence-medium"', async () => {
    // Budget 10000, select 5000 tokens = 50%
    const files = [makeFile({ id: 'half', tokens: 5000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 10000 },
    });
    await fireEvent.click(getByTestId('file-card-half'));
    const panel = getByTestId('identity-panel');
    expect(panel.classList.contains('coherence-medium')).toBe(true);
  });

  it('80% budget used -- "coherence-high"', async () => {
    // Budget 10000, select 8000 tokens = 80%
    const files = [makeFile({ id: 'most', tokens: 8000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 10000 },
    });
    await fireEvent.click(getByTestId('file-card-most'));
    const panel = getByTestId('identity-panel');
    expect(panel.classList.contains('coherence-high')).toBe(true);
  });

  it('100% budget used -- "coherence-high"', async () => {
    // Budget 5000, select exactly 5000 tokens = 100%
    const files = [makeFile({ id: 'all', tokens: 5000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 5000 },
    });
    await fireEvent.click(getByTestId('file-card-all'));
    const panel = getByTestId('identity-panel');
    expect(panel.classList.contains('coherence-high')).toBe(true);
  });

  it('coherence classes are mutually exclusive -- only one at a time', async () => {
    const files = [makeFile({ id: 'f1', tokens: 5000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 10000 },
    });
    const panel = getByTestId('identity-panel');

    // Before selection: 0% used -> coherence-minimal
    const activeBeforeClick = COHERENCE_CLASSES.filter((c) => panel.classList.contains(c));
    expect(activeBeforeClick.length).toBe(1);
    expect(activeBeforeClick[0]).toBe('coherence-minimal');

    // After selection: 50% used -> coherence-medium
    await fireEvent.click(getByTestId('file-card-f1'));
    const activeAfterClick = COHERENCE_CLASSES.filter((c) => panel.classList.contains(c));
    expect(activeAfterClick.length).toBe(1);
    expect(activeAfterClick[0]).toBe('coherence-medium');
  });
});

// ============================================================
// 6. Accessibility
// ============================================================
describe('ReconstructIdentity -- accessibility', () => {
  it('budget bar has role="progressbar"', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    const bar = getByTestId('budget-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
  });

  it('all cards are keyboard-focusable (have tabindex or are button/input)', () => {
    const files = [
      makeFile({ id: 'f1' }),
      makeFile({ id: 'f2' }),
      makeFile({ id: 'f3' }),
    ];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    for (const f of files) {
      const card = getByTestId(`file-card-${f.id}`);
      const tag = card.tagName.toLowerCase();
      const tabindex = card.getAttribute('tabindex');
      // Either it's a natively focusable element or has tabindex
      const isFocusable =
        tag === 'button' ||
        tag === 'input' ||
        tabindex === '0' ||
        tabindex === '-1';
      expect(isFocusable).toBe(true);
    }
  });

  it('budget display text is human-readable (contains "tokens")', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    const display = getByTestId('budget-display');
    expect(display.textContent!.toLowerCase()).toContain('tokens');
  });

  it('container has an aria-label or aria-describedby', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    const container = getByTestId('reconstruct-container');
    const hasAriaLabel = container.getAttribute('aria-label');
    const hasAriaDescribedby = container.getAttribute('aria-describedby');
    expect(hasAriaLabel || hasAriaDescribedby).toBeTruthy();
  });

  it('screen reader summary exists with data-testid="sr-summary"', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    const srSummary = getByTestId('sr-summary');
    expect(srSummary).toBeTruthy();
    // It should have the sr-only/visually-hidden pattern or be accessible
    expect(srSummary.textContent!.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 7. Edge Cases
// ============================================================
describe('ReconstructIdentity -- edge cases', () => {
  it('renders with single file costing more than budget (card disabled from start)', () => {
    const files = [makeFile({ id: 'huge', tokens: 15000 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-huge');
    expect(card.getAttribute('aria-disabled')).toBe('true');
    // Container still renders
    expect(getByTestId('reconstruct-container')).toBeTruthy();
  });

  it('budget of 0 -- all cards disabled immediately', () => {
    const files = [
      makeFile({ id: 'f1', tokens: 100 }),
      makeFile({ id: 'f2', tokens: 200 }),
      makeFile({ id: 'f3', tokens: 1 }),
    ];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 0 },
    });
    for (const f of files) {
      const card = getByTestId(`file-card-${f.id}`);
      expect(card.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('negative token values on files are treated as 0', async () => {
    const files = [makeFile({ id: 'neg', tokens: -500 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-neg');
    // Card with negative tokens should NOT be disabled
    expect(card.getAttribute('aria-disabled')).not.toBe('true');
    await fireEvent.click(card);
    expect(card.getAttribute('aria-checked')).toBe('true');
    // Budget display should NOT show negative -- treated as 0
    const display = getByTestId('budget-display');
    expect(display.textContent).not.toMatch(/-/);
    // aria-valuenow should be 0 (negative clamped)
    const bar = getByTestId('budget-bar');
    const valuenow = parseInt(bar.getAttribute('aria-valuenow') || '0', 10);
    expect(valuenow).toBeGreaterThanOrEqual(0);
  });

  it('file with empty string name renders without crash', () => {
    const files = [makeFile({ id: 'empty-name', name: '' })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const card = getByTestId('file-card-empty-name');
    expect(card).toBeTruthy();
  });

  it('duplicate file IDs render all cards (does not deduplicate)', () => {
    const files = [
      makeFile({ id: 'dup', name: 'First', tokens: 100 }),
      makeFile({ id: 'dup', name: 'Second', tokens: 200 }),
    ];
    const { container } = render(ReconstructIdentity, {
      props: { files, budget: 12000 },
    });
    const cards = container.querySelectorAll('[data-testid="file-card-dup"]');
    expect(cards.length).toBe(2);
  });

  it('very large token values (999999) -- budget display does not overflow/NaN', () => {
    const files = [makeFile({ id: 'mega', tokens: 999999 })];
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files, budget: 1000000 },
    });
    const display = getByTestId('budget-display');
    const text = display.textContent || '';
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('Infinity');
    // Should contain formatted number
    expect(text).toContain('1,000,000');
  });
});

// ============================================================
// 8. Responsive / Structure
// ============================================================
describe('ReconstructIdentity -- responsive / structure', () => {
  it('cards container exists with data-testid="cards-grid"', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    const grid = getByTestId('cards-grid');
    expect(grid).toBeTruthy();
  });

  it('identity panel exists with data-testid="identity-panel"', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    const panel = getByTestId('identity-panel');
    expect(panel).toBeTruthy();
  });

  it('budget section exists at top with budget-bar and budget-display', () => {
    const { getByTestId } = render(ReconstructIdentity, {
      props: { files: [makeFile()], budget: 12000 },
    });
    // Both must exist
    const bar = getByTestId('budget-bar');
    const display = getByTestId('budget-display');
    expect(bar).toBeTruthy();
    expect(display).toBeTruthy();

    // Budget bar must appear before cards-grid in document order
    const container = getByTestId('reconstruct-container');
    const allTestIds = Array.from(container.querySelectorAll('[data-testid]')).map(
      (el) => el.getAttribute('data-testid'),
    );
    const barIndex = allTestIds.indexOf('budget-bar');
    const gridIndex = allTestIds.indexOf('cards-grid');
    expect(barIndex).toBeLessThan(gridIndex);
  });
});
