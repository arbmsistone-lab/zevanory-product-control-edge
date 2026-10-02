import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseUrl = process.env.PREMIUM_OVERVIEW_URL || 'http://127.0.0.1:4173';
const outDir = 'premium-overview-preview';
const now = new Date().toISOString();
await fs.mkdir(outDir,{recursive:true});

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
    const visible=[...document.querySelectorAll('.premiumOverview *')].filter(el=>{
      const s=getComputedStyle(el); const r=el.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
    });
    const clipped=visible.filter(el=>{
      const r=el.getBoundingClientRect();
      return r.left < -1 || r.right > innerWidth+1 || r.top < -1 || r.bottom > innerHeight+1;
    }).map(el=>({tag:el.tagName,cls:el.className,text:(el.textContent||'').trim().slice(0,80)}));
    return {
      horizontalScroll: Math.max(root.scrollWidth,body.scrollWidth)-innerWidth,
      verticalScroll: Math.max(root.scrollHeight,body.scrollHeight)-innerHeight,
      clipped,
      fakeRevenueText: /38\.420|12\.840|R\$\s*38/.test(document.body.innerText),
      emptySaleState: document.body.innerText.includes('Nenhuma venda ainda'),
      technicalTrustVisible: !!document.querySelector('.trustStrip'),
      font: getComputedStyle(document.body).fontFamily,
    };
  });
  const path=`${outDir}/overview-${theme}-1536x730@1.25.png`;
  await page.screenshot({path,fullPage:false});
  report.push({theme,path,audit});
  if(audit.horizontalScroll>1 || audit.verticalScroll>1 || audit.clipped.length || audit.fakeRevenueText || !audit.emptySaleState || audit.technicalTrustVisible || !/Inter/i.test(audit.font)) {
    throw new Error('PREMIUM_OVERVIEW_PREVIEW_FAIL '+JSON.stringify({theme,audit}));
  }
  await context.close();
}
await browser.close();
await fs.writeFile(`${outDir}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log('PREMIUM_OVERVIEW_PREVIEW=PASS');
console.log(JSON.stringify(report));
