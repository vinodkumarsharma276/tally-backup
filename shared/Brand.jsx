import React from 'react';
import mark from '../assets/branding/mark.png';
import darkMark from '../assets/branding/mark-dark.png';
import darkLogo from '../assets/branding/logo-dark.png';
import lightLogo from '../assets/branding/logo-light.png';
import './brand.css';

export function BrandMark({ large = false }) {
  return <span className={`genie-mark${large ? ' genie-mark-large' : ''}`} aria-hidden="true">
    <img className="genie-on-dark" src={mark} alt="" width="512" height="512" />
    <img className="genie-on-light" src={darkMark} alt="" width="128" height="128" />
  </span>;
}

export function BrandLogo() {
  return <span className="genie-logo" role="img" aria-label="Backup Genie">
    <img className="genie-on-dark" src={darkLogo} alt="" width="360" height="116" />
    <img className="genie-on-light" src={lightLogo} alt="" width="360" height="116" />
  </span>;
}