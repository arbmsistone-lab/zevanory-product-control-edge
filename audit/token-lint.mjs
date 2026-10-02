import fs from 'node:fs';
import path from 'node:path';
const root='C:/Users/airto/zevanory-product-control-audit/src';
const out='C:/Users/airto/zevanory-product-control-audit/audit/baseline/token-lint.json';
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(css|tsx|ts)$/.test(e.name))files.push(p);}}
walk(root);
const issues=[];
function lineOf(s,i){return s.slice(0,i).split('\n').length;}
function scanText(file,s){
  const isTokens=file.replace(/\\/g,'/').endsWith('/styles/tokens.css');
  if(!isTokens){
    for(const m of s.matchAll(/(?:^|[;{\s])(color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^;]+\)|hsla?\([^;]+\))/gm))
      issues.push({type:'color',file,line:lineOf(s,m.index),value:m[2]});
    for(const m of s.matchAll(/(?:margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|gap|row-gap|column-gap)\s*:\s*([^;}{]+)/gm)){
      const vals=[...m[1].matchAll(/-?\d*\.?\d+(px|rem|em)/g)].map(x=>x[0]).filter(v=>!/^0(?:\.0+)?(?:px|rem|em)$/.test(v));
      for(const v of vals)issues.push({type:'spacing',file,line:lineOf(s,m.index),value:v});
    }
    for(const m of s.matchAll(/font-size\s*:\s*([^;}{]+)/gm)){
      const v=m[1].trim();
      if(!v.includes('var(--zpc-font-')&&!['inherit','initial','unset'].includes(v))issues.push({type:'font-size',file,line:lineOf(s,m.index),value:v.slice(0,120)});
    }
  }
  if(!isTokens){
    for(const m of s.matchAll(/border-radius\s*:\s*(-?\d*\.?\d+(?:px|rem|em))/gm))
      issues.push({type:'radius',file,line:lineOf(s,m.index),value:m[1]});
    for(const m of s.matchAll(/z-index\s*:\s*(-?\d+)/gm))
      issues.push({type:'z-index',file,line:lineOf(s,m.index),value:m[1]});
    for(const m of s.matchAll(/box-shadow\s*:\s*([^;}{]+\d[^;}{]*)/gm))
      if(!m[1].includes('var('))issues.push({type:'shadow',file,line:lineOf(s,m.index),value:m[1].trim().slice(0,120)});
  }
  if(/\.(tsx|ts)$/.test(file)&&!file.replace(/\\/g,'/').endsWith('/styles/tokens.ts')){
    for(const m of s.matchAll(/#[0-9a-fA-F]{3,8}\b/g))
      issues.push({type:'tsx-color',file,line:lineOf(s,m.index),value:m[0]});
    for(const m of s.matchAll(/\bzIndex\s*:\s*(\d+)/g))
      issues.push({type:'tsx-z-index',file,line:lineOf(s,m.index),value:m[1]});
  }
}
for(const f of files)scanText(f,fs.readFileSync(f,'utf8'));
const neg=[];
const fake='x{color:#123456;padding:13px;font-size:13px;border-radius:7px;z-index:999;box-shadow:0 2px 3px #000}';
const before=issues.length;scanText('NEGATIVE.css',fake);neg.push(...issues.splice(before));
const negTypes=new Set(neg.map(x=>x.type));
const negativePass=['color','spacing','font-size','radius','z-index','shadow'].every(t=>negTypes.has(t));
const counts=issues.reduce((a,x)=>(a[x.type]=(a[x.type]||0)+1,a),{});
const report={generatedAt:new Date().toISOString(),negativePass,negativeIssues:neg,counts,total:issues.length,issues};
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({negativePass,counts,total:issues.length},null,2));
process.exitCode=negativePass?0:2;