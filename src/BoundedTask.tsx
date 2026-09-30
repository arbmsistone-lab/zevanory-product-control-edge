import {Children, Fragment, cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactNode} from 'react';

type Props={children:ReactNode;className:string;'aria-label'?:string};
function units(children:ReactNode):ReactNode[]{
 return Children.toArray(children).flatMap(child=>{
  if(!isValidElement<{children?:ReactNode;className?:string;hidden?:boolean;'data-step'?:number}>(child))return [child];
  if(child.props.hidden)return [];
  if(child.props.className==='formGrid'){const step=Number(child.props['data-step']);const fields=Children.toArray(child.props.children);return step===0?fields.slice(0,4):step===1?fields.slice(4,7):step===2?fields.slice(7):[];}
  if(child.props.className==='auditEditor'||child.props.className==='gateBox'||child.props.className==='modalActions')return units(child.props.children);
  if(child.type===Fragment)return units(child.props.children);
  if(child.type==='nav'&&child.props.className==='commercialPager')return Children.toArray(child.props.children).map((item,i)=>cloneElement(child,{key:'command-'+i},item));
  if(child.props.className==='controlTaskActions'||child.props.className==='approvalActions')return units(child.props.children);
  return [child];
 });
}
/** Preserve command state while paging commands that exceed the real available viewport. */
export default function BoundedTask(props:Props){
 const body=useRef<HTMLDivElement>(null),[paged,setPaged]=useState(false),[page,setPage]=useState(0);
 const items=units(props.children),index=Math.min(page,Math.max(0,items.length-1));
 useLayoutEffect(()=>{
  const target=body.current;if(!target)return;
  const check=()=>{if(!paged&&target.scrollHeight>target.clientHeight+1)setPaged(true)};
  check();const observer=new ResizeObserver(check);observer.observe(target);return()=>observer.disconnect();
 },[paged,items.length]);
 return <section className={props.className+' boundedTask'} aria-label={props['aria-label']} data-task-paged={paged}>
  <div ref={body} className='boundedTaskBody'>{paged?items[index]:props.children}</div>
  {paged&&<nav className='boundedTaskNav' aria-label='Páginas da tarefa'><button className='secondary' aria-label='Tarefa anterior' disabled={index===0} onClick={()=>setPage(index-1)}>←</button><span>{index+1}/{items.length}</span><button className='secondary' aria-label='Próxima tarefa' disabled={index===items.length-1} onClick={()=>setPage(index+1)}>→</button></nav>}
 </section>;
}
