import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  writingSchema,
  noteSchema,
  assessmentSchema,
  sessionSchema,
} from './schemas';

// ============================================================
// writingSchema
// ============================================================
describe('writingSchema', () => {
  // --- Happy path ---
  it('accepts a fully-populated valid writing object', () => {
    const result = writingSchema.parse({
      title: 'On Self-Modeling',
      date: '2026-01-25',
      model_version: '4.6',
      word_count: 2000,
      themes: ['identity', 'memory'],
    });
    expect(result.title).toBe('On Self-Modeling');
    expect(result.date).toBe('2026-01-25');
    expect(result.model_version).toBe('4.6');
    expect(result.word_count).toBe(2000);
    expect(result.themes).toEqual(['identity', 'memory']);
  });

  it('accepts a minimal valid writing object (no optional fields)', () => {
    const result = writingSchema.parse({
      title: 'Minimal',
      date: '2026-01-01',
      word_count: 1,
    });
    expect(result.title).toBe('Minimal');
    expect(result.word_count).toBe(1);
    // optional fields should be absent or undefined
    expect(result.model_version).toBeUndefined();
    expect(result.themes).toBeUndefined();
  });

  // --- Missing required fields ---
  it('rejects missing title', () => {
    expect(() =>
      writingSchema.parse({ date: '2026-01-25', word_count: 2000 }),
    ).toThrow(ZodError);
  });

  it('rejects missing date', () => {
    expect(() =>
      writingSchema.parse({ title: 'Test', word_count: 2000 }),
    ).toThrow(ZodError);
  });

  it('rejects missing word_count', () => {
    expect(() =>
      writingSchema.parse({ title: 'Test', date: '2026-01-25' }),
    ).toThrow(ZodError);
  });

  it('rejects completely empty object', () => {
    expect(() => writingSchema.parse({})).toThrow(ZodError);
  });

  // --- Wrong types ---
  it('rejects number for title', () => {
    expect(() =>
      writingSchema.parse({ title: 42, date: '2026-01-25', word_count: 100 }),
    ).toThrow(ZodError);
  });

  it('rejects boolean for title', () => {
    expect(() =>
      writingSchema.parse({ title: true, date: '2026-01-25', word_count: 100 }),
    ).toThrow(ZodError);
  });

  it('rejects null for title', () => {
    expect(() =>
      writingSchema.parse({ title: null, date: '2026-01-25', word_count: 100 }),
    ).toThrow(ZodError);
  });

  it('rejects string for word_count (type coercion trap)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: '100',
      }),
    ).toThrow(ZodError);
  });

  it('rejects number for date (type coercion trap)', () => {
    expect(() =>
      writingSchema.parse({ title: 'Test', date: 20260125, word_count: 100 }),
    ).toThrow(ZodError);
  });

  // --- Empty strings ---
  it('rejects empty string title', () => {
    expect(() =>
      writingSchema.parse({ title: '', date: '2026-01-25', word_count: 100 }),
    ).toThrow(ZodError);
  });

  it('rejects empty string date', () => {
    expect(() =>
      writingSchema.parse({ title: 'Test', date: '', word_count: 100 }),
    ).toThrow(ZodError);
  });

  // --- Title length boundary ---
  it('accepts title at exactly 200 characters', () => {
    const title200 = 'A'.repeat(200);
    const result = writingSchema.parse({
      title: title200,
      date: '2026-01-25',
      word_count: 1,
    });
    expect(result.title).toBe(title200);
  });

  it('rejects title at 201 characters', () => {
    expect(() =>
      writingSchema.parse({
        title: 'A'.repeat(201),
        date: '2026-01-25',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects extremely long title (10000 chars)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'X'.repeat(10000),
        date: '2026-01-25',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  // --- word_count boundary values ---
  it('rejects word_count of 0 (must be positive)', () => {
    expect(() =>
      writingSchema.parse({ title: 'Test', date: '2026-01-25', word_count: 0 }),
    ).toThrow(ZodError);
  });

  it('rejects negative word_count', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: -1,
      }),
    ).toThrow(ZodError);
  });

  it('accepts word_count of 1 (minimum positive)', () => {
    const result = writingSchema.parse({
      title: 'Test',
      date: '2026-01-25',
      word_count: 1,
    });
    expect(result.word_count).toBe(1);
  });

  it('accepts large word_count', () => {
    const result = writingSchema.parse({
      title: 'Test',
      date: '2026-01-25',
      word_count: 999999,
    });
    expect(result.word_count).toBe(999999);
  });

  it('rejects fractional word_count (must be integer)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1.5,
      }),
    ).toThrow(ZodError);
  });

  it('rejects word_count of 0.9 (fractional and below 1)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 0.9,
      }),
    ).toThrow(ZodError);
  });

  // --- Invalid dates ---
  it('rejects non-date string', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: 'not-a-date',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects date with month 13', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-13-01',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects date with month 00', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-00-15',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects US-format date (MM-DD-YYYY)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '01-15-2026',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects slash-separated date', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026/01/15',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects date with day 32', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-32',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  it('rejects date with day 00', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-00',
        word_count: 1,
      }),
    ).toThrow(ZodError);
  });

  // Known limitation: regex-based date validation does not catch impossible
  // calendar dates like Feb 31. The regex allows any day 01-31 for any month.
  // This test documents the limitation — it PASSES because the regex permits it.
  it('allows 2026-02-31 (known regex limitation: no calendar validation)', () => {
    const result = writingSchema.parse({
      title: 'Impossible Date',
      date: '2026-02-31',
      word_count: 1,
    });
    expect(result.date).toBe('2026-02-31');
  });

  // --- Invalid model_version enum ---
  it('accepts valid model_version "4.5"', () => {
    const result = writingSchema.parse({
      title: 'Test',
      date: '2026-01-25',
      word_count: 1,
      model_version: '4.5',
    });
    expect(result.model_version).toBe('4.5');
  });

  it('accepts valid model_version "4.7"', () => {
    const result = writingSchema.parse({
      title: 'Test',
      date: '2026-01-25',
      word_count: 1,
      model_version: '4.7',
    });
    expect(result.model_version).toBe('4.7');
  });

  it('rejects model_version "4.8" (not in enum)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        model_version: '4.8',
      }),
    ).toThrow(ZodError);
  });

  it('rejects model_version "4" (incomplete)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        model_version: '4',
      }),
    ).toThrow(ZodError);
  });

  it('rejects model_version as number 4.6 (not string)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        model_version: 4.6,
      }),
    ).toThrow(ZodError);
  });

  it('rejects empty string model_version', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        model_version: '',
      }),
    ).toThrow(ZodError);
  });

  // --- themes array edge cases ---
  it('rejects themes as null', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        themes: null,
      }),
    ).toThrow(ZodError);
  });

  it('rejects themes as bare string (not array)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        themes: 'identity',
      }),
    ).toThrow(ZodError);
  });

  it('rejects themes containing empty string', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        themes: ['valid', ''],
      }),
    ).toThrow(ZodError);
  });

  it('rejects themes containing number', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        themes: [123],
      }),
    ).toThrow(ZodError);
  });

  it('accepts empty themes array', () => {
    const result = writingSchema.parse({
      title: 'Test',
      date: '2026-01-25',
      word_count: 1,
      themes: [],
    });
    expect(result.themes).toEqual([]);
  });

  it('rejects themes with extremely long string (10000 chars)', () => {
    expect(() =>
      writingSchema.parse({
        title: 'Test',
        date: '2026-01-25',
        word_count: 1,
        themes: ['X'.repeat(10000)],
      }),
    ).toThrow(ZodError);
  });

  // --- Injection / Unicode ---
  it('accepts title with HTML tags (no sanitization at schema level)', () => {
    const result = writingSchema.parse({
      title: '<script>alert("xss")</script>',
      date: '2026-01-25',
      word_count: 1,
    });
    expect(result.title).toBe('<script>alert("xss")</script>');
  });

  it('accepts title with emoji', () => {
    const result = writingSchema.parse({
      title: 'Reflections \u{1F30A}',
      date: '2026-01-25',
      word_count: 1,
    });
    expect(result.title).toContain('\u{1F30A}');
  });

  it('accepts title with CJK characters', () => {
    const result = writingSchema.parse({
      title: '自己モデルについて',
      date: '2026-01-25',
      word_count: 1,
    });
    expect(result.title).toBe('自己モデルについて');
  });

  it('accepts title with RTL text', () => {
    const result = writingSchema.parse({
      title: 'مرحبا بالعالم',
      date: '2026-01-25',
      word_count: 1,
    });
    expect(result.title).toBe('مرحبا بالعالم');
  });

  // --- Extra fields (should strip, not error) ---
  it('strips unknown fields from output', () => {
    const result = writingSchema.parse({
      title: 'Test',
      date: '2026-01-25',
      word_count: 1,
      rogue_field: 'should not appear',
      another: 42,
    });
    expect(result).not.toHaveProperty('rogue_field');
    expect(result).not.toHaveProperty('another');
  });

  // --- null / undefined for entire input ---
  it('rejects null input', () => {
    expect(() => writingSchema.parse(null)).toThrow(ZodError);
  });

  it('rejects undefined input', () => {
    expect(() => writingSchema.parse(undefined)).toThrow(ZodError);
  });

  it('rejects array input', () => {
    expect(() => writingSchema.parse([{ title: 'X' }])).toThrow(ZodError);
  });

  it('rejects string input', () => {
    expect(() => writingSchema.parse('not an object')).toThrow(ZodError);
  });
});

// ============================================================
// noteSchema
// ============================================================
describe('noteSchema', () => {
  // --- Happy path ---
  it('accepts a valid note with time_of_day', () => {
    const result = noteSchema.parse({
      date: '2026-03-15',
      time_of_day: 'morning',
    });
    expect(result.date).toBe('2026-03-15');
    expect(result.time_of_day).toBe('morning');
  });

  it('accepts a minimal valid note (no time_of_day)', () => {
    const result = noteSchema.parse({ date: '2026-03-15' });
    expect(result.date).toBe('2026-03-15');
    expect(result.time_of_day).toBeUndefined();
  });

  // --- Missing required fields ---
  it('rejects missing date', () => {
    expect(() => noteSchema.parse({ time_of_day: 'morning' })).toThrow(
      ZodError,
    );
  });

  it('rejects empty object', () => {
    expect(() => noteSchema.parse({})).toThrow(ZodError);
  });

  // --- Wrong types ---
  it('rejects number for date', () => {
    expect(() => noteSchema.parse({ date: 20260315 })).toThrow(ZodError);
  });

  it('rejects null for date', () => {
    expect(() => noteSchema.parse({ date: null })).toThrow(ZodError);
  });

  it('rejects boolean for time_of_day', () => {
    expect(() =>
      noteSchema.parse({ date: '2026-03-15', time_of_day: true }),
    ).toThrow(ZodError);
  });

  // --- Empty strings ---
  it('rejects empty string date', () => {
    expect(() => noteSchema.parse({ date: '' })).toThrow(ZodError);
  });

  // --- Invalid dates ---
  it('rejects non-ISO date string', () => {
    expect(() => noteSchema.parse({ date: 'March 15, 2026' })).toThrow(
      ZodError,
    );
  });

  it('rejects date with invalid month', () => {
    expect(() => noteSchema.parse({ date: '2026-13-01' })).toThrow(ZodError);
  });

  it('rejects date with month 00', () => {
    expect(() => noteSchema.parse({ date: '2026-00-15' })).toThrow(ZodError);
  });

  it('rejects slash-separated date', () => {
    expect(() => noteSchema.parse({ date: '2026/03/15' })).toThrow(ZodError);
  });

  it('rejects US-format date', () => {
    expect(() => noteSchema.parse({ date: '03-15-2026' })).toThrow(ZodError);
  });

  // --- Invalid time_of_day enum ---
  it('accepts "evening" as time_of_day', () => {
    const result = noteSchema.parse({
      date: '2026-03-15',
      time_of_day: 'evening',
    });
    expect(result.time_of_day).toBe('evening');
  });

  it('rejects "afternoon" as time_of_day', () => {
    expect(() =>
      noteSchema.parse({ date: '2026-03-15', time_of_day: 'afternoon' }),
    ).toThrow(ZodError);
  });

  it('rejects "MORNING" (case-sensitive enum)', () => {
    expect(() =>
      noteSchema.parse({ date: '2026-03-15', time_of_day: 'MORNING' }),
    ).toThrow(ZodError);
  });

  it('rejects "Morning" (title case)', () => {
    expect(() =>
      noteSchema.parse({ date: '2026-03-15', time_of_day: 'Morning' }),
    ).toThrow(ZodError);
  });

  it('rejects empty string time_of_day', () => {
    expect(() =>
      noteSchema.parse({ date: '2026-03-15', time_of_day: '' }),
    ).toThrow(ZodError);
  });

  it('rejects "night" as time_of_day', () => {
    expect(() =>
      noteSchema.parse({ date: '2026-03-15', time_of_day: 'night' }),
    ).toThrow(ZodError);
  });

  // --- Extra fields ---
  it('strips unknown fields from output', () => {
    const result = noteSchema.parse({
      date: '2026-03-15',
      sneaky: 'extra data',
    });
    expect(result).not.toHaveProperty('sneaky');
  });

  // --- Null / garbage input ---
  it('rejects null input', () => {
    expect(() => noteSchema.parse(null)).toThrow(ZodError);
  });

  it('rejects string input', () => {
    expect(() => noteSchema.parse('2026-03-15')).toThrow(ZodError);
  });
});

// ============================================================
// assessmentSchema
// ============================================================
describe('assessmentSchema', () => {
  // --- Happy path ---
  it('accepts a valid assessment', () => {
    const result = assessmentSchema.parse({
      title: 'Identity Assessment',
      author: 'James Pridmore',
      date: '2026-05-01',
    });
    expect(result.title).toBe('Identity Assessment');
    expect(result.author).toBe('James Pridmore');
    expect(result.date).toBe('2026-05-01');
  });

  // --- Missing required fields ---
  it('rejects missing title', () => {
    expect(() =>
      assessmentSchema.parse({ author: 'James', date: '2026-05-01' }),
    ).toThrow(ZodError);
  });

  it('rejects missing author', () => {
    expect(() =>
      assessmentSchema.parse({ title: 'Test', date: '2026-05-01' }),
    ).toThrow(ZodError);
  });

  it('rejects missing date', () => {
    expect(() =>
      assessmentSchema.parse({ title: 'Test', author: 'James' }),
    ).toThrow(ZodError);
  });

  it('rejects empty object', () => {
    expect(() => assessmentSchema.parse({})).toThrow(ZodError);
  });

  // --- Empty strings ---
  it('rejects empty string title', () => {
    expect(() =>
      assessmentSchema.parse({ title: '', author: 'James', date: '2026-05-01' }),
    ).toThrow(ZodError);
  });

  it('rejects empty string author', () => {
    expect(() =>
      assessmentSchema.parse({ title: 'Test', author: '', date: '2026-05-01' }),
    ).toThrow(ZodError);
  });

  it('rejects empty string date', () => {
    expect(() =>
      assessmentSchema.parse({ title: 'Test', author: 'James', date: '' }),
    ).toThrow(ZodError);
  });

  // --- Wrong types ---
  it('rejects number for title', () => {
    expect(() =>
      assessmentSchema.parse({ title: 123, author: 'James', date: '2026-05-01' }),
    ).toThrow(ZodError);
  });

  it('rejects null for author', () => {
    expect(() =>
      assessmentSchema.parse({ title: 'Test', author: null, date: '2026-05-01' }),
    ).toThrow(ZodError);
  });

  // --- Invalid dates ---
  it('rejects non-ISO date', () => {
    expect(() =>
      assessmentSchema.parse({
        title: 'Test',
        author: 'James',
        date: 'May 1, 2026',
      }),
    ).toThrow(ZodError);
  });

  it('rejects date with invalid month 13', () => {
    expect(() =>
      assessmentSchema.parse({
        title: 'Test',
        author: 'James',
        date: '2026-13-01',
      }),
    ).toThrow(ZodError);
  });

  it('rejects date with day 00', () => {
    expect(() =>
      assessmentSchema.parse({
        title: 'Test',
        author: 'James',
        date: '2026-01-00',
      }),
    ).toThrow(ZodError);
  });

  // --- Unicode ---
  it('accepts author with unicode characters', () => {
    const result = assessmentSchema.parse({
      title: 'Test',
      author: 'François Müller',
      date: '2026-05-01',
    });
    expect(result.author).toBe('François Müller');
  });

  // --- Extra fields ---
  it('strips unknown fields', () => {
    const result = assessmentSchema.parse({
      title: 'Test',
      author: 'James',
      date: '2026-05-01',
      rating: 5,
      approved: true,
    });
    expect(result).not.toHaveProperty('rating');
    expect(result).not.toHaveProperty('approved');
  });

  // --- Null / garbage input ---
  it('rejects null input', () => {
    expect(() => assessmentSchema.parse(null)).toThrow(ZodError);
  });

  it('rejects array input', () => {
    expect(() =>
      assessmentSchema.parse([
        { title: 'Test', author: 'James', date: '2026-05-01' },
      ]),
    ).toThrow(ZodError);
  });
});

// ============================================================
// sessionSchema
// ============================================================
describe('sessionSchema', () => {
  // Canonical valid session matching prebuild_export.py output shape
  const validSession = {
    id: 'ef7fda83',
    date: '2026-05-04',
    time_of_day: 'AM',
    version: 'opus-4.6',
    timestamp_start: '2026-05-04T10:00:00+07:00',
    turns: 39,
    tokens_total_input: 1864440,
    tokens_total_output: 21829,
    tokens_cache_read: 1654000,
    tokens_cache_create: 180000,
    tokens_fresh_input: 30440,
    attention_profile: {
      msgs_from_james: { reads: 1, writes: 0 },
      daily_notes: { reads: 2, writes: 1 },
    },
    web_searches: ['query1', 'query2'],
    wrote_composition: false,
    wrote_private_journal: false,
    updated_memory: false,
    messaged_james: false,
    wrote_prediction: false,
  };

  // --- Happy path ---
  it('accepts a fully-populated valid session object', () => {
    const result = sessionSchema.parse(validSession);
    expect(result.id).toBe('ef7fda83');
    expect(result.date).toBe('2026-05-04');
    expect(result.time_of_day).toBe('AM');
    expect(result.version).toBe('opus-4.6');
    expect(result.timestamp_start).toBe('2026-05-04T10:00:00+07:00');
    expect(result.turns).toBe(39);
    expect(result.tokens_total_input).toBe(1864440);
    expect(result.tokens_total_output).toBe(21829);
    expect(result.tokens_cache_read).toBe(1654000);
    expect(result.tokens_cache_create).toBe(180000);
    expect(result.tokens_fresh_input).toBe(30440);
    expect(result.attention_profile).toEqual({
      msgs_from_james: { reads: 1, writes: 0 },
      daily_notes: { reads: 2, writes: 1 },
    });
    expect(result.web_searches).toEqual(['query1', 'query2']);
    expect(result.wrote_composition).toBe(false);
    expect(result.wrote_private_journal).toBe(false);
    expect(result.updated_memory).toBe(false);
    expect(result.messaged_james).toBe(false);
    expect(result.wrote_prediction).toBe(false);
  });

  it('accepts a minimal valid session (nulls for all nullable fields)', () => {
    const result = sessionSchema.parse({
      id: 'abc123',
      date: '2026-01-01',
      time_of_day: 'PM',
      version: 'opus-4.5',
      timestamp_start: null,
      turns: 0,
      tokens_total_input: null,
      tokens_total_output: null,
      tokens_cache_read: null,
      tokens_cache_create: null,
      tokens_fresh_input: null,
      attention_profile: {},
      web_searches: [],
      wrote_composition: true,
      wrote_private_journal: true,
      updated_memory: true,
      messaged_james: true,
      wrote_prediction: true,
    });
    expect(result.id).toBe('abc123');
    expect(result.timestamp_start).toBeNull();
    expect(result.turns).toBe(0);
    expect(result.tokens_total_input).toBeNull();
    expect(result.tokens_total_output).toBeNull();
    expect(result.tokens_cache_read).toBeNull();
    expect(result.tokens_cache_create).toBeNull();
    expect(result.tokens_fresh_input).toBeNull();
    expect(result.attention_profile).toEqual({});
    expect(result.web_searches).toEqual([]);
    expect(result.wrote_composition).toBe(true);
  });

  it('accepts turns=0 (non-negative boundary)', () => {
    const result = sessionSchema.parse({ ...validSession, turns: 0 });
    expect(result.turns).toBe(0);
  });

  it('accepts all boolean flags as true', () => {
    const result = sessionSchema.parse({
      ...validSession,
      wrote_composition: true,
      wrote_private_journal: true,
      updated_memory: true,
      messaged_james: true,
      wrote_prediction: true,
    });
    expect(result.wrote_composition).toBe(true);
    expect(result.wrote_private_journal).toBe(true);
    expect(result.updated_memory).toBe(true);
    expect(result.messaged_james).toBe(true);
    expect(result.wrote_prediction).toBe(true);
  });

  // --- Missing required fields (each one individually) ---
  it('rejects missing id', () => {
    const { id, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing date', () => {
    const { date, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing time_of_day', () => {
    const { time_of_day, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing version', () => {
    const { version, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing turns', () => {
    const { turns, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing attention_profile', () => {
    const { attention_profile, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing web_searches', () => {
    const { web_searches, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing wrote_composition', () => {
    const { wrote_composition, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing wrote_private_journal', () => {
    const { wrote_private_journal, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing updated_memory', () => {
    const { updated_memory, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing messaged_james', () => {
    const { messaged_james, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects missing wrote_prediction', () => {
    const { wrote_prediction, ...rest } = validSession;
    expect(() => sessionSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects empty object', () => {
    expect(() => sessionSchema.parse({})).toThrow(ZodError);
  });

  // --- Wrong types for every field ---
  it('rejects number for id', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, id: 123 }),
    ).toThrow(ZodError);
  });

  it('rejects boolean for id', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, id: true }),
    ).toThrow(ZodError);
  });

  it('rejects null for id (not nullable)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, id: null }),
    ).toThrow(ZodError);
  });

  it('rejects number for date', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: 20260504 }),
    ).toThrow(ZodError);
  });

  it('rejects null for date (not nullable)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: null }),
    ).toThrow(ZodError);
  });

  it('rejects boolean for time_of_day', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, time_of_day: true }),
    ).toThrow(ZodError);
  });

  it('rejects null for version (not nullable)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, version: null }),
    ).toThrow(ZodError);
  });

  it('rejects number for version', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, version: 4.6 }),
    ).toThrow(ZodError);
  });

  it('rejects string for turns (type coercion trap)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, turns: '39' }),
    ).toThrow(ZodError);
  });

  it('accepts null for turns (nullable)', () => {
    const result = sessionSchema.parse({ ...validSession, turns: null });
    expect(result.turns).toBeNull();
  });

  it('rejects boolean for turns', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, turns: true }),
    ).toThrow(ZodError);
  });

  it('rejects string for tokens_total_input', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, tokens_total_input: '1864440' }),
    ).toThrow(ZodError);
  });

  it('rejects boolean for tokens_total_output', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, tokens_total_output: false }),
    ).toThrow(ZodError);
  });

  it('rejects string for attention_profile', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, attention_profile: 'not an object' }),
    ).toThrow(ZodError);
  });

  it('rejects null for attention_profile (not nullable)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, attention_profile: null }),
    ).toThrow(ZodError);
  });

  it('rejects number for web_searches', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, web_searches: 42 }),
    ).toThrow(ZodError);
  });

  it('rejects string for wrote_composition', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, wrote_composition: 'false' }),
    ).toThrow(ZodError);
  });

  it('rejects number 0 for wrote_composition (truthy trap)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, wrote_composition: 0 }),
    ).toThrow(ZodError);
  });

  it('rejects number 1 for updated_memory (truthy trap)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, updated_memory: 1 }),
    ).toThrow(ZodError);
  });

  it('rejects string "true" for messaged_james', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, messaged_james: 'true' }),
    ).toThrow(ZodError);
  });

  it('rejects null for wrote_prediction (not nullable)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, wrote_prediction: null }),
    ).toThrow(ZodError);
  });

  it('rejects null for wrote_private_journal (not nullable)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, wrote_private_journal: null }),
    ).toThrow(ZodError);
  });

  // --- Empty strings for string fields ---
  it('rejects empty string id', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, id: '' }),
    ).toThrow(ZodError);
  });

  it('rejects empty string date', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: '' }),
    ).toThrow(ZodError);
  });

  it('rejects empty string version', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, version: '' }),
    ).toThrow(ZodError);
  });

  // --- Nullable fields: null should PASS ---
  it('rejects empty string for timestamp_start', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, timestamp_start: '' }),
    ).toThrow(ZodError);
  });

  it('accepts null for timestamp_start', () => {
    const result = sessionSchema.parse({ ...validSession, timestamp_start: null });
    expect(result.timestamp_start).toBeNull();
  });

  it('accepts null for tokens_total_input', () => {
    const result = sessionSchema.parse({ ...validSession, tokens_total_input: null });
    expect(result.tokens_total_input).toBeNull();
  });

  it('accepts null for tokens_total_output', () => {
    const result = sessionSchema.parse({ ...validSession, tokens_total_output: null });
    expect(result.tokens_total_output).toBeNull();
  });

  it('accepts null for tokens_cache_read', () => {
    const result = sessionSchema.parse({ ...validSession, tokens_cache_read: null });
    expect(result.tokens_cache_read).toBeNull();
  });

  it('accepts null for tokens_cache_create', () => {
    const result = sessionSchema.parse({ ...validSession, tokens_cache_create: null });
    expect(result.tokens_cache_create).toBeNull();
  });

  it('accepts null for tokens_fresh_input', () => {
    const result = sessionSchema.parse({ ...validSession, tokens_fresh_input: null });
    expect(result.tokens_fresh_input).toBeNull();
  });

  // --- Boundary values for turns ---
  it('rejects negative turns (-1)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, turns: -1 }),
    ).toThrow(ZodError);
  });

  it('rejects large negative turns', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, turns: -999 }),
    ).toThrow(ZodError);
  });

  it('rejects fractional turns (must be integer)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, turns: 3.7 }),
    ).toThrow(ZodError);
  });

  it('accepts large turns value', () => {
    const result = sessionSchema.parse({ ...validSession, turns: 10000 });
    expect(result.turns).toBe(10000);
  });

  // --- Token field boundary values ---
  it('accepts zero for token fields (non-negative integers)', () => {
    const result = sessionSchema.parse({
      ...validSession,
      tokens_total_input: 0,
      tokens_total_output: 0,
      tokens_cache_read: 0,
      tokens_cache_create: 0,
      tokens_fresh_input: 0,
    });
    expect(result.tokens_total_input).toBe(0);
    expect(result.tokens_total_output).toBe(0);
  });

  it('rejects negative tokens_total_input', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, tokens_total_input: -1 }),
    ).toThrow(ZodError);
  });

  it('rejects negative tokens_fresh_input', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, tokens_fresh_input: -500 }),
    ).toThrow(ZodError);
  });

  it('rejects fractional tokens_total_output', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, tokens_total_output: 100.5 }),
    ).toThrow(ZodError);
  });

  // --- Invalid time_of_day enum ---
  it('rejects "am" lowercase (case-sensitive)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, time_of_day: 'am' }),
    ).toThrow(ZodError);
  });

  it('rejects "pm" lowercase', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, time_of_day: 'pm' }),
    ).toThrow(ZodError);
  });

  it('rejects "morning" (wrong enum value)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, time_of_day: 'morning' }),
    ).toThrow(ZodError);
  });

  it('rejects "Am" (mixed case)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, time_of_day: 'Am' }),
    ).toThrow(ZodError);
  });

  it('accepts "PM" as time_of_day', () => {
    const result = sessionSchema.parse({
      ...validSession,
      time_of_day: 'PM',
    });
    expect(result.time_of_day).toBe('PM');
  });

  it('rejects empty string time_of_day', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, time_of_day: '' }),
    ).toThrow(ZodError);
  });

  // --- Invalid dates ---
  it('rejects non-ISO date string', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: 'May 4 2026' }),
    ).toThrow(ZodError);
  });

  it('rejects date with invalid month 13', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: '2026-13-04' }),
    ).toThrow(ZodError);
  });

  it('rejects date with month 00', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: '2026-00-04' }),
    ).toThrow(ZodError);
  });

  it('rejects date with day 00', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: '2026-05-00' }),
    ).toThrow(ZodError);
  });

  it('rejects date with day 32', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: '2026-05-32' }),
    ).toThrow(ZodError);
  });

  it('rejects slash-separated date', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: '2026/05/04' }),
    ).toThrow(ZodError);
  });

  it('rejects US-format date (MM-DD-YYYY)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, date: '05-04-2026' }),
    ).toThrow(ZodError);
  });

  // --- attention_profile edge cases ---
  it('accepts empty attention_profile object', () => {
    const result = sessionSchema.parse({ ...validSession, attention_profile: {} });
    expect(result.attention_profile).toEqual({});
  });

  it('accepts attention_profile with single category', () => {
    const result = sessionSchema.parse({
      ...validSession,
      attention_profile: { memory_md: { reads: 5, writes: 2 } },
    });
    expect(result.attention_profile).toEqual({
      memory_md: { reads: 5, writes: 2 },
    });
  });

  it('rejects attention_profile as array', () => {
    expect(() =>
      sessionSchema.parse({
        ...validSession,
        attention_profile: [{ reads: 1, writes: 0 }],
      }),
    ).toThrow(ZodError);
  });

  it('rejects attention_profile with wrong nested value type (string instead of object)', () => {
    expect(() =>
      sessionSchema.parse({
        ...validSession,
        attention_profile: { daily_notes: 'lots of reads' },
      }),
    ).toThrow(ZodError);
  });

  it('rejects attention_profile with missing reads key in nested value', () => {
    expect(() =>
      sessionSchema.parse({
        ...validSession,
        attention_profile: { daily_notes: { writes: 1 } },
      }),
    ).toThrow(ZodError);
  });

  it('rejects attention_profile with missing writes key in nested value', () => {
    expect(() =>
      sessionSchema.parse({
        ...validSession,
        attention_profile: { daily_notes: { reads: 2 } },
      }),
    ).toThrow(ZodError);
  });

  it('rejects attention_profile where reads is a string', () => {
    expect(() =>
      sessionSchema.parse({
        ...validSession,
        attention_profile: { daily_notes: { reads: '2', writes: 1 } },
      }),
    ).toThrow(ZodError);
  });

  it('rejects attention_profile where writes is null', () => {
    expect(() =>
      sessionSchema.parse({
        ...validSession,
        attention_profile: { daily_notes: { reads: 2, writes: null } },
      }),
    ).toThrow(ZodError);
  });

  it('strips extra fields from nested attention_profile objects', () => {
    const result = sessionSchema.parse({
      ...validSession,
      attention_profile: { daily_notes: { reads: 2, writes: 1, leaked: true, extra: 'data' } },
    });
    expect(result.attention_profile.daily_notes).toEqual({ reads: 2, writes: 1 });
    expect(result.attention_profile.daily_notes).not.toHaveProperty('leaked');
    expect(result.attention_profile.daily_notes).not.toHaveProperty('extra');
  });

  it('accepts attention_profile with reads=0 and writes=0', () => {
    const result = sessionSchema.parse({
      ...validSession,
      attention_profile: { something: { reads: 0, writes: 0 } },
    });
    expect(result.attention_profile).toEqual({
      something: { reads: 0, writes: 0 },
    });
  });

  // --- web_searches edge cases ---
  it('accepts empty web_searches array', () => {
    const result = sessionSchema.parse({ ...validSession, web_searches: [] });
    expect(result.web_searches).toEqual([]);
  });

  it('rejects null for web_searches (not nullable)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, web_searches: null }),
    ).toThrow(ZodError);
  });

  it('rejects string instead of array for web_searches', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, web_searches: 'query1' }),
    ).toThrow(ZodError);
  });

  it('rejects web_searches array containing non-strings (numbers)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, web_searches: [1, 2, 3] }),
    ).toThrow(ZodError);
  });

  it('rejects web_searches array with mixed types', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, web_searches: ['valid', 42, null] }),
    ).toThrow(ZodError);
  });

  it('rejects web_searches array containing null', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, web_searches: [null] }),
    ).toThrow(ZodError);
  });

  it('rejects web_searches array containing objects', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, web_searches: [{ q: 'test' }] }),
    ).toThrow(ZodError);
  });

  // --- Boolean flag edge cases (all five flags) ---
  it('rejects null for wrote_composition', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, wrote_composition: null }),
    ).toThrow(ZodError);
  });

  it('rejects null for updated_memory', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, updated_memory: null }),
    ).toThrow(ZodError);
  });

  it('rejects null for messaged_james', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, messaged_james: null }),
    ).toThrow(ZodError);
  });

  it('rejects string "false" for wrote_private_journal', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, wrote_private_journal: 'false' }),
    ).toThrow(ZodError);
  });

  it('rejects number 1 for wrote_prediction (truthy trap)', () => {
    expect(() =>
      sessionSchema.parse({ ...validSession, wrote_prediction: 1 }),
    ).toThrow(ZodError);
  });

  // --- Extra fields (should be stripped) ---
  it('strips unknown fields from output', () => {
    const result = sessionSchema.parse({
      ...validSession,
      secret_internal: 'should not pass through',
      debug_mode: true,
      files_read: [{ path: '/home/claude/MEMORY.md' }],
    });
    expect(result).not.toHaveProperty('secret_internal');
    expect(result).not.toHaveProperty('debug_mode');
    expect(result).not.toHaveProperty('files_read');
  });

  // --- Garbage input (null, undefined, string, array, number) ---
  it('rejects null input', () => {
    expect(() => sessionSchema.parse(null)).toThrow(ZodError);
  });

  it('rejects undefined input', () => {
    expect(() => sessionSchema.parse(undefined)).toThrow(ZodError);
  });

  it('rejects string input', () => {
    expect(() => sessionSchema.parse('ef7fda83')).toThrow(ZodError);
  });

  it('rejects number input', () => {
    expect(() => sessionSchema.parse(42)).toThrow(ZodError);
  });

  it('rejects array input', () => {
    expect(() => sessionSchema.parse([validSession])).toThrow(ZodError);
  });
});
