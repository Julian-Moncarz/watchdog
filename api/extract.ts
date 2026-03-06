import type { VercelRequest, VercelResponse } from '@vercel/node';
import { stripMarkdownFences, extractJsonArray } from '../src/lib/parse.ts';

const EXTRACTION_PROMPT = `You are a factual claim extractor. You will receive a NEW transcript chunk to extract claims from. You may also receive PRIOR CONTEXT (previous transcript chunks) to help you understand references and avoid duplicates.

Extract every factual claim from the NEW TRANSCRIPT only. Use the prior context to:
- Resolve pronouns and references ("it", "that model", "the previous one")
- Avoid extracting claims that were already stated in prior context
- Understand ongoing topics for better claim formulation

A factual claim is a statement that can be checked as true or false:
- Hard facts: dates, numbers, names, events, measurements
- Common myths stated as fact
- Subjective-but-verifiable: "X is better than Y at Z" (if evidence/benchmarks exist)

Do NOT extract:
- Pure opinions ("I like pizza"), questions, predictions, hypotheticals
- Restatements of what another speaker just said
- Meta-commentary ("that's interesting", "fair enough")
- Claims from the PRIOR CONTEXT section (only extract from NEW TRANSCRIPT)

Respond with ONLY a JSON array:
[{"claim": "concise restatement", "speaker": "name", "context": "short quote"}]`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { transcript, prior_context } = req.body;
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript is required' });
  }
  if (transcript.length > 15000) {
    return res.status(400).json({ error: 'transcript too long (max 15000 chars)' });
  }

  let userMessage = '';
  if (prior_context && typeof prior_context === 'string') {
    userMessage += `PRIOR CONTEXT (for reference only, do NOT extract claims from this):\n${prior_context}\n\n`;
  }
  userMessage += `NEW TRANSCRIPT (extract claims from this):\n${transcript}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: EXTRACTION_PROMPT,
      messages: [
        { role: 'user', content: userMessage },
      ],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '[]';
  const claims = extractJsonArray(text);
  if (claims) {
    return res.status(200).json({ claims });
  }
  return res.status(200).json({ claims: [], raw: stripMarkdownFences(text) });
}
