import './style.css';
import type { CheckedClaim, QuestionAnswer } from './lib/types.ts';
import { mockClaims, mockAnswer } from './lib/mockData.ts';
import { playChime, initAudio } from './lib/sound.ts';

// --- State ---
let isListening = false;
let claims: CheckedClaim[] = [];
let answers: QuestionAnswer[] = [];
let _pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
let expandedClaimId: string | null = null;

// --- Icons ---
const icons = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
};

// --- Render ---
function render(): void {
  const app = document.getElementById('app')!;

  // Only show false/dubious claims — true claims don't need attention
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

  // Tap claim to expand/collapse
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

// --- Actions ---
function startListening(): void {
  isListening = true;
  claims = [];
  answers = [];
  render();

  // Demo: drip in mock claims
  mockClaims.forEach((claim, i) => {
    const t = setTimeout(() => {
      claims = [claim, ...claims];
      const v = claim.verification.verdict;
      if (v === 'FALSE' || v === 'MOSTLY_FALSE') {
        playChime('false');
      }
      render();
    }, (i + 1) * 2000);
    _pendingTimeouts.push(t);
  });
}

function stopListening(): void {
  isListening = false;
  _pendingTimeouts.forEach(clearTimeout);
  _pendingTimeouts = [];
  render();
}

function submitQuestion(question: string): void {
  const answer: QuestionAnswer = {
    ...mockAnswer,
    id: `q${Date.now()}`,
    question,
    timestamp: Date.now(),
  };
  answers = [answer, ...answers];
  render();
}

// --- SW ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

render();
