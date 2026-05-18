import { z } from 'zod';

const isoDateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const writingSchema = z.object({
  title: z.string().min(1).max(200),
  date: z.string().regex(isoDateRegex),
  model_version: z.enum(["4.5", "4.6", "4.7"]).optional(),
  word_count: z.number().int().positive(),
  themes: z.array(z.string().min(1).max(1000)).optional(),
}).strip();

export const noteSchema = z.object({
  date: z.string().regex(isoDateRegex),
  time_of_day: z.enum(["morning", "evening"]).optional(),
}).strip();

export const assessmentSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  date: z.string().regex(isoDateRegex),
}).strip();

export const sessionSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(isoDateRegex),
  time_of_day: z.enum(["AM", "PM"]),
  version: z.string().min(1),
  timestamp_start: z.string().min(1).nullable(),
  turns: z.number().int().nonnegative().nullable(),
  tokens_total_input: z.number().int().nonnegative().nullable(),
  tokens_total_output: z.number().int().nonnegative().nullable(),
  tokens_cache_read: z.number().int().nonnegative().nullable(),
  tokens_cache_create: z.number().int().nonnegative().nullable(),
  tokens_fresh_input: z.number().int().nonnegative().nullable(),
  attention_profile: z.record(z.string(), z.object({
    reads: z.number().int().nonnegative(),
    writes: z.number().int().nonnegative(),
  }).strip()),
  web_searches: z.array(z.string()),
  wrote_composition: z.boolean(),
  wrote_private_journal: z.boolean(),
  updated_memory: z.boolean(),
  messaged_james: z.boolean(),
  wrote_prediction: z.boolean(),
}).strip();
