import type { VercelRequest, VercelResponse } from '@vercel/node';

const VERIFICATION_PROMPT = `You are a fact-checker. Verify the claim using web search.

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
- For sources: 2-3 most authoritative URLs

The claim:`;

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
    ? `${VERIFICATION_PROMPT}\n\n"${claim}"\n\nContext: ${context}`
    : `${VERIFICATION_PROMPT}\n\n"${claim}"`;

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
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        },
      ],
      messages: [
        { role: 'user', content: userMessage },
      ],
    }),
  });

  const data = await response.json();
  const textBlocks = (data.content ?? []).filter((b: any) => b.type === 'text');
  for (const block of textBlocks) {
    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return res.status(200).json(JSON.parse(jsonMatch[0]));
      } catch {
        // try next block
      }
    }
  }

  return res.status(200).json({ verdict: 'UNVERIFIABLE', confidence: 0, response: 'Unable to verify.', sources: [] });
}
