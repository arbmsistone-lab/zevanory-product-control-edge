import http from 'node:http';
import { handler } from './backend/index';
import { db } from './backend/portable-sdk';

const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks);
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);

    if (url.pathname === '/portable-health') {
      const stores = await db.health();
      const ok = stores.neon || stores.supabase;
      res.statusCode = ok ? 200 : 503;
      res.setHeader('content-type','application/json; charset=utf-8');
      res.end(JSON.stringify({ ok, instance: process.env.BACKEND_INSTANCE_ID || 'render', stores }));
      return;
    }

    const request = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: rawBody.length ? rawBody : undefined,
    });
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'internal_error' }));
  }
});

server.listen(port, '0.0.0.0', () => console.log('portable backend listening', port));
