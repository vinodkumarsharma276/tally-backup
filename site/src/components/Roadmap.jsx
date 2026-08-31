import { product, roadmap } from '../content.js';
import { Reveal } from '../useReveal.jsx';

export default function Roadmap() {
  return (
    <section className="section" id="roadmap">
      <div className="container">
        <Reveal className="section-head center">
          <span className="eyebrow">Roadmap</span>
          <h2>Shipping today, and what comes next.</h2>
          <p>
            We label every capability honestly. Anything marked <strong>In {product.version}</strong> is working in the
            current build; everything else is on the roadmap and is not sold as available yet.
          </p>
        </Reveal>

        <div className="roadmap-grid">
          {roadmap.map((item, i) => (
            <Reveal key={item.title} className={`road${item.status === 'live' ? ' live' : ''}`} delay={(i % 4) * 80}>
              <span className={`pill pill-${item.status}`}>{item.label}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </Reveal>
          ))}
        </div>

        <Reveal as="p" className="roadmap-note">
          Roadmap dates are indicative and priorities shift with customer feedback. Tell us which of these matters most
          to you in the form below — it genuinely changes the order.
        </Reveal>
      </div>
    </section>
  );
}
