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
let triggerPending = false;
let triggerSpeaker = '';

const TRIGGER = /\bwatchdog\b[,.:!?]?\s*/i;

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

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function hasResults(): boolean {
  const flagged = claims.filter(c =>
    c.verification.verdict === 'FALSE' || c.verification.verdict === 'MOSTLY_FALSE'
  );
  return flagged.length > 0 || answers.length > 0;
}

function getCorrectionsText(): string {
  const flagged = claims.filter(c =>
    c.verification.verdict === 'FALSE' || c.verification.verdict === 'MOSTLY_FALSE'
  );
  if (flagged.length === 0) return '';
  return flagged.map(c => `Claim: "${c.claim}" → ${c.verification.verdict}: ${c.verification.response}`).join('\n');
}

// --- Clipboard ---
function copyTranscript(): void {
  const text = transcriptBuffer.join('\n');
  if (!text) {
    showNotice('Nothing to copy yet.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showNotice('Transcript copied.');
  }).catch(() => {
    showNotice('Could not copy.');
  });
}

function showNotice(msg: string): void {
  const placeholderId = `n${Date.now()}`;
  answers = [{
    id: placeholderId,
    question: 'copy transcript',
    answer: msg,
    confidence: 1,
    sources: [],
    timestamp: Date.now(),
  }, ...answers];
  render();
}

// --- Render ---
function render(): void {
  const app = document.getElementById('app')!;
  const flaggedClaims = claims.filter(c =>
    c.verification.verdict === 'FALSE' || c.verification.verdict === 'MOSTLY_FALSE'
  );

  const emptyState = app.querySelector('.empty-state');
  if (emptyState && hasResults()) {
    emptyState.classList.add('fading');
    setTimeout(() => renderInner(app, flaggedClaims), 300);
    return;
  }

  renderInner(app, flaggedClaims);
}

function renderInner(app: HTMLElement, flaggedClaims: CheckedClaim[]): void {
  app.innerHTML = `
    ${isRecording ? '<div class="rec-dot"></div>' : ''}
    <main class="main">
      ${!hasResults()
        ? `<div class="empty-state"><p class="empty-text" id="rotating-hint"><em>Watchdog,<br>${esc(hints[hintIndex])}</em></p></div>`
        : `<div class="feed">${answers.map(a => renderAnswer(a)).join('')}${flaggedClaims.map(c => renderClaim(c)).join('')}</div>`
      }
    </main>
  `;
  bindEvents();
}

function renderSources(sources: string[], expanded: boolean): string {
  if (!sources || sources.length === 0) return '';
  return `
    <div class="card-sources-wrap${expanded ? ' expanded' : ''}">
      <div class="card-sources">
        ${sources.map(s => `<a href="${safeUrl(s)}" target="_blank" rel="noopener" class="source-link">${esc(domain(s))}</a>`).join('')}
      </div>
    </div>
  `;
}

function renderClaim(c: CheckedClaim): string {
  const v = c.verification;
  return `
    <div class="card" data-claim-id="${c.id}">
      <p class="card-claim">${esc(c.claim)}</p>
      <p class="card-text">${esc(stripCitations(v.response))}</p>
      ${renderSources(v.sources, expandedClaimId === c.id)}
    </div>
  `;
}

function renderAnswer(a: QuestionAnswer): string {
  return `
    <div class="card" data-claim-id="${a.id}">
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

      document.querySelectorAll('.card-sources-wrap.expanded').forEach(el => el.classList.remove('expanded'));
      expandedClaimId = isExpanding ? id : null;

      if (isExpanding && wrap) {
        wrap.classList.add('expanded');
      }
    });
  });
}

// --- Handle watchdog command ---
async function handleCommand(question: string, speaker: string): Promise<void> {
  try {
    const resp = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: question }),
    });
    const { intent } = await resp.json();
    console.log('[classify]', question, '→', intent);

    if (intent === 'clipboard') {
      copyTranscript();
    } else {
      submitQuestion(question, speaker, intent === 'transcript');
    }
  } catch {
    // Fallback: treat as web search question
    submitQuestion(question, speaker, false);
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

          if (TRIGGER.test(transcript)) {
            const after = transcript.replace(TRIGGER, '').replace(/^[.,!?\s]+/, '').trim();
            if (after.length > 3) {
              console.log('[watchdog command]', after, `(${speaker})`);
              handleCommand(after, speaker);
              triggerPending = false;
            } else {
              triggerPending = true;
              triggerSpeaker = speaker;
            }
          } else if (triggerPending) {
            const question = transcript.replace(/^[.,!?\s]+/, '').trim();
            if (question.length > 3) {
              console.log('[watchdog command]', question, `(${triggerSpeaker})`);
              handleCommand(question, triggerSpeaker);
            }
            triggerPending = false;
          }

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
async function submitQuestion(question: string, speaker: string, withTranscript: boolean): Promise<void> {
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

  const body: Record<string, string> = { question, speaker };
  if (withTranscript && transcriptBuffer.length > 0) {
    body.transcript = transcriptBuffer.join('\n');
    const corrections = getCorrectionsText();
    if (corrections) body.corrections = corrections;
  }

  try {
    const resp = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

// --- Onboarding ---
function showOnboarding(): void {
  if (localStorage.getItem('watchdog-onboarded')) return;

  const overlay = document.createElement('div');
  overlay.className = 'onboarding';
  overlay.innerHTML = `
    <div class="onboarding-inner">
      <button class="onboarding-close" aria-label="Close">&times;</button>
      <p class="onboarding-title">Watchdog</p>
      <div class="onboarding-body">
        <p>Have more truthful, fact-driven conversations. Watchdog listens through your microphone, extracts factual claims, and verifies them with web search in real time. When someone says something false, it plays a chime and shows the correction.</p>
        <p>You can also ask questions. Say "Watchdog" followed by:</p>
        <ul class="onboarding-examples">
          <li>A factual question, answered via web search</li>
          <li>A question about the conversation, answered from the transcript</li>
          <li>"Copy transcript," which copies the full transcript to your clipboard</li>
        </ul>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', () => {
    localStorage.setItem('watchdog-onboarded', '1');
    overlay.classList.add('dismissing');
    overlay.addEventListener('animationend', () => overlay.remove());
  });
}

// --- Init ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const hints = [
  'who founded Anthropic?',
  'how many parameters is GPT-4?',
  'when did AlphaGo beat Lee Sedol?',
  'summarize our points so far.',
  'when was the transformer paper?',
  'copy transcript to clipboard.',
  'what was my main argument?',
  'how much did OpenAI raise?',
];
let hintIndex = 0;
let hintInterval: ReturnType<typeof setInterval> | null = null;

function startHintRotation(): void {
  const el = document.getElementById('rotating-hint');
  if (!el) return;
  el.innerHTML = `<em>Watchdog,<br>${esc(hints[0])}</em>`;

  hintInterval = setInterval(() => {
    const el = document.getElementById('rotating-hint');
    if (!el) { clearInterval(hintInterval!); return; }
    el.classList.add('fading-text');
    setTimeout(() => {
      hintIndex = (hintIndex + 1) % hints.length;
      el.innerHTML = `<em>Watchdog,<br>${esc(hints[hintIndex])}</em>`;
      el.classList.remove('fading-text');
    }, 300);
  }, 6000);
}

showOnboarding();
render();
startHintRotation();
initAudio();
startListening();
