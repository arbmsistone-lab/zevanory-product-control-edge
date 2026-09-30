import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fixture,sizes,views} from './pr98-layout-fixtures.mjs';
import {measureLayout,walkTaskPages,reachTaskControl} from './pr98-layout-measure.mjs';
const sourceSha=process.env.CANDIDATE_SHA||'working-tree-uncommitted';
const mode=process.env.NATIVE_MATRIX_MODE||'zoom';
assert.ok(['zoom','fonts'].includes(mode));
const selectedSizes=sizes.filter(([w,h],i)=>process.env.NATIVE_PREFLIGHT?h===640||h===600:process.env.LAYOUT_SHARD===undefined||i%3===Number(process.env.LAYOUT_SHARD));
const states=process.env.NATIVE_PREFLIGHT?['SUCCESS','MAX_REALISTIC_DATA','UNICODE']:['EMPTY','SUCCESS','PARTIAL','MAX_REALISTIC_DATA','LONG_TEXT','UNICODE'];
const levels=process.env.NATIVE_PREFLIGHT?(mode==='zoom'?[1.25]:[28]):mode==='zoom'?[.8,.9,1,1.1,1.25]:[16,24,28];
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'pr98-native-surfaces-'));
const extension=path.resolve('scripts/native-zoom-extension');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension],viewport:null});
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
const page=context.pages()[0],cdp=await context.newCDPSession(page),{windowId}=await cdp.send('Browser.getWindowForTarget');
const rows=[];let data=fixture('SUCCESS');
await context.addInitScript(()=>localStorage.setItem('arbm_admin_session','fixture'));
await page.route('**/api/admin/bootstrap',r=>r.fulfill({json:data}));
const origin='http://127.0.0.1:4173';
async function record(meta,surface){await walkTaskPages(page,async taskPage=>{const row={...meta,surface,taskPage,...await measureLayout(page)};rows.push(row);if((row.issues.length||row.globalX>1||row.globalY>1)&&!rows.slice(0,-1).some(r=>r.surface===surface&&r.issues.length))console.log('FIRST_FAILED_SURFACE='+JSON.stringify(row));});}
async function area(key,label){const select=page.getByLabel('Selecionar área do Control Center');if(await select.isVisible())await select.selectOption(key);else await page.getByRole('navigation',{name:'Áreas do ZEVANORY CONTROL CENTER'}).getByRole('button',{name:label,exact:true}).click();}
try{
 for(const theme of ['dark','light'])for(const [width,height]of selectedSizes)for(const level of levels)for(const state of states){
  data=fixture(state);await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width,height}});
  if(mode==='fonts'){const settings=await worker.evaluate(async minimum=>{await chrome.fontSettings.setMinimumFontSize({pixelSize:minimum});return await chrome.fontSettings.getMinimumFontSize({})},level);assert.equal(settings.pixelSize,level);}
  await page.goto(origin);
  if(mode==='zoom'){await worker.evaluate(async zoom=>{const [tab]=await chrome.tabs.query({url:'http://127.0.0.1:4173/*'});await chrome.tabs.setZoom(tab.id,zoom)},level);await page.waitForFunction(z=>Math.abs(devicePixelRatio-z)<.001,level);}
  await page.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
  if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.getByRole('button',{name:theme==='light'?'Ativar tema claro':'Ativar tema escuro'}).click();
  const meta={theme,width,height,mode,level,state,nativeApi:mode==='zoom'?'chrome.tabs.setZoom':'chrome.fontSettings.setMinimumFontSize'};
  await page.getByRole('button',{name:'Abrir evidência da Trust Chain'}).click();for(const name of ['Decisão','Linhagem','Políticas']){await page.getByRole('navigation',{name:'Páginas da evidência'}).getByRole('button',{name,exact:true}).click();await record(meta,'runtime:'+name)}await page.getByRole('button',{name:'Voltar',exact:true}).click();
  for(const [key,label]of views){await area(key,label);await record(meta,key);
   if(key==='products'){await page.getByRole('button',{name:'Novo produto',exact:true}).click();for(let step=0;step<5;step++){await record(meta,'form-step-'+step);if(step<4)await page.getByRole('navigation',{name:'Etapas do produto'}).getByRole('button',{name:'Próxima',exact:true}).click()}await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();}
   if(key==='cfo'){const select=page.getByLabel('Área financeira');for(const [value,name]of [['summary','Resumo'],['adapters','Integrações'],['actions','Decisões'],['receivables','Recebíveis']]){if(await page.locator('.cfoTask').isVisible())await reachTaskControl(page,select);if(await select.isVisible())await select.selectOption(value);else await page.getByRole('navigation',{name:'Páginas do CFO'}).getByRole('button',{name,exact:true}).click();await record(meta,'cfo:'+value)}}
  }
  console.log(JSON.stringify({completed:meta,rows:rows.length,failedRows:rows.filter(r=>r.issues.length||r.globalX>1||r.globalY>1).length}));
 }
}finally{await fs.mkdir('control-center-truth-audit',{recursive:true});await fs.writeFile(`control-center-truth-audit/native-surfaces-${mode}.json`,JSON.stringify({sourceSha,scope:'all application area surfaces and five form steps across native settings; public product routes are separate',sizes:selectedSizes,states,levels,rows},null,2));await context.close();await fs.rm(profile,{recursive:true,force:true})}
const failures=rows.filter(r=>r.issues.length||r.globalX>1||r.globalY>1);console.log('NATIVE_SURFACE_ROWS='+rows.length+' FAILURES='+failures.length);assert.equal(failures.length,0,'Native application surface bounds/clipping/overlap');
