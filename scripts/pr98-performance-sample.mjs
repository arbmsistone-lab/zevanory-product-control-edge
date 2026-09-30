import{chromium}from'playwright';import fs from'node:fs/promises';import assert from'node:assert/strict';import{bootstrap}from'./control-center-fixtures.mjs';
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1366,height:768}});const cdp=await p.context().newCDPSession(p);let calls=0;
await p.addInitScript(()=>{localStorage.setItem('arbm_admin_session','test-session');window.auditLongTasks=[];new PerformanceObserver(list=>window.auditLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})});
await p.route('**/api/admin/bootstrap',r=>{calls++;return r.fulfill({json:bootstrap})});
try{
 await p.goto('http://127.0.0.1:4173');await p.getByRole('heading',{name:'ZEVANORY CONTROL CENTER',exact:true}).waitFor();
 await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Memory.getDOMCounters');
 for(let i=0;i<40;i++){await p.getByRole('button',{name:'Abrir evidência da Trust Chain'}).click();await p.getByRole('button',{name:'Voltar',exact:true}).click()}
 await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Memory.getDOMCounters');
 assert.equal(calls,1,'navigation triggered redundant bootstrap');assert.ok(after.nodes<=before.nodes+200,'retained DOM growth');
 const report={source:process.env.CANDIDATE_SHA||'working-tree-uncommitted',scope:'local synthetic navigation sample; not full production performance or lifetime leak certification',bootstrapCalls:calls,cycles:40,before,after,longTasks:await p.evaluate(()=>window.auditLongTasks)};
 await fs.writeFile('audit/pr98-final/performance-sample.json',JSON.stringify(report,null,2));console.log('PERFORMANCE_NAVIGATION_SAMPLE=PASS BOOTSTRAP_CALLS='+calls+' DOM_BEFORE='+before.nodes+' DOM_AFTER='+after.nodes);
}finally{await b.close()}
