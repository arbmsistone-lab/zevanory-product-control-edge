import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Clock3 } from 'lucide-react';
import type { CommercialRecord, CommercialWorkspaceData } from './commercial-model';

// "Mercado de ações" view: every persisted, authenticated event the ZEVANORY engines
// produce, newest first, with the clock of each autonomous engine. Read-only.
const TZ = 'America/Sao_Paulo';
type Engine = { name: string; next: (now: Date) => Date };

function spNow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { y: +v.year, mo: +v.month, d: +v.day, h: +v.hour, mi: +v.minute, s: +v.second };
}
// São Paulo has no DST (UTC-03:00 fixed since 2019).
const spDate = (y: number, mo: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, mo - 1, d, h + 3, mi, 0));
function dailyAt(h: number, mi: number) {
  return (now: Date) => { const t = spNow(now); let n = spDate(t.y, t.mo, t.d, h, mi); if (n <= now) n = new Date(n.getTime() + 86400000); return n; };
}
function everyHourAt(minutes: number[]) {
  return (now: Date) => { const base = new Date(Math.floor(now.getTime() / 3600000) * 3600000); for (let k = 0; k < 3; k++) for (const m of minutes) { const c = new Date(base.getTime() + k * 3600000 + m * 60000); if (c > now) return c; } return base; };
}
const ENGINES: Engine[] = [
  { name: 'Blog · artigo do dia', next: dailyAt(9, 35) },
  { name: 'Telegram · post do dia', next: dailyAt(12, 35) },
  { name: 'YouTube · Short do dia', next: dailyAt(15, 0) },
  { name: 'Bluesky · post do dia', next: dailyAt(19, 35) },
  { name: 'Perfis da marca + Conteúdo Pronto (fila)', next: everyHourAt([5]) },
  { name: 'Prova financeira', next: everyHourAt([15, 45]) },
  { name: 'Robô horário (leads, pós-venda, entregas, alertas)', next: everyHourAt([0]) },
];
const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + 'h ' : '') + String(m).padStart(2, '0') + 'm ' + String(x).padStart(2, '0') + 's'; };
const hhmmss = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; };
const KIND: Record<string, string> = { lead: 'Lead', creative: 'Criativo', publication: 'Publicação', event: 'Evento', support: 'Atendimento', finance: 'Financeiro', evidence: 'Prova' };

export function LiveTape({ data, onRefresh }: { data: CommercialWorkspaceData; onRefresh: () => Promise<void> | void }) {
  const [now, setNow] = useState(() => new Date());
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  // While this view is open, pull fresh data every 10 s (the SSE stream also pushes updates).
  const refresh = useRef(onRefresh); refresh.current = onRefresh;
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh.current(); }, 10000); return () => window.clearInterval(t); }, []);
  const tape = useMemo(() => {
    const all: CommercialRecord[] = [...data.events, ...data.publications, ...data.leads, ...data.support, ...data.finance, ...data.creatives];
    const uniq = new Map(all.map((r) => [r.kind + ':' + r.id, r]));
    return [...uniq.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40);
  }, [data]);
  const fresh = new Set<string>();
  if (seen.current) for (const r of tape) if (!seen.current.has(r.kind + ':' + r.id)) fresh.add(r.kind + ':' + r.id);
  useEffect(() => { seen.current = new Set(tape.map((r) => r.kind + ':' + r.id)); }, [tape]);
  const today = tape.filter((r) => hhmmss(r.createdAt).slice(0, 5) === now.toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' })).length;
  const engines = ENGINES.map((e) => ({ ...e, at: e.next(now) })).sort((a, b) => a.at.getTime() - b.at.getTime());
  return (
    <div className='liveTape'>
      <article className='commercialPanel'>
        <div className='commercialPanelTitle'><Clock3 size={17}/><div><b>Motores autônomos · próxima execução</b><small>Relógio ao vivo · horário de Brasília</small></div></div>
        <div className='liveEngines'>
          {engines.map((e) => <div key={e.name} className='liveEngine'><span>{e.name}</span><strong>{fmt(e.at.getTime() - now.getTime())}</strong><small>{e.at.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}</small></div>)}
        </div>
      </article>
      <article className='commercialPanel'>
        <div className='commercialPanelTitle'><Activity size={17}/><div><b>Fita ao vivo · {today} eventos hoje</b><small>Atualiza sozinha · eventos persistidos e autenticados, mais recentes primeiro</small></div></div>
        <div className='liveRows' tabIndex={0} aria-label='Fita de eventos ao vivo' aria-live='polite'>
          {tape.map((r) => (
            <div key={r.kind + ':' + r.id} className={'liveRow' + (fresh.has(r.kind + ':' + r.id) ? ' liveFresh' : '')}>
              <time>{hhmmss(r.createdAt)}</time>
              <span className='liveKind'>{KIND[r.kind] || r.kind}</span>
              <span className='liveChannel'>{r.channel || '—'}</span>
              <strong>{r.title}</strong>
              <span className='liveStatus'>{r.status}</span>
            </div>
          ))}
          {!tape.length && <div className='commercialEmpty'>Nenhum evento ainda. Os motores acima registram aqui cada ação.</div>}
        </div>
      </article>
    </div>
  );
}
