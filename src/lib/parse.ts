/**
 * Shared parsing utilities for extracting JSON from LLM responses.
 * Used by API routes (verify, ask, extract) to handle markdown fences
 * and extract JSON from text blocks.
 */

export function stripMarkdownFences(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : text;
}

export function extractJsonObject(text: string): unknown | null {
  const cleaned = stripMarkdownFences(text);
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

export function extractJsonArray(text: string): unknown[] | null {
  const cleaned = stripMarkdownFences(text);
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Extract JSON from Anthropic response content blocks.
 * Iterates text blocks, tries to parse JSON from each.
 */
export function extractJsonFromContentBlocks(
  content: { type: string; text?: string }[],
): unknown | null {
  const textBlocks = content.filter(b => b.type === 'text' && b.text);
  for (const block of textBlocks) {
    const result = extractJsonObject(block.text!);
    if (result) return result;
  }
  return null;
}
