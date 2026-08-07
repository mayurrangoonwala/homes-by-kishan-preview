import Link from 'next/link';
import { courses } from '@/lib/courses';
import { cities } from '@/lib/cities';
import { site } from '@/lib/site';
import { buildMetadata } from '@/lib/seo';
import { AnswerBlock } from '@/components/AnswerBlock';
import { LeadForm } from '@/components/LeadForm';

export const metadata = buildMetadata({
  title: 'Workplace Safety Training in Ontario | Syon Safety',
  description:
    'On-site safety training for Ontario businesses: Working at Heights, WHMIS, forklift, JHSC certification, first aid and confined space. Group quotes across the GTA.',
  path: '/',
});

export default function HomePage() {
  return (
    <main className="wrap">
      <section className="hero">
        <h1>Workplace safety training, delivered at your site</h1>
        <p className="hero__sub">
          Syon Safety trains teams across Ontario in the courses the law
          requires — Working at Heights, WHMIS, forklift, JHSC certification,
          first aid and confined space. We come to you, so your crew is not
          losing a day to travel.
        </p>
        <div className="hero__ctas">
          <Link className="btn btn--primary" href="/quote/">
            Get a group quote
          </Link>
          <a className="btn btn--ghost" href={`tel:${site.telephone}`}>
            Call {site.telephoneDisplay}
          </a>
        </div>
      </section>

      <AnswerBlock
        question="What safety training is mandatory in Ontario?"
        answer="Every Ontario workplace must provide health and safety awareness training to all workers and supervisors under O. Reg. 297/13. Beyond that baseline, the required training depends on the work: Working at Heights for construction workers using fall protection, WHMIS where hazardous products are present, competency training for lift truck operators, and JHSC certification at workplaces with 20 or more workers."
      />

      <h2>Courses</h2>
      <ul className="cards">
        {courses.map((course) => (
          <li className="card" key={course.slug}>
            <h3>
              <Link href={`/courses/${course.slug}/`}>{course.shortName}</Link>
            </h3>
            <p>{course.summary}</p>
          </li>
        ))}
      </ul>

      <h2>Where we train</h2>
      <p className="muted">
        We deliver on-site across the Greater Toronto Area and the Golden
        Horseshoe.
      </p>
      <ul className="linkrow">
        {cities.map((city) => (
          <li key={city.slug}>
            <Link href={`/${city.slug}/`}>{city.name}</Link>
          </li>
        ))}
      </ul>

      <div className="prose">
        <h2>Why employers use us</h2>
        <ul>
          <li>
            <strong>On-site delivery.</strong> We train at your workplace, on
            your equipment, so evaluations reflect the conditions your people
            actually work in.
          </li>
          <li>
            <strong>Group pricing.</strong> Built for teams of {site.targetAudience.replace('Ontario businesses with ', '')}.
          </li>
          <li>
            <strong>Records you can show an inspector.</strong> Training records
            issued per worker, in the form a Ministry inspector will ask for.
          </li>
        </ul>
      </div>

      <LeadForm sourcePath="/" />
    </main>
  );
}
