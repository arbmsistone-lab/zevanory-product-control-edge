import {bootstrap,views} from './control-center-fixtures.mjs';
export {views};
export const sizes=[[1920,1080],[1680,1050],[1536,864],[1440,900],[1366,768],[1280,720],[1024,768],[768,1024],[430,932],[412,915],[390,844],[375,812],[360,800],[360,640],[1366,600]];
const now='2026-09-30T00:00:00.000Z';
export function fixture(state){
 const data=structuredClone(bootstrap);
 // This matrix executes only the ZEVANORY application contract.
 data.products=data.products.filter(p=>!/^arbm/i.test(p.slug));for(const p of data.products)p.channels=['web'];
 data.certificationTargets=data.certificationTargets.filter(t=>!/^ARBM/i.test(t.name));
 data.globalTrust.checkedAt=new Date().toISOString();
 data.cfo={schema:'zevanory-cfo-workspace/v1',generatedAt:now,engine:{state:'BLOCKED',failClosed:true,autonomousMutations:false,reason:'Evidência financeira pendente.'},metrics:{balanceCents:100000,receivableOpenCents:800000,overdueCents:50000,dueTodayCents:90000,inflow30dCents:500000,outflow30dCents:100000,projected30dCents:900000,taxReserveSuggestedCents:60000,highRiskReceivables:2},adapters:[{id:'adapter-0',label:'Adaptador de auditoria',state:'READY',mode:'READ',lastSyncAt:null,evidence:['evidência primeira','evidência final'],blocker:null}],actions:[{id:'action-0',kind:'RECONCILE',title:'Conferir recebível',detail:'Sem execução externa.',state:'SUGGESTED',requiresApproval:true,sourceIds:['receivable-0'],createdAt:now,updatedAt:now}],receivables:[{id:'receivable-0',customer:'Cliente de auditoria',document:'Documento completo',dueAt:now,amountCents:800000,paidCents:0,openCents:800000,daysLate:0,risk:'HIGH',status:'OPEN',source:'fixture',evidence:['evidência primeira','evidência final'],createdAt:now,updatedAt:now}],recentTransactions:[{id:'transaction-0',kind:'INFLOW',amountCents:800000,occurredAt:now,category:'recebimento',counterparty:'Cliente de auditoria',source:'fixture',sourceKey:'transaction-0',reconciled:false,evidence:['evidência primeira','evidência final'],createdAt:now}]};
 if(state==='EMPTY'){data.products=[];data.certificationTargets=[];for(const key of ['leads','creatives','publications','events','support','finance','evidence'])data.commercial[key]=[];for(const key of ['adapters','actions','receivables','recentTransactions'])data.cfo[key]=[];data.operations.channels=[];}
 if(state==='PARTIAL'){data.operations.available=false;data.globalTrust.state='BLOCKED';data.globalTrust.blockers=['evidência parcial'];data.cfo.engine.state='STANDBY';data.commercial.robot.state='STANDBY';}
 if(['MAX_REALISTIC_DATA','LONG_TEXT','UNICODE'].includes(state)){
  const text=state==='MAX_REALISTIC_DATA'?'Registro de auditoria':state==='LONG_TEXT'?'Texto integral com quebra\n'.repeat(50):'á😀漢字é\n'.repeat(100);
  for(const key of ['leads','creatives','publications','events','support','finance','evidence'])data.commercial[key]=Array.from({length:40},(_,i)=>({...data.commercial[key][0],id:key+'-'+i,title:text,detail:text,source:text,evidence:[text,'última evidência 😀']}));
  data.products=Array.from({length:9},(_,i)=>({...data.products[0],id:'zev-'+i,name:text,description:text,notes:text,category:text,deliveryModel:text,channels:['web']}));
  data.certificationTargets=data.products.map(p=>({id:'product:'+p.id,name:p.name,kind:'product',publicUrl:p.publicUrl,certification:p.certification}));
  data.operations.channels=Array.from({length:12},(_,i)=>({name:'web-'+i,scopeStatus:'ready',releaseGate:'blocked',commercialExecution:'blocked'}));
  data.operations.control.rootBlocker=text;
  for(const key of ['adapters','actions','receivables','recentTransactions'])data.cfo[key]=Array.from({length:40},(_,i)=>({...data.cfo[key][0],id:key+'-'+i,...(key==='adapters'?{label:text,evidence:[text,'última evidência 😀']}:key==='actions'?{title:text,detail:text}:key==='receivables'?{customer:text,document:text,source:text,evidence:[text,'última evidência 😀']}:{counterparty:text,evidence:[text,'última evidência 😀']})}));
  data.cfo.engine.reason=text;
  data.dashboard.incidents=Array.from({length:20},(_,i)=>({id:'incident-'+i,title:text,detail:text,system:'ZEVANORY',severity:'high',state:'open',createdAt:now}));
  data.dashboard.audits=Array.from({length:20},(_,i)=>({id:'audit-'+i,title:text,detail:text,system:'ZEVANORY',severity:'high',createdAt:now}));
 }
 return data;
}
