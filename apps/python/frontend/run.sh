#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Load shared Dash0 / OTLP settings from the repo-root .env.
source ../../../scripts/load-env.sh
# WEB_DIR + the browser (Dash0 Web SDK) token.
source ../../../scripts/web-config.sh

# Activate this service's isolated virtualenv.
source venv/bin/activate

# Per-service OpenTelemetry + listen settings.
export OTEL_SERVICE_NAME=registration-web-python
export DASH0_WEB_SERVICE_NAME=registration-website-python
export PORT=3100
export BACKEND_URL=http://localhost:3101

exec python app.py
