/**
 * Watchdog QA Test Suite
 *
 * Automated tests for all API routes and core flows.
 * Requires a running dev server: `vercel dev --listen 3456`
 *
 * Usage: node tests/qa.mjs
 */

const BASE = process.env.QA_BASE_URL || 'http://localhost:3456';
const TIMEOUT = 30_000;

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}\n`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function post(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await resp.json();
    return { status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function get(path) {
  const resp = await fetch(`${BASE}${path}`);
  return { status: resp.status };
}

// ─── Validation Tests ───

async function validationTests() {
  process.stdout.write('\n\x1b[1mValidation & Error Handling\x1b[0m\n');

  await test('extract: rejects empty body', async () => {
    const { status, data } = await post('/api/extract', {});
    assert(status === 400, `expected 400, got ${status}`);
    assert(data.error === 'transcript is required', `wrong error: ${data.error}`);
  });

  await test('extract: rejects oversized transcript', async () => {
    const { status, data } = await post('/api/extract', { transcript: 'x'.repeat(16000) });
    assert(status === 400, `expected 400, got ${status}`);
    assert(data.error.includes('too long'), `wrong error: ${data.error}`);
  });

  await test('extract: rejects GET method', async () => {
    const { status } = await get('/api/extract');
    assert(status === 405, `expected 405, got ${status}`);
  });

  await test('verify: rejects empty body', async () => {
    const { status, data } = await post('/api/verify', {});
    assert(status === 400, `expected 400, got ${status}`);
    assert(data.error === 'claim is required', `wrong error: ${data.error}`);
  });

  await test('verify: rejects oversized claim', async () => {
    const { status, data } = await post('/api/verify', { claim: 'x'.repeat(2500) });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await test('classify: rejects empty body', async () => {
    const { status, data } = await post('/api/classify', {});
    assert(status === 400, `expected 400, got ${status}`);
    assert(data.error === 'command is required', `wrong error: ${data.error}`);
  });

  await test('ask: rejects empty body', async () => {
    const { status, data } = await post('/api/ask', {});
    assert(status === 400, `expected 400, got ${status}`);
    assert(data.error === 'question is required', `wrong error: ${data.error}`);
  });

  await test('ask: rejects oversized question', async () => {
    const { status, data } = await post('/api/ask', { question: 'x'.repeat(2500) });
    assert(status === 400, `expected 400, got ${status}`);
  });
}

// ─── Extract Tests ───

async function extractTests() {
  process.stdout.write('\n\x1b[1mExtract API\x1b[0m\n');

  await test('extracts factual claims from transcript', async () => {
    const { status, data } = await post('/api/extract', {
      transcript: '[Speaker 0]: The Great Wall of China is visible from space. [Speaker 1]: Einstein failed math in school.',
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(data.claims), 'claims should be an array');
    assert(data.claims.length >= 2, `expected at least 2 claims, got ${data.claims.length}`);
    for (const c of data.claims) {
      assert(c.claim && typeof c.claim === 'string', 'each claim must have a claim string');
      assert(c.speaker && typeof c.speaker === 'string', 'each claim must have a speaker');
    }
  });

  await test('returns empty claims for non-factual conversation', async () => {
    const { status, data } = await post('/api/extract', {
      transcript: '[Speaker 0]: How are you today? [Speaker 1]: I\'m doing well, thanks for asking.',
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(data.claims), 'claims should be an array');
    assert(data.claims.length === 0, `expected 0 claims, got ${data.claims.length}`);
  });
}

// ─── Verify Tests ───

async function verifyTests() {
  process.stdout.write('\n\x1b[1mVerify API\x1b[0m\n');

  const falseClaims = [
    'The Great Wall of China is visible from space with the naked eye',
    'Einstein failed math in school',
    'We only use 10 percent of our brains',
  ];

  const trueClaims = [
    'Water boils at 100 degrees Celsius at sea level',
    'The Earth orbits the Sun',
  ];

  // Run all verify requests in parallel
  const falsePromises = falseClaims.map(claim =>
    test(`verifies "${claim.slice(0, 40)}..." as FALSE/MOSTLY_FALSE`, async () => {
      const { status, data } = await post('/api/verify', { claim });
      assert(status === 200, `expected 200, got ${status}`);
      assert(data.verdict, 'response must have a verdict');
      assert(
        data.verdict === 'FALSE' || data.verdict === 'MOSTLY_FALSE',
        `expected FALSE/MOSTLY_FALSE, got ${data.verdict}`
      );
      assert(data.response && data.response.length > 0, 'must have a response');
      assert(Array.isArray(data.sources), 'must have sources array');
      assert(typeof data.confidence === 'number', 'must have confidence number');
    })
  );

  const truePromises = trueClaims.map(claim =>
    test(`verifies "${claim.slice(0, 40)}..." as TRUE/MOSTLY_TRUE`, async () => {
      const { status, data } = await post('/api/verify', { claim });
      assert(status === 200, `expected 200, got ${status}`);
      assert(
        data.verdict === 'TRUE' || data.verdict === 'MOSTLY_TRUE',
        `expected TRUE/MOSTLY_TRUE, got ${data.verdict}`
      );
    })
  );

  await Promise.all([...falsePromises, ...truePromises]);
}

// ─── Classify Tests ───

async function classifyTests() {
  process.stdout.write('\n\x1b[1mClassify API\x1b[0m\n');

  const cases = [
    { command: 'how tall is Mount Everest', expected: 'question' },
    { command: 'who founded Anthropic', expected: 'question' },
    { command: 'what did they say about AI safety', expected: 'transcript' },
    { command: 'summarize the conversation so far', expected: 'transcript' },
    { command: 'copy the transcript', expected: 'clipboard' },
    { command: 'save to clipboard', expected: 'clipboard' },
    { command: 'dark mode', expected: 'theme' },
    { command: 'switch to light mode', expected: 'theme' },
    { command: 'toggle theme', expected: 'theme' },
  ];

  // Run all classify requests in parallel
  await Promise.all(cases.map(({ command, expected }) =>
    test(`classifies "${command}" as ${expected}`, async () => {
      const { status, data } = await post('/api/classify', { command });
      assert(status === 200, `expected 200, got ${status}`);
      assert(data.intent === expected, `expected "${expected}", got "${data.intent}"`);
    })
  ));
}

// ─── Ask Tests ───

async function askTests() {
  process.stdout.write('\n\x1b[1mAsk API\x1b[0m\n');

  await test('answers factual question via web search', async () => {
    const { status, data } = await post('/api/ask', {
      question: 'who is the president of France',
      speaker: 'Speaker 0',
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(data.answer && data.answer.length > 0, 'must have an answer');
    assert(data.answer !== 'Unable to process response', `got fallback: ${data.answer}`);
    assert(/macron/i.test(data.answer), `answer should mention Macron: ${data.answer.slice(0, 80)}`);
  });

  await test('answers transcript question with context', async () => {
    const transcript = [
      '[Speaker 0]: I think AI will change healthcare.',
      '[Speaker 1]: Agreed, especially diagnostics.',
      '[Speaker 0]: But regulation is needed.',
    ].join('\n');

    const { status, data } = await post('/api/ask', {
      question: 'what did they say about AI',
      speaker: 'Speaker 0',
      transcript,
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(data.answer && data.answer.length > 0, 'must have an answer');
    assert(data.answer !== 'Unable to process response', `got fallback: ${data.answer}`);
    assert(
      /healthcare|diagnostics|regulation/i.test(data.answer),
      `answer should reference conversation topics: ${data.answer.slice(0, 100)}`
    );
  });

  await test('ask API response always has required fields', async () => {
    const { data } = await post('/api/ask', {
      question: 'what is 2+2',
      speaker: 'Speaker 0',
    });
    assert('answer' in data, 'must have answer field');
    assert('confidence' in data, 'must have confidence field');
    assert('sources' in data, 'must have sources field');
    assert(Array.isArray(data.sources), 'sources must be array');
  });
}

// ─── Full Pipeline Test ───

async function pipelineTests() {
  process.stdout.write('\n\x1b[1mFull Pipeline (Extract → Verify)\x1b[0m\n');

  await test('end-to-end: false claims detected and corrected', async () => {
    // Step 1: Extract
    const transcript = [
      '[Speaker 0]: The Great Wall of China is visible from space.',
      '[Speaker 1]: Yeah and goldfish only have a 3 second memory.',
    ].join('\n');

    const extractResult = await post('/api/extract', { transcript });
    assert(extractResult.status === 200, 'extract failed');
    const claims = extractResult.data.claims;
    assert(claims.length >= 2, `expected at least 2 claims, got ${claims.length}`);

    // Step 2: Verify all claims in parallel
    const verifyResults = await Promise.all(
      claims.map(c => post('/api/verify', { claim: c.claim, context: c.context }))
    );

    const falseCount = verifyResults.filter(r =>
      r.data.verdict === 'FALSE' || r.data.verdict === 'MOSTLY_FALSE'
    ).length;

    assert(falseCount >= 2, `expected at least 2 false verdicts, got ${falseCount}`);

    // Step 3: Verify each result has correction text
    for (const r of verifyResults) {
      if (r.data.verdict === 'FALSE' || r.data.verdict === 'MOSTLY_FALSE') {
        assert(r.data.response.length > 10, 'correction should be substantive');
      }
    }
  });

  await test('end-to-end: true claims not flagged', async () => {
    const transcript = '[Speaker 0]: Water freezes at zero degrees Celsius at standard pressure.';
    const extractResult = await post('/api/extract', { transcript });

    if (extractResult.data.claims.length > 0) {
      const verifyResults = await Promise.all(
        extractResult.data.claims.map(c => post('/api/verify', { claim: c.claim }))
      );
      const falseCount = verifyResults.filter(r =>
        r.data.verdict === 'FALSE' || r.data.verdict === 'MOSTLY_FALSE'
      ).length;
      assert(falseCount === 0, `true claim flagged as false (${falseCount} false verdicts)`);
    }
  });
}

// ─── Static Asset Tests ───

async function staticTests() {
  process.stdout.write('\n\x1b[1mStatic Assets & PWA\x1b[0m\n');

  const assets = ['/', '/manifest.json', '/dog1.png', '/dog2.png', '/dog3.png'];
  await Promise.all(assets.map(path =>
    test(`serves ${path}`, async () => {
      const resp = await fetch(`${BASE}${path}`);
      assert(resp.ok, `expected 200 for ${path}, got ${resp.status}`);
    })
  ));

  await test('manifest has correct fields', async () => {
    const resp = await fetch(`${BASE}/manifest.json`);
    const manifest = await resp.json();
    assert(manifest.name === 'Watchdog', `wrong name: ${manifest.name}`);
    assert(manifest.display === 'standalone', `wrong display: ${manifest.display}`);
    assert(manifest.icons.length >= 2, 'should have at least 2 icons');
    assert(manifest.background_color === '#ffffff', `wrong bg color: ${manifest.background_color}`);
  });
}

// ─── Run All ───

async function main() {
  process.stdout.write(`\n\x1b[1;36mWatchdog QA Suite\x1b[0m — testing against ${BASE}\n`);

  // Check server is up
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(3000) });
  } catch {
    process.stdout.write(`\n\x1b[31mError: Server not running at ${BASE}\x1b[0m\n`);
    process.stdout.write(`Start it with: vercel dev --listen 3456\n\n`);
    process.exit(1);
  }

  // Run fast tests first, then slow (API) tests
  await validationTests();
  await staticTests();

  // These hit real APIs — run them with controlled parallelism
  await classifyTests();
  await extractTests();
  await askTests();
  await verifyTests();
  await pipelineTests();

  // Summary
  const total = passed + failed;
  process.stdout.write(`\n\x1b[1m${passed}/${total} passed\x1b[0m`);
  if (failed > 0) {
    process.stdout.write(` \x1b[31m(${failed} failed)\x1b[0m`);
  }
  process.stdout.write('\n\n');

  if (failures.length > 0) {
    process.stdout.write('\x1b[31mFailures:\x1b[0m\n');
    for (const f of failures) {
      process.stdout.write(`  ${f.name}: ${f.error}\n`);
    }
    process.stdout.write('\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
