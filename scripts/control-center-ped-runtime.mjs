import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const axePath=require.resolve('axe-core/axe.min.js');

const baseUrl=process.env.CONTROL_CENTER_AUDIT_URL || 'http://127.0.0.1:4173';
const outDir=process.env.CONTROL_CENTER_AUDIT_OUT || 'control-center-audit';
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
const bootstrap={
  dashboard:{systems:[],audits:[],improvements:[],incidents:[],policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'FALSE_GREEN=0'},lastEngineRun:now,certificationRuns:[]},
  globalTrust:{state:'GREEN',sha:'ped-runtime',evidenceRoot:'ped-runtime',policyVersion:'PED-VERSAL-V1.1-SUPREME',quorum:{passed:3,total:3,required:3,conflicts:0,independentKeys:3},zea10:{proven:10,partial:0,blocked:0},engines:[],checkedAt:now},
  operations:{available:true,generatedAt:now,releaseSha:'ped-runtime',health:{ready:true,live:true,databaseReachable:true,schemaReady:true,requiredTables:1,requiredMigrations:1,missingTables:0,missingMigrations:0},runtime:{sales:'globally-blocked',checkout:'blocked',financial:'ready',whatsapp:'blocked'},control:{globalState:'operational_commercial_blocked',rootBlocker:'global_sale_disabled',decision:'BLOCK'},continuity:{quorumOk:true,mode:'multi-provider',channels:['web'],whatsappDependencyRequired:false},channels:[{name:'web',scopeStatus:'ready',releaseGate:'green',commercialExecution:'blocked'}],zees16:{proven:16,partial:0,blocked:0},zea10:{proven:10,partial:0,blocked:0,unknown:0}},
  commercial,cfo:null,products:[],certificationTargets:[],
  summary:{total:0,salesEnabled:0,commercialReady:0,blocked:0,certified:0,inCertification:0,zeesBlocked:0},
};
const views=[
  ['overview','Visão Geral'],['products','Produtos'],['commercial','Comercial'],['creatives','Criativos'],
  ['approvals','Aprovações'],['publications','Publicações'],['prospecting','Prospecção'],['crm','CRM/Vendas'],
  ['support','Atendimento'],['finance','Financeiro'],['cfo','ZEVANORY CFO'],['evidence','Evidências'],
  ['operations','Operações técnicas'],['governance','ZEES-16 / Governança'],
];
const sizes=[
  {name:'large',width:1920,height:1080},{name:'desktop',width:1440,height:900},
  {name:'tablet',width:768,height:1024},{name:'mobile',width:375,height:812},
];
const themes=['dark','light'];
const allowedFonts=new Set([12,14,16,21,28,37]);
await fs.mkdir(outDir,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[]; let failed=false;

async function navigate(page,width,key,label){
  if(width<=960){
    const sel=page.getByLabel('Selecionar área do Control Center');
    await sel.waitFor({state:'visible',timeout:15000});
    await sel.selectOption(key);
    return;
  }
  if(key==='operations'||key==='governance'){
    await page.getByRole('button',{name:'Visão Geral',exact:true}).click();
    await page.getByRole('button',{name:label,exact:true}).click();
    return;
  }
  await page.getByRole('button',{name:label,exact:true}).click();
}

for(const size of sizes){
  for(const theme of themes){
    const context=await browser.newContext({viewport:{width:size.width,height:size.height},colorScheme:theme,reducedMotion:'reduce'});
    await context.addInitScript(({theme})=>{
      localStorage.setItem('arbm_admin_session','ped-runtime-session');
      localStorage.setItem('zpc_theme',theme);
    },{theme});
    const page=await context.newPage();
    const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e)));
    const consoleErrors=[]; page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
    await page.route('**/api/admin/bootstrap',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap)}));
    await page.route('**/global-trust.json*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap.globalTrust)}));
    await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:30000});
    await page.getByText('ZEVANORY CONTROL CENTER',{exact:true}).waitFor({state:'visible',timeout:15000});
    await page.addScriptTag({path:axePath});

    for(const [key,label] of views){
      const row={viewport:size,theme,view:key,label,failures:[]};
      const fail=(code,detail)=>{row.failures.push({code,detail});failed=true;};
      try{await navigate(page,size.width,key,label);}catch(e){fail('NAVIGATION',String(e));report.push(row);continue;}
      await page.waitForTimeout(80);
      const dom=await page.evaluate(({allowedFonts})=>{
        const de=document.documentElement, body=document.body, main=document.querySelector('main');
        const rootStyle=getComputedStyle(de);
        const visible=[...document.querySelectorAll('main *')].filter(el=>{
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';
        });
        const horizontal=visible.map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,cls:String(el.className),left:r.left,right:r.right};})
          .filter(x=>x.left<-1||x.right>innerWidth+1).slice(0,20);
        const textDebt=visible.filter(el=>(el.textContent||'').trim() && el.children.length===0).map(el=>({tag:el.tagName,cls:String(el.className),font:parseFloat(getComputedStyle(el).fontSize)}))
          .filter(x=>!allowedFonts.includes(x.font)).slice(0,30);
        const direct=main?[...main.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,cls:String(el.className),top:r.top,bottom:r.bottom,left:r.left,right:r.right};}):[];
        return {
          docScrollX:Math.max(de.scrollWidth,body.scrollWidth)-innerWidth,
          docScrollY:Math.max(de.scrollHeight,body.scrollHeight)-innerHeight,
          horizontal,textDebt,direct,
          theme:de.dataset.theme||'',
          bg:rootStyle.getPropertyValue('--bg-primary').trim(),
          mainClass:String(main?.className||''),
        };
      },{allowedFonts:[...allowedFonts]});
      row.dom=dom;
      if(dom.docScrollX>1) fail('GLOBAL_HORIZONTAL_SCROLL',String(dom.docScrollX));
      if(dom.docScrollY>1) fail('GLOBAL_VERTICAL_SCROLL',String(dom.docScrollY));
      if(dom.horizontal.length) fail('HORIZONTAL_CLIP',JSON.stringify(dom.horizontal));
      if(dom.textDebt.length) fail('RUNTIME_FONT_SCALE',JSON.stringify(dom.textDebt));
      if(dom.theme!==theme) fail('THEME_RUNTIME',dom.theme);
      if(!dom.mainClass.includes('shell-'+key)) fail('VIEW_CLASS',dom.mainClass);

      const axe=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
      const violations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));
      row.axe=violations;
      if(violations.length) fail('AXE',JSON.stringify(violations));

      const themeToggle=page.getByRole('button',{name:/tema (claro|escuro)/i});
      await themeToggle.focus();
      const focus=await themeToggle.evaluate(el=>{const s=getComputedStyle(el);return {outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,outlineColor:s.outlineColor};});
      row.focus=focus;
      if(parseFloat(focus.outlineWidth||'0')<4||focus.outlineStyle==='none') fail('FOCUS_RING',JSON.stringify(focus));

      const shot=`${outDir}/${size.name}-${theme}-${key}.png`;
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
if(failed){console.log('CONTROL_CENTER_PED_RUNTIME=FAIL');process.exit(1);}
console.log('CONTROL_CENTER_PED_RUNTIME=PASS');
