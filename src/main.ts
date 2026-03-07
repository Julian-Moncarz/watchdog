import './style.css';
import type { CheckedClaim, VerificationResult, QuestionAnswer } from './lib/types.ts';
import { playChime, playAnswerChime } from './lib/sound.ts';
import {
  getCacheKey, shouldTriggerChime, isFlagged,
  calculateTranscriptDelta, buildPriorContext, matchTrigger,
  esc, stripCitations, safeUrl, domain,
} from './lib/pipeline.ts';

// --- State ---
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
let extractIntervalId: ReturnType<typeof setInterval> | null = null;
const previousChunks: string[] = []; // kept for voice command transcript context
const verifyCache = new Map<string, VerificationResult>();

function hasResults(): boolean {
  const flagged = claims.filter(c => isFlagged(c.verification.verdict));
  return flagged.length > 0 || answers.length > 0;
}

function getCorrectionsText(): string {
  const flagged = claims.filter(c => isFlagged(c.verification.verdict));
  if (flagged.length === 0) return '';
  return flagged.map(c => `Claim: "${c.claim}" → ${c.verification.verdict}: ${c.verification.response}`).join('\n');
}

// --- Theme ---
function setTheme(command?: string): void {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme')
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  let next: string;
  if (command && /\bdark\b/i.test(command)) {
    next = 'dark';
  } else if (command && /\blight\b/i.test(command)) {
    next = 'light';
  } else {
    next = current === 'dark' ? 'light' : 'dark';
  }

  html.setAttribute('data-theme', next);
  localStorage.setItem('watchdog-theme', next);
  showNotice(`Switched to ${next} mode.`);
}

function applyStoredTheme(): void {
  const stored = localStorage.getItem('watchdog-theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
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
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('dismissing');
    toast.addEventListener('animationend', () => toast.remove());
  }, 1800);
}

// --- Dog ---
const DOG_FILES = ['/dog1.png', '/dog2.png', '/dog3.png'];

function getChosenDog(): string | null {
  return localStorage.getItem('watchdog-dog');
}

// --- Render ---
function render(): void {
  const app = document.getElementById('app')!;
  const flaggedClaims = claims.filter(c => isFlagged(c.verification.verdict));

  const emptyState = app.querySelector('.empty-state');
  if (emptyState && hasResults()) {
    emptyState.classList.add('fading');
    setTimeout(() => renderInner(app, flaggedClaims), 300);
    return;
  }

  renderInner(app, flaggedClaims);
}

function renderInner(app: HTMLElement, flaggedClaims: CheckedClaim[]): void {
  // Merge answers and flagged claims into a single feed sorted by timestamp (newest first)
  const feedItems: { type: 'answer' | 'claim'; item: QuestionAnswer | CheckedClaim }[] = [
    ...answers.map(a => ({ type: 'answer' as const, item: a })),
    ...flaggedClaims.map(c => ({ type: 'claim' as const, item: c })),
  ].sort((a, b) => b.item.timestamp - a.item.timestamp);

  app.innerHTML = `
    <main class="main">
      ${!hasResults()
        ? `<div class="empty-state"></div>`
        : `<div class="feed">${feedItems.map(f =>
            f.type === 'answer'
              ? renderAnswer(f.item as QuestionAnswer)
              : renderClaim(f.item as CheckedClaim)
          ).join('')}</div>`
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

// --- Dog icon (persistent) ---
function mountDog(): void {
  const dog = getChosenDog();
  if (!dog) return;
  if (document.getElementById('dog-icon')) return;

  const img = document.createElement('img');
  img.id = 'dog-icon';
  img.className = 'watchdog-icon';
  img.src = dog;
  img.alt = '';
  img.dataset.dog = String(DOG_FILES.indexOf(dog) + 1);
  document.body.appendChild(img);

  img.addEventListener('click', () => {
    const current = getChosenDog();
    const next = DOG_FILES[(DOG_FILES.indexOf(current!) + 1) % DOG_FILES.length];
    localStorage.setItem('watchdog-dog', next);
    img.src = next;
    img.dataset.dog = String(DOG_FILES.indexOf(next) + 1);
  });
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
    } else if (intent === 'theme') {
      setTheme(question);
    } else {
      submitQuestion(question, speaker, intent === 'transcript');
    }
  } catch {
    // Fallback: treat as web search question
    submitQuestion(question, speaker, false);
  }
}

// --- Deepgram streaming ---
function cleanup(): void {
  if (extractIntervalId) {
    clearInterval(extractIntervalId);
    extractIntervalId = null;
  }
  if (dgSocket) {
    dgSocket.onclose = null;
    dgSocket.close();
    dgSocket = null;
  }
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  previousChunks.length = 0;
}

async function startListening(): Promise<void> {
  cleanup();

  try {
    const resp = await fetch('/api/transcribe', { method: 'POST' });
    const config = await resp.json();
    if (!resp.ok || !config.params) {
      throw new Error(config.error || 'Failed to get transcription config');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

          const trigger = matchTrigger(transcript);
          if (trigger.matched) {
            if (trigger.command.length > 3) {
              console.log('[watchdog command]', trigger.command, `(${speaker})`);
              handleCommand(trigger.command, speaker);
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
      stream.getTracks().forEach(t => t.stop());
    };

    extractIntervalId = setInterval(() => {
      processNewTranscript();
    }, 10_000);

  } catch (err) {
    console.error('Failed to start listening:', err);
    showNotice('Microphone access is needed to listen.');
  }
}

// --- Claim pipeline ---
async function processNewTranscript(): Promise<void> {
  const fullText = transcriptBuffer.join('\n');
  const newText = calculateTranscriptDelta(fullText, processedText);
  if (!newText) return;

  processedText = fullText;
  console.log('[extract input]', newText);

  previousChunks.push(newText);

  try {
    const extractResp = await fetch('/api/extract-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: newText }),
    });
    const extractData = await extractResp.json();
    console.log('[extract response]', extractData);
    const extracted = extractData.claims;
    if (!extracted || extracted.length === 0) return;

    const verifyPromises = extracted.map(async (ec: { claim: string }) => {
      const cacheKey = getCacheKey(ec.claim);
      let verification: VerificationResult;

      if (verifyCache.has(cacheKey)) {
        verification = verifyCache.get(cacheKey)!;
        console.log('[verify cache hit]', ec.claim);
      } else {
        const vResp = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim: ec.claim }),
        });
        verification = await vResp.json();
        if (!verification.sources) verification.sources = [];
        if (!verification.response) verification.response = '';
        verifyCache.set(cacheKey, verification);
      }
      console.log('[verdict]', ec.claim, '→', verification.verdict, verification.response);

      const checked: CheckedClaim = {
        id: String(++claimIdCounter),
        claim: ec.claim,
        verification,
        timestamp: Date.now(),
      };
      return checked;
    });

    const verified = await Promise.all(verifyPromises);

    for (const c of verified) {
      claims = [c, ...claims];
      if (shouldTriggerChime(c.verification.verdict)) {
        playChime();
        navigator.vibrate?.([15, 50, 15]);
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
    playAnswerChime();
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
      <div class="onboarding-step" data-step="1">
        <p class="onboarding-title">Watchdog</p>
        <div class="onboarding-body">
          <p>Have more truthful, fact-driven conversations. Watchdog listens through your microphone, extracts factual claims, and verifies them with web search in real time. When someone says something false, it plays a chime and shows the correction.</p>
          <p>You can also ask questions. Say "Watchdog" followed by:</p>
          <ul class="onboarding-examples">
            <li>&bull; A factual question, answered via web search</li>
            <li>&bull; A question about the conversation, answered from the transcript</li>
            <li>&bull; "Copy transcript" to copy to clipboard</li>
            <li>&bull; "Dark mode" or "light mode" to switch theme</li>
          </ul>
        </div>
        <button class="onboarding-next" aria-label="Next">&rarr;</button>
      </div>
      <div class="onboarding-step hidden" data-step="2">
        <p class="onboarding-title">Choose your watchdog</p>
        <div class="dog-picker">
          ${DOG_FILES.map((src, i) => `<button class="dog-option dog-option-${i + 1}" data-dog="${src}"><img src="${src}" alt="Dog ${i + 1}" /></button>`).join('')}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const step1 = overlay.querySelector('[data-step="1"]')!;
  const step2 = overlay.querySelector('[data-step="2"]')!;
  const nextBtn = overlay.querySelector('.onboarding-next')!;

  // Step 1: next button advances to step 2
  nextBtn.addEventListener('click', () => {
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
  });

  // Step 2: pick a dog → auto dismiss
  overlay.querySelectorAll('.dog-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const dog = (btn as HTMLElement).dataset.dog!;
      localStorage.setItem('watchdog-dog', dog);
      localStorage.setItem('watchdog-onboarded', '1');
      overlay.classList.add('dismissing');
      overlay.addEventListener('animationend', () => {
        overlay.remove();
        mountDog();
        render();
        startListening();
      });
    });
  });
}

// --- Init ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

applyStoredTheme();
showOnboarding();
mountDog();
render();
if (localStorage.getItem('watchdog-onboarded')) {
  startListening();
}
