/**
 * Watchdog Prompt Eval Harness
 *
 * Tests the two-stage pipeline (extract → verify) against annotated transcripts.
 * Runs all transcripts in parallel, claims within each transcript in parallel.
 *
 * Usage: node tests/eval.mjs [--extract-only] [--verify-only] [--transcript 01]
 */

import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const client = new Anthropic();

// ── Prompts ──────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a factual claim extractor. Given a conversation transcript, extract ALL factual claims made by speakers.

A factual claim is any statement that can be verified as true or false. This includes:
- Hard facts (dates, numbers, names, events)
- Commonly believed "facts" that may be myths
- Subjective-but-verifiable claims (e.g. "X is better than Y at Z" — if benchmarks exist)
- Approximate numbers or dates presented as fact

Do NOT extract:
- Pure opinions with no verifiable component ("I like pizza")
- Questions without assertions
- Future predictions
- Hypotheticals

For each claim, extract:
1. The exact factual assertion (restate it clearly and concisely)
2. The speaker who made it
3. Whether it was presented as certain, approximate, or hedged

Respond with a JSON array. Each element:
{
  "claim": "clear restatement of the factual claim",
  "speaker": "speaker name",
  "confidence": "certain" | "approximate" | "hedged",
  "context": "brief quote from transcript for traceability"
}

Be thorough. Extract EVERY factual claim, even if it seems obviously true. Do not skip claims just because another speaker corrected them — the original wrong claim still needs to be extracted.`;

const VERIFICATION_PROMPT = `You are a fact-checker. You will receive a factual claim from a conversation. Your job is to verify whether it is true, false, or somewhere in between.

Use web search to verify the claim. Search for authoritative sources.

Respond with JSON:
{
  "verdict": "TRUE" | "FALSE" | "MOSTLY_TRUE" | "MOSTLY_FALSE" | "UNVERIFIABLE",
  "confidence": 0.0 to 1.0,
  "explanation": "Brief explanation with key evidence",
  "sources": ["source descriptions"],
  "correction": "If false/mostly false, what is the correct information? null if true."
}

Rules:
- Use "TRUE" for claims that are factually correct
- Use "FALSE" for claims that are clearly wrong
- Use "MOSTLY_TRUE" for claims that are approximately right but have minor inaccuracies
- Use "MOSTLY_FALSE" for claims that have a kernel of truth but are substantially wrong
- Use "UNVERIFIABLE" only if you genuinely cannot determine truth after searching
- Be precise about numbers — if someone says "500 million" and the real number is "650 million", that may still be MOSTLY_TRUE depending on context
- For subjective-but-verifiable claims, assess based on available evidence/benchmarks
- Common myths should be marked FALSE even if widely believed

The claim to verify:`;

// ── Stage 1: Extract claims ─────────────────────────────────────────────────

async function extractClaims(transcript) {
  const formattedTranscript = transcript
    .map((t) => `[${t.speaker}]: ${t.text}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\n--- TRANSCRIPT ---\n${formattedTranscript}\n--- END TRANSCRIPT ---\n\nExtract all factual claims as JSON array:`,
      },
    ],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in extraction response");
  return JSON.parse(jsonMatch[0]);
}

// ── Stage 2: Verify a single claim ─────────────────────────────────────────

async function verifyClaim(claim) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
      },
    ],
    messages: [
      {
        role: "user",
        content: `${VERIFICATION_PROMPT}\n\n"${claim.claim}" (said by ${claim.speaker})`,
      },
    ],
  });

  // Find the text block with JSON in the response
  for (const block of response.content) {
    if (block.type === "text") {
      const jsonMatch = block.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // continue looking
        }
      }
    }
  }
  return { verdict: "ERROR", explanation: "Could not parse verification response" };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function normalizeVerdict(v) {
  v = v.toUpperCase().replace(/[_-]/g, "");
  if (v === "TRUE" || v === "CORRECT") return "TRUE";
  if (v === "FALSE" || v === "INCORRECT" || v === "WRONG") return "FALSE";
  if (["MOSTLYTRUE", "APPROXIMATELYTRUE", "PARTIALLYTRUE"].includes(v))
    return "MOSTLY_TRUE";
  if (["MOSTLYFALSE", "PARTIALLYFALSE"].includes(v)) return "MOSTLY_FALSE";
  if (["SUBJECTIVE", "DISPUTED"].includes(v)) return "SUBJECTIVE";
  if (["UNVERIFIED", "UNVERIFIABLE"].includes(v)) return "UNVERIFIABLE";
  return v;
}

function verdictsMatch(actual, expected) {
  const a = normalizeVerdict(actual);
  const e = normalizeVerdict(expected);

  // Exact match
  if (a === e) return "exact";

  // Close enough matches
  const closeMatches = [
    ["TRUE", "MOSTLY_TRUE"],
    ["MOSTLY_TRUE", "TRUE"],
    ["FALSE", "MOSTLY_FALSE"],
    ["MOSTLY_FALSE", "FALSE"],
    ["SUBJECTIVE", "UNVERIFIABLE"],
    ["UNVERIFIABLE", "SUBJECTIVE"],
    ["MOSTLY_TRUE", "SUBJECTIVE"],
  ];

  if (closeMatches.some(([x, y]) => a === x && e === y)) return "close";

  // Critical failure: TRUE vs FALSE or vice versa
  if (
    (a === "TRUE" && e === "FALSE") ||
    (a === "FALSE" && e === "TRUE") ||
    (a === "MOSTLY_TRUE" && e === "FALSE") ||
    (a === "FALSE" && e === "MOSTLY_TRUE")
  )
    return "critical_fail";

  return "mismatch";
}

// ── Main ────────────────────────────────────────────────────────────────────

async function evalTranscript(filePath) {
  const data = JSON.parse(await readFile(filePath, "utf8"));
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Evaluating: ${data.id} — ${data.description}`);
  console.log(`${"=".repeat(60)}`);

  // Stage 1: Extract
  console.log(`\n[Stage 1] Extracting claims...`);
  const extracted = await extractClaims(data.transcript);
  console.log(`  Extracted ${extracted.length} claims (expected: ${data.expected_claims.length})`);

  // Stage 2: Verify (parallel, batched to avoid rate limits)
  console.log(`\n[Stage 2] Verifying ${extracted.length} claims...`);
  const BATCH_SIZE = 5;
  const verifications = [];
  for (let i = 0; i < extracted.length; i += BATCH_SIZE) {
    const batch = extracted.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((c) => verifyClaim(c)));
    verifications.push(...results);
    process.stdout.write(`  Verified ${Math.min(i + BATCH_SIZE, extracted.length)}/${extracted.length}\r`);
  }
  console.log();

  // Score against expected
  console.log(`\n[Scoring]`);
  const results = [];
  let exact = 0, close = 0, mismatch = 0, critical = 0, unmatched = 0;

  for (let i = 0; i < extracted.length; i++) {
    const claim = extracted[i];
    const verification = verifications[i];

    // Find best matching expected claim
    const expectedMatch = findBestMatch(claim.claim, data.expected_claims);

    if (!expectedMatch) {
      unmatched++;
      results.push({
        claim: claim.claim,
        speaker: claim.speaker,
        got: verification.verdict,
        expected: "N/A (no match in expected)",
        match: "unmatched",
        explanation: verification.explanation,
      });
      continue;
    }

    const match = verdictsMatch(verification.verdict, expectedMatch.verdict);
    if (match === "exact") exact++;
    else if (match === "close") close++;
    else if (match === "critical_fail") critical++;
    else mismatch++;

    const icon =
      match === "exact" ? "✓" :
      match === "close" ? "~" :
      match === "critical_fail" ? "✗✗" : "✗";

    results.push({
      claim: claim.claim,
      speaker: claim.speaker,
      got: verification.verdict,
      expected: expectedMatch.verdict,
      match,
      explanation: verification.explanation,
      correction: verification.correction,
    });

    if (match !== "exact") {
      console.log(`  ${icon} "${claim.claim.substring(0, 60)}..."`);
      console.log(`    Got: ${verification.verdict} | Expected: ${expectedMatch.verdict}`);
      if (verification.explanation) {
        console.log(`    Reason: ${verification.explanation.substring(0, 100)}`);
      }
    }
  }

  const total = extracted.length;
  const accuracy = ((exact + close) / Math.max(total, 1) * 100).toFixed(1);
  const extractionCoverage = ((total / data.expected_claims.length) * 100).toFixed(1);

  console.log(`\n[Results for ${data.id}]`);
  console.log(`  Extraction: ${total} found / ${data.expected_claims.length} expected (${extractionCoverage}% coverage)`);
  console.log(`  Verification accuracy: ${accuracy}% (${exact} exact + ${close} close / ${total})`);
  console.log(`  Critical failures (TRUE↔FALSE): ${critical}`);
  console.log(`  Mismatches: ${mismatch}`);
  console.log(`  Unmatched claims: ${unmatched}`);

  return { id: data.id, total, expected: data.expected_claims.length, exact, close, mismatch, critical, unmatched, accuracy, extractionCoverage, results };
}

function findBestMatch(claimText, expectedClaims) {
  const claimLower = claimText.toLowerCase();
  let bestScore = 0;
  let bestMatch = null;

  for (const expected of expectedClaims) {
    const expLower = expected.text.toLowerCase();
    // Simple word overlap scoring
    const claimWords = new Set(claimLower.split(/\s+/).filter((w) => w.length > 3));
    const expWords = new Set(expLower.split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...claimWords].filter((w) => expWords.has(w)).length;
    const score = overlap / Math.max(claimWords.size, expWords.size, 1);
    if (score > bestScore && score > 0.3) {
      bestScore = score;
      bestMatch = expected;
    }
  }
  return bestMatch;
}

// ── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const transcriptFilter = args.find((a) => !a.startsWith("--"))
  || args[args.indexOf("--transcript") + 1];

const transcriptDir = join(import.meta.dirname, "transcripts");
let files = (await readdir(transcriptDir)).filter((f) => f.endsWith(".json")).sort();

if (transcriptFilter) {
  files = files.filter((f) => f.includes(transcriptFilter));
}

console.log(`Watchdog Eval Harness — ${files.length} transcript(s)`);
console.log(`Model: claude-haiku-4-5-20251001 (extraction + verification w/ web search)`);

// Run transcripts sequentially to keep output readable, claims within each in parallel
const allResults = [];
for (const file of files) {
  const result = await evalTranscript(join(transcriptDir, file));
  allResults.push(result);
}

// Summary
console.log(`\n${"=".repeat(60)}`);
console.log("OVERALL SUMMARY");
console.log(`${"=".repeat(60)}`);

let totalClaims = 0, totalExpected = 0, totalExact = 0, totalClose = 0, totalCritical = 0, totalMismatch = 0;
for (const r of allResults) {
  totalClaims += r.total;
  totalExpected += r.expected;
  totalExact += r.exact;
  totalClose += r.close;
  totalCritical += r.critical;
  totalMismatch += r.mismatch;
  console.log(`  ${r.id}: ${r.accuracy}% accuracy, ${r.extractionCoverage}% extraction coverage, ${r.critical} critical fails`);
}

const overallAccuracy = ((totalExact + totalClose) / Math.max(totalClaims, 1) * 100).toFixed(1);
const overallCoverage = ((totalClaims / Math.max(totalExpected, 1)) * 100).toFixed(1);
console.log(`\n  OVERALL: ${overallAccuracy}% verification accuracy, ${overallCoverage}% extraction coverage`);
console.log(`  Total: ${totalClaims} claims extracted, ${totalExact} exact, ${totalClose} close, ${totalMismatch} mismatch, ${totalCritical} critical`);

// Save detailed results
const outputDir = join(import.meta.dirname, "results");
await mkdir(outputDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(
  join(outputDir, `eval-${timestamp}.json`),
  JSON.stringify({ timestamp, allResults, summary: { overallAccuracy, overallCoverage, totalClaims, totalExpected, totalExact, totalClose, totalMismatch, totalCritical } }, null, 2)
);
console.log(`\nDetailed results saved to tests/results/eval-${timestamp}.json`);
