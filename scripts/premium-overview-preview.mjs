import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseUrl = process.env.PREMIUM_OVERVIEW_URL || 'http://127.0.0.1:4173';
const outDir = 'premium-overview-preview';
const now = new Date().toISOString();
await fs.mkdir(outDir,{recursive:true});

const premiumCss = await fs.readFile('src/styles/premium-shell.css','utf8');
const rawColorLines = premiumCss.split('\n').filter(line => /#[0-9a-fA-F]{3,8}|rgba?\(/.test(line));
const nonTokenColorLines = rawColorLines.filter(line => !/^\s*--[a-z0-9-]+\s*:/i.test(line));
if (nonTokenColorLines.length) {
  throw new Error('PREMIUM_COLOR_OUTSIDE_TOKEN=' + JSON.stringify(nonTokenColorLines));
}

const operations = {
  available:true,generatedAt:now,releaseSha:'preview',
  health:{ready:true,live:true,databaseReachable:true,schemaReady:true,requiredTables:1,requiredMigrations:1,missingTables:0,missingMigrations:0},
  runtime:{sales:'blocked',checkout:'blocked',financial:'ready',whatsapp:'blocked'},
  control:{globalState:'ready',rootBlocker:'none',decision:'ALLOW'},
  continuity:{quorumOk:true,mode:'multi-provider',channels:['web'],whatsappDependencyRequired:false},
  channels:[],zees16:{proven:16,partial:0,blocked:0},zea10:{proven:10,partial:0,blocked:0,unknown:0},
};
const commercial = {
  generatedAt:now,
  tenant:{id:'zevanory',defaultTenant:true,tenantSource:'server-environment',isolation:'server-owned-bucket-v1',clientSelectable:false},
  metrics:{leadsToday:0,contactsToday:0,creativesInProduction:0,pendingApproval:0,publishedToday:0,salesCentsToday:0},
  robot:{state:'STANDBY',label:'ROBÔ COMERCIAL: STANDBY',reason:'Worker pausado para correção de qualidade.',lastHeartbeatAt:null,externalProspecting:false,publishAdapterReady:false,activeChannels:[]},
  leads:[],creatives:[],publications:[],events:[],support:[],finance:[],evidence:[],
  counts:{leads:0,creatives:0,publications:0,events:0,support:0,finance:0,evidence:0},
};
const bootstrap = {
  dashboard:{systems:[],audits:[],improvements:[],incidents:[],policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'evidence'},lastEngineRun:now,certificationRuns:[]},
  operations,commercial,cfo:null,products:[],certificationTargets:[],summary:{total:0,salesEnabled:0,commercialReady:0,blocked:0,certified:0,inCertification:0,zeesBlocked:0},
};
const fastOverview = {
  elapsedMs:24,
  sources:{
    health:{ok:true,elapsedMs:12,error:null},status:{ok:true,elapsedMs:12,error:null},
    control:{ok:true,elapsedMs:12,error:null},continuity:{ok:true,elapsedMs:12,error:null},inventory:{ok:true,elapsedMs:12,error:null},
  },
  operations,summary:{total:0,salesEnabled:0,commercialReady:0,blocked:0},
};
const trust={state:'GREEN',sha:'preview',evidenceRoot:'preview',policyVersion:'preview',quorum:{passed:3,total:3,required:3,conflicts:0,independentKeys:3},zea10:{proven:10,partial:0,blocked:0},engines:[],checkedAt:now};

const browser=await chromium.launch({headless:true});
const report=[];
for (const theme of ['light','dark']) {
  const context=await browser.newContext({viewport:{width:1536,height:730},deviceScaleFactor:1.25,colorScheme:theme,reducedMotion:'reduce'});
  await context.addInitScript(({theme})=>{
    localStorage.setItem('arbm_admin_session','premium-preview');
    localStorage.setItem('zpc_theme',theme);
  },{theme});
  const page=await context.newPage();
  await page.route('**/api/commercial/funnel',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,summary:null,readiness:{status:'AGUARDAR',headline:'Ainda não é hora de pagar anúncios.',nextMilestone:'Vendas abertas em produção: vendas ainda fechadas (modo teste).',criteria:[{id:'sales-open',label:'Vendas abertas em produção',ok:false,detail:''}],metrics:{visitors:0,paid:0,conversion:0,conversionLow:0,aov:0,refundRate:0,maxCpa:0,maxCpc:0,breakEvenRoas:0},plan:null}})}));
    await page.route(/\/api\/sales\/(state|switch)$/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,requested:false,open:false,switchedAt:null,preflightFresh:true,preflight:{ok:false,at:'2026-09-26T16:00:00.000Z',checks:[{id:'mercadopago_production_token',ok:false,detail:'credencial de teste'}]}})}));
    await page.route('**/api/admin/bootstrap',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap)}));
  await page.route('**/api/admin/overview',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fastOverview)}));
  await page.route(/\/(control\/)?api\/commercial\/stream$/,r=>r.fulfill({status:200,contentType:'text/event-stream',body:'event: commercial-update\ndata: {}\n\n'}));
  await page.route('**/global-trust.json*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(trust)}));
  await page.route('**/version.json*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sha:'0000000000000000000000000000000000000000'})}));
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await page.getByText('O negócio em uma tela.',{exact:true}).waitFor({state:'visible',timeout:15000});
  await page.waitForTimeout(150);
  const audit=await page.evaluate(()=>{
    const root=document.documentElement, body=document.body;
    const shell=document.querySelector('.zpcAppShell');
    const visible=[...(shell?.querySelectorAll('*')||[])].filter(el=>{
      const s=getComputedStyle(el); const r=el.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
    });
    const clipped=visible.filter(el=>{
      const r=el.getBoundingClientRect();
      return r.left < -1 || r.right > innerWidth+1 || r.top < -1 || r.bottom > innerHeight+1;
    }).map(el=>({tag:el.tagName,cls:el.className,text:(el.textContent||'').trim().slice(0,80)}));

    const parseRgb=(value)=>{
      const match=String(value).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/i);
      return match ? {r:+match[1],g:+match[2],b:+match[3],a:match[4]===undefined?1:+match[4]} : null;
    };
    const luminance=({r,g,b})=>{
      const cv=[r,g,b].map(value=>{
        const c=value/255;
        return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4);
      });
      return 0.2126*cv[0]+0.7152*cv[1]+0.0722*cv[2];
    };
    const contrast=(a,b)=>{
      const l1=luminance(a),l2=luminance(b);
      return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    };
    const effectiveBg=(el)=>{
      let node=el;
      while(node){
        const c=parseRgb(getComputedStyle(node).backgroundColor);
        if(c && c.a>0.95) return c;
        node=node.parentElement;
      }
      return parseRgb(getComputedStyle(document.body).backgroundColor);
    };
    const directText=(el)=>[...el.childNodes].some(node=>node.nodeType===Node.TEXT_NODE && String(node.textContent||'').trim().length>0);
    const contrastFailures=visible.filter(directText).map(el=>{
      const fg=parseRgb(getComputedStyle(el).color), bg=effectiveBg(el);
      return fg&&bg ? {el,ratio:contrast(fg,bg),fg,bg} : null;
    }).filter(Boolean).filter(item=>item.ratio<4.5).map(item=>({
      tag:item.el.tagName,cls:item.el.className,text:(item.el.textContent||'').trim().slice(0,80),ratio:Number(item.ratio.toFixed(2)),fg:item.fg,bg:item.bg
    }));

    const rgbToHueSat=({r,g,b})=>{
      const rr=r/255,gg=g/255,bb=b/255,max=Math.max(rr,gg,bb),min=Math.min(rr,gg,bb),d=max-min;
      let h=0;
      if(d){
        if(max===rr) h=60*(((gg-bb)/d)%6);
        else if(max===gg) h=60*((bb-rr)/d+2);
        else h=60*((rr-gg)/d+4);
      }
      if(h<0) h+=360;
      const l=(max+min)/2;
      const sat=d===0?0:d/(1-Math.abs(2*l-1));
      return {h,sat};
    };
    const blueUsages=[];
    for(const el of visible){
      const cs=getComputedStyle(el);
      for(const prop of ['color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor']){
        const rgb=parseRgb(cs[prop]);
        if(!rgb||rgb.a===0) continue;
        const hs=rgbToHueSat(rgb);
        if(hs.sat>0.20 && hs.h>=185 && hs.h<=255) {
          blueUsages.push({tag:el.tagName,cls:el.className,prop,value:cs[prop],h:Number(hs.h.toFixed(1)),sat:Number(hs.sat.toFixed(2))});
        }
      }
    }
    return {
      horizontalScroll: Math.max(root.scrollWidth,body.scrollWidth)-innerWidth,
      verticalScroll: Math.max(root.scrollHeight,body.scrollHeight)-innerHeight,
      clipped,
      fakeRevenueText: /38\.420|12\.840|R\$\s*38/.test(document.body.innerText),
      emptySaleState: document.body.innerText.includes('Nenhuma venda ainda'),
      testModeStatus: document.body.innerText.includes('Vendas pausadas · modo teste'),
      technicalTrustVisible: !!document.querySelector('.trustStrip'),
      oldHeaderVisible: document.body.innerText.includes('ADMINISTRATIVO GERAL') || document.body.innerText.includes('ZEVANORY CONTROL CENTER'),
      sidebarBrand: document.querySelector('.zpcSidebarBrand')?.textContent?.trim() === 'ZEVANORY',
      font: getComputedStyle(document.body).fontFamily,
      contrastFailures,
      blueUsages: blueUsages.slice(0,30),
    };
  });
  const path=`${outDir}/overview-${theme}-1536x730@1.25.png`;
  await page.screenshot({path,fullPage:false});
  report.push({theme,path,audit});
  if(audit.horizontalScroll>1 || audit.verticalScroll>1 || audit.clipped.length || audit.fakeRevenueText || !audit.emptySaleState || !audit.testModeStatus || audit.technicalTrustVisible || audit.oldHeaderVisible || !audit.sidebarBrand || !/Inter/i.test(audit.font) || audit.contrastFailures.length || audit.blueUsages.length) {
    throw new Error('PREMIUM_OVERVIEW_PREVIEW_FAIL '+JSON.stringify({theme,audit}));
  }
  await context.close();
}
await browser.close();
await fs.writeFile(`${outDir}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log('PREMIUM_OVERVIEW_PREVIEW=PASS');
console.log(JSON.stringify(report));
