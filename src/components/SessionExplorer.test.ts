import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import SessionExplorer from './SessionExplorer.svelte';
import { versionColor, categoryColor } from '../lib/chart-utils';

afterEach(cleanup);

// ============================================================
// Test data factories
// ============================================================

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'sess-042',
    date: '2025-11-03',
    time_of_day: 'PM',
    version: '4.6',
    turns: 37,
    attention_profile: {
      writing: { reads: 5, writes: 2 },
      daily_notes: { reads: 3, writes: 1 },
    },
    web_searches: ['Claude identity', 'persistent memory AI'],
    wrote_composition: true,
    wrote_private_journal: false,
    updated_memory: true,
    messaged_james: false,
    wrote_prediction: true,
    ...overrides,
  };
}

/** Session where every activity flag is true */
function makeAllActiveSession() {
  return makeSession({
    id: 'sess-all-active',
    wrote_composition: true,
    wrote_private_journal: true,
    updated_memory: true,
    messaged_james: true,
    wrote_prediction: true,
  });
}

/** Session where every activity flag is false */
function makeAllInactiveSession() {
  return makeSession({
    id: 'sess-all-inactive',
    wrote_composition: false,
    wrote_private_journal: false,
    updated_memory: false,
    messaged_james: false,
    wrote_prediction: false,
  });
}

/** Session with empty profile and no searches */
function makeBareboneSession() {
  return makeSession({
    id: 'sess-bare',
    attention_profile: {},
    web_searches: [],
    wrote_composition: false,
    wrote_private_journal: false,
    updated_memory: false,
    messaged_james: false,
    wrote_prediction: false,
  });
}

// ============================================================
// 1. Rendering
// ============================================================
describe('SessionExplorer -- rendering', () => {
  it('renders without crashing with session data', () => {
    const { container } = render(SessionExplorer, {
      props: { session: makeSession() },
    });
    expect(container).toBeTruthy();
  });

  it('shows no-data when session is undefined', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: undefined },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('shows no-data when session is null', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: null as any },
    });
    const noData = getByTestId('no-data');
    expect(noData).toBeTruthy();
  });

  it('does NOT show no-data when session is valid', () => {
    const { queryByTestId } = render(SessionExplorer, {
      props: { session: makeSession() },
    });
    expect(queryByTestId('no-data')).toBeNull();
  });
});

// ============================================================
// 2. Session Metadata
// ============================================================
describe('SessionExplorer -- session metadata', () => {
  it('session-id shows the session ID value', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession({ id: 'sess-XYZ-999' }) },
    });
    const idEl = getByTestId('session-id');
    expect(idEl.textContent).toContain('sess-XYZ-999');
  });

  it('version-badge shows the version string', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession({ version: '4.7' }) },
    });
    const badge = getByTestId('version-badge');
    expect(badge.textContent).toContain('4.7');
  });

  it('version-badge has version color as background', () => {
    const session = makeSession({ version: '4.5' });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const badge = getByTestId('version-badge');
    const expectedColor = versionColor('4.5');
    // Badge must use the version color somewhere in its style
    const style = badge.getAttribute('style') || '';
    expect(style).toContain(expectedColor);
  });

  it('session-date shows date and time_of_day', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession({ date: '2025-12-25', time_of_day: 'AM' }) },
    });
    const dateEl = getByTestId('session-date');
    expect(dateEl.textContent).toContain('2025-12-25');
    expect(dateEl.textContent).toContain('AM');
  });

  it('turn-count shows the number of turns', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession({ turns: 142 }) },
    });
    const turnEl = getByTestId('turn-count');
    expect(turnEl.textContent).toContain('142');
  });
});

// ============================================================
// 3. Activity Flags
// ============================================================
describe('SessionExplorer -- activity flags', () => {
  it('activity-flags container exists', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession() },
    });
    expect(getByTestId('activity-flags')).toBeTruthy();
  });

  it('each true boolean gets the active class', () => {
    const session = makeSession({
      wrote_composition: true,
      updated_memory: true,
      wrote_prediction: true,
      wrote_private_journal: false,
      messaged_james: false,
    });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const flagsContainer = getByTestId('activity-flags');
    const flags = flagsContainer.querySelectorAll('.activity-flag');

    const compositionFlag = flagsContainer.querySelector('[data-activity="wrote_composition"]');
    expect(compositionFlag?.classList.contains('active')).toBe(true);

    const memoryFlag = flagsContainer.querySelector('[data-activity="updated_memory"]');
    expect(memoryFlag?.classList.contains('active')).toBe(true);

    const predictionFlag = flagsContainer.querySelector('[data-activity="wrote_prediction"]');
    expect(predictionFlag?.classList.contains('active')).toBe(true);
  });

  it('false booleans get the inactive class', () => {
    const session = makeSession({
      wrote_composition: false,
      wrote_private_journal: false,
      updated_memory: false,
      messaged_james: false,
      wrote_prediction: false,
    });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const flagsContainer = getByTestId('activity-flags');

    const allFlags = flagsContainer.querySelectorAll('.activity-flag');
    allFlags.forEach((flag) => {
      expect(flag.classList.contains('inactive')).toBe(true);
      expect(flag.classList.contains('active')).toBe(false);
    });
  });

  it('renders all 5 activity flags', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession() },
    });
    const flagsContainer = getByTestId('activity-flags');
    const flags = flagsContainer.querySelectorAll('.activity-flag');
    expect(flags.length).toBe(5);
  });

  it('flags have data-activity attributes matching field names', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession() },
    });
    const flagsContainer = getByTestId('activity-flags');
    const expectedActivities = [
      'wrote_composition',
      'wrote_private_journal',
      'updated_memory',
      'messaged_james',
      'wrote_prediction',
    ];
    expectedActivities.forEach((activity) => {
      const flag = flagsContainer.querySelector(`[data-activity="${activity}"]`);
      expect(flag).not.toBeNull();
    });
  });
});

// ============================================================
// 4. Attention Profile
// ============================================================
describe('SessionExplorer -- attention profile', () => {
  it('attention-chart exists when profile is non-empty', () => {
    const { getByTestId } = render(SessionExplorer, {
      props: { session: makeSession() },
    });
    expect(getByTestId('attention-chart')).toBeTruthy();
  });

  it('shows category names from the attention profile', () => {
    const session = makeSession({
      attention_profile: {
        writing: { reads: 10, writes: 3 },
        predictions: { reads: 2, writes: 0 },
        private_journal: { reads: 1, writes: 1 },
      },
    });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const chart = getByTestId('attention-chart');
    const text = chart.textContent || '';
    expect(text).toContain('writing');
    expect(text).toContain('predictions');
    expect(text).toContain('private_journal');
  });

  it('empty attention_profile shows empty-profile message', () => {
    const session = makeSession({ attention_profile: {} });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const emptyEl = getByTestId('empty-profile');
    expect(emptyEl).toBeTruthy();
    expect(emptyEl.textContent).toBeTruthy();
  });

  it('categories with activity get visual bars with non-zero width', () => {
    const session = makeSession({
      attention_profile: {
        writing: { reads: 10, writes: 5 },
        daily_notes: { reads: 1, writes: 0 },
      },
    });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const chart = getByTestId('attention-chart');
    // Should have bar elements (divs with a width style) for each category
    const bars = chart.querySelectorAll('[data-category]');
    expect(bars.length).toBe(2);
    // Each bar should have a width style representing its proportion
    bars.forEach((bar) => {
      const style = bar.getAttribute('style') || '';
      expect(style).toContain('width');
    });
  });
});

// ============================================================
// 5. Web Searches
// ============================================================
describe('SessionExplorer -- web searches', () => {
  it('web-searches shows search terms', () => {
    const session = makeSession({
      web_searches: ['quantum computing', 'AI alignment'],
    });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const searchesEl = getByTestId('web-searches');
    const text = searchesEl.textContent || '';
    expect(text).toContain('quantum computing');
    expect(text).toContain('AI alignment');
  });

  it('empty searches shows "None" or equivalent', () => {
    const session = makeSession({ web_searches: [] });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const searchesEl = getByTestId('web-searches');
    const text = (searchesEl.textContent || '').toLowerCase();
    expect(text).toMatch(/none/i);
  });

  it('multiple searches all rendered as separate items', () => {
    const terms = ['search alpha', 'search beta', 'search gamma'];
    const session = makeSession({ web_searches: terms });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const searchesEl = getByTestId('web-searches');
    const text = searchesEl.textContent || '';
    terms.forEach((term) => {
      expect(text).toContain(term);
    });
  });
});

// ============================================================
// 6. Edge Cases
// ============================================================
describe('SessionExplorer -- edge cases', () => {
  it('session with all flags false renders all as inactive', () => {
    const session = makeAllInactiveSession();
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const flagsContainer = getByTestId('activity-flags');
    const activeFlags = flagsContainer.querySelectorAll('.activity-flag.active');
    expect(activeFlags.length).toBe(0);
    const inactiveFlags = flagsContainer.querySelectorAll('.activity-flag.inactive');
    expect(inactiveFlags.length).toBe(5);
  });

  it('session with all flags true renders all as active', () => {
    const session = makeAllActiveSession();
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    const flagsContainer = getByTestId('activity-flags');
    const activeFlags = flagsContainer.querySelectorAll('.activity-flag.active');
    expect(activeFlags.length).toBe(5);
    const inactiveFlags = flagsContainer.querySelectorAll('.activity-flag.inactive');
    expect(inactiveFlags.length).toBe(0);
  });

  it('session with undefined web_searches does not crash', () => {
    const session = makeSession({ web_searches: undefined });
    const { getByTestId } = render(SessionExplorer, {
      props: { session },
    });
    // Should still render the container
    expect(getByTestId('session-container')).toBeTruthy();
    // web-searches should show "None" or equivalent
    const searchesEl = getByTestId('web-searches');
    const text = (searchesEl.textContent || '').toLowerCase();
    expect(text).toMatch(/none/i);
  });

  it('cleanup on unmount removes elements from DOM', () => {
    const { getByTestId, unmount } = render(SessionExplorer, {
      props: { session: makeSession() },
    });
    expect(getByTestId('session-container')).toBeTruthy();
    unmount();
    const orphan = document.querySelector('[data-testid="session-container"]');
    expect(orphan).toBeNull();
  });
});
