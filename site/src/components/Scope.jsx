import { product, scope } from '../content.js';
import { Reveal } from '../useReveal.jsx';

export default function Scope() {
  return (
    <section className="section" id="scope">
      <div className="container">
        <Reveal className="section-head center">
          <span className="eyebrow">What you get</span>
          <h2>Exactly what the Starter edition covers.</h2>
          <p>
            Everything in the first list works in {product.version} today. The second list is not part of Starter, so
            you know where the edition ends before you get in touch.
          </p>
        </Reveal>

        <div className="scope-grid">
          <Reveal className="scope-card included">
            <span className="pill pill-live">In {product.version}</span>
            <ul>
              {scope.included.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Reveal>

          <Reveal className="scope-card excluded" delay={80}>
            <span className="pill pill-planned">Not in Starter</span>
            <ul>
              {scope.excluded.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
