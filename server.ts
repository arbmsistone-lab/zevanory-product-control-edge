import http from 'node:http';
import { verifyCommercialRobotTickRequest } from './backend/commercial-robot-auth.mjs';
import { voiceEncodeHandler } from './backend/voice-encoder.mjs';
import { voiceSynthHandler } from './backend/voice-synth.mjs';
import { handler } from './backend/index';
import { portableHealth } from './backend/platform';
import { commercialRobotTick } from './backend/commercial';
import { runDrReconcileDryRun } from './scripts/dr-reconcile-zpc';

const port = Number(process.env.PORT || 3000);

const allowedCorsOrigins = new Set(['https://controle.zevanory.api.br']);

function applyCors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (!allowedCorsOrigins.has(origin)) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '600');
}


const server = http.createServer(async (req, res) => {
  try {
    if (await voiceEncodeHandler(req, res)) return;
    if (await voiceSynthHandler(req, res)) return;
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks);
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);

    if (url.pathname === '/api/commercial/robot/tick') {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
        return;
      }
      const auth = verifyCommercialRobotTickRequest(req.headers);
      if (!auth.ok) {
        res.statusCode = auth.status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: auth.error }));
        return;
      }
      const result = await commercialRobotTick();
      res.statusCode = result.ok ? 200 : 409;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === '/api/commercial/stream' || url.pathname === '/control/api/commercial/stream') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache, no-transform');
      res.setHeader('connection', 'keep-alive');
      res.setHeader('x-accel-buffering', 'no');
      res.flushHeaders?.();
      let seq = 0;
      const emit = () => {
        seq += 1;
        res.write(`id: ${Date.now()}-${seq}\nevent: commercial-update\ndata: {"seq":${seq},"at":"${new Date().toISOString()}"}\n\n`);
      };
      emit();
      const timer = setInterval(emit, 5000);
      const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15000);
      req.on('close', () => { clearInterval(timer); clearInterval(heartbeat); });
      return;
    }

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

  const commercialRobotEnabled = String(process.env.COMMERCIAL_ROBOT_ENABLED ?? '1').trim() !== '0';
  if (commercialRobotEnabled) {
    setTimeout(runCommercialRobot, 8_000).unref();
    setInterval(runCommercialRobot, 15 * 60 * 1000).unref();
  } else {
    console.info('commercial_robot_disabled');
  }

  if (String(process.env.DR_RECONCILE_DRY_RUN || '').trim() === '1') {
    void runDrReconcileDryRun()
      .then(summary => console.info('dr_reconcile_dry_run', JSON.stringify(summary)))
      .catch(error => console.error('dr_reconcile_dry_run_failed', error instanceof Error ? error.message : String(error)));
  }
});
