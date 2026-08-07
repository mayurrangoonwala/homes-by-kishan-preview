/**
 * Fact tables are disproportionately valuable for GEO. A retrieval pipeline
 * parsing "6.5 hours" out of a labelled row is far more reliable than one
 * inferring it from prose, and tabular facts are what get lifted into AI
 * answers and featured snippets.
 *
 * Rows render as a description list rather than a <table> because the content
 * is key-value pairs, not tabular data, and dl degrades better on mobile.
 */
export function FactTable({
  rows,
  caption,
}: {
  rows: { label: string; value: string }[];
  caption?: string;
}) {
  return (
    <div className="facts">
      {caption ? <h3 className="facts__caption">{caption}</h3> : null}
      <dl className="facts__list">
        {rows.map((row) => (
          <div className="facts__row" key={row.label}>
            <dt className="facts__label">{row.label}</dt>
            <dd className="facts__value">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
