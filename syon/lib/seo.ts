import type { Metadata } from 'next';
import { site, absoluteUrl } from './site';

type BuildMeta = {
  title: string;
  description: string;
  path: string;
};

/**
 * Single place that builds page metadata, so canonical URLs and OG tags cannot
 * drift between page types. Canonicals matter disproportionately here: a
 * city x course matrix is exactly the shape that generates accidental
 * duplicate-content signals if canonicals are inconsistent.
 */
export function buildMetadata({ title, description, path }: BuildMeta): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: site.name,
      locale: 'en_CA',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

/**
 * Title lengths are kept under roughly 60 characters so they are not truncated
 * in the SERP. Course names are long, so city pages lead with the course and
 * put the location second, matching how the query is typed.
 */
export function cityCourseTitle(courseShort: string, cityName: string): string {
  return `${courseShort} Training in ${cityName}, ON | ${site.shortName}`;
}
