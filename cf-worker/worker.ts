import { handler, runCertificationExecutor } from './backend-index.ts';
import { portableHealth, setWorkerEnv } from './platform-worker.ts';

const BACKEND_SOURCE_SHA = '7ddd82c8ba23f56b309563fa0fcfa2d4951b5a71';

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

    if (url.pathname === '/runtime-certification-proof') {
      const expected = String(env.SELFTEST_TOKEN || '');
      const supplied = url.searchParams.get('t') || '';
      const targetId = url.searchParams.get('targetId') || '';
      if (!expected || supplied !== expected || !targetId) {
        return Response.json({ ok: false, error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
      }
      try {
        return Response.json(await runCertificationExecutor(targetId), { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        return Response.json({ ok: false, error: String(error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
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
