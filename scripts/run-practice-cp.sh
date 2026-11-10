#!/bin/bash
# Repeatable 60-slot handbook benchmark of the current working-tree code.
# Each run saves its own code snapshot and results. No downloads or app changes.
set -euo pipefail

benchmark_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$benchmark_root"

if ! benchmark_node="$(command -v node)"; then
  printf '%s\n' 'Node.js was not found. Open your usual development Terminal and run this command again.' >&2
  exit 1
fi

benchmark_runner="$benchmark_root/tests/experiments/benchmark-practice.mjs"
benchmark_book='/Users/Skaterboi/Documents/IIT Delhi/Career/Placement Prep./Competitive Programming.pdf'

for benchmark_argument in "$@"; do
  if [[ "$benchmark_argument" == '--help' || "$benchmark_argument" == '--plan' ]]; then
    exec "$benchmark_node" "$benchmark_runner" "$benchmark_argument"
  fi
done

printf '%s\n' 'Checking the book, Python runtime, Ada connection and required models...'
"$benchmark_node" "$benchmark_runner" --book "$benchmark_book" --model gemma4:12b "$@" --check

for benchmark_argument in "$@"; do
  if [[ "$benchmark_argument" == '--check' ]]; then
    exit 0
  fi
done

printf '%s\n' 'Starting the current-code Practice benchmark (full run: 6 topics, 60 scheduled attempts).'
printf '%s\n' 'A fresh output directory will contain the code snapshot, questions, prompts, citations and timings.'
printf '%s\n' 'Keep the Ollama/Ada server and any SSH tunnel open.'
if [[ -x /usr/bin/caffeinate ]]; then
  # Prevent idle sleep for the duration of import and question generation.
  exec /usr/bin/caffeinate -i "$benchmark_node" "$benchmark_runner" --book "$benchmark_book" --model gemma4:12b "$@"
fi
exec "$benchmark_node" "$benchmark_runner" --book "$benchmark_book" --model gemma4:12b "$@"
