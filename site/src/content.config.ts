import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const changelog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: 'src/content/changelog' }),
  schema: z.object({
    version: z.string(),
    date:    z.coerce.date(),
    tags:    z.array(z.enum(['feat', 'fix', 'breaking'])),
    summary: z.string(),
  }),
});

const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: 'src/content/docs' }),
  schema: z.object({
    title:       z.string(),
    description: z.string(),
    generatedAt: z.string().optional(),
  }),
});

export const collections = { changelog, docs };
