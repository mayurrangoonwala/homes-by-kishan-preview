'use client';

import { useState } from 'react';
import { leadEndpoint, site } from '@/lib/site';

/**
 * The conversion point. Every landing page carries one, pre-filled with the
 * course and city it sits on.
 *
 * The hidden attribution fields are the part that matters commercially: they
 * close the loop between the SEO/GEO surface and the outbound lead programme.
 * Without `course`/`city`/`sourcePath` on the payload there is no way to tell
 * which of the ~100 landing pages actually produce enquiries, and the whole
 * matrix has to be judged on aggregate traffic, which is close to useless for
 * deciding what to build next.
 *
 * Static export means there is no server action available. The form POSTs
 * JSON to NEXT_PUBLIC_LEAD_ENDPOINT — set that to a form handler, or to the
 * training-provider back end once its API exists. With no endpoint configured
 * the form degrades to the phone and email CTAs rather than silently
 * pretending to submit.
 */
export function LeadForm({
  course,
  city,
  sourcePath,
}: {
  course?: string;
  city?: string;
  sourcePath: string;
}) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );

  const configured = leadEndpoint.length > 0;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;

    setStatus('sending');
    const data = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const res = await fetch(leadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          course: course ?? '',
          city: city ?? '',
          sourcePath,
          submittedAt: new Date().toISOString(),
        }),
      });
      setStatus(res.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <section className="lead lead--done" aria-live="polite">
        <h2>Request received</h2>
        <p>
          Thanks. We will come back to you with dates and a quote. If it is
          urgent, call{' '}
          <a href={`tel:${site.telephone}`}>{site.telephoneDisplay}</a>.
        </p>
      </section>
    );
  }

  return (
    <section className="lead" id="quote" aria-labelledby="lead-heading">
      <h2 id="lead-heading">Request a group quote</h2>
      <p className="lead__intro">
        Most of our clients train a whole team at once. Tell us the group size
        and we will come back with dates and a per-person price.
      </p>

      <form className="lead__form" onSubmit={onSubmit}>
        <div className="lead__grid">
          <label className="field">
            <span>Name</span>
            <input name="name" type="text" required autoComplete="name" />
          </label>
          <label className="field">
            <span>Company</span>
            <input name="company" type="text" required autoComplete="organization" />
          </label>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label className="field">
            <span>Phone</span>
            <input name="phone" type="tel" required autoComplete="tel" />
          </label>
          <label className="field">
            <span>How many people need training?</span>
            <select name="groupSize" required defaultValue="">
              <option value="" disabled>
                Select
              </option>
              <option value="1-4">1 to 4</option>
              <option value="5-15">5 to 15</option>
              <option value="16-30">16 to 30</option>
              <option value="31-50">31 to 50</option>
              <option value="50+">More than 50</option>
            </select>
          </label>
          <label className="field">
            <span>When do you need it?</span>
            <select name="timing" required defaultValue="">
              <option value="" disabled>
                Select
              </option>
              <option value="asap">As soon as possible</option>
              <option value="2-4-weeks">In the next 2 to 4 weeks</option>
              <option value="1-3-months">In 1 to 3 months</option>
              <option value="planning">Just planning ahead</option>
            </select>
          </label>
        </div>

        <label className="field field--wide">
          <span>Anything else we should know? (optional)</span>
          <textarea name="notes" rows={3} />
        </label>

        {/* Honeypot. Bots fill it, humans never see it. */}
        <div className="hp" aria-hidden="true">
          <label>
            Leave this field empty
            <input name="website" type="text" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        {configured ? (
          <button className="btn btn--primary" type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Request a quote'}
          </button>
        ) : (
          <p className="lead__unconfigured">
            <strong>Form endpoint not configured.</strong> Set{' '}
            <code>NEXT_PUBLIC_LEAD_ENDPOINT</code> to enable submissions. Until
            then, call{' '}
            <a href={`tel:${site.telephone}`}>{site.telephoneDisplay}</a> or
            email <a href={`mailto:${site.email}`}>{site.email}</a>.
          </p>
        )}

        {status === 'error' ? (
          <p className="lead__error" role="alert">
            Something went wrong sending that. Please call{' '}
            <a href={`tel:${site.telephone}`}>{site.telephoneDisplay}</a>.
          </p>
        ) : null}
      </form>
    </section>
  );
}
