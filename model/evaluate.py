"""
Evaluate the trained claim classifier on the held-out test set.

Usage:
    uv run python evaluate.py [--model-dir output/claim-classifier]

Prints per-class metrics plus a confusion matrix and error examples.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


DATA_DIR = Path(__file__).parent / "data"
DEFAULT_MODEL = Path(__file__).parent / "output" / "claim-classifier"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=str, default=str(DEFAULT_MODEL))
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    print(f"Loading model from {model_dir}")
    tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
    model = AutoModelForSequenceClassification.from_pretrained(str(model_dir))
    model.eval()

    # Load test data
    test_path = DATA_DIR / "test.jsonl"
    examples = []
    with open(test_path) as f:
        for line in f:
            examples.append(json.loads(line))

    print(f"Test set: {len(examples)} examples")

    texts = [ex["text"] for ex in examples]
    labels = [ex["label"] for ex in examples]

    # Batch inference
    batch_size = 64
    all_preds = []
    all_probs = []

    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i : i + batch_size]
        inputs = tokenizer(
            batch_texts,
            padding=True,
            truncation=True,
            max_length=128,
            return_tensors="pt",
        )
        with torch.no_grad():
            outputs = model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)
        preds = torch.argmax(probs, dim=-1)
        all_preds.extend(preds.tolist())
        all_probs.extend(probs[:, 1].tolist())

    labels_arr = np.array(labels)
    preds_arr = np.array(all_preds)

    # Metrics
    tp = int(((preds_arr == 1) & (labels_arr == 1)).sum())
    fp = int(((preds_arr == 1) & (labels_arr == 0)).sum())
    fn = int(((preds_arr == 0) & (labels_arr == 1)).sum())
    tn = int(((preds_arr == 0) & (labels_arr == 0)).sum())

    accuracy = (tp + tn) / len(labels)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print(f"\nConfusion Matrix:")
    print(f"              Predicted")
    print(f"              NOT_CLAIM  CLAIM")
    print(f"  NOT_CLAIM   {tn:>6}    {fp:>5}")
    print(f"  CLAIM       {fn:>6}    {tp:>5}")

    print(f"\nAccuracy:  {accuracy:.4f}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"F1:        {f1:.4f}")

    # Show errors
    errors = []
    for i, (text, label, pred, prob) in enumerate(zip(texts, labels, all_preds, all_probs)):
        if label != pred:
            errors.append({
                "text": text,
                "true_label": "CLAIM" if label == 1 else "NOT_CLAIM",
                "predicted": "CLAIM" if pred == 1 else "NOT_CLAIM",
                "claim_prob": round(prob, 3),
            })

    print(f"\nErrors: {len(errors)} / {len(examples)} ({len(errors)/len(examples)*100:.1f}%)")
    if errors:
        print("\nSample errors (up to 20):")
        for err in errors[:20]:
            print(f"  [{err['true_label']} → {err['predicted']}] (p={err['claim_prob']}) {err['text'][:100]}")


if __name__ == "__main__":
    main()
