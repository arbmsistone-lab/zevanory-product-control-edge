import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import lamejs from './voice-lame.mjs';
const nonces=new Map();let active=0,windowAt=Date.now(),count=0;
export async function voiceEncodeHandler(req,res){
 if(new URL(req.url||'/', 'http://internal').pathname!=='/api/voice/encode')return false;
 const fail=(status,error)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify({error}));};
 if(req.method!=='POST'){fail(405,'method_not_allowed');return true;}
 const secret=String(process.env.VOICE_ENCODE_SECRET||'');
 if(secret.length<32){fail(503,'voice_encode_secret_missing');return true;}
 const ts=String(req.headers['x-voice-timestamp']||''),nonce=String(req.headers['x-voice-nonce']||''),rate=Number(req.headers['x-voice-sample-rate']),sig=String(req.headers['x-voice-signature']||'');
 if(!/^\d{13}$/.test(ts)||Math.abs(Date.now()-Number(ts))>60000||!/^[a-zA-Z0-9-]{16,80}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(sig)||![8000,16000,24000,32000,48000].includes(rate)){fail(401,'voice_encode_auth_required');return true;}
 if(Date.now()-windowAt>60000){windowAt=Date.now();count=0;}
 if(active>=2||count>=30){fail(429,'voice_encode_rate_limit');return true;}
 active++;count++;
 try{
  let size=0;const parts=[];
  for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024){fail(413,'voice_pcm_size_invalid');return true;}parts.push(Buffer.from(chunk));}
  const pcm=Buffer.concat(parts);if(!size||size%2){fail(400,'voice_pcm_format_invalid');return true;}
  const message=[ts,nonce,rate,createHash('sha256').update(pcm).digest('hex')].join('\n');
  const expected=createHmac('sha256',secret).update(message).digest();
  if(!timingSafeEqual(expected,Buffer.from(sig,'hex'))){fail(401,'voice_encode_auth_required');return true;}
  for(const [k,at] of nonces)if(at<Date.now()-60000)nonces.delete(k);
  if(nonces.has(nonce)){fail(409,'voice_encode_replay');return true;}nonces.set(nonce,Date.now());
  const samples=new Int16Array(Math.floor(size/2*8000/rate)),ratio=rate/8000;
  for(let i=0;i<samples.length;i++){let sum=0;for(let j=i*ratio;j<(i+1)*ratio;j++)sum+=pcm.readInt16LE(j*2);samples[i]=Math.round(sum/ratio);}
  const encoder=new lamejs.Mp3Encoder(1,8000,32),output=[];
  for(let i=0;i<samples.length;i+=1152){const b=encoder.encodeBuffer(samples.subarray(i,i+1152));if(b.length)output.push(Buffer.from(b));}
  output.push(Buffer.from(encoder.flush()));
  res.statusCode=200;res.setHeader('content-type','audio/mpeg');res.setHeader('cache-control','no-store');res.end(Buffer.concat(output));return true;
 }catch{fail(500,'voice_encode_failed');return true;}finally{active--;}
}
