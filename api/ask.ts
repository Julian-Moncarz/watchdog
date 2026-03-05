import type { VercelRequest, VercelResponse } from '@vercel/node';

const SEARCH_PROMPT = `You are Watchdog. Answer the factual question using web search.

Respond with ONLY JSON (no markdown, no code fences):
{
  "answer": "Clear, concise answer in 1-3 sentences. If you're confident, just state the answer. If uncertain, briefly note why (e.g. 'reports vary', 'not yet confirmed').",
  "confidence": 0.0 to 1.0,
  "sources": ["https://..."]
}

For sources: 2-3 most authoritative URLs.`;

const TRANSCRIPT_PROMPT = `You are Watchdog, an AI assistant embedded in a live conversation. The user has asked a question about the conversation.

Below is the transcript of the conversation so far, and any corrections Watchdog has already made. Answer the question based on this context. Refer to the person who asked as "you".

Respond with ONLY JSON (no markdown, no code fences):
{
  "answer": "Clear, concise answer in 1-3 sentences.",
  "confidence": 0.0 to 1.0,
  "sources": []
}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question, speaker, transcript, corrections } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question is required' });
  }
  if (question.length > 2000) {
    return res.status(400).json({ error: 'question too long (max 2000 chars)' });
  }

  const hasTranscript = transcript && typeof transcript === 'string';
  const prompt = hasTranscript ? TRANSCRIPT_PROMPT : SEARCH_PROMPT;

  let userContent = `${prompt}\n\n`;
  if (hasTranscript) {
    userContent += `Conversation transcript:\n${transcript.slice(-10000)}\n\n`;
    if (corrections && typeof corrections === 'string') {
      userContent += `Corrections made so far:\n${corrections}\n\n`;
    }
    if (speaker && typeof speaker === 'string') {
      userContent += `Asked by: ${speaker}\n`;
    }
  }
  userContent += `Question: ${question}`;

  const body: Record<string, unknown> = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: userContent },
    ],
  };

  // Only include web search for non-transcript queries
  if (!hasTranscript) {
    body.tools = [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
      },
    ];
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
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

  return res.status(200).json({ answer: 'Unable to process response', confidence: 0, sources: [] });
}
