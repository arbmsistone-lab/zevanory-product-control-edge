import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const worker=fs.readFileSync('cf-worker/worker.ts','utf8');
const view=fs.readFileSync('src/App.tsx','utf8');
test('owner bridge requires a verified PIN session and fails closed without an independent secret',()=>{
 assert.match(worker,/normalizedPath === '\/api\/owner\/oauth\/ticket'/);
 assert.match(worker,/await verifyEdgeSession\(token\)/);
 assert.match(worker,/OWNER_OAUTH_BRIDGE_SECRET/);
 assert.match(worker,/master.length < 32/);
 assert.match(worker,/zpc-oauth-v1/);
 assert.match(worker,/crypto.subtle.sign\('HMAC'/);
 assert.match(worker,/if \(!\['youtube', 'pinterest'\].includes\(channel\)/);
});
test('panel offers connect and local disconnect and never asks for refresh tokens',()=>{
 assert.match(view,/Conectar canais/);
 assert.match(view,/Conectar \{channel === 'youtube'/);
 assert.match(view,/action: 'status'/);
 assert.match(view,/window.location.assign\(target.toString\(\)\)/);
 assert.match(view,/target.origin !== new URL\(OWNER_OAUTH_BASE\)\.origin/);
 assert.match(view,/sessionToken, channel, action/);
 assert.doesNotMatch(view,/localStorage\.setItem\(['"]oauth/i);
});
test('status/disconnect read the shared private KV directly; tokens never leave the edge',()=>{
 assert.match(worker,/action === 'status' \|\| action === 'disconnect'/);
 assert.match(worker,/'zpc:owner:oauth:connection:' \+ channel \+ ':v1'/);
 assert.doesNotMatch(worker,/encryptedRefresh:\s*record/);
 assert.match(worker,/Boolean\(record\?\.encryptedRefresh\)/);
});
