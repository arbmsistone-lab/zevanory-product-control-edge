export async function measureLayout(page){return await page.evaluate(()=>{
  const issues=[],controls=[];
  const dialog=document.querySelector('[role=dialog]');
  for(const e of document.querySelectorAll(dialog?'[role=dialog], [role=dialog] *':'body *')){const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!r.width||!r.height||s.visibility==='hidden')continue;
   if(r.bottom>innerHeight+1||r.right>innerWidth+1||r.left< -1||r.top< -1)issues.push({kind:'bounds',element:e.tagName+'.'+e.getAttribute('class'),bottom:r.bottom});
   if(e.scrollHeight>e.clientHeight+2&&['hidden','clip','auto','scroll'].includes(s.overflowY)||e.scrollWidth>e.clientWidth+2&&['hidden','clip','auto','scroll'].includes(s.overflowX))issues.push({kind:'clipping-or-scroll',element:e.tagName+'.'+e.getAttribute('class')});
   if(e.matches('button,a[href],input,select,textarea,summary'))controls.push(e);
  }
  // Sibling action overlap excludes legitimate parent/child decoration.
  for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(a.contains(b)||b.contains(a))continue;const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>2&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>2)issues.push({kind:'action-overlap',element:a.getAttribute('aria-label')||a.textContent,other:b.getAttribute('aria-label')||b.textContent});}
  return{globalX:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,globalY:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)-innerHeight,issues};
 });}
