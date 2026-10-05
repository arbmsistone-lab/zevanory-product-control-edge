import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {synthesizeVoice,quotaWait} from '../backend/voice-synthesis.mjs';
const key='synthetic-key-not-a-real-key',text='Teste de fala. O preço é vinte reais.';
const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(8000*Math.sin(i/12)),i*2);
let calls=[];
const result=await synthesizeVoice({text,gemini_key:key},async(url,init)=>{
 const body=JSON.parse(init.body);calls.push(body.model);assert.equal(init.headers['x-goog-api-key'],key);assert.equal(body.input[0].content[0].text,text);
 if(calls.length===1)return Response.json({error:{}},{status:429});
 return Response.json({steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/l16',sample_rate:24000,data:pcm.toString('base64')}]}]});
});
assert.deepEqual(calls,['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts']);assert.equal(result.bytes[0],255);
calls=[];await assert.rejects(()=>synthesizeVoice({text,gemini_key:key},async(url,init)=>{calls.push(JSON.parse(init.body).model);return Response.json({error:{}},{status:429});}),error=>error.message==='quota'&&error.retryAfter>=60);
assert.equal(calls.length,2);
await assert.rejects(()=>synthesizeVoice({text:'x'.repeat(351),gemini_key:key}),/invalid_speech/);
assert.ok(quotaWait({error:{details:[{violations:[{quotaId:'RequestsPerDay'}]}]}},null,Date.parse('2026-10-05T00:00:00Z'))>6*3600);
console.log('RENDER_SYNTHESIS_429_SINGLE_LITE_FAILOVER_MP3_INPUT_LIMIT=PASS');
