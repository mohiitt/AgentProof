#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"
RUN_CHECKS="${RUN_CHECKS:-1}"

if ! command -v node >/dev/null 2>&1; then
  echo "AgentProof requires Node.js 20.19+ or 22.12+. Install Node.js and run this script again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "AgentProof requires npm. Install npm and run this script again." >&2
  exit 1
fi

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
const supported = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
if (!supported) {
  console.error(`Unsupported Node.js ${process.versions.node}. Use Node.js 20.19+ or 22.12+.`);
  process.exit(1);
}
'

NEEDS_INSTALL=0
if [[ ! -x node_modules/.bin/vite ]] || [[ ! -f node_modules/.package-lock.json ]]; then
  NEEDS_INSTALL=1
elif [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  NEEDS_INSTALL=1
elif ! npm ls --depth=0 --silent >/dev/null 2>&1; then
  NEEDS_INSTALL=1
fi

if [[ "$NEEDS_INSTALL" == "1" ]]; then
  echo "Installing locked dependencies..."
  npm ci
fi

if [[ ! -f .env ]]; then
  echo "Warning: .env was not found. The interactive seeded demo will work, but live HydraDB and RocketRide checks will not." >&2
  echo "Create it from .env.example when you want live service checks." >&2
fi

if [[ "$RUN_CHECKS" == "1" ]]; then
  echo "Running startup checks..."
  npm test
  npm run typecheck
fi

echo "Starting AgentProof at http://${HOST}:${PORT}"
echo "Press Ctrl+C to stop. Use PORT=5174 ./start.sh if the port is busy."
exec npm run dev -- --host "$HOST" --port "$PORT" --strictPort
