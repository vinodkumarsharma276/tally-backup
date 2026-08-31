import { product, stats } from '../content.js';
import { Reveal, useCountUp } from '../useReveal.jsx';

function Stat({ value, suffix, label, delay }) {
  const [ref, n, visible] = useCountUp(value);
  return (
    <div ref={ref} className={`stat reveal${visible ? ' visible' : ''}`} style={{ transitionDelay: `${delay}ms` }}>
      <b>
        {n}
        {suffix}
      </b>
      <span>{label}</span>
    </div>
  );
}

export default function Hero() {
  return (
    <>
      <section className="hero" id="top">
        <div className="container hero-grid">
          <Reveal className="hero-copy">
            <span className="version-chip">
              {product.version} · {product.versionLabel}
              <span className="dot" />
            </span>
            <h1>
              Any folder. Any day. <span className="accent">Back in one click.</span>
            </h1>
            <p className="lede">{product.subhead}</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#contact">
                Request early access
              </a>
              <a className="btn btn-secondary" href="#how">
                See how it works
              </a>
            </div>
            <p className="hero-note">
              Windows installer · Any folder, any file type · Your own Google Drive, S3, Azure, NAS or disk
            </p>
          </Reveal>

          <div className="hero-visual" aria-hidden="true">
            <div className="orb orb-a" />
            <div className="orb orb-b" />
            <div className="shield-stage">
              <div className="shield-ring ring-1" />
              <div className="shield-ring ring-2" />
              <div className="shield-ring ring-3" />
              <div className="orbit">
                <span className="orbit-chip">Google Drive</span>
                <span className="orbit-chip b">Amazon S3</span>
              </div>
              <div className="orbit reverse">
                <span className="orbit-chip c">NAS</span>
                <span className="orbit-chip d">Azure</span>
              </div>
              <div className="shield-core">🛡</div>
            </div>
          </div>
        </div>
      </section>

      <div className="trust-bar">
        <div className="container trust-inner">
          <span>🔒 Credentials in the OS vault</span>
          <span>♻️ Deduplicated uploads</span>
          <span>🕒 Point-in-time restore</span>
          <span>📧 Report after every run</span>
          <span>🖥 Runs as a Windows service</span>
        </div>
      </div>

      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="container stat-grid">
          {stats.map((s, i) => (
            <Stat key={s.label} {...s} delay={i * 90} />
          ))}
        </div>
      </section>
    </>
  );
}
