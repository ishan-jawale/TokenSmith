#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/test-buzzdb-evidence.mjs "$@"
