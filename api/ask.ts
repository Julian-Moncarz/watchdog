import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractJsonFromContentBlocks } from '../src/lib/parse.ts';

const SEARCH_PROMPT = `You are Watchdog. Answer the user's question using web search. You answer ANY question — factual, subjective, or opinion-based. For subjective questions, present the prevailing perspectives and evidence. Never refuse to answer.

Respond with ONLY JSON (no markdown, no code fences):
{
  "answer": "Clear, concise answer in 1-3 sentences. If you're confident, just state the answer. If uncertain, briefly note why (e.g. 'reports vary', 'not yet confirmed'). For opinion questions, summarize the main viewpoints.",
  "confidence": 0.0 to 1.0,
  "sources": ["https://..."]
}

For sources: 2-3 most relevant URLs.`;

const TRANSCRIPT_PROMPT = `You are Watchdog, an AI assistant embedded in a live conversation. The user has asked a question about the conversation.

Below is the transcript of the conversation so far, and any corrections Watchdog has already made. Answer the question based on this context. Refer to the person who asked as "you".

Respond with ONLY JSON (no markdown, no code fences):
{
  "answer": "Answer thoroughly. Be as long as needed to fully address the question.",
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
  const systemPrompt = hasTranscript ? TRANSCRIPT_PROMPT : SEARCH_PROMPT;

  let userContent = '';
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
    system: systemPrompt,
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

  let data: any;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(200).json({
        answer: `I couldn't answer that question right now.`,
        confidence: 0,
        sources: [],
      });
    }
  } catch (err) {
    console.error('Anthropic fetch failed:', err);
    return res.status(200).json({
      answer: `I couldn't reach the search service. Try again.`,
      confidence: 0,
      sources: [],
    });
  }

  const parsed = extractJsonFromContentBlocks(data.content ?? []) as { answer?: string } | null;
  if (parsed?.answer) return res.status(200).json(parsed);

  // Fallback: use raw text as the answer (model refused JSON or gave plain text)
  const textBlocks = (data.content ?? []).filter((b: any) => b.type === 'text');
  const fallbackText = textBlocks.map((b: any) => b.text).join(' ').trim();
  if (fallbackText) {
    // Strip citation tags from fallback text
    const cleaned = fallbackText.replace(/<\/?cite[^>]*>/g, '');
    return res.status(200).json({ answer: cleaned, confidence: 0.5, sources: [] });
  }

  // Last resort: model returned no text at all (e.g. only tool_use blocks with no text)
  return res.status(200).json({
    answer: `I couldn't find an answer to that question.`,
    confidence: 0,
    sources: [],
  });
}
