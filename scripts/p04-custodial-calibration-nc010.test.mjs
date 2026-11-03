import test from "node:test";import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";import {resolve,join} from "node:path";import {spawnSync} from "node:child_process";
const root=resolve(import.meta.dirname,"..");
const script=join(root,"scripts/p04-custodial-calibration-nc010.mjs");
const src=join(root,"data/d7-legacy-media-seed.json");
const run=(args,env={})=>spawnSync(process.execPath,[script,...args],{
 cwd:root,env:{...process.env,...env},encoding:"utf8",timeout:15000});
test("P04 split 349 unique into exact 150/140/59 without access to holdout labels",()=>{
 const tmp=mkdtempSync(join(tmpdir(),"p04-cust-"));
 try{
  const a=run(["split",src,tmp],{P04_CUSTODIAN_SPLIT_SEED:"random-high-entropy-offline-possess-123456789"});
  assert.equal(a.status,0,a.stderr);
  const counts=Object.fromEntries(["train_blind.csv","holdout_blind.csv","challenge_blind.csv"].map(name=>{
   const lines=readFileSync(join(tmp,name),"utf8").trim().split("\n");return [name,lines.length-1];
  }));
  assert.deepEqual(counts,{"train_blind.csv":150,"holdout_blind.csv":140,"challenge_blind.csv":59});
  const all=["train_blind.csv","holdout_blind.csv","challenge_blind.csv"].flatMap(name=>
   readFileSync(join(tmp,name),"utf8").trim().split("\n").slice(1));
  assert.equal(new Set(all).size,349);
  const blind=readFileSync(join(tmp,"holdout_blind.csv"),"utf8").trim().split("\n").slice(1);
  const make=(withError=false)=>{
   const labels=["sha256,category,label,critical"];
   const pred=["sha256,category,predicted"];
   blind.forEach((sha,i)=>{const y=i<80?1:0;labels.push([sha,"preco_cta_pixels",y,1].join(","));
    pred.push([sha,"preco_cta_pixels",withError&&i===0?0:y].join(","));});
   writeFileSync(join(tmp,"private-labels.csv"),labels.join("\n")+"\n");
   writeFileSync(join(tmp,"frozen-predictions.csv"),pred.join("\n")+"\n");
   const score=run(["score",join(tmp,"holdout_blind.csv"),join(tmp,"private-labels.csv"),
     join(tmp,"frozen-predictions.csv"),join(tmp,"aggregate.json")]);
   assert.equal(score.status,0,score.stderr);
   return JSON.parse(readFileSync(join(tmp,"aggregate.json"),"utf8"));
  };
  const perfect=make(false);assert.equal(perfect.status,"CANDIDATE_FOR_INDEPENDENT_REVIEW");
  assert.equal(perfect.critical.fn,0);
  const fault=make(true);assert.equal(fault.status,"NO_GO");
  assert.equal(fault.critical.fn,1);
  assert.ok(!JSON.stringify(fault).includes("private-labels.csv"));
 }finally{rmSync(tmp,{recursive:true,force:true});}
});
