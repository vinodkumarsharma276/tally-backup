import { useEffect, useState } from 'react';
import { company, nav } from '../content.js';
import { BrandLogo } from '../../../shared/Brand.jsx';

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`site-header${scrolled ? ' scrolled' : ''}`}>
      <div className="container header-inner">
        <a className="brand" href="#top">
          <BrandLogo />
          <div className="brand-text">
            <span>by {company.name}</span>
          </div>
        </a>

        <nav className={`site-nav${open ? ' open' : ''}`}>
          {nav.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-cta">
          <a className="btn btn-primary btn-sm" href="#download">
            Download
          </a>
          <button
            className="nav-toggle"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '✕' : '☰'}
          </button>
        </div>
      </div>
    </header>
  );
}
