import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';

// Required by `output: 'export'` — the metadata route must be emitted as a
// static file at build time rather than served dynamically.
export const dynamic = 'force-static';

/**
 * AI crawlers are allowed deliberately.
 *
 * Blocking GPTBot, ClaudeBot, PerplexityBot and Google-Extended is a common
 * default, and for a publisher protecting paid content it is the right call.
 * For Syon it would be self-defeating: the entire GEO objective is to be the
 * source an assistant cites when an Ontario employer asks which training they
 * need. You cannot be cited by a crawler you have blocked.
 *
 * Note that Google-Extended governs Gemini and AI Overviews grounding but does
 * not affect classic Search indexing, which Googlebot handles separately.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
      {
        userAgent: [
          'GPTBot',
          'OAI-SearchBot',
          'ChatGPT-User',
          'ClaudeBot',
          'Claude-User',
          'PerplexityBot',
          'Perplexity-User',
          'Google-Extended',
          'Applebot-Extended',
          'Bingbot',
          'CCBot',
        ],
        allow: '/',
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
