import { useMemo, useState } from 'react';
import {
  Activity, BadgeDollarSign, Bot, Check, CircleDollarSign, FileCheck2, Headphones,
  Megaphone, MessageSquareText, Search, Send, ShieldCheck, Sparkles, X, RotateCcw,
} from 'lucide-react';
import { api } from './api';
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
  prospecting: { title: 'Prospecção', subtitle: 'Leads e atividade do robô comercial, sem contagem cenográfica.' },
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
  const meta = SECTION_META[section];

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

  if (!data) {
    return <section className='commercialPanel'><div className='commercialEmpty'>Workspace comercial indisponível. Nenhuma métrica foi presumida.</div></section>;
  }

  const genericMap: Partial<Record<CommercialSection, CommercialRecord[]>> = {
    creatives: data.creatives,
    publications: data.publications,
    prospecting: data.leads,
    crm: data.leads,
    support: data.support,
    finance: data.finance,
    evidence: [...data.evidence, ...data.events],
  };
  let items = genericMap[section] || [];
  if (section === 'crm') items = [...data.leads].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <section className='commercialWorkspace'>
      <header className='commercialHeader'>
        <div>
          <p className='kicker'>GROWTH / REVENUE OPERATIONS</p>
          <h2>{meta.title}</h2>
          <p>{meta.subtitle}</p>
        </div>
        <div className={'robotBadge ' + data.robot.state.toLowerCase()}>
          <Bot size={18} />
          <div><b>{data.robot.label}</b><small>{data.robot.reason}</small></div>
        </div>
      </header>

      {section === 'commercial' && (
        <>
          <div className='commercialMetrics'>
            <article><Search/><span>Leads encontrados hoje</span><strong>{data.metrics.leadsToday}</strong></article>
            <article><MessageSquareText/><span>Contatos hoje</span><strong>{data.metrics.contactsToday}</strong></article>
            <article><Sparkles/><span>Criativos em produção</span><strong>{data.metrics.creativesInProduction}</strong></article>
            <article><FileCheck2/><span>Aguardando aprovação</span><strong>{data.metrics.pendingApproval}</strong></article>
            <article><Send/><span>Publicados hoje</span><strong>{data.metrics.publishedToday}</strong></article>
            <article><CircleDollarSign/><span>Vendas hoje</span><strong>{brl(data.metrics.salesCentsToday)}</strong></article>
          </div>

          <div className='commercialDashboardGrid'>
            <article className='commercialPanel'>
              <div className='commercialPanelTitle'><Activity size={17}/><div><b>Atividade recente</b><small>Eventos persistidos e autenticados</small></div></div>
              <div className='commercialList'>
                {data.events.slice(0, 5).map(item => <RecordRow key={item.id} item={item}/>)}
                {!data.events.length && <div className='commercialEmpty'>Nenhum evento comercial comprovado ainda.</div>}
              </div>
            </article>
            <article className='commercialPanel'>
              <div className='commercialPanelTitle'><Megaphone size={17}/><div><b>Pipeline de conteúdo</b><small>Criativo → aprovação → publicação</small></div></div>
              <div className='commercialList'>
                {[...data.creatives, ...data.publications].slice(0, 5).map(item => <RecordRow key={item.kind + item.id} item={item}/>)}
                {!data.creatives.length && !data.publications.length && <div className='commercialEmpty'>Nenhum criativo ou publicação registrado.</div>}
              </div>
            </article>
          </div>

          <div className='commercialProofStrip'>
            <span><ShieldCheck/>Canais ativos <b>{data.robot.activeChannels.length ? data.robot.activeChannels.join(', ') : 'nenhum comprovado'}</b></span>
            <span><Bot/>Prospecção externa <b>{data.robot.externalProspecting ? 'LIBERADA' : 'NÃO COMPROVADA'}</b></span>
            <span><Send/>Adaptador de publicação <b>{data.robot.publishAdapterReady ? 'READY' : 'STANDBY'}</b></span>
            <span><Activity/>Heartbeat <b>{time(data.robot.lastHeartbeatAt)}</b></span>
          </div>
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

      {!['commercial','approvals'].includes(section) && (
        <article className='commercialPanel'>
          <div className='commercialPanelTitle'>
            {section === 'creatives' && <Sparkles size={17}/>}
            {section === 'publications' && <Send size={17}/>}
            {section === 'prospecting' && <Search size={17}/>}
            {section === 'crm' && <BadgeDollarSign size={17}/>}
            {section === 'support' && <Headphones size={17}/>}
            {section === 'finance' && <CircleDollarSign size={17}/>}
            {section === 'evidence' && <ShieldCheck size={17}/>}
            <div><b>{meta.title}</b><small>{items.length} registro(s)</small></div>
          </div>
          <div className='commercialList commercialListTall'>
            {items.map(item => <RecordRow key={item.kind + item.id} item={item}/>)}
            {!items.length && <div className='commercialEmpty'>Nenhum registro comprovado nesta área. O painel não preencherá dados fictícios.</div>}
          </div>
        </article>
      )}
    </section>
  );
}
