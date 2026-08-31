import { useState } from 'react';
import { company, contactEndpoint, product } from '../content.js';
import { Reveal } from '../useReveal.jsx';

const EMPTY = { name: '', email: '', company: '', phone: '', topic: 'Early access', message: '', website: '' };

const TOPICS = ['Early access', 'Pricing & plans', 'Managed cloud storage', 'Partnership / reseller', 'Support', 'Something else'];

function mailtoFallback(form) {
  const body = [
    `Name: ${form.name}`,
    `Email: ${form.email}`,
    `Company: ${form.company}`,
    `Phone: ${form.phone}`,
    `Topic: ${form.topic}`,
    '',
    form.message,
  ].join('\n');
  return `mailto:${company.email}?subject=${encodeURIComponent(`${product.name} enquiry — ${form.topic}`)}&body=${encodeURIComponent(body)}`;
}

export default function Contact() {
  const [form, setForm] = useState(EMPTY);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState({ status: 'idle', message: '' });

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    if (!consent) {
      setState({ status: 'err', message: 'Please tick the consent box so we know we may reply to you.' });
      return;
    }
    // No endpoint configured yet: hand the enquiry to the visitor's mail client
    // rather than silently dropping it.
    if (!contactEndpoint) {
      window.location.href = mailtoFallback(form);
      setState({ status: 'ok', message: `Opening your email app addressed to ${company.email}.` });
      return;
    }

    setState({ status: 'sending', message: '' });
    try {
      const response = await fetch(contactEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, product: product.name, source: 'website' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'We could not send that just now.');
      setForm(EMPTY);
      setConsent(false);
      setState({ status: 'ok', message: 'Thank you — your message is with us. We usually reply within one business day.' });
    } catch (error) {
      setState({
        status: 'err',
        message: `${error.message} You can also email us directly at ${company.email}.`,
      });
    }
  }

  const sending = state.status === 'sending';

  return (
    <section className="section" id="contact">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">Talk to us</span>
          <h2>Tell us about your setup.</h2>
          <p>
            How many machines, which folders, how big the data, where you would like the copies to live — we will come
            back with a build, a walkthrough and an honest answer on whether we are a fit.
          </p>
        </Reveal>

        <div className="contact-grid">
          <Reveal className="contact-panel">
            <form onSubmit={onSubmit} noValidate={false}>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="c-name">Your name</label>
                  <input id="c-name" required maxLength={120} value={form.name} onChange={set('name')} autoComplete="name" />
                </div>
                <div className="field">
                  <label htmlFor="c-email">Work email</label>
                  <input id="c-email" type="email" required maxLength={200} value={form.email} onChange={set('email')} autoComplete="email" />
                </div>
              </div>

              <div className="form-row">
                <div className="field">
                  <label htmlFor="c-company">Business name</label>
                  <input id="c-company" maxLength={160} value={form.company} onChange={set('company')} autoComplete="organization" />
                </div>
                <div className="field">
                  <label htmlFor="c-phone">Phone (optional)</label>
                  <input id="c-phone" maxLength={40} value={form.phone} onChange={set('phone')} autoComplete="tel" />
                </div>
              </div>

              <div className="field">
                <label htmlFor="c-topic">What is this about?</label>
                <select id="c-topic" value={form.topic} onChange={set('topic')}>
                  {TOPICS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="c-message">Your message</label>
                <textarea
                  id="c-message"
                  required
                  maxLength={4000}
                  value={form.message}
                  onChange={set('message')}
                  placeholder="e.g. 4 Windows machines, about 6 GB across our accounts and project folders, we want nightly backups to our own Google Drive."
                />
              </div>

              {/* Bots fill hidden fields; humans never see this one. */}
              <div className="hp-field" aria-hidden="true">
                <label htmlFor="c-website">Leave this empty</label>
                <input id="c-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
              </div>

              <label className="form-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I agree that {company.name} may store these details and contact me about {product.name}. We never sell
                  or share them.
                </span>
              </label>

              <button className="btn btn-primary" type="submit" disabled={sending}>
                {sending ? 'Sending…' : 'Send enquiry'}
              </button>

              {state.message ? (
                <p className={`form-status ${state.status === 'err' ? 'err' : 'ok'}`} role="status">
                  {state.message}
                </p>
              ) : null}
            </form>
          </Reveal>

          <div className="contact-info">
            <Reveal className="info-card" delay={60}>
              <h3>Registered office</h3>
              <address>
                <strong>{company.legalName}</strong>
                <br />
                {company.address.lines.map((line) => (
                  <span key={line}>
                    {line}
                    <br />
                  </span>
                ))}
                {company.address.country}
                {company.gstin ? (
                  <>
                    <br />
                    GSTIN: {company.gstin}
                  </>
                ) : null}
              </address>
            </Reveal>

            <Reveal className="info-card" delay={120}>
              <h3>Email us</h3>
              <p>
                Sales &amp; general: <a href={`mailto:${company.email}`}>{company.email}</a>
                <br />
                Support: <a href={`mailto:${company.support}`}>{company.support}</a>
                {company.phone ? (
                  <>
                    <br />
                    Phone: <a href={`tel:${company.phone.replace(/\s+/g, '')}`}>{company.phone}</a>
                  </>
                ) : null}
              </p>
            </Reveal>

            <Reveal className="info-card" delay={180}>
              <h3>Support hours</h3>
              <p>
                Monday to Saturday, 10:00 – 19:00 IST. Backup and restore incidents are triaged first, on any day.
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
