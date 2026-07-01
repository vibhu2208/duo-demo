import axios from 'axios';
import { config } from '../config.js';
import { formatAiServiceError, withRetry } from './network-utils.js';
const client = axios.create({
    baseURL: config.aiServiceUrl,
    timeout: 120000,
});
export const aiClient = {
    async health() {
        const { data } = await client.get('/health');
        return data;
    },
    async embedTicket(payload) {
        const { data } = await client.post('/embed', payload);
        return data;
    },
    async searchSimilar(payload) {
        const { data } = await client.post('/search/similar', payload);
        return data.results;
    },
    async analyzeTicket(payload) {
        const { data } = await client.post('/analyze', payload);
        return data;
    },
    async generateRecommendation(payload) {
        const { data } = await client.post('/recommend', payload);
        return data;
    },
    async chat(payload) {
        try {
            return await withRetry(() => client.post('/chat', payload).then((r) => r.data), { attempts: 3, delayMs: 2000 });
        }
        catch (err) {
            throw new Error(formatAiServiceError(err));
        }
    },
    async bulkEmbed(tickets) {
        const { data } = await client.post('/embed/bulk', { tickets });
        return data;
    },
    async reviewCode(payload) {
        try {
            return await withRetry(() => client.post('/security/review-code', payload).then((r) => r.data), { attempts: 2, delayMs: 2000 });
        }
        catch (err) {
            throw new Error(formatAiServiceError(err));
        }
    },
};
