"""
Fine-tune ModernBERT-base for binary sentence classification (claim vs non-claim).

Usage:
    uv run python train.py [--epochs 5] [--batch-size 32] [--lr 2e-5]

Outputs model to ./output/claim-classifier/
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from datasets import Dataset
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    EarlyStoppingCallback,
)

MODEL_NAME = "answerdotai/ModernBERT-base"
DATA_DIR = Path(__file__).parent / "data"
OUTPUT_DIR = Path(__file__).parent / "output" / "claim-classifier"


def load_jsonl(path: Path) -> list[dict]:
    examples = []
    with open(path) as f:
        for line in f:
            examples.append(json.loads(line))
    return examples


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    return {
        "accuracy": accuracy_score(labels, preds),
        "f1": f1_score(labels, preds),
        "precision": precision_score(labels, preds),
        "recall": recall_score(labels, preds),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    args = parser.parse_args()

    print(f"Loading tokenizer and model: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=2,
        id2label={0: "NOT_CLAIM", 1: "CLAIM"},
        label2id={"NOT_CLAIM": 0, "CLAIM": 1},
    )

    print("Loading datasets...")
    train_data = load_jsonl(DATA_DIR / "train.jsonl")
    val_data = load_jsonl(DATA_DIR / "val.jsonl")

    train_ds = Dataset.from_list(train_data)
    val_ds = Dataset.from_list(val_data)

    def tokenize(batch):
        return tokenizer(
            batch["text"],
            padding="max_length",
            truncation=True,
            max_length=128,
        )

    train_ds = train_ds.map(tokenize, batched=True, remove_columns=["text"])
    val_ds = val_ds.map(tokenize, batched=True, remove_columns=["text"])

    train_ds = train_ds.rename_column("label", "labels")
    val_ds = val_ds.rename_column("label", "labels")
    train_ds.set_format("torch")
    val_ds.set_format("torch")

    print(f"Train: {len(train_ds)}, Val: {len(val_ds)}")

    # Determine device
    if torch.backends.mps.is_available():
        device_note = "MPS (Apple Silicon)"
        use_fp16 = False  # MPS doesn't support fp16 training well
    elif torch.cuda.is_available():
        device_note = "CUDA"
        use_fp16 = True
    else:
        device_note = "CPU"
        use_fp16 = False
    print(f"Device: {device_note}")

    training_args = TrainingArguments(
        output_dir=str(OUTPUT_DIR),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size * 2,
        learning_rate=args.lr,
        warmup_ratio=args.warmup_ratio,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        greater_is_better=True,
        save_total_limit=2,
        logging_steps=25,
        fp16=use_fp16,
        report_to="none",
        dataloader_num_workers=0,  # avoid multiprocessing issues on macOS
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    print("Training...")
    trainer.train()

    print("Evaluating on val set...")
    metrics = trainer.evaluate()
    for k, v in sorted(metrics.items()):
        if isinstance(v, float):
            print(f"  {k}: {v:.4f}")

    print(f"\nSaving model to {OUTPUT_DIR}")
    trainer.save_model(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))

    # Also save label mapping for inference
    label_map = {"id2label": {0: "NOT_CLAIM", 1: "CLAIM"}, "label2id": {"NOT_CLAIM": 0, "CLAIM": 1}}
    with open(OUTPUT_DIR / "label_map.json", "w") as f:
        json.dump(label_map, f, indent=2)

    print("Done!")


if __name__ == "__main__":
    main()
