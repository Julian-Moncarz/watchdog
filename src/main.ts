import './style.css';
import type { CheckedClaim, VerificationResult, QuestionAnswer } from './lib/types.ts';
import { playChime, initAudio } from './lib/sound.ts';

// --- State ---
let isRecording = false;
let claims: CheckedClaim[] = [];
let answers: QuestionAnswer[] = [];
let expandedClaimId: string | null = null;
let transcriptBuffer: string[] = [];
let processedText = '';
let mediaRecorder: MediaRecorder | null = null;
let dgSocket: WebSocket | null = null;
let claimIdCounter = 0;

// --- Utilities ---
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripCitations(s: string): string {
  return s.replace(/<\/?cite[^>]*>/g, '');
}

function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch {
    return '#';
  }
}

// --- Icons ---
const icons = {
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
};

function hasResults(): boolean {
  const flagged = claims.filter(c =>
    c.verification.verdict === 'FALSE' || c.verification.verdict === 'MOSTLY_FALSE'
  );
  return flagged.length > 0 || answers.length > 0;
}

// --- Render ---
function render(): void {
  const app = document.getElementById('app')!;
  const flaggedClaims = claims.filter(c =>
    c.verification.verdict === 'FALSE' || c.verification.verdict === 'MOSTLY_FALSE'
  );

  app.innerHTML = `
    ${isRecording ? '<div class="rec-dot"></div>' : ''}
    <main class="main">
      ${!hasResults()
        ? `<div class="empty-state"><p class="empty-text">Listening.</p></div>`
        : `<div class="feed">${answers.map(a => renderAnswer(a)).join('')}${flaggedClaims.map(c => renderClaim(c)).join('')}</div>`
      }
    </main>
    <div class="bottom-bar">
      <div class="ask-input-wrap">
        <input class="ask-input" type="text" placeholder="Ask" id="ask-input" />
        <button class="ask-submit" id="ask-submit">${icons.send}</button>
      </div>
    </div>
  `;
  bindEvents();
}

function renderSources(sources: { url: string; title: string }[], expanded: boolean): string {
  if (!sources || sources.length === 0) return '';
  return `
    <div class="card-sources-wrap${expanded ? ' expanded' : ''}">
      <div class="card-sources">
        ${sources.map(s => `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener" class="source-link">${esc(s.title)}</a>`).join('')}
      </div>
    </div>
  `;
}

function renderClaim(c: CheckedClaim): string {
  const v = c.verification;
  return `
    <div class="card ${v.verdict === 'FALSE' ? 'card-false' : 'card-dubious'}" data-claim-id="${c.id}">
      <p class="card-claim">${esc(c.claim)}</p>
      <p class="card-text">${esc(stripCitations(v.response))}</p>
      ${renderSources(v.sources, expandedClaimId === c.id)}
    </div>
  `;
}

function renderAnswer(a: QuestionAnswer): string {
  return `
    <div class="card card-answer" data-claim-id="${a.id}">
      <p class="card-claim">${esc(a.question)}</p>
      <p class="card-text">${esc(stripCitations(a.answer))}</p>
      ${renderSources(a.sources || [], expandedClaimId === a.id)}
    </div>
  `;
}

// --- Events ---
function bindEvents(): void {
  document.querySelectorAll('.card[data-claim-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.source-link')) return;
      const id = (card as HTMLElement).dataset.claimId!;
      const wrap = (card as HTMLElement).querySelector('.card-sources-wrap');
      const isExpanding = expandedClaimId !== id;

      // Collapse all
      document.querySelectorAll('.card-sources-wrap.expanded').forEach(el => el.classList.remove('expanded'));
      expandedClaimId = isExpanding ? id : null;

      if (isExpanding && wrap) {
        wrap.classList.add('expanded');
      }
    });
  });

  const askInput = document.getElementById('ask-input') as HTMLInputElement | null;
  const askSubmit = document.getElementById('ask-submit') as HTMLButtonElement | null;
  if (askInput && askSubmit) {
    askInput.addEventListener('input', () => {
      askSubmit.classList.toggle('visible', askInput.value.trim().length > 0);
    });
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && askInput.value.trim()) {
        submitQuestion(askInput.value.trim());
        askInput.value = '';
        askSubmit.classList.remove('visible');
      }
    });
    askSubmit.addEventListener('click', () => {
      if (askInput.value.trim()) {
        submitQuestion(askInput.value.trim());
        askInput.value = '';
        askSubmit.classList.remove('visible');
      }
    });
  }
}

// --- Deepgram streaming ---
async function startListening(): Promise<void> {
  try {
    const resp = await fetch('/api/transcribe', { method: 'POST' });
    const config = await resp.json();
    if (!resp.ok || !config.params) {
      throw new Error(config.error || 'Failed to get transcription config');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    isRecording = true;
    render();

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(config.params)) {
      params.set(k, String(v));
    }
    const wsUrl = `${config.url}?${params.toString()}`;
    const key = config.key || '';

    dgSocket = key
      ? new WebSocket(wsUrl, ['token', key])
      : new WebSocket(wsUrl);

    dgSocket.onopen = () => {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && dgSocket?.readyState === WebSocket.OPEN) {
          dgSocket.send(e.data);
        }
      };
      mediaRecorder.start(250);
    };

    dgSocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'Results' && data.is_final) {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript && transcript.trim()) {
          const words = data.channel?.alternatives?.[0]?.words ?? [];
          const speaker = words.length > 0 && words[0].speaker !== undefined
            ? `Speaker ${words[0].speaker}`
            : 'Speaker';
          console.log('[transcript]', `${speaker}: ${transcript}`);
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

    setInterval(() => {
      processNewTranscript();
    }, 10_000);

  } catch (err) {
    console.error('Failed to start listening:', err);
  }
}

// --- Claim pipeline ---
async function processNewTranscript(): Promise<void> {
  const fullText = transcriptBuffer.join('\n');
  const newText = fullText.slice(processedText.length).trim();
  if (!newText) return;

  processedText = fullText;
  console.log('[extract input]', newText);

  try {
    const extractResp = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: newText }),
    });
    const extractData = await extractResp.json();
    console.log('[extract response]', extractData);
    const extracted = extractData.claims;
    if (!extracted || extracted.length === 0) return;

    const verifyPromises = extracted.map(async (ec: { claim: string; speaker: string; context: string }) => {
      const vResp = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: ec.claim, context: ec.context }),
      });
      const verification: VerificationResult = await vResp.json();
      if (!verification.sources) verification.sources = [];
      if (!verification.response) verification.response = '';
      console.log('[verdict]', ec.claim, '→', verification.verdict, verification.response);

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
        navigator.vibrate?.(10);
      }
    }
    render();

  } catch (err) {
    console.error('Pipeline error:', err);
  }
}

// --- Ask ---
async function submitQuestion(question: string): Promise<void> {
  const placeholderId = `q${Date.now()}`;
  answers = [{
    id: placeholderId,
    question,
    answer: 'Searching...',
    confidence: 0,
    sources: [],
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

    answers = answers.map(a => a.id === placeholderId ? {
      ...a,
      answer: result.answer || 'No answer found.',
      confidence: result.confidence || 0,
      sources: result.sources || [],
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

// --- Init ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

render();
initAudio();
startListening();
