# Watchdog

A voice-activated fact-checker. Watchdog listens to conversations through your microphone, extracts factual claims, and verifies them with web search. When someone says something false, it plays a chime and shows the correction.

Say "Watchdog" followed by:
- A factual question, answered via web search ("Who founded Anthropic?")
- A question about the conversation, answered from the transcript ("Summarize our points so far.")
- "Copy transcript," which copies the full transcript to your clipboard.

### Stack

- **Frontend:** Vanilla TypeScript PWA, no framework
- **Backend:** Vercel serverless functions
- **Speech-to-text:** Deepgram Nova-3 (streaming WebSocket, with diarization)
- **AI:** Claude Haiku 4.5 with web search
