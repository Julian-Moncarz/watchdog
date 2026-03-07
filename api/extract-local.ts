import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Local claim extraction using ModernBERT ONNX model.
 *
 * Splits transcript into sentences, runs each through the claim classifier,
 * and returns sentences classified as factual claims.
 *
 * This replaces the LLM-based /api/extract endpoint.
 *
 * Expects: { transcript: string }
 * Returns: { claims: Array<{ claim: string }> }
 */

let pipeline: any = null;
let pipelinePromise: Promise<any> | null = null;

async function getClassifier() {
  if (pipeline) return pipeline;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    // Dynamic import — @huggingface/transformers is ESM-only
    const { pipeline: createPipeline } = await import('@huggingface/transformers');
    pipeline = await createPipeline(
      'text-classification',
      'watchdog/claim-classifier',  // HuggingFace Hub model ID — update after uploading
      {
        device: 'cpu',
        dtype: 'q8',  // int8 quantized
      },
    );
    return pipeline;
  })();

  return pipelinePromise;
}

/**
 * Split transcript text into individual utterances.
 * Each line is "[Speaker N]: text" — we keep the full line as the unit of
 * classification since that's what the model was trained on.
 *
 * For long utterances containing multiple sentences, we further split on
 * sentence boundaries to avoid missing claims buried in long turns.
 */
function splitIntoSentences(transcript: string): string[] {
  const lines = transcript.split('\n').filter(l => l.trim());
  const sentences: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\[Speaker \d+\]:)\s*(.+)$/);
    if (!match) {
      sentences.push(line);
      continue;
    }

    const prefix = match[1];
    const text = match[2];

    // If the utterance is short enough, keep it whole
    if (text.length < 120) {
      sentences.push(line);
      continue;
    }

    // Split longer utterances on sentence boundaries
    const parts = text.split(/(?<=[.!?])\s+/);
    for (const part of parts) {
      if (part.trim()) {
        sentences.push(`${prefix} ${part.trim()}`);
      }
    }
  }

  return sentences;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript } = req.body;
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript is required' });
  }
  if (transcript.length > 15000) {
    return res.status(400).json({ error: 'transcript too long (max 15000 chars)' });
  }

  try {
    const classifier = await getClassifier();
    const sentences = splitIntoSentences(transcript);

    if (sentences.length === 0) {
      return res.status(200).json({ claims: [] });
    }

    // Batch classify all sentences
    const results = await classifier(sentences, { batch_size: 16 });

    const claims: { claim: string }[] = [];
    for (let i = 0; i < sentences.length; i++) {
      const result = Array.isArray(results[i]) ? results[i][0] : results[i];
      if (result.label === 'CLAIM' && result.score > 0.6) {
        // Strip speaker prefix for the claim text sent to verify
        const claimText = sentences[i].replace(/^\[Speaker \d+\]:\s*/, '');
        claims.push({ claim: claimText });
      }
    }

    return res.status(200).json({ claims });
  } catch (err) {
    console.error('Classification error:', err);
    return res.status(500).json({ error: 'Classification failed' });
  }
}
