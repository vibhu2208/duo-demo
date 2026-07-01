import { createEmbedding, cosineSimilarity } from './embeddings.js';
const store = new Map();
export async function upsertVector(record) {
    const embedding = record.embedding ?? (await createEmbedding(record.document));
    store.set(record.ticketId, { ...record, embedding });
    return { chromaId: record.ticketId, success: true };
}
export async function searchVectors(payload) {
    const topK = payload.topK ?? 5;
    const queryEmb = await createEmbedding(payload.queryText);
    const scored = [...store.values()]
        .filter((r) => r.ticketId !== payload.excludeTicketId)
        .map((r) => ({
        ticketId: r.ticketId,
        jiraKey: r.jiraKey,
        similarityScore: Math.round(cosineSimilarity(queryEmb, r.embedding) * 10000) / 10000,
        summary: r.document.slice(0, 300),
        resolutionSummary: extractResolution(r.document),
        metadata: r.metadata,
    }))
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, topK);
    return scored;
}
function extractResolution(doc) {
    const match = doc.match(/Resolution:\s*([\s\S]*?)(?:\n\n|$)/i);
    return match ? match[1].trim().slice(0, 500) : '';
}
export function getStoreSize() {
    return store.size;
}
export function clearStore() {
    store.clear();
}
