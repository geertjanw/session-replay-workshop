# Browser (Dash0 Web SDK) settings for a frontend's run.sh — source this AFTER
# load-env.sh, do not execute it.
#
#   source ../../../scripts/load-env.sh
#   source ../../../scripts/web-config.sh
#
# It exports:
#   WEB_DIR               absolute path of the shared web/ folder (index.html, registration.js)
#   DASH0_WEB_AUTH_TOKEN  the token the BROWSER sends telemetry with
#
# The browser token is embedded in the page HTML, so anyone visiting the page
# can read it. Use a separate token that can only ingest data. If you have not
# created one yet, this falls back to DASH0_AUTH_TOKEN with a warning, which is
# fine on localhost for the workshop and never fine on a public site.

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../web" && pwd)"
export WEB_DIR

case "${DASH0_WEB_AUTH_TOKEN:-}" in
  "" | auth_REPLACE_ME)
    echo "WARN: DASH0_WEB_AUTH_TOKEN is not set; the browser will use DASH0_AUTH_TOKEN." >&2
    echo "      That token is visible in the page source. Create an ingest-only token" >&2
    echo "      for the browser (see README, step 1) before you put this anywhere public." >&2
    export DASH0_WEB_AUTH_TOKEN="${DASH0_AUTH_TOKEN:-}"
    ;;
esac
