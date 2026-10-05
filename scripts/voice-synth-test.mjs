import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHmac,createHash} from 'node:crypto';
import {voiceSynthHandler} from '../backend/voice-synth.mjs';
process.env.VOICE_ENCODE_SECRET='unit-test-secret-that-is-at-least-32-characters';
const pcm=Buffer.alloc(24000*2);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*220*i/24000)),i*2);
let geminiCalls=[];
const okGemini=async(url)=>{geminiCalls.push(url);return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;codec=pcm;rate=24000',data:pcm.toString('base64')}}]}}]}),{status:200});};
const quotaGemini=async(url)=>{geminiCalls.push(url);return new Response('{}',{status:429});};
function sign(raw,nonce,ts=String(Date.now())){const m=['zevanory-voice-synth-v1',ts,nonce,createHash('sha256').update(raw).digest('hex')].join('\n');return{'x-voice-timestamp':ts,'x-voice-nonce':nonce,'x-voice-signature':createHmac('sha256',process.env.VOICE_ENCODE_SECRET).update(m).digest('hex')};}
async function run(raw,headers,fetchImpl=okGemini){let data,h={};const req=Readable.from([raw]);Object.assign(req,{url:'/api/voice/synthesize',method:'POST',headers});const res={statusCode:200,setHeader(k,v){h[k]=v;},end(v){data=v;}};await voiceSynthHandler(req,res,{fetchImpl});return{status:res.statusCode,data,h};}
const raw=Buffer.from(JSON.stringify({text:'O Combo IA mais Vendas custa duzentos e noventa e sete reais.',api_key:'AIza-unit-test-key'}));
assert.equal((await run(raw,{})).status,401,'unsigned rejected');
const bad=sign(raw,'nonce-bad-signature-0001');bad['x-voice-signature']='0'.repeat(64);
assert.equal((await run(raw,bad)).status,401,'wrong signature rejected');
const ok=await run(raw,sign(raw,'nonce-valid-request-0001'));
assert.equal(ok.status,200);assert.equal(ok.h['content-type'],'audio/mpeg');
assert.ok(ok.data[0]===0xff&&(ok.data[1]&0xe0)===0xe0,'valid mp3 frame');
assert.equal(ok.h['x-voice-model'],'gemini-3.8-flash-tts');
assert.equal((await run(raw,sign(raw,'nonce-valid-request-0001'))).status,409,'replay rejected');
geminiCalls=[];const q=await run(raw,sign(raw,'nonce-quota-request-0001'),quotaGemini);
assert.equal(q.status,429);assert.equal(JSON.parse(q.data).error,'gemini_quota');assert.equal(geminiCalls.length,2,'falls back to lite model once');
assert.ok(!String(q.data).includes('AIza'),'key never echoed');
const big=Buffer.from(JSON.stringify({text:'x'.repeat(20000),api_key:'k'}));
assert.equal((await run(big,sign(big,'nonce-big-request-00001'))).status,413);
console.log('VOICE_SYNTH_TEST=PASS');
