import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1536,height:730},deviceScaleFactor:1.25});
const page=await context.newPage();

async function detect(){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width>0&&r.height>0};
    const all=[...document.querySelectorAll('body *')].filter(visible);
    const atomic=all.filter(e=>(e.textContent||'').trim()&&![...e.children].some(c=>visible(c)&&(c.textContent||'').trim()));
    const clipped=[],outside=[],overlaps=[];
    const desc=e=>e.id?`#${e.id}`:e.tagName.toLowerCase();
    for(const e of all){
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      const clipX=(s.overflowX==='hidden'||s.overflowX==='clip')&&e.scrollWidth>e.clientWidth+1;
      const clipY=(s.overflowY==='hidden'||s.overflowY==='clip')&&e.scrollHeight>e.clientHeight+1;
      if(clipX||clipY||s.textOverflow==='ellipsis')clipped.push({el:desc(e),x:clipX,y:clipY,ellipsis:s.textOverflow==='ellipsis'});
      if(r.left<-1||r.top<-1||r.right>innerWidth+1||r.bottom>innerHeight+1)outside.push({el:desc(e)});
    }
    for(let i=0;i<atomic.length;i++)for(let j=i+1;j<atomic.length;j++){
      const a=atomic[i],b=atomic[j],ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
      const ix=Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left),iy=Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top);
      if(ix>1&&iy>1)overlaps.push({a:desc(a),b:desc(b)});
    }
    return {clipped,outside,overlaps};
  });
}

await page.setContent('<main id="clean">Clean content</main>');
const positive=await detect();
const positivePass=!positive.clipped.length&&!positive.outside.length&&!positive.overlaps.length;

await page.setContent(`<style>
#cut{width:32px;height:16px;overflow:hidden;white-space:nowrap}
#a,#b{position:fixed;left:120px;top:80px;width:120px;height:40px}
#outside{position:fixed;left:1520px;top:160px;width:80px;height:24px}
</style><div id="cut">CUT CONTENT MUST OVERFLOW</div><div id="a">OVERLAP A</div><div id="b">OVERLAP B</div><div id="outside">OUTSIDE</div>`);
const negative=await detect();
const cutPass=negative.clipped.some(x=>x.el==='#cut');
const overlapPass=negative.overlaps.some(x=>(x.a==='#a'&&x.b==='#b')||(x.a==='#b'&&x.b==='#a'));
const outsidePass=negative.outside.some(x=>x.el==='#outside');
const result={positivePass,cutPass,overlapPass,outsidePass,negativePass:cutPass&&overlapPass&&outsidePass};
console.log(JSON.stringify(result));
await browser.close();
if(!result.positivePass||!result.negativePass)process.exit(1);
