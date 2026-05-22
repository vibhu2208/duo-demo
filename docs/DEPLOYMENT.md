# Deployment (Render + Vercel)

## Service URLs

| Service | URL |
|---------|-----|
| AI service (Render) | https://duo-demo.onrender.com |
| Backend (Render) | https://duo-demo-wq9t.onrender.com |
| Frontend (Vercel) | Set `FRONTEND_URL` on backend to your Vercel URL after deploy |

Frontend API calls are proxied via `frontend/vercel.json` → backend.

## Render: AI service (`ai-service`)

Root directory: `ai-service`

```env
AI_PROVIDER=gitlab
GITLAB_URL=https://gitlab.engine-onprem.capgemini.com
GITLAB_TOKEN=<your-token>
EMBEDDING_PROVIDER=local
USE_CHROMA=false
```

Render sets `PORT` automatically; the app listens on `PORT` (no need to set `AI_SERVICE_PORT`).

## Render: Backend (`backend`)

Root directory: `backend`

```env
DATABASE_URL=<neon-url>
REDIS_URL=<upstash-or-render-redis-url>
JWT_SECRET=<long-random-string>
AI_SERVICE_URL=https://duo-demo.onrender.com
FRONTEND_URL=https://<your-app>.vercel.app
```

Run once after deploy (Render Shell): `npm run migrate`

## Vercel: Frontend (`frontend`)

Root directory: `frontend`. Rewrites are in `frontend/vercel.json` (no env vars required).

## Health checks

- AI: https://duo-demo.onrender.com/health
- Backend: https://duo-demo-wq9t.onrender.com/health
