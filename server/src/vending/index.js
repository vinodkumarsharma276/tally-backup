'use strict';

const { DevProvider } = require('./DevProvider');
const { AwsStsProvider } = require('./AwsStsProvider');
const { B2Provider } = require('./B2Provider');
const { R2Provider } = require('./R2Provider');

/**
 * Vending provider factory. All providers return the same lease shape:
 *   { provider:'s3', bucket, region, endpoint, forcePathStyle, prefix, readOnly,
 *     credentials:{ accessKeyId, secretAccessKey, sessionToken?, expiration }, expiresAt }
 */
function createVendingProvider(config) {
  switch ((config.vendingProvider || 'dev').toLowerCase()) {
    case 'aws-sts':
      return new AwsStsProvider(config);
    case 'b2':
      return new B2Provider(config);
    case 'r2':
      return new R2Provider(config);
    case 'dev':
    default:
      return new DevProvider(config);
  }
}

module.exports = { createVendingProvider };
