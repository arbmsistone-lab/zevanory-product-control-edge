import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const axePath=require.resolve('axe-core/axe.min.js');

const baseUrl=process.env.CONTROL_CENTER_AUDIT_URL || 'http://127.0.0.1:4173';
const outDir=process.env.CONTROL_CENTER_AUDIT_OUT || 'control-center-audit';
const auditSha=/^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA||'')?process.env.GITHUB_SHA:'0000000000000000000000000000000000000000';
const now='2026-09-26T16:00:00.000Z';
const record=(id,kind,title,status,extra={})=>({
  id,kind,title,detail:extra.detail||'Registro auditável.',status,
  channel:extra.channel||null,product:extra.product||'ZEVANORY',productId:null,
  valueCents:extra.valueCents??null,source:extra.source||'ped-runtime',
  sourceKey:id,evidence:['ped-runtime'],createdAt:now,updatedAt:now,publishedAt:extra.publishedAt||null,
});
const commercial={
  generatedAt:now,
  metrics:{leadsToday:16,contactsToday:4,creativesInProduction:3,pendingApproval:2,publishedToday:1,salesCentsToday:129900},
  robot:{state:'ACTIVE',label:'ROBÔ COMERCIAL: ATIVO',reason:'Auditoria PED.',lastHeartbeatAt:now,externalProspecting:true,publishAdapterReady:false,activeChannels:['web']},
  leads:[record('lead-1','lead','Lead de auditoria','new',{channel:'web'})],
  creatives:[record('creative-1','creative','Criativo de auditoria','approval')],
  publications:[record('publication-1','publication','Publicação auditada','published',{channel:'web',publishedAt:now})],
  events:[record('event-1','event','Evento auditável','research')],
  support:[record('support-1','support','Atendimento auditável','resolved')],
  finance:[record('finance-1','finance','Receita confirmada','confirmed',{valueCents:129900,source:'sale'})],
  evidence:[record('evidence-1','evidence','Evidência PED','confirmed')],
  counts:{leads:1,creatives:1,publications:1,events:1,support:1,finance:1,evidence:1},
};
const productPillars=Array.from({length:16},(_,index)=>({
  id:`P${String(index+1).padStart(2,'0')}`,
  name:`Pilar de auditoria ${index+1}`,
  shortName:`P${String(index+1).padStart(2,'0')}`,
  status:index<12?'proved':index<14?'partial':'blocked',
  controls:8,
  rationale:'Evidência adversarial longa para validar wrapping, altura natural e ausência de clipping na interface administrativa.',
  blocker:index<12?null:'blocker_extremamente_longo_sem_espacos_para_validar_overflow_wrap_anywhere_1234567890',
  evidence:index<12?['ped-runtime:evidence:long-string-1234567890abcdef']:[],
}));
const productCertification={
  standard:'ZEES-16',
  version:'ZEES-16 v1',
  profile:'SAAS_TRANSACTIONAL',
  ready:false,
  rootBlocker:'payment_provider_reconciliation_pending_with_very_long_identifier_1234567890abcdef',
  evidenceCount:24,
  summary:{proved:12,partial:2,blocked:2,na:0,external:0,applicable:16,applicableControls:128,provedControls:96},
  pillars:productPillars,
};
const productFixtures=[
  {
    id:'product-long-1',
    name:'ZEVANORY ONE — Gestão Comercial Integrada com Nome Extremamente Longo para Auditoria Responsiva',
    slug:'zevanory-one-auditoria-responsiva',
    category:'Software / SaaS transacional com categoria longa',
    description:'Produto com descrição propositalmente extensa para comprovar que o card cresce naturalmente, preserva hierarquia, não corta texto, não cria sobreposição e continua legível em desktop, tablet e mobile.',
    publicUrl:'https://zevanory.api.br/solucoes/zevanory-one?utm_source=control-center&extremely_long_parameter=1234567890abcdef1234567890abcdef',
    priceCents:119700,
    currency:'BRL',
    checkoutUrl:'https://zevanory.api.br/checkout/zevanory-one',
    deliveryModel:'Implantação digital assistida + acesso SaaS recorrente',
    channels:['Site','Instagram','WhatsApp','LinkedIn','Mercado Livre','Nuvemshop'],
    status:'validation',
    salesEnabled:false,
    gates:{legal:true,payment:false,fulfillment:true,support:true},
    audit:{engineering:9.4,infrastructure:9.1,ux:8.8,observability:9.3,lastAuditedAt:now},
    auditOverall:9.15,
    auditStatus:'audited',
    notes:'Notas administrativas extensas para auditoria de layout.',
    createdAt:now,updatedAt:now,
    commercialReady:false,
    blockers:[
      'Reconciliação financeira pendente no provedor principal com identificador_excessivamente_longo_sem_espacos_1234567890abcdef',
      'Evidência final do checkout ainda não anexada ao release atual',
      'Canal comercial WhatsApp permanece fail-closed até prova externa',
    ],
    certification:productCertification,
  },
  {
    id:'product-long-2',
    name:'ARBM SIST — Orquestração Multi-Provider',
    slug:'arbm-sist',
    category:'Automação e IA',
    description:'Orquestração de IA e automações com governança, failover, evidência reproduzível e independência de provedor.',
    publicUrl:'https://zevanory.api.br/solucoes/arbm-sist',
    priceCents:119700,
    currency:'BRL',
    checkoutUrl:'',
    deliveryModel:'Digital',
    channels:['Site','LinkedIn'],
    status:'ready',
    salesEnabled:false,
    gates:{legal:true,payment:true,fulfillment:true,support:true},
    audit:{engineering:9.8,infrastructure:9.7,ux:9.2,observability:9.6,lastAuditedAt:now},
    auditOverall:9.575,
    auditStatus:'audited',
    notes:'',
    createdAt:now,updatedAt:now,
    commercialReady:false,
    blockers:['global_sale_disabled'],
    certification:productCertification,
  },
  {
    id:'product-long-3',
    name:'Combo IA + Vendas',
    slug:'combo-ia-vendas',
    category:'Conteúdo digital',
    description:'Conteúdo digital integrado com IA aplicada e processo comercial.',
    publicUrl:'https://zevanory.api.br/solucoes/combo-ia-vendas',
    priceCents:19990,
    currency:'BRL',
    checkoutUrl:'',
    deliveryModel:'Digital',
    channels:['Site'],
    status:'draft',
    salesEnabled:false,
    gates:{legal:false,payment:false,fulfillment:true,support:true},
    audit:{engineering:null,infrastructure:null,ux:null,observability:null,lastAuditedAt:null},
    auditOverall:null,
    auditStatus:'pending',
    notes:'',
    createdAt:now,updatedAt:now,
    commercialReady:false,
    blockers:['legal_gate_pending','payment_gate_pending'],
    certification:productCertification,
  },
];
const certificationFixtures=productFixtures.map(product=>({
  id:`product:${product.id}`,
  name:product.name,
  kind:'product',
  publicUrl:product.publicUrl,
  certification:product.certification,
}));
const bootstrap={
  dashboard:{systems:[],audits:[],improvements:[],incidents:[],policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'FALSE_GREEN=0'},lastEngineRun:now,certificationRuns:[]},
  globalTrust:{state:'GREEN',sha:'ped-runtime',evidenceRoot:'ped-runtime',policyVersion:'PED-VERSAL-V1.1-SUPREME',quorum:{passed:3,total:3,required:3,conflicts:0,independentKeys:3},zea10:{proven:10,partial:0,blocked:0},engines:[],checkedAt:now},
  operations:{available:true,generatedAt:now,releaseSha:'ped-runtime',health:{ready:true,live:true,databaseReachable:true,schemaReady:true,requiredTables:1,requiredMigrations:1,missingTables:0,missingMigrations:0},runtime:{sales:'globally-blocked',checkout:'blocked',financial:'ready',whatsapp:'blocked'},control:{globalState:'operational_commercial_blocked',rootBlocker:'global_sale_disabled',decision:'BLOCK'},continuity:{quorumOk:true,mode:'multi-provider',channels:['web'],whatsappDependencyRequired:false},channels:[{name:'web',scopeStatus:'ready',releaseGate:'green',commercialExecution:'blocked'}],zees16:{proven:16,partial:0,blocked:0},zea10:{proven:10,partial:0,blocked:0,unknown:0}},
  commercial,cfo:null,products:productFixtures,certificationTargets:certificationFixtures,
  summary:{total:3,salesEnabled:0,commercialReady:0,blocked:3,certified:0,inCertification:3,zeesBlocked:3},
};

// Revenue Command Center fixture: dense, realistic shape so every tab is audited
// with full lists (pagination must keep everything inside the viewport).
const ccMetric=(value,definition,integrity='real')=>({value,source:'Fonte auditada',updatedAt:now,definition,integrity});
const commandCenter={ok:true,servedAt:now,
  sales:{updatedAt:now,totals:{approved:9,grossCents:229300,netCents:201400,feesCents:21900,affiliateCents:6000,refunded:1,chargeback:0,protest:0,reversedGrossCents:19700,abandoned:4,canceled:2,expired:1},
    byDay:{'2026-09-26':{approved:2,grossCents:44400,netCents:39000}},
    byProduct:Object.fromEntries(['IA na Prática','Vendas na Prática','Lucro & Caixa','Combo IA + Vendas','Negócio Completo','Conteúdo Pronto'].map((n,i)=>[n,{approved:i+1,grossCents:19700*(i+1),netCents:17300*(i+1),reversed:0}])),
    bySource:Object.fromEntries(['youtube','telegram','bluesky','google','direto','instagram','tiktok'].map((n,i)=>[n,{approved:7-i,grossCents:19700*(7-i),netCents:17000*(7-i),reversed:0}])),
    recent:Array.from({length:12},(_,i)=>({ref:'r'+i,kind:i%5?'approved':'refunded',product:'Lucro & Caixa com nome de produto bem longo para validar quebra',grossCents:24700,netCents:22200,src:'youtube',at:now}))},
  snapshot:{generatedAt:now,day:'2026-09-26',
    goals:[{id:'first-sale',label:'1ª venda',target:1,unit:'vendas',deadline:'2026-10-18',current:1},{id:'fortnight',label:'Quinzena',target:80000,unit:'centavos',deadline:'2026-10-25',current:44400},{id:'month',label:'Mês',target:200000,unit:'centavos',deadline:'2026-11-10',current:229300},{id:'paid-traffic',label:'Vendas para liberar tráfego pago',target:7,unit:'vendas',deadline:null,current:9}],
    revenue:{salesToday:ccMetric(2,'Vendas hoje','webhook_authenticated')},
    funnel:{visitors7:ccMetric(1840,'Pessoas','aggregated'),views7:ccMetric(4210,'Páginas','aggregated'),leads7:ccMetric(37,'Leads','aggregated'),views30:ccMetric(12890,'Visitas','aggregated'),intents30:ccMetric(212,'Intenções','aggregated'),sales30:ccMetric(9,'Vendas','webhook_authenticated'),
      sources:Object.fromEntries(['youtube','telegram','bluesky','google','bing','direto','instagram','tiktok','whatsapp','email'].map((n,i)=>[n,{views:3000-i*250,checkout_intent:30-i,hotmart_view:12,subscribe_click:2}])),pages:[]},
    acquisition:{reachAt:now,
      channels:[{channel:'YouTube',audience:ccMetric(1240,'Inscritos'),views:ccMetric(88120,'Visualizações'),delta7:120},{channel:'Telegram',audience:ccMetric(310,'Membros'),delta7:12},{channel:'Bluesky',audience:ccMetric(96,'Seguidores'),delta7:-1},{channel:'TikTok',audience:ccMetric(null,'Seguidores'),note:'Publicação por agendamento no TikTok Studio'},{channel:'Instagram/Facebook',audience:ccMetric(null,'Seguidores')}],
      youtubeRecent:Array.from({length:15},(_,i)=>({t:'IA para salão de beleza: 1 dica prática #shorts '+i,d:now,views:1500-i*90,likes:40-i,privacy:'public',url:'https://youtube.com/shorts/v'+i})),
      history:[],
      publications:{expected:42,published:40,pct:95.2,perChannel:{blog:{expected:7,published:7},telegram:{expected:7,published:7},bluesky:{expected:7,published:6},youtube:{expected:7,published:7},youtube_dica:{expected:7,published:7},youtube_calc:{expected:7,published:6}}},
      today:['blog','telegram','bluesky','youtube_dica','youtube','youtube_calc'].map((c,i)=>({channel:c,status:i===5?'erro':'publicado',url:'https://zevanory.api.br/x'+i,at:now,code:i===5?'provider_http_503':null}))},
    autonomy:{runs:{scheduledRuns:212,succeeded:205,failed:7,recoveredAutomatically:6,unrecovered:1,manualRuns:3,autonomyPct:97.2,mttrMinutes:84,failuresList:Array.from({length:7},(_,i)=>({workflow:'youtube-autonomous-short.yml',at:now,recovered:i!==3}))},
      agenda:Array.from({length:10},(_,i)=>({id:'a'+i,agent:'Motor de Vídeo',task:'Short: dica de IA por ramo (YouTube + cross-post) '+i,next:now})),
      ownerOnly:[{what:'Aprovar Instagram/Facebook',why:'Aguardando revisão da Meta',status:'aguardando terceiro'},{what:'Aprovar Pinterest',why:'Aguardando aprovação do app',status:'aguardando terceiro'},{what:'Trocar nome do TikTok',why:'Liberado a partir de 18/10',status:'agendado'},{what:'Liberar tráfego pago',why:'Só após a 7ª venda',status:'pronto para decidir'}]},
    operations:{probes:[{url:'https://zevanory.api.br/api/health',http:200,ms:182,ok:true},{url:'https://vendas.zevanory.api.br/solucoes',http:200,ms:240,ok:true},{url:'https://controle.zevanory.api.br/',http:200,ms:131,ok:true}],salesSwitch:{open:false},checkoutMode:'Hotmart vendendo; checkout próprio bloqueado até LIBERAR VENDAS',deploys:Array.from({length:5},()=>({at:now,conclusion:'success'}))},
    forecast:{status:'ok',horizonDays:30,salesExpected:13.5,salesInterval80:[9,18],revenueExpectedCents:344000,revenueInterval80Cents:[229000,458000],basis:'9 vendas em 20 dias'},
    experiments:[{id:'short-format',title:'Formato do Short',hypothesis:'h',metric:'m',decision:'d',status:'collecting',verdict:'Coletando dados: ainda não há base para concluir.',progress:'3/7 vídeos no braço com menos dados'},{id:'product-page-v2',title:'Página de produto v2',hypothesis:'h',metric:'m',decision:'d',status:'winner',verdict:'Melhorou: 1,2% → 2,9% de intenção (p=0,004).'},{id:'nurture-match',title:'E-mail com o produto certo',hypothesis:'h',metric:'m',decision:'d',status:'tracking',verdict:'12 clique(s) vindos do e-mail de oferta em 30 dias.'}],
    costs:{rule:'Custo operacional adicional: R$ 0,00.',incrementalCostBRL:0,usageAt:now,providers:Array.from({length:11},(_,i)=>({id:'pr'+i,name:'Cloudflare Workers + KV '+i,uses:'Site',plan:'Workers Free',freeLimit:'100 mil requisições/dia; KV 100 mil leituras e 1 mil gravações/dia',billingRisk:'nenhum (plano gratuito bloqueia ao atingir o limite)',verifiable:i!==3,fallback:'—',usedToday:i===2?6600:null,guard:i===2?8500:null}))},
    market:{generatedAt:now,method:'m',integrity:'real',top:Array.from({length:12},(_,i)=>({name:'Salão de beleza '+i,slug:'s'+i,score:71.3-i,product:'lucro-e-caixa',topQueries:['planilha salão de beleza controle financeiro']})),ideas:[{title:'Kit de planilhas para padaria',basis:'4 buscas por planilha/controle/modelo',evidence:['planilha padaria'],status:'proposta (não lançada)'}]},
    inventory:{criterion:'Um processo elegível conta como autônomo somente se a evidência dele estiver dentro da janela de frescor no momento da medição.',eligible:24,provenAutonomous:15,pct:62.5,byState:{autonomous:17,partial:3,blocked_third_party:2,manual:1},
      dependencies:Array.from({length:9},(_,i)=>({id:'d'+i,name:'Atendimento automático do WhatsApp com nome longo para quebrar linha '+i,state:'partial',dependency:'Ainda não comprovado em produção; e-mail de suporte é lido por pessoa.',impact:['high','medium','low'][i%3]})),
      processes:Array.from({length:24},(_,i)=>({id:'p'+i,area:'Aquisição',agent:'Motor Social',name:'Post diário no Telegram '+i,eligible:true,state:i%5?'autonomous':'partial',proven:i%3!==0,lastEvidence:now,how:'publicação confirmada'}))},
    recommendations:Array.from({length:6},(_,i)=>({title:'Canal que mais traz visitas: youtube '+i,evidence:'3000 visitas e 42 intenções em 30 dias',action:'Manter frequência e repetir os formatos que geraram intenção',confidence:'média',risk:'baixo',cost:'R$ 0'}))}};
const ccTabs=['Agora','IA','Desempenho','Funciona?','Operação','Financeiro','Rumo'];
const views=[
  ['overview','Visão Geral'],['products','Produtos'],['commercial','Comercial'],['creatives','Criativos'],
  ['approvals','Aprovações'],['publications','Publicações'],['prospecting','Prospecção'],['crm','CRM/Vendas'],
  ['support','Atendimento'],['finance','Financeiro'],['cfo','ZEVANORY CFO'],['evidence','Evidências'],
  ['operations','Operações técnicas'],['governance','ZEES-16 / Governança'],
];
const sizes=[
  {name:'large',width:1920,height:1080,deviceScaleFactor:1},
  {name:'desktop',width:1440,height:900,deviceScaleFactor:1},
  {name:'owner-1536x730',width:1536,height:730,deviceScaleFactor:1.25},
  {name:'tablet',width:768,height:1024,deviceScaleFactor:1},
  {name:'mobile',width:375,height:812,deviceScaleFactor:1},
];
const themes=['dark','light'];
const allowedFonts=new Set([12,14,16,18,21,24,25,28,30,37]);
await fs.mkdir(outDir,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[]; let failed=false;

const navigationRoute={
  overview:{primary:'overview',primaryLabel:'Visão Geral'},
  products:{primary:'products',primaryLabel:'Produtos'},
  commercial:{primary:'commercial',primaryLabel:'Comercial'},
  creatives:{primary:'content',primaryLabel:'Conteúdo',subLabel:'Criativos'},
  approvals:{primary:'content',primaryLabel:'Conteúdo',subLabel:'Aprovações'},
  publications:{primary:'content',primaryLabel:'Conteúdo',subLabel:'Publicações'},
  prospecting:{primary:'commercial',primaryLabel:'Comercial',subLabel:'Prospecção'},
  crm:{primary:'commercial',primaryLabel:'Comercial',subLabel:'CRM/Vendas'},
  support:{primary:'support',primaryLabel:'Atendimento'},
  finance:{primary:'finance',primaryLabel:'Financeiro'},
  cfo:{primary:'finance',primaryLabel:'Financeiro',subLabel:'ZEVANORY CFO'},
  evidence:{primary:'evidence',primaryLabel:'Evidências'},
  operations:{primary:'system',primaryLabel:'Sistema',subLabel:'Saúde do sistema'},
  governance:{primary:'system',primaryLabel:'Sistema',subLabel:'Qualidade e certificação'},
};

async function navigate(page,width,key,label){
  const route=navigationRoute[key];
  if(!route) throw new Error('Unknown audit navigation key: '+key);
  if(width<=960){
    const sel=page.getByLabel('Selecionar área do Control Center');
    await sel.waitFor({state:'visible',timeout:15000});
    await sel.selectOption(key);
    return;
  }
  const nav=page.getByRole('navigation',{name:'Áreas do ZEVANORY'});
  await nav.getByRole('button',{name:route.primaryLabel,exact:true}).click();
  if(route.subLabel){
    await nav.getByRole('button',{name:route.subLabel,exact:true}).click();
  }
}

for(const size of sizes){
  for(const theme of themes){
    const context=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.deviceScaleFactor||1,colorScheme:theme,reducedMotion:'reduce'});
    await context.addInitScript(({theme})=>{
      localStorage.setItem('arbm_admin_session','ped-runtime-session');
      localStorage.setItem('zpc_theme',theme);
    },{theme});
    const page=await context.newPage();
    const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e)));
    const consoleErrors=[]; page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
    await page.route('**/api/admin/bootstrap',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap)}));
    await page.route('**/api/admin/overview',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      elapsedMs:48,
      sources:{
        health:{ok:true,elapsedMs:24,error:null},
        status:{ok:true,elapsedMs:26,error:null},
        control:{ok:true,elapsedMs:18,error:null},
        continuity:{ok:true,elapsedMs:22,error:null},
        inventory:{ok:true,elapsedMs:31,error:null},
      },
      operations:bootstrap.operations,
      summary:{"total":5,"salesEnabled":3,"commercialReady":3,"blocked":2},
    })}));
    await page.route(/\/(control\/)?api\/commercial\/stream$/,r=>r.fulfill({status:200,contentType:'text/event-stream; charset=utf-8',headers:{'cache-control':'no-cache','connection':'keep-alive'},body:'event: commercial-update\ndata: {"seq":1,"at":"2026-09-26T16:00:00.000Z"}\n\n'}));
    await page.route('**/api/commercial/funnel',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,summary:null,readiness:{status:'AGUARDAR',headline:'Ainda não é hora de pagar anúncios.',nextMilestone:'Vendas abertas em produção: vendas ainda fechadas (modo teste).',criteria:[{id:'sales-open',label:'Vendas abertas em produção',ok:false,detail:''}],metrics:{visitors:0,paid:0,conversion:0,conversionLow:0,aov:0,refundRate:0,maxCpa:0,maxCpc:0,breakEvenRoas:0},plan:null}})}));
    await page.route(/\/api\/sales\/(state|switch)$/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,requested:false,open:false,switchedAt:null,preflightFresh:true,preflight:{ok:false,at:'2026-09-26T16:00:00.000Z',checks:[{id:'mercadopago_production_token',ok:false,detail:'credencial de teste'}]}})}));
    // Dark theme renders the real zero-sales state (no Hotmart events yet); light renders a dense ledger.
    const ccPayload=theme==='dark'?{...commandCenter,sales:null}:commandCenter;
    await page.route('**/api/owner/command-center',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ccPayload)}));
    await page.route('**/global-trust.json*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap.globalTrust)}));
    await page.route('**/version.json*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sha:auditSha,runtime:'audit-preview'})}));
    await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:30000});
    if(size.width<=900) await page.getByLabel('Selecionar área do Control Center').waitFor({state:'visible',timeout:15000});
    else await page.locator('.zpcSidebarBrand').filter({hasText:'ZEVANORY'}).waitFor({state:'visible',timeout:15000});
    await page.addScriptTag({path:axePath});

    const auditViews=views.flatMap(([key,label])=>key==='overview'?ccTabs.map((_,i)=>[key,label,i]):[[key,label,0]]);
    for(const [key,label,overviewPage] of auditViews){
      const row={viewport:size,theme,view:key,label,overviewPage,failures:[]};
      const fail=(code,detail)=>{row.failures.push({code,detail});failed=true;};
      try{
        await navigate(page,size.width,key,label);
        if(key==='overview'){
          await page.getByRole('navigation',{name:'Perguntas da Central de Comando'}).getByRole('button',{name:ccTabs[overviewPage],exact:true}).click({timeout:15000});
        }
      }catch(e){fail('NAVIGATION',String(e));report.push(row);continue;}
      await page.waitForTimeout(80);
      const dom=await page.evaluate(({allowedFonts})=>{
        const de=document.documentElement, body=document.body, main=document.querySelector('main');
        const rootStyle=getComputedStyle(de);
        const visible=[...document.querySelectorAll('main *')].filter(el=>{
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';
        });
        const horizontal=visible.map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,cls:String(el.className),left:r.left,right:r.right,top:r.top,bottom:r.bottom};})
          .filter(x=>x.left<-1||x.right>innerWidth+1).slice(0,20);
        const clips=[];
        const textClips=[];
        const clipsAxis=value=>value==='hidden'||value==='clip';
        for(const el of visible){
          if(el instanceof SVGElement) continue;
          const r=el.getBoundingClientRect();
          const s=getComputedStyle(el);
          const selfX=clipsAxis(s.overflowX)&&el.scrollWidth>el.clientWidth+1;
          const selfY=clipsAxis(s.overflowY)&&el.scrollHeight>el.clientHeight+1;
          if(selfX||selfY){
            clips.push({tag:el.tagName,cls:String(el.className),kind:'self',x:selfX,y:selfY,client:[el.clientWidth,el.clientHeight],scroll:[el.scrollWidth,el.scrollHeight]});
          }
          if((el.textContent||'').trim()&&el.children.length===0){
            const truncatedX=el.scrollWidth>el.clientWidth+1;
            const truncatedY=el.scrollHeight>el.clientHeight+1;
            const ellipsis=s.textOverflow==='ellipsis';
            if((truncatedX||truncatedY)&&(ellipsis||clipsAxis(s.overflowX)||clipsAxis(s.overflowY))){
              textClips.push({tag:el.tagName,cls:String(el.className),text:(el.textContent||'').trim().slice(0,100),x:truncatedX,y:truncatedY,textOverflow:s.textOverflow,overflowX:s.overflowX,overflowY:s.overflowY});
            }
          }
          let parent=el.parentElement;
          while(parent&&parent!==body&&parent!==de){
            const ps=getComputedStyle(parent);
            const pr=parent.getBoundingClientRect();
            const clipX=clipsAxis(ps.overflowX)&&(r.left<pr.left-1||r.right>pr.right+1);
            const clipY=clipsAxis(ps.overflowY)&&(r.top<pr.top-1||r.bottom>pr.bottom+1);
            if(clipX||clipY){
              clips.push({tag:el.tagName,cls:String(el.className),kind:'ancestor',ancestor:parent.tagName+'.'+String(parent.className),x:clipX,y:clipY});
              break;
            }
            parent=parent.parentElement;
          }
          if(clips.length>=30&&textClips.length>=30) break;
        }
        const textDebt=visible.filter(el=>(el.textContent||'').trim() && el.children.length===0).map(el=>({tag:el.tagName,cls:String(el.className),font:parseFloat(getComputedStyle(el).fontSize)}))
          .filter(x=>!allowedFonts.includes(x.font)).slice(0,30);
        const direct=main?[...main.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,cls:String(el.className),top:r.top,bottom:r.bottom,left:r.left,right:r.right};}):[];
        const ccGeometry=[];
        const ccRoot=document.querySelector('.ccRoot');
        if(ccRoot){
          const rootBox=ccRoot.getBoundingClientRect();
          const inCc=visible.filter(el=>ccRoot.contains(el)&&el!==ccRoot);
          for(const el of inCc){const b=el.getBoundingClientRect(); if(b.right>rootBox.right+1||b.bottom>rootBox.bottom+1||b.left<rootBox.left-1) ccGeometry.push('OUTSIDE:'+String(el.className));}
          const texts=inCc.filter(el=>el.children.length===0&&(el.textContent||'').trim()).map(el=>({el,b:el.getBoundingClientRect()}));
          for(let i=0;i<texts.length;i++) for(let j=i+1;j<texts.length;j++){
            const a=texts[i].b,c=texts[j].b;
            const ix=Math.min(a.right,c.right)-Math.max(a.left,c.left), iy=Math.min(a.bottom,c.bottom)-Math.max(a.top,c.top);
            if(ix>2&&iy>2) ccGeometry.push('OVERLAP:'+String(texts[i].el.className)+'|'+String(texts[j].el.className));
          }
        }
        return {
          ccGeometry:[...new Set(ccGeometry)].slice(0,20),
          docScrollX:Math.max(de.scrollWidth,body.scrollWidth)-innerWidth,
          docScrollY:Math.max(de.scrollHeight,body.scrollHeight)-innerHeight,
          localScroll:visible.filter(el=>{
            if(el===body||el===de) return false;
            const s=getComputedStyle(el);
            const scrollableY=el.scrollHeight>el.clientHeight+1 && ['auto','scroll'].includes(s.overflowY);
            const scrollableX=el.scrollWidth>el.clientWidth+1 && ['auto','scroll'].includes(s.overflowX);
            return scrollableX||scrollableY;
          }).map(el=>{
            const s=getComputedStyle(el);
            return {
              tag:el.tagName,
              cls:String(el.className),
              overflowX:s.overflowX,
              overflowY:s.overflowY,
              client:[el.clientWidth,el.clientHeight],
              scroll:[el.scrollWidth,el.scrollHeight]
            };
          }).slice(0,40),
          horizontal,clips:clips.slice(0,30),textClips:textClips.slice(0,30),textDebt,direct,
          theme:de.dataset.theme||'',
          bg:rootStyle.getPropertyValue('--bg-primary').trim(),
          mainClass:String(main?.className||''),
        };
      },{allowedFonts:[...allowedFonts]});
      row.dom=dom;
      if(dom.docScrollX>1) fail('GLOBAL_HORIZONTAL_SCROLL',String(dom.docScrollX));
      if(dom.docScrollY>1) fail('GLOBAL_VERTICAL_SCROLL',String(dom.docScrollY));
      if(dom.localScroll.length) fail('LOCAL_SCROLL_SURFACE',JSON.stringify(dom.localScroll));
      if(dom.horizontal.length) fail('HORIZONTAL_OUTSIDE_VIEWPORT',JSON.stringify(dom.horizontal));
      if(dom.clips.length) fail('CONTENT_CLIPPED',JSON.stringify(dom.clips));
      if(dom.ccGeometry.length) fail('CONTENT_OVERLAP',JSON.stringify(dom.ccGeometry));
      if(dom.textClips.length) fail('TEXT_CLIPPED',JSON.stringify(dom.textClips));
      if(dom.textDebt.length) fail('RUNTIME_FONT_SCALE',JSON.stringify(dom.textDebt));
      if(dom.theme!==theme) fail('THEME_RUNTIME',dom.theme);
      if(!dom.mainClass.includes('shell-'+key)) fail('VIEW_CLASS',dom.mainClass);

      const contrast=await page.evaluate(()=>{
        const parseColor=value=>{
          const c=String(value||'').trim();
          if(!c||c==='transparent') return null;
          let m=c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
          if(m) return {rgb:[+m[1],+m[2],+m[3]],a:m[4]===undefined?1:+m[4]};
          m=c.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
          if(m){
            let h=m[1];
            if(h.length===3) h=h.split('').map(x=>x+x).join('');
            const a=h.length===8?parseInt(h.slice(6,8),16)/255:1;
            return {rgb:[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)],a};
          }
          return null;
        };
        const blend=(top,bottom)=>{
          const a=top.a+(bottom.a*(1-top.a));
          if(a<=0) return {rgb:[0,0,0],a:0};
          return {
            rgb:top.rgb.map((v,i)=>(v*top.a+bottom.rgb[i]*bottom.a*(1-top.a))/a),
            a
          };
        };
        const L=rgb=>{
          const v=rgb.map(x=>Math.max(0,Math.min(255,x))/255).map(x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4));
          return .2126*v[0]+.7152*v[1]+.0722*v[2];
        };
        const ratio=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
        const tokenBase=()=>{
          const root=getComputedStyle(document.documentElement);
          const raw=root.getPropertyValue('--bg-primary').trim();
          const probe=document.createElement('span');
          probe.style.position='fixed'; probe.style.pointerEvents='none';
          probe.style.backgroundColor=raw; document.body.appendChild(probe);
          const resolved=getComputedStyle(probe).backgroundColor; probe.remove();
          return parseColor(resolved)||parseColor(raw)||{rgb:[255,255,255],a:1};
        };
        const gradientStops=el=>{
          const image=getComputedStyle(el).backgroundImage;
          if(!image||image==='none') return [];
          const values=[];
          for(const match of image.matchAll(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g)){
            const c=parseColor(match[0]); if(c&&c.a>0) values.push(c);
          }
          return values;
        };
        const backgroundCandidates=el=>{
          const chain=[]; let n=el;
          while(n){chain.unshift(n);n=n.parentElement;}
          let effective=tokenBase();
          let hasOpaqueSurface=false;
          const candidates=[];
          for(const node of chain){
            const s=getComputedStyle(node);
            const bg=parseColor(s.backgroundColor);
            if(bg&&bg.a>0){
              effective=blend(bg,effective);
              if(bg.a>=.999) hasOpaqueSurface=true;
            }
            const stops=gradientStops(node);
            if(stops.length&&!hasOpaqueSurface){
              for(const stop of stops){
                const composed=blend(stop,effective);
                candidates.push(composed.rgb);
              }
            }
          }
          candidates.push(effective.rgb);
          return candidates;
        };
        const bad=[];
        for(const el of document.querySelectorAll('main *')){
          if(el.children.length || !(el.textContent||'').trim()) continue;
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden') continue;
          const fg=parseColor(s.color); if(!fg) continue;
          const backgrounds=backgroundCandidates(el);
          const tag=el.tagName.toLowerCase();
          const floor=/^h[1-6]$/.test(tag)?4.5:7.0;
          const ratios=backgrounds.map(bg=>ratio(fg.rgb,bg));
          const cr=Math.min(...ratios);
          if(cr+1e-6<floor) bad.push({
            tag,cls:String(el.className),text:(el.textContent||'').trim().slice(0,80),
            ratio:+cr.toFixed(2),floor,color:s.color,
            candidates:backgrounds.map(bg=>bg.map(x=>Math.round(x)))
          });
          if(bad.length>=40) break;
        }
        return bad;
      });
      row.contrast=contrast;
      if(contrast.length) fail('AAA_CONTRAST',JSON.stringify(contrast));

      const axe=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
      const violations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}));
      row.axe=violations;
      if(violations.length) fail('AXE',JSON.stringify(violations));

      const themeToggle=page.getByRole('button',{name:/tema (claro|escuro)/i});
      await page.locator('body').click({position:{x:1,y:1}});
      await page.keyboard.press('Tab');
      let active=await page.evaluate(()=>String(document.activeElement?.className||''));
      for(let i=0;i<8 && !active.includes('themeToggle');i++){await page.keyboard.press('Tab');active=await page.evaluate(()=>String(document.activeElement?.className||''));}
      const focus=await themeToggle.evaluate(el=>{const s=getComputedStyle(el);return {active:String(document.activeElement===el),outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,outlineColor:s.outlineColor};});
      row.focus=focus;
      if(focus.active!=='true'||parseFloat(focus.outlineWidth||'0')<4||focus.outlineStyle==='none') fail('FOCUS_RING',JSON.stringify(focus));

      const shot=`${outDir}/${size.name}-${theme}-${key}${overviewPage ? '-page'+(overviewPage+1) : ''}.png`;
      await page.screenshot({path:shot,fullPage:true});
      row.screenshot=shot;
      report.push(row);
    }
    if(pageErrors.length||consoleErrors.length){failed=true;report.push({viewport:size,theme,view:'_console',failures:[{code:'RUNTIME_ERRORS',detail:JSON.stringify({pageErrors,consoleErrors})}]});}
    await context.close();
  }
}
await browser.close();
await fs.writeFile(outDir+'/report.json',JSON.stringify({schema:'zevanory.control-center.ped-runtime.v1',ok:!failed,states:report.length,report},null,2));
console.log('CONTROL_CENTER_RUNTIME_STATES='+report.length);
if(failed){
  const counts={};const samples=[];
  for(const r of report)for(const f of (r.failures||[])){counts[f.code]=(counts[f.code]||0)+1;if(samples.filter(x=>x.includes(' '+f.code+' ')).length<4)samples.push(`${r.viewport?.width||r.viewport}x${r.viewport?.height||''}/${r.theme}/${r.view}: ${f.code} ${String(typeof f.detail==='string'?f.detail:JSON.stringify(f.detail)).slice(0,160)}`);}
  console.log('::error title=PED_RUNTIME_COUNTS::'+JSON.stringify(counts));
  for(const s of samples)console.log('::error title=PED_RUNTIME_DEFECT::'+s.replace(/[\r\n]+/g,' '));
  console.log('CONTROL_CENTER_PED_RUNTIME=FAIL');process.exit(1);
}
console.log('CONTROL_CENTER_PED_RUNTIME=PASS');
