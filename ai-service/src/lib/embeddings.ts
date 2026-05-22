import { createEmbedding as openaiEmbed } from './openai.js';
import { config } from '../config.js';

const DIM = 384;

/** Deterministic local embedding for demo — no API key required */
export function createLocalEmbedding(text: string): number[] {
  const vec = new Array(DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    const idx = hash % DIM;
    vec[idx] += 1;
    const idx2 = (hash * 7) % DIM;
    vec[idx2] += 0.5;
  }

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export async function createEmbedding(text: string): Promise<number[]> {
  if (config.embeddingProvider === 'openai' && config.openaiApiKey) {
    try {
      return await openaiEmbed(text);
    } catch {
      console.warn('OpenAI embedding failed, using local fallback');
    }
  }
  return createLocalEmbedding(text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
