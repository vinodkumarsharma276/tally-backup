#!/usr/bin/env node
/*
 * Interactive Google Drive authorisation for Backup Genie.
 *
 * Runs a one-shot OAuth "loopback" flow (Google's recommended method for
 * installed/desktop apps): it starts a temporary local web server on an
 * ephemeral 127.0.0.1 port, opens the consent screen in the default browser,
 * receives the authorisation code on the loopback redirect, exchanges it for a
 * refresh token, and stores that token in the OS credential vault (or the
 * configured tokenPath).
 *
 * The OAuth *client* is resolved by GoogleDriveService.loadCredentials():
 *   customer credentials secret -> customer credentials file -> bundled default
 * client. So a fresh install can connect without the user creating their own
 * Google Cloud project.
 *
 * The Google account you SIGN IN AS in the browser becomes the storage account.
 *
 * Usage:
 *   node tools/auth.js                               # config/config_test.json
 *   node tools/auth.js --config config/config.json
 */

'use strict';

const path = require('path');
const fs = require('fs-extra');
const http = require('http');
const url = require('url');
const { exec } = require('child_process');
const { google } = require('googleapis');

const GoogleDriveService = require('../src/GoogleDriveService');
const logger = require('../src/utils/logger');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function resolveConfigPath() {
  return path.resolve(
    getArg('--config') || process.env.TALLY_CONFIG || path.join('config', 'config_test.json')
  );
}

async function loadConfig() {
  const configPath = resolveConfigPath();
  if (!(await fs.pathExists(configPath))) throw new Error(`Config not found: ${configPath}`);
  const config = await fs.readJson(configPath);
  logger.info(`Auth config   : ${configPath}`);
  logger.info(
    String(config.googleDrive.tokenPath).startsWith('secret:')
      ? 'Token will be stored securely in the operating system credential vault'
      : `Token will be written to: ${path.resolve(config.googleDrive.tokenPath)}`
  );
  return config;
}

function openBrowser(target) {
  const command =
    process.platform === 'win32'
      ? `start "" "${target}"`
      : process.platform === 'darwin'
        ? `open "${target}"`
        : `xdg-open "${target}"`;
  exec(command, (error) => {
    if (error) logger.warn(`Could not open the browser automatically: ${error.message}`);
  });
}

function runLoopbackFlow(driveService, credentials) {
  const { client_secret, client_id } = credentials.web || credentials.installed;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try { server.close(); } catch (_) { /* ignore */ }
      fn(value);
    };

    const server = http.createServer(async (req, res) => {
      const query = url.parse(req.url, true).query;
      if (query.error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1 style="color:#c62828">Authorisation failed</h1><p>You can close this tab and try again.</p>');
        finish(reject, new Error(`Authorisation failed: ${query.error}`));
        return;
      }
      if (!query.code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Waiting for authorisation…</p>');
        return;
      }
      try {
        await driveService.saveToken(query.code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<div style="font-family:Segoe UI,Arial,sans-serif;text-align:center;margin-top:60px">' +
          '<h1 style="color:#2bbc7f">✓ Google account connected</h1>' +
          '<p>You can close this tab and return to Backup Genie.</p></div>'
        );
        logger.info('Google authorisation complete. Token saved.');
        finish(resolve);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1 style="color:#c62828">Token save failed</h1><p>${error.message}</p>`);
        finish(reject, error);
      }
    });

    server.on('error', (error) => finish(reject, error));

    // Ephemeral loopback port — Google allows any 127.0.0.1 port for desktop clients.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const redirectUri = `http://127.0.0.1:${port}`;
      driveService.auth = new google.auth.OAuth2(client_id, client_secret, redirectUri);
      const authUrl = driveService.auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // force a refresh_token even on re-auth
        scope: SCOPES,
      });
      logger.info('Opening the Google authorisation page in your browser…');
      logger.info(`If it does not open automatically, visit:\n${authUrl}`);
      openBrowser(authUrl);
    });

    // Safety timeout so the child process never hangs forever.
    setTimeout(() => finish(reject, new Error('Timed out waiting for Google authorisation (5 minutes).')), 5 * 60 * 1000).unref();
  });
}

async function main() {
  const config = await loadConfig();
  const driveService = new GoogleDriveService(config.googleDrive);
  const credentials = await driveService.loadCredentials();
  await runLoopbackFlow(driveService, credentials);
  logger.info('You can now run a backup.');
}

main().catch((error) => {
  logger.error('Auth failed:', error.message || error);
  logger.info(
    'If you see access_denied: the Google account must be allowed by the OAuth consent screen ' +
    '(published, or added as a Test User in Google Cloud Console).'
  );
  process.exit(1);
});
