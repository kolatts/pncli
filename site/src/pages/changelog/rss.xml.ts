import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import MarkdownIt from 'markdown-it';
import { sortChangelogEntries } from '../../lib/changelog';

// The entry bodies are the raw CHANGELOG.md sections (MDX-escaped, which
// CommonMark reads back as plain backslash escapes). Raw HTML stays off so a
// commit subject can never inject markup into a reader.
const md = new MarkdownIt({ html: false, linkify: false });

export async function GET(context: APIContext) {
  const entries = sortChangelogEntries(await getCollection('changelog'));
  const base = new URL(import.meta.env.BASE_URL, context.site);

  return rss({
    title: 'pncli changelog',
    description: 'Every pncli release, in one place.',
    site: base,
    items: entries.map(entry => ({
      title: `v${entry.data.version}`,
      link: `changelog/${entry.data.version}/`,
      pubDate: entry.data.date,
      description: entry.data.summary,
      content: md.render(entry.body ?? ''),
      categories: entry.data.tags,
    })),
    customData: '<language>en-us</language>',
  });
}
