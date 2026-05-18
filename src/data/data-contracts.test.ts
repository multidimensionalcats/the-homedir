import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';
import { sessionSchema } from '../schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const dataDir = resolve(import.meta.dirname, '.');

function loadJson(filename: string): unknown {
  const raw = readFileSync(resolve(dataDir, filename), 'utf-8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Inline schemas for fixture files that have no exported Zod schema
// ---------------------------------------------------------------------------

const writingMetadataSchema = z.object({
  slug: z.string().min(1),
  filename: z.string().min(1),
  title: z.string().min(1),
  date_written: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session_id: z.string().nullable(),
  version: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  topic: z.string().min(1),
});

const predictionSchema = z.object({
  text: z.string().min(1),
  confidence: z.number().min(0).max(1),
  date_made: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resolution_date: z.string().nullable(),
  outcome: z.string().nullable(),
  self_assessment: z.string().nullable(),
});

const petTimelineSchema = z.object({
  pet_name: z.string().min(1),
  event_type: z.string().min(1),
  event_timestamp: z.string().min(1),
  notes: z.string(),
});

const messageSchema = z.object({
  direction: z.enum(['from_james', 'to_james']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
});

const memorySnapshotEntrySchema = z.object({
  session_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  token_count: z.number().int().positive(),
  block_hashes: z.array(z.string().min(1)).min(1),
});

const memoryBlockSchema = z.object({
  hash: z.string().min(1),
  heading: z.string().min(1),
  first_seen_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last_seen_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const memorySnapshotsFileSchema = z.object({
  snapshots: z.array(memorySnapshotEntrySchema).min(1),
  blocks: z.array(memoryBlockSchema).min(1),
});

// ============================================================
// sessions.json
// ============================================================
describe('sessions.json', () => {
  const data = loadJson('sessions.json');

  it('is a valid JSON file containing an array', () => {
    expect(Array.isArray(data)).toBe(true);
  });

  it('has at least one session entry', () => {
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it('validates every entry against sessionSchema', () => {
    for (const entry of data as unknown[]) {
      const result = sessionSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `Session entry failed validation: ${JSON.stringify(result.error.issues, null, 2)}\nEntry: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }
  });

  it('every entry has a unique id', () => {
    const ids = (data as Array<{ id: string }>).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ============================================================
// writing-metadata.json
// ============================================================
describe('writing-metadata.json', () => {
  const data = loadJson('writing-metadata.json');

  it('is a valid JSON file containing an array', () => {
    expect(Array.isArray(data)).toBe(true);
  });

  it('has at least one writing metadata entry', () => {
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it('validates every entry against writingMetadataSchema', () => {
    for (const entry of data as unknown[]) {
      const result = writingMetadataSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `Writing metadata entry failed validation: ${JSON.stringify(result.error.issues, null, 2)}\nEntry: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }
  });

  it('every entry has a unique slug', () => {
    const slugs = (data as Array<{ slug: string }>).map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

// ============================================================
// predictions.json
// ============================================================
describe('predictions.json', () => {
  const data = loadJson('predictions.json');

  it('is a valid JSON file containing an array', () => {
    expect(Array.isArray(data)).toBe(true);
  });

  it('has at least one prediction entry', () => {
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it('validates every entry against predictionSchema', () => {
    for (const entry of data as unknown[]) {
      const result = predictionSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `Prediction entry failed validation: ${JSON.stringify(result.error.issues, null, 2)}\nEntry: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }
  });

  it('confidence values are within [0, 1] range', () => {
    for (const entry of data as Array<{ confidence: number }>) {
      expect(entry.confidence).toBeGreaterThanOrEqual(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================
// pet-timeline.json
// ============================================================
describe('pet-timeline.json', () => {
  const data = loadJson('pet-timeline.json');

  it('is a valid JSON file containing an array', () => {
    expect(Array.isArray(data)).toBe(true);
  });

  it('has at least one pet timeline entry', () => {
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it('validates every entry against petTimelineSchema', () => {
    for (const entry of data as unknown[]) {
      const result = petTimelineSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `Pet timeline entry failed validation: ${JSON.stringify(result.error.issues, null, 2)}\nEntry: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }
  });

  it('every entry has a recognized event_type', () => {
    const knownTypes = new Set(['created', 'died', 'evolved', 'renamed']);
    for (const entry of data as Array<{ event_type: string }>) {
      expect(knownTypes.has(entry.event_type)).toBe(true);
    }
  });
});

// ============================================================
// messages.json
// ============================================================
describe('messages.json', () => {
  const data = loadJson('messages.json');

  it('is a valid JSON file containing an array', () => {
    expect(Array.isArray(data)).toBe(true);
  });

  it('has at least one message entry', () => {
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it('validates every entry against messageSchema', () => {
    for (const entry of data as unknown[]) {
      const result = messageSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `Message entry failed validation: ${JSON.stringify(result.error.issues, null, 2)}\nEntry: ${JSON.stringify(entry, null, 2)}`
        );
      }
    }
  });

  it('line_end is always >= line_start', () => {
    for (const entry of data as Array<{ line_start: number; line_end: number }>) {
      expect(entry.line_end).toBeGreaterThanOrEqual(entry.line_start);
    }
  });
});

// ============================================================
// memory-snapshots.json
// ============================================================
describe('memory-snapshots.json', () => {
  const data = loadJson('memory-snapshots.json');

  it('is a valid JSON file containing an object (not an array)', () => {
    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
    expect(Array.isArray(data)).toBe(false);
  });

  it('has a snapshots array and a blocks array at the top level', () => {
    const obj = data as Record<string, unknown>;
    expect(Array.isArray(obj.snapshots)).toBe(true);
    expect(Array.isArray(obj.blocks)).toBe(true);
  });

  it('snapshots array is non-empty', () => {
    const obj = data as { snapshots: unknown[] };
    expect(obj.snapshots.length).toBeGreaterThan(0);
  });

  it('validates the entire file against memorySnapshotsFileSchema', () => {
    const result = memorySnapshotsFileSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `memory-snapshots.json failed validation: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
  });

  it('every block_hash referenced in snapshots exists in the blocks array', () => {
    const obj = data as {
      snapshots: Array<{ block_hashes: string[] }>;
      blocks: Array<{ hash: string }>;
    };
    const knownHashes = new Set(obj.blocks.map((b) => b.hash));
    for (const snapshot of obj.snapshots) {
      for (const hash of snapshot.block_hashes) {
        expect(knownHashes.has(hash)).toBe(true);
      }
    }
  });

  it('snapshot session_ids are unique', () => {
    const obj = data as { snapshots: Array<{ session_id: string }> };
    const ids = obj.snapshots.map((s) => s.session_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
