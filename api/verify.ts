import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractJsonFromContentBlocks } from '../src/lib/parse.ts';

const SYSTEM_PROMPT = `You are a fact-checker. Verify the claim using your knowledge. Only use web search if the claim involves recent events, current data, or something you are genuinely unsure about. Do NOT search for well-known facts you already know.

Respond with ONLY JSON (no markdown, no code fences):
{
  "verdict": "TRUE" | "FALSE" | "MOSTLY_TRUE" | "MOSTLY_FALSE" | "UNVERIFIABLE",
  "confidence": 0.0 to 1.0,
  "response": "One concise sentence: what's actually true. If wrong, state the correction directly. If you're confident, just state the fact. If uncertain, briefly note why (e.g. 'evidence is mixed', 'sources disagree', 'hard to verify').",
  "sources": ["https://..."]
}

Rules:
- TRUE: factually correct
- FALSE: clearly wrong
- MOSTLY_TRUE: approximately right, minor inaccuracies
- MOSTLY_FALSE: kernel of truth but substantially wrong
- UNVERIFIABLE: genuinely cannot determine after searching
- For sources: include 1-2 authoritative URLs if you searched, otherwise empty array`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { claim, context } = req.body;
  if (!claim || typeof claim !== 'string') {
    return res.status(400).json({ error: 'claim is required' });
  }
  if (claim.length > 2000) {
    return res.status(400).json({ error: 'claim too long (max 2000 chars)' });
  }
  if (context && (typeof context !== 'string' || context.length > 5000)) {
    return res.status(400).json({ error: 'context too long (max 5000 chars)' });
  }

  const userMessage = context
    ? `Claim: "${claim}"\n\nContext: ${context}`
    : `Claim: "${claim}"`;

  let data: any;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 2,
          },
        ],
        messages: [
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API error:', response.status);
      return res.status(200).json({ verdict: 'UNVERIFIABLE', confidence: 0, response: 'Unable to verify right now.', sources: [] });
    }

    data = await response.json();
  } catch (err) {
    console.error('Anthropic fetch failed:', err);
    return res.status(200).json({ verdict: 'UNVERIFIABLE', confidence: 0, response: 'Unable to verify right now.', sources: [] });
  }

  const parsed = extractJsonFromContentBlocks(data.content ?? []);
  if (parsed) return res.status(200).json(parsed);

  return res.status(200).json({ verdict: 'UNVERIFIABLE', confidence: 0, response: 'Unable to verify.', sources: [] });
}
