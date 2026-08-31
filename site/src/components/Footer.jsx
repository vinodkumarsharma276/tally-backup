import { company, nav, product } from '../content.js';
import { Reveal } from '../useReveal.jsx';

export default function Footer() {
  return (
    <>
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="container">
          <Reveal className="cta-band">
            <div>
              <h2>Find out what a bad day costs you.</h2>
              <p>Then spend a few minutes making sure it never happens. Early access builds are free to evaluate.</p>
            </div>            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href="#contact">
                Request early access
              </a>
              <a className="btn btn-ghost" href={product.docsUrl} target="_blank" rel="noreferrer noopener">
                Read the docs
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-about">
              <a className="brand" href="#top">
                <div className="brand-mark">BG</div>
                <div className="brand-text">
                  <strong>{product.name}</strong>
                  <span>by {company.name}</span>
                </div>
              </a>
              <p>{company.tagline}</p>
            </div>

            <div>
              <h4>Product</h4>
              <div className="footer-links">
                {nav.map((item) => (
                  <a key={item.href} href={item.href}>
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4>Resources</h4>
              <div className="footer-links">
                <a href={product.docsUrl} target="_blank" rel="noreferrer noopener">
                  Documentation
                </a>
                <a href={product.repoUrl} target="_blank" rel="noreferrer noopener">
                  Release notes
                </a>
                <a href="#roadmap">Roadmap</a>
                <a href="#faq">FAQ</a>
              </div>
            </div>

            <div>
              <h4>Company</h4>
              <div className="footer-links">
                <a href={company.website} target="_blank" rel="noreferrer noopener">
                  {company.name}
                </a>
                <a href={`mailto:${company.email}`}>{company.email}</a>
                <a href={`mailto:${company.support}`}>Support</a>
                <a href="#contact">Contact</a>
              </div>
            </div>
          </div>

          <div className="footer-bottom">
            <span>
              © {new Date().getFullYear()} {company.legalName}. All rights reserved.
            </span>
            <span>
              {product.name} {product.version} — {product.versionLabel}. All product names and trademarks mentioned are
              the property of their respective owners; {product.name} is an independent product and is not affiliated
              with or endorsed by them.
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
