// Market-signal quality gate shared by the commercial robot (backend) and the panel (frontend).
// A web result is only a useful signal when it is a small-business page in the ICP that shows
// concrete intent for what ZEVANORY sells. Tool tutorials, portals, health-service pages and
// generic business homepages are noise: they never become leads (cold outreach is forbidden).

export type SignalInput = { title?: string | null; detail?: string | null; url?: string | null };
export type SignalVerdict = { useful: boolean; reason: string };

const norm = (value: unknown) => String(value ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

const NOISE_TERMS = [
  'passo a passo', 'como acessar', 'como entrar', 'como usar', 'como baixar', 'tutorial', 'login', 'entrar no',
  'baixar', 'download', 'whatsapp web', 'aplicativo para pc', 'app para pc', 'apk',
  'exames', 'exame ', 'resultados on-line', 'resultados online', 'laudo', 'laboratorio', 'patologia',
  'marque sua consulta', 'agende sua consulta', 'agendar consulta', 'convenio', 'plano de saude', 'medico', 'hospital',
  'noticia', 'jornal', 'blog do', 'wikipedia', 'reclame aqui', 'vaga', 'emprego', 'concurso', 'curso gratis',
  'prefeitura', 'governo', 'receita federal', 'gov.br',
];

const NOISE_HOSTS = [
  'whatsapp.com', 'techtudo', 'canaltech', 'tecmundo', 'olhardigital', 'g1.globo', 'uol.com.br', 'terra.com.br',
  'youtube.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'gov.br', 'reclameaqui',
  'mercadolivre', 'shopee', 'amazon.', 'magazineluiza', 'wikipedia', 'medium.com',
];

const ICP_TERMS = [
  'microempresa', 'pequena empresa', 'pequenas empresas', 'pequeno negocio', 'mei', 'loja', 'varejo',
  'salao de beleza', 'estetica', 'barbearia', 'academia', 'restaurante', 'lanchonete', 'oficina',
  'imobiliaria', 'escritorio contabil', 'contabilidade', 'consultoria sst', 'saude ocupacional', 'comercio',
];

// Strong intent: a pain or need that one of the ZEVANORY products resolves.
const INTENT_TERMS = [
  'crm', 'automacao', 'automatizar', 'chatbot', 'atendimento automatico', 'inteligencia artificial',
  'fluxo de caixa', 'controle financeiro', 'gestao financeira', 'capital de giro', 'margem de lucro', 'precificacao',
  'aumentar vendas', 'vender mais', 'funil de vendas', 'prospeccao', 'follow-up', 'pos-venda', 'fidelizacao',
  'nr-1', 'pgr', 'riscos psicossociais', 'gerenciamento de riscos ocupacionais',
];

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (text: string, term: string) => new RegExp('(^|[^a-z0-9])' + escapeRe(term.trim()) + '($|[^a-z0-9])').test(text);

export function assessMarketSignal(input: SignalInput): SignalVerdict {
  const url = norm(input.url);
  const text = [norm(input.title), norm(input.detail), url].join(' ');
  const host = (() => {
    try { return new URL(String(input.url || '')).hostname.toLowerCase(); } catch { return ''; }
  })();
  const noiseHost = NOISE_HOSTS.find(item => host.includes(item) || url.includes(item));
  if (noiseHost) return { useful: false, reason: 'ruido:portal:' + noiseHost };
  const noise = NOISE_TERMS.find(term => hasTerm(text, term));
  if (noise) return { useful: false, reason: 'ruido:' + noise.trim() };
  const icp = ICP_TERMS.filter(term => hasTerm(text, term));
  const intent = INTENT_TERMS.filter(term => hasTerm(text, term));
  if (!icp.length) return { useful: false, reason: 'fora-do-publico' };
  if (!intent.length) return { useful: false, reason: 'sem-intencao-de-compra' };
  return { useful: true, reason: 'publico:' + icp.slice(0, 2).join(',') + ' · intencao:' + intent.slice(0, 3).join(',') };
}
