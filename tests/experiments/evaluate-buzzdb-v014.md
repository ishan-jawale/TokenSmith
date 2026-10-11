# BuzzDB v0.1.14 batch evaluation

This opt-in script collects the ten standalone questions in
`tests/benchmarks/buzzdb_grounding_cases.json` against Gemma 4 E4B, 12B, 26B A4B,
and Gemini 3.8 Flash through TokenSmith's Gemini API path. TokenSmith v0.1.14
recommends Gemini 2.5 Flash, but that model returned HTTP 404 for this account;
the report records the substitution and preserves the failed attempt. It does not collect Gemini web
answers; those require a separate web-interface run.

## What it reproduces

- A separate empty library profile and Basic preparation of the authored BuzzDB
  Markdown book with Nomic embeddings. The script checks for 1,574 chunks.
- Fresh v0.1.14 defaults: hybrid search, four configured sources, model-aware
  retrieval limit, 8,192 context setting, 1,536 output setting, temperature 0.7,
  top-p 0.4, top-k 40, min-p 0, repeat penalty 1.18, and follow-up suggestions on.
  For each selected model, the script applies the UI's default-plus-model-override
  lookup. A fresh profile has no overrides. The automatic candidate limit is seven
  for Gemma E4B and up to eight for the other models; prompt packing may use fewer.
- One independent first-turn conversation per question. There is no prior answer,
  passage selection, or question rewrite. The question is its own retrieval query.
- The production Python index/search worker, retrieval-limit function, study
  pipeline, prompt packer, Ollama answer service, and cloud answer service.
  This includes Gemma E4B's one-token prompt check.

The batch run does not exercise React, Electron IPC, or Chromium's cloud-network
transport. Those UI and transport differences should be reported when presenting
the result. It records the actual outbound model request bodies and source-unit
counts, so the prompt, sampling settings, context length, and source packing can
be audited afterward.
The Gemini API key is read from `GEMINI_API_KEY`; it is never saved in the report.

## Before running

1. Keep the Ada Ollama server and the Mac SSH tunnel open. Confirm the Mac can
   reach `http://127.0.0.1:11434/api/tags` and sees all three Gemma tags and Nomic.
2. In the same **Mac** Terminal where you will run the script, enter the key
   without showing it or putting it in shell history:

   ```bash
   read -s -p "Gemini API key: " GEMINI_API_KEY
   echo
   export GEMINI_API_KEY
   ```

   The key remains in that shell session. Do not enter it on Ada or paste it into
   this repository or chat.
3. Run from the TokenSmith repository root:

   `node tests/experiments/evaluate-buzzdb-v014.mjs`

The script checks the three exact Ollama digests and Nomic digest, then sends a
small Gemini 3.8 Flash connection request before indexing or answering. An API
model-list entry alone did not establish access to Gemini 2.5 Flash.
It writes the separate index under `tmp/buzzdb-v014-batch-profile/` and writes
`tmp/buzzdb-v014-batch-results.json` after preparation, after retrieval, and after
each answer. A rerun skips completed answers. If any call fails, the report keeps
all completed answers plus the failed request's retrieval and error. Gemini HTTP
503 (temporary high demand) responses are retried up to three times with short
delays; the retries send the same request body and are recorded in `modelRequests`.
On a later rerun, failed attempts move to `failedAttempts` and the question is
tried again.

The script was prepared without executing it. Check the first saved case and its
`modelRequests` before using the output as evidence in slides.
