import { handler } from '../../backend/index';
import { db } from '../../backend/portable-sdk';

export default async (request: Request) => {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/\.netlify\/functions\/backend/, '') || '/';
    if (path === '/portable-health') {
      const stores = await db.health();
      const ok = stores.neon || stores.supabase;
      return new Response(JSON.stringify({ ok, instance: process.env.BACKEND_INSTANCE_ID || 'netlify', stores }), {
        status: ok ? 200 : 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    const target = new URL(path.startsWith('/api/') ? path : '/api' + path, 'https://portable.local');
    const clone = new Request(target, request);
    return await handler(clone);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'internal_error' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
};
