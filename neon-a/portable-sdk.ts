import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';

type AnyRecord = Record<string, any>;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

async function listLocal(table:string,limit=100) {
  const q=await pool.query('select id,record from zpc_portable.records where table_name=$1 order by updated_at desc limit $2',[table,limit]);
  return {items:q.rows.map((x:any)=>({...x.record,id:x.id}))};
}
async function getLocal(table:string,ids:string[]) {
  if(!ids.length) return [];
  const q=await pool.query('select id,record from zpc_portable.records where table_name=$1 and id = any($2::text[])',[table,ids]);
  const map=new Map(q.rows.map((x:any)=>[x.id,{...x.record,id:x.id}]));
  return ids.map(id=>map.get(id)).filter(Boolean);
}
async function configGet(key:string) {
  const x=await getLocal('__zpc_config',[key]); return String((x[0] as any)?.value||'');
}
async function configSet(key:string,value:string,onlyIfAbsent=false) {
  if(onlyIfAbsent && await configGet(key)) return false;
  const record={value,updatedAt:new Date().toISOString()};
  await pool.query(`insert into zpc_portable.records(table_name,id,record,version,updated_at,origin)
    values('__zpc_config',$1,$2::jsonb,1,now(),'neon-function')
    on conflict(table_name,id) do update set record=excluded.record,version=zpc_portable.records.version+1,updated_at=now(),origin=excluded.origin`,
    [key,JSON.stringify(record)]);
  return true;
}
export const secrets={
  async listSecretNames(){const out:string[]=[];for(const n of ['ADMIN_PIN_HASH'])if(await configGet(n))out.push(n);return out;},
  async readSecret(name:string){return await configGet(name);},
  async writeSecret(name:string,value:string,onlyIfAbsent=false){return await configSet(name,value,onlyIfAbsent);}
};
export const db={
  async list<T=AnyRecord>(table:string,opt:{limit?:number}={}){return await listLocal(table,opt.limit||100) as {items:T[]};},
  async get<T=AnyRecord>(table:string,ids:string[]){return await getLocal(table,ids) as T[];},
  async add<T=AnyRecord>(table:string,records:T[]){
    const ids:string[]=[];
    const c=await pool.connect();
    try{
      await c.query('begin');
      for(const record of records){
        const id=crypto.randomUUID();ids.push(id);
        await c.query('insert into zpc_portable.records(table_name,id,record,version,updated_at,origin) values($1,$2,$3::jsonb,1,now(),$4)',[table,id,JSON.stringify(record),'neon-function']);
      }
      await c.query('commit');
    }catch(e){await c.query('rollback');throw e;}finally{c.release();}
    return ids;
  },
  async update<T=AnyRecord>(table:string,items:Array<{id:string;record:T}>){
    const ids:string[]=[];
    const c=await pool.connect();
    try{
      await c.query('begin');
      for(const x of items){
        ids.push(x.id);
        await c.query(`insert into zpc_portable.records(table_name,id,record,version,updated_at,origin)
          values($1,$2,$3::jsonb,1,now(),$4)
          on conflict(table_name,id) do update set record=excluded.record,version=zpc_portable.records.version+1,updated_at=now(),origin=excluded.origin`,
          [table,x.id,JSON.stringify(x.record),'neon-function']);
      }
      await c.query('commit');
    }catch(e){await c.query('rollback');throw e;}finally{c.release();}
    return ids;
  },
  async delete(table:string,ids:string[]){
    if(ids.length) await pool.query('delete from zpc_portable.records where table_name=$1 and id = any($2::text[])',[table,ids]);
    return ids;
  }
};
export function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
export function error(message:string,status=400){return json({error:message,message},status);}
export function router(routes:Record<string,Array<(ctx:any)=>Promise<Response>|((ctx:any)=>Response)>>){
  return async function handler(req:Request){
    const u=new URL(req.url);
    const path=u.pathname;
    if(path==='/api/_portable_health'){
      try{await pool.query('select 1');return json({ok:true,provider:'neon-function',db:true});}
      catch{return json({ok:false,provider:'neon-function',db:false},503);}
    }
    const key=(req.method||'GET').toUpperCase()+' '+path;
    const hs=routes[key]; if(!hs)return error('not_found',404);
    let body:any={};if(!['GET','HEAD'].includes(req.method||'GET')){try{body=await req.json()}catch{}}
    let response:Response|undefined;for(const h of hs){response=await h({body,request:req});}
    return response||error('no_response',500);
  }
}
