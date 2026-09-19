import { adminPinState, db, error, json, portableHealth, router, secrets, verifyAdminPin } from './platform.ts';

type SystemStatus = 'healthy' | 'attention' | 'integration';
type ProductStatus = 'draft' | 'validation' | 'ready' | 'blocked' | 'archived';

type SystemRecord = {
  name: string;
  domain: string;
  status: SystemStatus;
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

type AuditRecord = {
  system: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  createdAt: string;
};

type ImprovementRecord = {
  system: string;
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  reason: string;
  state: 'proposed' | 'validated' | 'blocked';
};

type IncidentRecord = {
  system: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  createdAt: string;
  state: 'open' | 'watching';
};

type ProductGates = {
  legal: boolean;
  payment: boolean;
  fulfillment: boolean;
  support: boolean;
};

type ProductAudit = {
  engineering: number | null;
  infrastructure: number | null;
  ux: number | null;
  observability: number | null;
  lastAuditedAt: string | null;
};

type CertificationStatus = 'proved' | 'partial' | 'blocked' | 'na' | 'external';
type CertificationProfile = 'AI_AGENTIC_PLATFORM' | 'COMMERCE_CONTROL_PLANE' | 'SAAS_TRANSACTIONAL' | 'DIGITAL_CONTENT';

type CertificationPillar = {
  id: string;
  name: string;
  shortName: string;
  status: CertificationStatus;
  controls: number;
  rationale: string;
  blocker: string | null;
  evidence: string[];
};

type ProductCertification = {
  standard: string;
  version: string;
  profile: CertificationProfile;
  ready: boolean;
  rootBlocker: string | null;
  evidenceCount: number;
  summary: {
    proved: number;
    partial: number;
    blocked: number;
    na: number;
    external: number;
    applicable: number;
    applicableControls: number;
    provedControls: number;
  };
  pillars: CertificationPillar[];
};

type PillarDefinition = { id: string; name: string; shortName: string; controls: number };

type VerifiedEvidence = {
  target: string;
  pillar: string;
  kind: 'supporting' | 'blocking';
  text: string;
  sourceSha: string;
  sourceRef: string;
  capturedAt: string;
};

type CertificationEvidenceRecord = VerifiedEvidence & {
  runId: string;
  releaseFingerprint: string;
  verdict: 'proved' | 'partial' | 'blocked';
  verifier: string;
  environment: string;
  artifacts: string[];
  invalidatedAt: string | null;
  invalidationReason: string | null;
};

type CertificationRunResult = {
  pillar: string;
  status: 'proved' | 'partial' | 'blocked' | 'na';
  message: string;
  checkedAt: string;
};

type CertificationRunRecord = {
  targetId: string;
  targetSlug: string;
  targetName: string;
  status: 'running' | 'complete' | 'failed';
  releaseFingerprint: string;
  sourceSha: string;
  startedAt: string;
  finishedAt: string | null;
  currentPillar: string | null;
  completedPillars: number;
  results: CertificationRunResult[];
  failureReason: string | null;
};

type ProductRecord = {
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
  gates: ProductGates;
  audit: ProductAudit;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type TelemetryCheck = {
  name: string;
  status: string | null;
  conclusion: string | null;
  url: string | null;
};

type TelemetryRepo = {
  label: string;
  source: string;
  ok: boolean;
  sha?: string;
  combined_state?: string;
  runs?: Array<{ name: string; status: string; conclusion: string | null }>;
  external_ci?: TelemetryCheck[];
  e2e?: TelemetryCheck[];
  recovery?: TelemetryCheck[];
  error?: string;
};

type TelemetryProduction = {
  label: string;
  status: number;
  ok: boolean;
  latency_ms: number;
};

type PrivateTelemetry = {
  schema: string;
  generated_at: string;
  repositories: TelemetryRepo[];
  production: TelemetryProduction[];
};

type TelemetrySnapshot = {
  telemetry: PrivateTelemetry;
  capturedAt: string;
};

type TelemetryFetchResult = {
  telemetry: PrivateTelemetry | null;
  stale: boolean;
  source: 'live' | 'last-proven' | 'unavailable';
  attempts: number;
};

const SYSTEMS = 'acs_systems';
const AUDITS = 'acs_audits';
const IMPROVEMENTS = 'acs_improvements';
const ENGINE = 'acs_engine';
const INCIDENTS = 'acs_incidents';
const TELEMETRY_SNAPSHOTS = 'acs_telemetry_snapshots';
const CERTIFICATION_RUNS = 'zees_certification_runs';
const CERTIFICATION_EVIDENCE = 'zees_certification_evidence';
const PRIVATE_TELEMETRY_URL = 'https://arbm-control.zevanory.workers.dev/telemetry/v1';
const TELEMETRY_RETRY_DELAYS_MS = [0, 250, 750, 1500];
const ZEES_VERSION = 'ZEES-16/2026.09';
const ZEES_PILLARS: PillarDefinition[] = [
  { id: 'P01', name: 'Produto & Arquitetura', shortName: 'Produto / Arquitetura', controls: 16 },
  { id: 'P02', name: 'UI/UX & Design System', shortName: 'UI / UX', controls: 15 },
  { id: 'P03', name: 'Tipografia, Cores & Geometria', shortName: 'Visual / Geometria', controls: 15 },
  { id: 'P04', name: 'Acessibilidade', shortName: 'Acessibilidade', controls: 14 },
  { id: 'P05', name: 'Engenharia de Codigo', shortName: 'Codigo', controls: 18 },
  { id: 'P06', name: 'Testes & Regressao', shortName: 'Testes', controls: 18 },
  { id: 'P07', name: 'Seguranca de Aplicacao', shortName: 'Cybersecurity', controls: 17 },
  { id: 'P08', name: 'Supply Chain & Dependencias', shortName: 'Supply Chain', controls: 14 },
  { id: 'P09', name: 'Privacidade & Compliance', shortName: 'Privacidade', controls: 16 },
  { id: 'P10', name: 'Infraestrutura & Disaster Recovery', shortName: 'Infra / DR', controls: 18 },
  { id: 'P11', name: 'Performance & Escalabilidade', shortName: 'Performance', controls: 15 },
  { id: 'P12', name: 'Observabilidade & Operacao', shortName: 'Observabilidade', controls: 14 },
  { id: 'P13', name: 'Dados & Governanca de Dados', shortName: 'Dados', controls: 12 },
  { id: 'P14', name: 'IA, LLMOps & Agentes', shortName: 'IA / LLMOps', controls: 18 },
  { id: 'P15', name: 'CI/CD, Release & Proveniencia', shortName: 'CI/CD / Proveniencia', controls: 14 },
  { id: 'P16', name: 'Comercial, Entrega & Ciclo de Vida', shortName: 'Comercial / Lifecycle', controls: 13 },
];

const VERIFIED_EVIDENCE: VerifiedEvidence[] = [
  {
    target: 'arbm-one-system',
    pillar: 'P12',
    kind: 'supporting',
    text: 'Producao ARBM ONE respondeu HTTP 200 em https://arbmone.api.br/ no probe controlado.',
    sourceSha: '5352ef94de7dac6f62b0010b64a8f33361aef67e',
    sourceRef: 'ARBM CONTROL 1.3.0 production_probe · 2026-09-19',
    capturedAt: '2026-09-19T14:46:00Z',
  },
  {
    target: 'arbm-one-system',
    pillar: 'P15',
    kind: 'blocking',
    text: 'SHA atual com combined_state=failure: Buildkite failure, CircleCI backup/core failures e Workers Build failure. Proveniencia/release nao pode ser promovida.',
    sourceSha: '5352ef94de7dac6f62b0010b64a8f33361aef67e',
    sourceRef: 'ARBM CONTROL 1.3.0 github_commit_status',
    capturedAt: '2026-09-19T14:46:00Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P10',
    kind: 'supporting',
    text: 'ARBM Sovereign Continuity concluiu SUCCESS no SHA exato do master, incluindo checkout do control plane, runner universal, OIDC e missao segura.',
    sourceSha: 'cf008c04e9bf01e87fca80799dfc25b1de68d888',
    sourceRef: 'GitHub Actions run 35440641357 · job 105890702943',
    capturedAt: '2026-09-19T11:38:09Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P15',
    kind: 'supporting',
    text: 'Master no SHA cf008c04... possui sovereign-continuity SUCCESS repetido; combined_state ainda esta pending, portanto a cadeia de release permanece parcial.',
    sourceSha: 'cf008c04e9bf01e87fca80799dfc25b1de68d888',
    sourceRef: 'ARBM CONTROL 1.3.0 github_commit_status · run 35440641357',
    capturedAt: '2026-09-19T14:46:00Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P01',
    kind: 'supporting',
    text: 'Pagina publica oficial do ARBM SIST respondeu HTTP 200 e declara automacao/IA com governanca, independência de provedor, rastreabilidade e rollback.',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'ARBM CONTROL 1.3.0 production_probe · https://zevanory.api.br/arbm-sist',
    capturedAt: '2026-09-19T14:47:00Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P12',
    kind: 'supporting',
    text: 'Superficie publica do ARBM SIST respondeu HTTP 200 no dominio oficial ZEVANORY.',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'ARBM CONTROL 1.3.0 production_probe · /arbm-sist',
    capturedAt: '2026-09-19T14:47:00Z',
  },
  {
    target: 'zevanory',
    pillar: 'P12',
    kind: 'supporting',
    text: 'ZEVANORY respondeu HTTP 200 no dominio oficial.',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'ARBM CONTROL 1.3.0 production_probe · https://zevanory.api.br/',
    capturedAt: '2026-09-19T14:46:00Z',
  },
  {
    target: 'zevanory',
    pillar: 'P15',
    kind: 'supporting',
    text: 'GitHub Pages build, deploy e report-build-status concluiram SUCCESS no SHA exato f0db89c4....',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'GitHub Actions run 35442782458 · checks 105896405017/105896456675/105896456698',
    capturedAt: '2026-09-19T12:23:00Z',
  },
  {
    target: 'zevanory',
    pillar: 'P01',
    kind: 'supporting',
    text: 'Portfolio oficial em producao respondeu HTTP 200 e publica o catalogo ZEVANORY.',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'ARBM CONTROL 1.3.0 production_probe · https://zevanory.api.br/',
    capturedAt: '2026-09-19T14:46:00Z',
  },
  ...[
    ['zevanory-one', '/zevanory-one'],
    ['ia-na-pratica', '/ia-na-pratica'],
    ['vendas-na-pratica', '/vendas-na-pratica'],
    ['combo-ia-vendas', '/combo-ia-vendas'],
    ['lucro-e-caixa', '/lucro-e-caixa'],
    ['negocio-completo', '/negocio-completo'],
  ].flatMap(([target, path]) => [
    {
      target,
      pillar: 'P01',
      kind: 'supporting' as const,
      text: `Pagina publica ${path} respondeu HTTP 200 no dominio oficial ZEVANORY.`,
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: `ARBM CONTROL 1.3.0 production_probe · https://zevanory.api.br${path}`,
      capturedAt: '2026-09-19T14:47:00Z',
    },
    {
      target,
      pillar: 'P12',
      kind: 'supporting' as const,
      text: `Disponibilidade da pagina ${path} comprovada por resposta HTTP 200.`,
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: `ARBM CONTROL 1.3.0 production_probe · https://zevanory.api.br${path}`,
      capturedAt: '2026-09-19T14:47:00Z',
    },
    {
      target,
      pillar: 'P15',
      kind: 'supporting' as const,
      text: 'Pagina publicada pelo mesmo SHA ZEVANORY cujo build e deploy GitHub Pages concluiram SUCCESS.',
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: 'GitHub Actions run 35442782458',
      capturedAt: '2026-09-19T12:23:00Z',
    },
  ]),
  {
    target: 'arbm-one-system',
    pillar: 'P05',
    kind: 'supporting',
    text: 'Candidato PR408 executou ci:portable:core com SUCCESS em runner remoto zero-spend; evidencia de candidato, nao de producao/main.',
    sourceSha: 'cb1634a1117d198a65bd677c75fbd959a8d11089',
    sourceRef: 'GitHub Actions run 35450150277 · exact-proof · workflow TARGET_SHA',
    capturedAt: '2026-09-19T14:54:59Z',
  },
  {
    target: 'arbm-one-system',
    pillar: 'P06',
    kind: 'supporting',
    text: 'Candidato PR408 executou contrato visual global 12P com SUCCESS no SHA exato cb1634a1...; nao substitui regressao do main/producao.',
    sourceSha: 'cb1634a1117d198a65bd677c75fbd959a8d11089',
    sourceRef: 'GitHub Actions run 35450150277 · step Run global 12P contract',
    capturedAt: '2026-09-19T14:54:59Z',
  },
  {
    target: 'arbm-one-system',
    pillar: 'P15',
    kind: 'supporting',
    text: 'Run remoto comprovou checkout do SHA exato candidato cb1634a1... e gates provider/12P verdes, mas o main 5352ef94... continua com CI falho.',
    sourceSha: 'cb1634a1117d198a65bd677c75fbd959a8d11089',
    sourceRef: 'GitHub Actions run 35450150277',
    capturedAt: '2026-09-19T14:54:59Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P05',
    kind: 'supporting',
    text: 'Run focal 091 candidato concluiu proof-tests SUCCESS, incluindo escopo exato, guards negativos, banca 50x10 e council 100-lane.',
    sourceSha: 'e6a164a959b2e561d653d54601931af692580d16',
    sourceRef: 'GitHub Actions run 35449699496 · job proof-tests 105914601346',
    capturedAt: '2026-09-19T14:45:37Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P06',
    kind: 'supporting',
    text: 'Run focal 091 candidato concluiu policy, proof-tests e replay com SUCCESS; replay cobriu regressoes historicas e evidencias fixadas.',
    sourceSha: 'e6a164a959b2e561d653d54601931af692580d16',
    sourceRef: 'GitHub Actions run 35449699496 · jobs policy/proof-tests/replay',
    capturedAt: '2026-09-19T14:48:34Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P14',
    kind: 'supporting',
    text: 'ZERO_SPEND HARD, KVM, release/task 091 fixados, VM oficial, VLM local e replays passaram; no momento da captura a execucao oficial focal-091 ainda estava em progresso, portanto sem fechamento.',
    sourceSha: 'e6a164a959b2e561d653d54601931af692580d16',
    sourceRef: 'GitHub Actions run 35449699496 · focal-091 job 105915022088',
    capturedAt: '2026-09-19T14:55:00Z',
  },
  {
    target: 'arbm-sist',
    pillar: 'P10',
    kind: 'supporting',
    text: 'Nova repeticao independente de Sovereign Continuity concluiu SUCCESS no master, validando runner universal, OIDC e missao segura.',
    sourceSha: 'cf008c04e9bf01e87fca80799dfc25b1de68d888',
    sourceRef: 'GitHub Actions run 35449974036 · job 105915310751',
    capturedAt: '2026-09-19T14:50:55Z',
  },
  {
    target: 'zevanory',
    pillar: 'P02',
    kind: 'supporting',
    text: 'Static audit fail-closed passou no PR exato; product.css exige focus, reduced-motion, media queries e estrutura consistente. Blobs auditados sao identicos aos do SHA de producao f0db89c4....',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'Run 35442508701 + blob parity 60c55f46... -> f0db89c4...',
    capturedAt: '2026-09-19T14:56:00Z',
  },
  {
    target: 'zevanory',
    pillar: 'P04',
    kind: 'supporting',
    text: 'Static audit comprovou requisitos estruturais de acessibilidade (focus e prefers-reduced-motion) nos mesmos blobs em producao; ainda nao equivale a WCAG integral.',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'Run 35442508701 · premerge_product_audit.py · blob parity',
    capturedAt: '2026-09-19T14:56:00Z',
  },
  {
    target: 'zevanory',
    pillar: 'P11',
    kind: 'supporting',
    text: 'Static audit aprovou content-visibility e proibicao de JS cliente externo no primeiro render para paginas auditadas, com paridade de blobs em producao.',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'Run 35442508701 · static-audit · blob parity',
    capturedAt: '2026-09-19T14:56:00Z',
  },
  {
    target: 'zevanory',
    pillar: 'P16',
    kind: 'supporting',
    text: 'Gate fail-closed confirmou VENDA OFF sem links de checkout/payment nas paginas auditadas; isso prova bloqueio comercial, nao ciclo de venda completo.',
    sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
    sourceRef: 'Run 35442508701 · premerge product audit',
    capturedAt: '2026-09-19T14:56:00Z',
  },
  ...[
    ['zevanory-one', '86dfeb01fac627de4358e8b7f840e1b89e54e24c'],
    ['arbm-sist', '95a19235a0ba77830a83f0e2b47f406502eb57e3'],
    ['ia-na-pratica', '7c5b9dac20fc1ff0421e64f52ab7b6d2689d2d22'],
    ['vendas-na-pratica', '2a6b9be0bd12a2ffbd9e7a4a8e9941829eab30d3'],
    ['lucro-e-caixa', '427e208349bd280128413af2f16e31bca1cb9a43'],
    ['combo-ia-vendas', '2d0c53565af6eef646439b1c4f505a331c842705'],
    ['negocio-completo', 'd4fb45a28616cf714c1f33b93bf39bfcacfbfce3'],
  ].flatMap(([target, blob]) => [
    {
      target,
      pillar: 'P02',
      kind: 'supporting' as const,
      text: `Static audit da pagina e CSS passou; blob da pagina ${blob.slice(0,12)} e identico entre PR auditado e producao.`,
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: 'Run 35442508701 · exact PR audit + production blob parity',
      capturedAt: '2026-09-19T14:56:00Z',
    },
    {
      target,
      pillar: 'P04',
      kind: 'supporting' as const,
      text: 'CSS de producao preserva focus e prefers-reduced-motion e a pagina auditada passou estrutura estatica; WCAG integral ainda nao comprovado.',
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: 'Run 35442508701 · product.css blob 0f228a57d0e7...',
      capturedAt: '2026-09-19T14:56:00Z',
    },
    {
      target,
      pillar: 'P11',
      kind: 'supporting' as const,
      text: 'Pagina auditada nao carrega JS cliente externo no primeiro render e usa CSS com content-visibility; paridade de blob com producao confirmada.',
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: 'Run 35442508701 · static audit + production blob parity',
      capturedAt: '2026-09-19T14:56:00Z',
    },
    {
      target,
      pillar: 'P16',
      kind: 'supporting' as const,
      text: 'Gate estatico confirmou VENDA OFF sem checkout/payment na pagina auditada; prova de bloqueio comercial apenas.',
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: 'Run 35442508701 · fail-closed product audit',
      capturedAt: '2026-09-19T14:56:00Z',
    },
    {
      target,
      pillar: 'P15',
      kind: 'supporting' as const,
      text: `Blob ${blob.slice(0,12)} da pagina e identico no PR auditado e no SHA de producao; build/deploy do f0db89c4... tambem concluiu SUCCESS.`,
      sourceSha: 'f0db89c4830d8e502e7b224a3c790ccab940d1ae',
      sourceRef: 'Runs 35442508701 + 35442782458',
      capturedAt: '2026-09-19T14:56:00Z',
    },
  ]),
];

const systemSeed: SystemRecord[] = [
  { name: 'ARBM ONE', domain: 'https://arbmone.api.br/', status: 'attention', score: 88, lastAudit: new Date().toISOString(), gate: 'E2E + CI em observacao', evidence: ['Producao monitorada', 'Repositorio privado via telemetria interna'], source: 'telemetria privada interna', ci: 'aguardando feed privado' },
  { name: 'ARBM SIST', domain: 'cloud execution', status: 'attention', score: 84, lastAudit: new Date().toISOString(), gate: 'OSWorld focal em validacao', evidence: ['ZERO_SPEND', 'Sovereign continuity'], source: 'telemetria privada interna', ci: 'aguardando feed privado' },
  { name: 'ZEVANORY', domain: 'https://zevanory.api.br/', status: 'attention', score: 94, lastAudit: new Date().toISOString(), gate: 'Vendas OFF ate gates simultaneos', evidence: ['Gate comercial preservado', 'Producao monitorada'], source: 'telemetria privada interna', ci: 'aguardando feed privado' },
  { name: 'Canais auxiliares', domain: 'TikTok / LinkedIn / Nuvemshop', status: 'integration', score: 40, lastAudit: new Date().toISOString(), gate: 'Standby operacional', evidence: ['Nao contam no fechamento total'], source: 'manual governance', ci: 'standby' },
];

const deprecatedVisibleSystems = new Set(['ARBM CONTROL', 'ARBM CONTROL App']);

const productCatalog = [
  {
    name: 'ZEVANORY',
    slug: 'zevanory',
    category: 'Plataforma / Ecossistema',
    description: 'Plataforma central da operacao comercial, distribuicao, conteudo, checkout e governanca dos produtos ZEVANORY.',
    publicUrl: 'https://zevanory.api.br/',
    deliveryModel: 'Ecossistema comercial e operacional',
  },
  {
    name: 'ARBM SIST',
    slug: 'arbm-sist',
    category: 'Software e automacao',
    description: 'Agente de desenvolvimento e automacao com IA, governanca e independencia de provedor.',
    publicUrl: 'https://zevanory.api.br/arbm-sist',
    deliveryModel: 'Software / licenca digital',
  },
  {
    name: 'ZEVANORY IA na Pratica',
    slug: 'ia-na-pratica',
    category: 'Conteudo digital',
    description: 'Conteudo pratico para transformar IA em processos claros, repetiveis e uteis.',
    publicUrl: 'https://zevanory.api.br/ia-na-pratica',
    deliveryModel: 'Conteudo digital',
  },
  {
    name: 'ZEVANORY Vendas na Pratica',
    slug: 'vendas-na-pratica',
    category: 'Conteudo digital',
    description: 'Metodo pratico para prospeccao, atendimento, oferta, follow-up e melhoria comercial.',
    publicUrl: 'https://zevanory.api.br/vendas-na-pratica',
    deliveryModel: 'Conteudo digital',
  },
  {
    name: 'ZEVANORY Combo IA + Vendas',
    slug: 'combo-ia-vendas',
    category: 'Combo digital',
    description: 'Combinacao dos metodos de IA e vendas para acelerar a execucao comercial.',
    publicUrl: 'https://zevanory.api.br/combo-ia-vendas',
    deliveryModel: 'Combo digital',
  },
  {
    name: 'ZEVANORY Lucro & Caixa',
    slug: 'lucro-e-caixa',
    category: 'Conteudo digital',
    description: 'Material pratico para acompanhar entradas, saidas, margem e caixa.',
    publicUrl: 'https://zevanory.api.br/lucro-e-caixa',
    deliveryModel: 'Conteudo digital',
  },
  {
    name: 'ZEVANORY Negocio Completo',
    slug: 'negocio-completo',
    category: 'Pacote digital',
    description: 'Pacote integrado de IA, vendas e gestao financeira.',
    publicUrl: 'https://zevanory.api.br/negocio-completo',
    deliveryModel: 'Pacote digital',
  },
  {
    name: 'ZEVANORY ONE',
    slug: 'zevanory-one',
    category: 'Software comercial',
    description: 'Plataforma comercial universal da ZEVANORY, com provisionamento isolado por cliente, onboarding e configuracao propria.',
    publicUrl: 'https://zevanory.api.br/zevanory-one',
    deliveryModel: 'Licenca e instalacao global por cliente',
  },
];

function productTable() {
  return 'acs_products_admin';
}

function commercialBlockers(product: ProductRecord) {
  const blockers: string[] = [];
  if (product.status !== 'ready') blockers.push('status precisa estar PRONTO');
  if (product.priceCents === null || product.priceCents < 0) blockers.push('preco precisa estar definido');
  if (!product.checkoutUrl.trim()) blockers.push('checkout precisa estar definido');
  if (!product.gates.legal) blockers.push('gate legal pendente');
  if (!product.gates.payment) blockers.push('gate de pagamento pendente');
  if (!product.gates.fulfillment) blockers.push('gate de entrega pendente');
  if (!product.gates.support) blockers.push('gate de suporte pendente');
  return blockers;
}

function cleanProductAudit(audit?: Partial<ProductAudit>): ProductAudit {
  const clean = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 10 ? Math.round(numeric * 10) / 10 : null;
  };
  return {
    engineering: clean(audit?.engineering),
    infrastructure: clean(audit?.infrastructure),
    ux: clean(audit?.ux),
    observability: clean(audit?.observability),
    lastAuditedAt: audit?.lastAuditedAt ? String(audit.lastAuditedAt) : null,
  };
}

function auditOverall(audit: ProductAudit) {
  const values = [audit.engineering, audit.infrastructure, audit.ux, audit.observability];
  if (values.some(value => value === null)) return null;
  const numeric = values as number[];
  return Math.round((numeric.reduce((sum, value) => sum + value, 0) / numeric.length) * 10) / 10;
}

function enrichProduct(product: ProductRecord & { id: string }) {
  const blockers = commercialBlockers(product);
  const audit = cleanProductAudit(product.audit);
  const overall = auditOverall(audit);
  return {
    ...product,
    audit,
    auditOverall: overall,
    auditStatus: overall === null ? 'pending' : 'audited',
    commercialReady: blockers.length === 0,
    blockers,
  };
}

function certificationProfile(product: ProductRecord): CertificationProfile {
  if (product.slug === 'arbm-sist') return 'AI_AGENTIC_PLATFORM';
  if (product.slug === 'zevanory') return 'COMMERCE_CONTROL_PLANE';
  if (product.slug === 'zevanory-one' || product.slug === 'arbm-one-system') return 'SAAS_TRANSACTIONAL';
  return 'DIGITAL_CONTENT';
}

function certificationSystem(product: ProductRecord, systems: Array<SystemRecord & { id?: string }>) {
  const systemName = product.slug === 'arbm-sist'
    ? 'ARBM SIST'
    : product.slug === 'zevanory'
      ? 'ZEVANORY'
      : product.slug === 'arbm-one-system'
        ? 'ARBM ONE'
        : null;
  return systemName ? systems.find(item => item.name === systemName) : undefined;
}

function hashFingerprint(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function certificationReleaseFingerprint(product: ProductRecord, sourceSystem?: SystemRecord & { id?: string }) {
  const critical = JSON.stringify({
    slug: product.slug,
    updatedAt: product.updatedAt,
    publicUrl: product.publicUrl,
    checkoutUrl: product.checkoutUrl,
    deliveryModel: product.deliveryModel,
    channels: [...product.channels].sort(),
    gates: product.gates,
    status: product.status,
    sourceSha: sourceSystem?.sha || '',
    sourceCi: sourceSystem?.ci || '',
    sourceDomain: sourceSystem?.domain || '',
  });
  return `zeesrfp_${hashFingerprint(critical)}`;
}

function formatVerifiedEvidence(item: VerifiedEvidence) {
  return `${item.text} [${item.sourceRef} · SHA ${item.sourceSha.slice(0, 12)} · ${item.capturedAt}]`;
}

function verifiedEvidence(
  target: string,
  pillar: string,
  kind: VerifiedEvidence['kind'] | undefined,
  runtimeEvidence: CertificationEvidenceRecord[],
  releaseFingerprint: string,
  sourceSha: string,
) {
  const staticItems = VERIFIED_EVIDENCE.filter(item =>
    item.target === target &&
    item.pillar === pillar &&
    (!kind || item.kind === kind) &&
    (!sourceSha || item.sourceSha === sourceSha)
  );
  const runtimeItems = runtimeEvidence.filter(item =>
    item.target === target &&
    item.pillar === pillar &&
    (!kind || item.kind === kind) &&
    !item.invalidatedAt &&
    item.releaseFingerprint === releaseFingerprint
  );
  return [...staticItems, ...runtimeItems].map(formatVerifiedEvidence);
}

function buildProductCertification(
  product: ProductRecord,
  systems: Array<SystemRecord & { id?: string }>,
  runtimeEvidence: CertificationEvidenceRecord[] = [],
): ProductCertification {
  const profile = certificationProfile(product);
  const sourceSystem = certificationSystem(product, systems);
  const releaseFingerprint = certificationReleaseFingerprint(product, sourceSystem);
  const sourceSha = sourceSystem?.sha || '';
  const sourceEvidence = sourceSystem?.evidence ?? [];
  const exactLive = Boolean(sourceSystem && sourceSystem.status === 'healthy' && sourceSystem.sha && sourceSystem.ci && !sourceSystem.ci.includes('STALE'));
  const commercial = commercialBlockers(product);
  const ev = (pattern: RegExp) => sourceEvidence.filter(item => pattern.test(item));
  const snapshot = (pillar: string, kind?: VerifiedEvidence['kind']) => verifiedEvidence(product.slug, pillar, kind, runtimeEvidence, releaseFingerprint, sourceSha);
  const e2e = ev(/E2E:|regress/i);
  const recovery = ev(/Recovery:|restore|backup/i);
  const security = ev(/security|sast|dast|owasp|vulnerab/i);
  const supply = ev(/sbom|dependabot|sca|supply/i);
  const ci = ev(/CI externo:|GitHub Actions:/i);
  const production = ev(/Producao HTTP|availability|latency|runtime/i);

  const pillars = ZEES_PILLARS.map<CertificationPillar>(d => {
    const explicit = sourceEvidence.filter(item => item.startsWith(`ZEES:${d.id}:PROVEN:`));
    const runtimeProven = runtimeEvidence.filter(item =>
      item.target === product.slug &&
      item.pillar === d.id &&
      item.verdict === 'proved' &&
      item.kind === 'supporting' &&
      !item.invalidatedAt &&
      item.releaseFingerprint === releaseFingerprint
    );
    const snapshotSupporting = snapshot(d.id, 'supporting');
    const snapshotBlocking = snapshot(d.id, 'blocking');
    if ((explicit.length > 0 && exactLive || runtimeProven.length > 0) && snapshotBlocking.length === 0) {
      return { ...d, status: 'proved', rationale: 'Prova ZEES explícita e reproduzível vinculada à release congelada.', blocker: null, evidence: [...explicit, ...snapshotSupporting] };
    }
    const partial = (rationale: string, blocker: string, evidence: string[] = []): CertificationPillar => ({ ...d, status: 'partial', rationale, blocker, evidence });
    const blocked = (rationale: string, blocker: string, evidence: string[] = []): CertificationPillar => ({ ...d, status: 'blocked', rationale, blocker, evidence });
    switch (d.id) {
      case 'P01': return product.description && product.deliveryModel && product.publicUrl
        ? partial('Arquitetura administrativa e superficie publica possuem evidencia parcial; configuracao/publicacao nao provam o pilar integral.', 'Falta contrato arquitetural reproduzivel e evidencia integral de conformidade.', snapshotSupporting)
        : blocked('Cadastro arquitetural incompleto.', 'Descricao, entrega ou superficie publica incompleta.', snapshotSupporting);
      case 'P02': return product.audit.ux !== null || snapshotSupporting.length
        ? partial('Ha evidencia estrutural de UI/UX/Design System, mas ela ainda nao comprova qualidade visual integral nem regressao completa.', 'Falta regressao visual e Design System integral vinculados a release.', snapshotSupporting)
        : blocked('Sem evidencia UI/UX vinculada a release.', 'Executar auditoria visual reproduzivel.', snapshotSupporting);
      case 'P03': return product.audit.ux !== null ? partial('Ha referencia visual administrativa, sem prova matematica completa.', 'Falta validacao de tokens, grid, contraste e geometria.') : blocked('Sem prova visual estruturada.', 'Tipografia, cores, espacamentos e geometria precisam de evidencia.');
      case 'P04': {
        const x = ev(/wcag|axe|accessib|lighthouse/i);
        return x.length || snapshotSupporting.length
          ? partial('Evidencia estrutural de acessibilidade encontrada; ainda nao equivale a conformidade WCAG integral.', 'Vincular prova WCAG 2.2 aplicavel ao SHA/release.', [...x, ...snapshotSupporting])
          : blocked('Nenhuma prova reproduzivel de acessibilidade vinculada.', 'WCAG 2.2 aplicavel precisa ser auditada.', snapshotSupporting);
      }
      case 'P05': return product.audit.engineering !== null || ci.length || snapshotSupporting.length
        ? partial('Existem provas de engenharia/CI, mas nao fecham arquitetura e qualidade integral.', 'Falta bundle completo de arquitetura, lint, metricas e revisao.', [...ci, ...snapshotSupporting])
        : blocked('Sem bundle tecnico de codigo.', 'Arquitetura, lint, metricas e documentacao sem prova.', snapshotSupporting);
      case 'P06': return e2e.length || snapshotSupporting.length
        ? partial('Ha evidencia real de testes/regressao, mas o pilar exige cobertura combinada e vinculacao ao release certificado.', 'Falta consolidar unidade, integracao, E2E, regressao visual e demais testes aplicaveis.', [...e2e, ...snapshotSupporting])
        : blocked('Nenhuma evidencia de testes vinculada.', 'Suite de testes e regressao precisa ser comprovada.', snapshotSupporting);
      case 'P07': return security.length ? partial('Evidencia de seguranca encontrada, sem atestacao ZEES completa.', 'Falta threat model, SAST/DAST/SCA e fechamento de vulnerabilidades.', security) : blocked('Seguranca sem evidencia especifica suficiente.', 'Vincular threat model, SAST, DAST, SCA e OWASP/ASVS.');
      case 'P08': return supply.length ? partial('Ha evidencia de dependencias/supply chain.', 'Falta SBOM e proveniencia verificavel.', supply) : blocked('Supply chain sem prova vinculada.', 'SBOM, SCA, pinagem e proveniencia precisam ser comprovados.');
      case 'P09': return product.gates.legal ? partial('Gate legal interno marcado; configuracao nao substitui evidencia juridica.', 'Falta evidencia LGPD/privacy-by-design.') : blocked('Gate legal ainda nao validado.', 'Privacidade, LGPD e requisitos legais pendentes.');
      case 'P10': return product.audit.infrastructure !== null || recovery.length || snapshotSupporting.length
        ? partial('Infraestrutura/recuperacao possui prova parcial rastreavel.', 'Falta fechar RTO/RPO, restore, failover e continuidade integral.', [...recovery, ...snapshotSupporting])
        : blocked('Infraestrutura e recuperacao sem prova suficiente.', 'DR, backup, restore e continuidade precisam de evidencia.', snapshotSupporting);
      case 'P11': return product.audit.infrastructure !== null || production.length || snapshotSupporting.length
        ? partial('Ha sinais de runtime/disponibilidade, mas isso nao equivale a prova completa de performance e escalabilidade.', 'Falta consolidar percentis, Core Web Vitals/RUM e carga conforme perfil.', [...production, ...snapshotSupporting])
        : blocked('Performance e escalabilidade sem prova.', 'Orcamentos e testes de carga precisam ser vinculados.', snapshotSupporting);
      case 'P12': return (sourceSystem && (product.audit.observability !== null || sourceEvidence.length > 0)) || snapshotSupporting.length
        ? partial('Existe evidencia operacional real e rastreavel, ainda insuficiente para fechar observabilidade integral.', 'Falta fechar metricas, logs, traces, SLOs e resposta a incidentes.', [...production, ...snapshotSupporting])
        : blocked('Observabilidade sem evidencia suficiente.', 'Metricas, logs, tracing e SLOs precisam de prova.', snapshotSupporting);
      case 'P13': return blocked('Governanca de dados sem evidencia dedicada.', 'Schema, qualidade, linhagem, retencao e controles precisam ser comprovados.');
      case 'P14':
        if (profile !== 'AI_AGENTIC_PLATFORM' && profile !== 'COMMERCE_CONTROL_PLANE') return { ...d, status: 'na', rationale: 'Perfil nao declara runtime de IA/agentes como parte da release certificada.', blocker: null, evidence: [] };
        return sourceEvidence.length || snapshotSupporting.length
          ? partial('Perfil de IA possui evidencias reais de execucao/LLMOps, mas a avaliacao integral ainda nao fechou.', 'Falta fechar avaliacao oficial, guardrails, prompt injection, drift e failover no release certificado.', [...sourceEvidence.slice(-4), ...snapshotSupporting])
          : blocked('Perfil de IA sem evidencia operacional vinculada.', 'LLMOps, guardrails e avaliacao precisam ser comprovados.', snapshotSupporting);
      case 'P15':
        if (snapshotBlocking.length > 0) return blocked('A cadeia de release possui falha atual comprovada e permanece fail-closed.', 'Resolver os checks falhos no SHA corrente antes de qualquer promocao.', [...ci, ...snapshotSupporting, ...snapshotBlocking]);
        return sourceSystem?.sha && ci.length || snapshotSupporting.length
          ? partial('SHA/build/deploy possuem evidencia rastreavel, sem proveniencia integral fechada.', 'Vincular build, deploy, artefato e proveniencia ao mesmo SHA com todos os gates verdes.', [...ci, ...snapshotSupporting])
          : blocked('Release e proveniencia sem cadeia suficiente.', 'SHA, build, CI/CD, deploy e proveniencia precisam ser reconciliados.', snapshotSupporting);
      case 'P16': return commercial.length === 0
        ? partial('Configuracao comercial e/ou bloqueios fail-closed possuem evidencia, mas ainda nao provam ciclo real.', 'Executar checkout, pagamento, fulfillment, onboarding, suporte e reembolso.', snapshotSupporting)
        : blocked('Gate comercial permanece fail-closed.', commercial[0] || 'Pendencia comercial.', snapshotSupporting);
      default: return blocked('Pilar sem avaliacao.', 'Evidencia obrigatoria ausente.');
    }
  });
  const summary = {
    proved: pillars.filter(x => x.status === 'proved').length,
    partial: pillars.filter(x => x.status === 'partial').length,
    blocked: pillars.filter(x => x.status === 'blocked').length,
    na: pillars.filter(x => x.status === 'na').length,
    external: pillars.filter(x => x.status === 'external').length,
    applicable: pillars.filter(x => x.status !== 'na').length,
    applicableControls: pillars.filter(x => x.status !== 'na').reduce((sum, x) => sum + x.controls, 0),
    provedControls: pillars.filter(x => x.status === 'proved').reduce((sum, x) => sum + x.controls, 0),
  };
  const firstBlocking = pillars.find(x => x.status === 'blocked') ?? pillars.find(x => x.status === 'partial') ?? pillars.find(x => x.status === 'external');
  const ready = summary.blocked === 0 && summary.partial === 0 && summary.external === 0 && summary.proved === summary.applicable;
  return { standard: 'ZEVANORY ENGINEERING EXCELLENCE STANDARD', version: ZEES_VERSION, profile, ready, rootBlocker: firstBlocking ? `${firstBlocking.id} - ${firstBlocking.blocker || firstBlocking.rationale}` : null, evidenceCount: new Set(pillars.flatMap(x => x.evidence)).size, summary, pillars };
}

async function invalidateObsoleteCertificationEvidence(targetSlug: string, releaseFingerprint: string) {
  const evidence = await db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 });
  const now = new Date().toISOString();
  const updates = evidence.items
    .filter(item => item.target === targetSlug && !item.invalidatedAt && item.releaseFingerprint !== releaseFingerprint)
    .map(item => ({
      id: item.id,
      record: { ...item, invalidatedAt: now, invalidationReason: 'release_fingerprint_changed' },
    }));
  if (updates.length) await db.update(CERTIFICATION_EVIDENCE, updates);
  return updates.length;
}

async function invalidatePriorRunEvidence(targetSlug: string, releaseFingerprint: string) {
  const evidence = await db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 });
  const now = new Date().toISOString();
  const updates = evidence.items
    .filter(item => item.target === targetSlug && !item.invalidatedAt && item.releaseFingerprint === releaseFingerprint && item.runId)
    .map(item => ({
      id: item.id,
      record: { ...item, invalidatedAt: now, invalidationReason: 'superseded_by_new_run' },
    }));
  if (updates.length) await db.update(CERTIFICATION_EVIDENCE, updates);
  return updates.length;
}

function verifierArtifacts(pillar: CertificationPillar, product: ProductRecord, sourceSystem?: SystemRecord & { id?: string }) {
  return Array.from(new Set([
    product.publicUrl,
    product.checkoutUrl,
    sourceSystem?.domain || '',
    sourceSystem?.sha ? `sha:${sourceSystem.sha}` : '',
    ...pillar.evidence,
  ].filter(Boolean))).slice(0, 12);
}

async function runCertificationExecutor(targetId: string) {
  await ensureSeed();
  await ensureProducts();
  await refreshTelemetry();
  const [systems, products] = await Promise.all([
    db.list<SystemRecord>(SYSTEMS, { limit: 50 }),
    db.list<ProductRecord>(productTable(), { limit: 100 }),
  ]);
  const visibleSystems = systems.items.filter(item => !deprecatedVisibleSystems.has(item.name));
  const productId = targetId.startsWith('product:') ? targetId.slice('product:'.length) : '';
  let product: (ProductRecord & { id?: string }) | null = productId ? products.items.find(item => item.id === productId) || null : null;
  if (targetId === 'system:arbm-one') {
    product = {
      name: 'ARBM ONE', slug: 'arbm-one-system', category: 'Sistema privado',
      description: 'Sistema privado transacional de origem, certificado separadamente do produto comercial ZEVANORY ONE.',
      publicUrl: 'https://arbmone.api.br/', priceCents: null, currency: 'BRL', checkoutUrl: '',
      deliveryModel: 'Sistema privado transacional', channels: [], status: 'validation', salesEnabled: false,
      gates: { legal: false, payment: false, fulfillment: false, support: false },
      audit: { engineering: null, infrastructure: null, ux: null, observability: null, lastAuditedAt: null },
      notes: 'ARBM ONE certificado separadamente.', createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z',
    };
  }
  if (!product) throw new Error('certification_target_not_found');

  const sourceSystem = certificationSystem(product, visibleSystems);
  const releaseFingerprint = certificationReleaseFingerprint(product, sourceSystem);
  const sourceSha = sourceSystem?.sha || releaseFingerprint;
  await invalidateObsoleteCertificationEvidence(product.slug, releaseFingerprint);
  await invalidatePriorRunEvidence(product.slug, releaseFingerprint);

  const startedAt = new Date().toISOString();
  const run: CertificationRunRecord = {
    targetId, targetSlug: product.slug, targetName: product.name, status: 'running', releaseFingerprint,
    sourceSha, startedAt, finishedAt: null, currentPillar: 'P01', completedPillars: 0, results: [], failureReason: null,
  };
  const [runId] = await db.add(CERTIFICATION_RUNS, [run]);
  if (!runId) throw new Error('certification_run_create_failed');

  try {
    const freshRuntime = await db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 });
    let currentEvidence = freshRuntime.items.filter(item => !item.invalidatedAt && item.releaseFingerprint === releaseFingerprint);
    const baseline = buildProductCertification(product, visibleSystems, currentEvidence);
    for (const definition of ZEES_PILLARS) {
      const checkedAt = new Date().toISOString();
      const pillar = baseline.pillars.find(item => item.id === definition.id)!;
      const status = pillar.status === 'external' ? 'blocked' : pillar.status;
      const kind: VerifiedEvidence['kind'] = status === 'blocked' ? 'blocking' : 'supporting';
      const marker = status === 'proved' ? `ZEES:${definition.id}:PROVEN:` : `ZEES:${definition.id}:${status.toUpperCase()}:`;
      const record: CertificationEvidenceRecord = {
        target: product.slug,
        pillar: definition.id,
        kind,
        text: `${marker}${pillar.rationale}`,
        sourceSha,
        sourceRef: `ZEES Executor ${ZEES_VERSION} · run ${runId}`,
        capturedAt: checkedAt,
        runId,
        releaseFingerprint,
        verdict: status === 'na' ? 'partial' : status,
        verifier: `zees-verifier-${definition.id.toLowerCase()}`,
        environment: sourceSystem?.domain || product.publicUrl || 'internal',
        artifacts: verifierArtifacts(pillar, product, sourceSystem),
        invalidatedAt: null,
        invalidationReason: null,
      };
      if (status !== 'na') {
        await db.add(CERTIFICATION_EVIDENCE, [record]);
        currentEvidence = [...currentEvidence, record];
      }
      run.results.push({ pillar: definition.id, status, message: pillar.blocker || pillar.rationale, checkedAt });
      run.currentPillar = definition.id;
      run.completedPillars += 1;
      await db.update(CERTIFICATION_RUNS, [{ id: runId, record: { ...run } }]);
    }
    run.status = 'complete';
    run.currentPillar = null;
    run.finishedAt = new Date().toISOString();
    await db.update(CERTIFICATION_RUNS, [{ id: runId, record: { ...run } }]);
    const finalEvidence = await db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 });
    const certification = buildProductCertification(product, visibleSystems, finalEvidence.items);
    return { runId, releaseFingerprint, sourceSha, certification };
  } catch (error) {
    run.status = 'failed';
    run.failureReason = String(error);
    run.finishedAt = new Date().toISOString();
    await db.update(CERTIFICATION_RUNS, [{ id: runId, record: { ...run } }]);
    throw error;
  }
}

async function ensureProducts() {
  const table = productTable();
  const current = await db.list<ProductRecord>(table, { limit: 100 });
  const now = new Date().toISOString();
  const legacyCommercialOne = current.items.find(item =>
    item.slug === 'arbm-one-clone-clientes' ||
    item.slug === 'arbm-one' ||
    item.name === 'ARBM ONE Clone Clientes' ||
    item.name === 'ARBM UM' ||
    item.name === 'ARBM ONE'
  );
  const canonicalZevanoryOne = current.items.find(item => item.slug === 'zevanory-one' || item.name === 'ZEVANORY ONE');
  const zevanoryOneRecord = canonicalZevanoryOne ?? legacyCommercialOne;
  if (zevanoryOneRecord && (
    zevanoryOneRecord.name !== 'ZEVANORY ONE' ||
    zevanoryOneRecord.slug !== 'zevanory-one' ||
    zevanoryOneRecord.publicUrl !== 'https://zevanory.api.br/zevanory-one' ||
    zevanoryOneRecord.description !== 'Plataforma comercial universal da ZEVANORY, com provisionamento isolado por cliente, onboarding e configuracao propria.'
  )) {
    const migrated: ProductRecord = {
      ...zevanoryOneRecord,
      name: 'ZEVANORY ONE',
      slug: 'zevanory-one',
      category: 'Software comercial',
      description: 'Plataforma comercial universal da ZEVANORY, com provisionamento isolado por cliente, onboarding e configuracao propria.',
      publicUrl: 'https://zevanory.api.br/zevanory-one',
      deliveryModel: 'Licenca e instalacao global por cliente',
      notes: 'ZEVANORY ONE e o produto comercial universal da ZEVANORY. O ARBM ONE permanece um sistema privado separado; certificacoes e evidencias nao sao transferiveis entre os dois produtos.',
      updatedAt: now,
    };
    await db.update(table, [{ id: zevanoryOneRecord.id, record: migrated }]);
  }
  const zevanoryRecord = current.items.find(item => item.slug === 'zevanory');
  const zevanoryAudit: ProductAudit = { engineering: 9.4, infrastructure: 8.6, ux: 8.2, observability: 9.1, lastAuditedAt: '2026-09-18T14:05:00.000Z' };
  if (zevanoryRecord && auditOverall(cleanProductAudit(zevanoryRecord.audit)) === null) {
    await db.update(table, [{ id: zevanoryRecord.id, record: {
      ...zevanoryRecord,
      audit: zevanoryAudit,
      notes: `${zevanoryRecord.notes ? `${zevanoryRecord.notes} ` : ''}Auditoria zero-tolerance 18/09/2026: CI/QCP/core/security/recovery/remote attestation verdes no PR #214; producao no SHA fa309fb66b295b72f1425fe34ae785b19bb5eee3; paginas HTTP 200; TTFB amostrado entre 90 e 131 ms. Penalizacoes: alvo absoluto <=100 ms nao comprovado em todas as paginas; Lighthouse 100/100/100/100 e prova visual pixel-perfect/WCAG AAA ainda nao reproduzidos.`,
      updatedAt: now,
    } }]);
  }
  const effectiveSlugs = new Set(current.items.map(item => item.id === zevanoryOneRecord?.id ? 'zevanory-one' : item.slug));
  const missingCatalogItems = productCatalog.filter(item => !effectiveSlugs.has(item.slug));
  if (missingCatalogItems.length === 0) return;
  const seed: ProductRecord[] = missingCatalogItems.map(item => ({
    ...item,
    priceCents: null,
    currency: 'BRL',
    checkoutUrl: '',
    channels: [],
    status: 'validation',
    salesEnabled: false,
    gates: { legal: false, payment: false, fulfillment: false, support: false },
    audit: item.slug === 'zevanory'
      ? { engineering: 9.4, infrastructure: 8.6, ux: 8.2, observability: 9.1, lastAuditedAt: '2026-09-18T14:05:00.000Z' }
      : { engineering: null, infrastructure: null, ux: null, observability: null, lastAuditedAt: null },
    notes: item.slug === 'zevanory-one'
      ? 'ZEVANORY ONE e o produto comercial universal da ZEVANORY. O ARBM ONE permanece um sistema privado separado; certificacoes e evidencias nao sao transferiveis entre os dois produtos.'
      : item.slug === 'zevanory'
        ? 'Auditoria zero-tolerance 18/09/2026: CI/QCP/core/security/recovery/remote attestation verdes no PR #214; producao no SHA fa309fb66b295b72f1425fe34ae785b19bb5eee3; paginas HTTP 200; TTFB amostrado entre 90 e 131 ms. Penalizacoes: alvo absoluto <=100 ms nao comprovado em todas as paginas; Lighthouse 100/100/100/100 e prova visual pixel-perfect/WCAG AAA ainda nao reproduzidos.'
        : 'Cadastro canônico do portfolio ZEVANORY. Venda permanece bloqueada ate validacao administrativa.',
    createdAt: now,
    updatedAt: now,
  }));
  await db.add(table, seed);
}

function parseStatus(value: unknown, fallback: ProductStatus): ProductStatus {
  return ['draft', 'validation', 'ready', 'blocked', 'archived'].includes(String(value))
    ? String(value) as ProductStatus
    : fallback;
}

function normalizeProductAudit(raw: Partial<ProductAudit> | undefined, existing: ProductAudit | undefined, now: string): ProductAudit | null {
  const source = raw ?? existing ?? {};
  const keys: Array<keyof Pick<ProductAudit, 'engineering' | 'infrastructure' | 'ux' | 'observability'>> = ['engineering', 'infrastructure', 'ux', 'observability'];
  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 10) return null;
    }
  }
  const normalized = cleanProductAudit(source);
  const prior = cleanProductAudit(existing);
  const changed = keys.some(key => normalized[key] !== prior[key]);
  const complete = auditOverall(normalized) !== null;
  normalized.lastAuditedAt = complete ? (changed ? now : prior.lastAuditedAt ?? normalized.lastAuditedAt ?? now) : null;
  return normalized;
}

function normalizeProduct(raw: Partial<ProductRecord>, existing?: ProductRecord): ProductRecord | null {
  const now = new Date().toISOString();
  const name = String(raw.name ?? existing?.name ?? '').trim();
  const slug = String(raw.slug ?? existing?.slug ?? '').trim().toLowerCase();
  if (!name || !slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  const gatesRaw = raw.gates ?? existing?.gates ?? { legal: false, payment: false, fulfillment: false, support: false };
  const priceValue = raw.priceCents === undefined ? existing?.priceCents ?? null : raw.priceCents;
  const priceCents = priceValue === null ? null : Number(priceValue);
  if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) return null;
  const channels = Array.isArray(raw.channels)
    ? raw.channels.map(item => String(item).trim()).filter(Boolean).slice(0, 20)
    : existing?.channels ?? [];
  const status = parseStatus(raw.status, existing?.status ?? 'draft');
  const audit = normalizeProductAudit(raw.audit, existing?.audit, now);
  if (!audit) return null;
  const product: ProductRecord = {
    name,
    slug,
    category: String(raw.category ?? existing?.category ?? 'Produto digital').trim(),
    description: String(raw.description ?? existing?.description ?? '').trim(),
    publicUrl: String(raw.publicUrl ?? existing?.publicUrl ?? '').trim(),
    priceCents,
    currency: 'BRL',
    checkoutUrl: String(raw.checkoutUrl ?? existing?.checkoutUrl ?? '').trim(),
    deliveryModel: String(raw.deliveryModel ?? existing?.deliveryModel ?? 'Digital').trim(),
    channels,
    status,
    salesEnabled: Boolean(raw.salesEnabled ?? existing?.salesEnabled ?? false),
    gates: {
      legal: Boolean(gatesRaw.legal),
      payment: Boolean(gatesRaw.payment),
      fulfillment: Boolean(gatesRaw.fulfillment),
      support: Boolean(gatesRaw.support),
    },
    audit,
    notes: String(raw.notes ?? existing?.notes ?? '').trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (product.status === 'archived') product.salesEnabled = false;
  return product;
}

async function ensureSeed() {
  const systems = await db.list<SystemRecord>(SYSTEMS, { limit: 50 });
  const deprecated = systems.items.filter(item => deprecatedVisibleSystems.has(item.name));
  if (deprecated.length > 0) await db.delete(SYSTEMS, deprecated.map(item => item.id));
  const retained = systems.items.filter(item => !deprecatedVisibleSystems.has(item.name));
  if (retained.length === 0) {
    await db.add(SYSTEMS, systemSeed);
  } else {
    for (const system of retained) {
      const source = String(system.source || '').replace(/ARBM CONTROL private telemetry/gi, 'telemetria privada interna');
      const evidence = system.evidence.map(item => item.replace(/Repositorio privado via ARBM CONTROL/gi, 'Repositorio privado via telemetria interna'));
      if (source !== system.source || evidence.some((item, index) => item !== system.evidence[index])) {
        await db.update(SYSTEMS, [{ id: system.id, record: { ...system, source, evidence } }]);
      }
    }
  }
  const engine = await db.list<{ lastRun: string }>(ENGINE, { limit: 1 });
  if (engine.items.length === 0) await db.add(ENGINE, [{ lastRun: new Date().toISOString() }]);
}

function summarizeChecks(items: TelemetryCheck[] | undefined, label: string) {
  if (!items || items.length === 0) return null;
  const successful = items.filter(item => item.conclusion === 'success').length;
  const active = items.filter(item => item.status !== 'completed').length;
  return `${label}: ${successful}/${items.length} success${active ? `, ${active} ativo(s)` : ''}`;
}

function latestRunSummary(repo: TelemetryRepo) {
  const latest = repo.runs?.[0];
  if (!latest) return 'GitHub Actions: sem run recente';
  return `GitHub Actions: ${latest.name} · ${latest.status}${latest.conclusion ? `/${latest.conclusion}` : ''}`;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function saveLastProvenTelemetry(telemetry: PrivateTelemetry) {
  const current = await db.list<TelemetrySnapshot>(TELEMETRY_SNAPSHOTS, { limit: 1 });
  const record: TelemetrySnapshot = { telemetry, capturedAt: new Date().toISOString() };
  if (current.items[0]) {
    await db.update(TELEMETRY_SNAPSHOTS, [{ id: current.items[0].id, record }]);
  } else {
    await db.add(TELEMETRY_SNAPSHOTS, [record]);
  }
}

async function loadLastProvenTelemetry(): Promise<PrivateTelemetry | null> {
  const current = await db.list<TelemetrySnapshot>(TELEMETRY_SNAPSHOTS, { limit: 1 });
  return current.items[0]?.telemetry ?? null;
}

async function fetchPrivateTelemetry(): Promise<TelemetryFetchResult> {
  try {
    const names = await secrets.listSecretNames();
    if (!names.includes('ARBM_TELEMETRY_TOKEN')) {
      return { telemetry: await loadLastProvenTelemetry(), stale: true, source: 'last-proven', attempts: 0 };
    }
    const token = await secrets.readSecret('ARBM_TELEMETRY_TOKEN');
    for (let attempt = 0; attempt < TELEMETRY_RETRY_DELAYS_MS.length; attempt += 1) {
      if (TELEMETRY_RETRY_DELAYS_MS[attempt]) await sleep(TELEMETRY_RETRY_DELAYS_MS[attempt]);
      try {
        const response = await fetch(PRIVATE_TELEMETRY_URL, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < TELEMETRY_RETRY_DELAYS_MS.length - 1) continue;
        if (!response.ok) break;
        const data = await response.json() as PrivateTelemetry;
        if (data.schema !== 'arbm-control-telemetry/v1') break;
        await saveLastProvenTelemetry(data);
        return { telemetry: data, stale: false, source: 'live', attempts: attempt + 1 };
      } catch {
        if (attempt === TELEMETRY_RETRY_DELAYS_MS.length - 1) break;
      }
    }
  } catch {
    // Preserve last proven state.
  }
  const cached = await loadLastProvenTelemetry();
  return { telemetry: cached, stale: true, source: cached ? 'last-proven' : 'unavailable', attempts: TELEMETRY_RETRY_DELAYS_MS.length };
}

async function refreshTelemetry() {
  await ensureSeed();
  const now = new Date().toISOString();
  const systems = await db.list<SystemRecord>(SYSTEMS, { limit: 50 });
  const incidents: IncidentRecord[] = [];
  const fetchResult = await fetchPrivateTelemetry();
  const telemetry = fetchResult.telemetry;

  if (fetchResult.stale) {
    incidents.push({
      system: 'ZEVANORY PRODUCT CONTROL',
      severity: 'warning',
      title: 'Executor primario interrompido',
      detail: telemetry
        ? `Fail-closed ativo; usando ultimo snapshot comprovado apos ${fetchResult.attempts} tentativa(s). Nenhuma promocao para verde e permitida.`
        : 'Fail-closed ativo; sem snapshot comprovado disponivel e nenhuma promocao para verde e permitida.',
      createdAt: now,
      state: 'watching',
    });
  }

  for (const system of systems.items) {
    let next: SystemRecord = { ...system, lastAudit: now };
    const repo = telemetry?.repositories.find(item => item.label === system.name);
    const production = telemetry?.production.find(item => item.label === system.name);

    if (repo) {
      next.source = repo.source;
      if (repo.ok) {
        next.sha = repo.sha || next.sha;
        next.evidence = Array.from(new Set([
          ...next.evidence,
          latestRunSummary(repo),
          summarizeChecks(repo.external_ci, 'CI externo'),
          summarizeChecks(repo.e2e, 'E2E'),
          summarizeChecks(repo.recovery, 'Recovery'),
        ].filter((item): item is string => Boolean(item)))).slice(-12);
        next.ci = repo.combined_state ? `commit ${repo.combined_state}` : 'commit status indisponivel';
      } else {
        next.status = 'attention';
        next.ci = 'telemetria privada com erro';
        incidents.push({ system: system.name, severity: 'warning', title: 'Telemetria privada incompleta', detail: repo.error || 'Nao foi possivel provar SHA/CI nesta rodada.', createdAt: now, state: 'watching' });
      }
    }

    if (production) {
      next.availability = production.ok ? 100 : 0;
      next.latencyMs = production.latency_ms;
      next.evidence = Array.from(new Set([...next.evidence, `Producao HTTP ${production.status} em ${production.latency_ms} ms`])).slice(-12);
      if (!production.ok) {
        next.status = 'attention';
        next.score = Math.min(next.score, 60);
        incidents.push({ system: system.name, severity: 'critical', title: 'Falha de disponibilidade', detail: `Probe privado retornou HTTP ${production.status}.`, createdAt: now, state: 'open' });
      }
    }

    if (!repo && system.status !== 'integration' && telemetry) {
      next.status = 'attention';
      next.ci = 'fonte privada nao mapeada';
    }

    if (fetchResult.stale && system.status !== 'integration') {
      next.status = 'attention';
      next.ci = `STALE fail-closed · ${fetchResult.source}`;
      next.evidence = Array.from(new Set([...next.evidence, 'Continuidade: ultimo estado comprovado preservado; promocao bloqueada ate telemetria live retornar'])).slice(-12);
    }

    await db.update(SYSTEMS, [{ id: system.id, record: next }]);
  }

  if (incidents.length > 0) await db.add(INCIDENTS, incidents.slice(0, 20));
  const engine = await db.list<{ lastRun: string }>(ENGINE, { limit: 1 });
  if (engine.items[0]) await db.update(ENGINE, [{ id: engine.items[0].id, record: { lastRun: now } }]);
  return { ok: Boolean(telemetry) && !fetchResult.stale, at: now, source: fetchResult.source, stale: fetchResult.stale, attempts: fetchResult.attempts, incidents: incidents.length };
}

async function executeAudit() {
  await refreshTelemetry();
  const now = new Date().toISOString();
  const systems = await db.list<SystemRecord>(SYSTEMS, { limit: 50 });
  const audits: AuditRecord[] = [];
  const improvements: ImprovementRecord[] = [];

  for (const system of systems.items) {
    if (system.status === 'integration') {
      audits.push({ system: system.name, severity: 'info', title: 'Integracao explicitamente pendente', detail: 'Nao promove a verde e nao bloqueia o core.', createdAt: now });
      continue;
    }
    audits.push({
      system: system.name,
      severity: system.status === 'healthy' ? 'info' : 'warning',
      title: system.status === 'healthy' ? 'Saude preservada' : 'Gate requer prova reproduzivel',
      detail: system.status === 'healthy' ? 'Estado sustentado por evidencia privada recente.' : `${system.gate}. Fail-closed mantido.`,
      createdAt: now,
    });
    if (system.status !== 'healthy') {
      improvements.push({
        system: system.name,
        priority: system.score < 80 ? 'P0' : 'P1',
        title: 'Fechar o proximo gate verificavel',
        reason: 'Converter estado em prova por SHA, CI, producao, E2E e recovery.',
        state: 'proposed',
      });
    }
  }

  if (audits.length > 0) await db.add(AUDITS, audits.slice(0, 50));
  if (improvements.length > 0) await db.add(IMPROVEMENTS, improvements.slice(0, 50));
  return { ok: true, at: now };
}

type PinSessionRecord = { token: string; expiresAt: string; createdAt: string };
type PinSecurityRecord = { failedAttempts: number; lockedUntil: string | null; updatedAt: string; pinFingerprint?: string };
const PIN_SESSIONS = 'acs_pin_sessions';
const PIN_CURRENT_SESSION = 'acs_pin_current_session';
const PIN_SECURITY = 'acs_pin_security';
const SESSION_HOURS = 12;
const MAX_PIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

async function securityState(fingerprint: string) {
  const state = await db.list<PinSecurityRecord>(PIN_SECURITY, { limit: 1 });
  if (state.items[0]) {
    const current = state.items[0];
    if (current.pinFingerprint !== fingerprint) {
      const reset: PinSecurityRecord = { failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString(), pinFingerprint: fingerprint };
      await db.update(PIN_SECURITY, [{ id: current.id, record: reset }]);
      return { ...reset, id: current.id };
    }
    return current;
  }
  const record: PinSecurityRecord = { failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString(), pinFingerprint: fingerprint };
  const [id] = await db.add(PIN_SECURITY, [record]);
  return { ...record, id: id || '' };
}

async function updateSecurity(id: string, record: PinSecurityRecord) {
  if (id) await db.update(PIN_SECURITY, [{ id, record }]);
}

async function createPinSession() {
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const current = await db.list<PinSessionRecord>(PIN_CURRENT_SESSION, { limit: 10 });
  if (current.items.length > 0) await db.delete(PIN_CURRENT_SESSION, current.items.map(item => item.id));
  const [id] = await db.add(PIN_CURRENT_SESSION, [{ token, createdAt: now.toISOString(), expiresAt: expires.toISOString() }]);
  if (!id) throw new Error('pin_session_create_failed');
  return { token, expiresAt: expires.toISOString() };
}

async function requirePinSession(token: unknown) {
  const value = String(token || '').trim();
  if (!value) return false;
  const now = Date.now();
  const current = await db.list<PinSessionRecord>(PIN_CURRENT_SESSION, { limit: 10 });
  if (current.items.some(item => item.token === value && Date.parse(item.expiresAt) > now)) return true;
  const legacy = await db.list<PinSessionRecord>(PIN_SESSIONS, { limit: 50 });
  return legacy.items.some(item => item.token === value && Date.parse(item.expiresAt) > now);
}

async function pinLogin(pin: unknown) {
  const candidate = String(pin || '').trim();
  if (!/^\d{4}$/.test(candidate)) return { ok: false, status: 400, message: 'Informe um PIN de 4 numeros.' };
  const verification = await verifyAdminPin(candidate);
  const fingerprint = verification.fingerprint;
  const state = await securityState(fingerprint);
  if (state.lockedUntil && Date.parse(state.lockedUntil) > Date.now()) {
    return { ok: false, status: 429, message: 'Acesso temporariamente bloqueado por excesso de tentativas. Tente novamente mais tarde.' };
  }
  if (!verification.valid) {
    const failedAttempts = state.failedAttempts + 1;
    const lockedUntil = failedAttempts >= MAX_PIN_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    await updateSecurity(state.id, { failedAttempts: lockedUntil ? 0 : failedAttempts, lockedUntil, updatedAt: new Date().toISOString(), pinFingerprint: fingerprint });
    return { ok: false, status: 401, message: lockedUntil ? 'Muitas tentativas incorretas. Acesso bloqueado temporariamente.' : 'PIN incorreto.' };
  }
  await updateSecurity(state.id, { failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString(), pinFingerprint: fingerprint });
  return { ok: true, status: 200, ...(await createPinSession()) };
}

async function adminData() {
  await ensureSeed();
  await ensureProducts();
  const [systems, audits, improvements, incidents, engine, products, certificationEvidence, certificationRuns] = await Promise.all([
    db.list<SystemRecord>(SYSTEMS, { limit: 50 }),
    db.list<AuditRecord>(AUDITS, { limit: 20 }),
    db.list<ImprovementRecord>(IMPROVEMENTS, { limit: 20 }),
    db.list<IncidentRecord>(INCIDENTS, { limit: 20 }),
    db.list<{ lastRun: string }>(ENGINE, { limit: 1 }),
    db.list<ProductRecord>(productTable(), { limit: 100 }),
    db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 }),
    db.list<CertificationRunRecord>(CERTIFICATION_RUNS, { limit: 100 }),
  ]);
  const visibleSystems = systems.items.filter(item => !deprecatedVisibleSystems.has(item.name));
  const enriched = products.items.map(product => {
    const base = enrichProduct(product);
    const certification = buildProductCertification(product, visibleSystems, certificationEvidence.items);
    return { ...base, certification, commercialReady: base.commercialReady && certification.ready, blockers: [...base.blockers, ...(certification.ready ? [] : ['certificacao ZEES-16 incompleta'])] };
  }).sort((x, y) => {
    if (x.status === 'archived' && y.status !== 'archived') return 1;
    if (y.status === 'archived' && x.status !== 'archived') return -1;
    return x.name.localeCompare(y.name);
  });
  const arbmOneSystemRecord: ProductRecord = {
    name: 'ARBM ONE',
    slug: 'arbm-one-system',
    category: 'Sistema privado',
    description: 'Sistema privado transacional de origem, certificado separadamente do produto comercial ZEVANORY ONE.',
    publicUrl: 'https://arbmone.api.br/',
    priceCents: null,
    currency: 'BRL',
    checkoutUrl: '',
    deliveryModel: 'Sistema privado transacional',
    channels: [],
    status: 'validation',
    salesEnabled: false,
    gates: { legal: false, payment: false, fulfillment: false, support: false },
    audit: { engineering: null, infrastructure: null, ux: null, observability: null, lastAuditedAt: null },
    notes: 'ARBM ONE nao e o produto comercial ZEVANORY ONE; evidencias nao sao transferidas entre eles.',
    createdAt: '2026-09-19T00:00:00Z',
    updatedAt: '2026-09-19T00:00:00Z',
  };
  const certificationTargets = [
    {
      id: 'system:arbm-one',
      name: 'ARBM ONE',
      kind: 'SISTEMA PRIVADO',
      publicUrl: arbmOneSystemRecord.publicUrl,
      certification: buildProductCertification(arbmOneSystemRecord, visibleSystems, certificationEvidence.items),
    },
    ...enriched.filter(item => item.status !== 'archived').map(item => ({
      id: `product:${item.id}`,
      name: item.name,
      kind: item.slug === 'arbm-sist' || item.slug === 'zevanory' ? 'SISTEMA + PRODUTO' : 'PRODUTO',
      publicUrl: item.publicUrl,
      certification: item.certification,
    })),
  ];

  return {
    certificationTargets,
    dashboard: {
      systems: visibleSystems,
      audits: audits.items.filter(item => !deprecatedVisibleSystems.has(item.system)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
      improvements: improvements.items.filter(item => !deprecatedVisibleSystems.has(item.system)),
      incidents: incidents.items.filter(item => !deprecatedVisibleSystems.has(item.system)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
      policy: { zeroSpend: true, failClosed: true, destructiveActions: false, greenRule: 'Somente com evidencia reproduzivel' },
      telemetrySource: 'telemetria privada interna v1',
      lastEngineRun: engine.items[0]?.lastRun ?? new Date().toISOString(),
      certificationRuns: certificationRuns.items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20),
    },
    products: enriched,
    summary: {
      total: enriched.length,
      salesEnabled: enriched.filter(item => item.salesEnabled).length,
      commercialReady: enriched.filter(item => item.commercialReady).length,
      blocked: enriched.filter(item => !item.commercialReady && item.status !== 'archived').length,
      certified: enriched.filter(item => item.certification.ready).length,
      inCertification: enriched.filter(item => item.status !== 'archived' && !item.certification.ready).length,
      zeesBlocked: enriched.filter(item => item.status !== 'archived' && item.certification.summary.blocked > 0).length,
    },
  };
}

export const privateTelemetryHandler = async () => {
  await refreshTelemetry();
  return { statusCode: 200 };
};

export const dailyAuditHandler = async () => {
  await executeAudit();
  return { statusCode: 200 };
};

export const handler = router({
  'GET /api/_auth_diagnostic': [async () => {
    let stage = 'secret';
    let tempSessionId = '';
    try {
      const pinState = await adminPinState();
      const secretValid = pinState.configured;
      if (!secretValid) return json({ secretValid: false, locked: false, sessionRoundtrip: false, bootstrapOk: false, stage: 'pin_unconfigured' });

      stage = 'security';
      const state = await securityState(pinState.fingerprint);
      const locked = Boolean(state.lockedUntil && Date.parse(state.lockedUntil) > Date.now());

      stage = 'session';
      const now = new Date();
      const token = `diag_${crypto.randomUUID().replace(/-/g, '')}`;
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      const [id] = await db.add(PIN_CURRENT_SESSION, [{ token, createdAt: now.toISOString(), expiresAt }]);
      tempSessionId = id || '';
      const sessionRoundtrip = Boolean(tempSessionId && await requirePinSession(token));

      stage = 'bootstrap';
      let bootstrapOk = false;
      if (sessionRoundtrip) {
        await adminData();
        bootstrapOk = true;
      }

      if (tempSessionId) await db.delete(PIN_CURRENT_SESSION, [tempSessionId]);
      return json({ secretValid, locked, sessionRoundtrip, bootstrapOk, stage: bootstrapOk ? 'complete' : stage });
    } catch {
      if (tempSessionId) {
        try { await db.delete(PIN_CURRENT_SESSION, [tempSessionId]); } catch { /* best-effort diagnostic cleanup */ }
      }
      return json({ secretValid: stage !== 'secret', locked: false, sessionRoundtrip: false, bootstrapOk: false, stage: `failed:${stage}` });
    }
  }],
  'POST /api/pin/login': [async ctx => {
    try {
      const result = await pinLogin((ctx.body as { pin?: string })?.pin);
      if (!result.ok || !('token' in result)) return error(result.message || 'Acesso negado.', result.status);
      return json({ ok: true, sessionToken: result.token, expiresAt: result.expiresAt });
    } catch {
      return error('PIN administrativo nao configurado.', 503);
    }
  }],
  'POST /api/pin/logout': [async ctx => {
    const token = String((ctx.body as { sessionToken?: string })?.sessionToken || '');
    const [current, legacy] = await Promise.all([
      db.list<PinSessionRecord>(PIN_CURRENT_SESSION, { limit: 10 }),
      db.list<PinSessionRecord>(PIN_SESSIONS, { limit: 50 }),
    ]);
    const currentMatch = current.items.find(item => item.token === token);
    const legacyMatch = legacy.items.find(item => item.token === token);
    if (currentMatch) await db.delete(PIN_CURRENT_SESSION, [currentMatch.id]);
    if (legacyMatch) await db.delete(PIN_SESSIONS, [legacyMatch.id]);
    return json({ ok: true });
  }],
  'POST /api/admin/bootstrap': [async ctx => {
    const token = (ctx.body as { sessionToken?: string })?.sessionToken;
    if (!await requirePinSession(token)) return error('Sessao invalida ou expirada.', 401);
    return json(await adminData());
  }],
  'POST /api/products/create': [async ctx => {
    const body = ctx.body as { sessionToken?: string } & Partial<ProductRecord>;
    if (!await requirePinSession(body.sessionToken)) return error('Sessao invalida ou expirada.', 401);
    await ensureProducts();
    const product = normalizeProduct(body);
    if (!product) return error('Produto invalido: informe nome, slug valido e dados consistentes.', 400);
    const blockers = commercialBlockers(product);
    const [systems, certificationEvidence] = await Promise.all([
      db.list<SystemRecord>(SYSTEMS, { limit: 50 }),
      db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 }),
    ]);
    const certification = buildProductCertification(product, systems.items.filter(item => !deprecatedVisibleSystems.has(item.name)), certificationEvidence.items);
    if (product.salesEnabled && (blockers.length > 0 || !certification.ready)) {
      const reasons = [...blockers, ...(!certification.ready ? [certification.rootBlocker || 'certificacao ZEES-16 incompleta'] : [])];
      return error(`Venda bloqueada: ${reasons.join('; ')}.`, 409);
    }
    const [id] = await db.add(productTable(), [product]);
    if (!id) return error('Nao foi possivel criar o produto.', 500);
    return json(enrichProduct({ ...product, id }), 201);
  }],
  'POST /api/products/update': [async ctx => {
    const body = ctx.body as { sessionToken?: string; id?: string } & Partial<ProductRecord>;
    if (!await requirePinSession(body.sessionToken)) return error('Sessao invalida ou expirada.', 401);
    if (!body.id) return error('Produto invalido.', 400);
    const [existing] = await db.get<ProductRecord>(productTable(), [body.id]);
    if (!existing) return error('Produto nao encontrado.', 404);
    const product = normalizeProduct(body, existing);
    if (!product) return error('Produto invalido: informe nome, slug valido e dados consistentes.', 400);
    const blockers = commercialBlockers(product);
    const [systems, certificationEvidence] = await Promise.all([
      db.list<SystemRecord>(SYSTEMS, { limit: 50 }),
      db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 }),
    ]);
    const visibleSystems = systems.items.filter(item => !deprecatedVisibleSystems.has(item.name));
    const releaseFingerprint = certificationReleaseFingerprint(product, certificationSystem(product, visibleSystems));
    await invalidateObsoleteCertificationEvidence(product.slug, releaseFingerprint);
    const freshEvidence = await db.list<CertificationEvidenceRecord>(CERTIFICATION_EVIDENCE, { limit: 1000 });
    const certification = buildProductCertification(product, visibleSystems, freshEvidence.items);
    if (product.salesEnabled && (blockers.length > 0 || !certification.ready)) {
      const reasons = [...blockers, ...(!certification.ready ? [certification.rootBlocker || 'certificacao ZEES-16 incompleta'] : [])];
      return error(`Venda bloqueada: ${reasons.join('; ')}.`, 409);
    }
    const [updated] = await db.update(productTable(), [{ id: body.id, record: product }]);
    if (!updated) return error('Nao foi possivel atualizar o produto.', 500);
    return json(enrichProduct({ ...product, id: body.id }));
  }],
  'POST /api/products/archive': [async ctx => {
    const body = ctx.body as { sessionToken?: string; id?: string };
    if (!await requirePinSession(body.sessionToken)) return error('Sessao invalida ou expirada.', 401);
    if (!body.id) return error('Produto invalido.', 400);
    const [existing] = await db.get<ProductRecord>(productTable(), [body.id]);
    if (!existing) return error('Produto nao encontrado.', 404);
    const archived: ProductRecord = { ...existing, status: 'archived', salesEnabled: false, updatedAt: new Date().toISOString() };
    const [updated] = await db.update(productTable(), [{ id: body.id, record: archived }]);
    if (!updated) return error('Nao foi possivel arquivar o produto.', 500);
    return json(enrichProduct({ ...archived, id: body.id }));
  }],
  'POST /api/certification/run': [async ctx => {
    const body = ctx.body as { sessionToken?: string; targetId?: string };
    if (!await requirePinSession(body.sessionToken)) return error('Sessao invalida ou expirada.', 401);
    if (!body.targetId) return error('Alvo de certificacao ausente.', 400);
    try {
      return json(await runCertificationExecutor(String(body.targetId)));
    } catch (err) {
      return error(`Falha no executor ZEES: ${String(err)}`, 500);
    }
  }],
  'POST /api/audit/run': [async ctx => {
    if (!await requirePinSession((ctx.body as { sessionToken?: string })?.sessionToken)) return error('Sessao invalida ou expirada.', 401);
    return json(await executeAudit());
  }],
  'POST /api/telemetry/refresh': [async ctx => {
    if (!await requirePinSession((ctx.body as { sessionToken?: string })?.sessionToken)) return error('Sessao invalida ou expirada.', 401);
    return json(await refreshTelemetry());
  }],
  'GET /api/_healthcheck': [async () => json({ ok: true, name: 'ZEVANORY PRODUCT CONTROL', mode: 'four-digit-pin-admin-control' })],
  'GET /api/_portable_health': [async () => json(await portableHealth())],
});
