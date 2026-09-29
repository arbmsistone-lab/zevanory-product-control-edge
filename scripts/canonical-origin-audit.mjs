import fs from 'node:fs';

const app=fs.readFileSync('src/App.tsx','utf8');
const worker=fs.readFileSync('cf-worker/worker.ts','utf8');
const shell=fs.readFileSync('src/styles/shell.css','utf8');

const fail=(m)=>{console.error('CANONICAL_ORIGIN_GATE=FAIL',m);process.exit(1)};

if(app.includes("https://zevanory.api.br")) fail('legacy public origin hardcoded in App.tsx');
if(!app.includes("href='/solucoes'")) fail('sales link is not relative /solucoes');

for(const required of [
  "const CANONICAL_PUBLIC_ORIGIN = 'https://controle.zevanory.api.br';",
  "const PUBLIC_MIRROR_ORIGIN = 'https://arbmsistone-lab.github.io/zevanory-public-mirror';",
  "if (url.hostname === 'zevanory.api.br')",
  "'/solucoes':'/solucoes'",
  "'/produtos/zevanory-one':'/zevanory-one'",
  "'/produtos/arbm-sist':'/arbm-sist'",
  "'/termos':'/termos'",
  "'/privacidade':'/privacidade'",
  "'/reembolso':'/reembolso'",
  "x-zpc-canonical-origin",
  "internal-public-mirror",
  "const INTERNAL_CORE_ORIGIN = 'https://zevanory.api.br';",
  "normalizedPath.startsWith('/api/core/v1/')",
  "internal-control-core"
]){
  if(!worker.includes(required)) fail('worker contract missing: '+required);
}

for(const required of [
  'width: 100vw;',
  'height: 100vh;',
  'max-width: 100vw !important;',
  'max-height: 100vh !important;',
  'overflow: hidden !important;',
  'overscroll-behavior: none !important;',
  'text-rendering: optimizeLegibility;',
  '-webkit-font-smoothing: antialiased;'
]){
  if(!shell.includes(required)) fail('zero-scroll contract missing: '+required);
}

console.log('CANONICAL_ORIGIN_GATE=PASS');
console.log('PUBLIC_ORIGIN=https://controle.zevanory.api.br');
console.log('SALES_ROUTE=/solucoes');
console.log('ZERO_SCROLL_ROOT=PASS');

if(worker.includes("const LEGACY_PUBLIC_ORIGIN")) fail('legacy public origin remains in worker');
console.log('PUBLIC_PRODUCTS_PREFIX=/produtos/');
console.log('LEGAL_ROUTES=/termos,/privacidade,/reembolso');

const wrangler=fs.readFileSync('cf-worker/wrangler.toml','utf8');
if(!wrangler.includes('pattern = "controle.zevanory.api.br"')) fail('canonical Cloudflare route missing');
if(wrangler.includes('zevanory.api.br/control')) fail('legacy public control route still configured');
console.log('CORE_PUBLIC_PREFIX=/api/core/v1/');
