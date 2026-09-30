import {useLayoutEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
export type EvidenceField = {label:string;value:string};

// Pagination measures the actual font and remaining task surface. Every code point
// is retained; pagination replaces the visible page, never clips an overflow box.
export default function EvidenceReader({fields,onClose,onChange}:{fields:EvidenceField[];onClose:()=>void;onChange?:(value:string)=>void}) {
 const [field,setField]=useState(0),[page,setPage]=useState(0),[pages,setPages]=useState<string[]>([]);
 const region=useRef<HTMLDivElement>(null), text=fields[field]?.value || (onChange ? '' : 'Sem informação.');
 useLayoutEffect(()=>{
  const host=region.current;if(!host)return;let active=true,lastMeasurement='';
  const paginate=()=>{
   if(!active)return;
   const probe=document.createElement('div'),style=getComputedStyle(host);
   Object.assign(probe.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',width:host.clientWidth+'px',whiteSpace:'pre-wrap',overflowWrap:'anywhere',font:style.font,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing});
   document.body.appendChild(probe);
   probe.textContent='M';
   const measurement=[host.clientWidth,host.clientHeight,probe.getBoundingClientRect().height,style.font,style.lineHeight].join(':');
   if(measurement===lastMeasurement){probe.remove();return;}
   lastMeasurement=measurement;
   const units=Array.from(text),next:string[]=[];let offset=0;
   while(offset<units.length){
    let lo=1,hi=units.length-offset,best=0;
    while(lo<=hi){const mid=Math.floor((lo+hi)/2);probe.textContent=units.slice(offset,offset+mid).join('');if(probe.getBoundingClientRect().height<=host.clientHeight-2){best=mid;lo=mid+1}else hi=mid-1;}
    if(!best){probe.remove();setPages([]);return;}
    next.push(units.slice(offset,offset+best).join(''));offset+=best;
   }
   probe.remove();setPages(next.length ? next : ['']);if(!onChange)setPage(0);
  };
  const observer=new ResizeObserver(paginate);observer.observe(host);void document.fonts.ready.then(paginate);paginate();
  return()=>{active=false;observer.disconnect()};
 },[text]);
 const safePage=Math.min(page,Math.max(0,pages.length-1));
 return <section className='evidenceReader panel' aria-label='Leitor de detalhes'>
  <div className='panelhead'><h2>Detalhes</h2><button className='secondary' onClick={onClose}>Voltar</button></div>
  <nav className='readerNav' aria-label='Campos dos detalhes'><button className='secondary' aria-label='Campo anterior' title='Campo anterior' disabled={field===0} onClick={()=>{setField(field-1);setPage(0)}}><ChevronLeft aria-hidden='true' /></button><span>Campo {field+1}/{fields.length}</span><button className='secondary' aria-label='Próximo campo' title='Próximo campo' disabled={field===fields.length-1} onClick={()=>{setField(field+1);setPage(0)}}><ChevronRight aria-hidden='true' /></button></nav>
  <h3>{fields[field]?.label}</h3>
  <div ref={region} className='readerText' data-page={safePage+1} data-pages={pages.length}>{onChange ? <textarea aria-label='Texto do campo' className='readerEditor' value={pages[safePage]??''} onChange={event=>{
    const offset=pages.slice(0,safePage).reduce((sum,chunk)=>sum+Array.from(chunk).length,0),units=Array.from(text);
    onChange(units.slice(0,offset).join('')+event.target.value+units.slice(offset+Array.from(pages[safePage]??'').length).join(''));
   }} /> : pages[safePage]??'Calculando páginas…'}</div>
  <nav className='readerNav' aria-label='Páginas do texto'><button className='secondary' aria-label='Anterior' title='Página anterior' disabled={safePage===0} onClick={()=>setPage(safePage-1)}><ChevronLeft aria-hidden='true' /></button><span>Página {safePage+1}/{Math.max(1,pages.length)}</span><button className='secondary' aria-label='Próxima' title='Próxima página' disabled={safePage>=pages.length-1} onClick={()=>setPage(safePage+1)}><ChevronRight aria-hidden='true' /></button></nav>
 </section>;
}
