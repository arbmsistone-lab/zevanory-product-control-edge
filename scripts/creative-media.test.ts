// Regression guards for creative media states and company isolation (owner audit 13/10, Missions 3-4).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ws = read('../src/CommercialWorkspace.tsx');
const worker = read('../cf-worker/worker.ts');
const app = read('../src/App.tsx');

// 1. No raw <img> for creative media: every creative image goes through CreativeImage (onError state).
assert.doesNotMatch(ws, /<img className='approvalImage'/);
assert.doesNotMatch(ws, /<img src=\{item\.imageUrl/);
assert.match(ws, /onError=\{\(\) => \{ const original = creativeOriginalUrl\(current\); if \(original && original !== current\) setCurrent\(original\); else setFailed\(true\); \}\}/);
assert.match(ws, /IMAGEM INDISPONÍVEL/);
assert.match(ws, /PUBLICADO · ASSET NÃO VERIFICÁVEL/);
assert.match(ws, /published=\{item\.status === 'published'\}/);
// The original-URL fallback only rewrites the panel's own asset route (same origin, no foreign hosts).
const rewrite = ws.match(/export function creativeOriginalUrl[\s\S]*?\n}/)?.[0] || '';
assert.match(rewrite, /\\\/api\\\/commercial\\\/creative\\\/assets\\\/\[0-9a-f-\]\{36\}\\\.\(jpg\|png\)\$/);

// 2. Asset route: transform failure falls back to the stored original; missing asset stays 404.
assert.match(worker, /async function readRawCreativeAsset\(env: any, id: string, ext: string, method: string\)/);
assert.match(worker, /if \(transformed && transformed\.status === 404\) return transformed;\n\s+const original = await readRawCreativeAsset\(env, match\[1\], match\[2\], request\.method\);/);
assert.match(worker, /original\.headers\.set\('x-zpc-image-source', 'original-fallback'\)/);
assert.doesNotMatch(worker, /if \(!transformed\.ok\) return transformed;/);

// 3. ARBM projects are not ZEVANORY certification targets; nothing is deleted from the catalog.
assert.match(app, /const isExternalCertificationTarget = \(name: string\) => \/\^ARBM\\b\/i\.test/);
assert.match(app, /!isExternalCertificationTarget\(target\.name\)/);
assert.match(app, /projeto\(s\) externo\(s\) fora do escopo/);

console.log('creative-media: 3 groups passed');
