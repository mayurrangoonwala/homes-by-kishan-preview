import type { Metadata } from 'next';
import './globals.css';
import { Header, Footer } from '@/components/Chrome';
import { JsonLd } from '@/components/JsonLd';
import { graph, organizationSchema, websiteSchema } from '@/lib/schema';
import { site, absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(site.origin),
  title: {
    default: `${site.name} — Workplace Safety Training in Ontario`,
    template: `%s`,
  },
  description: site.description,
  alternates: { canonical: absoluteUrl('/') },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-CA">
      <body>
        {/* Organization and WebSite nodes are site-wide, so they belong in the
            root layout rather than being repeated per page. Page-level nodes
            (Course, FAQPage, BreadcrumbList) reference the organization by
            @id from wherever they are rendered. */}
        <JsonLd json={graph(organizationSchema(), websiteSchema())} />
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
