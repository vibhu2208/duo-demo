import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { config, getAiSetupStatus } from './config.js';
import { getActiveProviderLabel } from './lib/llm/index.js';
import { getStoreSize } from './lib/vector-store.js';
import { embedTicket, analyzeTicket, generateRecommendation, ragChat } from './services/rag.service.js';
import { searchSimilar } from './lib/chroma.js';
import { buildTicketDocument } from './lib/text.js';
import { upsertTicketEmbedding } from './lib/chroma.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/health', async (_req, res) => {
  const setup = await getAiSetupStatus();
  res.json({
    status: 'ok',
    service: 'ai-service',
    provider: config.provider,
    providerLabel: await getActiveProviderLabel(),
    aiReady: setup.ready,
    setupMessage: setup.message,
    gitlab: setup.gitlab,
    openai: !!config.openaiApiKey,
    embeddingProvider: config.embeddingProvider,
    chroma: config.chromaUrl,
    memoryVectors: getStoreSize(),
    hardcodedMock: config.provider === 'mock',
  });
});

const embedSchema = z.object({
  ticketId: z.string(),
  jiraKey: z.string(),
  title: z.string(),
  description: z.string().default(''),
  comments: z.array(z.string()).default([]),
  resolution: z.string().default(''),
  labels: z.array(z.string()).default([]),
});

app.post('/embed', async (req, res) => {
  const parsed = embedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await embedTicket(parsed.data);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embed failed';
    res.status(500).json({ error: message });
  }
});

app.post('/embed/bulk', async (req, res) => {
  const tickets = req.body.tickets as z.infer<typeof embedSchema>[];
  let indexed = 0;
  let failed = 0;

  for (const t of tickets || []) {
    try {
      const doc = buildTicketDocument(t);
      await upsertTicketEmbedding({
        ticketId: t.ticketId,
        jiraKey: t.jiraKey,
        document: doc,
        metadata: { title: t.title.slice(0, 200), hasResolution: t.resolution ? 1 : 0 },
      });
      indexed++;
    } catch {
      failed++;
    }
  }

  res.json({ indexed, failed });
});

app.post('/search/similar', async (req, res) => {
  const { queryText, ticketId, topK, resolvedOnly } = req.body;
  if (!queryText) return res.status(400).json({ error: 'queryText required' });

  try {
    const results = await searchSimilar({
      queryText,
      topK: topK || 5,
      excludeTicketId: ticketId,
    });

    const filtered = resolvedOnly
      ? results.filter((r) => r.resolutionSummary.length > 0)
      : results;

    res.json({ results: filtered });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    res.status(500).json({ error: message });
  }
});

app.post('/analyze', async (req, res) => {
  try {
    const result = await analyzeTicket(req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analyze failed';
    res.status(500).json({ error: message });
  }
});

app.post('/recommend', async (req, res) => {
  try {
    const result = await generateRecommendation(req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recommend failed';
    res.status(500).json({ error: message });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const result = await ragChat(req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat failed';
    console.error('[chat]', message);
    res.status(500).json({ error: message });
  }
});

app.listen(config.port, async () => {
  const setup = await getAiSetupStatus();
  console.log(`AI Service running on http://localhost:${config.port}`);
  console.log(`Provider: ${config.provider} → ${await getActiveProviderLabel()}`);
  console.log(`Status: ${setup.message}`);
  if (!setup.ready && config.provider !== 'mock') {
    console.warn('⚠️  AI calls will fail until credentials are fixed in .env');
  }
});
