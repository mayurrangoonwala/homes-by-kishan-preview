// Service-area cities. Each city crossed with each course generates one
// landing page, which is the programmatic local SEO surface.
//
// Deliberately limited to 12 cities Syon can genuinely service. Inflating this
// list is the standard way programmatic local SEO fails: pages for areas you
// do not serve read as doorway pages to Google, and are a spam-policy risk
// rather than a ranking opportunity. Expand only as coverage genuinely grows.

export type City = {
  slug: string;
  name: string;
  /** Region descriptor used in copy to keep pages from reading identically. */
  region: string;
  /** Local context sentence — the differentiator that stops these being duplicates. */
  context: string;
  /** Nearby cities, used to build the internal link graph. */
  nearby: string[];
};

export const cities: City[] = [
  {
    slug: 'toronto',
    name: 'Toronto',
    region: 'City of Toronto',
    context:
      'high-rise construction, property management and a dense manufacturing base in the west end',
    nearby: ['mississauga', 'vaughan', 'markham'],
  },
  {
    slug: 'mississauga',
    name: 'Mississauga',
    region: 'Peel Region',
    context:
      'warehousing and logistics clustered around Pearson Airport, where lift truck and WHMIS demand is heaviest',
    nearby: ['brampton', 'oakville', 'toronto'],
  },
  {
    slug: 'brampton',
    name: 'Brampton',
    region: 'Peel Region',
    context: 'distribution centres, food processing and light manufacturing',
    nearby: ['mississauga', 'vaughan', 'milton'],
  },
  {
    slug: 'hamilton',
    name: 'Hamilton',
    region: 'Golden Horseshoe',
    context: 'steel, heavy industry and a growing industrial conversion sector',
    nearby: ['burlington', 'oakville', 'milton'],
  },
  {
    slug: 'vaughan',
    name: 'Vaughan',
    region: 'York Region',
    context: 'construction, building supply and concrete operations',
    nearby: ['toronto', 'richmond-hill', 'brampton'],
  },
  {
    slug: 'markham',
    name: 'Markham',
    region: 'York Region',
    context: 'technology, light industrial and facilities maintenance employers',
    nearby: ['richmond-hill', 'toronto', 'oshawa'],
  },
  {
    slug: 'oakville',
    name: 'Oakville',
    region: 'Halton Region',
    context: 'automotive supply chain and advanced manufacturing',
    nearby: ['burlington', 'milton', 'mississauga'],
  },
  {
    slug: 'burlington',
    name: 'Burlington',
    region: 'Halton Region',
    context: 'manufacturing and distribution along the QEW corridor',
    nearby: ['oakville', 'hamilton', 'milton'],
  },
  {
    slug: 'milton',
    name: 'Milton',
    region: 'Halton Region',
    context: 'rapidly expanding distribution and logistics parks',
    nearby: ['oakville', 'burlington', 'brampton'],
  },
  {
    slug: 'richmond-hill',
    name: 'Richmond Hill',
    region: 'York Region',
    context: 'commercial construction and building services',
    nearby: ['markham', 'vaughan', 'toronto'],
  },
  {
    slug: 'oshawa',
    name: 'Oshawa',
    region: 'Durham Region',
    context: 'automotive assembly, skilled trades and energy sector contractors',
    nearby: ['markham', 'toronto', 'richmond-hill'],
  },
  {
    slug: 'kitchener',
    name: 'Kitchener',
    region: 'Waterloo Region',
    context: 'advanced manufacturing and a large skilled-trades employer base',
    nearby: ['milton', 'hamilton', 'burlington'],
  },
];

export const citySlugs = cities.map((c) => c.slug);

export function getCity(slug: string): City | undefined {
  return cities.find((c) => c.slug === slug);
}

/**
 * Static route segments that live at the same level as /[city]. Next.js gives
 * static segments priority over dynamic ones, so these would resolve correctly
 * anyway — but a city slug colliding with one would silently never render, so
 * the build asserts against it instead of failing quietly.
 */
export const reservedSlugs = ['courses', 'quote', 'about', 'contact'] as const;

const collision = citySlugs.find((s) =>
  (reservedSlugs as readonly string[]).includes(s),
);
if (collision) {
  throw new Error(
    `City slug "${collision}" collides with a reserved static route. Rename the city slug in lib/cities.ts.`,
  );
}
