// NC-010 / R38 | P04 custodial offline toolkit. No network, no Meta calls.
// Do NOT commit holdout truth, labels, owner split seed or predictions before freeze.
import {createHash,createHmac} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
const sha=v=>createHash("sha256").update(v).digest("hex");
function csvRead(path){
 const rows=readFileSync(path,"utf8").trim().split(/\r?\n/).map(x=>x.split(",").map(v=>v.trim()));
 const h=rows.shift();return rows.map(cols=>Object.fromEntries(h.map((k,i)=>[k,cols[i]])));
}
function csvOut(rows,h){return h.join(",")+"\n"+rows.map(r=>h.map(k=>r[k]).join(",")).join("\n")+"\n"}
function fail(m){throw Error("P04_NO_GO:"+m)}
function wilson(k,n,z=1.95996398454){
 if(!n)return 0;
 const p=k/n,d=1+z*z/n;
 return (p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/d;
}
function kappa(tp,fp,fn,tn){
 const n=tp+fp+fn+tn;if(!n)return null;
 const obs=(tp+tn)/n,predPos=(tp+fp)/n,realPos=(tp+fn)/n;
 const chance=predPos*realPos+(1-predPos)*(1-realPos);
 return chance===1?null:(obs-chance)/(1-chance);
}
function matrix(items){
 let tp=0,fp=0,fn=0,tn=0;
 for(const x of items){if(x.label===1&&x.predicted===1)tp++;else if(x.label===0&&x.predicted===1)fp++;else if(x.label===1&&x.predicted===0)fn++;else tn++;}
 return {tp,fp,fn,tn,kappa:kappa(tp,fp,fn,tn),recall:tp+fn?tp/(tp+fn):null,
  recall_wilson_lower95:tp+fn?wilson(tp,tp+fn):null};
}
const mode=process.argv[2];
if(mode==="split"){
 const seed=process.env.P04_CUSTODIAN_SPLIT_SEED;
 if(!seed||seed.length<24)fail("custodian_secret_seed_required");
 const source=JSON.parse(readFileSync(resolve(process.argv[3]||"data/d7-legacy-media-seed.json"),"utf8"));
 const hashes=source.unique_media_sha256;
 if(!Array.isArray(hashes)||hashes.length!==349||new Set(hashes).size!==349||hashes.some(x=>!/^[a-f0-9]{64}$/.test(x)))fail("349_unique_sha_required");
 const grouped=[...hashes].sort((a,b)=>
  createHmac("sha256",seed).update(a).digest("hex").localeCompare(createHmac("sha256",seed).update(b).digest("hex")));
 const output=resolve(process.argv[4]||"");
 if(!process.argv[4])fail("custodian_output_directory_required");
 mkdirSync(output,{recursive:true,mode:0o700});
 const allocation=[["train_blind.csv",grouped.slice(0,150)],["holdout_blind.csv",grouped.slice(150,290)],["challenge_blind.csv",grouped.slice(290)]];
 for(const [name,list] of allocation)writeFileSync(join(output,name),csvOut(list.map(sha256=>({sha256})),["sha256"]),{mode:0o600});
 const m={protocol:"P04_PROVISIONAL_UNSTRATIFIED_NOT_CERTIFIED",counts:{train:150,holdout:140,challenge:59},inventory_sha256:sha(JSON.stringify([...hashes].sort())),
  holdout_blind_sha256:sha(readFileSync(join(output,"holdout_blind.csv"))),seed_sha256:sha(seed),requires_custodian_stratification:true};
 writeFileSync(join(output,"split-manifest.json"),JSON.stringify(m,null,2)+"\n",{mode:0o600});
 console.log(JSON.stringify({result:"PROVISIONAL_SPLIT_ONLY",counts:m.counts,blind_holdout_sha256:m.holdout_blind_sha256}));
}else if(mode==="score"){
 // Run ONLY inside custodian environment AFTER immutable prediction SHA committed.
 const [blindPath,labelsPath,predsPath,outPath]=process.argv.slice(3);
 if(!blindPath||!labelsPath||!predsPath||!outPath)fail("usage_score_blind_labels_predictions_report");
 const ids=csvRead(blindPath).map(x=>x.sha256),idSet=new Set(ids);
 if(ids.length!==140||idSet.size!==140)fail("holdout_blind_140_unique_required");
 const truth=csvRead(labelsPath),preds=csvRead(predsPath);
 const predMap=new Map(preds.map(x=>[x.sha256+"|"+x.category,x]));
 if(predMap.size!==preds.length)fail("duplicate_prediction");
 const truthMap=new Map(truth.map(x=>[x.sha256+"|"+x.category,x]));
 if(truthMap.size!==truth.length)fail("duplicate_label");
 const all=[];const perImage=new Map();
 for(const row of truth){
  const key=row.sha256+"|"+row.category;
  if(!idSet.has(row.sha256)||!row.category||!["0","1"].includes(row.label)||!["0","1"].includes(row.critical))fail("invalid_truth");
  const p=predMap.get(key);
  if(!p||!["0","1"].includes(p.predicted))fail("missing_or_inconclusive_prediction:"+row.category);
  const rec={sha256:row.sha256,category:row.category,label:Number(row.label),predicted:Number(p.predicted),critical:row.critical==="1"};
  all.push(rec);
  const group=perImage.get(row.sha256)||[];
  group.push(rec);perImage.set(row.sha256,group);
 }
 if(perImage.size!==140||predMap.size!==truthMap.size)fail("incomplete_or_extra_predictions");
 const global=matrix([...perImage.values()].map(rows=>({label:rows.some(x=>x.label===1)?1:0,predicted:rows.some(x=>x.predicted===1)?1:0})));
 const categories=[...new Set(all.map(x=>x.category))].sort();
 const byCategory=Object.fromEntries(categories.map(c=>[c,{n:all.filter(x=>x.category===c).length,...matrix(all.filter(x=>x.category===c))}]));
 const critical=matrix(all.filter(x=>x.critical));
 const nPositive=critical.tp+critical.fn;
 const categoryGood=categories.length>0&&Object.values(byCategory).every(x=>x.n>=20&&x.kappa!==null&&x.kappa>=.70);
 const hard=global.kappa!==null&&global.kappa>=.80&&critical.fn===0&&nPositive>0;
 const proposedWilson95=nPositive>=73 && critical.recall_wilson_lower95>=.95;
 const report={status:hard&&categoryGood&&proposedWilson95?"CANDIDATE_FOR_INDEPENDENT_REVIEW":"NO_GO",
  holdout_count:140,global,critical,by_category:byCategory,
  hard_gates:{global_kappa_ge_080:global.kappa!==null&&global.kappa>=.80,
   all_category_n_ge_20_kappa_ge_070:categoryGood,zero_critical_false_negatives:critical.fn===0&&nPositive>0,
   proposed_critical_wilson_lower95_ge_095:proposedWilson95},
  notes:["Wilson>=0.95 is a conservative PROPOSAL, not an already certified threshold.",
   "This report is aggregated only. No holdout labels are disclosed.",
   "An independent signed P04 certificate and owner's adjudication are still required."],
  blind_sha256:sha(readFileSync(blindPath)),prediction_sha256:sha(readFileSync(predsPath))};
 writeFileSync(outPath,JSON.stringify(report,null,2)+"\n",{mode:0o600});
 console.log(JSON.stringify({status:report.status,global_kappa:global.kappa,critical_false_negatives:critical.fn,categories:categories.length}));
}else fail("usage: split [seed-file?] [private-output-dir] or score blind labels preds report");
