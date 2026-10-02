import { chromium } from 'playwright';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const context=browser.contexts()[0];
const page=context.pages().find(p=>p.url().includes('controle.zevanory.api.br'))||context.pages()[0];
await page.waitForTimeout(500);
const state=await page.evaluate(()=>({
  hasSession:Boolean(localStorage.getItem('arbm_admin_session')),
  body:(document.body?.innerText||'').slice(0,1200),
  innerWidth,innerHeight,devicePixelRatio
}));
console.log(JSON.stringify(state,null,2));
await browser.close();