import http from 'node:http';
import { Readable } from 'node:stream';

const upstream = 'https://arbm-control-senior-d2xvhh.v2.appdeploy.ai';
const port = Number(process.env.PORT || 3000);

function copyHeaders(src, res) {
  const skip = new Set(['content-encoding','content-length','transfer-encoding','connection']);
  for (const [k,v] of src.headers.entries()) {
    if (!skip.has(k.toLowerCase())) res.setHeader(k,v);
  }
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url || '/', upstream);
    if (url.pathname === '/facade-health') {
      res.writeHead(200, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      return res.end(JSON.stringify({ok:true, facade:'zevanory-product-control', upstream}));
    }

    const body = ['GET','HEAD'].includes(req.method || 'GET') ? undefined : Readable.toWeb(req);
    const headers = new Headers();
    for (const [k,v] of Object.entries(req.headers)) {
      if (!v) continue;
      if (k.toLowerCase() === 'host' || k.toLowerCase() === 'content-length') continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    const upstreamRes = await fetch(url, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
      duplex: body ? 'half' : undefined
    });

    copyHeaders(upstreamRes,res);
    res.statusCode = upstreamRes.status;
    if (upstreamRes.body) Readable.fromWeb(upstreamRes.body).pipe(res);
    else res.end();
  } catch {
    res.writeHead(502, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
    res.end(JSON.stringify({ok:false,error:'upstream_unavailable'}));
  }
});

server.listen(port,'0.0.0.0',() => {
  console.log('ZEVANORY facade listening on', port);
});