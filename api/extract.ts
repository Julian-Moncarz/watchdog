import type { VercelRequest, VercelResponse } from '@vercel/node';

const EXTRACTION_PROMPT = `You are a factual claim extractor. Given a conversation transcript, extract every factual claim made by speakers.

A factual claim is a statement that can be checked as true or false:
- Hard facts: dates, numbers, names, events, measurements
- Common myths stated as fact
- Subjective-but-verifiable: "X is better than Y at Z" (if evidence/benchmarks exist)

Do NOT extract:
- Pure opinions ("I like pizza"), questions, predictions, hypotheticals
- Restatements of what another speaker just said
- Meta-commentary ("that's interesting", "fair enough")

Respond with ONLY a JSON array:
[{"claim": "concise restatement", "speaker": "name", "context": "short quote"}]`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required' });
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
      max_tokens: 2048,
      messages: [
        { role: 'user', content: `${EXTRACTION_PROMPT}\n\nTranscript:\n${transcript}` },
      ],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '[]';

  try {
    const claims = JSON.parse(text);
    return res.status(200).json({ claims });
  } catch {
    return res.status(200).json({ claims: [], raw: text });
  }
}
