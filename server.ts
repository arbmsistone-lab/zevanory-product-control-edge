import http from 'node:http';
import { createHash } from 'node:crypto';
import { handler } from './backend/index';
import { portableHealth } from './backend/platform';

const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks);
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);

    if (url.pathname === '/portable-health') {
      const stores = await portableHealth();
      res.statusCode = stores.ok ? 200 : 503;
      res.setHeader('content-type','application/json; charset=utf-8');
      res.end(JSON.stringify({ ...stores, instance: process.env.BACKEND_INSTANCE_ID || 'render' }));
      return;
    }

    if (url.pathname === '/__cluster-token-hash') {
      const value = String(process.env.ZPC_CLUSTER_TOKEN || '');
      res.statusCode = 200;
      res.setHeader('content-type','application/json; charset=utf-8');
      res.setHeader('cache-control','no-store');
      res.end(JSON.stringify({
        present: Boolean(value),
        length: value.length,
        sha256: value ? createHash('sha256').update(value).digest('hex') : '',
      }));
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
