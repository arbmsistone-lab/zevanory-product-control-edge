import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 10000);
const json = (res, body, status=200) => {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(body));
};
const fixture = {
  dashboard: {
    systems: [], audits: [], improvements: [], incidents: [],
    policy: { zeroSpend: true, failClosed: true, destructiveActions: false, greenRule: 'PREVIEW MOCK' },
    lastEngineRun: new Date().toISOString(), certificationRuns: [],
  },
  globalTrust: {
    state: 'BLOCKED', sha: null, evidenceRoot: null, policyVersion: 'ZEA-10',
    quorum: { passed: 0, total: 3, required: 3, conflicts: 0, independentKeys: 0 },
    zea10: { proven: 0, partial: 0, blocked: 10 }, engines: [], checkedAt: null,
  },
  operations: null, commercial: null, cfo: null, products: [], certificationTargets: [],
  summary: { total: 0, salesEnabled: 0, commercialReady: 0, blocked: 0, certified: 0, inCertification: 0, zeesBlocked: 0 },
};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const readBody=req=>new Promise(resolve=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>resolve(s));});
http.createServer(async (req,res)=>{
  const u=new URL(req.url||'/', 'http://preview.local');
  if (u.pathname==='/preview-meta') return json(res,{preview:true,source:'PR #120',sha:process.env.PREVIEW_SHA||'candidate',backend:'mock',supabase:false});
  if (u.pathname==='/global-trust.json') return json(res,fixture.globalTrust);
  if (u.pathname==='/api/_auth_diagnostic') return json(res,{secretValid:true,locked:false,sessionRoundtrip:true,bootstrapOk:true,stage:'owner-preview'});
  if (u.pathname==='/api/pin/login' && req.method==='POST') { await readBody(req); return json(res,{ok:true,sessionToken:'zpc1.owner-preview.synthetic',expiresAt:new Date(Date.now()+3600000).toISOString()}); }
  if (u.pathname==='/api/pin/logout' && req.method==='POST') return json(res,{ok:true});
  if (u.pathname==='/api/admin/bootstrap' && req.method==='POST') { await readBody(req); return json(res,fixture); }
  if (u.pathname.startsWith('/api/commercial/stream')) {
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
    res.write('event: commercial-update\ndata: {"preview":true}\n\n'); return res.end();
  }
  const safe=decodeURIComponent(u.pathname).replace(/\.\./g,'');
  let target=path.join(root, safe==='/'?'index.html':safe);
  if(!fs.existsSync(target)||fs.statSync(target).isDirectory()) target=path.join(root,'index.html');
  try { res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':path.basename(target)==='index.html'?'no-store':'public, max-age=300'}); fs.createReadStream(target).pipe(res); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port,'0.0.0.0',()=>console.log('OWNER_PREVIEW_READY port='+port));
