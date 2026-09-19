import { handler } from './backend-index.ts';
import { portableHealth, setWorkerEnv } from './platform-worker.ts';

const BACKEND_SOURCE_SHA = 'b2a0c46488f0ea9ae14f536b6beeb71afefe346e';

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    setWorkerEnv(env);
    const url = new URL(request.url);

    if (url.pathname === '/portable-health') {
      const health = await portableHealth();
      return Response.json({ ...health, runtime: 'cloudflare-worker', backendSourceSha: BACKEND_SOURCE_SHA, workerCommit: String(env.WORKER_COMMIT || 'untracked') }, {
        status: health.ok ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/runtime-proof') {
      return Response.json({ ok: true, runtime: 'cloudflare-worker', backendSourceSha: BACKEND_SOURCE_SHA, workerCommit: String(env.WORKER_COMMIT || 'untracked'), directBackend: true }, {
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/definir-pin' || url.pathname === '/__complete-pin-migration') {
      return Response.json(
        { ok: false, error: 'migration_closed' },
        { status: 410, headers: { 'cache-control': 'no-store, max-age=0' } },
      );
    }

    if (url.pathname.startsWith('/api/')) {
      const forceDirect = url.searchParams.get('runtime') === 'cloudflare';
      const renderBase = forceDirect ? '' : String(env.RENDER_BACKEND_URL || '').replace(/\/$/, '');
      if (renderBase) {
        try {
          const target = renderBase + url.pathname + url.search;
          const primaryResponse = await fetch(new Request(target, request.clone()));
          if (primaryResponse.status < 500) return primaryResponse;
        } catch {}
      }
      return handler(request);
    }

    return handler(request);
  },
};
