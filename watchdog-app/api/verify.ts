import type { VercelRequest, VercelResponse } from '@vercel/node';

const VERIFICATION_PROMPT = `You are a fact-checker. You will receive a factual claim from a conversation. Your job is to verify whether it is true, false, or somewhere in between.

Use web search to verify the claim. Search for authoritative sources.

Respond with ONLY JSON (no markdown, no code fences):
{
  "verdict": "TRUE" | "FALSE" | "MOSTLY_TRUE" | "MOSTLY_FALSE" | "UNVERIFIABLE",
  "confidence": 0.0 to 1.0,
  "explanation": "Brief explanation with key evidence (1-2 sentences)",
  "correction": "If false/mostly false, what is correct? null if true.",
  "sources": [{"title": "short descriptive title", "url": "https://..."}]
}

For sources: pick the 2-3 most authoritative and relevant sources from your search results. Prefer primary sources (NASA, WHO, Wikipedia, peer-reviewed) over blog posts.

Rules:
- TRUE: factually correct
- FALSE: clearly wrong
- MOSTLY_TRUE: approximately right, minor inaccuracies
- MOSTLY_FALSE: kernel of truth but substantially wrong
- UNVERIFIABLE: genuinely cannot determine after searching
- Common myths should be FALSE even if widely believed

The claim to verify:`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { claim, context } = req.body;
  if (!claim) {
    return res.status(400).json({ error: 'claim is required' });
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

  return res.status(200).json({ verdict: 'UNVERIFIABLE', confidence: 0, explanation: 'Failed to parse response', correction: null, sources: [] });
}
