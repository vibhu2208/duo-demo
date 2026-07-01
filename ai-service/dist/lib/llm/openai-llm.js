import OpenAI from 'openai';
import { config } from '../../config.js';
const openai = new OpenAI({ apiKey: config.openaiApiKey });
export async function openaiChatCompletion(systemPrompt, userPrompt, history = []) {
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history
            .filter((h) => h.role !== 'system')
            .map((h) => ({
            role: h.role,
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
export async function openaiChatCompletionJson(systemPrompt, userPrompt) {
    const messages = [
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
