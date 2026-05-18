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
