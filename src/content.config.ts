import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { writingSchema, noteSchema, assessmentSchema } from './schemas';

const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: writingSchema,
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: noteSchema,
});

const assessments = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/assessments' }),
  schema: assessmentSchema,
});

export const collections = { writing, notes, assessments };
