import type { Faq } from '@/lib/courses';

/**
 * Rendered with native details/summary so the answers are present in the
 * static HTML and require no JavaScript. Content hidden behind a click is
 * still indexed, but content that only exists after a JS bundle executes is
 * unreliable for both crawlers and AI retrieval — so this stays server-rendered.
 */
export function Faqs({ faqs }: { faqs: Faq[] }) {
  if (faqs.length === 0) return null;
  return (
    <section className="faqs" aria-labelledby="faq-heading">
      <h2 id="faq-heading">Frequently asked questions</h2>
      {faqs.map((faq) => (
        <details className="faq" key={faq.question}>
          <summary className="faq__q">{faq.question}</summary>
          <p className="faq__a">{faq.answer}</p>
        </details>
      ))}
    </section>
  );
}
