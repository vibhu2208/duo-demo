import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function createEmbedding(text: string): Promise<number[]> {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY required for OpenAI embeddings');
  }
  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}
