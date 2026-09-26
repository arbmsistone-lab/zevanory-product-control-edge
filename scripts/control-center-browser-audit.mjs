import { chromium } from 'playwright';
import fs from 'node:fs';

const base=process.env.ZPC_AUDIT_URL || 'http://127.0.0.1:4173/';
const views=['overview','products','commercial','creatives','approvals','publications','prospecting','crm','support','finance','cfo','evidence','operations','governance'];
const viewports=[
  {name:'large',width:1920,height:1080},
  {name:'desktop',width:1440,height:900},
  {name:'tablet',width:768,height:1024},
  {name:'mobile',width:375,height:812},
];
const themes=['dark','light'];
const now='2026-09-26T15:00:00.000Z';

const pillars=Array.from({length:16},(_,i)=>({
  id:'P'+String(i+1).padStart(2,'0'),
  name:'Pilar '+String(i+1).padStart(2,'0'),
  shortName:'P'+String(i+1).padStart(2,'0'),
  status:i<12?'proved':i<14?'partial':'blocked',
  controls:4,
  rationale:'Evidência determinística de fixture visual.',
  blocker:i>=14?'Bloqueio de demonstração visual.':null,
  evidence:i<14?['fixture://evidence/'+(i+1)]:[],
}));
const certification={
  standard:'ZEES-16',version:'1.0',profile:'COMMERCE_CONTROL_PLANE',ready:false,rootBlocker:'fixture_blocked',
  evidenceCount:14,summary:{proved:12,partial:2,blocked:2,na:0,external:0,applicable:16,applicableControls:64,provedControls:52},pillars,
};
const product=(id,name,status='blocked')=>({
  id,name,slug:id,category:'Sistema empresarial',description:'Produto ZEVANORY com governança, evidência e operação fail-closed.',
  publicUrl:'https://example.invalid/'+id,priceCents:null,currency:'BRL',checkoutUrl:'',deliveryModel:'Digital',
  channels:['Web','WhatsApp'],status,salesEnabled:false,
  gates:{legal:true,payment:false,fulfillment:true,support:true},
  audit:{engineering:9,infrastructure:9,ux:9,observability:9,lastAuditedAt:now},
  auditOverall:9,auditStatus:'audited',notes:'Fixture visual.',createdAt:now,updatedAt:now,
  commercialReady:false,blockers:['Pagamento não certificado'],certification,
});
const rec=(id,kind,title,status,extra={})=>({
  id,kind,title,detail:'Registro comprovado para auditoria visual.',status,channel:'Web',product:'ZEVANORY ONE',productId:'one',
  valueCents:null,source:'fixture',sourceKey:id,evidence:['fixture://'+id],createdAt:now,updatedAt:now,publishedAt:null,...extra
});
const bootstrap={
  dashboard:{
    systems:[
      {id:'control',name:'Control Center',domain:'controle.zevanory.api.br',status:'healthy',score:9.8,lastAudit:now,gate:'PASS',evidence:['fixture://control'],sha:'abcdef1234567890',availability:99.99,latencyMs:80,ci:'PASS'},
      {id:'one',name:'ZEVANORY ONE',domain:'zevanory.api.br',status:'attention',score:8.8,lastAudit:now,gate:'BLOCKED',evidence:['fixture://one'],sha:'123456abcdef7890',availability:99.9,latencyMs:120,ci:'PASS'}
    ],
    audits:[
      {id:'a1',system:'Control Center',severity:'info',title:'Auditoria concluída',detail:'Sem regressão visual.',createdAt:now},
      {id:'a2',system:'ZEVANORY ONE',severity:'warning',title:'Gate comercial bloqueado',detail:'Pagamento pendente.',createdAt:now}
    ],
    improvements:[{id:'i1',system:'Control Center',priority:'P1',title:'Manter PED Supreme',reason:'Evitar regressão.',state:'validated'}],
    incidents:[{id:'inc1',system:'ZEVANORY ONE',severity:'warning',title:'Venda bloqueada',detail:'Fail-closed ativo.',createdAt:now,state:'watching'}],
    policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'evidence-only'},
    lastEngineRun:now,
    certificationRuns:[{id:'r1',targetId:'control',targetName:'Control Center',status:'complete',releaseFingerprint:'fixture-release',sourceSha:'abcdef1234567890',startedAt:now,finishedAt:now,completedPillars:16,currentPillar:null}]
  },
  globalTrust:{state:'GREEN',sha:'abcdef1234567890',evidenceRoot:'fixture://root',policyVersion:'1.0',quorum:{passed:3,total:3,required:2,conflicts:0,independentKeys:3},zea10:{proven:9,partial:1,blocked:0},engines:[{id:'ZEES-16',state:'GREEN'},{id:'ZEA-10',state:'GREEN'}],checkedAt:now},
  operations:{
    available:true,generatedAt:now,releaseSha:'abcdef1234567890',
    health:{ready:true,live:true,databaseReachable:true,schemaReady:true,requiredTables:12,requiredMigrations:8,missingTables:0,missingMigrations:0},
    runtime:{sales:'globally-blocked',checkout:'blocked',financial:'ready',whatsapp:'blocked'},
    control:{globalState:'operational_commercial_blocked',rootBlocker:'global_sale_disabled',decision:'blocked'},
    continuity:{quorumOk:true,mode:'multi-provider',channels:['GitHub','Render','Cloudflare'],whatsappDependencyRequired:false},
    channels:[
      {name:'Web',scopeStatus:'ready',releaseGate:'pass',commercialExecution:'active'},
      {name:'WhatsApp',scopeStatus:'blocked',releaseGate:'blocked',commercialExecution:'blocked'},
      {name:'Email',scopeStatus:'ready',releaseGate:'pass',commercialExecution:'active'}
    ],
    zees16:{proven:16,partial:0,blocked:0},zea10:{proven:9,partial:1,blocked:0,unknown:0}
  },
  commercial:{
    generatedAt:now,metrics:{leadsToday:18,contactsToday:9,creativesInProduction:4,pendingApproval:3,publishedToday:6,salesCentsToday:125000},
    robot:{state:'ACTIVE',label:'ROBÔ COMERCIAL: ATIVO',reason:'Heartbeat comprovado; publicações seguem aprovação.',lastHeartbeatAt:now,externalProspecting:true,publishAdapterReady:true,activeChannels:['Web','Email']},
    leads:[rec('l1','lead','Lead Empresa Alfa','qualified'),rec('l2','lead','Lead Empresa Beta','contacted')],
    creatives:[rec('c1','creative','Criativo institucional','approval'),rec('c2','creative','Campanha B2B','testing')],
    publications:[rec('p1','publication','Publicação institucional','published',{publishedAt:now}),rec('p2','publication','Publicação comercial','approval')],
    events:[rec('e1','event','Contato realizado','contact'),rec('e2','event','Follow-up agendado','scheduled')],
    support:[rec('s1','support','Dúvida de cliente','open')],
    finance:[rec('f1','finance','Pagamento confirmado','confirmed',{valueCents:125000,source:'payment'})],
    evidence:[rec('ev1','evidence','Readback de publicação','confirmed')],
    counts:{leads:2,creatives:2,publications:2,events:2,support:1,finance:1,evidence:1}
  },
  cfo:{
    schema:'zevanory-cfo-workspace/v1',generatedAt:now,
    engine:{state:'STANDBY',failClosed:true,autonomousMutations:false,reason:'Leitura ativa; mutações externas aguardam aprovação.'},
    metrics:{balanceCents:1450000,receivableOpenCents:420000,overdueCents:95000,dueTodayCents:80000,inflow30dCents:800000,outflow30dCents:420000,projected30dCents:1600000,taxReserveSuggestedCents:38000,highRiskReceivables:1},
    adapters:[
      {id:'asaas',label:'Asaas',state:'READY',mode:'READ',lastSyncAt:now,evidence:['fixture://asaas'],blocker:null},
      {id:'bank',label:'Banco',state:'DEGRADED',mode:'READ',lastSyncAt:now,evidence:[],blocker:'Consentimento de escrita não concedido.'}
    ],
    receivables:[
      {id:'r1',customer:'Empresa Alfa',document:'00.000.000/0001-00',dueAt:'2026-09-01T12:00:00Z',amountCents:150000,paidCents:0,status:'OVERDUE',source:'fixture',evidence:['fixture://r1'],createdAt:now,updatedAt:now,openCents:150000,daysLate:25,risk:'HIGH'},
      {id:'r2',customer:'Empresa Beta',document:null,dueAt:'2026-10-01T12:00:00Z',amountCents:270000,paidCents:0,status:'OPEN',source:'fixture',evidence:['fixture://r2'],createdAt:now,updatedAt:now,openCents:270000,daysLate:0,risk:'LOW'}
    ],
    recentTransactions:[],
    actions:[{id:'a1',kind:'COLLECT',title:'Revisar cobrança Empresa Alfa',detail:'Recebível vencido exige aprovação antes de contato.',valueCents:150000,state:'READY_FOR_APPROVAL',requiresApproval:true,sourceIds:['r1'],createdAt:now,updatedAt:now}]
  },
  products:[product('control','ZEVANORY CONTROL CENTER','ready'),product('one','ZEVANORY ONE'),product('sist','ARBM SIST'),product('cfo','ZEVANORY CFO')],
  certificationTargets:[
    {id:'control',name:'ZEVANORY CONTROL CENTER',kind:'SYSTEM',publicUrl:'https://controle.zevanory.api.br/',certification},
    {id:'one',name:'ZEVANORY ONE',kind:'SYSTEM',publicUrl:'https://zevanory.api.br/',certification}
  ],
  summary:{total:4,salesEnabled:0,commercialReady:0,blocked:3,certified:1,inCertification:3,zeesBlocked:2}
};

const browser=await chromium.launch({headless:true});
const evidence=[]; let failed=false;
const fail=(row,code,detail)=>{row.failures.push({code,detail});failed=true;};

for(const viewport of viewports){
  for(const theme of themes){
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},colorScheme:theme,reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript(({theme})=>{
      localStorage.setItem('arbm_admin_session','fixture-session');
      localStorage.setItem('zpc_theme',theme);
    },{theme});
    await page.route('**/global-trust.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap.globalTrust)}));
    await page.route('**/api/admin/bootstrap',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap)}));
    await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
    const response=await page.goto(base,{waitUntil:'networkidle',timeout:30000});
    if(!response?.ok()) throw new Error('audit page did not load '+response?.status());
    await page.getByText('ZEVANORY CONTROL CENTER').waitFor({state:'visible',timeout:10000});

    for(const view of views){
      await page.locator('.areaSelectWrap select').evaluate((el,value)=>{
        const s=el; s.value=value; s.dispatchEvent(new Event('change',{bubbles:true}));
      },view);
      await page.waitForTimeout(80);
      const row={viewport,theme,view,failures:[]};
      const metrics=await page.evaluate(()=>{
        const de=document.documentElement, body=document.body;
        const shell=document.querySelector('.shell');
        const visible=[...document.querySelectorAll('.shell *')].filter(el=>{
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
        });
        const outside=visible.map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,cls:String(el.className),left:r.left,right:r.right,top:r.top,bottom:r.bottom};})
          .filter(x=>x.left < -1 || x.right > innerWidth+1 || x.top < -1 || x.bottom > innerHeight+1).slice(0,30);
        const tiny=visible.filter(el=>/^(P|SPAN|SMALL|B|STRONG|LABEL|BUTTON|INPUT|SELECT|TEXTAREA|H1|H2|H3|A)$/.test(el.tagName))
          .map(el=>({text:(el.textContent||'').trim().slice(0,80),tag:el.tagName,cls:String(el.className),size:parseFloat(getComputedStyle(el).fontSize)}))
          .filter(x=>x.text && x.size<12).slice(0,40);
        const sr=shell?.getBoundingClientRect();
        return {
          htmlOverflowX:de.scrollWidth>de.clientWidth+1,
          bodyOverflowX:body.scrollWidth>body.clientWidth+1,
          pageScrollY:de.scrollHeight>de.clientHeight+1 || body.scrollHeight>body.clientHeight+1,
          shellBottom:sr?.bottom??0,shellRight:sr?.right??0,
          outside,tiny,
          theme:document.documentElement.dataset.theme||'',
          activeText:(document.querySelector('.tab.active')?.textContent||document.querySelector('.areaSelectWrap select option:checked')?.textContent||'').trim()
        };
      });
      row.metrics=metrics;
      if(metrics.htmlOverflowX||metrics.bodyOverflowX) fail(row,'horizontal_overflow',JSON.stringify(metrics));
      if(metrics.pageScrollY) fail(row,'page_scroll',JSON.stringify({view,scrollHeight:await page.evaluate(()=>document.documentElement.scrollHeight),clientHeight:viewport.height}));
      if(metrics.outside.length) fail(row,'outside_viewport',JSON.stringify(metrics.outside));
      if(metrics.tiny.length) fail(row,'font_below_12px',JSON.stringify(metrics.tiny));
      if(metrics.theme!==theme) fail(row,'theme_mismatch',metrics.theme);
      if(errors.length) fail(row,'console_error',JSON.stringify(errors));
      evidence.push(row);
    }
    await page.screenshot({path:`control-center-${viewport.width}x${viewport.height}-${theme}.png`,fullPage:true});
    await context.close();
  }
}
await browser.close();
fs.writeFileSync('control-center-browser-evidence.json',JSON.stringify({schema:'zevanory.control-center.ped.browser.v1',sha:process.env.GITHUB_SHA||'local',evidence},null,2));
console.log(JSON.stringify(evidence.filter(x=>x.failures.length).slice(0,50),null,2));
if(failed) process.exit(1);
console.log('CONTROL_CENTER_BROWSER_MATRIX=PASS');
