'use strict';

const crypto = require('crypto');

// License keys are stored as salted scrypt hashes, verified in constant time.
function hashLicense(licenseKey, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(licenseKey), salt, 32).toString('hex');
  return { salt, hash: derived };
}

function verifyLicense(licenseKey, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const derived = crypto.scryptSync(String(licenseKey), salt, 32);
  const expected = Buffer.from(expectedHash, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashLicense, verifyLicense };
