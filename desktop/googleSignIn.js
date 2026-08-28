'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { shell } = require('electron');
const { google } = require('googleapis');

const SCOPES = ['openid', 'email', 'profile'];

let pending = null;

/** Aborts a sign-in that the user abandoned in the browser. */
function cancelSignIn() {
  if (!pending) return false;
  pending.cancel();
  return true;
}

/**
 * Signs in with Google using the loopback flow and returns the ID token.
 * Identity only: this grants no access to Drive or any file.
 *
 * `credentials` must be the same OAuth client used elsewhere in the app, since
 * only that client has the loopback redirect registered in Google Cloud.
 */
function signInWithGoogle(credentials, { timeoutMs = 3 * 60 * 1000 } = {}) {
  const installed = (credentials && (credentials.installed || credentials.web)) || {};
  const { client_id, client_secret } = installed;
  if (!client_id) {
    throw new Error(
      'No Google OAuth client is available, so sign-in is unavailable. Backups are unaffected.'
    );
  }
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      pending = null;
      try { server.close(); } catch { /* already closing */ }
      fn(value);
    };

    const server = http.createServer(async (req, res) => {
      const query = new URL(req.url, 'http://127.0.0.1').searchParams;
      if (query.get('error')) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Sign-in cancelled</h1><p>You can close this tab.</p>');
        finish(reject, new Error('Sign-in was cancelled.'));
        return;
      }
      const code = query.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Waiting for sign-in…</p>');
        return;
      }
      if (query.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Sign-in failed</h1><p>Unexpected response. Please try again.</p>');
        finish(reject, new Error('Sign-in response did not match the request.'));
        return;
      }
      try {
        const { tokens } = await client.getToken(code);
        if (!tokens.id_token) throw new Error('Google did not return an identity token.');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<div style="font-family:Segoe UI,Arial,sans-serif;text-align:center;margin-top:60px">' +
            '<h1 style="color:#2bbc7f">\u2713 Signed in</h1>' +
            '<p>You can close this tab and return to Backup Genie.</p></div>'
        );
        finish(resolve, { idToken: tokens.id_token });
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Sign-in failed</h1><p>${error.message}</p>`);
        finish(reject, error);
      }
    });

    let client;
    server.on('error', (error) => finish(reject, error));
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
      shell.openExternal(
        client.generateAuthUrl({ scope: SCOPES, state, prompt: 'select_account' })
      );
    });

    pending = { cancel: () => finish(reject, new Error('Sign-in cancelled.')) };
    setTimeout(() => finish(reject, new Error('Sign-in timed out.')), timeoutMs).unref();
  });
}

module.exports = { signInWithGoogle, cancelSignIn };
