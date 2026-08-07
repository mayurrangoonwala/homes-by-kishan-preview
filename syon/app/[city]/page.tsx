import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cities, getCity } from '@/lib/cities';
import { courses } from '@/lib/courses';
import { buildMetadata } from '@/lib/seo';
import { Breadcrumbs } from '@/components/Chrome';
import { JsonLd } from '@/components/JsonLd';
import { AnswerBlock } from '@/components/AnswerBlock';
import { LeadForm } from '@/components/LeadForm';
import { graph, breadcrumbSchema } from '@/lib/schema';

type Params = { city: string };

export function generateStaticParams(): Params[] {
  return cities.map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) return {};

  return buildMetadata({
    title: `Safety Training in ${city.name}, Ontario | Syon Safety`,
    description: `On-site safety training for ${city.name} employers: Working at Heights, WHMIS, forklift, JHSC certification and first aid. Group quotes and flexible scheduling.`,
    path: `/${city.slug}/`,
  });
}

export default async function CityPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) notFound();

  const path = `/${city.slug}/`;
  const trail = [
    { name: 'Home', path: '/' },
    { name: city.name, path },
  ];

  const nearby = city.nearby
    .map((s) => getCity(s))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <main className="wrap">
      <JsonLd json={graph(breadcrumbSchema(trail))} />
      <Breadcrumbs trail={trail} />

      <h1>Safety training in {city.name}, Ontario</h1>
      <p className="hero__sub">
        Syon Safety delivers on-site workplace safety training to employers
        across {city.name} and the wider {city.region}, including{' '}
        {city.context}.
      </p>

      <AnswerBlock
        question={`Where can ${city.name} employers get workplace safety training?`}
        answer={`Syon Safety delivers accredited workplace safety training on-site at ${city.name} workplaces, covering Working at Heights, WHMIS 2015, forklift operation, JHSC certification, first aid and confined space entry. Training is delivered at your premises on your own equipment, and group scheduling is available for teams of 5 to 50.`}
      />

      <h2>Courses available in {city.name}</h2>
      <ul className="cards">
        {courses.map((course) => (
          <li className="card" key={course.slug}>
            <h3>
              <Link href={`/${city.slug}/${course.slug}/`}>
                {course.shortName} in {city.name}
              </Link>
            </h3>
            <p>{course.summary}</p>
          </li>
        ))}
      </ul>

      {nearby.length > 0 ? (
        <>
          <h2>Nearby service areas</h2>
          <ul className="linkrow">
            {nearby.map((n) => (
              <li key={n.slug}>
                <Link href={`/${n.slug}/`}>Safety training in {n.name}</Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <LeadForm city={city.slug} sourcePath={path} />
    </main>
  );
}
