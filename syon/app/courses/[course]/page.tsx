import Link from 'next/link';
import { notFound } from 'next/navigation';
import { courses, getCourse, deliveryLabel } from '@/lib/courses';
import { cities } from '@/lib/cities';
import { buildMetadata } from '@/lib/seo';
import { Breadcrumbs } from '@/components/Chrome';
import { JsonLd } from '@/components/JsonLd';
import { AnswerBlock } from '@/components/AnswerBlock';
import { FactTable } from '@/components/FactTable';
import { Faqs } from '@/components/Faqs';
import { LeadForm } from '@/components/LeadForm';
import { graph, courseSchema, faqSchema, breadcrumbSchema } from '@/lib/schema';

type Params = { course: string };

export function generateStaticParams(): Params[] {
  return courses.map((course) => ({ course: course.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { course: slug } = await params;
  const course = getCourse(slug);
  if (!course) return {};

  return buildMetadata({
    title: `${course.name} in Ontario | Syon Safety`,
    description: course.summary.slice(0, 155),
    path: `/courses/${course.slug}/`,
  });
}

export default async function CoursePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { course: slug } = await params;
  const course = getCourse(slug);
  if (!course) notFound();

  const path = `/courses/${course.slug}/`;
  const trail = [
    { name: 'Home', path: '/' },
    { name: 'Courses', path: '/courses/' },
    { name: course.shortName, path },
  ];

  return (
    <main className="wrap">
      <JsonLd
        json={graph(
          courseSchema(course),
          faqSchema(course.faqs, path),
          breadcrumbSchema(trail),
        )}
      />
      <Breadcrumbs trail={trail} />

      <h1>{course.name}</h1>

      <AnswerBlock
        question={`What is ${course.shortName} training?`}
        answer={course.summary}
      />

      <FactTable
        caption="Course at a glance"
        rows={[
          { label: 'Delivered by', value: deliveryLabel(course) },
          { label: 'Duration', value: course.duration },
          { label: 'Format', value: course.format },
          { label: 'Certificate validity', value: course.validity },
          { label: 'Regulation', value: course.regulation },
          {
            label: 'Legally required',
            value: course.mandatory
              ? 'Yes, for the audience below'
              : 'Recommended, not mandated',
          },
          { label: 'Who needs it', value: course.audience },
        ]}
      />

      <div className="prose">
        <h2>About this course</h2>
        <p>{course.description}</p>

        <h2>What your team will be able to do</h2>
        <ul>
          {course.outcomes.map((outcome) => (
            <li key={outcome}>{outcome}</li>
          ))}
        </ul>
      </div>

      <Faqs faqs={course.faqs} />

      <h2>{course.shortName} training by location</h2>
      <p className="muted">
        We deliver this course on-site in the following areas.
      </p>
      <ul className="linkrow">
        {cities.map((city) => (
          <li key={city.slug}>
            <Link href={`/${city.slug}/${course.slug}/`}>
              {course.shortName} in {city.name}
            </Link>
          </li>
        ))}
      </ul>

      <LeadForm course={course.slug} sourcePath={path} />
    </main>
  );
}
