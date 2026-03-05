# Watchdog — Design Brief

## What it is
A PWA that sits on the table during conversations and fact-checks what people say in real-time. When someone states something false, it surfaces a subtle alert. Users can also type factual questions directly.

## Target users
Smart people (AI safety researchers, curious friends) who value good epistemics and want to hold themselves and each other accountable for factual accuracy.

## Core UX flows

### 1. Passive listening mode (primary)
- User opens the app, taps "Listen"
- Live transcript appears as conversation flows
- When a false/dubious claim is detected:
  - A subtle but noticeable audio tone plays
  - The claim appears in a feed with its verdict + explanation
- True claims are tracked but shown more quietly
- Speaker attribution shown (Deepgram provides diarization)

### 2. Ask a question
- User can type or tap to ask a factual question
- Gets a search-grounded answer with sources
- Should feel effortless — like asking a knowledgeable friend

### 3. Review history
- Scroll through past claims and their verdicts
- Filter by verdict type (false, true, etc.)

## Design principles (Dieter Rams)
1. **Good design is innovative** — this hasn't been done well before
2. **Good design makes a product useful** — every element serves the fact-checking function
3. **Good design is aesthetic** — beautiful enough to proudly have on the table
4. **Good design makes a product understandable** — verdicts are instantly clear
5. **Good design is unobtrusive** — doesn't dominate the conversation
6. **Good design is honest** — shows confidence levels, doesn't pretend certainty
7. **Good design is long-lasting** — timeless aesthetic, no trends
8. **Good design is thorough** — every detail considered
9. **Good design is environmentally friendly** — minimal resource usage
10. **Good design is as little design as possible** — back to purity, back to simplicity

## Visual direction
- Warm neutral palette (off-white, warm grays, muted accent for alerts)
- Generous whitespace
- Clean sans-serif typography (Inter, or similar)
- Verdicts use color coding: muted green (true), warm amber (mostly true), red-orange (false)
- No unnecessary decoration — function drives form
- Mobile-first, works beautifully on phones laid on a table
- Dark mode that looks good in dim restaurants/bars

## Technical context
- Vite + TypeScript PWA
- Vercel serverless functions for API proxying (Anthropic, Deepgram)
- Deepgram for real-time transcription with speaker diarization
- Claude Haiku 4.5 for claim extraction + verification with web search
- Types are in `src/lib/types.ts`, prompts in `src/lib/prompts.ts`

## Key UX considerations
- **Table-side use**: Large enough text to glance at from across a table
- **Non-intrusive**: The app should enhance conversation, not interrupt it
- **Quick glance value**: At a glance, you should see "2 false claims detected" or "all clear"
- **Sound design**: The alert tone should be distinctive but not jarring. Think a soft chime, not a buzzer.
- **Battery/performance**: This runs for hours during dinner — must be efficient
- **PWA**: Installable, works offline (for the UI at least), full-screen capable
