"""
Export the trained claim classifier to ONNX format for deployment.

Produces both a full-precision and a quantized (int8) model.

Usage:
    uv run python export_onnx.py
"""

from pathlib import Path

from optimum.onnxruntime import ORTModelForSequenceClassification, ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from transformers import AutoTokenizer

MODEL_DIR = Path(__file__).parent / "output" / "claim-classifier"
ONNX_DIR = Path(__file__).parent / "output" / "claim-classifier-onnx"
ONNX_QUANTIZED_DIR = Path(__file__).parent / "output" / "claim-classifier-onnx-int8"


def main():
    print(f"Loading model from {MODEL_DIR}")
    # Use base model tokenizer to avoid version compat issues
    tokenizer = AutoTokenizer.from_pretrained("answerdotai/ModernBERT-base")

    # Export to ONNX
    print(f"Exporting to ONNX: {ONNX_DIR}")
    model = ORTModelForSequenceClassification.from_pretrained(
        str(MODEL_DIR),
        export=True,
    )
    model.save_pretrained(str(ONNX_DIR))
    tokenizer.save_pretrained(str(ONNX_DIR))
    print(f"  ONNX model saved ({(ONNX_DIR / 'model.onnx').stat().st_size / 1e6:.1f} MB)")

    # Quantize to int8
    print(f"Quantizing to int8: {ONNX_QUANTIZED_DIR}")
    quantizer = ORTQuantizer.from_pretrained(str(ONNX_DIR))
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=True)

    ONNX_QUANTIZED_DIR.mkdir(parents=True, exist_ok=True)
    quantizer.quantize(
        save_dir=str(ONNX_QUANTIZED_DIR),
        quantization_config=qconfig,
    )
    tokenizer.save_pretrained(str(ONNX_QUANTIZED_DIR))

    for f in ONNX_QUANTIZED_DIR.glob("*.onnx"):
        print(f"  Quantized model: {f.name} ({f.stat().st_size / 1e6:.1f} MB)")

    print("Done!")


if __name__ == "__main__":
    main()
