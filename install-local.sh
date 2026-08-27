#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for the local dashboard server."
  echo "Install Node.js, then run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for the local dashboard server."
  echo "Install npm, then run this script again."
  exit 1
fi

npm install

cat <<'MSG'

PaninoTL Dashboard local install is ready.

Start it with:
  npm run local

Then open:
  http://127.0.0.1:8787

The local dashboard defaults to:
  http://127.0.0.1:8787/local-api

The browser uses plain HTTP polling; Node connects to HiveMQ over MQTT TLS.
MSG
