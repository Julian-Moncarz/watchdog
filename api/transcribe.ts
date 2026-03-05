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

  const wsParams = {
    model: 'nova-3',
    language: 'en',
    smart_format: true,
    diarize: true,
    interim_results: true,
    utterance_end_ms: 1500,
  };

  // Get project ID first
  const projResp = await fetch('https://api.deepgram.com/v1/projects', {
    headers: { 'Authorization': `Token ${apiKey}` },
  });

  if (!projResp.ok) {
    return res.status(500).json({ error: 'Failed to fetch Deepgram projects' });
  }

  const projData = await projResp.json();
  const projectId = projData.projects?.[0]?.project_id;
  if (!projectId) {
    return res.status(500).json({ error: 'No Deepgram project found' });
  }

  // Create a temporary API key scoped to usage:write (transcription only)
  const keyResp = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
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

  if (!keyResp.ok) {
    const errBody = await keyResp.text();
    console.error('Deepgram key creation failed:', keyResp.status, errBody);
    return res.status(500).json({ error: 'Failed to create temporary Deepgram key' });
  }

  const keyData = await keyResp.json();
  return res.status(200).json({
    key: keyData.key,
    url: 'wss://api.deepgram.com/v1/listen',
    params: wsParams,
  });
}
