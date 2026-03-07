#!/usr/bin/env bash
# End-to-end pipeline: generate data → train → evaluate → export
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Step 1: Install dependencies ==="
uv sync

echo ""
echo "=== Step 2: Generate dataset ==="
uv run python generate_dataset.py

echo ""
echo "=== Step 3: Train model ==="
uv run python train.py

echo ""
echo "=== Step 4: Evaluate on test set ==="
uv run python evaluate.py

echo ""
echo "=== Step 5: Export to ONNX ==="
uv run python export_onnx.py

echo ""
echo "=== Done ==="
echo "Model artifacts in output/claim-classifier-onnx-int8/"
