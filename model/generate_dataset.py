"""
Generate a synthetic dataset for training a factual claim classifier.

Each example is a single sentence from a conversation transcript (as it would
appear from Deepgram Nova-3 STT output), labeled:
  1 = factual claim (verifiable statement)
  0 = not a factual claim (opinion, question, filler, meta-commentary, etc.)

The generator produces realistic STT artifacts:
  - occasional missing punctuation / capitalization
  - filler words (um, uh, like, you know, I mean)
  - disfluencies and false starts
  - run-on sentences joined by "and" or "so"
  - speaker label format: [Speaker 0]: ...
"""

import asyncio
import json
import os
import random
import sys
from pathlib import Path

import anthropic

BATCH_SIZE = 50  # examples per API call
NUM_BATCHES = 60  # total batches → ~3000 examples
MAX_CONCURRENT = 8

TOPICS = [
    "artificial intelligence and machine learning",
    "space exploration and astronomy",
    "history and world wars",
    "biology and evolution",
    "physics and chemistry",
    "geography and countries",
    "sports statistics and records",
    "economics and finance",
    "music history and artists",
    "movie and TV trivia",
    "food science and nutrition",
    "health and medicine",
    "technology companies and startups",
    "climate change and environment",
    "politics and government",
    "psychology and neuroscience",
    "mathematics and computer science",
    "architecture and engineering",
    "literature and authors",
    "ancient civilizations",
    "pop culture and internet",
    "automotive and transportation",
    "law and legal systems",
    "philosophy and ethics",
    "video games and esports",
    "cryptocurrency and blockchain",
    "social media and platforms",
    "cooking and culinary arts",
    "languages and linguistics",
    "military and defense",
]

SYSTEM_PROMPT = """You generate training data for a binary classifier that detects factual claims in speech transcripts.

Each example is a single utterance from a casual conversation, as it would appear from a speech-to-text system (Deepgram Nova-3). The format is:
[Speaker N]: <utterance text>

CRITICAL REALISM REQUIREMENTS — your examples MUST sound like real people talking, captured by STT:
- Use filler words naturally: "um", "uh", "like", "you know", "I mean", "basically", "honestly", "right"
- Include false starts: "I think the— well actually it was 1969"
- Run-on sentences connected with "and", "so", "but"
- Sometimes missing or wrong punctuation
- Occasional lowercase where capitals should be
- Contractions: "it's", "that's", "they're", "didn't", "won't"
- Casual phrasing: "like 500 million" not "approximately 500 million"
- Mix of short and long utterances
- Some utterances are fragments
- Numbers sometimes written out, sometimes as digits
- Include realistic STT errors occasionally: "their" vs "there", minor word substitutions

LABEL DEFINITIONS:
1 (CLAIM) = A statement containing a verifiable fact. Examples:
  - Hard facts: dates, numbers, names, events, measurements, statistics
  - Comparative claims with evidence: "Python is faster than Ruby for data processing"
  - Historical claims: "The Berlin Wall fell in 1989"
  - Scientific claims: "Water boils at 100 degrees celsius"
  - Claims that are WRONG are still claims (label=1): "Napoleon was 5 foot 2"

0 (NOT CLAIM) = Everything else. Examples:
  - Pure opinions without verifiable substance: "I think that movie was amazing"
  - Questions: "When did that happen?"
  - Filler/acknowledgment: "Yeah totally", "That's interesting", "Hmm right"
  - Meta-commentary: "Let me think about that", "Going back to what you said"
  - Predictions: "I bet they'll release it next year"
  - Hypotheticals: "If they had done X, Y would have happened"
  - Greetings/social: "Hey how's it going"
  - Commands/suggestions: "You should check that out"
  - Emotional reactions: "Oh wow that's crazy", "No way"

EDGE CASES (label carefully):
- "I read that X" → 1, because X is verifiable
- "I think X happened in 1990" → 1, the hedging doesn't change that the date is verifiable
- "They say X is better than Y" → 1 if X vs Y is measurably comparable, 0 if purely subjective
- "That's like the biggest company ever" → 0, too vague to verify
- "Apple is worth like 3 trillion dollars" → 1, specific enough to verify
- Rhetorical questions containing facts → 1 ("Didn't Tesla sell like 2 million cars last year?")

Generate EXACTLY the requested number of examples. Aim for roughly 45% claims (1) and 55% non-claims (0) — conversations have more chatter than facts.

Return ONLY a JSON array of objects: [{"text": "[Speaker N]: ...", "label": 0 or 1}]
No markdown fences. No explanation."""

OUTPUT_DIR = Path(__file__).parent / "data"


async def generate_batch(
    client: anthropic.AsyncAnthropic,
    batch_id: int,
    sem: asyncio.Semaphore,
) -> list[dict]:
    topic_a = random.choice(TOPICS)
    topic_b = random.choice(TOPICS)
    while topic_b == topic_a:
        topic_b = random.choice(TOPICS)

    speaker_count = random.choice([2, 2, 3, 3, 4])
    speakers = [f"Speaker {i}" for i in range(speaker_count)]

    user_prompt = (
        f"Generate {BATCH_SIZE} examples from a casual conversation between "
        f"{', '.join(speakers)} about {topic_a} and {topic_b}. "
        f"Make it sound like a real conversation captured by speech-to-text — "
        f"not a list of disconnected sentences. Include natural flow: "
        f"agreements, disagreements, tangents, corrections, and banter. "
        f"Vary utterance length from 3 words to 40+ words. "
        f"Include at least 5 examples with STT artifacts (missing caps, wrong homophones, etc). "
        f"Include at least 3 wrong/false factual claims (still labeled 1). "
        f"Return ONLY the JSON array."
    )

    async with sem:
        for attempt in range(3):
            try:
                resp = await client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=8192,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_prompt}],
                )
                text = resp.content[0].text.strip()
                # Strip markdown fences if present
                if text.startswith("```"):
                    text = text.split("\n", 1)[1]
                    text = text.rsplit("```", 1)[0]
                examples = json.loads(text)
                if not isinstance(examples, list):
                    raise ValueError("Response is not a list")
                # Validate structure
                valid = []
                for ex in examples:
                    if isinstance(ex, dict) and "text" in ex and "label" in ex:
                        if ex["label"] in (0, 1):
                            valid.append({"text": ex["text"], "label": ex["label"]})
                print(f"  Batch {batch_id}: {len(valid)} examples ({sum(e['label'] for e in valid)} claims)")
                return valid
            except Exception as e:
                print(f"  Batch {batch_id} attempt {attempt + 1} failed: {e}")
                if attempt == 2:
                    return []
    return []


async def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    client = anthropic.AsyncAnthropic(api_key=api_key)
    sem = asyncio.Semaphore(MAX_CONCURRENT)

    print(f"Generating {NUM_BATCHES} batches of {BATCH_SIZE} examples each...")
    print(f"Target: ~{NUM_BATCHES * BATCH_SIZE} examples")

    tasks = [generate_batch(client, i, sem) for i in range(NUM_BATCHES)]
    results = await asyncio.gather(*tasks)

    all_examples = []
    for batch in results:
        all_examples.extend(batch)

    # Deduplicate by text
    seen = set()
    unique = []
    for ex in all_examples:
        key = ex["text"].lower().strip()
        if key not in seen:
            seen.add(key)
            unique.append(ex)

    random.shuffle(unique)

    # Split: 80% train, 10% val, 10% test
    n = len(unique)
    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    splits = {
        "train": unique[:train_end],
        "val": unique[train_end:val_end],
        "test": unique[val_end:],
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in splits.items():
        path = OUTPUT_DIR / f"{name}.jsonl"
        with open(path, "w") as f:
            for ex in data:
                f.write(json.dumps(ex) + "\n")
        claim_count = sum(e["label"] for e in data)
        print(f"{name}: {len(data)} examples ({claim_count} claims, {len(data) - claim_count} non-claims)")

    print(f"\nTotal unique examples: {n}")
    print(f"Files written to {OUTPUT_DIR}/")


if __name__ == "__main__":
    asyncio.run(main())
