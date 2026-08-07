import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cities, getCity } from '@/lib/cities';
import { courses, getCourse, deliveryLabel, deliveryVerb } from '@/lib/courses';
import { buildMetadata, cityCourseTitle } from '@/lib/seo';
import { Breadcrumbs } from '@/components/Chrome';
import { JsonLd } from '@/components/JsonLd';
import { AnswerBlock } from '@/components/AnswerBlock';
import { FactTable } from '@/components/FactTable';
import { Faqs } from '@/components/Faqs';
import { LeadForm } from '@/components/LeadForm';
import {
  graph,
  courseSchema,
  faqSchema,
  breadcrumbSchema,
  serviceSchema,
} from '@/lib/schema';
import { site } from '@/lib/site';

type Params = { city: string; course: string };

/**
 * The full matrix: every city crossed with every course.
 *
 * This is where the traffic is. "forklift training mississauga" is a buying
 * query typed by someone with a purchase order; "what is forklift training" is
 * research. The generic course pages capture the second, these capture the
 * first, and only these convert at a rate worth paying for.
 */
export function generateStaticParams(): Params[] {
  return cities.flatMap((city) =>
    courses.map((course) => ({ city: city.slug, course: course.slug })),
  );
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { city: citySlug, course: courseSlug } = await params;
  const city = getCity(citySlug);
  const course = getCourse(courseSlug);
  if (!city || !course) return {};

  // Kept under ~155 characters so it is not truncated in the SERP. Duration
  // and validity are deliberately left out: concatenating those two fields
  // produced awkward run-on descriptions across the matrix, and they are
  // already surfaced in the fact table and the Course markup.
  return buildMetadata({
    title: cityCourseTitle(course.shortName, city.name),
    description: `${course.shortName} training delivered on-site at your ${city.name} workplace. Group quotes for teams of 5 to 50, scheduled around your shifts.`,
    path: `/${city.slug}/${course.slug}/`,
  });
}

export default async function CityCoursePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { city: citySlug, course: courseSlug } = await params;
  const city = getCity(citySlug);
  const course = getCourse(courseSlug);
  if (!city || !course) notFound();

  const path = `/${city.slug}/${course.slug}/`;
  const trail = [
    { name: 'Home', path: '/' },
    { name: city.name, path: `/${city.slug}/` },
    { name: course.shortName, path },
  ];

  /**
   * Localised FAQ set. The first question is city-specific and the rest are
   * the course's own — which keeps each page's FAQPage markup distinct rather
   * than emitting twelve identical FAQ blocks across the matrix.
   */
  const localisedFaqs = [
    {
      question: `Do you deliver ${course.shortName} training in ${city.name}?`,
      answer: `Yes. Syon Safety ${deliveryVerb(course)} ${course.name} on-site at ${city.name} workplaces and throughout ${city.region}. Sessions run ${course.duration} and can be scheduled around your shift pattern.`,
    },
    ...course.faqs,
  ];

  const otherCourses = courses.filter((c) => c.slug !== course.slug).slice(0, 5);
  const nearby = city.nearby
    .map((s) => getCity(s))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <main className="wrap">
      <JsonLd
        json={graph(
          courseSchema(course, city),
          serviceSchema(course, city),
          faqSchema(localisedFaqs, path),
          breadcrumbSchema(trail),
        )}
      />
      <Breadcrumbs trail={trail} />

      <h1>
        {course.name} in {city.name}, Ontario
      </h1>
      <p className="hero__sub">
        On-site {course.shortName.toLowerCase()} training for {city.name}{' '}
        employers — delivered at your workplace, on your schedule.
      </p>

      <AnswerBlock
        question={`Where can I get ${course.shortName} training in ${city.name}?`}
        answer={`Syon Safety ${deliveryVerb(course)} ${course.name} on-site in ${city.name}, Ontario. The program runs ${course.duration}${
          course.validity.toLowerCase().startsWith('no ')
            ? ''
            : ` and certification is valid for ${course.validity.toLowerCase()}`
        }. ${course.summary}`}
      />

      <FactTable
        caption={`${course.shortName} in ${city.name} at a glance`}
        rows={[
          { label: 'Location', value: `On-site in ${city.name}, ${city.region}` },
          { label: 'Delivered by', value: deliveryLabel(course) },
          { label: 'Duration', value: course.duration },
          { label: 'Format', value: course.format },
          { label: 'Certificate validity', value: course.validity },
          { label: 'Regulation', value: course.regulation },
          { label: 'Who needs it', value: course.audience },
          { label: 'Group size', value: 'Teams of 5 to 50, single seats on request' },
        ]}
      />

      <div className="prose">
        <h2>
          {course.shortName} training for {city.name} employers
        </h2>
        <p>
          {city.name} employers come to us for this course largely from{' '}
          {city.context}. {course.description}
        </p>

        <h2>What your team will be able to do</h2>
        <ul>
          {course.outcomes.map((outcome) => (
            <li key={outcome}>{outcome}</li>
          ))}
        </ul>

        <h2>How on-site delivery works in {city.name}</h2>
        <p>
          We bring the training to your {city.name} premises. You supply a room
          and, where the course requires a practical evaluation, the equipment
          your team actually uses. That matters: an operator assessed on your
          own lift truck in your own aisles is a more meaningful competency
          record than one assessed on unfamiliar equipment elsewhere. Call{' '}
          <a href={`tel:${site.telephone}`}>{site.telephoneDisplay}</a> to check
          availability.
        </p>
      </div>

      <Faqs faqs={localisedFaqs} />

      <LeadForm course={course.slug} city={city.slug} sourcePath={path} />

      <h2>Other courses in {city.name}</h2>
      <ul className="linkrow">
        {otherCourses.map((c) => (
          <li key={c.slug}>
            <Link href={`/${city.slug}/${c.slug}/`}>
              {c.shortName} in {city.name}
            </Link>
          </li>
        ))}
      </ul>

      <h2>
        {course.shortName} training nearby
      </h2>
      <ul className="linkrow">
        {nearby.map((n) => (
          <li key={n.slug}>
            <Link href={`/${n.slug}/${course.slug}/`}>
              {course.shortName} in {n.name}
            </Link>
          </li>
        ))}
        <li>
          <Link href={`/courses/${course.slug}/`}>
            {course.shortName} across Ontario
          </Link>
        </li>
      </ul>
    </main>
  );
}
