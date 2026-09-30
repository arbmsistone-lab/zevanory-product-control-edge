import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import {walkTaskPages,reachTaskControl,measureLayout} from './pr98-layout-measure.mjs';

const baseUrl = process.env.VISUAL_AUDIT_BASE_URL || 'http://127.0.0.1:4173';
const outDir = process.env.VISUAL_AUDIT_OUT || 'visual-audit';
const now = '2026-09-26T16:30:00.000Z';

const record = (id, kind, title, status, extra = {}) => ({
  id, kind, title,
  detail: extra.detail || 'Registro auditável de validação visual.',
  status,
  channel: extra.channel || null,
  product: extra.product || 'ZEVANORY',
  productId: null,
  valueCents: extra.valueCents ?? null,
  source: extra.source || 'visual-contract',
  sourceKey: extra.sourceKey || id,
  evidence: ['visual-contract'],
  createdAt: now,
  updatedAt: now,
  publishedAt: extra.publishedAt || null,
});

const commercial = {
  generatedAt: now,
  metrics: {
    leadsToday: 16,
    contactsToday: 4,
    creativesInProduction: 3,
    pendingApproval: 2,
    publishedToday: 1,
    salesCentsToday: 129900,
  },
  robot: {
    state: 'ACTIVE',
    label: 'ROBÔ COMERCIAL: ATIVO',
    reason: 'Prospecção ativa com heartbeat recente; publicação permanece condicionada aos gates.',
    lastHeartbeatAt: now,
    externalProspecting: true,
    publishAdapterReady: false,
    activeChannels: ['web'],
  },
  leads: [record('lead-1','lead','Lead público de auditoria','new',{channel:'web'})],
  creatives: [record('creative-1','creative','Brief comercial de auditoria','approval')],
  publications: [record('publication-1','publication','Publicação auditada','published',{channel:'web',publishedAt:now})],
  events: [record('event-1','event','Ciclo de prospecção concluído','research')],
  support: [],
  finance: [record('finance-1','finance','Receita confirmada','confirmed',{valueCents:129900,source:'sale'})],
  evidence: [record('evidence-1','evidence','Evidência visual do release','confirmed')],
  counts: { leads:1, creatives:1, publications:1, events:1, support:0, finance:1, evidence:1 },
};

const bootstrap = {
  dashboard: {
    systems: [], audits: [], improvements: [], incidents: [],
    policy: { zeroSpend:true, failClosed:true, destructiveActions:false, greenRule:'FALSE_GREEN=0' },
    lastEngineRun: now,
    certificationRuns: [],
  },
  globalTrust: {
    state:'GREEN', sha:'visual-contract', evidenceRoot:'visual-contract', policyVersion:'ZEA-10',
    quorum:{passed:3,total:3,required:3,conflicts:0,independentKeys:3},
    zea10:{proven:10,partial:0,blocked:0},
    engines:[], checkedAt:now,
  },
  operations: {
    available:true, generatedAt:now, releaseSha:'visual-contract',
    health:{ready:true,live:true,databaseReachable:true,schemaReady:true,requiredTables:1,requiredMigrations:1,missingTables:0,missingMigrations:0},
    runtime:{sales:'active',checkout:'ready',financial:'ready',whatsapp:'blocked'},
    control:{globalState:'GREEN',rootBlocker:'',decision:'ALLOW'},
    continuity:{quorumOk:true,mode:'multi-provider',channels:['web'],whatsappDependencyRequired:false},
    channels:[{name:'web',scopeStatus:'ready',releaseGate:'green',commercialExecution:'active'}],
    zees16:{proven:16,partial:0,blocked:0},
    zea10:{proven:10,partial:0,blocked:0,unknown:0},
  },
  commercial,
  cfo: null,
  products: [],
  certificationTargets: [],
  summary: { total:0,salesEnabled:0,commercialReady:0,blocked:0,certified:0,inCertification:0,zeesBlocked:0 },
};

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const sizes = [
  { name:'master-1920x1080', width:1920, height:1080 },
  { name:'master-1366x768', width:1366, height:768 },
  { name:'desktop-1440', width:1440, height:1000 },
  { name:'tablet-768', width:768, height:1024 },
  { name:'mobile-375', width:375, height:812 },
  { name:'narrow-low-360x640', width:360, height:640 },
  { name:'desktop-low-1366x600', width:1366, height:600 },
];
const results = [];

async function reconstruct(page) {
  await page.locator('.readerText[data-pages]').waitFor();
  let text = '';
  for (let n = 0; n < 1000; n++) {
    await page.waitForFunction(() => Number(document.querySelector('.readerText')?.dataset.pages) > 0);
    text += await page.locator('.readerText').textContent();
    const next = page.getByRole('button', {name:'Próxima', exact:true});
    if (!await next.isEnabled()) return text;
    await next.click();
  }
  throw new Error('reader pagination did not terminate');
}


for (const theme of ['dark','light']) for (const size of sizes) for (const mode of ['compact','long-state']) {
  const fixture = structuredClone(bootstrap);
  if (mode === 'compact') fixture.commercial.robot.reason = 'Heartbeat recente; publicação condicionada aos gates.';
  const context = await browser.newContext({ viewport: { width:size.width, height:size.height } });
  await context.addInitScript(theme => {
    localStorage.setItem('arbm_admin_session','visual-contract-session');
    localStorage.setItem('zpc_theme',theme);
  },theme);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  await page.route('**/api/admin/bootstrap', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify(fixture),
  }));
  await page.route('**/global-trust.json*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify(bootstrap.globalTrust),
  }));
  await page.route(/\/(control\/)?api\/commercial\/stream$/, route => route.fulfill({
    status:200,
    contentType:'text/event-stream; charset=utf-8',
    headers:{'cache-control':'no-cache','connection':'keep-alive'},
    body:'event: commercial-update\\ndata: {"seq":1,"at":"2026-09-26T16:30:00.000Z"}\\n\\n',
  }));

  await page.goto(baseUrl, { waitUntil:'domcontentloaded', timeout:30_000 });
  try {
    const areaSelect = page.getByLabel('Selecionar área do Control Center');
    await page.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
    if (await areaSelect.isVisible()) {
      await areaSelect.waitFor({ state:'visible', timeout:20_000 });
      await areaSelect.selectOption('commercial');
    } else {
      const commercialButton = page.getByRole('button', { name:'Comercial', exact:true });
      await commercialButton.waitFor({ state:'visible', timeout:20_000 });
      await commercialButton.click();
    }
  } catch (error) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    await page.screenshot({ path: outDir + '/' + size.name + '-pre-nav-failure.png', fullPage:true }).catch(() => {});
    await fs.writeFile(outDir + '/' + size.name + '-pre-nav-failure.txt', bodyText);
    throw error;
  }
  if (await page.locator('.commercialTask').isVisible()) {
    // The unchanged long fixture must use the paginated task surface, retaining
    // the complete operational state instead of requiring compact-only DOM.
    await page.locator('.commercialTask').waitFor({state:'visible', timeout:15_000});
    const stateControl=page.getByRole('button', {name:'Estado operacional completo',exact:true});
    await reachTaskControl(page,stateControl);
    await stateControl.click();
    const fields = [JSON.stringify(fixture.commercial.robot,null,2), JSON.stringify(fixture.commercial.metrics,null,2)];
    for (let field=0; field<fields.length; field++) {
      const actual = await reconstruct(page);
      if (actual !== fields[field]) throw new Error(size.name+': operational field lost data');
      if (field+1<fields.length) await page.getByRole('button',{name:'Próximo campo',exact:true}).click();
    }
    await page.getByRole('button',{name:'Voltar',exact:true}).click();
    const geometry = await page.evaluate(() => {
      const issues=[];
      for(const el of document.querySelectorAll('body *')) {
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        if(!r.width||!r.height||s.visibility==='hidden') continue;
        if(r.left < -1 || r.top < -1 || r.right > innerWidth+1 || r.bottom > innerHeight+1 ||
          (el.scrollHeight>el.clientHeight+2 && ['hidden','clip','auto','scroll'].includes(s.overflowY)) ||
          (el.scrollWidth>el.clientWidth+2 && ['hidden','clip','auto','scroll'].includes(s.overflowX))) issues.push(el.tagName+'.'+el.className);
      }
      return {issues,globalX:document.documentElement.scrollWidth-innerWidth,globalY:document.documentElement.scrollHeight-innerHeight};
    });
    if(geometry.issues.length || geometry.globalX>1 || geometry.globalY>1) throw new Error(size.name+': task geometry='+JSON.stringify(geometry));
    await walkTaskPages(page,async taskPage=>{const row=await measureLayout(page);if(row.issues.length||row.globalX>1||row.globalY>1)throw new Error(size.name+': task '+taskPage+' geometry='+JSON.stringify(row));});
    if(pageErrors.length) throw new Error(size.name+': page errors='+JSON.stringify(pageErrors));
    await page.screenshot({path:`${outDir}/${size.name}-${theme}-long-state.png`,fullPage:true});
    results.push({name:size.name,theme,mode,operationalStateReconstruction:true,...geometry,pageErrors});
    await context.close();
    continue;
  }
  await page.locator('.commercialWorkspace').waitFor({ state:'visible', timeout:15_000 });
  await page.locator('.liveTelemetry').waitFor({ state:'visible', timeout:15_000 });

  const audit = await page.evaluate(() => {
    const expected = [
      'Leads encontrados hoje','Contatos hoje','Criativos em produção',
      'Aguardando aprovação','Publicados hoje','Vendas hoje',
    ];
    const root = document.documentElement;
    const body = document.body;
    const workspace = document.querySelector('.commercialWorkspace');
    if (!workspace) throw new Error('commercialWorkspace missing');
    const rect = workspace.getBoundingClientRect();
    const visibleText = body.innerText;
    const horizontalOverflow = Math.max(root.scrollWidth, body.scrollWidth) - window.innerWidth;
    const metricCards = [...document.querySelectorAll('.commercialMetrics article')].map((el, index) => {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY;
      const bottom = r.bottom + window.scrollY;
      return {
        index,
        left: Math.round(r.left),
        right: Math.round(r.right),
        top: Math.round(top),
        bottom: Math.round(bottom),
        horizontallyContained: r.left >= -1 && r.right <= window.innerWidth + 1,
        reachableInDocument: top >= -1 && bottom <= root.scrollHeight + 1,
      };
    });
    const directSections = [...workspace.children].map((el, index) => {
      const r = el.getBoundingClientRect();
      return { index, cls:String(el.className || ''), top:Math.round(r.top), bottom:Math.round(r.bottom), visible:getComputedStyle(el).display !== 'none' };
    }).filter(item => item.visible);
    const sectionOverlaps = [];
    for (let i = 1; i < directSections.length; i++) {
      if (directSections[i].top < directSections[i - 1].bottom - 1) {
        sectionOverlaps.push({ previous:directSections[i - 1], current:directSections[i] });
      }
    }
    const clipped = [workspace,...workspace.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && (r.left < -1 || r.top < -1 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1);
    }).slice(0,10).map(el => ({
      tag:el.tagName,
      cls:String(el.className || ''),
      text:(el.textContent || '').trim().slice(0,80),
      left:Math.round(el.getBoundingClientRect().left),
      right:Math.round(el.getBoundingClientRect().right),
    }));
    return {
      viewport:{width:window.innerWidth,height:window.innerHeight},
      document:{width:root.scrollWidth,height:root.scrollHeight},
      workspace:{left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)},
      horizontalOverflow,
      metricCards,
      directSections,
      sectionOverlaps,
      clipped,
      kpis:expected.map(label => ({label,present:visibleText.includes(label)})),
      robotActive:(() => {
        const badge=document.querySelector('.robotBadge');
        return Boolean(badge?.classList.contains('active') && (badge.textContent || '').includes('ROBÔ COMERCIAL: ATIVO'));
      })(),
      robotBadgeVisible:(() => {
        const badge=document.querySelector('.robotBadge');
        if(!badge) return false;
        const r=badge.getBoundingClientRect(), s=getComputedStyle(badge);
        return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';
      })(),
    };
  });

  if (!audit.robotActive) throw new Error(size.name + ': robot semantic ACTIVE state missing');
  if (size.width > 620 && !audit.robotBadgeVisible) throw new Error(size.name + ': robot active badge must be visible above mobile breakpoint');
  if (!audit.kpis.every(item => item.present)) throw new Error(size.name + ': KPI missing ' + JSON.stringify(audit.kpis));
  if (audit.horizontalOverflow > 1) throw new Error(size.name + ': horizontal overflow=' + audit.horizontalOverflow);
  if (audit.metricCards.length !== 6 || !audit.metricCards.every(card => card.horizontallyContained && card.reachableInDocument)) throw new Error(size.name + ': KPIs not reachable without clipping=' + JSON.stringify(audit.metricCards));
  if (audit.sectionOverlaps.length) throw new Error(size.name + ': section overlap=' + JSON.stringify(audit.sectionOverlaps));
  if (audit.clipped.length) throw new Error(size.name + ': clipped=' + JSON.stringify(audit.clipped));
  if (pageErrors.length) throw new Error(size.name + ': page errors=' + JSON.stringify(pageErrors));

  const pager=page.getByRole('navigation',{name:'Páginas da Central Comercial'});
  if(await pager.count()) {
    if(!await pager.isVisible()) throw new Error(size.name+': page controls hidden');
    for(const label of ['Atividade','Pipeline','Provas']) {
      await pager.getByRole('button',{name:label,exact:true}).click();
      const geometry=await page.evaluate(()=>{
        const issues=[];
        for(const el of document.querySelectorAll('.commercialWorkspace, .commercialWorkspace *')) {
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          if(!r.width||!r.height||s.visibility==='hidden') continue;
          if(r.left< -1||r.top< -1||r.right>innerWidth+1||r.bottom>innerHeight+1||
            (el.scrollHeight>el.clientHeight+2&&['hidden','clip','auto','scroll'].includes(s.overflowY))||
            (el.scrollWidth>el.clientWidth+2&&['hidden','clip','auto','scroll'].includes(s.overflowX))) issues.push(el.tagName+'.'+el.className);
        }
        return {issues,globalX:document.documentElement.scrollWidth-innerWidth,globalY:document.documentElement.scrollHeight-innerHeight};
      });
      if(geometry.issues.length||geometry.globalX>1||geometry.globalY>1) throw new Error(size.name+': '+label+' page geometry='+JSON.stringify(geometry));
      results.push({name:size.name,theme,mode,page:label,...geometry});
    }
  }
  await page.screenshot({ path:`${outDir}/${size.name}-${theme}.png`, fullPage:true });
  results.push({name:size.name,theme,mode,...audit,pageErrors});
  await context.close();
}

await browser.close();
await fs.writeFile(`${outDir}/report.json`, JSON.stringify({ok:true,sourceSha:process.env.CANDIDATE_SHA || 'working-tree-uncommitted',scope:'commercial compact/task surfaces; not full application layout certification',generatedAt:new Date().toISOString(),results},null,2));
console.log('FINAL_COMMERCIAL_VISUAL_AUDIT=GREEN');
console.log(JSON.stringify(results));
