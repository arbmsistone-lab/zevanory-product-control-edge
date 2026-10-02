import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT='C:/Users/airto/zevanory-product-control-audit/audit';
const OUT=path.join(ROOT,'baseline');
fs.mkdirSync(OUT,{recursive:true});

const screens=[
  'Visão Geral','Produtos','Comercial','Criativos','Aprovações','Publicações',
  'Prospecção','CRM/Vendas','Atendimento','Financeiro','ZEVANORY CFO',
  'Evidências','Operações técnicas','ZEES-16 / Governança'
];
const themes=['light','dark'];

function slug(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}

async function scanDom(page){
  return await page.evaluate(() => {
    const vw=innerWidth,vh=innerHeight;
    const visible=(e)=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;
    };    const desc=(e)=>{
      const cls=typeof e.className==='string'?'.'+e.className.trim().split(/\s+/).slice(0,3).join('.'):'';
      return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+cls;
    };
    const all=[...document.querySelectorAll('body *')].filter(visible);
    const textEls=all.filter(e=>(e.innerText||'').trim().length>0);
    const clipped=[];
    const outside=[];
    for(const e of textEls){
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      const ell=s.textOverflow==='ellipsis';
      const overflowX=e.scrollWidth>e.clientWidth+1;
      const overflowY=e.scrollHeight>e.clientHeight+1;
      if(ell||overflowX||overflowY) clipped.push({el:desc(e),text:(e.innerText||'').trim().slice(0,120),ellipsis:ell,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight});
      if(r.left<-1||r.top<-1||r.right>vw+1||r.bottom>vh+1) outside.push({el:desc(e),text:(e.innerText||'').trim().slice(0,100),rect:{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}});
    }
    const overlapEls=textEls.filter(e=>{
      const s=getComputedStyle(e);
      const hasTextChild=[...e.children].some(c=>visible(c)&&(c.innerText||'').trim().length>0);
      return !hasTextChild||s.position==='fixed'||s.position==='sticky';
    });
    const overlaps=[];    for(let i=0;i<overlapEls.length;i++){
      for(let j=i+1;j<overlapEls.length;j++){
        const a=overlapEls[i],b=overlapEls[j];
        if(a.contains(b)||b.contains(a)) continue;
        const sa=getComputedStyle(a),sb=getComputedStyle(b);
        const related=a.parentElement===b.parentElement||['fixed','sticky'].includes(sa.position)||['fixed','sticky'].includes(sb.position);
        if(!related) continue;
        const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
        const ix=Math.max(0,Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left));
        const iy=Math.max(0,Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top));
        if(ix>1&&iy>1) overlaps.push({a:desc(a),b:desc(b),aText:(a.innerText||a.getAttribute('aria-label')||'').trim().slice(0,80),bText:(b.innerText||b.getAttribute('aria-label')||'').trim().slice(0,80),intersection:{w:ix,h:iy}});
      }
    }
    const geometry=[];
    for(const p of all){
      const ps=getComputedStyle(p);
      const kids=[...p.children].filter(visible);
      if(kids.length<2||kids.length>20) continue;
      if(ps.display==='flex'&&ps.flexDirection==='column'){
        const lefts=kids.map(k=>k.getBoundingClientRect().left);
        if(Math.max(...lefts)-Math.min(...lefts)>1) geometry.push({type:'vertical-left-misalignment',parent:desc(p),delta:Math.max(...lefts)-Math.min(...lefts)});
      }
      if(ps.display==='grid'||ps.display==='flex'){
        for(let i=0;i<kids.length;i++)for(let j=i+1;j<kids.length;j++){
          const a=kids[i].getBoundingClientRect(),b=kids[j].getBoundingClientRect();
          if(Math.abs(a.top-b.top)<=1&&Math.min(a.right,b.right)>Math.max(a.left,b.left)){
            if(Math.abs(a.height-b.height)>1) geometry.push({type:'same-row-height',parent:desc(p),a:desc(kids[i]),b:desc(kids[j]),delta:Math.abs(a.height-b.height)});
          }
        }
      }
    }    const typography=[];
    const leafText=textEls.filter(e=>![...e.children].some(c=>visible(c)&&(c.innerText||'').trim()));
    for(const e of leafText){
      const s=getComputedStyle(e),size=parseFloat(s.fontSize),lh=parseFloat(s.lineHeight),r=e.getBoundingClientRect();
      if(size<14) typography.push({type:'font-size',el:desc(e),text:(e.innerText||'').trim().slice(0,100),value:size});
      if(['P','LI'].includes(e.tagName)&&Number.isFinite(lh)&&size>0){
        const ratio=lh/size;
        if(ratio<1.4||ratio>1.6) typography.push({type:'line-height',el:desc(e),text:(e.innerText||'').trim().slice(0,100),value:Number(ratio.toFixed(3))});
      }
      if(/\d/.test((e.innerText||''))&&(e.matches('td,th')||/metric|stat|kpi|amount|value/i.test(String(e.className)))){
        if(!s.fontVariantNumeric.includes('tabular-nums')) typography.push({type:'numeric-variant',el:desc(e),text:(e.innerText||'').trim().slice(0,80),value:s.fontVariantNumeric});
        if(e.matches('td')&&s.textAlign!=='right') typography.push({type:'numeric-align',el:desc(e),text:(e.innerText||'').trim().slice(0,80),value:s.textAlign});
      }
      if(r.width>0&&r.height>0&&e.matches('p')&&((e.innerText||'').trim().length>180)){
        const charsPerLine=Math.round(((e.innerText||'').trim().length)/(Math.max(1,Math.round(r.height/lh))));
        if(charsPerLine<45||charsPerLine>90) typography.push({type:'line-length',el:desc(e),value:charsPerLine});
      }
    }
    const touch=[];
    if(vw<=390){
      for(const e of [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')].filter(visible)){
        const r=e.getBoundingClientRect();
        if(r.width<44||r.height<44) touch.push({el:desc(e),text:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,80),w:r.width,h:r.height});
      }
    }    return {
      viewport:{width:vw,height:vh,dpr:devicePixelRatio},
      counts:{visible:all.length,text:textEls.length,clipped:clipped.length,outside:outside.length,overlaps:overlaps.length,geometry:geometry.length,typography:typography.length,touch:touch.length},
      clipped,outside,overlaps,geometry,typography,touch
    };
  });
}

async function negativeProof(page){
  await page.evaluate(()=>{
    const cut=document.createElement('div');
    cut.id='audit-neg-cut'; cut.textContent='NEGATIVE CUT '+('X'.repeat(180));
    Object.assign(cut.style,{position:'fixed',left:'16px',top:'16px',width:'80px',height:'20px',overflow:'hidden',whiteSpace:'nowrap',zIndex:'999999',background:'#fff',color:'#000'});
    const a=document.createElement('div'),b=document.createElement('div');
    a.id='audit-neg-overlap-a';b.id='audit-neg-overlap-b';a.textContent='OVERLAP A';b.textContent='OVERLAP B';
    for(const e of [a,b])Object.assign(e.style,{position:'fixed',left:'120px',top:'16px',width:'140px',height:'32px',zIndex:'999999',background:'#fff',color:'#000'});
    document.body.append(cut,a,b);
  });
  const result=await scanDom(page);
  const cutDetected=result.clipped.some(x=>x.el.includes('#audit-neg-cut'));
  const overlapDetected=result.overlaps.some(x=>(x.a.includes('#audit-neg-overlap-a')&&x.b.includes('#audit-neg-overlap-b'))||(x.b.includes('#audit-neg-overlap-a')&&x.a.includes('#audit-neg-overlap-b')));
  await page.evaluate(()=>document.querySelectorAll('#audit-neg-cut,#audit-neg-overlap-a,#audit-neg-overlap-b').forEach(e=>e.remove()));
  return {cutDetected,overlapDetected,pass:cutDetected&&overlapDetected,scan:result};
}async function ensureTheme(page,theme){
  const current=await page.evaluate(()=>document.documentElement.dataset.theme||'dark');
  if(current===theme)return;
  const btn=page.locator('.themeToggle').first();
  if(await btn.count())await btn.click();
  await page.waitForTimeout(250);
}
async function navigate(page,label){
  const nav=page.locator('.zpcNavigation');
  if(await nav.count()&&await nav.isVisible()){
    const item=nav.getByText(label,{exact:true}).first();
    if(await item.count())await item.click();
  }else{
    const select=page.locator('.areaSelectWrap select').first();
    if(await select.count()){
      const opts=await select.locator('option').allTextContents();
      const idx=opts.findIndex(x=>x.trim()===label);
      if(idx>=0)await select.selectOption({index:idx});
    }
  }
  await page.waitForTimeout(450);
}
async function axeScan(page){
  const a=await new AxeBuilder({page}).analyze();
  const serious=a.violations.filter(v=>v.impact==='serious'||v.impact==='critical');
  return {violations:a.violations.length,seriousCritical:serious.length,items:serious.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help}))};
}const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const context=browser.contexts()[0];
const page=context.pages().find(p=>p.url().includes('controle.zevanory.api.br'))||context.pages()[0];
await page.bringToFront();
await page.waitForTimeout(400);

const version=await page.evaluate(()=>fetch('/version.json',{cache:'no-store'}).then(r=>r.json()));
const realMetrics=await page.evaluate(()=>({innerWidth,innerHeight,devicePixelRatio,theme:document.documentElement.dataset.theme||null}));
const negative=await negativeProof(page);
fs.writeFileSync(path.join(OUT,'negative-proof.json'),JSON.stringify({version,realMetrics,...negative},null,2));
if(!negative.pass){
  console.error('NEGATIVE_PROOF_FAILED');
  process.exitCode=2;
}else{
  console.log('NEGATIVE_PROOF_PASS');
}

const report={version,realMetrics,generatedAt:new Date().toISOString(),negative:{cutDetected:negative.cutDetected,overlapDetected:negative.overlapDetected,pass:negative.pass},screens:[]};
if(negative.pass){
  for(const theme of themes){
    await ensureTheme(page,theme);
    for(const screen of screens){
      await navigate(page,screen);
      const dom=await scanDom(page);
      const axe=await axeScan(page);
      const item={theme,screen,dom,axe};
      report.screens.push(item);
      const dir=path.join(OUT,'screens',theme);fs.mkdirSync(dir,{recursive:true});
      await page.screenshot({path:path.join(dir,slug(screen)+'.png'),fullPage:false});
      console.log(theme,screen,JSON.stringify(dom.counts),'axeSC='+axe.seriousCritical);
    }
  }
}
fs.writeFileSync(path.join(OUT,'real-viewport-report.json'),JSON.stringify(report,null,2));

const matrixViewports=[
  {name:'1280x720',width:1280,height:720},
  {name:'1366x768',width:1366,height:768},
  {name:'768x1024',width:768,height:1024},
  {name:'390x844',width:390,height:844},
  {name:'320x844',width:320,height:844}
];
const matrix=[];
for(const vp of matrixViewports){
  await page.setViewportSize({width:vp.width,height:vp.height});
  for(const theme of themes){
    await ensureTheme(page,theme);
    for(const screen of screens){
      await navigate(page,screen);
      const dom=await scanDom(page);
      const axe=await axeScan(page);
      matrix.push({viewport:vp.name,theme,screen,dom,axe});
      console.log(vp.name,theme,screen,JSON.stringify(dom.counts),'axeSC='+axe.seriousCritical);
    }
  }
}
fs.writeFileSync(path.join(OUT,'matrix-report.json'),JSON.stringify({version,generatedAt:new Date().toISOString(),matrix},null,2));
await page.setViewportSize({width:1536,height:730});
await browser.close();
