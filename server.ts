import http from 'node:http';
import { handler } from './backend/index';

const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const url = `${proto}://${host}${req.url || '/'}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const request = new Request(url, {
      method: req.method || 'GET',
      headers,
      body: raw.length && !['GET','HEAD'].includes(req.method || 'GET') ? raw : undefined,
    });
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (cause) {
    console.error('node_server_error', cause);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'server_failure' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`ZEVANORY PRODUCT CONTROL listening on ${port}`);
});
