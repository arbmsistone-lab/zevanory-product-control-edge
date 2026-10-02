import fs from 'node:fs';
const real=JSON.parse(fs.readFileSync('C:/Users/airto/zevanory-product-control-audit/audit/baseline/real-viewport-report.json','utf8'));
const matrix=JSON.parse(fs.readFileSync('C:/Users/airto/zevanory-product-control-audit/audit/baseline/matrix-report.json','utf8'));
function freq(items,key){const m=new Map();for(const x of items){const k=key(x);m.set(k,(m.get(k)||0)+1);}return [...m.entries()].sort((a,b)=>b[1]-a[1]);}
const realClips=real.screens.flatMap(x=>x.dom.clipped);
const realTypo=real.screens.flatMap(x=>x.dom.typography);
const outs=matrix.matrix.flatMap(x=>x.dom.outside.map(y=>({...y,screen:x.screen,viewport:x.viewport,theme:x.theme})));
const touch=matrix.matrix.flatMap(x=>x.dom.touch.map(y=>({...y,screen:x.screen,viewport:x.viewport,theme:x.theme})));
console.log('CLIPPED',JSON.stringify(freq(realClips,x=>x.el).slice(0,40),null,2));
console.log('TYPO',JSON.stringify(freq(realTypo,x=>x.type+'|'+x.el+'|'+x.value).slice(0,60),null,2));
console.log('OUTSIDE',JSON.stringify(freq(outs,x=>x.viewport+'|'+x.screen+'|'+x.el).slice(0,60),null,2));
console.log('TOUCH',JSON.stringify(freq(touch,x=>x.viewport+'|'+x.el+'|'+x.w+'x'+x.h).slice(0,40),null,2));