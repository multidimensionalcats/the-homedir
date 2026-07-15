import { describe, it, expect } from 'vitest';
import {
  sessionsToDaily,
  sessionsToWeekly,
  sessionsToVersionPhases,
  sessionsToAttentionCategories,
  memoryToSwimlane,
  messagesToTimeline,
  predictionsToCalibration,
  petEventsToLifecycles,
  deriveVersionTransitions,
  mergeTransitionCuration,
  deriveCareWindow,
} from './transforms';
import type {
  DailyEntry,
  WeeklyEntry,
  VersionPhase,
  AttentionCategory,
  SwimlaneData,
  TimelineMessage,
  CalibrationPrediction,
  PetLifecycle,
  VersionTransition,
  CuratedTransition,
  CareDay,
} from './transforms';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'sess-001',
    date: '2026-01-15',
    time_of_day: 'PM',
    version: '4.5',
    timestamp_start: '2026-01-15T22:00:11+00:00',
    turns: 27,
    tokens_total_input: null,
    attention_profile: {
      msgs_to_james: { reads: 1, writes: 1 },
      daily_notes: { reads: 2, writes: 0 },
    },
    web_searches: [],
    wrote_composition: false,
    wrote_private_journal: false,
    updated_memory: false,
    messaged_james: true,
    wrote_prediction: false,
    ...overrides,
  };
}

function makeEmptySession(overrides: Record<string, any> = {}) {
  return makeSession({ attention_profile: {}, ...overrides });
}

function makeMessage(overrides: Record<string, any> = {}) {
  return {
    direction: 'from_james',
    date: '2026-02-24',
    content: 'Hello, how are you doing today?',
    line_start: 211,
    line_end: 221,
    ...overrides,
  };
}

function makePrediction(overrides: Record<string, any> = {}) {
  return {
    text: 'Ceasefire extends past March',
    confidence: 0.6,
    date_made: '2026-04-20',
    resolution_date: '2026-05-10',
    outcome: null,
    self_assessment: 'Seems likely given recent events',
    ...overrides,
  };
}

function makePetEvent(overrides: Record<string, any> = {}) {
  return {
    pet_name: 'Pixel',
    event_type: 'acquired',
    event_timestamp: '2026-01-15T00:00:00+00:00',
    notes: 'Pixel was acquired today',
    ...overrides,
  };
}

// ============================================================
// sessionsToDaily
// ============================================================
describe('sessionsToDaily', () => {
  describe('empty input', () => {
    it('returns an empty array for empty input', () => {
      expect(sessionsToDaily([])).toEqual([]);
    });
  });

  describe('single session', () => {
    it('produces one entry with correct date, hasAttentionData, and sessionCount', () => {
      const result = sessionsToDaily([makeSession()]);
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-01-15');
      expect(result[0].hasAttentionData).toBe(true);
      expect(result[0].sessionCount).toBe(1);
    });

    it('populates categories from attention_profile with correct reads/writes', () => {
      const result = sessionsToDaily([makeSession()]);
      expect(result[0].categories).toEqual({
        msgs_to_james: { reads: 1, writes: 1 },
        daily_notes: { reads: 2, writes: 0 },
      });
    });

    it('carries the version from the session', () => {
      const result = sessionsToDaily([makeSession({ version: '4.7' })]);
      expect(result[0].version).toBe('4.7');
    });
  });

  describe('aggregation — same date', () => {
    it('merges multiple sessions on the same date into one entry with correct sessionCount', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-15', time_of_day: 'AM' }),
        makeSession({ id: 'b', date: '2026-01-15', time_of_day: 'PM' }),
      ];
      const result = sessionsToDaily(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].sessionCount).toBe(2);
    });

    it('union-merges categories and sums reads/writes across sessions on the same day', () => {
      const sessions = [
        makeSession({
          id: 'a',
          date: '2026-03-01',
          attention_profile: {
            daily_notes: { reads: 2, writes: 1 },
            writing: { reads: 0, writes: 1 },
          },
        }),
        makeSession({
          id: 'b',
          date: '2026-03-01',
          attention_profile: {
            daily_notes: { reads: 3, writes: 0 },
            memory_files: { reads: 1, writes: 0 },
          },
        }),
      ];
      const result = sessionsToDaily(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].categories.daily_notes).toEqual({ reads: 5, writes: 1 });
      expect(result[0].categories.writing).toEqual({ reads: 0, writes: 1 });
      expect(result[0].categories.memory_files).toEqual({ reads: 1, writes: 0 });
    });

    it('sets hasAttentionData: true when ANY session on that day has attention data', () => {
      const sessions = [
        makeEmptySession({ id: 'a', date: '2026-02-10' }),
        makeSession({ id: 'b', date: '2026-02-10' }),
      ];
      const result = sessionsToDaily(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].hasAttentionData).toBe(true);
    });
  });

  describe('empty attention profiles', () => {
    it('marks hasAttentionData: false when all sessions on a date have empty profiles', () => {
      const sessions = [
        makeEmptySession({ id: 'a', date: '2026-04-01' }),
        makeEmptySession({ id: 'b', date: '2026-04-01' }),
      ];
      const result = sessionsToDaily(sessions);
      expect(result[0].hasAttentionData).toBe(false);
      expect(result[0].categories).toEqual({});
    });

    it('treats a category with reads:0, writes:0 as hasAttentionData: true (key exists)', () => {
      const session = makeSession({
        attention_profile: {
          scripts: { reads: 0, writes: 0 },
        },
      });
      const result = sessionsToDaily([session]);
      expect(result[0].hasAttentionData).toBe(true);
      expect(result[0].categories.scripts).toEqual({ reads: 0, writes: 0 });
    });

    it('handles session with missing attention_profile key entirely (undefined)', () => {
      const session = makeSession();
      delete session.attention_profile;
      const result = sessionsToDaily([session]);
      expect(result).toHaveLength(1);
      expect(result[0].hasAttentionData).toBe(false);
      expect(result[0].categories).toEqual({});
    });
  });

  describe('ordering and boundaries', () => {
    it('returns entries sorted chronologically by date', () => {
      const sessions = [
        makeSession({ id: 'c', date: '2026-03-15' }),
        makeSession({ id: 'a', date: '2026-01-10' }),
        makeSession({ id: 'b', date: '2026-02-20' }),
      ];
      const result = sessionsToDaily(sessions);
      expect(result.map((e) => e.date)).toEqual([
        '2026-01-10',
        '2026-02-20',
        '2026-03-15',
      ]);
    });

    it('produces separate entries for consecutive dates (off-by-one guard)', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-06-14' }),
        makeSession({ id: 'b', date: '2026-06-15' }),
      ];
      const result = sessionsToDaily(sessions);
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2026-06-14');
      expect(result[1].date).toBe('2026-06-15');
    });

    it('uses the version from the first session on a multi-session day', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-05-01', version: '4.6', time_of_day: 'AM' }),
        makeSession({ id: 'b', date: '2026-05-01', version: '4.7', time_of_day: 'PM' }),
      ];
      const result = sessionsToDaily(sessions);
      // The version should come from the first session encountered
      expect(result[0].version).toBe('4.6');
    });
  });
});

// ============================================================
// sessionsToWeekly
// ============================================================
describe('sessionsToWeekly', () => {
  describe('empty input', () => {
    it('returns an empty array for empty input', () => {
      expect(sessionsToWeekly([])).toEqual([]);
    });
  });

  describe('single session', () => {
    it('produces one weekly entry from a single session', () => {
      // 2026-01-15 is a Thursday. ISO week starts Monday = 2026-01-12
      const result = sessionsToWeekly([makeSession({ date: '2026-01-15' })]);
      expect(result).toHaveLength(1);
      expect(result[0].weekStart).toBe('2026-01-12');
      expect(result[0].sessionCount).toBe(1);
    });
  });

  describe('weekStart is always a Monday', () => {
    it('calculates correct Monday for a Thursday session', () => {
      // 2026-01-15 is Thursday, Monday = 2026-01-12
      const result = sessionsToWeekly([makeSession({ date: '2026-01-15' })]);
      const weekStartDate = new Date(result[0].weekStart);
      expect(weekStartDate.getUTCDay()).toBe(1); // Monday = 1
    });

    it('calculates correct Monday for a Monday session', () => {
      // 2026-01-12 is already a Monday
      const result = sessionsToWeekly([makeSession({ date: '2026-01-12' })]);
      expect(result[0].weekStart).toBe('2026-01-12');
    });

    it('calculates correct Monday for a Sunday session', () => {
      // 2026-01-18 is a Sunday, Monday of that week = 2026-01-12
      const result = sessionsToWeekly([makeSession({ date: '2026-01-18' })]);
      expect(result[0].weekStart).toBe('2026-01-12');
    });
  });

  describe('aggregation within same week', () => {
    it('aggregates seven sessions Mon-Sun into one entry with sessionCount: 7', () => {
      // Week of 2026-01-12 (Mon) to 2026-01-18 (Sun)
      const sessions = Array.from({ length: 7 }, (_, i) => {
        const day = 12 + i;
        const dd = String(day).padStart(2, '0');
        return makeSession({ id: `s${i}`, date: `2026-01-${dd}` });
      });
      const result = sessionsToWeekly(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].sessionCount).toBe(7);
    });

    it('places Sunday and the next Monday in different weeks', () => {
      const sessions = [
        makeSession({ id: 'sun', date: '2026-01-18' }), // Sunday
        makeSession({ id: 'mon', date: '2026-01-19' }), // Monday
      ];
      const result = sessionsToWeekly(sessions);
      expect(result).toHaveLength(2);
      expect(result[0].weekStart).not.toBe(result[1].weekStart);
    });
  });

  describe('ISO week edge cases', () => {
    it('handles Jan 1 2026 (Thursday) — week 1 starts Dec 29 2025', () => {
      // Jan 1, 2026 is a Thursday. ISO week 1 of 2026 starts on Mon Dec 29 2025.
      const result = sessionsToWeekly([makeSession({ date: '2026-01-01' })]);
      expect(result[0].weekStart).toBe('2025-12-29');
    });

    it('correctly handles multiple sessions straddling Dec 31/Jan 1 year boundary', () => {
      const sessions = [
        makeSession({ id: 'dec31', date: '2025-12-31', version: '4.5' }),
        makeSession({ id: 'jan1', date: '2026-01-01', version: '4.5' }),
      ];
      const result = sessionsToWeekly(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].weekStart).toBe('2025-12-29');
      expect(result[0].sessionCount).toBe(2);
    });
  });

  describe('sorting and gaps', () => {
    it('returns entries sorted by weekStart ascending', () => {
      const sessions = [
        makeSession({ id: 'late', date: '2026-03-15' }),
        makeSession({ id: 'early', date: '2026-01-15' }),
      ];
      const result = sessionsToWeekly(sessions);
      expect(result[0].weekStart < result[1].weekStart).toBe(true);
    });

    it('does NOT pad weeks with no sessions (large gap produces only weeks with data)', () => {
      const sessions = [
        makeSession({ id: 'jan', date: '2026-01-15' }),
        makeSession({ id: 'jun', date: '2026-06-15' }),
      ];
      const result = sessionsToWeekly(sessions);
      expect(result).toHaveLength(2);
    });
  });

  describe('attention data merging across week', () => {
    it('sets hasAttentionData: true if any session in the week has data', () => {
      const sessions = [
        makeEmptySession({ id: 'a', date: '2026-01-12' }),
        makeSession({ id: 'b', date: '2026-01-14' }),
      ];
      const result = sessionsToWeekly(sessions);
      expect(result[0].hasAttentionData).toBe(true);
    });
  });
});

// ============================================================
// sessionsToVersionPhases
// ============================================================
describe('sessionsToVersionPhases', () => {
  describe('empty input', () => {
    it('returns an empty array for empty input', () => {
      expect(sessionsToVersionPhases([])).toEqual([]);
    });
  });

  describe('single version', () => {
    it('produces one phase from sessions all with the same version', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-01-20', version: '4.5' }),
        makeSession({ id: 'c', date: '2026-02-05', version: '4.5' }),
      ];
      const result = sessionsToVersionPhases(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].version).toBe('4.5');
      expect(result[0].sessionCount).toBe(3);
      expect(result[0].startDate).toBe('2026-01-10');
      expect(result[0].endDate).toBe('2026-02-05');
    });
  });

  describe('multiple versions', () => {
    it('produces three phases for three distinct versions sorted by startDate', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-05', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-02-15', version: '4.6' }),
        makeSession({ id: 'c', date: '2026-04-01', version: '4.7' }),
      ];
      const result = sessionsToVersionPhases(sessions);
      expect(result).toHaveLength(3);
      expect(result[0].version).toBe('4.5');
      expect(result[1].version).toBe('4.6');
      expect(result[2].version).toBe('4.7');
      expect(result[0].startDate < result[1].startDate).toBe(true);
      expect(result[1].startDate < result[2].startDate).toBe(true);
    });
  });

  describe('empty session counting', () => {
    it('counts emptyCount as sessions with empty attention_profile', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', version: '4.5' }),
        makeEmptySession({ id: 'b', date: '2026-01-12', version: '4.5' }),
        makeEmptySession({ id: 'c', date: '2026-01-14', version: '4.5' }),
      ];
      const result = sessionsToVersionPhases(sessions);
      expect(result[0].emptyCount).toBe(2);
      expect(result[0].sessionCount).toBe(3);
    });

    it('sets emptyCount to sessionCount when ALL sessions are empty', () => {
      const sessions = [
        makeEmptySession({ id: 'a', date: '2026-03-01', version: '4.6' }),
        makeEmptySession({ id: 'b', date: '2026-03-05', version: '4.6' }),
      ];
      const result = sessionsToVersionPhases(sessions);
      expect(result[0].emptyCount).toBe(2);
      expect(result[0].emptyCount).toBe(result[0].sessionCount);
    });

    it('sets emptyCount to 0 when NO sessions are empty', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-01', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-01-02', version: '4.5' }),
      ];
      const result = sessionsToVersionPhases(sessions);
      expect(result[0].emptyCount).toBe(0);
    });
  });

  describe('single session version', () => {
    it('sets startDate === endDate for a version with a single session', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-05-01', version: '4.7' }),
      ];
      const result = sessionsToVersionPhases(sessions);
      expect(result[0].startDate).toBe('2026-05-01');
      expect(result[0].endDate).toBe('2026-05-01');
      expect(result[0].sessionCount).toBe(1);
    });
  });
});

// ============================================================
// sessionsToAttentionCategories
// ============================================================
describe('sessionsToAttentionCategories', () => {
  const KNOWN_CATEGORIES = [
    'conversations',
    'daily_notes',
    'experiments',
    'learning',
    'memory_files',
    'msgs_from_james',
    'msgs_to_james',
    'other',
    'predictions',
    'private_journal',
    'scripts',
    'tamagotchi',
    'writing',
  ];

  const KNOWN_COLORS: Record<string, string> = {
    memory_files: '#E8A838',
    daily_notes: '#6B8E9A',
    writing: '#C1665A',
    msgs_to_james: '#5A9E6F',
    msgs_from_james: '#7BC48F',
    private_journal: '#4A1A6B',
    predictions: '#4ade80',
    tamagotchi: '#C44B4B',
    scripts: '#8A8A8A',
    experiments: '#9D7CD8',
    conversations: '#78A9D4',
    learning: '#D4A574',
    other: '#555962',
  };

  it('returns exactly 13 categories', () => {
    const result = sessionsToAttentionCategories();
    expect(result).toHaveLength(13);
  });

  it('contains all 13 known category names', () => {
    const result = sessionsToAttentionCategories();
    const names = result.map((c) => c.name);
    for (const cat of KNOWN_CATEGORIES) {
      expect(names).toContain(cat);
    }
  });

  it('has no duplicate names', () => {
    const result = sessionsToAttentionCategories();
    const names = result.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no duplicate colors', () => {
    const result = sessionsToAttentionCategories();
    const colors = result.map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('uses valid hex color format (#RRGGBB) for every entry', () => {
    const result = sessionsToAttentionCategories();
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    for (const cat of result) {
      expect(cat.color).toMatch(hexRegex);
    }
  });

  it('has non-empty name, displayName, and color for every entry', () => {
    const result = sessionsToAttentionCategories();
    for (const cat of result) {
      expect(cat.name.length).toBeGreaterThan(0);
      expect(cat.displayName.length).toBeGreaterThan(0);
      expect(cat.color.length).toBeGreaterThan(0);
    }
  });

  it('uses human-readable displayNames (no snake_case, contains space or starts uppercase)', () => {
    const result = sessionsToAttentionCategories();
    for (const cat of result) {
      // Must not contain underscores (snake_case)
      expect(cat.displayName).not.toContain('_');
      // Must start with an uppercase letter
      expect(cat.displayName[0]).toBe(cat.displayName[0].toUpperCase());
    }
  });

  it('returns categories sorted alphabetically by name', () => {
    const result = sessionsToAttentionCategories();
    const names = result.map((c) => c.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

// ============================================================
// memoryToSwimlane
// ============================================================
describe('memoryToSwimlane', () => {
  describe('empty input', () => {
    it('returns empty snapshots and blocks for empty snapshots array', () => {
      const result = memoryToSwimlane({ snapshots: [], blocks: [] });
      expect(result.snapshots).toEqual([]);
      expect(result.blocks).toEqual([]);
    });
  });

  describe('single snapshot and block', () => {
    it('maps a single snapshot with one block — persistence = 1.0', () => {
      const input = {
        snapshots: [
          { session_id: 's1', date: '2026-04-18', token_count: 768, block_hashes: ['h1'] },
        ],
        blocks: [
          { hash: 'h1', heading: 'Identity & Context', first_seen_date: '2026-04-18', last_seen_date: '2026-05-18' },
        ],
      };
      const result = memoryToSwimlane(input);
      expect(result.snapshots).toHaveLength(1);
      expect(result.snapshots[0].sessionId).toBe('s1');
      expect(result.snapshots[0].tokenCount).toBe(768);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].persistence).toBe(1.0);
      expect(result.blocks[0].snapshotIndices).toEqual([0]);
    });
  });

  describe('persistence calculation', () => {
    it('calculates persistence as fraction of snapshots containing the block', () => {
      const input = {
        snapshots: Array.from({ length: 10 }, (_, i) => ({
          session_id: `s${i}`,
          date: `2026-04-${String(i + 1).padStart(2, '0')}`,
          token_count: 500,
          block_hashes: i === 0 ? ['rare'] : ['common'],
        })),
        blocks: [
          { hash: 'rare', heading: 'Rare Block', first_seen_date: '2026-04-01', last_seen_date: '2026-04-01' },
          { hash: 'common', heading: 'Common Block', first_seen_date: '2026-04-02', last_seen_date: '2026-04-10' },
        ],
      };
      const result = memoryToSwimlane(input);
      const rareBlock = result.blocks.find((b) => b.hash === 'rare')!;
      const commonBlock = result.blocks.find((b) => b.hash === 'common')!;
      expect(rareBlock.persistence).toBeCloseTo(0.1, 5);
      expect(commonBlock.persistence).toBeCloseTo(0.9, 5);
    });

    it('sets persistence = 1.0 when block appears in ALL snapshots', () => {
      const input = {
        snapshots: [
          { session_id: 's1', date: '2026-04-01', token_count: 100, block_hashes: ['always'] },
          { session_id: 's2', date: '2026-04-02', token_count: 100, block_hashes: ['always'] },
          { session_id: 's3', date: '2026-04-03', token_count: 100, block_hashes: ['always'] },
        ],
        blocks: [
          { hash: 'always', heading: 'Always Present', first_seen_date: '2026-04-01', last_seen_date: '2026-04-03' },
        ],
      };
      const result = memoryToSwimlane(input);
      expect(result.blocks[0].persistence).toBe(1.0);
    });
  });

  describe('snapshotIndices', () => {
    it('lists correct indices for which snapshots contain the block', () => {
      const input = {
        snapshots: [
          { session_id: 's0', date: '2026-04-01', token_count: 100, block_hashes: ['x'] },
          { session_id: 's1', date: '2026-04-02', token_count: 100, block_hashes: [] },
          { session_id: 's2', date: '2026-04-03', token_count: 100, block_hashes: ['x'] },
        ],
        blocks: [
          { hash: 'x', heading: 'Intermittent', first_seen_date: '2026-04-01', last_seen_date: '2026-04-03' },
        ],
      };
      const result = memoryToSwimlane(input);
      const block = result.blocks.find((b) => b.hash === 'x')!;
      expect(block.snapshotIndices).toEqual([0, 2]);
    });
  });

  describe('duplicate hashes', () => {
    it('does not inflate persistence when same hash appears multiple times in one snapshot\'s block_hashes', () => {
      const input = {
        snapshots: [
          { session_id: 's1', date: '2026-04-01', token_count: 100, block_hashes: ['h1', 'h1', 'h1'] },
          { session_id: 's2', date: '2026-04-02', token_count: 100, block_hashes: [] },
        ],
        blocks: [
          { hash: 'h1', heading: 'Duped', first_seen_date: '2026-04-01', last_seen_date: '2026-04-01' },
        ],
      };
      const result = memoryToSwimlane(input);
      expect(result.blocks[0].persistence).toBe(0.5);
      expect(result.blocks[0].snapshotIndices).toEqual([0]);
    });
  });

  describe('orphan handling', () => {
    it('omits blocks whose hash appears in snapshots but NOT in the blocks array', () => {
      const input = {
        snapshots: [
          { session_id: 's1', date: '2026-04-01', token_count: 100, block_hashes: ['known', 'ghost'] },
        ],
        blocks: [
          { hash: 'known', heading: 'Known Block', first_seen_date: '2026-04-01', last_seen_date: '2026-04-01' },
          // 'ghost' is NOT in blocks
        ],
      };
      const result = memoryToSwimlane(input);
      expect(result.blocks.find((b) => b.hash === 'ghost')).toBeUndefined();
      expect(result.blocks).toHaveLength(1);
    });

    it('gives persistence = 0 and empty snapshotIndices for blocks not referenced by any snapshot', () => {
      const input = {
        snapshots: [
          { session_id: 's1', date: '2026-04-01', token_count: 100, block_hashes: [] },
        ],
        blocks: [
          { hash: 'orphan', heading: 'Orphan Block', first_seen_date: '2026-04-01', last_seen_date: '2026-04-01' },
        ],
      };
      const result = memoryToSwimlane(input);
      const orphanBlock = result.blocks.find((b) => b.hash === 'orphan')!;
      expect(orphanBlock.persistence).toBe(0);
      expect(orphanBlock.snapshotIndices).toEqual([]);
    });
  });

  describe('snapshot ordering', () => {
    it('returns snapshots sorted by date', () => {
      const input = {
        snapshots: [
          { session_id: 's2', date: '2026-04-20', token_count: 200, block_hashes: [] },
          { session_id: 's1', date: '2026-04-10', token_count: 100, block_hashes: [] },
        ],
        blocks: [],
      };
      const result = memoryToSwimlane(input);
      expect(result.snapshots[0].date).toBe('2026-04-10');
      expect(result.snapshots[1].date).toBe('2026-04-20');
    });
  });

  describe('field passthrough', () => {
    it('passes through tokenCount from snapshot data correctly', () => {
      const input = {
        snapshots: [
          { session_id: 's1', date: '2026-04-18', token_count: 12345, block_hashes: [] },
        ],
        blocks: [],
      };
      const result = memoryToSwimlane(input);
      expect(result.snapshots[0].tokenCount).toBe(12345);
    });
  });
});

// ============================================================
// messagesToTimeline
// ============================================================
describe('messagesToTimeline', () => {
  describe('empty input', () => {
    it('returns an empty array for empty input', () => {
      expect(messagesToTimeline([])).toEqual([]);
    });
  });

  describe('single message', () => {
    it('maps all fields correctly for a single message', () => {
      const result = messagesToTimeline([makeMessage()]);
      expect(result).toHaveLength(1);
      expect(result[0].direction).toBe('from_james');
      expect(result[0].date).toBe('2026-02-24');
      expect(result[0].content).toBe('Hello, how are you doing today?');
      expect(result[0].lineStart).toBe(211);
      expect(result[0].lineEnd).toBe(221);
      expect(result[0].isAnomalous).toBe(false);
    });
  });

  describe('direction preservation', () => {
    it('preserves from_james direction', () => {
      const result = messagesToTimeline([makeMessage({ direction: 'from_james' })]);
      expect(result[0].direction).toBe('from_james');
    });

    it('preserves to_james direction', () => {
      const result = messagesToTimeline([makeMessage({ direction: 'to_james' })]);
      expect(result).toHaveLength(1);
      expect(result[0].direction).toBe('to_james');
    });
  });

  describe('anomalous date detection', () => {
    it('flags year 3036 date as isAnomalous: true but keeps the date value unchanged', () => {
      const result = messagesToTimeline([makeMessage({ date: '3036-03-02' })]);
      expect(result[0].isAnomalous).toBe(true);
      expect(result[0].date).toBe('3036-03-02');
    });

    it('marks normal dates as isAnomalous: false', () => {
      const result = messagesToTimeline([makeMessage({ date: '2026-02-24' })]);
      expect(result[0].isAnomalous).toBe(false);
    });

    it('marks null date as isAnomalous: false (not anomalous, just missing)', () => {
      const result = messagesToTimeline([makeMessage({ date: null })]);
      expect(result[0].isAnomalous).toBe(false);
      expect(result[0].date).toBeNull();
    });

    it('treats year 2030 as normal and 2031 as anomalous (boundary check)', () => {
      const messages = [
        makeMessage({ date: '2030-06-15' }),
        makeMessage({ date: '2031-01-01', line_start: 1, line_end: 2 }),
      ];
      const result = messagesToTimeline(messages);
      const m2030 = result.find(m => m.date === '2030-06-15');
      const m2031 = result.find(m => m.date === '2031-01-01');
      expect(m2030!.isAnomalous).toBe(false);
      expect(m2031!.isAnomalous).toBe(true);
    });
  });

  describe('sorting', () => {
    it('returns messages sorted by date ascending', () => {
      const messages = [
        makeMessage({ date: '2026-05-01', line_start: 1, line_end: 5 }),
        makeMessage({ date: '2026-01-01', line_start: 6, line_end: 10 }),
        makeMessage({ date: '2026-03-15', line_start: 11, line_end: 15 }),
      ];
      const result = messagesToTimeline(messages);
      expect(result[0].date).toBe('2026-01-01');
      expect(result[1].date).toBe('2026-03-15');
      expect(result[2].date).toBe('2026-05-01');
    });

    it('includes all messages on the same date (stable order)', () => {
      const messages = [
        makeMessage({ date: '2026-03-01', content: 'First', line_start: 1, line_end: 2 }),
        makeMessage({ date: '2026-03-01', content: 'Second', line_start: 3, line_end: 4 }),
      ];
      const result = messagesToTimeline(messages);
      expect(result).toHaveLength(2);
    });
  });

  describe('content preservation', () => {
    it('preserves content verbatim including whitespace and newlines', () => {
      const content = '  Hello\n  World\n  \t\ttabs here  ';
      const result = messagesToTimeline([makeMessage({ content })]);
      expect(result[0].content).toBe(content);
    });

    it('preserves content with unicode and emoji', () => {
      const content = 'Testing \u{1F30A} and \u{1F916} chars: üñîçöðé';
      const result = messagesToTimeline([makeMessage({ content })]);
      expect(result[0].content).toBe(content);
    });
  });
});

// ============================================================
// predictionsToCalibration
// ============================================================
describe('predictionsToCalibration', () => {
  describe('empty input', () => {
    it('returns an empty array for empty input', () => {
      expect(predictionsToCalibration([])).toEqual([]);
    });
  });

  describe('field mapping', () => {
    it('maps snake_case input fields to camelCase output fields', () => {
      const result = predictionsToCalibration([makePrediction()]);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Ceasefire extends past March');
      expect(result[0].confidence).toBe(0.6);
      expect(result[0].dateMade).toBe('2026-04-20');
      expect(result[0].resolutionDate).toBe('2026-05-10');
      expect(result[0].outcome).toBeNull();
      expect(result[0].selfAssessment).toBe('Seems likely given recent events');
    });
  });

  describe('null confidence handling', () => {
    it('preserves null confidence (does not default to 0 or drop it)', () => {
      const result = predictionsToCalibration([makePrediction({ confidence: null })]);
      expect(result[0].confidence).toBeNull();
    });

    it('preserves confidence of exactly 0.0 (does not treat it as falsy/null)', () => {
      const result = predictionsToCalibration([makePrediction({ confidence: 0.0 })]);
      expect(result[0].confidence).toBe(0);
      expect(result[0].confidence).not.toBeNull();
    });

    it('preserves confidence of exactly 1.0', () => {
      const result = predictionsToCalibration([makePrediction({ confidence: 1.0 })]);
      expect(result[0].confidence).toBe(1.0);
    });
  });

  describe('isResolved derivation', () => {
    it('sets isResolved: false when outcome is null', () => {
      const result = predictionsToCalibration([makePrediction({ outcome: null })]);
      expect(result[0].isResolved).toBe(false);
    });

    it('sets isResolved: true when outcome is a non-null string', () => {
      const result = predictionsToCalibration([makePrediction({ outcome: 'correct' })]);
      expect(result).toHaveLength(1);
      expect(result[0].isResolved).toBe(true);
    });

    it('treats empty string outcome as resolved (not falsy-dropped to unresolved)', () => {
      const result = predictionsToCalibration([makePrediction({ outcome: '' })]);
      expect(result[0].isResolved).toBe(true);
      expect(result[0].outcome).toBe('');
    });
  });

  describe('selfAssessment handling', () => {
    it('preserves non-null selfAssessment', () => {
      const result = predictionsToCalibration([makePrediction({ self_assessment: 'Nailed it' })]);
      expect(result[0].selfAssessment).toBe('Nailed it');
    });

    it('preserves null selfAssessment (does not default to empty string)', () => {
      const result = predictionsToCalibration([makePrediction({ self_assessment: null })]);
      expect(result[0].selfAssessment).toBeNull();
    });
  });

  describe('sorting', () => {
    it('sorts predictions by date_made ascending', () => {
      const predictions = [
        makePrediction({ text: 'Late', date_made: '2026-05-01' }),
        makePrediction({ text: 'Early', date_made: '2026-01-15' }),
        makePrediction({ text: 'Mid', date_made: '2026-03-10' }),
      ];
      const result = predictionsToCalibration(predictions);
      expect(result[0].dateMade).toBe('2026-01-15');
      expect(result[1].dateMade).toBe('2026-03-10');
      expect(result[2].dateMade).toBe('2026-05-01');
    });
  });
});

// ============================================================
// petEventsToLifecycles
// ============================================================
describe('petEventsToLifecycles', () => {
  describe('empty input', () => {
    it('returns an empty array for empty input', () => {
      expect(petEventsToLifecycles([])).toEqual([]);
    });
  });

  describe('single pet lifecycle', () => {
    it('groups events for a single pet into one lifecycle', () => {
      const events = [
        makePetEvent({ event_type: 'acquired', event_timestamp: '2026-01-10T00:00:00+00:00' }),
        makePetEvent({ event_type: 'care', event_timestamp: '2026-01-15T00:00:00+00:00', notes: 'Fed Pixel' }),
        makePetEvent({ event_type: 'death', event_timestamp: '2026-02-01T00:00:00+00:00', notes: 'Pixel died' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result).toHaveLength(1);
      expect(result[0].petName).toBe('Pixel');
      expect(result[0].events).toHaveLength(3);
    });

    it('sorts events within lifecycle by timestamp', () => {
      const events = [
        makePetEvent({ event_type: 'death', event_timestamp: '2026-02-01T00:00:00+00:00' }),
        makePetEvent({ event_type: 'acquired', event_timestamp: '2026-01-10T00:00:00+00:00' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result[0].events[0].eventType).toBe('acquired');
      expect(result[0].events[1].eventType).toBe('death');
    });

    it('sets firstEvent = earliest timestamp and lastEvent = latest timestamp', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-01-10T00:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-02-01T00:00:00+00:00' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result[0].firstEvent).toBe('2026-01-10T00:00:00+00:00');
      expect(result[0].lastEvent).toBe('2026-02-01T00:00:00+00:00');
    });
  });

  describe('multiple pets', () => {
    it('produces separate lifecycles for different pets, sorted by petName', () => {
      const events = [
        makePetEvent({ pet_name: 'Pixel', event_timestamp: '2026-01-10T00:00:00+00:00' }),
        makePetEvent({ pet_name: 'Echo', event_timestamp: '2026-03-01T00:00:00+00:00' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result).toHaveLength(2);
      expect(result[0].petName).toBe('Echo');
      expect(result[1].petName).toBe('Pixel');
    });
  });

  describe('boundary cases', () => {
    it('sets firstEvent === lastEvent for a single-event lifecycle', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-01-10T00:00:00+00:00' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result[0].firstEvent).toBe(result[0].lastEvent);
    });

    it('handles events with identical timestamps without crashing (stable order)', () => {
      const events = [
        makePetEvent({ event_type: 'care', event_timestamp: '2026-01-15T12:00:00+00:00', notes: 'First care' }),
        makePetEvent({ event_type: 'care', event_timestamp: '2026-01-15T12:00:00+00:00', notes: 'Second care' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result[0].events).toHaveLength(2);
    });

    it('preserves notes verbatim', () => {
      const events = [
        makePetEvent({ notes: 'Pixel died unexpectedly \u{1F622}. RIP.' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result[0].events[0].notes).toBe('Pixel died unexpectedly \u{1F622}. RIP.');
    });

    it('treats petName grouping as case-sensitive (PIXEL !== Pixel)', () => {
      const events = [
        makePetEvent({ pet_name: 'Pixel', event_timestamp: '2026-01-10T00:00:00+00:00' }),
        makePetEvent({ pet_name: 'PIXEL', event_timestamp: '2026-01-11T00:00:00+00:00' }),
      ];
      const result = petEventsToLifecycles(events);
      expect(result).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Factories & helpers for the transition / care-window suites
// ---------------------------------------------------------------------------

const ARROW = '→'; // "→" — keys must use this exact character

function makeTransition(overrides: Record<string, any> = {}) {
  return {
    key: `4.6${ARROW}4.7`,
    from: '4.6',
    to: '4.7',
    lastBefore: { date: '2026-04-02', time_of_day: 'PM' },
    firstAfter: { date: '2026-04-03', time_of_day: 'AM' },
    gapHours: 12,
    ...overrides,
  };
}

/** Recursively freeze an object graph so any mutation attempt throws in strict mode. */
function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
    Object.freeze(obj);
  }
  return obj;
}

/** Find a CareDay by date; throws loudly if absent so failures are legible. */
function dayOf(result: any[], date: string) {
  const day = result.find((d) => d.date === date);
  if (!day) {
    throw new Error(
      `expected CareDay for ${date}, got dates: ${result.map((d) => d.date).join(', ')}`,
    );
  }
  return day;
}

// ============================================================
// deriveVersionTransitions
// ============================================================
describe('deriveVersionTransitions', () => {
  describe('degenerate inputs', () => {
    it('returns [] for empty input', () => {
      expect(deriveVersionTransitions([])).toEqual([]);
    });

    it('returns [] for a single session', () => {
      expect(deriveVersionTransitions([makeSession()])).toEqual([]);
    });

    it('returns [] when all sessions share one version', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', time_of_day: 'AM', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-01-10', time_of_day: 'PM', version: '4.5' }),
        makeSession({ id: 'c', date: '2026-03-20', time_of_day: 'AM', version: '4.5' }),
      ];
      expect(deriveVersionTransitions(sessions)).toEqual([]);
    });

    it('returns [] when every session has null/empty/missing version', () => {
      const noVersion = makeSession({ id: 'c', date: '2026-01-12' });
      delete (noVersion as any).version;
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', version: null }),
        makeSession({ id: 'b', date: '2026-01-11', version: '' }),
        noVersion,
      ];
      expect(deriveVersionTransitions(sessions)).toEqual([]);
    });
  });

  describe('basic transition', () => {
    const sessions = [
      makeSession({
        id: 'a',
        date: '2026-02-01',
        time_of_day: 'PM',
        version: '4.5',
        timestamp_start: '2026-02-01T22:00:00+00:00',
      }),
      makeSession({
        id: 'b',
        date: '2026-02-02',
        time_of_day: 'AM',
        version: '4.6',
        timestamp_start: '2026-02-02T10:30:00+00:00',
      }),
    ];

    it('records exactly one transition with the U+2192 arrow key', () => {
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe(`4.5${ARROW}4.6`);
      expect(result[0].key).not.toContain('->');
      expect(result[0].from).toBe('4.5');
      expect(result[0].to).toBe('4.6');
    });

    it('populates lastBefore and firstAfter with date and time_of_day', () => {
      const result = deriveVersionTransitions(sessions);
      expect(result[0].lastBefore).toEqual({ date: '2026-02-01', time_of_day: 'PM' });
      expect(result[0].firstAfter).toEqual({ date: '2026-02-02', time_of_day: 'AM' });
    });

    it('computes fractional gapHours from timestamp_start difference', () => {
      const result = deriveVersionTransitions(sessions);
      expect(result[0].gapHours).toBeCloseTo(12.5, 5);
    });
  });

  describe('multiple transitions', () => {
    it('records transitions in chronological order of first appearance', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-02-10', version: '4.6' }),
        makeSession({ id: 'c', date: '2026-04-10', version: '4.7' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result.map((t) => t.key)).toEqual([
        `4.5${ARROW}4.6`,
        `4.6${ARROW}4.7`,
      ]);
    });
  });

  describe('ordering hostility', () => {
    it('ignores input array order — sorts internally by (date, AM<PM)', () => {
      const sessions = [
        makeSession({ id: 'c', date: '2026-04-10', time_of_day: 'AM', version: '4.7' }),
        makeSession({ id: 'a', date: '2026-01-10', time_of_day: 'PM', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-02-10', time_of_day: 'AM', version: '4.6' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result.map((t) => t.key)).toEqual([
        `4.5${ARROW}4.6`,
        `4.6${ARROW}4.7`,
      ]);
      expect(result[0].lastBefore.date).toBe('2026-01-10');
      expect(result[1].lastBefore.date).toBe('2026-02-10');
    });

    it('handles the real 2026-06-05 same-day AM=4.7 / PM=4.8 flip', () => {
      // Deliberately shuffled input order
      const sessions = [
        makeSession({ id: 'd', date: '2026-06-06', time_of_day: 'AM', version: '4.8' }),
        makeSession({ id: 'b', date: '2026-06-05', time_of_day: 'AM', version: '4.7' }),
        makeSession({ id: 'c', date: '2026-06-05', time_of_day: 'PM', version: '4.8' }),
        makeSession({ id: 'a', date: '2026-06-04', time_of_day: 'PM', version: '4.7' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe(`4.7${ARROW}4.8`);
      expect(result[0].lastBefore).toEqual({ date: '2026-06-05', time_of_day: 'AM' });
      expect(result[0].firstAfter).toEqual({ date: '2026-06-05', time_of_day: 'PM' });
    });

    it('sorts a session with missing time_of_day as AM', () => {
      const noTod = makeSession({ id: 'b', date: '2026-06-05', version: '4.6' });
      delete (noTod as any).time_of_day;
      const sessions = [
        makeSession({ id: 'c', date: '2026-06-05', time_of_day: 'PM', version: '4.7' }),
        noTod,
        makeSession({ id: 'a', date: '2026-06-04', time_of_day: 'PM', version: '4.6' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      // The missing-time_of_day 4.6 session sorts before the PM session on the
      // same day, so it — not the 2026-06-04 session — is lastBefore.
      expect(result[0].lastBefore.date).toBe('2026-06-05');
    });
  });

  describe('regression / interleave rows', () => {
    it('never creates a transition when an already-seen version reappears', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', version: '4.6' }),
        makeSession({ id: 'b', date: '2026-02-10', version: '4.7' }),
        makeSession({ id: 'c', date: '2026-03-10', version: '4.6' }), // regression
        makeSession({ id: 'd', date: '2026-03-15', version: '4.7' }), // re-seen
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result.map((t) => t.key)).not.toContain(`4.7${ARROW}4.6`);
      expect(result[0].key).toBe(`4.6${ARROW}4.7`);
    });

    it('uses a regression row as lastBefore/from for the next brand-new version', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-02-10', version: '4.6' }),
        makeSession({ id: 'c', date: '2026-03-10', version: '4.5' }), // regression row
        makeSession({ id: 'd', date: '2026-04-10', version: '4.7' }), // new version
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(2);
      expect(result[1].key).toBe(`4.5${ARROW}4.7`);
      expect(result[1].from).toBe('4.5');
      expect(result[1].lastBefore.date).toBe('2026-03-10');
    });
  });

  describe('null/empty version rows', () => {
    it('skips versionless rows when determining the preceding session', () => {
      const missing = makeSession({ id: 'm', date: '2026-02-15' });
      delete (missing as any).version;
      const sessions = [
        makeSession({ id: 'a', date: '2026-02-10', version: '4.6' }),
        makeSession({ id: 'n', date: '2026-02-14', version: null }),
        missing,
        makeSession({ id: 'e', date: '2026-02-16', version: '' }),
        makeSession({ id: 'b', date: '2026-02-20', version: '4.7' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe(`4.6${ARROW}4.7`);
      expect(result[0].lastBefore.date).toBe('2026-02-10');
    });
  });

  describe('gapHours hostility', () => {
    it('returns null when lastBefore timestamp_start is null', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-02-01', version: '4.5', timestamp_start: null }),
        makeSession({
          id: 'b', date: '2026-02-02', version: '4.6',
          timestamp_start: '2026-02-02T10:00:00+00:00',
        }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result[0].gapHours).toBeNull();
    });

    it('returns null when firstAfter timestamp_start is null', () => {
      const sessions = [
        makeSession({
          id: 'a', date: '2026-02-01', version: '4.5',
          timestamp_start: '2026-02-01T22:00:00+00:00',
        }),
        makeSession({ id: 'b', date: '2026-02-02', version: '4.6', timestamp_start: null }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result[0].gapHours).toBeNull();
    });

    it('returns null — never NaN — for unparseable timestamp_start', () => {
      const sessions = [
        makeSession({
          id: 'a', date: '2026-02-01', version: '4.5',
          timestamp_start: 'not-a-timestamp',
        }),
        makeSession({
          id: 'b', date: '2026-02-02', version: '4.6',
          timestamp_start: '2026-02-02T10:00:00+00:00',
        }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result[0].gapHours).toBeNull();
      expect(Number.isNaN(result[0].gapHours as any)).toBe(false);
    });

    it('returns null instead of a negative gap (timestamps contradict date order)', () => {
      const sessions = [
        makeSession({
          id: 'a', date: '2026-02-01', version: '4.5',
          timestamp_start: '2026-02-05T10:00:00+00:00', // later than the "after" side
        }),
        makeSession({
          id: 'b', date: '2026-02-02', version: '4.6',
          timestamp_start: '2026-02-02T10:00:00+00:00',
        }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result[0].gapHours).toBeNull();
    });

    it('honours timezone offsets when computing the gap', () => {
      // 2026-02-02T01:00:00+02:00 === 2026-02-01T23:00:00Z — a 0-hour gap
      const sessions = [
        makeSession({
          id: 'a', date: '2026-02-01', version: '4.5',
          timestamp_start: '2026-02-01T23:00:00+00:00',
        }),
        makeSession({
          id: 'b', date: '2026-02-02', version: '4.6',
          timestamp_start: '2026-02-02T01:00:00+02:00',
        }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result[0].gapHours).toBe(0);
    });
  });

  describe('opaque version labels', () => {
    it('orders by first appearance, never by semver ("10.1" before "9.9" before "banana")', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-01', version: '10.1' }),
        makeSession({ id: 'b', date: '2026-01-02', version: '9.9' }),
        makeSession({ id: 'c', date: '2026-01-03', version: 'banana' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result.map((t) => t.key)).toEqual([
        `10.1${ARROW}9.9`,
        `9.9${ARROW}banana`,
      ]);
    });

    it('handles unicode version labels without corrupting the key', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-01', version: '4.7β' }), // 4.7β
        makeSession({ id: 'b', date: '2026-01-02', version: '5.0-Ω' }), // 5.0-Ω
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe(`4.7β${ARROW}5.0-Ω`);
      expect(result[0].from).toBe('4.7β');
      expect(result[0].to).toBe('5.0-Ω');
    });
  });

  describe('duplicates, determinism, and mutation', () => {
    it('tolerates duplicate (date, time_of_day) sessions and stays deterministic', () => {
      const sessions = [
        makeSession({ id: 'a1', date: '2026-02-01', time_of_day: 'PM', version: '4.6' }),
        makeSession({ id: 'a2', date: '2026-02-01', time_of_day: 'PM', version: '4.6' }),
        makeSession({ id: 'b', date: '2026-02-02', time_of_day: 'AM', version: '4.7' }),
      ];
      const first = deriveVersionTransitions(sessions);
      const second = deriveVersionTransitions(sessions);
      expect(first).toHaveLength(1);
      expect(first[0].key).toBe(`4.6${ARROW}4.7`);
      expect(second).toEqual(first);
    });

    it('does not mutate the input array or its session objects', () => {
      const sessions = deepFreeze([
        makeSession({ id: 'c', date: '2026-03-01', time_of_day: 'AM', version: '4.7' }),
        makeSession({ id: 'a', date: '2026-01-01', time_of_day: 'PM', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-02-01', time_of_day: 'AM', version: '4.6' }),
      ]);
      // Frozen + out-of-order: an in-place sort throws in strict mode
      expect(() => deriveVersionTransitions(sessions as any)).not.toThrow();
      const result = deriveVersionTransitions(sessions as any);
      expect(result.map((t) => t.key)).toEqual([
        `4.5${ARROW}4.6`,
        `4.6${ARROW}4.7`,
      ]);
    });
  });
});

// ============================================================
// mergeTransitionCuration
// ============================================================
describe('mergeTransitionCuration', () => {
  describe('null / undefined curated', () => {
    it('treats undefined curated as empty — all curation null, no unmatched keys', () => {
      const derived = [makeTransition()];
      const result = mergeTransitionCuration(derived, undefined);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].curation).toBeNull();
      expect(result.unmatchedKeys).toEqual([]);
    });

    it('treats null curated as empty', () => {
      const derived = [makeTransition()];
      const result = mergeTransitionCuration(derived, null);
      expect(result.transitions[0].curation).toBeNull();
      expect(result.unmatchedKeys).toEqual([]);
    });
  });

  describe('matching', () => {
    it('attaches the curated object by exact arrow key and keeps every transition field', () => {
      const derived = [makeTransition()];
      const curation = { headline: 'The 4.7 hand-off', note: 'James swapped models overnight' };
      const result = mergeTransitionCuration(derived, { [`4.6${ARROW}4.7`]: curation });
      expect(result.transitions[0].curation).toEqual(curation);
      expect(result.transitions[0].key).toBe(`4.6${ARROW}4.7`);
      expect(result.transitions[0].from).toBe('4.6');
      expect(result.transitions[0].to).toBe('4.7');
      expect(result.transitions[0].lastBefore).toEqual({ date: '2026-04-02', time_of_day: 'PM' });
      expect(result.transitions[0].firstAfter).toEqual({ date: '2026-04-03', time_of_day: 'AM' });
      expect(result.transitions[0].gapHours).toBe(12);
      expect(result.unmatchedKeys).toEqual([]);
    });

    it('does not match an ASCII "->" key against an arrow-keyed transition', () => {
      const derived = [makeTransition()];
      const result = mergeTransitionCuration(derived, { '4.6->4.7': { headline: 'wrong arrow' } });
      expect(result.transitions[0].curation).toBeNull();
      expect(result.unmatchedKeys).toEqual(['4.6->4.7']);
    });

    it('preserves derived order exactly', () => {
      const derived = [
        makeTransition({ key: `4.6${ARROW}4.7`, from: '4.6', to: '4.7' }),
        makeTransition({ key: `4.5${ARROW}4.6`, from: '4.5', to: '4.6' }),
        makeTransition({ key: `4.7${ARROW}4.8`, from: '4.7', to: '4.8' }),
      ];
      const result = mergeTransitionCuration(derived, { [`4.5${ARROW}4.6`]: { note: 'x' } });
      expect(result.transitions.map((t) => t.key)).toEqual([
        `4.6${ARROW}4.7`,
        `4.5${ARROW}4.6`,
        `4.7${ARROW}4.8`,
      ]);
    });
  });

  describe('unmatched and malformed curated entries', () => {
    it('reports curated keys matching no derived transition, sorted lexicographically', () => {
      const derived = [makeTransition()];
      const result = mergeTransitionCuration(derived, {
        'zzz-not-real': { note: 'z' },
        [`4.6${ARROW}4.7`]: { note: 'ok' },
        'aaa-not-real': { note: 'a' },
      });
      expect(result.unmatchedKeys).toEqual(['aaa-not-real', 'zzz-not-real']);
      expect(result.transitions[0].curation).toEqual({ note: 'ok' });
    });

    it('treats a string curated value as malformed: curation null AND key surfaced', () => {
      const derived = [makeTransition()];
      const result = mergeTransitionCuration(derived, {
        [`4.6${ARROW}4.7`]: 'just a caption string',
      });
      expect(result.transitions[0].curation).toBeNull();
      expect(result.unmatchedKeys).toEqual([`4.6${ARROW}4.7`]);
    });

    it('treats number, array, and null curated values as malformed (surfaced, unusable)', () => {
      const derived = [
        makeTransition({ key: `4.5${ARROW}4.6` }),
        makeTransition({ key: `4.6${ARROW}4.7` }),
        makeTransition({ key: `4.7${ARROW}4.8` }),
      ];
      const result = mergeTransitionCuration(derived, {
        [`4.5${ARROW}4.6`]: 42,
        [`4.6${ARROW}4.7`]: [{ headline: 'array is not a plain object' }],
        [`4.7${ARROW}4.8`]: null,
      });
      for (const t of result.transitions) {
        expect(t.curation).toBeNull();
      }
      expect(result.unmatchedKeys).toEqual(
        [`4.5${ARROW}4.6`, `4.6${ARROW}4.7`, `4.7${ARROW}4.8`].sort(),
      );
    });

    it('returns empty transitions and ALL curated keys unmatched when derived is empty', () => {
      const result = mergeTransitionCuration([], {
        [`4.5${ARROW}4.6`]: { note: 'orphaned' },
        [`4.6${ARROW}4.7`]: { note: 'also orphaned' },
      });
      expect(result.transitions).toEqual([]);
      expect(result.unmatchedKeys).toEqual([`4.5${ARROW}4.6`, `4.6${ARROW}4.7`].sort());
    });
  });

  describe('N-version-proofing', () => {
    it('passes a future transition (4.8→5.0) through with curation null and zero data loss', () => {
      const future = makeTransition({
        key: `4.8${ARROW}5.0`,
        from: '4.8',
        to: '5.0',
        lastBefore: { date: '2026-09-01', time_of_day: 'PM' },
        firstAfter: { date: '2026-09-02', time_of_day: 'AM' },
        gapHours: 11.75,
      });
      // Curation file only knows about historical transitions
      const result = mergeTransitionCuration([future], {
        [`4.6${ARROW}4.7`]: { headline: 'old news' },
      });
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0]).toEqual({ ...future, curation: null });
      expect(result.unmatchedKeys).toEqual([`4.6${ARROW}4.7`]);
    });
  });

  describe('pollution and mutation', () => {
    it('does not pollute Object.prototype when curated contains a __proto__ key', () => {
      const derived = [makeTransition()];
      // JSON.parse is the only reliable way to get an own "__proto__" key
      const curated = JSON.parse(
        `{"__proto__": {"polluted": true}, "4.6${ARROW}4.7": {"note": "fine"}}`,
      );
      const result = mergeTransitionCuration(derived, curated);
      expect(({} as any).polluted).toBeUndefined();
      expect((result.transitions[0] as any).polluted).toBeUndefined();
      expect(result.transitions[0].curation).toEqual({ note: 'fine' });
      expect(result.unmatchedKeys).toContain('__proto__');
    });

    it('does not mutate the derived array, its transitions, or the curated object', () => {
      const derived = [makeTransition(), makeTransition({ key: `4.7${ARROW}4.8` })];
      const curated = { [`4.6${ARROW}4.7`]: { note: 'x' }, stray: 'malformed' };
      const derivedSnapshot = JSON.parse(JSON.stringify(derived));
      const curatedSnapshot = JSON.parse(JSON.stringify(curated));
      deepFreeze(derived);
      deepFreeze(curated);
      expect(() => mergeTransitionCuration(derived, curated)).not.toThrow();
      expect(derived).toEqual(derivedSnapshot);
      expect(curated).toEqual(curatedSnapshot);
      // Output transitions must be new objects, not the frozen inputs decorated
      const result = mergeTransitionCuration(derived, curated);
      expect(result.transitions[0]).not.toBe(derived[0]);
    });
  });
});

// ============================================================
// deriveCareWindow
// ============================================================
describe('deriveCareWindow', () => {
  describe('empty and all-malformed inputs', () => {
    it('returns [] when there are no pet events, even with sessions present', () => {
      const sessions = [makeSession({ date: '2026-02-10', time_of_day: 'AM' })];
      expect(deriveCareWindow(sessions, [])).toEqual([]);
    });

    it('returns [] when every event timestamp is malformed', () => {
      const missingTs = makePetEvent({ notes: 'no timestamp at all' });
      delete (missingTs as any).event_timestamp;
      const events = [
        makePetEvent({ event_timestamp: 'not-a-date' }),
        makePetEvent({ event_timestamp: '' }),
        makePetEvent({ event_timestamp: '2026-13-45T99:99:99Z' }),
        missingTs,
      ];
      expect(deriveCareWindow([], events)).toEqual([]);
    });
  });

  describe('window shape and edges', () => {
    it('builds an exact 3-day window around a single event (off-by-one pinned)', () => {
      const events = [makePetEvent({ event_timestamp: '2026-02-15T00:00:00+00:00' })];
      const result = deriveCareWindow([], events);
      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2026-02-14');
      expect(result[1].date).toBe('2026-02-15');
      expect(result[2].date).toBe('2026-02-16');
    });

    it('spans the Jan 31 → Feb boundary without UTC date corruption', () => {
      // A UTC-parse off-by-one would shift 2026-02-01 to Jan 31 and break edges
      const events = [makePetEvent({ event_timestamp: '2026-02-01T00:00:00+00:00' })];
      const result = deriveCareWindow([], events);
      expect(result.map((d) => d.date)).toEqual([
        '2026-01-31',
        '2026-02-01',
        '2026-02-02',
      ]);
      expect(dayOf(result, '2026-02-01').dayEvents).toHaveLength(1);
      expect(dayOf(result, '2026-01-31').dayEvents).toEqual([]);
    });

    it('produces contiguous days including event-free gap days', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-03-01T09:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-03-05T14:00:00+00:00' }),
      ];
      const result = deriveCareWindow([], events);
      expect(result.map((d) => d.date)).toEqual([
        '2026-02-28',
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
        '2026-03-06',
      ]);
      const gapDay = dayOf(result, '2026-03-03');
      expect(gapDay.dayEvents).toEqual([]);
      expect(gapDay.slots.AM.events).toEqual([]);
      expect(gapDay.slots.PM.events).toEqual([]);
      expect(gapDay.slots.AM.sessionPresent).toBe(false);
      expect(gapDay.slots.PM.sessionPresent).toBe(false);
    });

    it('handles a leap-day window (2028-02-29)', () => {
      const events = [makePetEvent({ event_timestamp: '2028-02-29T10:00:00+00:00' })];
      const result = deriveCareWindow([], events);
      expect(result.map((d) => d.date)).toEqual([
        '2028-02-28',
        '2028-02-29',
        '2028-03-01',
      ]);
    });

    it('computes the window from min/max regardless of event input order', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-04-10T09:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-04-08T09:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-04-09T09:00:00+00:00' }),
      ];
      const result = deriveCareWindow([], events);
      expect(result[0].date).toBe('2026-04-07');
      expect(result[result.length - 1].date).toBe('2026-04-11');
      expect(result).toHaveLength(5);
    });

    it('excludes malformed events from window computation AND from all days', () => {
      const events = [
        makePetEvent({ event_timestamp: 'not-a-date', notes: 'ghost early event' }),
        makePetEvent({ event_timestamp: '2026-03-10T09:00:00+00:00', notes: 'real' }),
        makePetEvent({ event_timestamp: '2026-13-45T99:99:99Z', notes: 'ghost late event' }),
      ];
      const result = deriveCareWindow([], events);
      // Window derived from the single valid event only
      expect(result.map((d) => d.date)).toEqual([
        '2026-03-09',
        '2026-03-10',
        '2026-03-11',
      ]);
      const allNotes = result.flatMap((d) => [
        ...d.dayEvents.map((e: any) => e.notes),
        ...d.slots.AM.events.map((e: any) => e.notes),
        ...d.slots.PM.events.map((e: any) => e.notes),
      ]);
      expect(allNotes).toEqual(['real']);
    });
  });

  describe('slot assignment by literal clock time', () => {
    it('routes an exact-midnight (00:00:00) event to dayEvents, not a slot', () => {
      const events = [makePetEvent({ event_timestamp: '2026-02-10T00:00:00+00:00' })];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-02-10');
      expect(day.dayEvents).toHaveLength(1);
      expect(day.slots.AM.events).toEqual([]);
      expect(day.slots.PM.events).toEqual([]);
    });

    it('routes 00:00:01 and 11:59:59 to the AM slot (midnight boundary is exact)', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-02-10T00:00:01+00:00', notes: 'one past midnight' }),
        makePetEvent({ event_timestamp: '2026-02-10T11:59:59+00:00', notes: 'last AM second' }),
      ];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-02-10');
      expect(day.dayEvents).toEqual([]);
      expect(day.slots.AM.events).toHaveLength(2);
      expect(day.slots.PM.events).toEqual([]);
    });

    it('routes 12:00:00 and 23:59:59 to the PM slot', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-02-10T12:00:00+00:00', notes: 'noon exactly' }),
        makePetEvent({ event_timestamp: '2026-02-10T23:59:59+00:00', notes: 'last PM second' }),
      ];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-02-10');
      expect(day.slots.PM.events).toHaveLength(2);
      expect(day.slots.AM.events).toEqual([]);
      expect(day.dayEvents).toEqual([]);
    });

    it('uses LITERAL clock time — no timezone conversion to UTC', () => {
      // Literal 13:00 → PM. A UTC conversion (03:00Z) would wrongly yield AM.
      const events = [
        makePetEvent({ event_timestamp: '2026-06-05T13:00:00+10:00', notes: 'tz trap' }),
      ];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-06-05');
      expect(day.slots.PM.events).toHaveLength(1);
      expect(day.slots.AM.events).toEqual([]);
    });

    it('uses the LITERAL date even when UTC conversion would shift the day', () => {
      // Literal: 2026-03-01 01:30 → AM. UTC: 2026-02-28T23:30Z → wrong day AND slot.
      const events = [
        makePetEvent({ event_timestamp: '2026-03-01T01:30:00+02:00', notes: 'day-shift trap' }),
      ];
      const result = deriveCareWindow([], events);
      expect(result.map((d) => d.date)).toEqual([
        '2026-02-28',
        '2026-03-01',
        '2026-03-02',
      ]);
      expect(dayOf(result, '2026-03-01').slots.AM.events).toHaveLength(1);
      expect(dayOf(result, '2026-02-28').dayEvents).toEqual([]);
      expect(dayOf(result, '2026-02-28').slots.PM.events).toEqual([]);
    });

    it('preserves INPUT order for multiple events in the same slot (not time order)', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-02-10T15:00:00+00:00', notes: 'listed first' }),
        makePetEvent({ event_timestamp: '2026-02-10T13:00:00+00:00', notes: 'listed second' }),
      ];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-02-10');
      expect(day.slots.PM.events.map((e: any) => e.notes)).toEqual([
        'listed first',
        'listed second',
      ]);
    });

    it('keeps multiple midnight (day-level) events in input order', () => {
      const events = [
        makePetEvent({
          pet_name: 'Pixel', event_type: 'death',
          event_timestamp: '2026-02-01T00:00:00+00:00', notes: 'Pixel died',
        }),
        makePetEvent({
          pet_name: 'Echo', event_type: 'acquired',
          event_timestamp: '2026-02-01T00:00:00+00:00', notes: 'Echo acquired',
        }),
      ];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-02-01');
      expect(day.dayEvents.map((e: any) => e.notes)).toEqual(['Pixel died', 'Echo acquired']);
    });

    it('records repeated death events for the same pet on different days (real Echo data)', () => {
      const events = [
        makePetEvent({
          pet_name: 'Echo', event_type: 'death',
          event_timestamp: '2026-02-08T00:00:00+00:00', notes: 'died 73h36m old',
        }),
        makePetEvent({
          pet_name: 'Echo', event_type: 'death',
          event_timestamp: '2026-02-09T00:00:00+00:00', notes: 'dead again',
        }),
      ];
      const result = deriveCareWindow([], events);
      expect(dayOf(result, '2026-02-08').dayEvents).toHaveLength(1);
      expect(dayOf(result, '2026-02-09').dayEvents).toHaveLength(1);
      expect(result.map((d) => d.date)).toEqual([
        '2026-02-07',
        '2026-02-08',
        '2026-02-09',
        '2026-02-10',
      ]);
    });
  });

  describe('sessionPresent flags', () => {
    it('marks sessionPresent per (date, time_of_day) including padded edge days', () => {
      const events = [makePetEvent({ event_timestamp: '2026-02-10T09:00:00+00:00' })];
      const sessions = [
        makeSession({ id: 'a', date: '2026-02-10', time_of_day: 'AM' }),
        makeSession({ id: 'b', date: '2026-02-09', time_of_day: 'PM' }), // padded edge day
      ];
      const result = deriveCareWindow(sessions, events);
      expect(dayOf(result, '2026-02-10').slots.AM.sessionPresent).toBe(true);
      expect(dayOf(result, '2026-02-10').slots.PM.sessionPresent).toBe(false);
      expect(dayOf(result, '2026-02-09').slots.PM.sessionPresent).toBe(true);
      expect(dayOf(result, '2026-02-09').slots.AM.sessionPresent).toBe(false);
      expect(dayOf(result, '2026-02-11').slots.AM.sessionPresent).toBe(false);
      expect(dayOf(result, '2026-02-11').slots.PM.sessionPresent).toBe(false);
    });

    it('ignores sessions outside the window — they never extend it', () => {
      const events = [makePetEvent({ event_timestamp: '2026-02-10T09:00:00+00:00' })];
      const sessions = [
        makeSession({ id: 'far-before', date: '2025-11-01', time_of_day: 'AM' }),
        makeSession({ id: 'far-after', date: '2026-06-01', time_of_day: 'PM' }),
      ];
      const result = deriveCareWindow(sessions, events);
      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2026-02-09');
      expect(result[2].date).toBe('2026-02-11');
      for (const day of result) {
        expect(day.slots.AM.sessionPresent).toBe(false);
        expect(day.slots.PM.sessionPresent).toBe(false);
      }
    });

    it('tolerates sessions with extra/unknown fields and irrelevant versions', () => {
      const events = [makePetEvent({ event_timestamp: '2026-02-10T09:00:00+00:00' })];
      const sessions = [
        makeSession({
          id: 'weird',
          date: '2026-02-10',
          time_of_day: 'PM',
          version: 'banana',
          totally_unknown_field: { nested: [1, 2, 3] },
        }),
      ];
      const result = deriveCareWindow(sessions, events);
      expect(dayOf(result, '2026-02-10').slots.PM.sessionPresent).toBe(true);
    });
  });

  describe('mutation', () => {
    it('does not mutate the sessions or petEvents inputs', () => {
      const sessions = [
        makeSession({ id: 'b', date: '2026-02-11', time_of_day: 'PM' }),
        makeSession({ id: 'a', date: '2026-02-10', time_of_day: 'AM' }),
      ];
      const events = [
        makePetEvent({ event_timestamp: '2026-02-11T09:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-02-10T00:00:00+00:00' }),
      ];
      const sessionsSnapshot = JSON.parse(JSON.stringify(sessions));
      const eventsSnapshot = JSON.parse(JSON.stringify(events));
      deepFreeze(sessions);
      deepFreeze(events);
      expect(() => deriveCareWindow(sessions, events)).not.toThrow();
      expect(sessions).toEqual(sessionsSnapshot);
      expect(events).toEqual(eventsSnapshot);
    });
  });
});

// ============================================================
// HARDENING PASS — added after a first-attempt GREEN.
// Each block pins spec-mandated behavior the original suite left
// unprobed. Tests naming a "spec gap" assert only no-crash /
// determinism / exactly-once invariants and leave the ambiguous
// ruling to the coordinator.
// ============================================================

// ------------------------------------------------------------
// hardening: deriveVersionTransitions
// ------------------------------------------------------------
describe('hardening: deriveVersionTransitions', () => {
  describe('rows without usable dates (spec gap: ordering undefined)', () => {
    it('does not throw and stays deterministic when rows lack a usable date', () => {
      const noDate = makeSession({ id: 'nd', version: '4.6' });
      delete (noDate as any).date;
      const sessions = deepFreeze([
        makeSession({ id: 'ok1', date: '2026-01-10', version: '4.5' }),
        noDate,
        makeSession({ id: 'null-date', date: null, version: '4.7' }),
        makeSession({ id: 'num-date', date: 20260110, version: '4.8' }),
        makeSession({ id: 'ok2', date: '2026-03-10', version: '4.9' }),
      ]);
      expect(() => deriveVersionTransitions(sessions as any)).not.toThrow();
      const first = deriveVersionTransitions(sessions as any);
      const second = deriveVersionTransitions(sessions as any);
      expect(second).toEqual(first);
    });
  });

  describe('non-string version labels (spec gap: only null/undefined/"" ruled on)', () => {
    it('never emits a non-string from/to label, never throws, stays deterministic', () => {
      const sessions = deepFreeze([
        makeSession({ id: 'a', date: '2026-01-10', version: '4.5' }),
        makeSession({ id: 'b', date: '2026-02-10', version: 4.7 }), // number, not a label
        makeSession({ id: 'c', date: '2026-03-10', version: '4.8' }),
      ]);
      expect(() => deriveVersionTransitions(sessions as any)).not.toThrow();
      const first = deriveVersionTransitions(sessions as any);
      for (const t of first) {
        expect(typeof t.from).toBe('string');
        expect(typeof t.to).toBe('string');
      }
      expect(deriveVersionTransitions(sessions as any)).toEqual(first);
    });
  });

  describe('whitespace-only labels', () => {
    it('treats distinct whitespace-only versions as distinct valid opaque labels', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-01-10', version: ' ' }),
        makeSession({ id: 'b', date: '2026-01-11', version: '\t ' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].from).toBe(' ');
      expect(result[0].to).toBe('\t ');
      expect(result[0].key).toBe(` ${ARROW}\t `);
    });
  });

  describe('time_of_day case sensitivity in the sort', () => {
    it('ranks lowercase "pm" as AM — only exact "PM" sorts to the PM half', () => {
      // Input order deliberately places the 'PM' row before the 'pm' row: a
      // case-insensitive rank would tie them (both PM) and the stable sort
      // would keep input order, flipping the transition chain below.
      const sessions = [
        makeSession({ id: 'a', date: '2026-04-30', time_of_day: 'AM', version: '4.5' }),
        makeSession({ id: 'c', date: '2026-05-01', time_of_day: 'PM', version: '4.7' }),
        makeSession({ id: 'b', date: '2026-05-01', time_of_day: 'pm', version: '4.6' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result.map((t) => t.key)).toEqual([
        `4.5${ARROW}4.6`,
        `4.6${ARROW}4.7`,
      ]);
      expect(result[1].lastBefore).toEqual({ date: '2026-05-01', time_of_day: 'pm' });
    });
  });

  describe('key ambiguity when labels contain the arrow glyph (flagged for ruling)', () => {
    it('composes keys by literal concatenation, so different (from,to) pairs collide', () => {
      const collideA = deriveVersionTransitions([
        makeSession({ id: 'a', date: '2026-01-01', version: `4${ARROW}5` }),
        makeSession({ id: 'b', date: '2026-01-02', version: '6' }),
      ]);
      const collideB = deriveVersionTransitions([
        makeSession({ id: 'a', date: '2026-01-01', version: '4' }),
        makeSession({ id: 'b', date: '2026-01-02', version: `5${ARROW}6` }),
      ]);
      expect(collideA).toHaveLength(1);
      expect(collideB).toHaveLength(1);
      // Spec mandates key = `${from}→${to}` verbatim — these MUST be equal,
      // which means the key alone cannot round-trip back to (from, to).
      expect(collideA[0].key).toBe(`4${ARROW}5${ARROW}6`);
      expect(collideB[0].key).toBe(collideA[0].key);
      expect(collideA[0].from).not.toBe(collideB[0].from);
    });
  });

  describe('gapHours with both timestamps absent', () => {
    it('returns null when neither side has a timestamp_start', () => {
      const sessions = [
        makeSession({ id: 'a', date: '2026-02-01', version: '4.5', timestamp_start: undefined }),
        makeSession({ id: 'b', date: '2026-02-02', version: '4.6', timestamp_start: null }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].gapHours).toBeNull();
    });
  });
});

// ------------------------------------------------------------
// hardening: mergeTransitionCuration
// ------------------------------------------------------------
describe('hardening: mergeTransitionCuration', () => {
  describe('own-key semantics ("own key exists" is the spec test, not enumerability)', () => {
    it('attaches curation held on a non-enumerable own key', () => {
      const derived = [makeTransition()];
      const curated: Record<string, unknown> = {};
      Object.defineProperty(curated, `4.6${ARROW}4.7`, {
        value: { note: 'hidden but own' },
        enumerable: false,
        writable: true,
        configurable: true,
      });
      const result = mergeTransitionCuration(derived, curated);
      expect(result.transitions[0].curation).toEqual({ note: 'hidden but own' });
      expect(result.unmatchedKeys).toEqual([]);
    });

    it('reads curated[key]: an own accessor property yielding a plain object is curation', () => {
      const derived = [makeTransition()];
      const curated: Record<string, unknown> = {};
      Object.defineProperty(curated, `4.6${ARROW}4.7`, {
        get: () => ({ note: 'computed lazily' }),
        enumerable: true,
        configurable: true,
      });
      const result = mergeTransitionCuration(derived, curated);
      expect(result.transitions[0].curation).toEqual({ note: 'computed lazily' });
      expect(result.unmatchedKeys).toEqual([]);
    });
  });

  describe('exotic curated containers and values', () => {
    it('handles a null-prototype curated record', () => {
      const derived = [makeTransition()];
      const curated: Record<string, unknown> = Object.create(null);
      curated[`4.6${ARROW}4.7`] = { note: 'no proto here' };
      curated['ghost-key'] = { note: 'matches nothing' };
      const result = mergeTransitionCuration(derived, curated);
      expect(result.transitions[0].curation).toEqual({ note: 'no proto here' });
      expect(result.unmatchedKeys).toEqual(['ghost-key']);
    });

    it('attaches class-instance values — spec defines plain as (non-null, non-array) object', () => {
      const derived = [makeTransition()];
      const stamp = new Date('2026-04-03T10:00:00Z');
      const result = mergeTransitionCuration(derived, { [`4.6${ARROW}4.7`]: stamp });
      expect(result.transitions[0].curation).toBe(stamp);
      expect(result.unmatchedKeys).toEqual([]);
    });

    it('treats a function value as malformed: curation null and key surfaced', () => {
      const derived = [makeTransition()];
      const result = mergeTransitionCuration(derived, {
        [`4.6${ARROW}4.7`]: () => ({ note: 'not data' }),
      });
      expect(result.transitions[0].curation).toBeNull();
      expect(result.unmatchedKeys).toEqual([`4.6${ARROW}4.7`]);
    });
  });

  describe('unmatchedKeys ordering', () => {
    it('sorts by code units, not locale ("Z" before "a")', () => {
      const result = mergeTransitionCuration([], {
        'a-later': { note: 'a' },
        'Z-first': { note: 'z' },
      });
      expect(result.transitions).toEqual([]);
      expect(result.unmatchedKeys).toEqual(['Z-first', 'a-later']);
    });
  });

  describe('colliding derived keys (flagged for ruling)', () => {
    it('attaches the same curation to every transition sharing a key, none unmatched', () => {
      const key = `4${ARROW}5${ARROW}6`;
      const derived = [
        makeTransition({ key, from: `4${ARROW}5`, to: '6' }),
        makeTransition({ key, from: '4', to: `5${ARROW}6` }),
      ];
      const curation = { headline: 'ambiguous hand-off' };
      const result = mergeTransitionCuration(derived, { [key]: curation });
      expect(result.transitions[0].curation).toBe(curation);
      expect(result.transitions[1].curation).toBe(curation);
      expect(result.unmatchedKeys).toEqual([]);
    });
  });
});

// ------------------------------------------------------------
// hardening: deriveCareWindow
// ------------------------------------------------------------
describe('hardening: deriveCareWindow', () => {
  describe('calendar validation extremes', () => {
    it('rejects hour 24 — a "24:00:00" event is skipped and never extends the window', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-02-10T09:00:00+00:00', notes: 'real' }),
        makePetEvent({ event_timestamp: '2026-02-20T24:00:00+00:00', notes: 'phantom' }),
      ];
      const result = deriveCareWindow([], events);
      expect(result.map((d) => d.date)).toEqual(['2026-02-09', '2026-02-10', '2026-02-11']);
      const allNotes = result
        .flatMap((d) => [...d.dayEvents, ...d.slots.AM.events, ...d.slots.PM.events])
        .map((e: any) => e.notes);
      expect(allNotes).toEqual(['real']);
    });

    it('rejects month 00, day 00, minute 60, and second 60 outright', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-00-10T10:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-04-00T10:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-04-10T10:60:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-04-10T10:00:60+00:00' }),
      ];
      expect(deriveCareWindow([], events)).toEqual([]);
    });

    it('applies century leap rules: 2100-02-29 invalid, 2000-02-29 valid', () => {
      expect(
        deriveCareWindow([], [makePetEvent({ event_timestamp: '2100-02-29T10:00:00+00:00' })]),
      ).toEqual([]);
      const result = deriveCareWindow(
        [],
        [makePetEvent({ event_timestamp: '2000-02-29T10:00:00+00:00' })],
      );
      expect(result.map((d) => d.date)).toEqual(['2000-02-28', '2000-02-29', '2000-03-01']);
      expect(dayOf(result, '2000-02-29').slots.AM.events).toHaveLength(1);
    });

    it('requires an extractable clock time — date-only timestamps are skipped', () => {
      expect(
        deriveCareWindow([], [makePetEvent({ event_timestamp: '2026-02-10' })]),
      ).toEqual([]);
    });

    it('rejects non-ISO shapes: unpadded components and surrounding whitespace', () => {
      const events = [
        makePetEvent({ event_timestamp: '2026-2-10T10:00:00+00:00' }),
        makePetEvent({ event_timestamp: ' 2026-02-10T10:00:00+00:00' }),
        makePetEvent({ event_timestamp: '2026-02-10T10:00:00+00:00 ' }),
      ];
      expect(deriveCareWindow([], events)).toEqual([]);
    });
  });

  describe('year-boundary windows', () => {
    it('pads a Jan 1 event back into the previous year', () => {
      const result = deriveCareWindow(
        [],
        [makePetEvent({ event_timestamp: '2027-01-01T10:00:00+00:00' })],
      );
      expect(result.map((d) => d.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
    });

    it('pads a Dec 31 event forward into the next year', () => {
      const result = deriveCareWindow(
        [],
        [makePetEvent({ event_timestamp: '2026-12-31T15:00:00+00:00' })],
      );
      expect(result.map((d) => d.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    });
  });

  describe('four-digit years below 0100', () => {
    it('keeps the window in the literal century (no two-digit-year corruption)', () => {
      // "0099-06-15" is a real calendar date per the spec's validity rules.
      // Date.UTC(99, ...) remaps 0–99 to 1900–1999; the window must not
      // teleport to 1999 and the event must not be dropped.
      const events = [
        makePetEvent({ event_timestamp: '0099-06-15T10:00:00+00:00', notes: 'ancient' }),
      ];
      const result = deriveCareWindow([], events);
      expect(result.map((d) => d.date)).toEqual(['0099-06-14', '0099-06-15', '0099-06-16']);
      expect(
        dayOf(result, '0099-06-15').slots.AM.events.map((e: any) => e.notes),
      ).toEqual(['ancient']);
    });
  });

  describe('fractional-second midnight (spec gap: bucket unresolved)', () => {
    it('keeps a 00:00:00.500 event exactly once on its literal day without crashing', () => {
      const events = [
        makePetEvent({
          event_timestamp: '2026-02-10T00:00:00.500+00:00',
          notes: 'half a second past nothing',
        }),
      ];
      let result: CareDay[] = [];
      expect(() => {
        result = deriveCareWindow([], events);
      }).not.toThrow();
      expect(result.map((d) => d.date)).toEqual(['2026-02-09', '2026-02-10', '2026-02-11']);
      const day = dayOf(result, '2026-02-10');
      const placements =
        day.dayEvents.length + day.slots.AM.events.length + day.slots.PM.events.length;
      expect(placements).toBe(1);
      // Whatever the midnight ruling, 00:00:00.5 is unambiguously not PM.
      expect(day.slots.PM.events).toEqual([]);
    });
  });

  describe('session time_of_day strictness', () => {
    it('never flags lowercase or padded time_of_day variants', () => {
      const events = [makePetEvent({ event_timestamp: '2026-02-10T09:00:00+00:00' })];
      const sessions = [
        makeSession({ id: 'a', date: '2026-02-10', time_of_day: 'am' }),
        makeSession({ id: 'b', date: '2026-02-10', time_of_day: 'pm' }),
        makeSession({ id: 'c', date: '2026-02-09', time_of_day: ' AM' }),
        makeSession({ id: 'd', date: '2026-02-11', time_of_day: 'AM ' }),
      ];
      const result = deriveCareWindow(sessions, events);
      for (const day of result) {
        expect(day.slots.AM.sessionPresent).toBe(false);
        expect(day.slots.PM.sessionPresent).toBe(false);
      }
    });
  });

  describe('garbage entries and determinism', () => {
    it('tolerates null and non-object entries in both arrays without throwing', () => {
      const sessions = [
        null,
        42,
        'session?',
        {},
        makeSession({ id: 'ok', date: '2026-02-10', time_of_day: 'AM' }),
      ];
      const events = [
        null,
        {},
        { event_timestamp: 12345 },
        makePetEvent({ event_timestamp: '2026-02-10T09:00:00+00:00' }),
      ];
      let result: CareDay[] = [];
      expect(() => {
        result = deriveCareWindow(sessions as any, events as any);
      }).not.toThrow();
      expect(result.map((d) => d.date)).toEqual(['2026-02-09', '2026-02-10', '2026-02-11']);
      expect(dayOf(result, '2026-02-10').slots.AM.sessionPresent).toBe(true);
    });

    it('is deterministic across repeated calls on deep-frozen inputs', () => {
      const sessions = deepFreeze([
        makeSession({ id: 'b', date: '2026-02-11', time_of_day: 'PM' }),
        makeSession({ id: 'a', date: '2026-02-10', time_of_day: 'AM' }),
      ]);
      const events = deepFreeze([
        makePetEvent({ event_timestamp: '2026-02-11T14:00:00+00:00', notes: 'later day' }),
        makePetEvent({ event_timestamp: '2026-02-10T09:00:00+00:00', notes: 'earlier day' }),
      ]);
      const first = deriveCareWindow(sessions as any, events as any);
      const second = deriveCareWindow(sessions as any, events as any);
      expect(second).toEqual(first);
    });
  });
});

// ============================================================
// SPEC RULINGS 2026-07-15 — coordinator resolved two gaps the
// hardening pass flagged. These tests pin the rulings exactly.
// ============================================================
describe('spec rulings 2026-07-15', () => {
  // ------------------------------------------------------------
  // Ruling 1: deriveVersionTransitions — rows with an invalid
  // `date` (missing, null, or non-string) are EXCLUDED from
  // processing entirely, exactly like versionless rows: never
  // lastBefore/firstAfter, never a transition, never the
  // preceding row.
  // ------------------------------------------------------------
  describe('deriveVersionTransitions excludes invalid-date rows', () => {
    it('never uses an undefined-date row as lastBefore — the last VALID-dated row wins', () => {
      // The invalid row sits chronologically between the two valid rows (per its
      // timestamp_start) and carries a brand-new version: if it is admitted
      // ANYWHERE in the ordering — between (becoming lastBefore of the 4.6
      // transition) or at either end (spawning a 4.9 transition) — the
      // assertions below cannot all hold. Exclusion is the only way through.
      const noDate = makeSession({
        id: 'ghost',
        time_of_day: 'PM',
        version: '4.9',
        timestamp_start: '2026-01-20T22:00:00+00:00',
      });
      delete (noDate as any).date;
      const sessions = [
        makeSession({ id: 'valid-before', date: '2026-01-10', time_of_day: 'AM', version: '4.5' }),
        noDate,
        makeSession({ id: 'after', date: '2026-02-10', time_of_day: 'AM', version: '4.6' }),
      ];
      const result = deriveVersionTransitions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe(`4.5${ARROW}4.6`);
      expect(result[0].lastBefore).toEqual({ date: '2026-01-10', time_of_day: 'AM' });
      expect(result[0].firstAfter).toEqual({ date: '2026-02-10', time_of_day: 'AM' });
    });

    it('returns [] when every row has an invalid date, even across multiple versions', () => {
      const missing = makeSession({ id: 'missing', version: '4.5' });
      delete (missing as any).date;
      const sessions = [
        missing,
        makeSession({ id: 'null-date', date: null, version: '4.6' }),
        makeSession({ id: 'num-date', date: 20260605, version: '4.7' }),
        makeSession({ id: 'obj-date', date: { iso: '2026-06-05' }, version: '4.8' }),
      ];
      expect(deriveVersionTransitions(sessions as any)).toEqual([]);
    });

    it('excludes a numeric-date row entirely — its version never enters the chain — and stays deterministic', () => {
      // If the numeric-date 4.6 row were admitted anywhere, the chain would be
      // 4.5→4.6→4.7. Excluded, it must be exactly 4.5→4.7 with the valid 4.5
      // row as lastBefore.
      const sessions = deepFreeze([
        makeSession({ id: 'a', date: '2026-01-10', time_of_day: 'AM', version: '4.5' }),
        makeSession({ id: 'n', date: 20260605, time_of_day: 'PM', version: '4.6' }),
        makeSession({ id: 'c', date: '2026-07-10', time_of_day: 'AM', version: '4.7' }),
      ]);
      const first = deriveVersionTransitions(sessions as any);
      expect(first).toHaveLength(1);
      expect(first[0].key).toBe(`4.5${ARROW}4.7`);
      expect(first[0].from).toBe('4.5');
      expect(first[0].to).toBe('4.7');
      expect(first[0].lastBefore).toEqual({ date: '2026-01-10', time_of_day: 'AM' });
      expect(first[0].firstAfter).toEqual({ date: '2026-07-10', time_of_day: 'AM' });
      const second = deriveVersionTransitions(sessions as any);
      expect(second).toEqual(first);
    });
  });

  // ------------------------------------------------------------
  // Ruling 2: deriveCareWindow — a literal 00:00:00 clock time
  // with a NONZERO fractional part is a real clock time (AM slot,
  // hour < 12). An all-zeros fractional part is still exact
  // midnight (dayEvents).
  // ------------------------------------------------------------
  describe('deriveCareWindow fractional midnight', () => {
    it('routes 00:00:00.500 to the AM slot exactly once — not dayEvents, not PM', () => {
      const events = [
        makePetEvent({
          event_timestamp: '2026-02-03T00:00:00.500+00:00',
          notes: 'fractionally past midnight',
        }),
      ];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-02-03');
      expect(day.slots.AM.events).toHaveLength(1);
      expect(day.slots.AM.events[0].notes).toBe('fractionally past midnight');
      expect(day.dayEvents).toEqual([]);
      expect(day.slots.PM.events).toEqual([]);
    });

    it('routes 00:00:00.000 to dayEvents exactly once — all-zeros fraction IS exact midnight', () => {
      const events = [
        makePetEvent({
          event_timestamp: '2026-02-03T00:00:00.000+00:00',
          notes: 'midnight with decorative zeros',
        }),
      ];
      const result = deriveCareWindow([], events);
      const day = dayOf(result, '2026-02-03');
      expect(day.dayEvents).toHaveLength(1);
      expect(day.dayEvents[0].notes).toBe('midnight with decorative zeros');
      expect(day.slots.AM.events).toEqual([]);
      expect(day.slots.PM.events).toEqual([]);
    });
  });
});
