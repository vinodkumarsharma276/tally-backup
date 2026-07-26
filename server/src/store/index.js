'use strict';

const { MemoryStore } = require('./MemoryStore');

/**
 * Store factory. Selects the persistence backend from config.store and returns
 * an initialised store implementing the common interface.
 */
async function createStore(config) {
  let store;
  switch ((config.store || 'memory').toLowerCase()) {
    case 'sqlite': {
      const { SqliteStore } = require('./SqliteStore');
      store = new SqliteStore(config);
      break;
    }
    case 'postgres': {
      const { PostgresStore } = require('./PostgresStore');
      store = new PostgresStore(config);
      break;
    }
    case 'memory':
    default:
      store = new MemoryStore();
      break;
  }
  await store.init();
  return store;
}

module.exports = { createStore };
