import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base='https://zpc-commercial-final-audit-20260926.onrender.com';
const out='live-owner-preview-review';
const views=[
  ['overview','Visão Geral'],['products','Produtos'],['commercial','Comercial'],['creatives','Criativos'],
  ['approvals','Aprovações'],['publications','Publicações'],['prospecting','Prospecção'],['crm','CRM/Vendas'],
  ['support','Atendimento'],['finance','Financeiro'],['cfo','ZEVANORY CFO'],['evidence','Evidências'],
  ['operations','Operações técnicas'],['governance','ZEES-16 / Governança'],
];
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[];
for(const theme of ['light','dark']){
  const context=await browser.newContext({
    viewport:{width:1536,height:730},
    deviceScaleFactor:1.25,
    colorScheme:theme,
    reducedMotion:'reduce',
  });
  await context.addInitScript(({theme})=>{
    localStorage.setItem('arbm_admin_session','owner-preview-session');
    localStorage.setItem('zpc_theme',theme);
  },{theme});
  const page=await context.newPage();
  const pageErrors=[]; const consoleErrors=[]; const requestFailures=[]; const externalHosts=new Set();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error') consoleErrors.push(m.text())});
  page.on('requestfailed',r=>requestFailures.push({url:r.url(),failure:r.failure()?.errorText||''}));
  page.on('request',r=>{try{const u=new URL(r.url());if(u.hostname!==new URL(base).hostname) externalHosts.add(u.hostname)}catch{}});
  await page.goto(base,{waitUntil:'networkidle',timeout:60000});
  await page.getByText('ZEVANORY CONTROL CENTER',{exact:true}).waitFor({state:'visible',timeout:20000});
  for(const [key,label] of views){
    const nav=page.getByRole('navigation',{name:'Áreas do ZEVANORY CONTROL CENTER'});
    await nav.getByRole('button',{name:label,exact:true}).click();
    await page.waitForTimeout(220);
    const metrics=await page.evaluate(()=>{
      const de=document.documentElement,body=document.body;
      const visible=[...document.querySelectorAll('body *')].filter(el=>{
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';
      });
      const outside=visible.filter(el=>{const r=el.getBoundingClientRect();return r.left<-1||r.right>innerWidth+1;})
        .slice(0,12).map(el=>({tag:el.tagName,cls:String(el.className),text:(el.textContent||'').trim().slice(0,80)}));
      const localScroll=visible.filter(el=>{
        const s=getComputedStyle(el);
        return ((el.scrollWidth>el.clientWidth+1&&['auto','scroll'].includes(s.overflowX))||(el.scrollHeight>el.clientHeight+1&&['auto','scroll'].includes(s.overflowY)));
      }).slice(0,12).map(el=>({tag:el.tagName,cls:String(el.className),client:[el.clientWidth,el.clientHeight],scroll:[el.scrollWidth,el.scrollHeight]}));
      return {
        theme:de.dataset.theme||'',
        inner:[innerWidth,innerHeight],
        dpr:devicePixelRatio,
        docScrollX:Math.max(de.scrollWidth,body.scrollWidth)-innerWidth,
        docScrollY:Math.max(de.scrollHeight,body.scrollHeight)-innerHeight,
        outside,localScroll,
      };
    });
    const file=`${out}/${theme}-${key}.png`;
    await page.screenshot({path:file,fullPage:false});
    report.push({theme,key,label,file,metrics});
  }
  report.push({theme,diagnostics:{pageErrors,consoleErrors,requestFailures,externalHosts:[...externalHosts]}});
  await context.close();
}
await browser.close();
await fs.writeFile(`${out}/report.json`,JSON.stringify({base,generatedAt:new Date().toISOString(),report},null,2));
const failures=report.filter(x=>x.metrics).filter(x=>x.metrics.docScrollX>1||x.metrics.outside.length>0);
console.log(JSON.stringify({LIVE_OWNER_PREVIEW_REVIEW:'PASS',screenshots:28,horizontalFailures:failures.length,report:`${out}/report.json`}));
if(failures.length) process.exit(1);
