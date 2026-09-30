import fs from 'node:fs';
const check = process.argv.includes('--check');
for (const [source, target] of [['index.ts','backend-index.ts'],['commercial.ts','commercial.ts'],['cfo.ts','cfo.ts'],['zees-verifiers.ts','zees-verifiers.ts']]) {
 const expected = fs.readFileSync('backend/'+source,'utf8').replaceAll("from './platform.ts'", "from './platform-worker.ts'");
 if(check){if(!fs.existsSync('cf-worker/'+target)||fs.readFileSync('cf-worker/'+target,'utf8')!==expected)throw Error('worker_backend_drift:'+target)}
 else fs.writeFileSync('cf-worker/'+target,expected);
}
console.log('WORKER_BACKEND_PARITY=PASS');
