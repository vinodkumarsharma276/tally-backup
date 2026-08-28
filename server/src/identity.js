'use strict';

const jwt = require('jsonwebtoken');

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Verifies a Google ID token.
 *
 * Google's tokeninfo endpoint checks the signature, expiry and issuer for us,
 * so the control plane does not have to track Google's rotating public keys.
 * The audience is checked here because tokeninfo will happily describe a token
 * that was minted for a different application.
 */
async function verifyGoogleIdToken(idToken, { clientIds = [], fetchImpl = fetch } = {}) {
  if (!idToken) throw new Error('idToken is required');

  const response = await fetchImpl(`${TOKENINFO_URL}${encodeURIComponent(idToken)}`);
  if (!response.ok) throw new Error('google rejected the sign-in token');
  const claims = await response.json();

  if (!ISSUERS.has(claims.iss)) throw new Error('unexpected token issuer');
  if (clientIds.length && !clientIds.includes(claims.aud)) {
    throw new Error('sign-in token was issued for a different application');
  }
  if (claims.email_verified !== 'true' && claims.email_verified !== true) {
    throw new Error('google account email is not verified');
  }
  if (Number(claims.exp) * 1000 < Date.now()) throw new Error('sign-in token has expired');

  return {
    subject: claims.sub,
    email: String(claims.email || '').toLowerCase(),
    name: claims.name || claims.email || null,
    picture: claims.picture || null,
  };
}

/** Sessions are long-lived so a machine can stay signed in while offline. */
function issueUserToken(config, user) {
  return jwt.sign(
    { sub: user.id, email: user.email, kind: 'user' },
    config.jwtSecret,
    { expiresIn: config.userTokenTtlSeconds || '30d', issuer: 've-tally-control-plane' }
  );
}

module.exports = { verifyGoogleIdToken, issueUserToken };
