import BoundedTask from './BoundedTask';
import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CircleDollarSign, Landmark, ReceiptText, ShieldCheck, WalletCards } from 'lucide-react';
import type { CfoWorkspaceData } from './cfo-model';
import type { EvidenceField } from './EvidenceReader';

export type CfoPage = 'summary'|'adapters'|'actions'|'receivables';
const fields = (record: object): EvidenceField[] => Object.entries(record).map(([label,value]) => ({label,value:typeof value==='string'?value:JSON.stringify(value,null,2)}));
const hasLongText = (value: unknown): boolean => typeof value==='string' ? Array.from(value).length>80 : Array.isArray(value) ? value.some(hasLongText) : value!==null && typeof value==='object' ? Object.values(value).some(hasLongText) : false;

const money = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 2,
}).format((Number(cents) || 0) / 100);

const adapterLabel = (state: string) => state === 'READY' ? 'PROVADO' : state === 'DEGRADED' ? 'ATENÇÃO' : 'NÃO CONFIGURADO';
const riskLabel = (risk: string) => risk === 'HIGH' ? 'ALTO' : risk === 'MEDIUM' ? 'MÉDIO' : 'BAIXO';

export default function CfoWorkspace({ nativeTask, data, onRead, page, setPage, itemPage, setItemPage }: { nativeTask:boolean; data: CfoWorkspaceData | null; onRead:(fields:EvidenceField[])=>void; page:CfoPage; setPage:(page:CfoPage)=>void; itemPage:number; setItemPage:(page:number)=>void }) {
  const [viewportHeight,setViewportHeight]=useState(()=>window.innerHeight);
  useEffect(()=>{const resize=()=>setViewportHeight(window.innerHeight);window.addEventListener('resize',resize,{passive:true});return()=>window.removeEventListener('resize',resize)},[]);
  if (!data) {
    return <section className='cfoWorkspace'><div className='panel empty'>ZEVANORY CFO indisponível no snapshot administrativo.</div></section>;
  }

  const { metrics } = data;
  const count = page === 'summary' ? 3 : Math.max(1, data[page].length);
  const index = Math.min(itemPage, count - 1);
  const task = nativeTask || viewportHeight<=850 || hasLongText(data);
  if(task) {
    const records=page==='summary'?[]:data[page];
    const record=records[Math.min(itemPage,Math.max(0,records.length-1))];
    return <BoundedTask className='cfoWorkspace cfoTask panel' aria-label='ZEVANORY CFO'>
      <h2>ZEVANORY CFO</h2>
      <button className='secondary' onClick={()=>onRead(fields(data))}>Estado financeiro completo</button>
      <label>Área financeira<select aria-label='Área financeira' value={page} onChange={event=>{setPage(event.target.value as CfoPage);setItemPage(0)}}><option value='summary'>Resumo</option><option value='adapters'>Integrações</option><option value='actions'>Decisões</option><option value='receivables'>Recebíveis</option></select></label>
      {page==='summary'?<p>FAIL-CLOSED · mutações autônomas BLOQUEADAS</p>:<>
        <nav className='commercialPager' aria-label='Registros financeiros'><button className='secondary' disabled={itemPage===0} onClick={()=>setItemPage(itemPage-1)}>Anterior</button><span>{records.length?Math.min(itemPage+1,records.length):0}/{records.length}</span><button className='secondary' disabled={itemPage>=records.length-1} onClick={()=>setItemPage(itemPage+1)}>Próximo</button></nav>
        {record?<button className='primary' onClick={()=>onRead(fields(record))}>Abrir registro financeiro integral</button>:<p>Nenhum registro financeiro disponível.</p>}
      </>}
    </BoundedTask>;
  }
  return (
    <section className='cfoWorkspace cfoPaged' aria-label='ZEVANORY CFO'>
      <button className='secondary' onClick={()=>onRead(fields(data))}>Estado financeiro completo</button>
      <nav className='runtimePages' aria-label='Páginas do CFO'>{([['summary','Resumo'],['adapters','Integrações'],['actions','Decisões'],['receivables','Recebíveis']] as const).map(([key,label]) => <button key={key} className={page===key?'filter active':'filter'} aria-pressed={page===key} onClick={() => {setPage(key);setItemPage(0);}}>{label}</button>)}</nav>
      <div className='formStepNav'><button className='secondary' disabled={index===0} onClick={() => setItemPage(Math.max(0,index-1))}>Anterior</button><span>{index+1}/{count}</span><button className='secondary' disabled={index===count-1} onClick={() => setItemPage(Math.min(count-1,index+1))}>Próxima</button></div>
      {page === 'summary' && <><section className='cfoHero panel'>
        <div>
          <p className='kicker'>NOVO PRODUTO · INTELIGÊNCIA FINANCEIRA</p>
          <h2>ZEVANORY CFO</h2>
          <p className='productDescription'>Caixa, recebíveis, conciliação, cobrança e monitor financeiro em uma camada autônoma de leitura e decisão.</p>
        </div>
        <div className='cfoEngineState'>
          <span className={`cfoState ${data.engine.state.toLowerCase()}`}><Bot size={16}/>{data.engine.state}</span>
          <small>FAIL-CLOSED · mutações autônomas {data.engine.autonomousMutations ? 'ATIVAS' : 'BLOQUEADAS'}</small>
          <p>{data.engine.reason}</p>
        </div>
      </section>

      <section className='cfoMetrics' data-page={index} aria-label='Indicadores financeiros'>
        <article><WalletCards size={18}/><span>Saldo consolidado</span><strong>{money(metrics.balanceCents)}</strong></article>
        <article><ReceiptText size={18}/><span>A receber</span><strong>{money(metrics.receivableOpenCents)}</strong></article>
        <article className={metrics.overdueCents > 0 ? 'attention' : ''}><AlertTriangle size={18}/><span>Em atraso</span><strong>{money(metrics.overdueCents)}</strong></article>
        <article><CircleDollarSign size={18}/><span>Projeção 30 dias</span><strong>{money(metrics.projected30dCents)}</strong></article>
        <article><Landmark size={18}/><span>Reserva tributária indicativa</span><strong>{money(metrics.taxReserveSuggestedCents)}</strong></article>
        <article><ShieldCheck size={18}/><span>Recebíveis alto risco</span><strong>{metrics.highRiskReceivables}</strong></article>
      </section>

      </>}
      {page !== 'summary' && <section className='cfoGrid'>
        {page==='adapters' && <article className='panel cfoPanel'>
          <div className='panelhead'><div><p className='kicker'>INTEGRAÇÕES</p><h3>Adaptadores financeiros</h3></div></div>
          <div className='cfoAdapterList'>
            {data.adapters.slice(index,index+1).map(adapter => (
              <div className='cfoAdapter' key={adapter.id}>
                <div><b>{adapter.label}</b><small>{adapter.mode} · {adapter.lastSyncAt ? new Date(adapter.lastSyncAt).toLocaleString('pt-BR') : 'sem sincronização'}</small></div>
                <span className={`cfoAdapterState ${adapter.state.toLowerCase()}`}>{adapterLabel(adapter.state)}</span>
                <p>{adapter.state === 'READY' ? adapter.evidence[0] || 'Evidência registrada.' : adapter.blocker}</p>
              </div>
            ))}
          </div>
        </article>}

        {page==='actions' && <article className='panel cfoPanel'>
          <div className='panelhead'><div><p className='kicker'>DECISÕES</p><h3>Fila do CFO</h3></div><span className='certSeal blocked'>EXECUÇÃO EXTERNA BLOQUEADA</span></div>
          <div className='cfoActionList'>
            {data.actions.slice(index,index+1).map(action => (
              <div className='cfoAction' key={action.id}>
                <div><b>{action.title}</b><small>{action.kind} · {action.state}</small></div>
                {action.valueCents != null && <strong>{money(action.valueCents)}</strong>}
                <p>{action.detail}</p>
              </div>
            ))}
            {data.actions.length === 0 && <div className='empty'>Nenhuma ação financeira sugerida com os dados disponíveis.</div>}
          </div>
        </article>}
      </section>}

      {page==='receivables' && <section className='panel cfoPanel'>
        <div className='panelhead'>
          <div><p className='kicker'>CONTAS A RECEBER</p><h3>Risco e cobrança</h3></div>
          <span className='cfoMiniMetric'>Hoje: <b>{money(metrics.dueTodayCents)}</b></span>
        </div>
        <div className='cfoReceivableTable'>
          <div className='cfoReceivableRow head'><span>Cliente</span><span>Vencimento</span><span>Em aberto</span><span>Risco</span><span>Origem</span></div>
          {data.receivables.slice(index,index+1).map(item => (
            <div className='cfoReceivableRow' key={item.id}>
              <span><b>{item.customer}</b><small>{item.document || 'sem documento'}</small></span>
              <span>{new Date(item.dueAt).toLocaleDateString('pt-BR')}<small>{item.daysLate > 0 ? `${item.daysLate} dias de atraso` : 'no prazo'}</small></span>
              <strong>{money(item.openCents)}</strong>
              <span className={`cfoRisk ${item.risk.toLowerCase()}`}>{riskLabel(item.risk)}</span>
              <span>{item.source}</span>
            </div>
          ))}
          {data.receivables.length === 0 && <div className='empty'>Nenhum recebível real foi ingerido. O CFO não cria dados financeiros fictícios.</div>}
        </div>
      </section>}
    </section>
  );
}
