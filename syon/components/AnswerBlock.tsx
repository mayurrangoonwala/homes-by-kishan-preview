/**
 * The GEO primitive.
 *
 * Generative engines extract and cite short, self-contained, factually framed
 * passages that answer the query directly. A page that buries its answer under
 * three paragraphs of positioning gets summarised without attribution; a page
 * that leads with a clean assertion gets quoted.
 *
 * Every page therefore opens with one of these: the question as a heading, the
 * answer in a single self-contained sentence that makes sense with no
 * surrounding context, then the supporting detail. The same text is mirrored
 * into FAQPage JSON-LD so the claim is available to both the crawler and the
 * retrieval pipeline.
 */
export function AnswerBlock({
  question,
  answer,
  children,
}: {
  question: string;
  answer: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="answer" aria-label="Summary answer">
      <h2 className="answer__q">{question}</h2>
      <p className="answer__a">{answer}</p>
      {children}
    </section>
  );
}
