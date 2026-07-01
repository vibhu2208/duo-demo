import { ChromaClient } from 'chromadb';
import { config } from '../config.js';
import { createEmbedding } from './embeddings.js';
import * as memoryStore from './vector-store.js';
let client = null;
let chromaAvailable = null;
async function isChromaReachable() {
    if (!config.useChroma)
        return false;
    if (chromaAvailable !== null)
        return chromaAvailable;
    try {
        if (!client)
            client = new ChromaClient({ path: config.chromaUrl });
        await client.heartbeat();
        chromaAvailable = true;
    }
    catch {
        chromaAvailable = false;
        console.warn('ChromaDB unavailable — using in-memory vector store for demo');
    }
    return chromaAvailable;
}
async function getChromaCollection() {
    if (!client)
        client = new ChromaClient({ path: config.chromaUrl });
    return client.getOrCreateCollection({
        name: config.chromaCollection,
        metadata: { description: 'Jira ticket embeddings' },
    });
}
export async function upsertTicketEmbedding(payload) {
    if (!(await isChromaReachable())) {
        return memoryStore.upsertVector({
            ticketId: payload.ticketId,
            jiraKey: payload.jiraKey,
            document: payload.document,
            metadata: payload.metadata,
        });
    }
    const collection = await getChromaCollection();
    const embedding = await createEmbedding(payload.document);
    await collection.upsert({
        ids: [payload.ticketId],
        embeddings: [embedding],
        documents: [payload.document],
        metadatas: [{ ticketId: payload.ticketId, jiraKey: payload.jiraKey, ...payload.metadata }],
    });
    await memoryStore.upsertVector({
        ticketId: payload.ticketId,
        jiraKey: payload.jiraKey,
        document: payload.document,
        metadata: payload.metadata,
        embedding,
    });
    return { chromaId: payload.ticketId, success: true };
}
export async function searchSimilar(payload) {
    if (!(await isChromaReachable())) {
        return memoryStore.searchVectors(payload);
    }
    try {
        const collection = await getChromaCollection();
        const embedding = await createEmbedding(payload.queryText);
        const topK = payload.topK ?? 5;
        const results = await collection.query({
            queryEmbeddings: [embedding],
            nResults: topK + (payload.excludeTicketId ? 1 : 0),
        });
        const items = [];
        const ids = results.ids[0] || [];
        const distances = results.distances?.[0] || [];
        const documents = results.documents[0] || [];
        const metadatas = results.metadatas[0] || [];
        for (let i = 0; i < ids.length; i++) {
            const ticketId = ids[i];
            if (payload.excludeTicketId && ticketId === payload.excludeTicketId)
                continue;
            const distance = distances[i] ?? 1;
            const similarityScore = Math.max(0, 1 - distance);
            const meta = (metadatas[i] || {});
            const doc = documents[i] || '';
            items.push({
                ticketId,
                jiraKey: meta.jiraKey || 'UNKNOWN',
                similarityScore: Math.round(similarityScore * 10000) / 10000,
                summary: doc.slice(0, 300),
                resolutionSummary: extractResolutionFromDoc(doc),
                metadata: meta,
            });
            if (items.length >= topK)
                break;
        }
        return items;
    }
    catch {
        return memoryStore.searchVectors(payload);
    }
}
function extractResolutionFromDoc(doc) {
    const match = doc.match(/Resolution:\s*([\s\S]*?)(?:\n\n|$)/i);
    return match ? match[1].trim().slice(0, 500) : '';
}
