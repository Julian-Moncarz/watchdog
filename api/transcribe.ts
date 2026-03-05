import type { VercelRequest, VercelResponse } from '@vercel/node';

// This endpoint returns a temporary Deepgram auth token for the client to use
// in a direct WebSocket connection. This avoids proxying audio through our server.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Deepgram API key not configured' });
  }

  // Create a temporary API key scoped to usage:write (transcription only)
  const response = await fetch('https://api.deepgram.com/v1/keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${apiKey}`,
    },
    body: JSON.stringify({
      comment: 'Watchdog temporary key',
      scopes: ['usage:write'],
      time_to_live_in_seconds: 60,
    }),
  });

  if (!response.ok) {
    // Fallback: return connection details for client-side WebSocket
    return res.status(200).json({
      url: 'wss://api.deepgram.com/v1/listen',
      params: {
        model: 'nova-3',
        language: 'en',
        smart_format: true,
        diarize: true,
        interim_results: true,
        utterance_end_ms: 1500,
      },
    });
  }

  const data = await response.json();
  return res.status(200).json({
    key: data.key,
    url: 'wss://api.deepgram.com/v1/listen',
    params: {
      model: 'nova-3',
      language: 'en',
      smart_format: true,
      diarize: true,
      interim_results: true,
      utterance_end_ms: 1500,
    },
  });
}
