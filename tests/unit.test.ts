import { describe, it, expect } from 'vitest';
import {
  TRIGGER, getCacheKey, shouldTriggerChime, isFlagged,
  calculateTranscriptDelta, buildPriorContext, mergeAndSortFeed,
  matchTrigger, esc, stripCitations, safeUrl, domain,
} from '../src/lib/pipeline.ts';
import {
  stripMarkdownFences, extractJsonObject, extractJsonArray,
  extractJsonFromContentBlocks,
} from '../src/lib/parse.ts';
import type { CheckedClaim, QuestionAnswer, Verdict } from '../src/lib/types.ts';

// --- Trigger regex ---

describe('TRIGGER regex', () => {
  const shouldMatch = [
    'Watchdog what time is it',
    'watchdog how tall is Everest',
    'WATCHDOG copy transcript',
    'watch dog what is this',
    'Hey watchdog, tell me',
    'watchdog. hello',
    'watchdog! something',
    'watchdog? really',
  ];
  const shouldNotMatch = [
    'The watchdogs are barking',      // plural — different word
    'I love my dog',
    'watch the dog run',              // separate words, not compound
    'hotdog stand',
    '',
  ];

  for (const text of shouldMatch) {
    it(`matches: "${text}"`, () => {
      expect(TRIGGER.test(text)).toBe(true);
    });
  }
  for (const text of shouldNotMatch) {
    it(`does not match: "${text}"`, () => {
      expect(TRIGGER.test(text)).toBe(false);
    });
  }
});

describe('matchTrigger', () => {
  it('extracts command after trigger word', () => {
    const result = matchTrigger('Watchdog what is the capital of France');
    expect(result.matched).toBe(true);
    expect(result.command).toBe('what is the capital of France');
  });

  it('strips leading punctuation from command', () => {
    const result = matchTrigger('watchdog, what time is it');
    expect(result.matched).toBe(true);
    expect(result.command).toBe('what time is it');
  });

  it('returns empty command when trigger is alone', () => {
    const result = matchTrigger('Watchdog');
    expect(result.matched).toBe(true);
    expect(result.command).toBe('');
  });

  it('returns not matched for non-trigger text', () => {
    const result = matchTrigger('hello world');
    expect(result.matched).toBe(false);
    expect(result.command).toBe('');
  });
});

// --- Cache key ---

describe('getCacheKey', () => {
  it('lowercases and trims', () => {
    expect(getCacheKey('  Einstein Failed Math  ')).toBe('einstein failed math');
  });

  it('produces same key for same claim with different casing', () => {
    expect(getCacheKey('GPT-4 has 1.8T params')).toBe(getCacheKey('gpt-4 has 1.8t params'));
  });
});

// --- Verdict logic ---

describe('shouldTriggerChime / isFlagged', () => {
  const chimeVerdicts: Verdict[] = ['FALSE', 'MOSTLY_FALSE'];
  const noChimeVerdicts: Verdict[] = ['TRUE', 'MOSTLY_TRUE', 'UNVERIFIABLE'];

  for (const v of chimeVerdicts) {
    it(`triggers chime for ${v}`, () => {
      expect(shouldTriggerChime(v)).toBe(true);
      expect(isFlagged(v)).toBe(true);
    });
  }
  for (const v of noChimeVerdicts) {
    it(`does not trigger chime for ${v}`, () => {
      expect(shouldTriggerChime(v)).toBe(false);
      expect(isFlagged(v)).toBe(false);
    });
  }
});

// --- Transcript delta ---

describe('calculateTranscriptDelta', () => {
  it('returns new text after processed portion', () => {
    const full = 'line one\nline two\nline three';
    const processed = 'line one\nline two';
    expect(calculateTranscriptDelta(full, processed)).toBe('line three');
  });

  it('returns empty string when nothing new', () => {
    expect(calculateTranscriptDelta('same text', 'same text')).toBe('');
  });

  it('returns full text when nothing processed yet', () => {
    expect(calculateTranscriptDelta('hello world', '')).toBe('hello world');
  });
});

// --- Prior context ---

describe('buildPriorContext', () => {
  it('returns last 2 chunks by default', () => {
    const chunks = ['chunk1', 'chunk2', 'chunk3', 'chunk4'];
    expect(buildPriorContext(chunks)).toBe('chunk3\nchunk4');
  });

  it('returns all chunks if fewer than window size', () => {
    expect(buildPriorContext(['only'])).toBe('only');
  });

  it('returns empty string for empty chunks', () => {
    expect(buildPriorContext([])).toBe('');
  });

  it('respects custom window size', () => {
    const chunks = ['a', 'b', 'c', 'd'];
    expect(buildPriorContext(chunks, 3)).toBe('b\nc\nd');
  });
});

// --- Feed merge + sort ---

describe('mergeAndSortFeed', () => {
  const makeClaim = (id: string, verdict: Verdict, ts: number): CheckedClaim => ({
    id, claim: `claim ${id}`, speaker: 'Speaker 0', context: '',
    verification: { verdict, confidence: 0.9, response: '', sources: [] },
    timestamp: ts,
  });
  const makeAnswer = (id: string, ts: number): QuestionAnswer => ({
    id, question: `q ${id}`, answer: 'a', confidence: 0.9, sources: [], timestamp: ts,
  });

  it('only includes FALSE/MOSTLY_FALSE claims, not TRUE', () => {
    const claims = [
      makeClaim('1', 'FALSE', 100),
      makeClaim('2', 'TRUE', 200),
      makeClaim('3', 'MOSTLY_FALSE', 300),
      makeClaim('4', 'MOSTLY_TRUE', 400),
    ];
    const feed = mergeAndSortFeed(claims, []);
    expect(feed).toHaveLength(2);
    expect(feed.map(f => (f.item as CheckedClaim).id)).toEqual(['3', '1']);
  });

  it('sorts by timestamp descending (newest first)', () => {
    const claims = [makeClaim('1', 'FALSE', 100)];
    const answers = [makeAnswer('a', 200), makeAnswer('b', 50)];
    const feed = mergeAndSortFeed(claims, answers);
    expect(feed.map(f => f.item.timestamp)).toEqual([200, 100, 50]);
  });

  it('interleaves claims and answers by timestamp', () => {
    const claims = [makeClaim('c1', 'FALSE', 150)];
    const answers = [makeAnswer('a1', 200), makeAnswer('a2', 100)];
    const feed = mergeAndSortFeed(claims, answers);
    expect(feed.map(f => f.type)).toEqual(['answer', 'claim', 'answer']);
  });

  it('returns empty array when no flagged claims and no answers', () => {
    const claims = [makeClaim('1', 'TRUE', 100)];
    expect(mergeAndSortFeed(claims, [])).toEqual([]);
  });
});

// --- HTML escaping ---

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });
});

// --- Citation stripping ---

describe('stripCitations', () => {
  it('removes cite tags', () => {
    expect(stripCitations('Hello <cite>source</cite> world')).toBe('Hello source world');
  });

  it('removes self-closing and attributed cite tags', () => {
    expect(stripCitations('<cite class="foo">text</cite>')).toBe('text');
  });

  it('leaves non-cite HTML alone', () => {
    expect(stripCitations('<b>bold</b>')).toBe('<b>bold</b>');
  });
});

// --- URL utilities ---

describe('safeUrl', () => {
  it('allows https URLs', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('allows http URLs', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('blocks javascript: URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
  });

  it('blocks data: URLs', () => {
    expect(safeUrl('data:text/html,<h1>hi</h1>')).toBe('#');
  });

  it('returns # for invalid URLs', () => {
    expect(safeUrl('not a url')).toBe('#');
  });
});

describe('domain', () => {
  it('extracts hostname without www', () => {
    expect(domain('https://www.example.com/path')).toBe('example.com');
  });

  it('keeps non-www subdomains', () => {
    expect(domain('https://api.example.com')).toBe('api.example.com');
  });

  it('returns raw string for invalid URL', () => {
    expect(domain('not-a-url')).toBe('not-a-url');
  });
});

// --- JSON parsing (shared parse.ts) ---

describe('stripMarkdownFences', () => {
  it('strips ```json fences', () => {
    expect(stripMarkdownFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('strips bare ``` fences', () => {
    expect(stripMarkdownFences('```\n[1,2,3]\n```')).toBe('[1,2,3]');
  });

  it('returns text unchanged when no fences', () => {
    expect(stripMarkdownFences('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe('extractJsonObject', () => {
  it('extracts JSON object from plain text', () => {
    expect(extractJsonObject('{"verdict": "TRUE", "confidence": 0.9}')).toEqual({
      verdict: 'TRUE', confidence: 0.9,
    });
  });

  it('extracts JSON from text with surrounding prose', () => {
    expect(extractJsonObject('Here is the result: {"a": 1} hope that helps')).toEqual({ a: 1 });
  });

  it('extracts JSON from markdown fences', () => {
    expect(extractJsonObject('```json\n{"b": 2}\n```')).toEqual({ b: 2 });
  });

  it('returns null for no JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractJsonObject('{invalid json}')).toBeNull();
  });
});

describe('extractJsonArray', () => {
  it('parses a JSON array', () => {
    expect(extractJsonArray('[{"claim": "test"}]')).toEqual([{ claim: 'test' }]);
  });

  it('parses array from markdown fences', () => {
    expect(extractJsonArray('```json\n[1, 2, 3]\n```')).toEqual([1, 2, 3]);
  });

  it('returns null for non-array JSON', () => {
    expect(extractJsonArray('{"not": "array"}')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractJsonArray('not json')).toBeNull();
  });

  it('returns empty array for empty array', () => {
    expect(extractJsonArray('[]')).toEqual([]);
  });
});

describe('extractJsonFromContentBlocks', () => {
  it('extracts from first text block with valid JSON', () => {
    const blocks = [
      { type: 'text', text: '{"verdict": "FALSE", "confidence": 0.95, "response": "Wrong", "sources": []}' },
    ];
    expect(extractJsonFromContentBlocks(blocks)).toEqual({
      verdict: 'FALSE', confidence: 0.95, response: 'Wrong', sources: [],
    });
  });

  it('skips non-text blocks', () => {
    const blocks = [
      { type: 'tool_use', text: undefined },
      { type: 'text', text: '{"a": 1}' },
    ];
    expect(extractJsonFromContentBlocks(blocks)).toEqual({ a: 1 });
  });

  it('tries subsequent blocks if first fails', () => {
    const blocks = [
      { type: 'text', text: 'no json here' },
      { type: 'text', text: '{"found": true}' },
    ];
    expect(extractJsonFromContentBlocks(blocks)).toEqual({ found: true });
  });

  it('returns null when no blocks have JSON', () => {
    const blocks = [
      { type: 'text', text: 'just plain text' },
    ];
    expect(extractJsonFromContentBlocks(blocks)).toBeNull();
  });

  it('handles markdown fences in content blocks', () => {
    const blocks = [
      { type: 'text', text: '```json\n{"fenced": true}\n```' },
    ];
    expect(extractJsonFromContentBlocks(blocks)).toEqual({ fenced: true });
  });

  it('returns null for empty content array', () => {
    expect(extractJsonFromContentBlocks([])).toBeNull();
  });
});
