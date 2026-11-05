// Trava de vendas nos publicadores do painel (T2 legenda + T3 publicador Meta), com o código real do Worker
// (cf-worker/worker.ts) pelas rotas HMAC /api/commercial/publish/tick e /api/commercial/creative/upload.
// Rede simulada: Supabase RPC, Graph API da Meta, página de vendas e o service binding CORE_WORKER.
// Estados da trava: aberta (open:true), fechada (open:false) e falha de leitura (exceção, 5xx, JSON inválido,
// binding ausente, open não booleano) => sempre FECHADA.
import assert from 'node:assert/strict';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { CREATIVE_FACTORY_PURPOSE, CREATIVE_UPLOAD_PURPOSE, TICK_SECRET_NAME } from '../cf-worker/commercial-hmac.ts';
import { readCoreSalesOpen, resetSalesLockHoldMemo, salesLockViolations, SALES_LOCK_HOLD_PREFIX, SALES_STATUS_URL } from '../cf-worker/sales-lock.ts';

const { default: worker } = await import('../cf-worker/worker.ts');
const TEST_SECRET = 'teste-local-sales-lock-nao-e-segredo-0123456789';
const PRICE_CAPTION = 'IA na Prática: guia digital.\n\nIA na Prática custa R$ 197,00 (preço de tabela).\nhttps://vendas.zevanory.api.br/ia-na-pratica';
const CLEAN_CAPTION = 'IA na Prática: guia digital.\n\nhttps://vendas.zevanory.api.br/ia-na-pratica';

type Core = 'open' | 'closed' | 'throw' | 'http500' | 'badjson' | 'missing' | 'string_true';
function coreBinding(mode: Core) {
  if (mode === 'missing') return undefined;
  return {
    calls: 0,
    async fetch(url: string) {
      this.calls++;
      assert.equal(String(url), SALES_STATUS_URL);
      if (mode === 'throw') throw new Error('core_down');
      if (mode === 'http500') return new Response(JSON.stringify({ open: true }), { status: 500 });
      if (mode === 'badjson') return new Response('{open:true', { status: 200 });
      if (mode === 'string_true') return Response.json({ open: 'true' });
      return Response.json({ open: mode === 'open' });
    },
  };
}

function kvMock() {
  const m = new Map<string, any>();
  return { m, puts: [] as string[], async get(k: string) { return m.get(k) ?? null; }, async put(k: string, v: any) { this.puts.push(k); m.set(k, v); }, async delete(k: string) { m.delete(k); } };
}

function makeNet(items: any[], { productDescription = 'Guia digital com passo a passo.' } = {}) {
  const log = { graph: [] as string[], upserts: [] as any[], pages: [] as string[] };
  const fake = async (input: any, init: any = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://sb.test/rest/v1/rpc/zpc_worker_list')) return Response.json({ items });
    if (url.startsWith('https://sb.test/rest/v1/rpc/zpc_worker_upsert')) { log.upserts.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); }
    if (url.startsWith('https://graph.facebook.com/')) {
      log.graph.push((init.method || 'GET') + ' ' + url.split('?')[0]);
      const path = url.split('?')[0];
      if (path.endsWith('/media_publish')) return Response.json({ id: 'ig-post-1' });
      if (path.endsWith('/media')) return Response.json({ id: 'container-1' });
      if (path.endsWith('/container-1')) return Response.json({ status_code: 'FINISHED' });
      if (path.endsWith('/photos')) return Response.json({ post_id: 'fb-post-1' });
      return Response.json({ id: 'page-1', name: 'ZEVANORY', access_token: 'page-token-teste', instagram_business_account: { id: 'ig-1', username: 'zevanory' } });
    }
    if (url.startsWith('https://vendas.zevanory.api.br/')) {
      log.pages.push(url);
      return new Response(`<html><head><title>IA na Prática | ZEVANORY</title><meta name="description" content="${productDescription}"></head><body>Preço de tabela: R$ 197</body></html>`, { status: 200 });
    }
    return new Response('unexpected ' + url, { status: 599 });
  };
  return { log, fake };
}

function sign(purpose: string, extra: string[] = []) {
  const ts = String(Date.now()), nonce = randomUUID();
  const sig = createHmac('sha256', TEST_SECRET).update([purpose, ts, nonce, ...extra].join('\n')).digest('hex');
  return { 'x-commercial-timestamp': ts, 'x-commercial-nonce': nonce, 'x-commercial-signature': sig };
}

function baseEnv(core: Core, kv = kvMock()) {
  const env: Record<string, any> = {
    SUPABASE_URL: 'https://sb.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste', ZPC_REPLICATION_SECRET: 'replicacao-teste',
    META_SYSTEM_TOKEN: 'meta-token-teste', [TICK_SECRET_NAME]: TEST_SECRET, T2_CREATIVE_ASSETS: kv,
  };
  const binding = coreBinding(core);
  if (binding) env.CORE_WORKER = binding;
  return env;
}

const creative = (id: string, detail: string, extra: Record<string, unknown> = {}) => ({
  id, kind: 'creative', status: 'approved', publishedAt: null, imageUrl: 'https://controle.zevanory.api.br/api/commercial/creative/assets/' + id + '.jpg',
  title: 'Criativo · IA na Prática', detail, product: 'IA na Prática', evidence: ['catalogCaptionValidation:PASS', 'https://vendas.zevanory.api.br/ia-na-pratica'], ...extra,
});

async function tick(env: Record<string, any>, items: any[]) {
  const net = makeNet(items);
  const original = globalThis.fetch;
  globalThis.fetch = net.fake as typeof fetch;
  try {
    const r = await worker.fetch(new Request('https://controle.zevanory.api.br/api/commercial/publish/tick', { method: 'POST', headers: sign(CREATIVE_FACTORY_PURPOSE) }), env);
    return { status: r.status, body: await r.json() as any, log: net.log };
  } finally { globalThis.fetch = original; }
}

const creativeWrites = (log: { upserts: any[] }) => log.upserts.filter(u => u.p_bucket === 'zpc_commercial_creatives');
const alerts = (log: { upserts: any[] }) => log.upserts.filter(u => u.p_bucket === 'zpc_commercial_events' && /retida/.test(u.p_items?.[0]?.record?.title || ''));
const results: Record<string, string> = {};
const silence = console.warn; console.warn = () => {};
try {
  // 1. Fechada: item com preço fica na fila, nada vai à Meta, nenhum status muda, um alerta.
  for (const mode of ['closed', 'throw', 'http500', 'badjson', 'missing', 'string_true'] as Core[]) {
    resetSalesLockHoldMemo();
    const kv = kvMock();
    const env = baseEnv(mode, kv);
    const items = [
      creative('c-preco', PRICE_CAPTION),
      creative('c-comprar', 'Guia.\nhttps://vendas.zevanory.api.br/comprar/ZEV-IA-011'),
      creative('c-hotmart', 'Guia.\nhttps://pay.hotmart.com/X123'),
      creative('c-cta', 'Guia prático. Compre agora no link da bio.'),
      creative('c-link-campo', 'Guia prático.', { link: 'https://vendas.zevanory.api.br/comprar/ZEV-IA-011' }),
    ];
    const r = await tick(env, items);
    assert.equal(r.status, 200, mode);
    assert.equal(r.body.held, 5, mode + ': todos os itens comerciais retidos');
    assert.equal(r.body.salesHeld, 5, mode + ': trava comercial comprovada independente de P04');
    assert.equal(r.body.salesOpen, false, mode);
    assert.deepEqual(r.body.published, [], mode);
    assert.deepEqual(r.log.graph, [], mode + ': nenhuma chamada à Meta com vendas fechadas');
    assert.deepEqual(creativeWrites(r.log), [], mode + ': item não é marcado failed/published (continua na fila)');
    assert.equal(alerts(r.log).length, 1, mode + ': um alerta');
    assert.ok(kv.m.has(SALES_LOCK_HOLD_PREFIX + new Date().toISOString().slice(0, 10)), mode + ': marca do dia');
    // Mesmo dia, outro tick: continua retido, sem novo alerta.
    const again = await tick(env, items);
    assert.equal(again.body.held, 5); assert.deepEqual(again.log.graph, []); assert.equal(alerts(again.log).length, 0, mode + ': alerta 1x/dia');
    results['fechada:' + mode] = 'PASS';
  }
  // 1b. Marca do dia já no KV (outro isolado): não alerta de novo.
  {
    resetSalesLockHoldMemo();
    const kv = kvMock(); kv.m.set(SALES_LOCK_HOLD_PREFIX + new Date().toISOString().slice(0, 10), '{}');
    const r = await tick(baseEnv('closed', kv), [creative('c-preco', PRICE_CAPTION)]);
    assert.equal(r.body.held, 1); assert.equal(alerts(r.log).length, 0); results['fechada:kv-dedupe'] = 'PASS';
  }
  // 2. Fechada: mesmo conteúdo limpo é retido se P04 não está certificado.
  {
    resetSalesLockHoldMemo();
    const r = await tick(baseEnv('closed'), [creative('c-limpo', CLEAN_CAPTION)]);
    assert.equal(r.body.held, 1); assert.equal(r.body.salesHeld, 0); assert.equal(r.body.published.length, 0);
    assert.deepEqual(r.log.graph, []); assert.deepEqual(creativeWrites(r.log), []);
    assert.equal(r.body.reason, 'p04_uncertified');
    results['fechada:item-limpo-retido-sem-p04'] = 'PASS';
  }
  // 3. Aberta: certificado P04 ausente continua segurando também itens com preço.
  {
    resetSalesLockHoldMemo();
    const env = baseEnv('open');
    const r = await tick(env, [creative('c-preco', PRICE_CAPTION)]);
    assert.equal(r.body.salesOpen, true); assert.equal(r.body.held, 1); assert.equal(r.body.published.length, 0);
    assert.deepEqual(r.log.graph, []); assert.equal(r.body.reason, 'p04_uncertified');
    assert.equal(alerts(r.log).length, 0); assert.equal(env.CORE_WORKER.calls, 1);
    results['aberta:retido-sem-p04'] = 'PASS';
  }

  // 4. T2 legenda: rota real de upload do criativo composto.
  const jpeg = new Uint8Array(25_000); jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x04, 0x38], 0);
  const upload = async (core: Core, description?: string) => {
    resetSalesLockHoldMemo();
    const kv = kvMock();
    const net = makeNet([], description ? { productDescription: description } : {});
    const original = globalThis.fetch; globalThis.fetch = net.fake as typeof fetch;
    try {
      const hash = createHash('sha256').update(jpeg).digest('hex');
      const r = await worker.fetch(new Request('https://controle.zevanory.api.br/api/commercial/creative/upload?product=ia-na-pratica', { method: 'POST', headers: sign(CREATIVE_UPLOAD_PURPOSE, ['ia-na-pratica', hash]), body: jpeg }), baseEnv(core, kv));
      return { status: r.status, body: await r.json() as any, log: net.log };
    } finally { globalThis.fetch = original; }
  };
  for (const mode of ['closed', 'throw', 'missing'] as Core[]) {
    const r = await upload(mode);
    assert.equal(r.status, 200, mode + ' ' + JSON.stringify(r.body));
    assert.doesNotMatch(r.body.caption, /R\$/, mode + ': legenda sem preço com vendas fechadas');
    assert.deepEqual(salesLockViolations(r.body.caption), [], mode);
    const stored = r.log.upserts.find(u => u.p_bucket === 'zpc_commercial_creatives')?.p_items?.[0]?.record;
    assert.ok(stored && !/R\$/.test(stored.detail), mode + ': registro salvo sem preço');
    results['t2:fechada-sem-preco:' + mode] = 'PASS';
  }
  {
    const r = await upload('open');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.caption, /R\$ 197,00/, 'aberta: preço de tabela exigido e presente');
    results['t2:aberta-exige-preco'] = 'PASS';
  }
  {
    // Fechada + descrição do catálogo com preço: t2ValidateCaption PROÍBE (não publica a legenda).
    const r = await upload('closed', 'Guia digital por apenas R$ 197.');
    assert.equal(r.status, 500); assert.match(r.body.error, /^t2_caption_sales_closed_price/);
    assert.equal(r.log.upserts.length, 0, 'nada salvo');
    const ok = await upload('open', 'Guia digital por apenas R$ 197.');
    assert.equal(ok.status, 200, 'aberta: preço permitido');
    results['t2:fechada-proibe-preco'] = 'PASS';
  }

  // 4b. T2 fábrica (rota real /api/commercial/creative/factory/tick, Workers AI simulado).
  const factory = async (core: Core) => {
    const net = makeNet([]);
    const env = baseEnv(core);
    env.AI = { async run() { return { image: 'iVBOR' + 'A'.repeat(4003) }; } };
    const original = globalThis.fetch; globalThis.fetch = net.fake as typeof fetch;
    const silenceErr = console.error; console.error = () => {};
    try {
      await worker.fetch(new Request('https://controle.zevanory.api.br/api/commercial/creative/factory/tick?product=ia-na-pratica', { method: 'POST', headers: sign(CREATIVE_FACTORY_PURPOSE) }), env);
      return net.log.upserts.find(u => u.p_bucket === 'zpc_commercial_creatives' && u.p_items?.[0]?.record?.kind === 'creative')?.p_items?.[0]?.record;
    } finally { globalThis.fetch = original; console.error = silenceErr; }
  };
  for (const mode of ['closed', 'http500'] as Core[]) {
    const rec = await factory(mode);
    assert.ok(rec, mode + ': criativo gerado');
    assert.doesNotMatch(rec.detail, /R\$/, mode + ': fábrica sem preço com vendas fechadas');
    results['t2-fabrica:fechada-sem-preco:' + mode] = 'PASS';
  }
  {
    const rec = await factory('open');
    assert.ok(rec); assert.match(rec.detail, /R\$ 197,00/, 'fábrica aberta: preço de tabela');
    results['t2-fabrica:aberta-com-preco'] = 'PASS';
  }

  // 5. Unidade: leitura da trava e detector.
  assert.equal(await readCoreSalesOpen({ CORE_WORKER: coreBinding('open') }), true);
  for (const m of ['closed', 'throw', 'http500', 'badjson', 'missing', 'string_true'] as Core[]) assert.equal(await readCoreSalesOpen({ CORE_WORKER: coreBinding(m) }), false, m);
  assert.equal(await readCoreSalesOpen(undefined), false);
  assert.deepEqual(salesLockViolations('custa R$197'), ['price']);
  assert.deepEqual(salesLockViolations('https://vendas.zevanory.api.br/comprar?x=1'), ['checkout_link']);
  assert.deepEqual(salesLockViolations('go.hotmart.com/abc'), ['checkout_link']);
  assert.deepEqual(salesLockViolations('Garanta já o seu'), ['purchase_cta']);
  assert.deepEqual(salesLockViolations(CLEAN_CAPTION), []);
  results['unidade'] = 'PASS';
} finally { console.warn = silence; }
console.log(JSON.stringify({ sales_lock_publishers: 'PASS', cases: Object.keys(results).length, results }));
