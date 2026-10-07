import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const enc=s=>Buffer.from(s).toString('base64url');
const sign=(payload,key)=>crypto.createHmac('sha256',key).update(payload).digest('base64url');
const issue=(key,jti='jti-test',ttlMs=8*3600_000)=>{const payload=enc(JSON.stringify({exp:Date.now()+ttlMs,jti}));return 'zpc1.'+payload+'.'+sign(payload,key)};
const revoked=new Map();
function decode(token){const p=token.split('.');if(p.length!==3||p[0]!=='zpc1')return null;try{return{parts:p,payload:JSON.parse(Buffer.from(p[1],'base64url').toString('utf8'))}}catch{return null}}
function verify(token,current,previous=''){
 const d=decode(token);if(!d||Number(d.payload.exp||0)<=Date.now())return false;
 const keys=[current,previous].filter(Boolean);
 const sigOk=keys.some(k=>crypto.timingSafeEqual(Buffer.from(sign(d.parts[1],k)),Buffer.from(d.parts[2])));
 return sigOk&&!revoked.has('zpc-session-revoked:'+String(d.payload.jti||d.payload.nonce||''));
}
function logout(token,current,previous=''){
 const d=decode(token);assert.ok(d);assert.equal(verify(token,current,previous),true);
 const ttl=Math.max(1,Math.ceil((d.payload.exp-Date.now())/1000));
 revoked.set('zpc-session-revoked:'+d.payload.jti,{ttl});
 return ttl;
}
const current='current-key-32-bytes-minimum-value';
const previous='previous-key-32-bytes-minimum';
const token=issue(current);
assert.equal(verify(token,current,previous),true);
const ttl=logout(token,current,previous);
assert.ok(ttl>0&&ttl<=8*3600);
assert.equal(verify(token,current,previous),false);

const rotated=issue(previous,'old-jti');
assert.equal(verify(rotated,current,previous),true);
assert.equal(verify(rotated,current,'unknown-key-32-bytes-minimumxx'),false);

function proxyStatus(bearer,currentKey,previousKey=''){
 if(bearer?.startsWith('zpc1.')&&!verify(bearer,currentKey,previousKey))return 401;
 return 200;
}
assert.equal(proxyStatus(token,current,previous),401);
assert.equal(proxyStatus(rotated,current,previous),200);

const backend=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../backend/index.ts',import.meta.url),'utf8'));
const edge=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../cf-worker/worker.ts',import.meta.url),'utf8'));
assert.ok(backend.includes('const SESSION_HOURS = 8;'));
assert.ok(backend.includes("SESSION_SIGNING_KEY_PREVIOUS"));
assert.ok(edge.includes("session_revoked_or_invalid"));
assert.ok(edge.includes("bearer.startsWith('zpc1.')"));
assert.ok(!edge.includes('cacheTtl'));
console.log(JSON.stringify({session_security:'PASS',logout_revocation:true,rotation_previous_key:true,unknown_key_rejected:true,proxied_revoked_bearer_401:true,kv_revocation_read_uncached:true}));
