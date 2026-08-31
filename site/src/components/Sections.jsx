import { audiences, features, steps, useCases } from '../content.js';
import { Reveal } from '../useReveal.jsx';

export function UseCases() {
  return (
    <section className="section" style={{ paddingBottom: 0 }}>
      <div className="container">
        <Reveal className="section-head center">
          <span className="eyebrow">Anything you point it at</span>
          <h2>Backup Genie does not care what is inside the folder.</h2>
          <p>
            Accounting software like Tally is where most of our users start, because its data files are large, binary
            and change every day — exactly the case that breaks ordinary backup tools. The engine is general purpose.
          </p>
        </Reveal>
        <div className="usecase-strip">
          {useCases.map((u, i) => (
            <Reveal key={u.label} className="usecase" delay={(i % 4) * 70}>
              <span>{u.icon}</span>
              {u.label}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">What it does</span>
          <h2>Backup that behaves like insurance, not homework.</h2>
          <p>
            Everything below ships in the current release. Point Backup Genie at the folders that matter — whatever is
            in them — and it keeps protecting them quietly, incrementally, and with a restore path you can rehearse.
          </p>
        </Reveal>

        <div className="feature-grid">
          {features.map((f, i) => (
            <Reveal key={f.title} className="feature" delay={(i % 3) * 90}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="container">
        <Reveal className="section-head center">
          <span className="eyebrow">How it works</span>
          <h2>Four steps. Then it looks after itself.</h2>
          <p>No command line, no cloud console, and nothing for your staff to remember at the end of the day.</p>
        </Reveal>

        <div className="steps">
          <div className="step-line" />
          {steps.map((s, i) => (
            <Reveal key={s.n} className="step" delay={i * 110}>
              <b>{s.n}</b>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Audiences() {
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">Who it is for</span>
          <h2>Different work, same fear of losing it.</h2>
        </Reveal>
        <div className="audience-grid">
          {audiences.map((a, i) => (
            <Reveal key={a.title} className="audience" delay={(i % 3) * 90}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
