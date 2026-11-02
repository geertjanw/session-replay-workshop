#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ../../../scripts/load-env.sh      # repo-root/.env (service is at apps/nodejs/frontend)
source ../../../scripts/web-config.sh    # WEB_DIR + browser token
export OTEL_SERVICE_NAME=registration-web-node
export DASH0_WEB_SERVICE_NAME=registration-website-node
export PORT=3000
export BACKEND_URL=http://localhost:3001
exec node -r ./tracing.js server.js
