// Central site constants. Every value marked VERIFY must be confirmed with
// Syon before launch — several are inferred from email correspondence rather
// than supplied by the client. See CONTENT-REVIEW.md.

export const site = {
  name: 'Syon Safety Ltd.',
  shortName: 'Syon Safety',
  legalName: 'Syon Safety Ltd.',

  // Production origin. Used to build absolute URLs in JSON-LD and sitemap,
  // both of which require absolute URLs to be valid.
  origin: 'https://www.syonsafety.com',

  // VERIFY: taken from Sandeep's email signature.
  telephone: '+1-647-261-7805',
  telephoneDisplay: '647-261-7805',
  email: 'sandeep@syonsafety.com',

  // VERIFY: Syon has not supplied a street address. LocalBusiness schema is
  // materially weaker without one, and Google Business Profile requires it for
  // local pack eligibility. Left null deliberately rather than invented — a
  // fabricated address in JSON-LD is a structured-data violation.
  address: null as null | {
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  },

  // Primary service region, used for areaServed in schema.
  region: 'Ontario',
  regionCode: 'ON',
  country: 'CA',

  description:
    'Syon Safety Ltd. delivers workplace health and safety training to businesses across Ontario, including Working at Heights, WHMIS, forklift, JHSC certification and first aid.',

  // Sales positioning inherited from the lead-generation specification agreed
  // with Sandeep on 17 July 2026: businesses of 5-50 employees.
  targetAudience: 'Ontario businesses with 5 to 50 employees',
} as const;

// Where the quote form POSTs. Static export has no server, so this must point
// at an external handler (Formspree, a Cloudflare Worker, or the training
// provider back end once its API is available). Documented in README.md.
export const leadEndpoint = process.env.NEXT_PUBLIC_LEAD_ENDPOINT ?? '';

export function absoluteUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${site.origin}${clean === '/' ? '/' : clean}`;
}
