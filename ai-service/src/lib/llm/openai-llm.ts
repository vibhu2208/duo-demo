import OpenAI from 'openai';
import { config } from '../../config.js';
import type { ChatMessage } from './index.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function openaiChatCompletion(
  systemPrompt: string,
  userPrompt: string,
  history: ChatMessage[] = []
): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history
      .filter((h) => h.role !== 'system')
      .map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
    { role: 'user', content: userPrompt },
  ];

  const response = await openai.chat.completions.create({
    model: config.chatModel,
    messages,
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content || 'No response generated.';
}

/** Structured JSON output (OpenAI json_object mode). */
export async function openaiChatCompletionJson(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const response = await openai.chat.completions.create({
    model: config.chatModel,
    messages,
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  return response.choices[0]?.message?.content || '{}';
}
