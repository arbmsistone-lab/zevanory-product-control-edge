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
export async function geminiSpeech({text,apiKey,voice='Achird',models=DEFAULT_MODELS,fetchImpl=fetch}){
 const errors=[];let quota=0;
 for(const model of models){
  const r=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':apiKey,'content-type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:`${STYLE}\n\n${text}`}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}}}),signal:AbortSignal.timeout(30000)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok){errors.push(`${model}:${r.status}`);if(r.status===429)quota++;continue;}
  const part=(body?.candidates?.[0]?.content?.parts||[]).find(p=>p?.inlineData?.data||p?.inline_data?.data);
  const data=part?.inlineData?.data||part?.inline_data?.data;
  if(!data){errors.push(`${model}:no_audio`);continue;}
  const mime=String(part?.inlineData?.mimeType||part?.inline_data?.mime_type||'audio/L16;rate=24000');
  const rate=Number((mime.match(/rate=(\d+)/i)||[])[1])||24000;
  return {pcm:Buffer.from(data,'base64'),rate,model};
 }
 const e=new Error(`gemini_tts_failed:${errors.join(',')}`);e.quota=quota>0&&quota===errors.filter(x=>/:\d+$/.test(x)).length;throw e;
}
export async function voiceSynthHandler(req,res,{fetchImpl=fetch}={}){
 if(new URL(req.url||'/','http://internal').pathname!=='/api/voice/synthesize')return false;
 const fail=(status,error)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify({error}));};
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
  if(!text||text.length>1200||!apiKey||apiKey.length>512){fail(400,'voice_synth_input_invalid');return true;}
  const models=Array.isArray(body.models)&&body.models.length?body.models.map(String).filter(m=>/^[a-z0-9.-]{3,80}$/.test(m)).slice(0,4):DEFAULT_MODELS;
  const voice=/^[A-Za-z]{2,30}$/.test(String(body.voice||''))?String(body.voice):'Achird';
  let speech;
  try{speech=await geminiSpeech({text,apiKey,voice,models,fetchImpl});}
  catch(e){fail(e.quota?429:502,e.quota?'gemini_quota':String(e.message||'gemini_tts_failed').slice(0,200));return true;}
  const mp3=pcmToMp3(speech.pcm,speech.rate);
  res.statusCode=200;res.setHeader('content-type','audio/mpeg');res.setHeader('cache-control','no-store');res.setHeader('x-voice-model',speech.model);res.end(mp3);return true;
 }catch{fail(500,'voice_synth_failed');return true;}finally{active--;}
}
