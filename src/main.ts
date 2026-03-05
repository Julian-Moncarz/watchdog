import './style.css';
import type { CheckedClaim, VerificationResult, QuestionAnswer } from './lib/types.ts';
import { playChime, initAudio } from './lib/sound.ts';

// --- State ---
let isListening = false;
let claims: CheckedClaim[] = [];
let answers: QuestionAnswer[] = [];
let expandedClaimId: string | null = null;
let transcriptBuffer: string[] = [];
let processedText = '';
let mediaRecorder: MediaRecorder | null = null;
let dgSocket: WebSocket | null = null;
let extractTimer: ReturnType<typeof setInterval> | null = null;
let claimIdCounter = 0;

// --- Icons ---
const icons = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
};

// --- Render ---
function render(): void {
  const app = document.getElementById('app')!;
  const flaggedClaims = claims.filter(c =>
    c.verification.verdict === 'FALSE' || c.verification.verdict === 'MOSTLY_FALSE'
  );

  app.innerHTML = `
    <main class="main">
      ${!isListening && flaggedClaims.length === 0 && answers.length === 0
        ? renderIdleState()
        : renderActiveState(flaggedClaims)}
    </main>
    <div class="bottom-bar">
      <div class="ask-input-wrap">
        <input class="ask-input" type="text" placeholder="Check a fact..." id="ask-input" />
        <button class="ask-submit" id="ask-submit" disabled>${icons.send}</button>
      </div>
    </div>
  `;
  bindEvents();
}

function renderIdleState(): string {
  return `
    <div class="center-stage">
      <button class="listen-btn" id="listen-btn">
        <span class="listen-icon">${icons.mic}</span>
      </button>
    </div>
  `;
}

function renderActiveState(flaggedClaims: CheckedClaim[]): string {
  return `
    <div class="active-stage">
      <button class="listen-btn-small ${isListening ? 'listening' : ''}" id="listen-btn">
        <span class="listen-icon-small">${isListening ? icons.stop : icons.mic}</span>
        ${isListening ? '<span class="pulse-ring"></span>' : ''}
      </button>
      ${isListening && flaggedClaims.length === 0 && answers.length === 0
        ? '<p class="all-clear">All clear</p>'
        : ''}
      <div class="feed">
        ${answers.map(a => renderAnswer(a)).join('')}
        ${flaggedClaims.map(c => renderClaim(c)).join('')}
      </div>
    </div>
  `;
}

function renderClaim(c: CheckedClaim): string {
  const v = c.verification;
  const isExpanded = expandedClaimId === c.id;
  return `
    <div class="card ${v.verdict === 'FALSE' ? 'card-false' : 'card-dubious'}" data-claim-id="${c.id}">
      <p class="card-claim">"${c.claim}"</p>
      ${v.correction ? `<p class="card-correction">${v.correction}</p>` : ''}
      ${isExpanded ? `
        <p class="card-detail">${v.explanation}</p>
        ${v.sources.length > 0 ? `
          <div class="card-sources">
            ${v.sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener" class="source-link">${s.title}</a>`).join('')}
          </div>
        ` : ''}
      ` : ''}
    </div>
  `;
}

function renderAnswer(a: QuestionAnswer): string {
  return `
    <div class="card card-answer">
      <p class="card-question">${a.question}</p>
      <p class="card-detail">${a.answer}</p>
    </div>
  `;
}

// --- Events ---
function bindEvents(): void {
  const listenBtn = document.getElementById('listen-btn');
  if (listenBtn) {
    listenBtn.addEventListener('click', () => {
      initAudio();
      isListening ? stopListening() : startListening();
    });
  }

  document.querySelectorAll('.card[data-claim-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.claimId!;
      expandedClaimId = expandedClaimId === id ? null : id;
      render();
    });
  });

  const askInput = document.getElementById('ask-input') as HTMLInputElement | null;
  const askSubmit = document.getElementById('ask-submit') as HTMLButtonElement | null;
  if (askInput && askSubmit) {
    askInput.addEventListener('input', () => {
      askSubmit.disabled = askInput.value.trim().length === 0;
    });
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && askInput.value.trim()) {
        submitQuestion(askInput.value.trim());
        askInput.value = '';
        askSubmit.disabled = true;
      }
    });
    askSubmit.addEventListener('click', () => {
      if (askInput.value.trim()) {
        submitQuestion(askInput.value.trim());
        askInput.value = '';
        askSubmit.disabled = true;
      }
    });
  }
}

// --- Deepgram streaming ---
async function startListening(): Promise<void> {
  isListening = true;
  claims = [];
  answers = [];
  transcriptBuffer = [];
  processedText = '';
  render();

  try {
    // Get Deepgram connection info from our API
    const resp = await fetch('/api/transcribe', { method: 'POST' });
    const config = await resp.json();

    // Get mic access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Build WebSocket URL with params
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(config.params)) {
      params.set(k, String(v));
    }
    const wsUrl = `${config.url}?${params.toString()}`;
    const key = config.key || '';

    dgSocket = new WebSocket(wsUrl, ['token', key]);

    dgSocket.onopen = () => {
      // Stream audio to Deepgram
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && dgSocket?.readyState === WebSocket.OPEN) {
          dgSocket.send(e.data);
        }
      };
      mediaRecorder.start(250); // send chunks every 250ms
    };

    dgSocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'Results' && data.is_final) {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript && transcript.trim()) {
          // Get speaker if diarization is available
          const words = data.channel?.alternatives?.[0]?.words ?? [];
          const speaker = words.length > 0 && words[0].speaker !== undefined
            ? `Speaker ${words[0].speaker}`
            : 'Speaker';
          transcriptBuffer.push(`[${speaker}]: ${transcript}`);
        }
      }
    };

    dgSocket.onerror = () => {
      console.error('Deepgram WebSocket error');
    };

    dgSocket.onclose = () => {
      if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
      }
      stream.getTracks().forEach(t => t.stop());
    };

    // Extract claims every 10 seconds from new transcript text
    extractTimer = setInterval(() => {
      processNewTranscript();
    }, 10_000);

  } catch (err) {
    console.error('Failed to start listening:', err);
    isListening = false;
    render();
  }
}

function stopListening(): void {
  isListening = false;

  // Process any remaining transcript
  processNewTranscript();

  if (extractTimer) {
    clearInterval(extractTimer);
    extractTimer = null;
  }
  if (dgSocket) {
    dgSocket.close();
    dgSocket = null;
  }
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  render();
}

// --- Claim pipeline ---
async function processNewTranscript(): Promise<void> {
  const fullText = transcriptBuffer.join('\n');
  const newText = fullText.slice(processedText.length).trim();
  if (!newText) return;

  processedText = fullText;

  try {
    // Stage 1: Extract claims
    const extractResp = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: newText }),
    });
    const { claims: extracted } = await extractResp.json();
    if (!extracted || extracted.length === 0) return;

    // Stage 2: Verify each claim in parallel
    const verifyPromises = extracted.map(async (ec: { claim: string; speaker: string; context: string }) => {
      const vResp = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: ec.claim, context: ec.context }),
      });
      const verification: VerificationResult = await vResp.json();
      // Default sources to empty array if not returned
      if (!verification.sources) verification.sources = [];

      const checked: CheckedClaim = {
        id: String(++claimIdCounter),
        claim: ec.claim,
        speaker: ec.speaker,
        context: ec.context,
        verification,
        timestamp: Date.now(),
      };
      return checked;
    });

    const verified = await Promise.all(verifyPromises);

    for (const c of verified) {
      claims = [c, ...claims];
      const v = c.verification.verdict;
      if (v === 'FALSE' || v === 'MOSTLY_FALSE') {
        playChime('false');
      }
    }
    render();

  } catch (err) {
    console.error('Pipeline error:', err);
  }
}

// --- Ask ---
async function submitQuestion(question: string): Promise<void> {
  // Show placeholder immediately
  const placeholderId = `q${Date.now()}`;
  answers = [{
    id: placeholderId,
    question,
    answer: 'Searching...',
    confidence: 0,
    sources: [],
    caveats: null,
    timestamp: Date.now(),
  }, ...answers];
  render();

  try {
    const resp = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const result = await resp.json();

    // Replace placeholder
    answers = answers.map(a => a.id === placeholderId ? {
      ...a,
      answer: result.answer || 'No answer found.',
      confidence: result.confidence || 0,
      sources: result.sources || [],
      caveats: result.caveats || null,
    } : a);
    render();
  } catch {
    answers = answers.map(a => a.id === placeholderId ? {
      ...a,
      answer: 'Failed to get answer. Try again.',
    } : a);
    render();
  }
}

// --- SW ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

render();
