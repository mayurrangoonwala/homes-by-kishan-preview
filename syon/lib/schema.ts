// JSON-LD builders.
//
// Structured data does double duty here. For classic SEO it drives rich
// results (FAQ accordions, course cards, breadcrumbs). For GEO it is the
// higher-value half: generative engines lean on explicit entity markup to
// decide what a page asserts and whether it is worth citing. Prose alone is
// ambiguous to a retrieval pipeline; typed triples are not.
//
// Rules kept throughout:
//  - Never emit a property we cannot substantiate. A fabricated aggregateRating
//    or address is a structured-data violation and a trust problem.
//  - Everything marked up must also be visible on the page. Markup that is not
//    reflected in the rendered content is a spam-policy violation.

import { site, absoluteUrl } from './site';
import type { Course } from './courses';
import type { City } from './cities';

type Json = Record<string, unknown>;

const ORG_ID = absoluteUrl('/#organization');

/** The root entity every other node points back to. */
export function organizationSchema(): Json {
  const node: Json = {
    '@type': ['EducationalOrganization', 'LocalBusiness'],
    '@id': ORG_ID,
    name: site.name,
    legalName: site.legalName,
    url: absoluteUrl('/'),
    description: site.description,
    telephone: site.telephone,
    email: site.email,
    areaServed: {
      '@type': 'State',
      name: site.region,
    },
    knowsAbout: [
      'Occupational health and safety training',
      'Working at Heights',
      'WHMIS 2015',
      'Forklift operator certification',
      'Joint Health and Safety Committee certification',
      'Confined space entry',
    ],
  };

  // Only emitted once Syon supplies a verified address — see lib/site.ts.
  if (site.address) {
    node.address = { '@type': 'PostalAddress', ...site.address };
  }

  return node;
}

export function websiteSchema(): Json {
  return {
    '@type': 'WebSite',
    '@id': absoluteUrl('/#website'),
    url: absoluteUrl('/'),
    name: site.name,
    publisher: { '@id': ORG_ID },
    inLanguage: 'en-CA',
  };
}

/**
 * Course schema. When `city` is supplied this describes the locally delivered
 * instance, which is what makes the city pages distinct entities rather than
 * near-duplicates of the parent course page.
 */
export function courseSchema(course: Course, city?: City): Json {
  const path = city ? `/${city.slug}/${course.slug}/` : `/courses/${course.slug}/`;
  const name = city ? `${course.name} in ${city.name}, Ontario` : course.name;

  return {
    '@type': 'Course',
    '@id': `${absoluteUrl(path)}#course`,
    name,
    description: course.summary,
    url: absoluteUrl(path),
    provider: { '@id': ORG_ID },
    inLanguage: 'en-CA',
    teaches: course.outcomes,
    audience: {
      '@type': 'Audience',
      audienceType: course.audience,
    },
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'onsite',
      courseWorkload: course.duration,
      location: city
        ? {
            '@type': 'Place',
            name: `${city.name}, Ontario`,
            address: {
              '@type': 'PostalAddress',
              addressLocality: city.name,
              addressRegion: site.regionCode,
              addressCountry: site.country,
            },
          }
        : {
            '@type': 'Place',
            name: 'Ontario, Canada',
            address: {
              '@type': 'PostalAddress',
              addressRegion: site.regionCode,
              addressCountry: site.country,
            },
          },
    },
  };
}

export function faqSchema(
  faqs: { question: string; answer: string }[],
  path: string,
): Json {
  return {
    '@type': 'FAQPage',
    '@id': `${absoluteUrl(path)}#faq`,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  };
}

export function breadcrumbSchema(
  trail: { name: string; path: string }[],
): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function serviceSchema(course: Course, city: City): Json {
  return {
    '@type': 'Service',
    serviceType: course.name,
    provider: { '@id': ORG_ID },
    areaServed: {
      '@type': 'City',
      name: city.name,
      containedInPlace: {
        '@type': 'State',
        name: site.region,
      },
    },
  };
}

/** Wraps nodes in a single @graph, which is cleaner than several script tags. */
export function graph(...nodes: Json[]): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': nodes,
  });
}
