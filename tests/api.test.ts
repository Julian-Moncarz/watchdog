import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic API at the fetch level — handlers use global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set required env vars before importing handlers
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.DEEPGRAM_API_KEY = 'test-dg-key';

// Helper: create mock Vercel req/res
function mockReqRes(method: string, body: Record<string, unknown> = {}) {
  const req = { method, body } as any;
  const res = {
    _status: 0,
    _body: null as any,
    status(code: number) { this._status = code; return this; },
    json(data: any) { this._body = data; return this; },
  };
  return { req, res };
}

// Helper: mock Anthropic API response with text content
function anthropicResponse(text: string, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({
      content: [{ type: 'text', text }],
    }),
  });
}

// Helper: mock Anthropic API response with multiple content blocks (e.g. web search + text)
function anthropicResponseBlocks(blocks: { type: string; text?: string }[], ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ content: blocks }),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// --- /api/extract ---

describe('/api/extract', () => {
  let handler: (req: any, res: any) => Promise<any>;

  beforeEach(async () => {
    handler = (await import('../api/extract.ts')).default;
  });

  it('rejects non-POST', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  it('rejects missing transcript', async () => {
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('rejects transcript over 15000 chars', async () => {
    const { req, res } = mockReqRes('POST', { transcript: 'x'.repeat(15001) });
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('returns extracted claims on success', async () => {
    const claims = [{ claim: 'Earth is flat', speaker: 'Speaker 0', context: 'Earth is flat' }];
    mockFetch.mockReturnValueOnce(anthropicResponse(JSON.stringify(claims)));

    const { req, res } = mockReqRes('POST', { transcript: '[Speaker 0]: The Earth is flat.' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.claims).toEqual(claims);
  });

  it('returns empty claims when model returns non-JSON', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('I found no claims.'));

    const { req, res } = mockReqRes('POST', { transcript: 'Hello there.' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.claims).toEqual([]);
    expect(res._body.raw).toBeDefined();
  });

  it('handles markdown-fenced JSON from model', async () => {
    const claims = [{ claim: 'test', speaker: 'S', context: 'c' }];
    mockFetch.mockReturnValueOnce(anthropicResponse('```json\n' + JSON.stringify(claims) + '\n```'));

    const { req, res } = mockReqRes('POST', { transcript: 'some text' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.claims).toEqual(claims);
  });

  it('sends prior_context to Anthropic when provided', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('[]'));

    const { req, res } = mockReqRes('POST', {
      transcript: 'new stuff',
      prior_context: 'old stuff',
    });
    await handler(req, res);

    // Verify the request body sent to Anthropic includes prior context
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.messages[0].content).toContain('PRIOR CONTEXT');
    expect(fetchBody.messages[0].content).toContain('old stuff');
  });
});

// --- /api/verify ---

describe('/api/verify', () => {
  let handler: (req: any, res: any) => Promise<any>;

  beforeEach(async () => {
    handler = (await import('../api/verify.ts')).default;
  });

  it('rejects non-POST', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  it('rejects missing claim', async () => {
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('rejects claim over 2000 chars', async () => {
    const { req, res } = mockReqRes('POST', { claim: 'x'.repeat(2001) });
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('returns verification result on success', async () => {
    const result = { verdict: 'FALSE', confidence: 0.95, response: 'Earth is not flat.', sources: ['https://nasa.gov'] };
    mockFetch.mockReturnValueOnce(anthropicResponse(JSON.stringify(result)));

    const { req, res } = mockReqRes('POST', { claim: 'Earth is flat' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.verdict).toBe('FALSE');
    expect(res._body.confidence).toBe(0.95);
  });

  it('returns all 5 verdict types correctly', async () => {
    for (const verdict of ['TRUE', 'FALSE', 'MOSTLY_TRUE', 'MOSTLY_FALSE', 'UNVERIFIABLE']) {
      mockFetch.mockReset();
      const result = { verdict, confidence: 0.8, response: 'test', sources: [] };
      mockFetch.mockReturnValueOnce(anthropicResponse(JSON.stringify(result)));

      const { req, res } = mockReqRes('POST', { claim: 'test claim' });
      await handler(req, res);

      expect(res._body.verdict).toBe(verdict);
    }
  });

  it('returns UNVERIFIABLE on Anthropic API error', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('', false));

    const { req, res } = mockReqRes('POST', { claim: 'test' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.verdict).toBe('UNVERIFIABLE');
    expect(res._body.confidence).toBe(0);
  });

  it('returns UNVERIFIABLE on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const { req, res } = mockReqRes('POST', { claim: 'test' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.verdict).toBe('UNVERIFIABLE');
  });

  it('handles web search response with multiple content blocks', async () => {
    const result = { verdict: 'TRUE', confidence: 0.9, response: 'Correct.', sources: [] };
    mockFetch.mockReturnValueOnce(anthropicResponseBlocks([
      { type: 'tool_use' },                         // web search tool use block
      { type: 'text', text: JSON.stringify(result) }, // actual result
    ]));

    const { req, res } = mockReqRes('POST', { claim: 'test' });
    await handler(req, res);

    expect(res._body.verdict).toBe('TRUE');
  });

  it('includes web_search tool in Anthropic request', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('{"verdict":"TRUE","confidence":0.9,"response":"ok","sources":[]}'));

    const { req, res } = mockReqRes('POST', { claim: 'test' });
    await handler(req, res);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.tools).toBeDefined();
    expect(fetchBody.tools[0].type).toBe('web_search_20250305');
  });
});

// --- /api/classify ---

describe('/api/classify', () => {
  let handler: (req: any, res: any) => Promise<any>;

  beforeEach(async () => {
    handler = (await import('../api/classify.ts')).default;
  });

  it('rejects non-POST', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  it('rejects missing command', async () => {
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('classifies as question', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('question'));
    const { req, res } = mockReqRes('POST', { command: 'how tall is Everest' });
    await handler(req, res);
    expect(res._body.intent).toBe('question');
  });

  it('classifies as transcript', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('transcript'));
    const { req, res } = mockReqRes('POST', { command: 'summarize the conversation' });
    await handler(req, res);
    expect(res._body.intent).toBe('transcript');
  });

  it('classifies as clipboard', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('clipboard'));
    const { req, res } = mockReqRes('POST', { command: 'copy transcript' });
    await handler(req, res);
    expect(res._body.intent).toBe('clipboard');
  });

  it('classifies as theme', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('theme'));
    const { req, res } = mockReqRes('POST', { command: 'dark mode' });
    await handler(req, res);
    expect(res._body.intent).toBe('theme');
  });

  it('defaults to question for unknown response', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('something_weird'));
    const { req, res } = mockReqRes('POST', { command: 'random input' });
    await handler(req, res);
    expect(res._body.intent).toBe('question');
  });

  it('only returns valid intents', async () => {
    const validIntents = ['question', 'transcript', 'clipboard', 'theme'];
    for (const intent of validIntents) {
      mockFetch.mockReset();
      mockFetch.mockReturnValueOnce(anthropicResponse(intent));
      const { req, res } = mockReqRes('POST', { command: 'test' });
      await handler(req, res);
      expect(validIntents).toContain(res._body.intent);
    }
  });
});

// --- /api/ask ---

describe('/api/ask', () => {
  let handler: (req: any, res: any) => Promise<any>;

  beforeEach(async () => {
    handler = (await import('../api/ask.ts')).default;
  });

  it('rejects non-POST', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  it('rejects missing question', async () => {
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('returns answer on success (web search mode)', async () => {
    const result = { answer: 'Mount Everest is 8849m tall.', confidence: 0.95, sources: ['https://example.com'] };
    mockFetch.mockReturnValueOnce(anthropicResponse(JSON.stringify(result)));

    const { req, res } = mockReqRes('POST', { question: 'How tall is Everest?', speaker: 'Speaker 0' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.answer).toBe('Mount Everest is 8849m tall.');
    expect(res._body.sources).toHaveLength(1);
  });

  it('includes web_search tool when no transcript', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('{"answer":"test","confidence":0.5,"sources":[]}'));

    const { req, res } = mockReqRes('POST', { question: 'test', speaker: 'S' });
    await handler(req, res);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.tools).toBeDefined();
    expect(fetchBody.tools[0].type).toBe('web_search_20250305');
  });

  it('does NOT include web_search when transcript is provided', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('{"answer":"from transcript","confidence":0.8,"sources":[]}'));

    const { req, res } = mockReqRes('POST', {
      question: 'what did they say?',
      speaker: 'Speaker 0',
      transcript: '[Speaker 0]: Hello\n[Speaker 1]: World',
    });
    await handler(req, res);

    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.tools).toBeUndefined();
  });

  it('falls back to raw text when model returns non-JSON', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('The answer is 42.'));

    const { req, res } = mockReqRes('POST', { question: 'test', speaker: 'S' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.answer).toBe('The answer is 42.');
    expect(res._body.confidence).toBe(0.5);
  });

  it('returns graceful error on Anthropic failure', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('', false));

    const { req, res } = mockReqRes('POST', { question: 'test', speaker: 'S' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confidence).toBe(0);
  });

  it('returns graceful error on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const { req, res } = mockReqRes('POST', { question: 'test', speaker: 'S' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confidence).toBe(0);
  });

  it('strips citation tags in fallback mode', async () => {
    mockFetch.mockReturnValueOnce(anthropicResponse('The <cite>source</cite> says yes.'));

    const { req, res } = mockReqRes('POST', { question: 'test', speaker: 'S' });
    await handler(req, res);

    expect(res._body.answer).not.toContain('<cite');
    expect(res._body.answer).toContain('source');
  });
});
