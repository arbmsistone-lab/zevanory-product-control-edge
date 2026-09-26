import http from 'node:http';
import { handler } from './backend/index';
import { portableHealth } from './backend/platform';
import { commercialRobotTick } from './backend/commercial';

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

server.listen(port, '0.0.0.0', () => {
  console.log('portable backend listening', port);

  const runCommercialRobot = () => {
    void commercialRobotTick()
      .then(result => console.info('commercial_robot_tick', JSON.stringify(result)))
      .catch(error => console.error('commercial_robot_tick_failed', error instanceof Error ? error.message : String(error)));
  };

  setTimeout(runCommercialRobot, 8_000).unref();
  setInterval(runCommercialRobot, 15 * 60 * 1000).unref();
});
