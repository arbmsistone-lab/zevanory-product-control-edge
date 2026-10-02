const now='2026-10-02T12:50:00-03:00';
const sourceSha='d603f0000bd32e0d1f24b6b7680e8dd0692f2a7e';

const pillars=Array.from({length:16},(_,i)=>({
  id:`P${String(i+1).padStart(2,'0')}`,
  name:[
    'Produto & Arquitetura','UI/UX & Design System','Tipografia, Cores & Geometria','Acessibilidade',
    'Engenharia de Código','Testes & Regressão','Segurança de Aplicação','Supply Chain & Dependências',
    'Privacidade & Compliance','Infraestrutura & Disaster Recovery','Performance & Escalabilidade',
    'Observabilidade & Operação','Dados & Governança de Dados','IA, LLMOps & Agentes',
    'CI/CD, Release & Proveniência','Comercial, Entrega & Ciclo de Vida'
  ][i],
  shortName:`P${String(i+1).padStart(2,'0')}`,
  status:i<12?'proved':i<14?'partial':'blocked',
  controls:8,
  rationale:'Conteúdo mock para validar altura natural, wrapping e ausência de clipping.',
  blocker:i<14?null:'preview_blocker_long_identifier_1234567890abcdef_sem_corte',
  evidence:i<12?['owner-preview:evidence','source:d603f000']:[],
}));
const certification:any={
  standard:'ZEES-16',version:'ZEES-16 v1',profile:'SAAS_TRANSACTIONAL',ready:false,
  rootBlocker:'preview_payment_provider_reconciliation_pending_1234567890abcdef',
  evidenceCount:24,
  summary:{proved:12,partial:2,blocked:2,na:0,external:0,applicable:16,applicableControls:128,provedControls:96},
  pillars
};
const product=(id:string,name:string,slug:string,category:string,description:string,status:string)=>({
  id,name,slug,category,description,publicUrl:'https://zevanory.api.br/',priceCents:119700,currency:'BRL',
  checkoutUrl:'',deliveryModel:'Implantação digital assistida',channels:['Site','Instagram','WhatsApp'],status,
  salesEnabled:false,gates:{legal:true,payment:false,fulfillment:true,support:true},
  audit:{engineering:9.4,infrastructure:9.1,ux:8.8,observability:9.3,lastAuditedAt:now},
  auditOverall:9.15,auditStatus:'audited',notes:'Mock visual, sem persistência.',createdAt:now,updatedAt:now,
  commercialReady:false,blockers:['Identificador_extremamente_longo_para_validar_overflow_1234567890abcdef'],certification
});
const products:any[]=[
  product('preview-product-1','ZEVANORY ONE — Gestão Comercial Integrada','zevanory-one-preview','Software / SaaS transacional','Descrição extensa para validar que o card cresce naturalmente sem cortar texto, sem sobreposição e sem rolagem acidental.','validation'),
  product('preview-product-2','IA na Prática','ia-na-pratica','Conteúdo digital','Curso mock para validar a grade de produtos em todos os temas.','ready'),
  product('preview-product-3','Vendas na Prática','vendas-na-pratica','Conteúdo digital','Curso mock para validação responsiva.','draft'),
];
const record=(id:string,kind:string,title:string,status:string,extra:any={})=>({
  id,kind,title,detail:extra.detail||'Registro mock para inspeção visual.',status,channel:extra.channel||null,
  product:'ZEVANORY',productId:null,valueCents:extra.valueCents??null,source:'owner-preview',sourceKey:id,
  evidence:['owner-preview','source:d603f000'],createdAt:now,updatedAt:now,publishedAt:extra.publishedAt||null,
});
const commercial:any={
  generatedAt:now,tenant:{id:'preview',defaultTenant:false,tenantSource:'owner-preview',isolation:'mock',clientSelectable:false},
  metrics:{leadsToday:16,contactsToday:4,creativesInProduction:3,pendingApproval:2,publishedToday:1,salesCentsToday:129900},
  robot:{state:'ACTIVE',label:'ROBÔ COMERCIAL: PREVIEW',reason:'Dados mock; nenhuma ação externa.',lastHeartbeatAt:now,externalProspecting:false,publishAdapterReady:false,activeChannels:['mock']},
  leads:[record('lead-1','lead','Lead mock com título deliberadamente longo','new',{channel:'mock'})],
  creatives:[
    record('creative-1','creative','Criativo mock principal','approval',{detail:'Texto deliberadamente longo para validar creativeLiveBody sem altura fixa, corte ou sobreposição.'}),
    record('creative-2','creative','Criativo mock secundário','draft',{detail:'Segundo criativo para validar grade, evidências e wrapping.'})
  ],
  publications:[record('publication-1','publication','Publicação mock','published',{channel:'mock',publishedAt:now})],
  events:[record('event-1','event','Evento mock','research')],
  support:[record('support-1','support','Atendimento mock','resolved')],
  finance:[record('finance-1','finance','Receita mock','confirmed',{valueCents:129900})],
  evidence:[record('evidence-1','evidence','Evidência visual mock','confirmed')],
  counts:{leads:1,creatives:2,publications:1,events:1,support:1,finance:1,evidence:1},
};
const dashboard:any={
  systems:[
    {id:'sys-1',name:'ZEVANORY',domain:'zevanory.api.br',status:'healthy',score:98,lastAudit:now,gate:'GREEN',evidence:['preview visual'],sha:'d603f000',source:'mock',availability:100,latencyMs:84,ci:'PASS'},
    {id:'sys-2',name:'Control Center Preview',domain:'preview.mock',status:'healthy',score:100,lastAudit:now,gate:'OWNER REVIEW',evidence:['mock only'],sha:'d603f000',source:'mock',availability:100,latencyMs:1,ci:'PASS'}
  ],
  audits:[
    {id:'audit-1',system:'ZEVANORY',severity:'info',title:'Runtime visual aprovado',detail:'Registro mock para a fila operacional.',createdAt:now},
    {id:'audit-2',system:'ZEVANORY',severity:'warning',title:'Achado mock extenso para validação',detail:'Texto longo para validar altura natural, sem clipping e sem sobreposição.',createdAt:now}
  ],
  improvements:[{id:'imp-1',system:'ZEVANORY',priority:'P1',title:'Validação visual do proprietário',reason:'Revisão humana antes do merge.',state:'validated'}],
  incidents:[{id:'inc-1',system:'Preview',severity:'warning',title:'Incidente mock propositalmente longo',detail:'Não é incidente real; existe somente para testar o layout operacional.',createdAt:now,state:'watching'}],
  policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'Somente evidência reproduzível'},
  lastEngineRun:now,
  certificationRuns:[{id:'run-1',targetId:'product:preview-product-1',targetName:'ZEVANORY ONE — Gestão Comercial Integrada',status:'complete',releaseFingerprint:'preview-d603f000',sourceSha,startedAt:now,finishedAt:now,completedPillars:16,currentPillar:null}]
};
export const ownerPreviewBootstrap:any={
  dashboard,
  globalTrust:{state:'GREEN',sha:sourceSha,evidenceRoot:'owner-preview',policyVersion:'PED-VERSAL-V1.1-SUPREME',quorum:{passed:3,total:3,required:3,conflicts:0,independentKeys:3},zea10:{proven:10,partial:0,blocked:0},engines:[],checkedAt:now},
  operations:{available:true,generatedAt:now,releaseSha:sourceSha,health:{ready:true,live:true,databaseReachable:false,schemaReady:true,requiredTables:1,requiredMigrations:1,missingTables:0,missingMigrations:0},runtime:{sales:'mock-blocked',checkout:'blocked',financial:'mock',whatsapp:'blocked'},control:{globalState:'OWNER_PREVIEW',rootBlocker:'preview_only',decision:'BLOCK'},continuity:{quorumOk:true,mode:'mock-no-external-data',channels:['mock'],whatsappDependencyRequired:false},channels:[{name:'mock',scopeStatus:'ready',releaseGate:'owner-review',commercialExecution:'blocked'}],zees16:{proven:16,partial:0,blocked:0},zea10:{proven:10,partial:0,blocked:0,unknown:0}},
  commercial,cfo:null,products,
  certificationTargets:products.map(p=>({id:`product:${p.id}`,name:p.name,kind:'PRODUTO',publicUrl:p.publicUrl,certification:p.certification})),
  summary:{total:products.length,salesEnabled:0,commercialReady:0,blocked:products.length,certified:0,inCertification:products.length,zeesBlocked:products.length},
};
export const ownerPreviewSourceSha=sourceSha;
