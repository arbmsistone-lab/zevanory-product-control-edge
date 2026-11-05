// R122 / R119 NC-01. Authenticated owner approval, never autonomous publishing.
// This route runs solely in the Control Center Worker with its existing session and KV.
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
const OWNER_ORIGIN="https://controle.zevanory.api.br";
const DAY=/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const json=(status:any,body:any)=>Response.json(body,{status,headers:JSON_HEADERS});
const bytes=(x:string)=>new TextEncoder().encode(x);
async function mac(secret:string,value:string){
 const key=await crypto.subtle.importKey("raw",bytes(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return new Uint8Array(await crypto.subtle.sign("HMAC",key,bytes(value)));
}
const hex=(v:Uint8Array)=>Array.from(v,n=>n.toString(16).padStart(2,"0")).join("");
async function csrf(secret:string,session:string,day:string,digest:string){
 return hex(await mac(secret,"zpc-blog-owner-csrf-v1\n"+session+"\n"+day+"\n"+digest));
}
function equalConstantTime(a:string,b:string){
 if(!/^[a-f0-9]{64}$/.test(a)||!DIGEST.test(b))return false;
 let mismatch=0;for(let i=0;i<64;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
 return mismatch===0;
}
export async function handleOwnerBlogApproval(request:Request,env:any,verifySession:(token:string)=>Promise<boolean>){
 const url=new URL(request.url);
 if(url.hostname!=="controle.zevanory.api.br"||!["/api/blog/approval/challenge","/api/blog/approval"].includes(url.pathname))return null;
 if(request.method!=="POST")return json(405,{error:"method_not_allowed"});
 if(request.headers.get("origin")!==OWNER_ORIGIN)return json(403,{error:"origin_not_allowed"});
 if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))return json(415,{error:"json_required"});
 if(Number(request.headers.get("content-length")||"0")>4096)return json(413,{error:"too_large"});
 if(String(env?.ADMIN_AUTH_MODE||"")!=="passphrase")return json(503,{error:"passphrase_mode_required"});
 const secret=String(env?.SESSION_SIGNING_KEY||"");
 if(secret.length<32)return json(503,{error:"session_key_unavailable"});
 const raw=await request.text();
 if(raw.length>4096)return json(413,{error:"too_large"});
 let body:any;try{body=JSON.parse(raw)}catch{return json(400,{error:"invalid_json"})}
 const session=String(body?.sessionToken||"");
 if(!session||!(await verifySession(session)))return json(401,{error:"owner_session_required"});
 const day=String(body?.day||""),digest=String(body?.digest||"");
 if(!DAY.test(day)||!DIGEST.test(digest))return json(400,{error:"draft_identity_invalid"});
 const kv=env?.T2_CREATIVE_ASSETS;
 if(!kv?.get||!kv?.put)return json(503,{error:"owner_kv_unavailable"});
 let draft:any;try{draft=JSON.parse(String(await kv.get("zpc:blog:draft:v1:"+day)||"null"))}catch{}
 if(draft?.schema!=="zpc.blog.draft.v1"||draft.day!==day||draft.digest!==digest||!SLUG.test(String(draft.slug||""))||draft.article?.slug!==draft.slug)
   return json(409,{error:"draft_digest_mismatch"});
 const expected=await csrf(secret,session,day,digest);
 if(url.pathname.endsWith("/challenge"))return json(200,{csrf:expected,day,digest,slug:draft.slug,expires_with_session:true});
 if(!equalConstantTime(String(request.headers.get("x-zpc-csrf")||""),expected))return json(403,{error:"csrf_denied"});
 const approvalKey="zpc:blog:owner-approval:v1:"+day;
 let previous:any;try{previous=JSON.parse(String(await kv.get(approvalKey)||"null"))}catch{}
 if(previous&&previous.digest!==digest)return json(409,{error:"different_approval_exists"});
 if(!previous){
   await kv.put(approvalKey,JSON.stringify({schema:"zpc.blog.owner-approval.v1",approved:true,source:"owner",day,slug:draft.slug,digest,approvedAt:new Date().toISOString(),proof:"session-passphrase-csrf-v1"}),{expirationTtl:370*86400});
 }
 return json(200,{approved:true,day,slug:draft.slug,digest,already_approved:Boolean(previous)});
}
