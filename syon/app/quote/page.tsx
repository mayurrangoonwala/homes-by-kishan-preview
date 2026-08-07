import { buildMetadata } from '@/lib/seo';
import { Breadcrumbs } from '@/components/Chrome';
import { JsonLd } from '@/components/JsonLd';
import { graph, breadcrumbSchema } from '@/lib/schema';
import { LeadForm } from '@/components/LeadForm';
import { site } from '@/lib/site';

export const metadata = buildMetadata({
  title: 'Request a Safety Training Quote | Syon Safety',
  description:
    'Tell us the course, group size and location and we will come back with dates and a per-person price for on-site safety training anywhere in Ontario.',
  path: '/quote/',
});

const trail = [
  { name: 'Home', path: '/' },
  { name: 'Get a quote', path: '/quote/' },
];

export default function QuotePage() {
  return (
    <main className="wrap">
      <JsonLd json={graph(breadcrumbSchema(trail))} />
      <Breadcrumbs trail={trail} />

      <h1>Request a quote</h1>
      <p className="hero__sub">
        Tell us what you need and we will come back with dates and a
        per-person price. If it is urgent, calling is faster:{' '}
        <a href={`tel:${site.telephone}`}>{site.telephoneDisplay}</a>.
      </p>

      <LeadForm sourcePath="/quote/" />
    </main>
  );
}
