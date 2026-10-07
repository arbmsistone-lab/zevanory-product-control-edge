import { chromium } from 'playwright';
import fs from 'node:fs/promises';

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
];
const results = [];

for (const size of sizes) {
  const context = await browser.newContext({ viewport: { width:size.width, height:size.height } });
  await context.addInitScript(() => {
    localStorage.setItem('arbm_admin_session','visual-contract-session');
    localStorage.setItem('zpc_theme','dark');
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  await page.route('**/api/commercial/funnel',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,summary:null,readiness:{status:'AGUARDAR',headline:'Ainda não é hora de pagar anúncios.',nextMilestone:'Vendas abertas em produção: vendas ainda fechadas (modo teste).',criteria:[{id:'sales-open',label:'Vendas abertas em produção',ok:false,detail:''}],metrics:{visitors:0,paid:0,conversion:0,conversionLow:0,aov:0,refundRate:0,maxCpa:0,maxCpc:0,breakEvenRoas:0},plan:null}})}));
    await page.route(/\/api\/sales\/(state|switch)$/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,requested:false,open:false,switchedAt:null,preflightFresh:true,preflight:{ok:false,at:'2026-09-26T16:00:00.000Z',checks:[{id:'mercadopago_production_token',ok:false,detail:'credencial de teste'}]}})}));
    await page.route('**/api/admin/bootstrap', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify(bootstrap),
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
    if (size.width <= 768) {
      const areaSelect = page.getByLabel('Selecionar área do Control Center');
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
    const clipped = [...workspace.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && (r.left < -1 || r.right > window.innerWidth + 1);
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

  await page.screenshot({ path:`${outDir}/${size.name}.png`, fullPage:true });
  results.push({name:size.name,...audit,pageErrors});
  await context.close();
}

await browser.close();
await fs.writeFile(`${outDir}/report.json`, JSON.stringify({ok:true,generatedAt:new Date().toISOString(),results},null,2));
console.log('FINAL_COMMERCIAL_VISUAL_AUDIT=GREEN');
console.log(JSON.stringify(results));
