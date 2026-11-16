#!/usr/bin/env bash
# Fetches the browser-side runtime the image gate serves from ./vendor:
#   - transformers.js (WebAssembly embedding pipeline)
#   - onnxruntime-web wasm backend
#   - the bge-small q8 model (34 MB)
# Pinned to the exact versions the gate was built against; the model is the
# standard Xenova/bge-small-en-v1.5 q8 export.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
V="$HERE/vendor"
mkdir -p "$V/models/bge-small/onnx"

fetch() { # url dest
  echo "- $(basename "$2")"
  curl -fL "$1" --max-time 600 -o "$2"
}

T=https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist
O=https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist
H=https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main

fetch "$T/transformers.min.js"                      "$V/transformers.min.js"
fetch "$O/ort-wasm-simd-threaded.wasm"              "$V/ort-wasm-simd-threaded.wasm"
fetch "$O/ort-wasm-simd-threaded.mjs"               "$V/ort-wasm-simd-threaded.mjs"
fetch "$H/config.json"                              "$V/models/bge-small/config.json"
fetch "$H/tokenizer.json"                           "$V/models/bge-small/tokenizer.json"
fetch "$H/tokenizer_config.json"                    "$V/models/bge-small/tokenizer_config.json"
fetch "$H/onnx/model_quantized.onnx"                "$V/models/bge-small/onnx/model_quantized.onnx"

echo "vendor/ is ready."
