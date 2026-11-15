// GPT-6 (15/11): o painel mostra os dois indicadores da oferta com os rótulos combinados e, à parte, os testes
// de diagnóstico (utm_source=diagnostico), que nunca entram nos números comerciais. Lê snapshot.funnel.oferta,
// gravado pelo command-center-snapshot do zevanory-public-mirror (PR #1061). Snapshot antigo (sem oferta) → "—".
export type Integrity = 'real' | 'aggregated' | 'webhook_authenticated' | 'no_events' | 'estimated' | 'stale' | 'missing';
export type OfertaMetric = { value: number | null; source: string; updatedAt: string | null; definition: string; integrity: Integrity };
export type FunilOferta = { since: string | null; abriuOferta: OfertaMetric; clicouCheckout: OfertaMetric; diagnostico: { abriuOferta: number; clicouCheckout: number } };
export type OfertaTile = { label: string; value: string; source: string; at: string | null; integrity: Integrity; definition: string };

export const ROTULOS_OFERTA = Object.freeze({ abriu: 'Abriu a página da oferta', clicou: 'Clicou para ir ao checkout', diagnostico: 'Testes de diagnóstico' });
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const fmt = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR'));

function tile(label: string, m: OfertaMetric | undefined): OfertaTile {
  const v = n(m?.value);
  if (!m || v == null) return { label, value: '—', source: m?.source || 'Central de Comando', at: m?.updatedAt ?? null, integrity: 'missing', definition: m?.definition || label };
  return { label, value: fmt(v), source: m.source, at: m.updatedAt, integrity: m.integrity, definition: m.definition };
}

export function funilOfertaTiles(oferta: FunilOferta | undefined | null, generatedAt: string | null): OfertaTile[] {
  const d = oferta?.diagnostico;
  const da = n(d?.abriuOferta), dc = n(d?.clicouCheckout);
  return [
    tile(ROTULOS_OFERTA.abriu, oferta?.abriuOferta),
    tile(ROTULOS_OFERTA.clicou, oferta?.clicouCheckout),
    {
      label: ROTULOS_OFERTA.diagnostico,
      value: da == null || dc == null ? '—' : `${fmt(da)} chegadas · ${fmt(dc)} cliques`,
      source: 'Site (utm_source=diagnostico)', at: oferta?.abriuOferta?.updatedAt ?? generatedAt,
      integrity: da == null || dc == null ? 'missing' : 'real',
      definition: 'Acessos de teste do sistema, contados à parte; não somam nos números de cima nem em visitas, origens ou intenção de compra',
    },
  ];
}
