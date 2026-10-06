import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, BadgeDollarSign, Bot, Check, CircleDollarSign, FileCheck2, Headphones,
  Megaphone, MessageSquareText, Search, Send, ShieldCheck, Sparkles, X, RotateCcw,
} from 'lucide-react';
import { api } from './api';
import { assessMarketSignal } from './prospect-signal';
import {
  commercialStatusLabel,
  type CommercialRecord,
  type CommercialSection,
  type CommercialWorkspaceData,
} from './commercial-model';

type Props = {
  section: CommercialSection;
  data: CommercialWorkspaceData | null;
  sessionToken: string;
  onRefresh: () => Promise<void> | void;
};

const SECTION_META: Record<CommercialSection, { title: string; subtitle: string }> = {
  commercial: { title: 'Central Comercial', subtitle: 'Execução, funil, produção e receita em uma única leitura operacional.' },
  creatives: { title: 'Estúdio de Criativos', subtitle: 'Briefs, peças, testes e versões com rastreabilidade de origem.' },
  approvals: { title: 'Fila de Aprovações', subtitle: 'Nada é publicado por automação sem passar pelo estado de aprovação aplicável.' },
  publications: { title: 'Publicações', subtitle: 'Fila multicanal, agendamentos, publicação e readback comprovado.' },
  prospecting: { title: 'Sinais de mercado', subtitle: 'Só demanda real do público ZEVANORY. Ruído da web é descartado; ninguém recebe contato frio.' },
  crm: { title: 'CRM / Vendas', subtitle: 'Lead → qualificação → contato → oportunidade → proposta → ganho.' },
  support: { title: 'Atendimento', subtitle: 'Demandas, respostas, pendências e resolução por canal.' },
  finance: { title: 'Financeiro', subtitle: 'Recebimentos e vendas confirmadas; valores não confirmados não entram na receita.' },
  evidence: { title: 'Evidências', subtitle: 'Trilha verificável de decisões, automações, publicações e eventos comerciais.' },
};

function brl(cents: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
}

function time(value: string | null | undefined) {
  if (!value) return 'sem horário';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

function statusClass(status: string) {
  const key = status.toLowerCase();
  if (['approved','published','won','paid','received','confirmed','resolved'].includes(key)) return 'ok';
  if (['rejected','failed','lost','blocked'].includes(key)) return 'bad';
  if (['approval','pending-approval','awaiting-approval','testing','scheduled','proposal','qualified'].includes(key)) return 'warn';
  return 'neutral';
}

function RecordRow({ item }: { item: CommercialRecord }) {
  return (
    <article className='commercialRow'>
      <div className='commercialRowMain'>
        <div className='commercialTitleLine'>
          <strong>{item.title}</strong>
          <span className={'commercialState ' + statusClass(item.status)}>{commercialStatusLabel(item.status)}</span>
        </div>
        <p>{item.detail || 'Sem detalhe adicional.'}</p>
        <div className='commercialMeta'>
          {item.product && <span>Produto: {item.product}</span>}
          {item.channel && <span>Canal: {item.channel}</span>}
          <span>Fonte: {item.source}</span>
          <span>{time(item.updatedAt)}</span>
        </div>
      </div>
      {item.valueCents !== null && <b className='commercialValue'>{brl(item.valueCents)}</b>}
    </article>
  );
}

export default function CommercialWorkspace({ section, data, sessionToken, onRefresh }: Props) {
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [liveState, setLiveState] = useState<'LIVE'|'SYNCING'|'STALE'>('SYNCING');
  const [lastSyncAt, setLastSyncAt] = useState<number>(Date.now());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const [dashboardPage, setDashboardPage] = useState(0);
  const [listPage, setListPage] = useState(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const meta = SECTION_META[section];
  const pagedDashboard = viewportWidth <= 1180 || viewportHeight <= 780;

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setDashboardPage(0);
    setListPage(0);
  }, [section]);

  useEffect(() => {
    let active = true;
    let source: EventSource | null = null;
    let fallback: number | null = null;
    let reconnect: number | null = null;
    const sync = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        await refreshRef.current();
        if (active) { setLastSyncAt(Date.now()); setLiveState('LIVE'); }
      } catch { if (active) setLiveState('STALE'); }
    };
    const connect = () => {
      if (!active || document.visibilityState === 'hidden') return;
      setLiveState('SYNCING');
      source = new EventSource((window.location.pathname === '/control' || window.location.pathname.startsWith('/control/')) ? '/control/api/commercial/stream' : '/api/commercial/stream');
      source.addEventListener('commercial-update', () => { void sync(); });
      source.onopen = () => { if (active) { setLastSyncAt(Date.now()); setLiveState('LIVE'); } };
      source.onerror = () => {
        source?.close();
        source = null;
        if (active) {
          setLiveState('STALE');
          if (fallback === null) fallback = window.setInterval(() => { void sync(); }, 30000);
          reconnect = window.setTimeout(connect, 5000);
        }
      };
    };
    void sync();
    connect();
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !source) connect();
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      source?.close();
      if (fallback !== null) window.clearInterval(fallback);
      if (reconnect !== null) window.clearTimeout(reconnect);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [section]);

  const approvalItems = useMemo(() => {
    if (!data) return [];
    return [...data.creatives, ...data.publications]
      .filter(item => ['approval','pending-approval','awaiting-approval'].includes(item.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [data]);

  const act = async (item: CommercialRecord, action: 'approve'|'reject'|'request-changes') => {
    setBusyId(item.id + action);
    setActionError('');
    try {
      await api.post('/api/commercial/approval', {
        sessionToken,
        id: item.id,
        kind: item.kind,
        action,
      });
      await onRefresh();
    } catch (err: any) {
      setActionError(String(err?.response?.data?.error || 'A ação não foi concluída; o item permaneceu inalterado.'));
    } finally {
      setBusyId('');
    }
  };

  const promoteDiscovery = async (item: CommercialRecord) => {
    setBusyId(item.id + 'promote');
    setActionError('');
    try {
      await api.post('/api/commercial/sales/promote-discovery', { sessionToken, discoveryId: item.id });
      await onRefresh();
    } catch (err: any) {
      setActionError(String(err?.response?.data?.error || 'A descoberta não pôde ser promovida.'));
    } finally { setBusyId(''); }
  };

  const qualifyLead = async (item: CommercialRecord) => {
    const scoreRaw = window.prompt('Score de qualificação (0–100)', '70');
    if (scoreRaw === null) return;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setActionError('Score inválido. Use um número entre 0 e 100.');
      return;
    }
    const signalsRaw = window.prompt('Evidências/sinais, separados por ponto e vírgula', item.detail || item.title);
    if (signalsRaw === null) return;
    const signals = signalsRaw.split(';').map(value => value.trim()).filter(Boolean);
    if (!signals.length) {
      setActionError('A qualificação exige pelo menos uma evidência.');
      return;
    }
    setBusyId(item.id + 'qualify');
    setActionError('');
    try {
      await api.post('/api/commercial/sales/qualify', {
        sessionToken, leadId: item.id, score, signals,
        reason: 'Qualificação aprovada no Control Center',
      });
      await onRefresh();
    } catch (err: any) {
      setActionError(String(err?.response?.data?.error || 'O lead não pôde ser qualificado.'));
    } finally { setBusyId(''); }
  };

  const executeSalesAction = async (
    item: CommercialRecord,
    action: 'contact' | 'offer' | 'follow-up' | 'checkout',
  ) => {
    const labels = { contact: 'mensagem de contato', offer: 'oferta', 'follow-up': 'mensagem de follow-up', checkout: 'mensagem com checkout' };
    const content = window.prompt('Conteúdo da ' + labels[action], '');
    if (content === null) return;
    if (!content.trim()) {
      setActionError('A execução exige conteúdo explícito.');
      return;
    }
    setBusyId(item.id + action);
    setActionError('');
    try {
      const response = await api.post('/api/commercial/sales/execute', {
        sessionToken, leadId: item.id, action, content, humanApproval: true,
      });
      const result = response.data;
      if (!result?.executed) {
        setActionError('Ação mantida bloqueada pelo gate: ' + String(result?.executionReason || result?.decision?.reason || 'não autorizada'));
      }
      await onRefresh();
    } catch (err: any) {
      setActionError(String(err?.response?.data?.error || 'A execução comercial não foi concluída.'));
    } finally { setBusyId(''); }
  };

  if (!data) {
    return <section className='commercialPanel'><div className='commercialEmpty'>Workspace comercial indisponível. Nenhuma métrica foi presumida.</div></section>;
  }

  const rawDiscoveries = data.evidence.filter(item => item.status === 'raw-discovery');
  const usefulSignals = rawDiscoveries.filter(item => assessMarketSignal({
    title: item.title,
    detail: item.detail,
    url: item.evidence.find(entry => /^https?:\/\//i.test(entry)) || '',
  }).useful);
  const discardedSignals = rawDiscoveries.length - usefulSignals.length;
  const genericMap: Partial<Record<CommercialSection, CommercialRecord[]>> = {
    creatives: data.creatives,
    publications: data.publications,
    prospecting: usefulSignals,
    crm: data.leads,
    support: data.support,
    finance: data.finance,
    evidence: [...data.evidence, ...data.events],
  };
  let items = genericMap[section] || [];
  if (section === 'crm') items = data.leads.filter(item => ['new','nurture','qualified','contact-ready','contacted','conversation','offer','follow-up','checkout','payment','customer','fulfillment','won','lost'].includes(item.status)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const genericPageSize = viewportWidth <= 620 ? 1 : viewportWidth <= 700 ? 2 : viewportHeight <= 780 ? 3 : 4;
  const genericPageCount = Math.max(1, Math.ceil(items.length / genericPageSize));
  const safeListPage = Math.min(listPage, genericPageCount - 1);
  const pagedItems = items.slice(safeListPage * genericPageSize, (safeListPage + 1) * genericPageSize);
  const creativePageSize = viewportWidth <= 700 ? 1 : 2;
  // Studio shows real pieces only: archived history and briefs without art stay out of the grid.
  const studioCreatives = data.creatives.filter(item => item.status !== 'archived' && Boolean(item.imageUrl || item.imageDataUrl || item.evidence.some(e => /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?|$)/i.test(e))));
  const hiddenCreatives = data.creatives.length - studioCreatives.length;
  const creativePageCount = Math.max(1, Math.ceil(studioCreatives.length / creativePageSize));
  const safeCreativePage = Math.min(listPage, creativePageCount - 1);
  const pagedCreatives = studioCreatives.slice(safeCreativePage * creativePageSize, (safeCreativePage + 1) * creativePageSize);

  return (
    <section className='commercialWorkspace'>
      <header className='commercialHeader'>
        <div>
          <p className='kicker'>GROWTH / REVENUE OPERATIONS</p>
          <h2>{meta.title}</h2>
          <p>{meta.subtitle}</p>
          <div className={'liveTelemetry ' + liveState.toLowerCase()} aria-live='polite'>
            <span className='liveDot' /><b>{liveState}</b><small>sincronização operacional · {Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000))}s</small>
          </div>
        </div>
        <div className={'robotBadge ' + data.robot.state.toLowerCase()}>
          <Bot size={18} />
          <div><b>{data.robot.label}</b><small>{data.robot.reason}</small></div>
        </div>
      </header>

      {section === 'commercial' && (
        <>
          {pagedDashboard && (
            <nav className='commercialPager' aria-label='Páginas da Central Comercial'>
              {['KPIs','Atividade','Pipeline','Provas'].map((label,index) => (
                <button key={label} className={dashboardPage === index ? 'filter active' : 'filter'} aria-pressed={dashboardPage === index} onClick={() => setDashboardPage(index)}>{label}</button>
              ))}
            </nav>
          )}
          {(!pagedDashboard || dashboardPage === 0) && <div className='commercialMetrics'>
            <article><Search/><span>Leads encontrados hoje</span><strong>{data.metrics.leadsToday}</strong></article>
            <article><MessageSquareText/><span>Contatos hoje</span><strong>{data.metrics.contactsToday}</strong></article>
            <article><Sparkles/><span>Criativos em produção</span><strong>{data.metrics.creativesInProduction}</strong></article>
            <article><FileCheck2/><span>Aguardando aprovação</span><strong>{data.metrics.pendingApproval}</strong></article>
            <article><Send/><span>Publicados hoje</span><strong>{data.metrics.publishedToday}</strong></article>
            <article><CircleDollarSign/><span>Vendas hoje</span><strong>{brl(data.metrics.salesCentsToday)}</strong></article>
          </div>}

          {(!pagedDashboard || dashboardPage === 1 || dashboardPage === 2) && <div className='commercialDashboardGrid'>
            {(!pagedDashboard || dashboardPage === 1) && <article className='commercialPanel'>
              <div className='commercialPanelTitle'><Activity size={17}/><div><b>Atividade recente</b><small>Eventos persistidos e autenticados</small></div></div>
              <div className='commercialList' tabIndex={0} aria-label='Atividade comercial recente'>
                {data.events.slice(0, 5).map(item => <RecordRow key={item.id} item={item}/>)}
                {!data.events.length && <div className='commercialEmpty'>Nenhum evento comercial comprovado ainda.</div>}
              </div>
            </article>}
            {(!pagedDashboard || dashboardPage === 2) && <article className='commercialPanel'>
              <div className='commercialPanelTitle'><Megaphone size={17}/><div><b>Pipeline de conteúdo</b><small>Criativo → aprovação → publicação</small></div></div>
              <div className='commercialList' tabIndex={0} aria-label='Pipeline comercial de conteúdo'>
                {[...data.creatives, ...data.publications].slice(0, 5).map(item => <RecordRow key={item.kind + item.id} item={item}/>)}
                {!data.creatives.length && !data.publications.length && <div className='commercialEmpty'>Nenhum criativo ou publicação registrado.</div>}
              </div>
            </article>}
          </div>}

          {(!pagedDashboard || dashboardPage === 3) && <div className='commercialProofStrip'>
            <span><ShieldCheck/>Canais ativos <b>{data.robot.activeChannels.length ? data.robot.activeChannels.join(', ') : 'nenhum comprovado'}</b></span>
            <span><Bot/>Prospecção externa <b>{data.robot.externalProspecting ? 'LIBERADA' : 'NÃO COMPROVADA'}</b></span>
            <span><Send/>Adaptador de publicação <b>{data.robot.publishAdapterReady ? 'READY' : 'STANDBY'}</b></span>
            <span><Activity/>Heartbeat <b>{time(data.robot.lastHeartbeatAt)}</b></span>
          </div>}
        </>
      )}

      {section === 'approvals' && (
        <article className='commercialPanel'>
          <div className='commercialPanelTitle'><FileCheck2 size={17}/><div><b>Itens aguardando decisão</b><small>{approvalItems.length} item(ns)</small></div></div>
          {actionError && <div className='errorbox'>{actionError}</div>}
          <div className='approvalGrid'>
            {approvalItems.map(item => (
              <article className='approvalCard' key={item.kind + item.id}>
                <div><span className='commercialState warn'>AGUARDANDO APROVAÇÃO</span><small>{item.kind === 'creative' ? 'CRIATIVO' : 'PUBLICAÇÃO'} · {item.channel || 'sem canal'}</small></div>
                {item.kind === 'creative' && (item.imageUrl || item.imageDataUrl) && <img className='approvalImage' src={item.imageUrl || item.imageDataUrl || ''} alt={'Criativo de ' + (item.product || 'ZEVANORY')} />}
                <h3>{item.title}</h3>
                <p>{item.detail || 'Sem detalhe adicional.'}</p>
                <div className='approvalActions'>
                  <button className='approveBtn' disabled={Boolean(busyId)} onClick={() => void act(item,'approve')}><Check size={15}/>Aprovar</button>
                  <button className='changeBtn' disabled={Boolean(busyId)} onClick={() => void act(item,'request-changes')}><RotateCcw size={15}/>Alterar</button>
                  <button className='rejectBtn' disabled={Boolean(busyId)} onClick={() => void act(item,'reject')}><X size={15}/>Rejeitar</button>
                </div>
              </article>
            ))}
            {!approvalItems.length && <div className='commercialEmpty'>Fila de aprovação vazia.</div>}
          </div>
        </article>
      )}

      {section === 'creatives' && (
        <article className='commercialPanel creativeLivePanel'>
          <div className='commercialPanelTitle'><Sparkles size={17}/><div><b>Creative Live Studio</b><small>{studioCreatives.length} peça(s){hiddenCreatives ? ' · ' + hiddenCreatives + ' arquivada(s)/brief(s) fora da vitrine' : ''} · atualização automática</small></div><div className='recordPager'><button className='secondary compact' onClick={() => setListPage(Math.max(0, safeCreativePage - 1))} disabled={safeCreativePage === 0}>‹</button><strong>{safeCreativePage + 1}/{creativePageCount}</strong><button className='secondary compact' onClick={() => setListPage(Math.min(creativePageCount - 1, safeCreativePage + 1))} disabled={safeCreativePage >= creativePageCount - 1}>›</button></div></div>
          <div className='creativeLiveGrid' aria-label='Criativos em tempo real'>
            {pagedCreatives.map(item => (
              <article className='creativeLiveCard' key={item.id}>
                <div className='creativePreview' aria-label={'Preview operacional de ' + item.title}>{(item.imageUrl || item.imageDataUrl) ? <img src={item.imageUrl || item.imageDataUrl || ''} alt={'Asset de ' + item.title} loading='lazy' /> : item.evidence.find(e => /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?|$)/i.test(e)) ? <img src={item.evidence.find(e => /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?|$)/i.test(e))} alt={'Asset de ' + item.title} loading='lazy' /> : <><Sparkles size={28}/><span>{item.product || 'ZEVANORY'}</span><small>ASSET PENDENTE · NÃO COMPROVADO</small></>}</div>
                <div className='creativeLiveBody'>
                  <div className='commercialTitleLine'><strong>{item.title}</strong><span className={'commercialState ' + statusClass(item.status)}>{commercialStatusLabel(item.status)}</span></div>
                  <p>{item.detail || 'Sem detalhe adicional.'}</p>
                  <div className='commercialMeta'><span>Fonte: {item.source}</span><span>{time(item.updatedAt)}</span></div>
                  <div className='creativeEvidence'>{item.evidence.length ? item.evidence.slice(0,2).map(e => <span key={e}>{e}</span>) : <span>sem asset visual anexado</span>}</div>
                </div>
              </article>
            ))}
            {!studioCreatives.length && <div className='commercialEmpty'>Nenhum criativo comprovado no stream operacional.</div>}
          </div>
        </article>
      )}

      {!['commercial','approvals','creatives'].includes(section) && (
        <article className='commercialPanel'>
          <div className='commercialPanelTitle'>
            {section === 'creatives' && <Sparkles size={17}/>}
            {section === 'publications' && <Send size={17}/>}
            {section === 'prospecting' && <Search size={17}/>}
            {section === 'crm' && <BadgeDollarSign size={17}/>}
            {section === 'support' && <Headphones size={17}/>}
            {section === 'finance' && <CircleDollarSign size={17}/>}
            {section === 'evidence' && <ShieldCheck size={17}/>}
            <div><b>{meta.title}</b><small>{items.length} registro(s){section === 'prospecting' && discardedSignals > 0 ? ' · ' + discardedSignals + ' resultado(s) de ruído descartado(s)' : ''}</small></div>
            <div className='recordPager'><button className='secondary compact' onClick={() => setListPage(Math.max(0, safeListPage - 1))} disabled={safeListPage === 0}>‹</button><strong>{safeListPage + 1}/{genericPageCount}</strong><button className='secondary compact' onClick={() => setListPage(Math.min(genericPageCount - 1, safeListPage + 1))} disabled={safeListPage >= genericPageCount - 1}>›</button></div>
          </div>
          {actionError && <div className='errorbox'>{actionError}</div>}
          <div className='commercialList commercialListTall' tabIndex={0} aria-label={meta.title + ' — registros'}>
            {pagedItems.map(item => (
              <div key={item.kind + item.id}>
                <RecordRow item={item}/>
                {section === 'prospecting' && item.status === 'raw-discovery' && (
                  <div className='approvalActions'>
                    <button className='approveBtn' disabled={Boolean(busyId)} onClick={() => void promoteDiscovery(item)}><Check size={15}/>Promover para lead</button>
                  </div>
                )}
                {section === 'crm' && (
                  <div className='approvalActions'>
                    {['new','nurture'].includes(item.status) && <button className='changeBtn' disabled={Boolean(busyId)} onClick={() => void qualifyLead(item)}><ShieldCheck size={15}/>Qualificar</button>}
                    {item.status === 'qualified' && <button className='approveBtn' disabled={Boolean(busyId)} onClick={() => void executeSalesAction(item, 'contact')}><Send size={15}/>Contato</button>}
                    {item.status === 'conversation' && <button className='approveBtn' disabled={Boolean(busyId)} onClick={() => void executeSalesAction(item, 'offer')}><BadgeDollarSign size={15}/>Oferta</button>}
                    {['offer','follow-up'].includes(item.status) && <button className='changeBtn' disabled={Boolean(busyId)} onClick={() => void executeSalesAction(item, 'follow-up')}><RotateCcw size={15}/>Follow-up</button>}
                    {['offer','follow-up'].includes(item.status) && <button className='approveBtn' disabled={Boolean(busyId)} onClick={() => void executeSalesAction(item, 'checkout')}><CircleDollarSign size={15}/>Checkout</button>}
                  </div>
                )}
              </div>
            ))}
            {!items.length && <div className='commercialEmpty'>Nenhum registro comprovado nesta área. O painel não preencherá dados fictícios.</div>}
          </div>
        </article>
      )}
    </section>
  );
}
