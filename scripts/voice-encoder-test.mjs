import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHmac,createHash} from 'node:crypto';
import {voiceEncodeHandler} from '../backend/voice-encoder.mjs';
process.env.VOICE_ENCODE_SECRET='unit-test-secret-that-is-at-least-32-characters';
async function run(body,headers={},method='POST'){let data;const req=Readable.from([body]);Object.assign(req,{url:'/api/voice/encode',method,headers});const res={statusCode:200,setHeader(){},end(v){data=v;}};await voiceEncodeHandler(req,res);return{status:res.statusCode,data};}
const pcm=Buffer.alloc(16000),ts=String(Date.now()),nonce='unit-test-unique-nonce-123456',rate=8000;
const message=[ts,nonce,rate,createHash('sha256').update(pcm).digest('hex')].join('\n');
const headers={'x-voice-timestamp':ts,'x-voice-nonce':nonce,'x-voice-sample-rate':String(rate),'x-voice-signature':createHmac('sha256',process.env.VOICE_ENCODE_SECRET).update(message).digest('hex')};
assert.equal((await run(pcm)).status,401);
const result=await run(pcm,headers);assert.equal(result.status,200);assert.equal(result.data[0],255);
assert.equal((await run(pcm,headers)).status,409);
assert.equal((await run(pcm,{...headers,'x-voice-signature':'0'.repeat(64),'x-voice-nonce':'different-unit-test-nonce'})).status,401);
assert.equal((await run(Buffer.alloc(3*1024*1024+2),{...headers,'x-voice-nonce':'oversized-unit-test-nonce'})).status,413);
console.log('VOICE_ENCODER_HMAC_REPLAY_SIZE_MP3=PASS');
