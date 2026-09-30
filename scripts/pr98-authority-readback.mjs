import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const sourceSha = process.env.CANDIDATE_SHA;
if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('EXACT_SOURCE_SHA_REQUIRED');
const out = 'pr98-authority-readback';
await fs.mkdir(out, {recursive:true});
const checks = [];
async function capture(name, url, authenticated = false) {
  try {
    const headers = {'accept':'application/json','user-agent':'ZEVANORY-PR98-authority-readback','cache-control':'no-cache'};
    if (authenticated) {
      if (!process.env.GITHUB_TOKEN) throw new Error('AUTHENTICATED_COLLECTION_AUTHORITY_ABSENT');
      headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(url, {headers,signal:AbortSignal.timeout(20000)});
    const bytes = Buffer.from(await response.arrayBuffer());
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); } catch {}
    const row = {name,url,status:response.status,json:Boolean(data),observedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    // Only the public, schema-bounded operational endpoints are preserved.
    if (response.ok && data && name !== 'mirror-branch-runs') await fs.writeFile(`${out}/${name}.json`, bytes);
    checks.push(row);
    return response.ok && data ? data : null;
  } catch (error) {
    checks.push({name,url,observedAt:new Date().toISOString(),error:error.name === 'TimeoutError' ? 'TIMEOUT' : String(error.message).replace(/Bearer\s+\S+/g,'Bearer [REDACTED]')});
    return null;
  }
}
const [canonicalBuild, canonicalRuntime, canonicalHealth, haHealth, originHealth, canonicalSnapshot, canonicalDecision] = await Promise.all([
  capture('canonical-build','https://controle.zevanory.api.br/zpc-build.json'),
  capture('canonical-runtime','https://controle.zevanory.api.br/runtime-proof'),
  capture('canonical-health','https://controle.zevanory.api.br/portable-health'),
  capture('ha-health','https://zevanory-product-control-edge-ha.onrender.com/portable-health'),
  capture('origin-health','https://zevanory-product-control-edge.onrender.com/portable-health'),
  capture('canonical-core-snapshot','https://controle.zevanory.api.br/api/core/v1/snapshot'),
  capture('canonical-core-decision','https://controle.zevanory.api.br/api/core/v1/decision'),
]);
const snapshot = canonicalSnapshot || await capture('internal-core-snapshot','https://zevanory.api.br/api/core/v1/snapshot');
const decision = canonicalDecision || await capture('internal-core-decision','https://zevanory.api.br/api/core/v1/decision');
const coreStorage = await capture('internal-core-storage','https://zevanory.api.br/api/core/v1/storage-health');
const releaseSha = snapshot?.release_sha || decision?.release_sha;
const mirror='https://api.github.com/repos/arbmsistone-lab/zevanory-public-mirror';
const mirrorBranch = await capture('mirror-branch',`${mirror}/branches/gh-pages`,true);
const exactRuns = releaseSha && /^[a-f0-9]{40}$/.test(releaseSha)
  ? await capture('core-release-runs',`${mirror}/actions/runs?head_sha=${releaseSha}&per_page=100`,true) : null;
// A workflow source commit and the release it tests are separate identities.
// Alternate runs are inventory only until their artifact/contract binding is verified.
const branchRuns = await capture('mirror-branch-runs',`${mirror}/actions/runs?branch=gh-pages&per_page=100`,true);
const relevant = (branchRuns?.workflow_runs || []).filter(run => /zevanory|zees|zea|provider|recovery|observability/i.test(run.name) && !/arbm|task.?091|focal|summary/i.test(run.name));
const evidence = [];
let authenticatedState = null;
let authenticatedArtifact = null;
for (const run of relevant.slice(0,20)) {
  const artifacts = await capture(`run-${run.id}-artifacts`,`${mirror}/actions/runs/${run.id}/artifacts?per_page=100`,true);
  evidence.push({run:run.id,workflow:run.name,sourceSha:run.head_sha,result:run.conclusion,timestamp:run.updated_at,classification:run.head_sha===sourceSha?'VALID_FOR_CURRENT_SHA':'HISTORICAL_ONLY',artifacts:(artifacts?.artifacts || []).map(a=>({id:a.id,name:a.name,digest:a.digest,expired:a.expired}))});
  // Recover the existing server-side reconciler; verify its immutable bytes and
  // release identity separately from this Product Control source candidate.
  if(!authenticatedArtifact && run.name==='ZEVANORY ZEES-16 control reconciler' && run.conclusion==='success') {
    const artifact=(artifacts?.artifacts||[]).find(a=>!a.expired&&a.name===`zees16-reconciliation-${run.id}`&&/^sha256:[a-f0-9]{64}$/.test(a.digest||'')&&a.size_in_bytes<1048576);
    if(artifact) {
      authenticatedArtifact={id:artifact.id,run:run.id,workflowSourceSha:run.head_sha,runtimeSha:releaseSha,expectedDigest:artifact.digest,integrity:'NOT_PROVEN',binding:'NOT_PROVEN'};
      try {
        const response=await fetch(`${mirror}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
        authenticatedArtifact.httpStatus=response.status;
        if(response.ok) {
          const bytes=Buffer.from(await response.arrayBuffer());
          if(bytes.length>1048576)throw Error('ARTIFACT_SIZE_LIMIT');
          const digest='sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
          if(digest!==artifact.digest)throw Error('ARTIFACT_HASH_MISMATCH');
          const archive=`${out}/authenticated-reconciliation.zip`;
          await fs.writeFile(archive,bytes);
          const entries=execFileSync('unzip',['-Z1',archive],{encoding:'utf8'}).trim().split('\n');
          const entry=entries.find(name=>name==='zees16-state.json');
          if(!entry)throw Error('RECONCILER_STATE_ABSENT');
          const raw=execFileSync('unzip',['-p',archive,entry],{maxBuffer:1048576});
          const state=JSON.parse(raw.toString('utf8'));
          if(state.release_sha!==releaseSha||!Array.isArray(state.pillars)||state.pillars.length!==16||!/^[a-f0-9]{64}$/.test(state.decision_hash||''))throw Error('RECONCILER_RELEASE_BINDING_MISMATCH');
          await fs.writeFile(`${out}/authenticated-zees16-state.json`,raw);
          authenticatedArtifact={...authenticatedArtifact,actualDigest:digest,stateSha256:crypto.createHash('sha256').update(raw).digest('hex'),integrity:'PASS',binding:'PASS'};
          authenticatedState=state;
        }
      } catch(error) {authenticatedArtifact.error=String(error.message).replace(/Bearer\s+\S+/g,'Bearer [REDACTED]');}
    }
  }
}
let cloudflareAuthority = 'NOT_CONFIGURED_IN_THIS_ROUTE';
if (process.env.CLOUDFLARE_API_TOKEN) {
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/zones?name=zevanory.api.br',{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000)});
    const data=await r.json();
    cloudflareAuthority = r.ok && data.success && data.result?.some(z=>z.id==='d8a21b6cfd37843e34f38c3e4ad4030a'&&z.account?.id==='1b26415802588185a86c1d4d3ebf5bdb') ? 'CANONICAL_ZONE_READ_AUTHORITY_CONFIRMED' : `CANONICAL_ZONE_READ_NOT_CONFIRMED_HTTP_${r.status}`;
  } catch { cloudflareAuthority='AUTHORITY_PROBE_FAILED'; }
}
const manifest={schema:'zevanory.pr98.authority-inventory/v1',sourceSha,observedAt:new Date().toISOString(),identities:{productControlSourceSha:sourceSha,publicMirrorSha:mirrorBranch?.commit?.sha||null,canonicalPublicSha:canonicalBuild?.sha||null,canonicalRuntimeSha:canonicalRuntime?.backendSourceSha||null,coreReleaseSha:releaseSha||null},core:{collectionRoute:canonicalSnapshot?'canonical':'internal-origin-fallback',exactReleaseRuns:exactRuns?.workflow_runs?.length??null,zees:snapshot?.zees16?.counts||null,zea10:snapshot?.zea10?.counts||null,decision:decision?.decision||null,decisionHash:snapshot?.zees16?.decision_hash||null,pillars:(snapshot?.zees16?.pillars||[]).map(p=>({id:p.id,state:p.state,reason:p.reason,evidence:p.evidence,releaseSha})),zeaPillars:(snapshot?.zea10?.pillars||[]).map(p=>({id:p.id,state:p.state,reason:p.reason,evidence:p.evidence,releaseSha}))},health:{canonical:canonicalHealth,ha:haHealth,origin:originHealth},cloudflareAuthority,evidence,checks,certification:false,semRessalvas:false};
manifest.authenticatedArtifact=authenticatedArtifact;
manifest.coreStorage=coreStorage;
manifest.authenticatedState=authenticatedState?{releaseSha:authenticatedState.release_sha,counts:authenticatedState.counts,decisionHash:authenticatedState.decision_hash,pillars:authenticatedState.pillars.map(p=>({id:p.id,state:p.state,blockers:p.blockers,evidence:p.evidence}))}:null;
await fs.writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({sourceSha,identities:manifest.identities,core:manifest.core,coreStorage,authenticatedArtifact,authenticatedState:manifest.authenticatedState,health:{ha:haHealth,origin:originHealth,canonical:canonicalHealth},cloudflareAuthority,checks:checks.map(c=>({name:c.name,status:c.status,error:c.error})),certification:false}));
if(!snapshot||!decision||!mirrorBranch||!exactRuns) process.exitCode=1;
