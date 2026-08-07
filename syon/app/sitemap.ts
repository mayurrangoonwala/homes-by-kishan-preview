import type { MetadataRoute } from 'next';
import { courses } from '@/lib/courses';
import { cities } from '@/lib/cities';
import { absoluteUrl } from '@/lib/site';

// Required by `output: 'export'` — see the note in robots.ts.
export const dynamic = 'force-static';

/**
 * Priorities encode the commercial hierarchy, not a guess at what Google
 * wants. City x course pages are the highest-intent surface ("forklift
 * training mississauga" is a buying query), so they sit at the top alongside
 * the home page. Priority is a weak hint at best, but an internally
 * inconsistent sitemap is a genuine negative signal, so it is worth setting
 * coherently.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/courses/'), lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: absoluteUrl('/quote/'), lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
  ];

  const coursePages: MetadataRoute.Sitemap = courses.map((course) => ({
    url: absoluteUrl(`/courses/${course.slug}/`),
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.9,
  }));

  const cityPages: MetadataRoute.Sitemap = cities.map((city) => ({
    url: absoluteUrl(`/${city.slug}/`),
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  const cityCoursePages: MetadataRoute.Sitemap = cities.flatMap((city) =>
    courses.map((course) => ({
      url: absoluteUrl(`/${city.slug}/${course.slug}/`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.9,
    })),
  );

  return [...staticPages, ...coursePages, ...cityPages, ...cityCoursePages];
}
