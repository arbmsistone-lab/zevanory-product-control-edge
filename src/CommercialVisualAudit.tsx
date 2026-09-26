import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CommercialWorkspace from './CommercialWorkspace';
import type { CommercialRecord, CommercialWorkspaceData } from './commercial-model';
import './index.css';

document.documentElement.dataset.theme = 'dark';

const now = '2026-09-26T15:00:00.000Z';
const record = (
  id: string,
  kind: CommercialRecord['kind'],
  title: string,
  status: string,
  source: string,
  detail: string,
  channel: string | null = null,
  valueCents: number | null = null,
): CommercialRecord => ({
  id,
  kind,
  title,
  detail,
  status,
  channel,
  product: 'ZEVANORY',
  productId: 'zevanory',
  valueCents,
  source,
  sourceKey: id,
  evidence: ['visual-audit-fixture'],
  createdAt: now,
  updatedAt: now,
  publishedAt: status === 'published' ? now : null,
});

const leads = [
  record('lead-1', 'lead', 'Empresa varejista CE', 'qualified', 'public-search', 'Lead público qualificado para automação comercial.', 'web'),
  record('lead-2', 'lead', 'Clínica regional CE', 'contacted', 'public-search', 'Lead com aderência a atendimento e CRM.', 'web'),
];

const creatives = [
  record('creative-1', 'creative', 'Brief institucional ZEVANORY', 'approval', 'commercial-robot', 'Criativo aguardando decisão humana antes de publicação.', 'instagram'),
  record('creative-2', 'creative', 'Teste A/B proposta de valor', 'testing', 'commercial-robot', 'Variação em teste controlado, sem publicação automática.', 'facebook'),
];

const publications = [
  record('pub-1', 'publication', 'Post institucional aprovado', 'published', 'publisher-adapter', 'Publicação com readback comprovado.', 'instagram'),
  record('pub-2', 'publication', 'Conteúdo educativo', 'pending-approval', 'control-center', 'Aguardando aprovação antes do agendamento.', 'facebook'),
];

const events = [
  record('event-1', 'event', 'Heartbeat do robô comercial', 'heartbeat', 'commercial-robot', 'Worker operacional com pesquisa pública ativa.'),
  record('event-2', 'event', 'Ciclo de prospecção concluído', 'research', 'commercial-robot', '16 resultados processados; 0 falhas.'),
];

const data: CommercialWorkspaceData = {
  generatedAt: now,
  metrics: {
    leadsToday: 16,
    contactsToday: 4,
    creativesInProduction: 2,
    pendingApproval: 2,
    publishedToday: 1,
    salesCentsToday: 249900,
  },
  robot: {
    state: 'ACTIVE',
    label: 'ROBÔ COMERCIAL: ATIVO',
    reason: 'Prospecção ativa com heartbeat recente; contato e publicação externos permanecem condicionados aos gates.',
    lastHeartbeatAt: now,
    externalProspecting: true,
    publishAdapterReady: true,
    activeChannels: ['Instagram', 'Facebook'],
  },
  leads,
  creatives,
  publications,
  events,
  support: [],
  finance: [record('fin-1', 'finance', 'Venda confirmada', 'confirmed', 'payment', 'Pagamento confirmado.', 'checkout', 249900)],
  evidence: [record('ev-1', 'evidence', 'Readback comercial', 'confirmed', 'control-center', 'Evidência vinculada ao release.')],
  counts: { leads: 2, creatives: 2, publications: 2, events: 2, support: 0, finance: 1, evidence: 1 },
};

const nav = ['Visão Geral','Produtos','Comercial','Criativos','Aprovações','Publicações','Prospecção','CRM/Vendas','Atendimento','Financeiro','ZEVANORY CFO','Evidências'];

function VisualAuditApp() {
  return (
    <main className="shell shell-commercial">
      <header className="topbar">
        <div>
          <p className="eyebrow">ZEVANORY · ADMINISTRATIVO GERAL</p>
          <h1>ZEVANORY CONTROL CENTER</h1>
          <p className="subtitle">Operação comercial auditada em viewport controlado.</p>
        </div>
        <div className="actions"><span className="adminChip">PIN ADMIN ATIVO</span></div>
      </header>
      <section className="policybar">
        <span>ADMIN RESTRITO</span><span>ZERO_SPEND ATIVO</span><span>FAIL-CLOSED ATIVO</span><span>VENDA SEM GATE: BLOQUEADA</span>
      </section>
      <section className="trustStrip green">
        <div className="trustState"><span>TRUST CHAIN</span><strong>GREEN</strong></div>
        <div><small>Quorum</small><b>3/3 · min 3</b></div>
        <div><small>SHA</small><b>VISUAL-AUDIT</b></div>
      </section>
      <nav className="tabs controlCenterTabs" aria-label="Áreas do ZEVANORY CONTROL CENTER">
        {nav.map(label => <button key={label} className={label === 'Comercial' ? 'tab active' : 'tab'}>{label}</button>)}
      </nav>
      <CommercialWorkspace section="commercial" data={data} sessionToken="" onRefresh={() => undefined} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><VisualAuditApp /></StrictMode>);
