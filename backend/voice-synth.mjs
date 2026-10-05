// Full voice synthesis off the Cloudflare Worker: Gemini TTS (PCM) -> MP3 here, where
// there is no per-request CPU cap. Authenticated with the same derived HMAC secret as
// /api/voice/encode; the Gemini key travels only inside the signed HTTPS body.
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import lamejs from './voice-lame.mjs';
const nonces=new Map();let active=0,windowAt=Date.now(),count=0;
const DEFAULT_MODELS=['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts'];
const STYLE='Fale em português do Brasil, com voz natural, acolhedora, clara e profissional, em ritmo de conversa.';
export function pcmToMp3(pcm,rate,kbps=48){
 const samples=new Int16Array(pcm.buffer,pcm.byteOffset,Math.floor(pcm.length/2));
 const encoder=new lamejs.Mp3Encoder(1,rate,kbps),out=[];
 for(let i=0;i<samples.length;i+=1152){const b=encoder.encodeBuffer(samples.subarray(i,i+1152));if(b.length)out.push(Buffer.from(b));}
 out.push(Buffer.from(encoder.flush()));return Buffer.concat(out);
}
const rates=new Set([8000,16000,24000,32000,44100,48000]);
export function encodeVoicePcm(bytes,rate){
 if(!rates.has(rate)||!bytes.length||bytes.length%2||bytes.length>3*1024*1024)throw Error('invalid_pcm');
 const samples=new Int16Array(bytes.length/2);
 for(let i=0;i<samples.length;i++)samples[i]=bytes.readInt16LE(i*2);
 const encoder=new lamejs.Mp3Encoder(1,rate,64),parts=[];
 for(let i=0;i<samples.length;i+=1152){const out=encoder.encodeBuffer(samples.subarray(i,i+1152));if(out.length)parts.push(Buffer.from(out));}
 parts.push(Buffer.from(encoder.flush()));return Buffer.concat(parts);
}
export function unpackVoicePcm(raw,rate){
 if(raw.subarray(0,4).toString()!=='RIFF')return {pcm:raw,rate};
 if(raw.subarray(8,12).toString()!=='WAVE')throw Error('invalid_wav');
 let pcm,format=false;
 for(let at=12;at+8<=raw.length;){
  const size=raw.readUInt32LE(at+4),start=at+8;if(start+size>raw.length)throw Error('invalid_wav');
  const tag=raw.subarray(at,at+4).toString();
  if(tag==='fmt '){if(size<16||raw.readUInt16LE(start)!==1||raw.readUInt16LE(start+2)!==1||raw.readUInt16LE(start+14)!==16)throw Error('invalid_wav');rate=raw.readUInt32LE(start+4);format=true;}
  if(tag==='data')pcm=raw.subarray(start,start+size);at=start+size+(size%2);
 }
 if(!format||!pcm)throw Error('invalid_wav');return {pcm,rate};
}
export function quotaWait(body,header,now=Date.now()){
 const details=body?.error?.details||[];
 const daily=details.some(d=>(d.violations||[]).some(v=>/perday|per_day|requestsperday/i.test(String(v.quotaId||v.quotaMetric||''))));
 if(daily){
  for(let h=1;h<=25;h++){const at=Math.floor(now/3600000)*3600000+h*3600000;
   const hour=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'2-digit',hourCycle:'h23'}).format(new Date(at));
   if(hour==='00')return Math.ceil((at-now)/1000)+5;
  }
 }
 const retry=details.find(d=>d.retryDelay)?.retryDelay;
 return Math.max(60,Math.ceil(parseFloat(retry)||Number(header)||0));
}
export async function synthesizeVoice(input,fetchImpl=fetch){
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>350||typeof input.gemini_key!=='string'||input.gemini_key.length<10)throw Error('invalid_speech');
 let wait=60;
 for(const model of ['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts']){
  const r=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':input.gemini_key},body:JSON.stringify({model,input:[{type:'user_input',content:[{type:'text',text:input.text,annotations:[{type:'speech_metadata',style:'Fale em português do Brasil, com clareza e ritmo de conversa.'}]}]}],response_format:{type:'audio',mime_type:'audio/l16',sample_rate:24000},generation_config:{speech_config:[{voice:'Achird'}]}}),signal:AbortSignal.timeout(20000)});
  const body=await r.json().catch(()=>({}));
  if(r.status===429){wait=Math.max(wait,quotaWait(body,r.headers.get('retry-after')));continue;}
  if(!r.ok)throw Error('tts_http_'+r.status);
  const part=(body.steps||[]).filter(s=>s.type==='model_output').flatMap(s=>s.content||[]).find(p=>p.type==='audio'&&p.data);
  if(!part)throw Error('tts_audio_missing');
  const raw=Buffer.from(part.data,'base64');
  const rate=Number(part.sample_rate||(String(part.mime_type||'').match(/rate=(\d+)/)||[])[1])||24000;
  const pcm=unpackVoicePcm(raw,rate);
  return {bytes:encodeVoicePcm(pcm.pcm,pcm.rate),model};
 }
 const error=Error('quota');error.retryAfter=wait;throw error;
}
export async function geminiSpeech({text,apiKey,fetchImpl=fetch}){
 try{return await synthesizeVoice({text,gemini_key:apiKey},fetchImpl);}
 catch(error){if(error.message==='quota')error.quota=true;throw error;}
}
export async function voiceSynthHandler(req,res,{fetchImpl=fetch}={}){
 if(new URL(req.url||'/','http://internal').pathname!=='/api/voice/synthesize')return false;
 const fail=(status,error,retryAfter)=>{res.statusCode=status;res.setHeader('content-type','application/json');if(retryAfter)res.setHeader('retry-after',String(retryAfter));res.setHeader('cache-control','no-store');res.end(JSON.stringify({error}));};
 if(req.method!=='POST'){fail(405,'method_not_allowed');return true;}
 const secret=String(process.env.VOICE_ENCODE_SECRET||'');
 if(secret.length<32){fail(503,'voice_encode_secret_missing');return true;}
 const ts=String(req.headers['x-voice-timestamp']||''),nonce=String(req.headers['x-voice-nonce']||''),sig=String(req.headers['x-voice-signature']||'');
 if(!/^\d{13}$/.test(ts)||Math.abs(Date.now()-Number(ts))>120000||!/^[a-zA-Z0-9-]{16,80}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(sig)){fail(401,'voice_synth_auth_required');return true;}
 if(Date.now()-windowAt>60000){windowAt=Date.now();count=0;}
 if(active>=3||count>=30){fail(429,'voice_synth_rate_limit');return true;}
 active++;count++;
 try{
  let size=0;const parts=[];
  for await(const chunk of req){size+=chunk.length;if(size>16*1024){fail(413,'voice_synth_body_too_large');return true;}parts.push(Buffer.from(chunk));}
  const raw=Buffer.concat(parts);
  const message=['zevanory-voice-synth-v1',ts,nonce,createHash('sha256').update(raw).digest('hex')].join('\n');
  if(!timingSafeEqual(createHmac('sha256',secret).update(message).digest(),Buffer.from(sig,'hex'))){fail(401,'voice_synth_auth_required');return true;}
  for(const [k,at] of nonces)if(at<Date.now()-120000)nonces.delete(k);
  if(nonces.has(nonce)){fail(409,'voice_synth_replay');return true;}nonces.set(nonce,Date.now());
  let body;try{body=JSON.parse(raw.toString('utf8'));}catch{fail(400,'voice_synth_json_invalid');return true;}
  const text=String(body.text||'').trim(),apiKey=String(body.api_key||'').trim();
  if(!text||text.length>350||!apiKey||apiKey.length>512){fail(400,'voice_synth_input_invalid');return true;}
  const models=DEFAULT_MODELS;
  const voice=/^[A-Za-z]{2,30}$/.test(String(body.voice||''))?String(body.voice):'Achird';
  let speech;
  try{speech=await geminiSpeech({text,apiKey,voice,models,fetchImpl});}
  catch(e){fail(e.quota?429:502,e.quota?'gemini_quota':String(e.message||'gemini_tts_failed').slice(0,200),e.retryAfter);return true;}
  const mp3=speech.bytes;
  res.statusCode=200;res.setHeader('content-type','audio/mpeg');res.setHeader('cache-control','no-store');res.setHeader('x-voice-model',speech.model);res.end(mp3);return true;
 }catch{fail(500,'voice_synth_failed');return true;}finally{active--;}
}
