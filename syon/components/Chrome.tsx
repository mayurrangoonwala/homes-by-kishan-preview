import Link from 'next/link';
import { site } from '@/lib/site';
import { courses } from '@/lib/courses';
import { cities } from '@/lib/cities';

export function Header() {
  return (
    <header className="hdr">
      <div className="hdr__inner wrap">
        <Link className="hdr__brand" href="/">
          {site.shortName}
        </Link>
        <nav className="hdr__nav" aria-label="Primary">
          <Link href="/courses/">Courses</Link>
          <a className="hdr__tel" href={`tel:${site.telephone}`}>
            {site.telephoneDisplay}
          </a>
          <Link className="btn btn--primary btn--sm" href="/quote/">
            Get a quote
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Breadcrumbs({
  trail,
}: {
  trail: { name: string; path: string }[];
}) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((item, i) => (
          <li key={item.path}>
            {i === trail.length - 1 ? (
              <span aria-current="page">{item.name}</span>
            ) : (
              <Link href={item.path}>{item.name}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The footer carries the full course and city index on every page.
 *
 * This is the internal link graph doing the work: a ~100-page programmatic
 * matrix is worthless if the pages are orphaned, because crawl discovery and
 * link equity both stall. Linking every course and city from every page keeps
 * the whole surface within one hop, which at this scale is the right trade —
 * it would not be at 10,000 pages, where a hub-and-spoke structure is needed
 * instead.
 */
export function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr__cols">
          <div>
            <h2 className="ftr__h">Training courses</h2>
            <ul className="ftr__list">
              {courses.map((c) => (
                <li key={c.slug}>
                  <Link href={`/courses/${c.slug}/`}>{c.shortName}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="ftr__h">Service areas</h2>
            <ul className="ftr__list">
              {cities.map((c) => (
                <li key={c.slug}>
                  <Link href={`/${c.slug}/`}>{c.name}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="ftr__h">Contact</h2>
            <ul className="ftr__list">
              <li>
                <a href={`tel:${site.telephone}`}>{site.telephoneDisplay}</a>
              </li>
              <li>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </li>
              <li>
                <Link href="/quote/">Request a quote</Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="ftr__legal">
          {site.legalName} — workplace safety training across {site.region}.
        </p>
      </div>
    </footer>
  );
}
