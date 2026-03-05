import type { VercelRequest, VercelResponse } from '@vercel/node';

const QUESTION_PROMPT = `You are a fact-checker answering a direct question. Use web search to find the answer from authoritative sources.

Respond with ONLY JSON (no markdown, no code fences):
{
  "answer": "Clear, concise answer to the question",
  "confidence": 0.0 to 1.0,
  "sources": [{"title": "short descriptive title", "url": "https://..."}],
  "caveats": "Any important nuances or caveats, or null"
}

For sources: pick the 2-3 most authoritative and relevant sources from your search results. Prefer primary sources (NASA, WHO, Wikipedia, peer-reviewed) over blog posts.

The question:`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question is required' });
  }
  if (question.length > 2000) {
    return res.status(400).json({ error: 'question too long (max 2000 chars)' });
  }

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
        { role: 'user', content: `${QUESTION_PROMPT}\n\n${question}` },
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

  return res.status(200).json({ answer: 'Unable to process response', confidence: 0, sources: [], caveats: null });
}
