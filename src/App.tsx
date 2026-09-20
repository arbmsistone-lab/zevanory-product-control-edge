import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  ExternalLink,
  Gauge,
  LogIn,
  LogOut,
  PackagePlus,
  Pencil,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { api } from './api';

type SystemItem = {
  id: string;
  name: string;
  domain: string;
  status: 'healthy' | 'attention' | 'integration';
  score: number;
  lastAudit: string;
  gate: string;
  evidence: string[];
  sha?: string;
  source?: string;
  availability?: number | null;
  latencyMs?: number | null;
  ci?: string;
};

type AuditItem = {
  id: string;
  system: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  createdAt: string;
};

type Improvement = {
  id: string;
  system: string;
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  reason: string;
  state: 'proposed' | 'validated' | 'blocked';
};

type Incident = {
  id: string;
  system: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  createdAt: string;
  state: 'open' | 'watching';
};

type GlobalTrust = {
  state: string;
  sha: string | null;
  evidenceRoot: string | null;
  policyVersion: string | null;
  quorum: { passed: number; total: number; required: number; conflicts: number; independentKeys: number };
  zea10: { proven: number; partial: number; blocked: number };
  engines: Array<{ id: string; state: string }>;
  checkedAt: string | null;
};

type Dashboard = {
  systems: SystemItem[];
  audits: AuditItem[];
  improvements: Improvement[];
  incidents: Incident[];
  policy: {
    zeroSpend: boolean;
    failClosed: boolean;
    destructiveActions: boolean;
    greenRule: string;
  };
  lastEngineRun: string;
  certificationRuns?: Array<{
    id: string;
    targetId: string;
    targetName: string;
    status: 'running' | 'complete' | 'failed';
    releaseFingerprint: string;
    sourceSha: string;
    startedAt: string;
    finishedAt: string | null;
    completedPillars: number;
    currentPillar: string | null;
  }>;
};

type ProductStatus = 'draft' | 'validation' | 'ready' | 'blocked' | 'archived';

type ProductAudit = {
  engineering: number | null;
  infrastructure: number | null;
  ux: number | null;
  observability: number | null;
  lastAuditedAt: string | null;
};

type CertificationStatus = 'proved' | 'partial' | 'blocked' | 'na' | 'external';
type CertificationPillar = { id: string; name: string; shortName: string; status: CertificationStatus; controls: number; rationale: string; blocker: string | null; evidence: string[] };
type ProductCertification = {
  standard: string;
  version: string;
  profile: string;
  ready: boolean;
  rootBlocker: string | null;
  evidenceCount: number;
  summary: { proved: number; partial: number; blocked: number; na: number; external: number; applicable: number; applicableControls: number; provedControls: number };
  pillars: CertificationPillar[];
};

type Product = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  publicUrl: string;
  priceCents: number | null;
  currency: 'BRL';
  checkoutUrl: string;
  deliveryModel: string;
  channels: string[];
  status: ProductStatus;
  salesEnabled: boolean;
  gates: {
    legal: boolean;
    payment: boolean;
    fulfillment: boolean;
    support: boolean;
  };
  audit: ProductAudit;
  auditOverall: number | null;
  auditStatus: 'pending' | 'audited';
  notes: string;
  createdAt: string;
  updatedAt: string;
  commercialReady: boolean;
  blockers: string[];
  certification: ProductCertification;
};

type ProductSummary = {
  total: number;
  salesEnabled: number;
  commercialReady: number;
  blocked: number;
  certified: number;
  inCertification: number;
  zeesBlocked: number;
};

type CertificationTarget = {
  id: string;
  name: string;
  kind: string;
  publicUrl: string;
  certification: ProductCertification;
};

type ProductForm = {
  name: string;
  slug: string;
  category: string;
  description: string;
  publicUrl: string;
  price: string;
  checkoutUrl: string;
  deliveryModel: string;
  channels: string;
  status: ProductStatus;
  salesEnabled: boolean;
  gates: {
    legal: boolean;
    payment: boolean;
    fulfillment: boolean;
    support: boolean;
  };
  audit: {
    engineering: string;
    infrastructure: string;
    ux: string;
    observability: string;
  };
  notes: string;
};

const emptyForm: ProductForm = {
  name: '',
  slug: '',
  category: 'Produto digital',
  description: '',
  publicUrl: '',
  price: '',
  checkoutUrl: '',
  deliveryModel: 'Digital',
  channels: '',
  status: 'draft',
  salesEnabled: false,
  gates: { legal: false, payment: false, fulfillment: false, support: false },
  audit: { engineering: '', infrastructure: '', ux: '', observability: '' },
  notes: '',
};

function formatMoney(cents: number | null) {
  if (cents === null) return 'Preco pendente';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function formatAuditScore(value: number | null) {
  return value === null ? 'Pendente' : `${value.toFixed(1)}/10`;
}

function statusLabel(status: ProductStatus) {
  return {
    draft: 'Rascunho',
    validation: 'Em validacao',
    ready: 'Pronto',
    blocked: 'Bloqueado',
    archived: 'Arquivado',
  }[status];
}

function certificationStatusLabel(status: CertificationStatus) {
  return { proved: 'PROVADO', partial: 'PARCIAL', blocked: 'BLOQUEADO', na: 'N/A JUSTIFICADO', external: 'EXTERNO' }[status];
}

function certificationProfileLabel(profile: string) {
  return ({ AI_AGENTIC_PLATFORM: 'AI / AGENTIC PLATFORM', COMMERCE_CONTROL_PLANE: 'COMMERCE CONTROL PLANE', SAAS_TRANSACTIONAL: 'SAAS TRANSACIONAL', DIGITAL_CONTENT: 'PRODUTO DIGITAL' } as Record<string, string>)[profile] || profile;
}

function LoginScreen({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState('DIAGNÓSTICO: carregando...');

  useEffect(() => {
    let active = true;
    api.get('/api/_auth_diagnostic')
      .then(response => {
        if (!active) return;
        const d = response.data || {};
        const parts = [
          `PIN:${d.secretValid ? 'OK' : 'FALHA'}`,
          `LOCK:${d.locked ? 'ATIVO' : 'LIVRE'}`,
          `SESSÃO:${d.sessionRoundtrip ? 'OK' : 'FALHA'}`,
          `BOOT:${d.bootstrapOk ? 'OK' : 'FALHA'}`,
          d.stage ? `ETAPA:${d.stage}` : '',
        ].filter(Boolean);
        setDiagnostic(`DIAGNÓSTICO: ${parts.join(' · ')}`);
      })
      .catch(() => { if (active) setDiagnostic('DIAGNÓSTICO: indisponível'); });
    return () => { active = false; };
  }, []);

  const login = async () => {
    if (!/^\d{4}$/.test(pin)) {
      setError('Digite os 4 numeros do PIN.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/api/pin/login', { pin });
      const token = response.data.sessionToken as string;
      localStorage.setItem('arbm_admin_session', token);
      onSuccess(token);
    } catch (err: any) {
      const message = String(err?.response?.data?.error || err?.response?.data?.message || 'Não foi possível entrar.');
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className='loginShell'>
      <section className='loginCard'>
        <ShieldCheck size={34} />
        <p className='eyebrow'>ZEVANORY · ACESSO ADMINISTRATIVO</p>
        <h1>ZEVANORY PRODUCT CONTROL</h1>
        <p>Controle de produtos, governanca e certificacao. Digite seu PIN de 4 numeros.</p>
        <input
          className='pinInput'
          type='password'
          inputMode='numeric'
          autoComplete='one-time-code'
          maxLength={4}
          value={pin}
          onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={event => { if (event.key === 'Enter') void login(); }}
          aria-label='PIN de 4 numeros'
        />
        <button className='primary' onClick={login} disabled={busy || pin.length !== 4}>
          <LogIn size={17} />
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
        {error && <div className='errorbox'>{error}</div>}
        <div className='authDiagnostic'>{diagnostic}</div>
      </section>
    </main>
  );
}

function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [globalTrust, setGlobalTrust] = useState<GlobalTrust | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [certificationTargets, setCertificationTargets] = useState<CertificationTarget[]>([]);
  const [summary, setSummary] = useState<ProductSummary>({ total: 0, salesEnabled: 0, commercialReady: 0, blocked: 0, certified: 0, inCertification: 0, zeesBlocked: 0 });
  const [view, setView] = useState<'products' | 'operations' | 'governance'>('products');
  const [filter, setFilter] = useState<'all' | 'selling' | 'blocked' | 'archived'>('all');
  const [productPage, setProductPage] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('arbm_admin_session') || '');
  const [authState, setAuthState] = useState<'checking' | 'signedout' | 'ready'>('checking');

  const loadGlobalTrustLive = async () => {
    try {
      const response = await fetch(`/global-trust.json?t=${Date.now()}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`trust_http_${response.status}`);
      const trust = await response.json() as GlobalTrust;
      setGlobalTrust(trust);
      return trust;
    } catch {
      return null;
    }
  };

  const load = async (token = sessionToken) => {
    if (!token) {
      setAuthState('signedout');
      return;
    }
    try {
      setError('');
      const response = await api.post('/api/admin/bootstrap', { sessionToken: token });
      setDashboard(response.data.dashboard);
      setGlobalTrust(response.data.globalTrust ?? null);
      setProducts(response.data.products);
      setCertificationTargets(response.data.certificationTargets ?? []);
      setSummary(response.data.summary);
      setAuthState('ready');
      void loadGlobalTrustLive();
    } catch {
      localStorage.removeItem('arbm_admin_session');
      setSessionToken('');
      setAuthState('signedout');
    }
  };

  useEffect(() => {
    void load(sessionToken);
  }, []);

  useEffect(() => {
    if (authState !== 'ready') return;
    const timer = window.setInterval(() => { void loadGlobalTrustLive(); }, 30000);
    return () => window.clearInterval(timer);
  }, [authState]);

  const logout = async () => {
    try {
      if (sessionToken) await api.post('/api/pin/logout', { sessionToken });
    } catch {
      // Local session is still cleared.
    }
    localStorage.removeItem('arbm_admin_session');
    setSessionToken('');
    setAuthState('signedout');
    setDashboard(null);
    setGlobalTrust(null);
  };

  const handleLogin = (token: string) => {
    setSessionToken(token);
    setAuthState('checking');
    void load(token);
  };

  const runGovernance = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post(path, { sessionToken });
      await load();
    } catch {
      setError('A operação não foi concluída. O sistema permaneceu fail-closed.');
    } finally {
      setBusy(false);
    }
  };

  const runCertification = async () => {
    if (!selectedCertificationTarget) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/certification/run', { sessionToken, targetId: selectedCertificationTarget.id });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'A certificação não foi concluída. O sistema permaneceu fail-closed.');
    } finally {
      setBusy(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
    setError('');
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm({
      name: product.name,
      slug: product.slug,
      category: product.category,
      description: product.description,
      publicUrl: product.publicUrl,
      price: product.priceCents === null ? '' : (product.priceCents / 100).toFixed(2).replace('.', ','),
      checkoutUrl: product.checkoutUrl,
      deliveryModel: product.deliveryModel,
      channels: product.channels.join(', '),
      status: product.status,
      salesEnabled: product.salesEnabled,
      gates: { ...product.gates },
      audit: {
        engineering: product.audit.engineering === null ? '' : String(product.audit.engineering),
        infrastructure: product.audit.infrastructure === null ? '' : String(product.audit.infrastructure),
        ux: product.audit.ux === null ? '' : String(product.audit.ux),
        observability: product.audit.observability === null ? '' : String(product.audit.observability),
      },
      notes: product.notes,
    });
    setFormOpen(true);
    setError('');
  };

  const saveProduct = async () => {
    const normalizedPrice = form.price.trim().replace(',', '.');
    const numericPrice = normalizedPrice === '' ? null : Number(normalizedPrice);
    if (numericPrice !== null && (!Number.isFinite(numericPrice) || numericPrice < 0)) {
      setError('Informe um preco valido ou deixe o campo vazio.');
      return;
    }

    const parseAudit = (value: string) => value.trim() === '' ? null : Number(value.replace(',', '.'));
    const audit = {
      engineering: parseAudit(form.audit.engineering),
      infrastructure: parseAudit(form.audit.infrastructure),
      ux: parseAudit(form.audit.ux),
      observability: parseAudit(form.audit.observability),
      lastAuditedAt: editing?.audit.lastAuditedAt ?? null,
    };
    const invalidAudit = [audit.engineering, audit.infrastructure, audit.ux, audit.observability]
      .some(value => value !== null && (!Number.isFinite(value) || value < 1 || value > 10));
    if (invalidAudit) {
      setError('As notas de auditoria devem estar entre 1 e 10, ou ficar vazias enquanto pendentes.');
      return;
    }

    const payload = {
      name: form.name,
      slug: form.slug.trim().toLowerCase(),
      category: form.category,
      description: form.description,
      publicUrl: form.publicUrl,
      priceCents: numericPrice === null ? null : Math.round(numericPrice * 100),
      checkoutUrl: form.checkoutUrl,
      deliveryModel: form.deliveryModel,
      channels: form.channels.split(',').map(item => item.trim()).filter(Boolean),
      status: form.status,
      salesEnabled: form.salesEnabled,
      gates: form.gates,
      audit,
      notes: form.notes,
    };

    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api.post('/api/products/update', { ...payload, id: editing.id, sessionToken });
      } else {
        await api.post('/api/products/create', { ...payload, sessionToken });
      }
      setFormOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch {
      setError(
        form.salesEnabled
          ? 'Venda bloqueada pelo gate comercial/ZEES. Para ativar, o produto precisa estar Pronto, com comercial completo e certificacao ZEES-16 integralmente PROVADA.'
          : 'Nao foi possivel salvar o produto. Revise nome, slug e campos informados.',
      );
    } finally {
      setBusy(false);
    }
  };

  const archiveProduct = async (product: Product) => {
    if (!window.confirm(`Arquivar ${product.name}? A venda sera desligada e o registro sera preservado.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/products/archive', { id: product.id, sessionToken });
      await load();
    } catch {
      setError('Nao foi possivel arquivar o produto.');
    } finally {
      setBusy(false);
    }
  };

  const visibleProducts = useMemo(() => products.filter(product => {
    if (filter === 'selling') return product.salesEnabled;
    if (filter === 'blocked') return !product.commercialReady && product.status !== 'archived';
    if (filter === 'archived') return product.status === 'archived';
    return true;
  }), [products, filter]);
  const productPageSize = 3;
  const productPageCount = Math.max(1, Math.ceil(visibleProducts.length / productPageSize));
  const safeProductPage = Math.min(productPage, productPageCount - 1);
  const pagedProducts = visibleProducts.slice(safeProductPage * productPageSize, (safeProductPage + 1) * productPageSize);

  const selectedCertificationTarget = useMemo(
    () => certificationTargets.find(target => target.id === selectedTargetId) ?? certificationTargets[0] ?? null,
    [certificationTargets, selectedTargetId],
  );
  const openCertification = (product: Product) => {
    setSelectedTargetId(`product:${product.id}`);
    setView('governance');
  };

  if (authState === 'checking') {
    return <main className='loading'><div className='loader' /><p>Validando PIN administrativo...</p></main>;
  }
  if (authState === 'signedout') return <LoginScreen onSuccess={handleLogin} />;
  if (!dashboard) {
    return <main className='loading'><div className='loader' /><p>Inicializando ZEVANORY PRODUCT CONTROL...</p></main>;
  }

  return (
    <main className={`shell shell-${view}`}>
      <header className='topbar'>
        <div>
          <p className='eyebrow'>ZEVANORY · GESTÃO, GOVERNANÇA E CERTIFICAÇÃO DE PRODUTOS</p>
          <h1>ZEVANORY PRODUCT CONTROL</h1>
          <p className='subtitle'>Portfólio, operação, evidência e certificação ZEES-16 de engenharia em uma única torre fail-closed.</p>
        </div>
        <div className='actions'>
          <span className='adminChip'><ShieldCheck size={15} />PIN ADMIN ATIVO</span>
          {view === 'products' && <button className='primary' onClick={openNew}><PackagePlus size={17} />Novo produto</button>}
          <button className='secondary' onClick={logout}><LogOut size={17} />Sair</button>
        </div>
      </header>

      <section className='policybar'>
        <span><ShieldCheck size={16} /> ADMIN RESTRITO</span>
        <span><Gauge size={16} /> ZERO_SPEND {dashboard.policy.zeroSpend ? 'ATIVO' : 'OFF'}</span>
        <span><ShieldCheck size={16} /> FAIL-CLOSED {dashboard.policy.failClosed ? 'ATIVO' : 'OFF'}</span>
        <span><AlertTriangle size={16} /> VENDA SEM GATE: BLOQUEADA</span>
      </section>

      <section className={globalTrust?.state === 'GREEN' ? 'trustStrip green' : 'trustStrip blocked'} aria-label='Estado global ZEVANORY'>
        <div className='trustState'>
          <ShieldCheck size={16} />
          <span>TRUST CHAIN</span>
          <strong>{globalTrust?.state ?? 'BLOCKED'}</strong>
        </div>
        <div><small>Quorum</small><b>{globalTrust ? `${globalTrust.quorum.passed}/${globalTrust.quorum.total} · min ${globalTrust.quorum.required}` : '0/3'}</b></div>
        <div><small>ZEA-10 global</small><b>{globalTrust ? `${globalTrust.zea10.proven}/10 provados` : 'sem prova'}</b></div>
        <div><small>SHA</small><b>{globalTrust?.sha ? globalTrust.sha.slice(0, 12) : 'SEM SHA'}</b></div>
        <div><small>Motores</small><b>{globalTrust?.engines.length ? globalTrust.engines.map(item => `${item.id}:${item.state}`).join(' · ') : 'SEM MOTOR'}</b></div>
      </section>

      <nav className='tabs' aria-label='Areas do ZEVANORY PRODUCT CONTROL'>
        <button className={view === 'products' ? 'tab active' : 'tab'} onClick={() => setView('products')}><ShoppingBag size={16} />Produtos</button>
        <button className={view === 'operations' ? 'tab active' : 'tab'} onClick={() => setView('operations')}><Activity size={16} />Operações</button>
        <button className={view === 'governance' ? 'tab active' : 'tab'} onClick={() => setView('governance')}><SlidersHorizontal size={16} />ZEES-16 / Governança</button>
      </nav>

      {error && <div className='errorbox globalError'>{error}</div>}

      {view === 'products' && (
        <>
          <section className='metrics'>
            <div className='metric'><span>Produtos cadastrados</span><strong>{summary.total}</strong></div>
            <div className='metric'><span>Certificados integralmente</span><strong>{summary.certified}</strong></div>
            <div className='metric'><span>Em certificação</span><strong>{summary.inCertification}</strong></div>
            <div className='metric'><span>Bloqueados ZEES</span><strong>{summary.zeesBlocked}</strong></div>
          </section>

          <section className='toolbar'>
            <div>
              <p className='kicker'>PORTFOLIO CENTRAL</p>
              <h2>Produtos e programas</h2>
            </div>
            <div className='toolbarControls'>
              <div className='filters'>
                <button className={filter === 'all' ? 'filter active' : 'filter'} onClick={() => { setFilter('all'); setProductPage(0); }}>Todos</button>
                <button className={filter === 'selling' ? 'filter active' : 'filter'} onClick={() => { setFilter('selling'); setProductPage(0); }}>Em venda</button>
                <button className={filter === 'blocked' ? 'filter active' : 'filter'} onClick={() => { setFilter('blocked'); setProductPage(0); }}>Pendentes</button>
                <button className={filter === 'archived' ? 'filter active' : 'filter'} onClick={() => { setFilter('archived'); setProductPage(0); }}>Arquivados</button>
              </div>
              {productPageCount > 1 && <div className='pagination' aria-label='Paginação de produtos'>
                <button className='filter' onClick={() => setProductPage(Math.max(0, safeProductPage - 1))} disabled={safeProductPage === 0}>‹</button>
                <span>{safeProductPage + 1}/{productPageCount}</span>
                <button className='filter' onClick={() => setProductPage(Math.min(productPageCount - 1, safeProductPage + 1))} disabled={safeProductPage >= productPageCount - 1}>›</button>
              </div>}
            </div>
          </section>

          <section className='productGrid'>
            {pagedProducts.map(product => (
              <article className={product.status === 'archived' ? 'productCard archived' : 'productCard'} key={product.id}>
                <div className='productHead'>
                  <div>
                    <p className='productCategory'>{product.category}</p>
                    <h3>{product.name}</h3>
                  </div>
                  <span className={product.salesEnabled ? 'saleBadge on' : 'saleBadge off'}>{product.salesEnabled ? 'VENDA ON' : 'VENDA OFF'}</span>
                </div>
                <p className='productDescription'>{product.description || 'Sem descricao administrativa.'}</p>
                <div className='productFacts'>
                  <span><b>{formatMoney(product.priceCents)}</b><small>Preco</small></span>
                  <span><b>{statusLabel(product.status)}</b><small>Status</small></span>
                  <span><b>{product.deliveryModel || 'N/D'}</b><small>Entrega</small></span>
                </div>
                <div className='certPanel'>
                  <div className='auditHeader'>
                    <div><small>ZEES-16 · CERTIFICAÇÃO DE ENGENHARIA</small><strong>{certificationProfileLabel(product.certification.profile)}</strong></div>
                    <b className={product.certification.ready ? 'certRatio ready' : 'certRatio'}>{product.certification.summary.proved}/{product.certification.summary.applicable}</b>
                  </div>
                  <div className='zeesSealGrid' aria-label='16 selos ZEES'>
                    {product.certification.pillars.map(pillar => (
                      <span
                        key={pillar.id}
                        className={`zeesSealChip ${pillar.status}`}
                        title={`${pillar.id} · ${pillar.name} · ${certificationStatusLabel(pillar.status)}`}
                        aria-label={`${pillar.id} ${pillar.name}: ${certificationStatusLabel(pillar.status)}`}
                      >
                        <b>{pillar.id}</b>
                      </span>
                    ))}
                  </div>
                  <div className='certCompactSummary'>
                    <span className='proved'>{product.certification.summary.proved} provados</span>
                    <span className='partial'>{product.certification.summary.partial} parciais</span>
                    <span className='blocked'>{product.certification.summary.blocked} bloqueados</span>
                    <span>{product.certification.summary.na} N/A</span>
                  </div>
                  <p className='certBlockerLine'>{product.certification.ready ? 'CERTIFICADO INTEGRALMENTE' : `Bloqueador: ${product.certification.rootBlocker ?? 'evidência obrigatória pendente'}`}</p>
                </div>
                <div className='gateRow'>
                  <span className={product.gates.legal ? 'gate ok' : 'gate'}>Legal</span>
                  <span className={product.gates.payment ? 'gate ok' : 'gate'}>Pagamento</span>
                  <span className={product.gates.fulfillment ? 'gate ok' : 'gate'}>Entrega</span>
                  <span className={product.gates.support ? 'gate ok' : 'gate'}>Suporte</span>
                </div>
                {!product.commercialReady && product.status !== 'archived' && (
                  <p className='blockers'>{product.blockers.slice(0, 2).join(' · ')}{product.blockers.length > 2 ? ` +${product.blockers.length - 2}` : ''}</p>
                )}
                <div className='productActions'>
                  <button className='secondary compact' onClick={() => openCertification(product)}><ShieldCheck size={14} />Certificação</button>
                  <button className='secondary compact' onClick={() => openEdit(product)}><Pencil size={14} />Editar</button>
                  {product.publicUrl && <a className='secondary compact linkButton' href={product.publicUrl} target='_blank' rel='noreferrer'><ExternalLink size={14} />Pagina</a>}
                  {product.status !== 'archived' && <button className='ghost compact' onClick={() => archiveProduct(product)} disabled={busy}><Archive size={14} />Arquivar</button>}
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {view === 'operations' && (
        <section className='opsGrid'>
          <div className='panel'>
            <div className='panelhead'>
              <div><p className='kicker'>ACOES PROTEGIDAS</p><h2>Motor operacional</h2></div>
              <div className='actions'>
                <button className='secondary compact' onClick={() => runGovernance('/api/telemetry/refresh')} disabled={busy}><RadioTower size={15} />Telemetria</button>
                <button className='primary compact' onClick={() => runGovernance('/api/audit/run')} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} />Auditoria</button>
              </div>
            </div>
            <div className='operationSummary'>
              <span>Incidentes <b>{dashboard.incidents.length}</b></span>
              <span>Auditorias <b>{dashboard.audits.length}</b></span>
              <span>Melhorias <b>{dashboard.improvements.length}</b></span>
            </div>
          </div>
          <div className='panel'>
            <div className='panelhead'><div><p className='kicker'>INCIDENTES</p><h2>Fila operacional</h2></div><AlertTriangle size={20} /></div>
            <div className='feed'>
              {dashboard.incidents.length === 0
                ? <div className='empty'>Nenhum incidente registrado.</div>
                : dashboard.incidents.map(item => (
                  <article className={`feeditem ${item.severity}`} key={item.id}>
                    <div><strong>{item.title}</strong><p>{item.system} · {item.detail}</p></div>
                    <span className='state proposed'>{item.state}</span>
                  </article>
                ))}
            </div>
          </div>
          <div className='panel'>
            <div className='panelhead'><div><p className='kicker'>AUDITORIA</p><h2>Achados recentes</h2></div><ShieldCheck size={20} /></div>
            <div className='feed'>
              {dashboard.audits.length === 0
                ? <div className='empty'>Execute uma auditoria para gerar novos achados.</div>
                : dashboard.audits.slice(0, 8).map(item => (
                  <article className={`feeditem ${item.severity}`} key={item.id}>
                    <div><strong>{item.title}</strong><p>{item.system} · {item.detail}</p></div>
                    <time>{new Date(item.createdAt).toLocaleString('pt-BR')}</time>
                  </article>
                ))}
            </div>
          </div>
        </section>
      )}

      {view === 'governance' && (
        <section className='governanceStack'>
          <section className='panel governanceHero'>
            <div className='panelhead'>
              <div><p className='kicker'>ZEES-16 · ZEVANORY ENGINEERING EXCELLENCE STANDARD</p><h2>Governanca e certificacao central</h2></div>
              <ShieldCheck size={21} />
            </div>
            <p className='productDescription'>O ZEA-10 legado foi incorporado ao ZEES-16. Os 16 selos P01–P16 refletem diretamente o estado das evidências: verde somente quando PROVADO; parcial, bloqueado e N/A permanecem visualmente distintos e fail-closed.</p>
            <div className='standardStrip'><span><b>16</b>Pilares</span><span><b>247</b>Controles-base</span><span><b>{certificationTargets.length}</b>Alvos certificados</span><span><b>FAIL-CLOSED</b>Regra global</span></div>
          </section>
          <section className='certWorkspace'>
            <aside className='panel certSidebar'>
              <p className='kicker'>ESCOPO ZEES-16</p><h2>Sistemas e produtos</h2>
              <div className='certProductList'>
                {certificationTargets.map(target => (
                  <button key={target.id} className={selectedCertificationTarget?.id === target.id ? 'certProductButton active' : 'certProductButton'} onClick={() => setSelectedTargetId(target.id)}>
                    <span><b>{target.name}</b><small>{target.kind} · {certificationProfileLabel(target.certification.profile)}</small></span><strong>{target.certification.summary.proved}/{target.certification.summary.applicable}</strong>
                  </button>
                ))}
              </div>
            </aside>
            <div className='certDetail'>
              {selectedCertificationTarget && <>
                <section className='panel certSummaryPanel'>
                  <div className='certTitleRow'>
                    <div><p className='kicker'>{selectedCertificationTarget.certification.version} · {selectedCertificationTarget.kind}</p><h2>{selectedCertificationTarget.name}</h2><p>{certificationProfileLabel(selectedCertificationTarget.certification.profile)}</p></div>
                    <div className='certActions'>
                      <span className={selectedCertificationTarget.certification.ready ? 'certSeal ready' : 'certSeal blocked'}>{selectedCertificationTarget.certification.ready ? 'CERTIFICADO' : 'NÃO CERTIFICADO'}</span>
                      <button className='primary compact' onClick={runCertification} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} />{busy ? 'Executando P01–P16...' : 'Executar certificação'}</button>
                    </div>
                  </div>
                  <div className='certSummaryGrid'>
                    <span><b>{selectedCertificationTarget.certification.summary.proved}</b><small>Provados</small></span>
                    <span><b>{selectedCertificationTarget.certification.summary.partial}</b><small>Parciais</small></span>
                    <span><b>{selectedCertificationTarget.certification.summary.blocked}</b><small>Bloqueados</small></span>
                    <span><b>{selectedCertificationTarget.certification.summary.na}</b><small>N/A justificado</small></span>
                    <span><b>{selectedCertificationTarget.certification.evidenceCount}</b><small>Evidencias</small></span>
                    <span><b>{selectedCertificationTarget.certification.summary.provedControls}/{selectedCertificationTarget.certification.summary.applicableControls}</b><small>Controles provados</small></span>
                  </div>
                  {dashboard.certificationRuns?.find(run => run.targetId === selectedCertificationTarget.id) && (() => {
                    const run = dashboard.certificationRuns!.find(item => item.targetId === selectedCertificationTarget.id)!;
                    return <div className='certRunStrip'><span><b>Última execução</b>{run.status.toUpperCase()}</span><span><b>Release</b>{run.releaseFingerprint}</span><span><b>SHA</b>{run.sourceSha.slice(0, 12)}</span><span><b>Pilares</b>{run.completedPillars}/16</span></div>;
                  })()}
                  {!selectedCertificationTarget.certification.ready && <div className='rootBlocker'><AlertTriangle size={16} /><span><b>Bloqueador raiz</b>{selectedCertificationTarget.certification.rootBlocker}</span></div>}
                </section>
                <section className='pillarGrid'>
                  {selectedCertificationTarget.certification.pillars.map(pillar => (
                    <article className={`pillarCard ${pillar.status}`} key={pillar.id}>
                      <div className='pillarHead'><span className='pillarIndex'>{pillar.id}</span><span className={`pillarStatus ${pillar.status}`}>{certificationStatusLabel(pillar.status)}</span></div>
                      <h3>{pillar.name}</h3><p>{pillar.rationale}</p>
                      <div className='pillarMeta'><span>{pillar.controls} controles</span><span>{pillar.evidence.length} evidencias</span></div>
                      {pillar.blocker && pillar.status !== 'proved' && pillar.status !== 'na' && <div className='pillarBlocker'>{pillar.blocker}</div>}
                      {pillar.evidence.length > 0 && (
                        <div className='pillarEvidence'>
                          {pillar.evidence.slice(0, 3).map((item, index) => <span key={index}><CheckCircle2 size={11} />{item}</span>)}
                        </div>
                      )}
                    </article>
                  ))}
                </section>
              </>}
            </div>
          </section>
          <section className='panel sourcePanel'>
            <div className='panelhead'>
              <div><p className='kicker'>SISTEMAS FONTE · EVIDENCIA OPERACIONAL</p><h2>Telemetria e provas monitoradas</h2></div>
              <div className='actions'>
                <button className='secondary compact' onClick={() => runGovernance('/api/telemetry/refresh')} disabled={busy}><RadioTower size={15} />Telemetria</button>
                <button className='primary compact' onClick={() => runGovernance('/api/audit/run')} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} />Auditoria</button>
              </div>
            </div>
            <p className='productDescription'>Fonte operacional separada da certificacao: evidencias so promovem pilares quando explicitamente vinculadas ao produto e release.</p>
            <div className='systems'>
              {dashboard.systems.map(system => (
                <article className='system' key={system.id}>
                  <div className='systemtop'>
                    <div><h3>{system.name}</h3><p>{system.domain}</p></div>
                    <span className={system.status === 'healthy' ? 'pill ok' : system.status === 'attention' ? 'pill warn' : 'pill neutral'}>{system.status === 'healthy' ? 'Fonte provada' : system.status === 'attention' ? 'Atencao' : 'Integracao'}</span>
                  </div>
                  <div className='scoreline'><div><span>Score operacional</span><strong>{system.score}%</strong></div><div className='bar'><i style={{ width: `${system.score}%` }} /></div></div>
                  <div className='systemmeta'><span>Gate: <b>{system.gate}</b></span><span>CI/CD: <b>{system.ci ?? 'N/D'}</b></span><span>SHA: <b>{system.sha ? system.sha.slice(0, 10) : 'N/D'}</b></span></div>
                  <div className='evidence'>{system.evidence.slice(-4).map((item, index) => <span key={index}><CheckCircle2 size={13} />{item}</span>)}</div>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}

      {formOpen && (
        <div className='modalBackdrop' role='presentation'>
          <section className='modal' role='dialog' aria-modal='true' aria-label={editing ? 'Editar produto' : 'Novo produto'}>
            <div className='modalHead'>
              <div>
                <p className='kicker'>{editing ? 'EDICAO ADMINISTRATIVA' : 'NOVO PRODUTO'}</p>
                <h2>{editing ? editing.name : 'Cadastrar produto'}</h2>
              </div>
              <button className='iconButton' onClick={() => setFormOpen(false)} aria-label='Fechar'><X size={20} /></button>
            </div>

            <div className='formGrid'>
              <label>Nome<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
              <label>Slug<input value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value })} placeholder='meu-produto' /></label>
              <label>Categoria<input value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} /></label>
              <label>Preco (R$)<input value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} placeholder='Ex.: 199,90' inputMode='decimal' /></label>
              <label className='span2'>Descricao<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
              <label className='span2'>Pagina publica<input value={form.publicUrl} onChange={event => setForm({ ...form, publicUrl: event.target.value })} placeholder='https://...' /></label>
              <label className='span2'>Checkout<input value={form.checkoutUrl} onChange={event => setForm({ ...form, checkoutUrl: event.target.value })} placeholder='https://...' /></label>
              <label>Modelo de entrega<input value={form.deliveryModel} onChange={event => setForm({ ...form, deliveryModel: event.target.value })} /></label>
              <label>Status
                <select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as ProductStatus })}>
                  <option value='draft'>Rascunho</option>
                  <option value='validation'>Em validacao</option>
                  <option value='ready'>Pronto</option>
                  <option value='blocked'>Bloqueado</option>
                  <option value='archived'>Arquivado</option>
                </select>
              </label>
              <label className='span2'>Canais, separados por virgula<input value={form.channels} onChange={event => setForm({ ...form, channels: event.target.value })} placeholder='Site, Instagram, WhatsApp' /></label>
              <label className='span2'>Notas administrativas<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
            </div>

            <div className='auditEditor'>
              <div><p className='kicker'>AUDITORIA ZERO-TOLERANCE</p><h3>Notas técnicas de 1 a 10</h3><p>Deixe vazio quando ainda não houver prova reproduzível. A nota geral é calculada automaticamente pela média dos quatro critérios.</p></div>
              <label>Engenharia<input type='number' min='1' max='10' step='0.1' value={form.audit.engineering} onChange={event => setForm({ ...form, audit: { ...form.audit, engineering: event.target.value } })} /></label>
              <label>Infra / Performance<input type='number' min='1' max='10' step='0.1' value={form.audit.infrastructure} onChange={event => setForm({ ...form, audit: { ...form.audit, infrastructure: event.target.value } })} /></label>
              <label>UI / UX<input type='number' min='1' max='10' step='0.1' value={form.audit.ux} onChange={event => setForm({ ...form, audit: { ...form.audit, ux: event.target.value } })} /></label>
              <label>Observabilidade<input type='number' min='1' max='10' step='0.1' value={form.audit.observability} onChange={event => setForm({ ...form, audit: { ...form.audit, observability: event.target.value } })} /></label>
            </div>

            <div className='gateBox'>
              <div><p className='kicker'>GATES COMERCIAIS</p><h3>Venda so pode ser ativada com todos validados</h3></div>
              <label className='check'><input type='checkbox' checked={form.gates.legal} onChange={event => setForm({ ...form, gates: { ...form.gates, legal: event.target.checked } })} />Legal</label>
              <label className='check'><input type='checkbox' checked={form.gates.payment} onChange={event => setForm({ ...form, gates: { ...form.gates, payment: event.target.checked } })} />Pagamento</label>
              <label className='check'><input type='checkbox' checked={form.gates.fulfillment} onChange={event => setForm({ ...form, gates: { ...form.gates, fulfillment: event.target.checked } })} />Entrega</label>
              <label className='check'><input type='checkbox' checked={form.gates.support} onChange={event => setForm({ ...form, gates: { ...form.gates, support: event.target.checked } })} />Suporte</label>
              <label className='saleSwitch'><input type='checkbox' checked={form.salesEnabled} onChange={event => setForm({ ...form, salesEnabled: event.target.checked })} /><span>Venda ativa</span></label>
            </div>

            <div className='modalActions'>
              <button className='secondary' onClick={() => setFormOpen(false)}>Cancelar</button>
              <button className='primary' onClick={saveProduct} disabled={busy}>{busy ? 'Salvando...' : 'Salvar produto'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
