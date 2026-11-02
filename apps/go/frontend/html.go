package main

const sharedStyle = `<style>
  :root { --ink:#0b1020; --accent:#ff6a13; --accent2:#1f6feb; --line:#e5e7eb; --muted:#5b6472; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
         background:linear-gradient(135deg,#0b1020,#13224a); color:var(--ink); min-height:100vh;
         display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.35); width:100%; max-width:460px; overflow:hidden; }
  .head { background:linear-gradient(135deg,var(--accent),#ff8f4d); color:#fff; padding:28px 28px 22px; }
  .head h1 { margin:0; font-size:22px; letter-spacing:.2px; }
  .head p { margin:6px 0 0; opacity:.95; font-size:13px; }
</style>`

// successHTML is the result page for a confirmed registration. {{name}},
// {{email}} and {{registrationId}} are substituted at render time.
const successHTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registered · Example Conf</title>
` + sharedStyle + `</head>
<body><div class="card">
  <div class="head" style="background:linear-gradient(135deg,#16a34a,#22c55e)">
    <h1>You're registered 🎉</h1><p>Example Conf</p></div>
  <div style="padding:24px 28px 28px;font-size:14px;line-height:1.6">
    <p>Thanks, <strong>{{name}}</strong>! A confirmation is on its way to
       <strong>{{email}}</strong>.</p>
    <p style="color:#5b6472">Registration id: <code>{{registrationId}}</code></p>
    <p><a href="/">← Register someone else</a></p>
  </div></div></body></html>`

// errorHTML is the result page for a failed registration. {{error}} is
// substituted at render time.
const errorHTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registration failed · Example Conf</title>
` + sharedStyle + `</head>
<body><div class="card">
  <div class="head" style="background:linear-gradient(135deg,#dc2626,#ef4444)">
    <h1>Registration failed</h1><p>Example Conf</p></div>
  <div style="padding:24px 28px 28px;font-size:14px;line-height:1.6">
    <p>Something went wrong processing your registration.</p>
    <p style="color:#5b6472">Error: <code>{{error}}</code></p>
    <p>This is expected in the workshop — now go find this trace in Dash0 and
       see which span failed.</p>
    <p><a href="/">← Try again</a></p>
  </div></div></body></html>`
