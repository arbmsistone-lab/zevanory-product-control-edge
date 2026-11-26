// E3: proxy HTTPS local (MITM com certificado autoassinado gerado na hora) para os três navegadores.
// Cookies, SameSite, CORS, CSP e redirecionamentos ficam a cargo do PRÓPRIO navegador (sem interceptação do
// Playwright, que injeta CORS e, no WebKit, não expõe o cookie do pedido). Só 4 hosts existem:
//   controle.zevanory.api.br -> build local do painel + APIs do painel com fixtures
//   zevanory.api.br          -> Worker real do chat em Node (harness), dados e PIN fictícios
//   outro.zevanory.api.br e evil.example.test -> páginas atacantes do teste
// Qualquer outro host é recusado e registrado (prova de que nada vai para a produção).
import http from 'node:http';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const HOSTS = Object.freeze(['controle.zevanory.api.br', 'zevanory.api.br', 'outro.zevanory.api.br', 'evil.example.test']);

function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-cert-'));
  const key = path.join(dir, 'k.pem'), crt = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=e3-isolated',
    '-addext', 'subjectAltName=' + HOSTS.map((h) => 'DNS:' + h).join(','), '-keyout', key, '-out', crt], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// handler(host, request: Request) => Promise<Response>
export async function startProxy(handler) {
  const creds = selfSigned();
  const refused = new Set();
  const inner = http.createServer(async (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (k !== 'host' && k !== 'connection' && k !== 'content-length') headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    let out;
    try { out = await handler(host, new Request('https://' + host + req.url, { method: req.method, headers, body })); }
    catch (e) { out = new Response('e3 proxy handler error: ' + e.message, { status: 500 }); }
    const h = {};
    out.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(k)) h[k] = v; });
    const cookies = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
    if (cookies.length) h['set-cookie'] = cookies;
    const buf = Buffer.from(await out.arrayBuffer());
    h['content-length'] = String(buf.length);
    res.writeHead(out.status, h); res.end(req.method === 'HEAD' ? undefined : buf);
  });
  const outer = http.createServer((req, res) => { refused.add('http://' + req.headers.host + req.url); res.writeHead(403); res.end('e3: only https'); });
  outer.on('connect', (req, socket) => {
    const [host] = String(req.url).split(':');
    if (!HOSTS.includes(host)) { refused.add(host); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const t = new tls.TLSSocket(socket, { isServer: true, key: creds.key, cert: creds.cert, ALPNProtocols: ['http/1.1'] });
    t.on('error', () => {});
    inner.emit('connection', t);
  });
  outer.on('clientError', () => {});
  await new Promise((r) => outer.listen(0, '127.0.0.1', r));
  return { port: outer.address().port, refused, close: () => { outer.close(); inner.close(); } };
}
