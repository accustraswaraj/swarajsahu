import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blogs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blogs' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    excerpt: z.string(),
    category: z.string(),
    tools: z.array(
      z.object({
        name: z.string(),
        icon: z.string().url(),
      }),
    ).optional(),
  }),
});

export const collections = { blogs };
