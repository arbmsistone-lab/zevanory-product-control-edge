import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Bot, ChevronLeft, ChevronRight, CircleDollarSign, Compass, Gauge, RadioTower, ThumbsUp } from 'lucide-react';
import { api } from './api';
import type { CommercialRecord } from './commercial-model';

// ZEVANORY Revenue Command Center. Seven tabs answer the owner's seven questions.
// Every number shows its source, last update and integrity seal; nothing estimated is
// shown as real. No page scroll: cards paginate and lists fit what the space allows.

type Integrity = 'real' | 'aggregated' | 'webhook_authenticated' | 'stale' | 'missing';
type Metric = { value: number | null; source: string; updatedAt: string | null; definition: string; integrity: Integrity };
type SalesBucket = { approved: number; grossCents: number; netCents: number; reversed?: number };
type SalesSummary = {
  updatedAt: string | null;
  totals: Record<string, number>;
  byDay: Record<string, SalesBucket & { reversedGrossCents?: number }>;
  byProduct: Record<string, SalesBucket>;
  bySource: Record<string, SalesBucket>;
  recent: { ref: string; kind: string; product: string; grossCents: number; netCents: number; src: string; at: string }[];
};
type AgendaItem = { id: string; agent: string; task: string; next: string | null };
type Recommendation = { title: string; evidence: string; action: string; confidence: string; risk: string; cost: string };
type Snapshot = {
  generatedAt: string;
  day: string;
  goals: { id: string; label: string; target: number; unit: string; deadline: string | null; current: number }[];
  revenue: Record<string, any>;
  funnel: { visitors7: Metric; views7: Metric; leads7: Metric; views30: Metric; intents30: Metric; sales30: Metric; sources: Record<string, Record<string, number>>; pages: { page: string; views: number }[] };
  acquisition: {
    reachAt: string;
    channels: { channel: string; audience: Metric; views?: Metric; delta7?: number | null; viewsDelta7?: number | null; note?: string }[];
    youtubeRecent: { t: string; d: string; views: number; likes: number; privacy: string; url: string }[];
    history: { day: string; youtube_views: number | null; youtube_subs: number | null }[];
    publications: { expected: number; published: number; pct: number | null; perChannel: Record<string, { expected: number; published: number }> };
    today: { channel: string; status: string; url: string | null; at: string | null; code?: string | null }[];
  };
  autonomy: {
    runs: null | { scheduledRuns: number; succeeded: number; failed: number; recoveredAutomatically: number; unrecovered: number; manualRuns: number; autonomyPct: number | null; mttrMinutes: number | null; failuresList: { workflow: string; at: string; recovered: boolean }[] };
    agenda: AgendaItem[];
    ownerOnly: { what: string; why: string; status: string }[];
  };
  operations: { probes: { url: string; http: number; ms: number; ok: boolean }[]; salesSwitch: { open: boolean } | null; checkoutMode: string; deploys: { at: string; conclusion: string }[] };
  forecast: { status: 'ok' | 'insufficient'; reason?: string; salesExpected?: number; salesInterval80?: [number, number]; revenueExpectedCents?: number; revenueInterval80Cents?: [number, number]; basis?: string };
  recommendations: Recommendation[];
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number | null | undefined) => (cents == null ? '—' : BRL.format(cents / 100));
const num = (v: number | null | undefined) => (v == null ? '—' : new Intl.NumberFormat('pt-BR').format(v));
const when = (iso: string | null | undefined) => {
  if (!iso) return 'sem registro';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sem registro';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const SEAL: Record<Integrity, string> = { real: 'Real', aggregated: 'Consolidado por hora', webhook_authenticated: 'Hotmart autenticado', stale: 'Atrasado', missing: 'Sem dados' };
const CHANNEL: Record<string, string> = { youtube: 'YouTube · produto', youtube_dica: 'YouTube · dica', youtube_calc: 'YouTube · calculadora', telegram: 'Telegram', bluesky: 'Bluesky', blog: 'Blog', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
const KIND: Record<string, string> = { approved: 'Venda aprovada', refunded: 'Reembolso', chargeback: 'Chargeback', protest: 'Reclamação', canceled: 'Pagamento cancelado', expired: 'Pagamento expirado', abandoned: 'Carrinho abandonado', billet_printed: 'Boleto gerado', delayed: 'Pagamento atrasado', subscription_canceled: 'Assinatura cancelada' };

function localDay(t = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

// Live revenue from the ledger (a sale shows up before the next hourly rollup).
function liveRevenue(sales: SalesSummary | null) {
  if (!sales) return null;
  const day = localDay();
  const month = day.slice(0, 7);
  const m = Object.entries(sales.byDay || {}).filter(([d]) => d.startsWith(month)).reduce((a, [, b]) => ({ approved: a.approved + (b.approved || 0), grossCents: a.grossCents + (b.grossCents || 0), netCents: a.netCents + (b.netCents || 0) }), { approved: 0, grossCents: 0, netCents: 0 });
  const t = sales.totals || {};
  return {
    today: sales.byDay?.[day]?.approved || 0,
    month: m,
    approved: t.approved || 0,
    grossCents: t.grossCents || 0,
    netCents: t.netCents || 0,
    feesCents: t.feesCents || 0,
    refunds: (t.refunded || 0) + (t.chargeback || 0) + (t.protest || 0),
    refundedCents: t.reversedGrossCents || 0,
    ticketCents: t.approved ? Math.round((t.grossCents || 0) / t.approved) : null,
    abandoned: t.abandoned || 0,
    updatedAt: sales.updatedAt,
  };
}

function Seal({ integrity }: { integrity: Integrity }) {
  return <span className={'ccSeal ' + integrity}>{SEAL[integrity] || integrity}</span>;
}

function Tile({ label, value, source, at, integrity, definition }: { label: string; value: string; source: string; at: string | null; integrity: Integrity; definition: string }) {
  return (
    <article className='ccTile' title={definition}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span className='ccProv'>{source} · {when(at)}</span>
      <Seal integrity={integrity} />
    </article>
  );
}
const tileOf = (label: string, m: Metric | undefined, format: (v: number | null) => string = num) =>
  m ? <Tile label={label} value={format(m.value)} source={m.source} at={m.updatedAt} integrity={m.integrity} definition={m.definition} /> : <Tile label={label} value='—' source='Central de Comando' at={null} integrity='missing' definition={label} />;

// Shows only what fits: render everything, then drop one item per pass while the
// container overflows (rows can have different heights). Any size change starts over.
function useShrinkFit(total: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(Math.max(1, total));
  const [epoch, setEpoch] = useState(0);
  const resetPending = useRef(false);
  useLayoutEffect(() => { const all = Math.max(1, total); if (fit !== all) { resetPending.current = true; setFit(all); } }, [total, epoch]);
  useLayoutEffect(() => {
    if (resetPending.current) { resetPending.current = false; return; }
    const el = ref.current;
    if (el && fit > 1 && el.scrollHeight > el.clientHeight + 1) setFit(f => Math.max(1, f - 1));
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const observer = new ResizeObserver(() => {
      const size = el.clientWidth + 'x' + el.clientHeight;
      if (size !== last) { last = size; setEpoch(e => e + 1); }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, fit };
}

function Pager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (p: number) => void; label: string }) {
  if (pages <= 1) return null;
  return (
    <div className='ccPager' aria-label={label}>
      <button type='button' onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} aria-label='Página anterior'><ChevronLeft size={16} /></button>
      <span>{page + 1}/{pages}</span>
      <button type='button' onClick={() => onPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} aria-label='Próxima página'><ChevronRight size={16} /></button>
    </div>
  );
}

function FitCard({ title, subtitle, nodes, variant, empty }: { title: string; subtitle: ReactNode; nodes: ReactNode[]; variant: 'list' | 'tiles'; empty?: string }) {
  const { ref, fit } = useShrinkFit(nodes.length);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(nodes.length / fit));
  const safe = Math.min(page, pages - 1);
  const shown = nodes.slice(safe * fit, safe * fit + fit);
  return (
    <section className='ccCard'>
      <header className='ccCardHead'>
        <div><h3>{title}</h3><p>{subtitle}</p></div>
        <Pager page={safe} pages={pages} onPage={setPage} label={'Páginas de ' + title} />
      </header>
      <div className={variant === 'list' ? 'ccList' : 'ccTiles'} ref={ref}>
        {nodes.length ? shown : <div className='ccRow ccEmpty'><span>{empty || 'Sem dados.'}</span></div>}
      </div>
    </section>
  );
}

function ListCard<T>({ title, subtitle, items, render, empty, keyOf }: { title: string; subtitle: ReactNode; items: T[]; render: (item: T) => ReactNode; empty: string; keyOf: (item: T, i: number) => string }) {
  return <FitCard title={title} subtitle={subtitle} variant='list' empty={empty} nodes={items.map((item, i) => <div className='ccRow' key={keyOf(item, i)}>{render(item)}</div>)} />;
}

function TileCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const nodes = (Array.isArray(children) ? children : [children]).filter(Boolean).map((child, i) => <div className='ccTileSlot' key={i}>{child}</div>);
  return <FitCard title={title} subtitle={subtitle} variant='tiles' nodes={nodes} />;
}

const TABS = [
  { id: 'now', label: 'Agora', icon: Activity, question: 'O que está acontecendo' },
  { id: 'ai', label: 'IA', icon: Bot, question: 'O que a IA está fazendo e por quê' },
  { id: 'perf', label: 'Desempenho', icon: Gauge, question: 'Como a empresa está performando' },
  { id: 'works', label: 'Funciona?', icon: ThumbsUp, question: 'O que está funcionando e o que não está' },
  { id: 'ops', label: 'Operação', icon: RadioTower, question: 'Situação operacional' },
  { id: 'money', label: 'Financeiro', icon: CircleDollarSign, question: 'Situação financeira' },
  { id: 'path', label: 'Rumo', icon: Compass, question: 'Para onde estamos caminhando' },
] as const;
type TabId = typeof TABS[number]['id'];

export default function CommandCenter({ sessionToken, events, onOpen }: { sessionToken: string; events: CommercialRecord[]; onOpen: (view: 'operations' | 'finance' | 'support' | 'channels') => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [servedAt, setServedAt] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<TabId>('now');
  const [cardPage, setCardPage] = useState(0);
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth <= 900);

  const load = useCallback(() => {
    if (!sessionToken) return;
    api.post<{ ok: boolean; snapshot: Snapshot | null; sales: SalesSummary | null; servedAt: string }>('/api/owner/command-center', { sessionToken })
      .then(({ data }) => { setSnapshot(data?.snapshot || null); setSales(data?.sales || null); setServedAt(data?.servedAt || null); setState('ready'); })
      .catch(() => setState(prev => (prev === 'ready' ? prev : 'error')));
  }, [sessionToken]);
  useEffect(() => { load(); const id = window.setInterval(load, 60000); return () => window.clearInterval(id); }, [load]);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => { setCardPage(0); }, [tab, narrow]);

  const live = useMemo(() => liveRevenue(sales), [sales]);
  const s = snapshot;
  const salesAt = live?.updatedAt || s?.revenue?.salesToday?.updatedAt || null;
  const hot = (label: string, value: string, definition: string) => <Tile label={label} value={value} source='Hotmart' at={salesAt} integrity={sales ? 'webhook_authenticated' : 'missing'} definition={definition} />;

  const timeline = useMemo(() => {
    const rows: { at: string; what: string; detail: string; tone: string; url?: string | null }[] = [];
    for (const p of s?.acquisition.today || []) rows.push({ at: p.at || s?.generatedAt || '', what: (CHANNEL[p.channel] || p.channel) + ' · ' + (p.status === 'publicado' ? 'publicado' : p.status), detail: p.status === 'publicado' ? 'Publicação confirmada pelo provedor' : (p.code || 'aguardando'), tone: p.status === 'publicado' ? 'ok' : 'warn', url: p.url });
    for (const r of sales?.recent || []) rows.push({ at: r.at, what: (KIND[r.kind] || r.kind) + ' · ' + r.product, detail: money(r.grossCents) + ' · origem ' + r.src, tone: r.kind === 'approved' ? 'ok' : 'warn' });
    for (const e of events.slice(0, 40)) rows.push({ at: e.updatedAt || e.createdAt, what: e.title, detail: [e.channel, e.status].filter(Boolean).join(' · '), tone: 'info' });
    return rows.filter(r => r.at).sort((a, b) => b.at.localeCompare(a.at));
  }, [s, sales, events]);

  const cards: Record<TabId, ReactNode[]> = !s ? { now: [], ai: [], perf: [], works: [], ops: [], money: [], path: [] } : {
    now: [
      <TileCard key='today' title='Hoje' subtitle={'Atualizado ' + when(servedAt)}>
        {hot('Vendas hoje', num(live?.today ?? 0), 'Compras aprovadas hoje (Brasília)')}
        {hot('Receita no mês', money(live?.month.grossCents ?? 0), 'Valor pago pelos clientes no mês, antes de taxas')}
        {tileOf('Pessoas reais (7 dias)', s.funnel.visitors7)}
        {tileOf('Leads (7 dias)', s.funnel.leads7)}
        {tileOf('Intenção de compra (30d)', s.funnel.intents30)}
        <Tile label='Autonomia (7 dias)' value={s.autonomy.runs?.autonomyPct == null ? '—' : s.autonomy.runs.autonomyPct + '%'} source='Execuções' at={s.generatedAt} integrity={s.autonomy.runs ? 'real' : 'missing'} definition='Execuções concluídas sem intervenção humana' />
        <Tile label='Serviços no ar' value={`${s.operations.probes.filter(p => p.ok).length}/${s.operations.probes.length}`} source='Verificação HTTP' at={s.generatedAt} integrity='real' definition='Site, vendas e painel respondendo' />
        <Tile label='Publicações hoje' value={`${s.acquisition.today.filter(p => p.status === 'publicado').length}/${s.acquisition.today.length || 6}`} source='Provedores' at={s.generatedAt} integrity='real' definition='Publicações confirmadas pelo provedor hoje / previstas' />
      </TileCard>,
      <ListCard key='feed' title='Linha do tempo' subtitle='Publicações, vendas e eventos, do mais recente' items={timeline} keyOf={(r, i) => r.at + i} empty='Nenhuma atividade registrada ainda.' render={r => (
        <><i className={'ccDot ' + r.tone} /><div><b>{r.what}</b><span>{r.detail}{r.url ? <> · <a href={r.url} target='_blank' rel='noreferrer'>abrir</a></> : null}</span></div><time>{when(r.at)}</time></>
      )} />,
    ],
    ai: [
      <TileCard key='auto' title='Autonomia medida (7 dias)' subtitle={s.autonomy.runs ? 'Execuções reais dos motores · GitHub Actions' : 'Sem leitura das execuções'}>
        <Tile label='Sem intervenção humana' value={s.autonomy.runs?.autonomyPct == null ? '—' : s.autonomy.runs.autonomyPct + '%'} source='Execuções' at={s.generatedAt} integrity={s.autonomy.runs ? 'real' : 'missing'} definition='(execuções agendadas com sucesso + recuperadas sozinhas) ÷ (agendadas + manuais)' />
        <Tile label='Execuções agendadas' value={num(s.autonomy.runs?.scheduledRuns ?? null)} source='Execuções' at={s.generatedAt} integrity={s.autonomy.runs ? 'real' : 'missing'} definition='Rodadas automáticas dos motores em 7 dias' />
        <Tile label='Falhas · recuperadas sozinhas' value={s.autonomy.runs ? `${s.autonomy.runs.failed} · ${s.autonomy.runs.recoveredAutomatically}` : '—'} source='Execuções' at={s.generatedAt} integrity={s.autonomy.runs ? 'real' : 'missing'} definition='Falhas e quantas foram resolvidas por uma execução automática seguinte' />
        <Tile label='Tempo médio de recuperação' value={s.autonomy.runs?.mttrMinutes == null ? '—' : s.autonomy.runs.mttrMinutes + ' min'} source='Execuções' at={s.generatedAt} integrity={s.autonomy.runs?.mttrMinutes == null ? 'missing' : 'real'} definition='Média entre a falha e a próxima execução bem-sucedida' />
        <Tile label='Intervenções manuais' value={num(s.autonomy.runs?.manualRuns ?? null)} source='Execuções' at={s.generatedAt} integrity={s.autonomy.runs ? 'real' : 'missing'} definition='Execuções disparadas à mão (dono ou orquestrador)' />
        <Tile label='Publicações confirmadas' value={s.acquisition.publications.pct == null ? '—' : s.acquisition.publications.pct + '%'} source='Provedores' at={s.generatedAt} integrity={s.acquisition.publications.pct == null ? 'missing' : 'real'} definition={`${s.acquisition.publications.published} de ${s.acquisition.publications.expected} publicações previstas em 7 dias`} />
      </TileCard>,
      <ListCard key='next' title='Próximas ações' subtitle='Qual motor, o quê e quando (Brasília)' items={s.autonomy.agenda} keyOf={a => a.id} empty='Agenda indisponível.' render={a => (
        <><i className='ccDot info' /><div><b>{a.task}</b><span>{a.agent}</span></div><time>{when(a.next)}</time></>
      )} />,
      <ListCard key='fails' title='Falhas e recuperação' subtitle='O que falhou e se a autocorreção resolveu' items={s.autonomy.runs?.failuresList || []} keyOf={(f, i) => f.at + i} empty='Nenhuma falha nas execuções agendadas em 7 dias.' render={f => (
        <><i className={'ccDot ' + (f.recovered ? 'ok' : 'bad')} /><div><b>{f.workflow}</b><span>{f.recovered ? 'Recuperada automaticamente' : 'Ainda sem recuperação'}</span></div><time>{when(f.at)}</time></>
      )} />,
    ],
    perf: [
      <TileCard key='funnel' title='Funil' subtitle='Visitas e intenção: site · vendas: Hotmart'>
        {tileOf('Visitas com origem (30d)', s.funnel.views30)}
        {tileOf('Intenção de compra (30d)', s.funnel.intents30)}
        {tileOf('Leads (7d)', s.funnel.leads7)}
        {hot('Vendas (30d)', num(s.funnel.sales30?.value ?? 0), 'Compras aprovadas em 30 dias')}
        <Tile label='Conversão visita → venda' value={s.funnel.views30.value ? ((100 * (s.funnel.sales30?.value || 0)) / s.funnel.views30.value).toFixed(2) + '%' : '—'} source='Site + Hotmart' at={s.generatedAt} integrity={s.funnel.views30.value ? 'aggregated' : 'missing'} definition='Vendas ÷ visitas com origem, 30 dias' />
      </TileCard>,
      <ListCard key='reach' title='Alcance por canal' subtitle={'Medido ' + when(s.acquisition.reachAt) + ' · variação em 7 dias'} items={s.acquisition.channels} keyOf={c => c.channel} empty='Sem leitura de alcance.' render={c => (
        <><i className={'ccDot ' + (c.audience.value == null ? 'idle' : 'ok')} /><div><b>{c.channel}</b><span>{c.audience.value == null ? (c.note || c.audience.source) : `${num(c.audience.value)} ${c.audience.definition.toLowerCase()}${c.views?.value != null ? ' · ' + num(c.views.value) + ' visualizações' : ''}`}</span></div><time>{c.delta7 == null ? '—' : (c.delta7 >= 0 ? '+' : '') + c.delta7 + ' 7d'}</time></>
      )} />,
      <ListCard key='src' title='De onde vêm as visitas' subtitle='30 dias · visitas e intenção por origem' items={Object.entries(s.funnel.sources).sort((a, b) => (b[1].views || 0) - (a[1].views || 0))} keyOf={([k]) => k} empty='Nenhuma visita com origem ainda.' render={([k, v]) => (
        <><i className='ccDot info' /><div><b>{k}</b><span>{num(v.views || 0)} visitas · {num((v.checkout_intent || 0) + (v.hotmart_view || 0) + (v.subscribe_click || 0))} intenções</span></div><time>{(v.views || 0) ? (((v.checkout_intent || 0) + (v.hotmart_view || 0)) * 100 / (v.views || 1)).toFixed(1) + '%' : '—'}</time></>
      )} />,
    ],
    works: [
      <ListCard key='rec' title='Oportunidades e gargalos' subtitle='Cada recomendação com evidência, confiança, risco e custo' items={s.recommendations} keyOf={r => r.title} empty='Sem dados suficientes para recomendar.' render={r => (
        <><i className='ccDot info' /><div><b>{r.title}</b><span>{r.evidence} → {r.action}</span></div><time>conf. {r.confidence}</time></>
      )} />,
      <ListCard key='best' title='Conteúdos com melhor desempenho' subtitle='YouTube · visualizações reais por vídeo' items={[...s.acquisition.youtubeRecent].sort((a, b) => b.views - a.views)} keyOf={v => v.url} empty='Sem vídeos medidos ainda.' render={v => (
        <><i className={'ccDot ' + (v.views > 0 ? 'ok' : 'idle')} /><div><b>{v.t}</b><span>{num(v.views)} visualizações · {num(v.likes)} curtidas · <a href={v.url} target='_blank' rel='noreferrer'>abrir</a></span></div><time>{when(v.d)}</time></>
      )} />,
      <ListCard key='pubch' title='Entrega por canal (7 dias)' subtitle='Publicações confirmadas ÷ previstas' items={Object.entries(s.acquisition.publications.perChannel)} keyOf={([k]) => k} empty='Sem registros de publicação.' render={([k, v]) => (
        <><i className={'ccDot ' + (v.published === v.expected ? 'ok' : 'warn')} /><div><b>{CHANNEL[k] || k}</b><span>{v.published} de {v.expected} confirmadas</span></div><time>{v.expected ? Math.round(100 * v.published / v.expected) + '%' : '—'}</time></>
      )} />,
    ],
    ops: [
      <ListCard key='svc' title='Serviços no ar' subtitle={'Verificado ' + when(s.generatedAt)} items={s.operations.probes} keyOf={p => p.url} empty='Sem verificação.' render={p => (
        <><i className={'ccDot ' + (p.ok ? 'ok' : 'bad')} /><div><b>{p.url.replace('https://', '')}</b><span>{p.ok ? 'Respondendo' : 'Falha'} · HTTP {p.http || '—'}</span></div><time>{p.ms} ms</time></>
      )} />,
      <ListCard key='int' title='Integrações e bloqueios' subtitle='Canais, pagamentos e o que depende de terceiros' items={[
        ...s.acquisition.channels.map(c => ({ k: c.channel, ok: c.audience.value != null, d: c.audience.value != null ? 'Conectado · leitura ' + c.audience.source : (c.note || c.audience.source) })),
        { k: 'Vendas', ok: true, d: s.operations.checkoutMode },
      ]} keyOf={x => x.k} empty='—' render={x => (
        <><i className={'ccDot ' + (x.ok ? 'ok' : 'warn')} /><div><b>{x.k}</b><span>{x.d}</span></div><time>{x.ok ? 'ativo' : 'aguardando'}</time></>
      )} />,
      <ListCard key='dep' title='Implantações' subtitle='Últimas publicações do sistema em produção' items={s.operations.deploys} keyOf={(d, i) => d.at + i} empty='Nenhuma implantação nos últimos 7 dias.' render={d => (
        <><i className={'ccDot ' + (d.conclusion === 'success' ? 'ok' : 'bad')} /><div><b>Implantação central</b><span>{d.conclusion === 'success' ? 'Concluída' : d.conclusion || 'em andamento'}</span></div><time>{when(d.at)}</time></>
      )} />,
    ],
    money: [
      <TileCard key='fin' title='Resultado' subtitle='Fonte: postback autenticado da Hotmart · ainda não reconciliado pela API'>
        {hot('Receita bruta no mês', money(live?.month.grossCents ?? 0), 'Valor pago pelos clientes no mês, antes de taxas')}
        {hot('Receita líquida no mês', money(live?.month.netCents ?? 0), 'Comissão do produtor no mês')}
        {hot('Vendas no mês', num(live?.month.approved ?? 0), 'Compras aprovadas no mês')}
        {hot('Ticket médio', live?.ticketCents == null ? '—' : money(live.ticketCents), 'Receita bruta ÷ vendas aprovadas')}
        {hot('Taxas da plataforma', money(live?.feesCents ?? 0), 'Bruto − líquido − afiliados, acumulado')}
        {hot('Reembolsos', `${num(live?.refunds ?? 0)} · ${money(live?.refundedCents ?? 0)}`, 'Reembolsos, chargebacks e reclamações')}
      </TileCard>,
      <ListCard key='prod' title='Por produto' subtitle='Vendas e receita acumuladas' items={Object.entries(sales?.byProduct || {}).sort((a, b) => b[1].grossCents - a[1].grossCents)} keyOf={([k]) => k} empty='Nenhuma venda registrada ainda.' render={([k, v]) => (
        <><i className='ccDot ok' /><div><b>{k}</b><span>{v.approved} venda(s) · líquido {money(v.netCents)}</span></div><time>{money(v.grossCents)}</time></>
      )} />,
      <ListCard key='orig' title='Por origem da venda' subtitle='Canal que trouxe cada comprador' items={Object.entries(sales?.bySource || {}).sort((a, b) => b[1].grossCents - a[1].grossCents)} keyOf={([k]) => k} empty='Nenhuma venda registrada ainda.' render={([k, v]) => (
        <><i className='ccDot ok' /><div><b>{k}</b><span>{v.approved} venda(s)</span></div><time>{money(v.grossCents)}</time></>
      )} />,
    ],
    path: [
      <ListCard key='goals' title='Metas' subtitle='Progresso real contra prazo' items={s.goals} keyOf={g => g.id} empty='—' render={g => {
        const current = g.id === 'fortnight' ? (live?.month.grossCents ?? g.current) : g.id === 'month' ? (live?.grossCents ?? g.current) : (live?.approved ?? g.current);
        const pct = Math.min(100, Math.round((100 * current) / Math.max(1, g.target)));
        return <><i className={'ccDot ' + (pct >= 100 ? 'ok' : 'warn')} /><div><b>{g.label}{g.deadline ? ' · até ' + g.deadline.split('-').reverse().slice(0, 2).join('/') : ''}</b><span className='ccBar'><i style={{ width: pct + '%' }} /></span></div><time>{g.unit === 'centavos' ? money(current) + ' / ' + money(g.target) : current + ' / ' + g.target}</time></>;
      }} />,
      <TileCard key='fc' title='Projeção 30 dias' subtitle={s.forecast.status === 'ok' ? 'Intervalo de 80% · base: ' + s.forecast.basis : 'Sem base suficiente: não há chute'}>
        <Tile label='Vendas esperadas' value={s.forecast.status === 'ok' ? `${s.forecast.salesExpected} (${s.forecast.salesInterval80?.[0]}–${s.forecast.salesInterval80?.[1]})` : 'Dados insuficientes'} source='Modelo de taxa (Poisson)' at={s.generatedAt} integrity={s.forecast.status === 'ok' ? 'aggregated' : 'missing'} definition={s.forecast.reason || 'Taxa diária de vendas × 30 dias, com intervalo de 80%'} />
        <Tile label='Receita esperada' value={s.forecast.status === 'ok' ? `${money(s.forecast.revenueExpectedCents)} (${money(s.forecast.revenueInterval80Cents?.[0])}–${money(s.forecast.revenueInterval80Cents?.[1])})` : 'Dados insuficientes'} source='Modelo de taxa (Poisson)' at={s.generatedAt} integrity={s.forecast.status === 'ok' ? 'aggregated' : 'missing'} definition={s.forecast.reason || 'Vendas esperadas × ticket médio'} />
      </TileCard>,
      <ListCard key='owner' title='O que exige você' subtitle='Só atos do dono · o resto a ZEVANORY decide sozinha' items={s.autonomy.ownerOnly} keyOf={o => o.what} empty='Nada exige você agora.' render={o => (
        <><i className={'ccDot ' + (o.status.startsWith('pronto') ? 'bad' : 'idle')} /><div><b>{o.what}</b><span>{o.why}</span></div><time>{o.status}</time></>
      )} />,
    ],
  };

  const tabCards = cards[tab];
  const perPage = narrow ? 1 : tabCards.length;
  const cardPages = Math.max(1, Math.ceil(tabCards.length / perPage));
  const safeCardPage = Math.min(cardPage, cardPages - 1);
  const visible = tabCards.slice(safeCardPage * perPage, safeCardPage * perPage + perPage);
  const current = TABS.find(t => t.id === tab)!;
  const freshness = s ? (Date.now() - Date.parse(s.generatedAt) < 2 * 3600e3 ? 'ok' : 'stale') : 'missing';

  return (
    <section className='ccRoot' aria-label='Central de Comando de Receita'>
      <header className='ccHead'>
        <div>
          <p className='ccEyebrow'>CENTRAL DE COMANDO</p>
          <h2>{current.question}</h2>
        </div>
        <button type='button' className={'ccFresh ' + freshness} onClick={() => onOpen('operations')} aria-label='Abrir saúde do sistema'>
          <i />
          <span><b>{s ? 'Consolidado ' + when(s.generatedAt) : state === 'loading' ? 'Carregando' : 'Sem consolidado'}</b><small>{sales ? 'Vendas ao vivo ' + when(sales.updatedAt) : 'Vendas: sem registro ainda'}</small></span>
        </button>
      </header>
      <nav className='ccTabs' aria-label='Perguntas da Central de Comando'>
        {TABS.map(t => <button key={t.id} type='button' className={t.id === tab ? 'active' : ''} aria-pressed={t.id === tab} onClick={() => setTab(t.id)}><t.icon size={16} />{t.label}</button>)}
        {narrow ? <Pager page={safeCardPage} pages={cardPages} onPage={setCardPage} label='Quadros desta pergunta' /> : null}
      </nav>
      {!s ? (
        <div className='ccBody' data-cards={1}>
          <section className='ccCard'>
            <header className='ccCardHead'><div><h3>{state === 'error' ? 'Central indisponível' : 'Preparando a Central de Comando'}</h3><p>{state === 'error' ? 'A leitura falhou; nova tentativa automática em 1 minuto.' : 'O consolidado é gerado a cada hora com dados reais dos provedores.'}</p></div></header>
          </section>
        </div>
      ) : (
        <div className='ccBody' data-cards={visible.length}>{visible}</div>
      )}
    </section>
  );
}
