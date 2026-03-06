import type { CheckedClaim, QuestionAnswer, Verdict } from './types.ts';

export const TRIGGER = /\bwatch\s*dog\b[,.:!?]?\s*/i;

export function getCacheKey(claim: string): string {
  return claim.toLowerCase().trim();
}

export function shouldTriggerChime(verdict: Verdict): boolean {
  return verdict === 'FALSE' || verdict === 'MOSTLY_FALSE';
}

export function isFlagged(verdict: Verdict): boolean {
  return verdict === 'FALSE' || verdict === 'MOSTLY_FALSE';
}

export function calculateTranscriptDelta(fullText: string, processedText: string): string {
  return fullText.slice(processedText.length).trim();
}

export function buildPriorContext(chunks: string[], windowSize = 2): string {
  return chunks.slice(-windowSize).join('\n');
}

export function mergeAndSortFeed(
  claims: CheckedClaim[],
  answers: QuestionAnswer[],
): { type: 'answer' | 'claim'; item: QuestionAnswer | CheckedClaim }[] {
  const flaggedClaims = claims.filter(c => isFlagged(c.verification.verdict));
  return [
    ...answers.map(a => ({ type: 'answer' as const, item: a })),
    ...flaggedClaims.map(c => ({ type: 'claim' as const, item: c })),
  ].sort((a, b) => b.item.timestamp - a.item.timestamp);
}

export function matchTrigger(text: string): { matched: boolean; command: string } {
  if (!TRIGGER.test(text)) return { matched: false, command: '' };
  const after = text.replace(TRIGGER, '').replace(/^[.,!?\s]+/, '').trim();
  return { matched: true, command: after };
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function stripCitations(s: string): string {
  return s.replace(/<\/?cite[^>]*>/g, '');
}

export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch {
    return '#';
  }
}

export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
