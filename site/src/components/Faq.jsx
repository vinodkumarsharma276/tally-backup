import { useState } from 'react';
import { faqs } from '../content.js';
import { Reveal } from '../useReveal.jsx';

export default function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section className="section" id="faq">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">Questions</span>
          <h2>The things people ask before they trust us with their data.</h2>
        </Reveal>

        <Reveal className="faq-list">
          {faqs.map((item, i) => (
            <div key={item.q} className={`faq-item${open === i ? ' open' : ''}`}>
              <button
                className="faq-q"
                type="button"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? -1 : i)}
              >
                {item.q}
                <i>+</i>
              </button>
              <div className="faq-a">
                <p>{item.a}</p>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
