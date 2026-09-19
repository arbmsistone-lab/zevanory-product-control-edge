import http from 'node:http';
import { Readable } from 'node:stream';

const upstream = 'https://arbm-control-senior-d2xvhh.v2.appdeploy.ai';
const port = Number(process.env.PORT || 3000);
const collections = ['acs_engine','acs_pin_security','acs_products_admin','acs_systems'];

let replicationStatus = { state: 'initializing', parity: false, lastRun: null, collections: {} };

function copyHeaders(src, res) {
  const skip = new Set(['content-encoding','content-length','transfer-encoding','connection']);
  for (const [k,v] of src.headers.entries()) if (!skip.has(k.toLowerCase())) res.setHeader(k,v);
}

async function primaryList(collection) {
  const url = process.env.ZPC_SUPABASE_URL;
  const key = process.env.ZPC_SUPABASE_KEY;
  const token = process.env.ZPC_CLUSTER_TOKEN;
  const res = await fetch(url + '/rest/v1/rpc/zpc_peer_list', {
    method: 'POST',
    headers: {'content-type':'application/json', apikey:key, authorization:'Bearer '+key},
    body: JSON.stringify({p_token:token,p_collection:collection,p_limit:1000})
  });
  if (!res.ok) throw new Error('primary_list_'+res.status);
  return await res.json();
}

async function secondary(op, collection, extra={}) {
  const res = await fetch(process.env.ZPC_NETLIFY_PEER_URL, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({token:process.env.ZPC_CLUSTER_TOKEN,op,collection,...extra})
  });
  if (!res.ok) throw new Error('secondary_'+op+'_'+res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'secondary_failed');
  return data.data;
}

async function seedAndVerify() {
  const details = {};
  try {
    for (const collection of collections) {
      const source = await primaryList(collection);
      const items = source.map(row => {
        const {id,...record}=row;
        return {id:String(id),record};
      });
      if (items.length) await secondary('upsert', collection, {items});
      const replica = await secondary('list', collection, {limit:1000});
      const a = source.map(x=>String(x.id)).sort();
      const b = replica.map(x=>String(x.id)).sort();
      const parity = a.length===b.length && a.every((id,i)=>id===b[i]);
      details[collection] = {primary:a.length,secondary:b.length,parity};
      if (!parity) throw new Error('parity_mismatch_'+collection);
    }
    replicationStatus = {state:'ready',parity:true,lastRun:new Date().toISOString(),collections:details};
    console.log('ZPC replication parity PASS', JSON.stringify(details));
  } catch (error) {
    replicationStatus = {state:'degraded',parity:false,lastRun:new Date().toISOString(),collections:details,error:String(error)};
    console.error('ZPC replication parity FAIL', String(error));
  }
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url || '/', upstream);
    if (url.pathname === '/facade-health') {
      res.writeHead(200, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      return res.end(JSON.stringify({ok:true,facade:'zevanory-product-control',upstream,replication:{state:replicationStatus.state,parity:replicationStatus.parity}}));
    }
    if (url.pathname === '/replication-status') {
      res.writeHead(replicationStatus.parity ? 200 : 503, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      return res.end(JSON.stringify(replicationStatus));
    }
    const body = ['GET','HEAD'].includes(req.method || 'GET') ? undefined : Readable.toWeb(req);
    const headers = new Headers();
    for (const [k,v] of Object.entries(req.headers)) {
      if (!v) continue;
      if (k.toLowerCase() === 'host' || k.toLowerCase() === 'content-length') continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    const upstreamRes = await fetch(url, { method:req.method, headers, body, redirect:'manual', duplex:body?'half':undefined });
    copyHeaders(upstreamRes,res);
    res.statusCode = upstreamRes.status;
    if (upstreamRes.body) Readable.fromWeb(upstreamRes.body).pipe(res); else res.end();
  } catch {
    res.writeHead(502, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
    res.end(JSON.stringify({ok:false,error:'upstream_unavailable'}));
  }
});

server.listen(port,'0.0.0.0',() => {
  console.log('ZEVANORY facade listening on', port);
  void seedAndVerify();
});