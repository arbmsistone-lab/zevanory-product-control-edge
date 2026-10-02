import fs from 'node:fs';

const app=fs.readFileSync('src/App.tsx','utf8');
const worker=fs.readFileSync('cf-worker/worker.ts','utf8');
const shellPath=process.env.CANONICAL_SHELL_PATH || 'src/styles/shell.css';
const shell=fs.readFileSync(shellPath,'utf8');

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
  "internal-public-mirror"
]){
  if(!worker.includes(required)) fail('worker contract missing: '+required);
}

for(const forbidden of [
  'width: 100vw;',
  'max-width: 100vw',
  'overflow-x: auto',
  'overflow-x: scroll'
]){
  if(shell.includes(forbidden)) fail('horizontal overflow regression detected: '+forbidden);
}

for(const required of [
  'width: 100%;',
  'height: 100dvh;',
  'max-width: 100% !important;',
  'max-height: 100dvh !important;',
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


const publicRoutes=[
  'solucoes','zevanory-one','arbm-contador-saloes','arbm-sist',
  'ia-na-pratica','vendas-na-pratica','lucro-e-caixa','combo-ia-vendas',
  'negocio-completo','privacidade','termos','reembolso','afiliados'
];
for(const slug of publicRoutes){
  const path='public/'+slug+'/index.html';
  if(!fs.existsSync(path)) fail('missing public route '+slug);
  const html=fs.readFileSync(path,'utf8');
  if(html.includes('https://zevanory.api.br')) fail('legacy canonical URL in '+slug);
  if(html.includes('/zevanory-public-mirror')) fail('legacy mirror prefix in '+slug);
  if(!html.includes('https://controle.zevanory.api.br')) fail('canonical public origin missing in '+slug);
}
if(!fs.existsSync('public/product.css')) fail('shared public stylesheet missing');
if(!fs.existsSync('public/legal.css')) fail('shared legal stylesheet missing');
if(!fs.existsSync('public/brand/zevanory-logo-dark.svg')) fail('canonical brand asset missing');
console.log('PUBLIC_ROUTE_COUNT='+publicRoutes.length);
console.log('PUBLIC_SURFACE_GATE=PASS');


for(const slug of publicRoutes){
  const html=fs.readFileSync('public/'+slug+'/index.html','utf8');
  const absolute=[...html.matchAll(/(?:href|src)=["'](https?:\/\/[^"']+)["']/g)].map(m=>m[1]);
  for(const url of absolute){
    if(!url.startsWith('https://controle.zevanory.api.br')) fail('non-canonical absolute public URL in '+slug+': '+url);
  }
}
