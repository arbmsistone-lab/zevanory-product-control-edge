import { handler } from '../backend/index';
import { db } from '../backend/portable-sdk';

export default async function endpoint(req: any, res: any) {
  try {
    const path = String(req.query.path || '');
    if (path === 'portable-health') {
      const stores = await db.health();
      const ok = stores.neon || stores.supabase;
      return res.status(ok ? 200 : 503).json({ ok, instance: process.env.BACKEND_INSTANCE_ID || 'vercel', stores });
    }
    const pathname = '/api/' + path.replace(/^api\//, '');
    const url = new URL(pathname, 'https://portable.local');
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: ['GET','HEAD'].includes(req.method || 'GET') ? undefined : JSON.stringify(req.body || {}),
    });
    const response = await handler(request);
    const body = await response.text();
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return res.status(response.status).send(body);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'internal_error' });
  }
}
