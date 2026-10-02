import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const contexts = browser.contexts();
const context = contexts[0];
let pages = context.pages();
let page = pages.find(p => p.url().includes('controle.zevanory.api.br')) || pages[0];
if (!page) page = await context.newPage();
await page.goto('https://controle.zevanory.api.br', {waitUntil:'domcontentloaded', timeout:30000});
await page.waitForTimeout(1000);
const metrics = await page.evaluate(async () => {
  const v = await fetch('/version.json', {cache:'no-store'}).then(r => r.json());
  return {
    url: location.href,
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
    devicePixelRatio,
    visualViewportScale: window.visualViewport?.scale ?? null,
    screen: {width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight},
    version: v
  };
});
fs.writeFileSync('C:/Users/airto/zevanory-product-control-audit/audit/browser_metrics.json', JSON.stringify(metrics,null,2));
await page.screenshot({path:'C:/Users/airto/zevanory-product-control-audit/audit/browser_page.png', fullPage:false});
console.log(JSON.stringify(metrics,null,2));
await browser.close();
