import Link from 'next/link';
import { courses } from '@/lib/courses';
import { buildMetadata } from '@/lib/seo';
import { Breadcrumbs } from '@/components/Chrome';
import { JsonLd } from '@/components/JsonLd';
import { graph, breadcrumbSchema } from '@/lib/schema';
import { AnswerBlock } from '@/components/AnswerBlock';

export const metadata = buildMetadata({
  title: 'Safety Training Courses in Ontario | Syon Safety',
  description:
    'Full catalogue of Syon Safety training: Working at Heights, WHMIS 2015, forklift operator, JHSC certification, first aid and CPR, confined space and fall protection.',
  path: '/courses/',
});

const trail = [
  { name: 'Home', path: '/' },
  { name: 'Courses', path: '/courses/' },
];

export default function CoursesPage() {
  return (
    <main className="wrap">
      <JsonLd json={graph(breadcrumbSchema(trail))} />
      <Breadcrumbs trail={trail} />

      <h1>Safety training courses</h1>
      <p className="hero__sub">
        Every course below is delivered on-site anywhere in our Ontario service
        area, or at a scheduled session.
      </p>

      <AnswerBlock
        question="Which safety courses does Syon Safety deliver?"
        answer="Syon Safety delivers Working at Heights, WHMIS 2015, forklift and lift truck operator training, JHSC certification Parts 1 and 2, Standard First Aid with CPR/AED, confined space entry, fall protection and elevated work platform training, and the mandatory worker and supervisor health and safety awareness programs."
      />

      <ul className="cards">
        {courses.map((course) => (
          <li className="card" key={course.slug}>
            <h3>
              <Link href={`/courses/${course.slug}/`}>{course.name}</Link>
            </h3>
            <p>{course.summary}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
