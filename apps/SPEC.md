# Shared contract for all registration apps

Every language implements the **same** two-service app so the workshop feels
identical no matter which stack an attendee picks. Read this file before
building or changing any app.

## Topology

```
browser (Dash0 Web SDK + session replay)
   │  fetch POST /api/registrations  (traceparent, same-origin)
   ▼
frontend (web, serves the page) ──HTTP──> backend (API, does the work)
   │                                          │
   └────────────── OpenTelemetry ─────────────┘
                   (OTLP → Dash0)
browser ── web events, spans, replay chunks ──> Dash0 (OTLP/HTTP JSON, browser token)
```

Both services export traces to Dash0 over OTLP/HTTP. The browser exports its
own telemetry straight to Dash0 with the Dash0 Web SDK. Context MUST propagate
from the browser's `fetch` into the frontend and from the frontend into the
backend, so one click on **Register** shows up as **one end-to-end trace
spanning the browser and both services** in Dash0, and the session replay of
that click links to it.

## Ports (fixed, so all four languages can run at once)

| Language | Frontend | Backend |
|----------|----------|---------|
| Node.js  | 3000     | 3001    |
| Python   | 3100     | 3101    |
| Go       | 3200     | 3201    |
| Java     | 3300     | 3301    |

## OpenTelemetry service names

| Language | Browser `DASH0_WEB_SERVICE_NAME` | Frontend `OTEL_SERVICE_NAME` | Backend `OTEL_SERVICE_NAME` |
|----------|----------------------------------|------------------------------|-----------------------------|
| Node.js  | `registration-website-node`      | `registration-web-node`      | `registration-api-node`     |
| Python   | `registration-website-python`    | `registration-web-python`    | `registration-api-python`   |
| Go       | `registration-website-go`        | `registration-web-go`        | `registration-api-go`       |
| Java     | `registration-website-java`      | `registration-web-java`      | `registration-api-java`     |

## Environment variables

The root `.env` (copied from `.env.example`) holds the shared, vendor-neutral
OTLP settings plus the Dash0 token/dataset as plain values:

| Variable | Purpose |
|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Dash0 ingress base URL, e.g. `https://ingress.eu-west-1.aws.dash0.com` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Always `http/protobuf` |
| `DASH0_AUTH_TOKEN`            | The `auth_...` token |
| `DASH0_DATASET`              | Target dataset, e.g. `default` |
| `DASH0_WEB_AUTH_TOKEN`       | Token the **browser** uses. It is embedded in the page, so it must be a separate, ingest-only token. Falls back to `DASH0_AUTH_TOKEN` with a warning (see `scripts/web-config.sh`). |

Each service additionally sets, in its own `run.sh`:

| Variable | Purpose |
|----------|---------|
| `OTEL_SERVICE_NAME` | Per-service name from the table above |
| `PORT`              | Port the service listens on (defaults per table) |
| `BACKEND_URL`       | Frontend only: base URL of the backend, default `http://localhost:<backend-port>` |
| `DASH0_WEB_SERVICE_NAME` | Frontend only: the browser's service name from the table above |
| `WEB_DIR`           | Frontend only: absolute path of the repo-root `web/` folder, set by `scripts/web-config.sh` |

### How auth headers reach the exporter (IMPORTANT — do it this way)

Do **not** rely on sourcing `Authorization=Bearer <token>` through
`OTEL_EXPORTER_OTLP_HEADERS` in the shell — the space breaks `source`, and SDKs
disagree on URL-decoding that variable. Instead:

- **Node / Python / Go**: read `DASH0_AUTH_TOKEN` and `DASH0_DATASET` from the
  environment and set the OTLP exporter headers **in code**:
  `Authorization: Bearer <token>` and `Dash0-Dataset: <dataset>`.
- **Java** (uses the javaagent, no app code): in `run.sh`, build and export
  `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${DASH0_AUTH_TOKEN},Dash0-Dataset=${DASH0_DATASET}"`.

### Every service has a `run.sh`

It `cd`s to its own dir, sources the root `.env`, exports its `OTEL_SERVICE_NAME`
/ `PORT` (/ `BACKEND_URL`), then launches. Frontends also source
`scripts/web-config.sh` (after `load-env.sh`) and export `DASH0_WEB_SERVICE_NAME`. Pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a; source ../../../.env; set +a      # repo-root/.env (service is at apps/<lang>/<service>)
export OTEL_SERVICE_NAME=registration-api-<lang>
export PORT=<port>
exec <launch command>
```

## Backend API contract

`POST /api/register` — request body JSON:

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "company": "Analytical Engines", "ticketType": "standard" }
```

`ticketType` is one of `standard`, `workshop`, `vip`.

The handler creates these child spans (in order) under the auto-created server span:

1. **`validate-registration`** — reject the request when:
   - name or email is empty, or email has no `@` → `error.type = validation_error`;
   - `ticketType` is not one of the allowed set `standard`, `workshop`, `vip`
     → `error.type = unknown_ticket_type`.

   Only **after** it passes, set `com.example.registration.ticket_type`
   to the (now known-bounded) value. Set
   `com.example.registration.email_domain` = the part after `@`.
   **Do not put the full email address on any span** — it is PII and unbounded;
   the domain is enough for the workshop and stays low-cardinality.

   > Custom attributes are namespaced with the reverse-DNS prefix
   > `com.example.*` per OTel semantic conventions (bare,
   > single-segment names like `ticket_type` are invalid; a project namespace
   > keeps them from colliding with the semconv registry). This is the
   > workshop's "consistent naming conventions" point made concrete.
2. **`save-registration`** — simulate a DB write. Sleep a random 20–120 ms.
   With 10% probability sleep 400–700 ms instead (the "slow query" the workshop
   investigates as a latency outlier). Set attribute `db.system.name=postgresql`
   (the current semconv key; the older `db.system` was renamed).
3. **`send-confirmation-email`** — simulate calling an email provider. Sleep
   15–60 ms. **Deliberate failures (document these):**
   - If the email contains the substring `+fail`, the address is rejected as a
     bounced/invalid recipient (the *client's* problem) → `error.type =
     invalid_recipient`. This is the deterministic failure attendees trigger.
   - Otherwise, with 15% probability, the provider is transiently unavailable (a
     *server-side* outage) → `error.type = email_provider_unavailable`.

### Error model (status codes + `error.type`) — IMPORTANT

Distinguish a client/business failure from a server outage, and classify every
failure with a **bounded** `error.type` attribute (the stable OTel semconv key).
Never put a raw exception class name or message into `error.type` — it is a
metric/low-cardinality dimension. The full enum is exactly:

| Condition | `error.type` | HTTP status |
|-----------|-------------|-------------|
| name/email empty or malformed | `validation_error` | `400` |
| `ticketType` not in the allowed set | `unknown_ticket_type` | `400` |
| email contains `+fail` (bad recipient) | `invalid_recipient` | `422` |
| random flaky provider (~15%) | `email_provider_unavailable` | `503` |

Response body on any failure:

```json
{ "status": "error", "errorType": "<one of the enum values>", "message": "<human-readable>" }
```

**Record each failure exactly once.** Record the exception and set
`StatusCode.ERROR` + `error.type` **on the single child span where it occurs**
(`validate-registration` or `send-confirmation-email`). Do **not** also
re-record the same exception on the parent/server span — that double-counts
errors. Let the server span's status follow from the HTTP status as the
instrumentation already does.

Success response `200`:

```json
{ "status": "confirmed", "registrationId": "<uuid-or-random-id>" }
```

## Metrics — `registration.duration` histogram

The backend records **one** histogram measurement per `POST /api/register` call:

- Instrument: histogram named `registration.duration`, unit `s` (seconds),
  description "End-to-end registration handling time".
- Value: wall-clock duration of the whole handler.
- Attributes (all **bounded**, so the metric cannot explode in cardinality):
  - `com.example.registration.ticket_type` — the validated ticket
    type, or omit if the request failed validation before a ticket type was
    established.
  - `outcome` — `confirmed` or `failed`.
  - `error.type` — present only when `outcome=failed`, one of the enum above.

Do **not** add `com.example.registration.email_domain`, the
registration id, or anything unbounded to the metric — those belong on spans
only. This is the workshop's "keep metrics under control" point made concrete.

The metric **name** stays `registration.duration` (dot-namespaced, not a bare
attribute); only the custom *attribute keys* take the reverse-DNS prefix.

## Logs — exceptions as log records

On a failure, in addition to the span error, emit it as an **OTel log record**
(not only a span event) at severity `ERROR`, correlated to the current trace
(so Dash0 links the log to the span). Body = the human message; include
`error.type`. Keep it to failures; successes do not log. Each language note
below says how (bridge the stack's logger, or use the Logs SDK/agent).

## Frontend contract

The registration page is **not** duplicated per language any more. It lives in
the repo-root `web/` folder and every frontend serves the same two files:

- `GET /` — read `$WEB_DIR/index.html` **on every request**, replace the single
  placeholder `__DASH0_BROWSER_CONFIG__` with a JSON object, and serve it as
  `text/html` with `Cache-Control: no-store`. The JSON object is:

  ```json
  { "serviceName": "<DASH0_WEB_SERVICE_NAME>", "endpointUrl": "<OTEL_EXPORTER_OTLP_ENDPOINT>",
    "authToken": "<DASH0_WEB_AUTH_TOKEN>", "dataset": "<DASH0_DATASET>" }
  ```

  Escape every `<` in it as `\u003c` so a value can never close the `<script>`
  block. Re-reading per request means attendees can edit `web/index.html`
  (exercise 4) and reload, without restarting or rebuilding anything.
- `GET /static/registration.js` — serve `$WEB_DIR/registration.js` as
  `application/javascript`, `Cache-Control: no-store`, read per request.
- `POST /api/registrations` — the endpoint the page calls with `fetch`. Body is
  JSON `{name, email, company, ticketType}`. Forward exactly those four fields
  to the backend `POST /api/register` **with trace context propagated**, then
  return the backend's JSON body with the backend's status (`200`/`400`/`422`/
  `503`). Only when the backend is unreachable, return `502` with
  `{"status":"error","errorType":"backend_unreachable","message":"..."}`.
  The browser's request carries `traceparent` (same-origin, so the Dash0 Web
  SDK adds it without any `propagators` config); the server instrumentation
  MUST continue that trace rather than start a new one.
- `POST /register` — the plain form-post route stays as a
  no-JavaScript fallback (server-rendered success/error pages, unchanged).
- `GET /healthz` — return `200 ok` (no tracing needed).

## Browser contract (`web/`)

`web/index.html` loads, in order: the config + `dash0("init", …)` block, the
Dash0 Web SDK (`dash0.iife.js`), the session replay recorder
(`dash0-session-recording.iife.js`), and `/static/registration.js`. Both SDK
bundles are pinned to one version on unpkg so every attendee records the same
way. Init options:

- `serviceName`, `endpoint.url`, `endpoint.authToken`, `endpoint.dataset` from
  the config object; `environment: "workshop"`.
- `sessionRecording.samplingRate: 100` (record every session). Masking stays
  at the SDK default: all input values masked, page text not masked.
- Rage clicks need no config: the frustration-signals instrumentation is on by
  default and only watches clicks while a replay is recording.

`web/registration.js` submits the form with `fetch` and renders the result
into the card client-side (no page load), so the replay and the request stay
in one page view. It also:

- calls `dash0("identify", registrationId)` after a successful registration,
  so a session can be found by the id shown on screen. Never identify by
  email: it is personal data, the same reason the backend only records the
  email domain;
- sends one custom web event `registration.completed` per outcome, with the
  same bounded attributes as the backend metric:
  `com.example.registration.ticket_type`, `outcome`
  (`confirmed`/`failed`) and, on failure, `error.type`.

### Deliberate frontend bugs

These exist only in the browser. The first three leave **no trace at all** on
the backend; that is the point of the workshop. Each is marked
`WORKSHOP BUG` in `web/registration.js`.

| Bug | Trigger | What the backend sees | What Dash0 shows for the browser |
|-----|---------|-----------------------|----------------------------------|
| Promo crash | Promo code that is not an exact, upper-case known code (`earlybird`, `FREE`), then click **Register** | Nothing: no request is sent | `browser.error` (TypeError reading `discount`), and a `browser.rage_click` on `#submit` when the visitor keeps clicking |
| Double submit | Double-click **Register** | Two valid registrations | Two HTTP requests and two traces in one session; the registration id on screen changes |
| Dead button | Click **Add to calendar** on the success screen | Nothing | Only a `browser.rage_click` on `#addToCalendar`. No error, no request |
| Privacy leak | Any successful registration | — | The success text prints name and email; page text is not masked, so both are visible in the replay until the paragraph gets `class="dash0-mask"` |

The backend failures (`+fail` → `422`, random `503`)
show up in the replay as the red result screen, with the
HTTP request linking to the failing backend trace.

## README requirements (one per language, in the language's folder)

> The exercises live in the root README; the per-language READMEs stay
> zero-to-running and point there.

Each README must let someone go from zero to a trace in Dash0 fast:
1. Prerequisites (runtime versions already verified: Node 20, Python 3.9+, Go
   1.22, Java 21 + Maven 3.9).
2. "Get your Dash0 credentials" — Settings → Auth Tokens for the token, and the
   Integration Hub for the fully-resolved OTLP endpoint; fill in root `.env`.
3. Install deps.
4. Run backend, then frontend (exact commands, env loading shown).
5. Open the frontend URL, register once, and (optionally) force a failure with
   `+fail`.
6. "See it in Dash0" — look for the two service names, open the trace, find the
   failing span, and note its bounded `error.type`. Mention the
   `registration.duration` metric (split by `ticket_type` / `error.type`) and
   that exceptions also arrive as correlated log records.
7. Keep it copy-pasteable. Assume the root `.env` is filled in.

## Per-language notes for metrics & logs (added in the refinement pass)

**Metrics** — backend emits the `registration.duration` histogram via the Metrics
SDK/API, exported over OTLP/HTTP to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`
with the same auth headers as traces:
- **Node**: add a `PeriodicExportingMetricReader` with
  `@opentelemetry/exporter-metrics-otlp-proto` to the `NodeSDK`
  (`metricReader`), then `metrics.getMeter('registration').createHistogram(...)`.
- **Python**: build a `MeterProvider` with `PeriodicExportingMetricReader` +
  `OTLPMetricExporter` (http), `set_meter_provider`, then
  `get_meter(...).create_histogram(...)`.
- **Go**: add `otlpmetrichttp` + `sdkmetric.NewMeterProvider` with a
  `PeriodicReader`, `otel.SetMeterProvider`, then `meter.Float64Histogram(...)`.
- **Java**: the javaagent already wires a `MeterProvider` and exports metrics —
  just `GlobalOpenTelemetry.getMeter("registration").histogramBuilder(...)`.

**Logs** — backend emits the failure as an OTel log record:
- **Node**: add a `LoggerProvider` + `BatchLogRecordProcessor` with
  `@opentelemetry/exporter-logs-otlp-proto` (NodeSDK `logRecordProcessors`),
  then emit via the Logs API `logs.getLogger('registration').emit({...})` with
  severity ERROR (context is current, so trace correlation is automatic).
- **Python**: set up the Logs SDK `LoggerProvider` + `OTLPLogExporter` (http) +
  `BatchLogRecordProcessor`, attach the OTel `LoggingHandler` to a stdlib
  logger, and call `logger.error(msg, exc_info=True)` on failure.
- **Go**: use the Logs SDK (`go.opentelemetry.io/otel/log`, `otlploghttp`,
  `sdk/log`) with the `otelslog` bridge; log the error via `slog` within the
  request context.
- **Java**: the javaagent's log appender exports Logback/SLF4J logs over OTLP by
  default — just `log.error("...", exception)`; no code wiring needed.

**Maven wrapper (Java only)**: add the Maven wrapper (`mvn -N wrapper:wrapper`)
to both Java projects and use `./mvnw` in `run.sh` and the README so the app
builds without a system Maven. `.mvn/wrapper/` and `mvnw`/`mvnw.cmd` are kept
(do not gitignore them).
