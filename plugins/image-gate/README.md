# Image gate

Two jobs, both on the Images tab:

1. **Hides AI-slop domains** via a bundled `blocklist.txt` (plus user additions in settings).
2. **Topic-routing for specialist engines** — results from topic-specific engines
   (iNaturalist, GBIF, NASA Images...) only appear when a small embedding model
   (bge-small, 34 MB, runs as WebAssembly **in the browser**) says the query is
   actually about their topic. Generic engines are never filtered, and ambiguous
   queries ("python", "apple") fall through a confidence margin and show everything.

## Why browser-side

The classifier runs on the visitor's machine via WebGPU-less WASM, so the server
stays stateless and no query text is sent anywhere. The model and runtime are
served from the plugin's own `vendor/` directory.

## Setup

`vendor/` is not stored in git (three binaries + a 34 MB model). After
installing/cloning, run:

    ./fetch-vendor.sh

Pinned versions: transformers.js 4.3.2, onnxruntime-web 1.31.0-dev.20260914
(byte-identical to the tested build), model `Xenova/bge-small-en-v1.5` q8.

## Settings

- **Topic engines** — one row per topic: engine names (as shown in the results
  sidebar) + example phrases, `;`-separated. **Leave the examples empty to use
  the built-in template for those engines** (iNaturalist/GBIF → wildlife, NASA
  Images → space); written examples always override the template. A row for an
  engine without a template and without examples is dropped.
- **Everything else** — phrases for non-topic searches; the topics compete
  against this group. Empty → built-in general-image default set.
- **Confidence margin** — how much closer the best topic must be than the
  runner-up before anything is hidden (default 0.05).
- **Extra blocked domains** — one per line, added to the bundled blocklist.
