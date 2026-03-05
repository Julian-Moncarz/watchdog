import type { VercelRequest, VercelResponse } from '@vercel/node';

const PROMPT = `Classify this voice command into exactly one category. Respond with ONLY one word — no punctuation, no explanation.

Categories:
- "question" — a factual question that can be answered with a web search (e.g. "how tall is Everest", "who founded Anthropic")
- "transcript" — a request about the ongoing conversation that requires the transcript (e.g. "summarize our points", "what was my argument", "what did they say about X")
- "clipboard" — a request to copy, export, or save the transcript (e.g. "copy the transcript", "save to clipboard", "export")

Command:`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'command is required' });
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
      max_tokens: 4,
      messages: [
        { role: 'user', content: `${PROMPT}\n\n${command}` },
      ],
    }),
  });

  const data = await response.json();
  const text = (data.content?.[0]?.text ?? 'question').trim().toLowerCase();

  // Normalize to one of the three categories
  let intent = 'question';
  if (text.includes('transcript')) intent = 'transcript';
  else if (text.includes('clipboard')) intent = 'clipboard';

  return res.status(200).json({ intent });
}
