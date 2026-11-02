'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// The registration page and its script live in the shared repo-root web/
// folder (WEB_DIR, set by run.sh). Both are re-read on every request, so edits
// to web/index.html or web/registration.js show up on the next page reload.
const WEB_DIR = process.env.WEB_DIR || path.resolve(__dirname, '../../../web');

// Settings the browser needs for the Dash0 Web SDK, as a JSON literal that is
// safe to embed in a <script> block (no raw "<", so no "</script>" breakout).
function browserConfig() {
  return JSON.stringify({
    serviceName: process.env.DASH0_WEB_SERVICE_NAME || 'registration-website-node',
    endpointUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '',
    authToken: process.env.DASH0_WEB_AUTH_TOKEN || '',
    dataset: process.env.DASH0_DATASET || 'default',
  }).replace(/</g, '\\u003c');
}

function registrationPage() {
  return fs
    .readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
    .replace('__DASH0_BROWSER_CONFIG__', () => browserConfig());
}

// Minimal HTML escaping for values substituted into the result pages.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SHARED_STYLE = `<style>
  :root { --ink:#0b1020; --accent:#ff6a13; --accent2:#1f6feb; --line:#e5e7eb; --muted:#5b6472; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
         background:linear-gradient(135deg,#0b1020,#13224a); color:var(--ink); min-height:100vh;
         display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.35); width:100%; max-width:460px; overflow:hidden; }
  .head { background:linear-gradient(135deg,var(--accent),#ff8f4d); color:#fff; padding:28px 28px 22px; }
  .head h1 { margin:0; font-size:22px; letter-spacing:.2px; }
  .head p { margin:6px 0 0; opacity:.95; font-size:13px; }
</style>`;

function successPage({ name, email, registrationId }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registered · Example Conf</title>
${SHARED_STYLE}</head>
<body><div class="card">
  <div class="head" style="background:linear-gradient(135deg,#16a34a,#22c55e)">
    <h1>You're registered 🎉</h1><p>Example Conf</p></div>
  <div style="padding:24px 28px 28px;font-size:14px;line-height:1.6">
    <p>Thanks, <strong>${esc(name)}</strong>! A confirmation is on its way to
       <strong>${esc(email)}</strong>.</p>
    <p style="color:#5b6472">Registration id: <code>${esc(registrationId)}</code></p>
    <p><a href="/">← Register someone else</a></p>
  </div></div></body></html>`;
}

function errorPage({ error, errorType }) {
  const typeLine = errorType
    ? `\n    <p style="color:#5b6472">Type: <code>${esc(errorType)}</code></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registration failed · Example Conf</title>
${SHARED_STYLE}</head>
<body><div class="card">
  <div class="head" style="background:linear-gradient(135deg,#dc2626,#ef4444)">
    <h1>Registration failed</h1><p>Example Conf</p></div>
  <div style="padding:24px 28px 28px;font-size:14px;line-height:1.6">
    <p>Something went wrong processing your registration.</p>
    <p style="color:#5b6472">Error: <code>${esc(error)}</code></p>${typeLine}
    <p>This is expected in the workshop — now go find this trace in Dash0 and
       see which span failed.</p>
    <p><a href="/">← Try again</a></p>
  </div></div></body></html>`;
}

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store').type('html').send(registrationPage());
});

app.get('/static/registration.js', (_req, res) => {
  res
    .set('Cache-Control', 'no-store')
    .type('application/javascript')
    .send(fs.readFileSync(path.join(WEB_DIR, 'registration.js'), 'utf8'));
});

// JSON endpoint the page's fetch() calls. The browser sends a `traceparent`
// header (same-origin, added by the Dash0 Web SDK); the express
// instrumentation continues that trace, and the undici instrumentation passes
// it on to the backend, so browser -> web -> api is one trace.
app.post('/api/registrations', async (req, res) => {
  const { name, email, company, ticketType } = req.body || {};
  try {
    const resp = await fetch(BACKEND_URL + '/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, company, ticketType }),
    });
    const data = await resp.json().catch(() => ({}));
    // Mirror the backend's status (200/400/422/503) and body.
    res.status(resp.status).json(data);
  } catch (err) {
    // 502 only when the backend is actually unreachable.
    res.status(502).json({
      status: 'error',
      errorType: 'backend_unreachable',
      message: `backend unreachable: ${err.message}`,
    });
  }
});

app.post('/register', async (req, res) => {
  const { name, email, company, ticketType } = req.body || {};

  try {
    // The undici auto-instrumentation injects `traceparent` into this fetch,
    // so the backend span joins the same distributed trace.
    const resp = await fetch(BACKEND_URL + '/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, company, ticketType }),
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data.status === 'confirmed') {
      res.status(200).type('html').send(
        successPage({ name, email, registrationId: data.registrationId })
      );
    } else {
      // Mirror the backend's status class (400/422/503) so the client/outage
      // distinction stays visible; do not flatten it to a single code.
      res.status(resp.status).type('html').send(
        errorPage({
          error: data.message || `backend returned ${resp.status}`,
          errorType: data.errorType,
        })
      );
    }
  } catch (err) {
    // 502 only when the backend is actually unreachable.
    res.status(502).type('html').send(
      errorPage({ error: `backend unreachable: ${err.message}` })
    );
  }
});

app.listen(PORT, () => {
  console.log(`[registration-web] listening on :${PORT} → backend ${BACKEND_URL}`);
});
