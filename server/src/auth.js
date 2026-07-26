'use strict';

const jwt = require('jsonwebtoken');

function issueToken(config, tenant) {
  return jwt.sign(
    { sub: tenant.id, planId: tenant.planId, status: tenant.status },
    config.jwtSecret,
    { expiresIn: config.tokenTtlSeconds, issuer: 've-tally-control-plane' }
  );
}

function verifyToken(config, token) {
  // Try the current signing secret, then the previous one (rotation window).
  const secrets = [config.jwtSecret, config.jwtSecretPrevious].filter(Boolean);
  let lastError = null;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret, { issuer: 've-tally-control-plane' });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('token verification failed');
}

// Express middleware: requires a valid Bearer token, attaches req.tenantId.
function requireAuth(config) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'missing bearer token' });
    try {
      const claims = verifyToken(config, match[1]);
      req.tenantId = claims.sub;
      req.claims = claims;
      next();
    } catch (error) {
      res.status(401).json({ error: 'invalid or expired token' });
    }
  };
}

module.exports = { issueToken, verifyToken, requireAuth };
