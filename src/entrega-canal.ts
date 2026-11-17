// GPT-6 (17/11): a entrega por canal mostra o motivo de cada dia devido sem publicação. O snapshot do
// zevanory-public-mirror (#1065) envia perChannel[canal].falhas = [{dia, status, code}] e já exclui os dias anteriores à
// ativação do canal. Snapshot antigo (sem falhas) continua funcionando: só a contagem aparece.
export type FalhaCanal = { dia: string; status: string | null; code: string | null };
export type EntregaCanal = { expected: number; published: number; falhas?: FalhaCanal[] };
const dm = (d: string) => (/^\d{4}-(\d{2})-(\d{2})$/.exec(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) : d);
export function linhaEntrega(v: EntregaCanal): string {
  const base = `${v.published} de ${v.expected} confirmadas`;
  const f = (v.falhas || []).filter(x => x && typeof x.dia === 'string');
  if (!f.length) return base;
  return base + ' · ' + f.map(x => `falhou ${dm(x.dia)}: ${x.code || x.status || 'sem motivo registrado'}`).join(' · ');
}
