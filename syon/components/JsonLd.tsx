/**
 * Renders a JSON-LD graph. Next.js escapes `<` in text children, which would
 * corrupt the payload, so this uses dangerouslySetInnerHTML — the standard
 * approach for structured data. The input is built from our own typed data in
 * lib/schema.ts and never from user input, so there is no injection surface.
 */
export function JsonLd({ json }: { json: string }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
