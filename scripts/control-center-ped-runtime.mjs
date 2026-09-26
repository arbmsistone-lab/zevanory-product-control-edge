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
