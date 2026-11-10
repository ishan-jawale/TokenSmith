#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test tests/unit/typescript/practice-evidence-units.test.mjs tests/unit/typescript/practice-evidence-ids.test.mjs tests/unit/typescript/evidence-audit-helpers.test.mjs
node scripts/preview-practice-evidence.mjs "$@"
node scripts/review-practice-evidence.mjs "$@"
