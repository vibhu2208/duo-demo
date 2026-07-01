/**
 * Extract a JSON object from LLM output (handles markdown fences, prose wrappers).
 */
export function parseJsonFromLlm(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const attempts: string[] = [];

  attempts.push(trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) attempts.push(fenceMatch[1].trim());

  const findingsIdx = trimmed.indexOf('"findings"');
  if (findingsIdx >= 0) {
    const start = trimmed.lastIndexOf('{', findingsIdx);
    if (start >= 0) {
      const balanced = extractBalancedJson(trimmed, start);
      if (balanced) attempts.push(balanced);
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    attempts.push(trimmed.slice(first, last + 1));
  }

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }

  return null;
}

function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
