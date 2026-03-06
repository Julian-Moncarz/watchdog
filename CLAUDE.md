# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Watchdog

A voice-activated fact-checker PWA. Listens to conversations via microphone, extracts factual claims, and verifies them using Claude Haiku 4.5 with web search. False claims trigger a chime and show a correction card. Users activate voice commands by saying "Watchdog" — ask factual questions (web search), ask about the conversation (transcript-aware), or copy the transcript to clipboard.

## Commands

- `npm run dev` — start Vite dev server (frontend only; API routes need Vercel CLI: `vercel dev`)
- `npm run build` — typecheck + build (`tsc && vite build`)
- `npm run eval` — run the eval harness against test transcripts (`node tests/eval.mjs`)
- `npm run eval -- 01` — run eval for a single transcript (e.g. `01_ai_safety_dinner`)

## Architecture

### Two-tier split: frontend + Vercel serverless

**Frontend** (`src/`): Vanilla TypeScript, no framework. Single `main.ts` renders everything via string templates and manual DOM binding. State is module-level variables, re-rendered on change.

**API routes** (`api/`): Vercel serverless functions (Node.js). Each file exports a default handler:
- `api/transcribe.ts` — returns a temporary Deepgram API key + WebSocket config for client-side streaming
- `api/extract.ts` — sends transcript to Claude Haiku for claim extraction (no web search)
- `api/verify.ts` — sends a single claim to Claude Haiku with `web_search_20250305` tool for verification
- `api/classify.ts` — classifies a voice command as `question`, `transcript`, or `clipboard` (no web search)
- `api/ask.ts` — answers a question using Claude Haiku; uses web search for factual questions, transcript context for conversation questions

### Real-time pipeline

1. Client opens WebSocket directly to Deepgram (Nova-3, with diarization)
2. Audio streamed via MediaRecorder at 250ms chunks
3. Every 10 seconds, accumulated new transcript text is sent to `/api/extract`
4. Extracted claims are verified in parallel via `/api/verify`
5. FALSE/MOSTLY_FALSE claims trigger an audio chime (Web Audio API, `src/lib/sound.ts`)

### Voice command routing

1. User says "Watchdog" followed by a command (detected via regex trigger in transcript)
2. Command sent to `/api/classify` → returns intent: `question`, `transcript`, or `clipboard`
3. `question` → `/api/ask` with web search; `transcript` → `/api/ask` with transcript context + corrections; `clipboard` → copies transcript to clipboard locally

### Key files

- `src/lib/types.ts` — all shared TypeScript interfaces (`CheckedClaim`, `VerificationResult`, `Verdict`, etc.)
- `src/lib/prompts.ts` — system prompts for extraction, verification, and Q&A (client-side copies; API routes have their own copies)
- `src/lib/sound.ts` — Web Audio API chime synthesis
- `src/style.css` — all styles
- `public/` — PWA assets (manifest, service worker, icons)

### Eval harness

`tests/eval.mjs` tests the extract-then-verify pipeline against annotated transcripts in `tests/transcripts/*.json`. Each transcript has `expected_claims` with ground-truth verdicts. Claims are matched by word overlap, scored as exact/close/mismatch/critical_fail.

## Environment variables (Vercel)

- `ANTHROPIC_API_KEY` — used by all API routes
- `DEEPGRAM_API_KEY` — used by `api/transcribe.ts`

## Conventions

- Model: `claude-haiku-4-5-20251001` everywhere
- API routes call the Anthropic REST API directly (not the SDK) with `anthropic-version: 2023-06-01`
- The eval harness uses the `@anthropic-ai/sdk` package directly
- Prompts instruct the model to respond with raw JSON (no markdown fences)
- Verdicts are one of: `TRUE`, `FALSE`, `MOSTLY_TRUE`, `MOSTLY_FALSE`, `UNVERIFIABLE`
- Note: prompts are duplicated between `src/lib/prompts.ts` and the `api/` files — keep them in sync
