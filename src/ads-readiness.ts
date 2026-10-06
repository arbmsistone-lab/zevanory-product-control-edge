// Paid-ads readiness: the single parameter that says WHEN to start paying for traffic.
// Principle: only buy traffic once organic data proves that one paid click is worth more than it
// costs. Every number is computed from the real funnel (last 30 days) with a pessimistic
// statistical bound, so a lucky streak never triggers spending.

export type FunnelProduct = {
  name: string; sku: string; views: number; visitors: number; checkouts: number;
  paid: number; refunded: number; revenue: number; checkoutErrors: number;
};
export type FunnelSummary = {
  schema: string; generatedAt: string; windowDays: number; salesMode: 'production' | 'test'; salesOpen: boolean;
  products: Record<string, FunnelProduct>;
};
export type CampaignData = { spend: number; sales: number } | null;

export const ADS_POLICY = Object.freeze({
  paymentFeeRate: 0.0499,      // Mercado Pago card fee (conservative; Pix is cheaper)
  safetyMargin: 0.30,          // keep 30% of net revenue per sale as profit
  referenceCpcBRL: 1.20,       // typical Meta CPC for BR small-business audiences (replace with real test data)
  minVisitors: 300,            // statistical sample before trusting conversion
  minOrganicSales: 10,         // proven demand without ads
  maxRefundRate: 0.10,
  maxCheckoutErrorRate: 0.05,
  z: 1.645,                    // 90% one-sided Wilson lower bound
  minScaleSales: 5,            // paid sales needed before scaling
});

export type Criterion = { id: string; label: string; ok: boolean; detail: string };
export type AdsReadiness = {
  status: 'AGUARDAR' | 'TESTAR' | 'ESCALAR';
  headline: string;
  nextMilestone: string;
  criteria: Criterion[];
  metrics: {
    visitors: number; paid: number; conversion: number; conversionLow: number; aov: number;
    refundRate: number; maxCpa: number; maxCpc: number; breakEvenRoas: number;
  };
  plan: { product: string | null; dailyBudget: number; testBudget: number; stopLossSpend: number } | null;
};

export function wilsonLower(successes: number, trials: number, z: number = ADS_POLICY.z) {
  if (!trials) return 0;
  const p = successes / trials;
  const z2 = z * z;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return Math.max(0, (centre - margin) / (1 + z2 / trials));
}

const brl = (value: number) => 'R$ ' + value.toFixed(2).replace('.', ',');
const pct = (value: number) => (value * 100).toFixed(1).replace('.', ',') + '%';

function economics(paid: number, refunded: number, revenue: number, visitors: number, policy = ADS_POLICY) {
  const kept = Math.max(0, paid - refunded);
  const aov = kept ? revenue / kept : 0;
  const refundRate = paid ? refunded / paid : 0;
  const conversion = visitors ? paid / visitors : 0;
  const conversionLow = wilsonLower(paid, visitors, policy.z);
  const netPerSale = aov * (1 - policy.paymentFeeRate) * (1 - refundRate);
  const maxCpa = netPerSale * (1 - policy.safetyMargin);
  const maxCpc = maxCpa * conversionLow;
  const breakEvenRoas = maxCpa > 0 ? aov / maxCpa : 0;
  return { aov, refundRate, conversion, conversionLow, maxCpa, maxCpc, breakEvenRoas };
}

export function assessAdsReadiness(summary: FunnelSummary | null, campaign: CampaignData = null, policy = ADS_POLICY): AdsReadiness {
  const products = Object.entries(summary?.products || {});
  const sum = (key: keyof FunnelProduct) => products.reduce((acc, [, p]) => acc + (Number(p[key]) || 0), 0);
  const visitors = sum('visitors');
  const paid = sum('paid');
  const refunded = sum('refunded');
  const revenue = sum('revenue');
  const checkouts = sum('checkouts');
  const errors = sum('checkoutErrors');
  const eco = economics(paid, refunded, revenue, visitors, policy);
  const checkoutErrorRate = checkouts ? errors / checkouts : 0;

  const criteria: Criterion[] = [
    { id: 'sales-open', label: 'Vendas abertas em produção', ok: Boolean(summary?.salesOpen && summary?.salesMode === 'production'), detail: summary?.salesOpen ? 'Checkout real ativo.' : 'Vendas ainda fechadas (modo teste).' },
    { id: 'sample', label: `Amostra de ${policy.minVisitors}+ visitantes`, ok: visitors >= policy.minVisitors, detail: `${visitors} visitante(s) únicos em ${summary?.windowDays || 30} dias.` },
    { id: 'demand', label: `${policy.minOrganicSales}+ vendas orgânicas`, ok: paid >= policy.minOrganicSales, detail: `${paid} venda(s) sem anúncio.` },
    { id: 'refunds', label: `Reembolsos até ${pct(policy.maxRefundRate)}`, ok: paid > 0 && eco.refundRate <= policy.maxRefundRate, detail: paid ? `Taxa atual ${pct(eco.refundRate)}.` : 'Sem vendas para medir.' },
    { id: 'checkout', label: 'Checkout saudável', ok: checkouts > 0 && checkoutErrorRate <= policy.maxCheckoutErrorRate, detail: checkouts ? `${pct(checkoutErrorRate)} de falhas em ${checkouts} checkout(s).` : 'Nenhum checkout iniciado ainda.' },
    { id: 'unit-economics', label: 'Clique pago se paga', ok: eco.maxCpc >= policy.referenceCpcBRL, detail: `Pode pagar até ${brl(eco.maxCpc)} por clique; referência ${brl(policy.referenceCpcBRL)}.` },
  ];

  // Best product to advertise: highest affordable CPC on its own pessimistic conversion.
  let best: { slug: string; name: string; maxCpa: number; maxCpc: number } | null = null;
  for (const [slug, p] of products) {
    const e = economics(p.paid, p.refunded, p.revenue, p.visitors, policy);
    if (p.paid >= 3 && (!best || e.maxCpc > best.maxCpc)) best = { slug, name: p.name, maxCpa: e.maxCpa, maxCpc: e.maxCpc };
  }

  const ready = criteria.every(c => c.ok);
  const failing = criteria.find(c => !c.ok);
  const metrics = { visitors, paid, conversion: eco.conversion, conversionLow: eco.conversionLow, aov: eco.aov, refundRate: eco.refundRate, maxCpa: eco.maxCpa, maxCpc: eco.maxCpc, breakEvenRoas: eco.breakEvenRoas };

  if (!ready) {
    return {
      status: 'AGUARDAR',
      headline: 'Ainda não é hora de pagar anúncios.',
      nextMilestone: failing ? `${failing.label}: ${failing.detail}` : '',
      criteria, metrics, plan: null,
    };
  }

  const cpa = best?.maxCpa || eco.maxCpa;
  const testBudget = Math.max(3 * cpa, 50);
  const plan = { product: best?.name || null, dailyBudget: Math.round((testBudget / 7) * 100) / 100, testBudget: Math.round(testBudget * 100) / 100, stopLossSpend: Math.round(2 * cpa * 100) / 100 };

  if (campaign && campaign.sales >= policy.minScaleSales && campaign.spend / campaign.sales <= eco.maxCpa) {
    return {
      status: 'ESCALAR',
      headline: `Anúncios se pagando: custo por venda ${brl(campaign.spend / campaign.sales)} (máximo ${brl(eco.maxCpa)}).`,
      nextMilestone: 'Aumente o orçamento em 20% a cada 3 dias enquanto o custo por venda ficar abaixo do máximo.',
      criteria, metrics, plan,
    };
  }

  return {
    status: 'TESTAR',
    headline: `Hora de testar anúncios${plan.product ? ' do ' + plan.product : ''}.`,
    nextMilestone: `Teste de ${brl(plan.testBudget)} em 7 dias (${brl(plan.dailyBudget)}/dia). Pause se gastar ${brl(plan.stopLossSpend)} sem venda.`,
    criteria, metrics, plan,
  };
}
