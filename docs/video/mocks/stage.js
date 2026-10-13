/* The stage: renders sample(T, t) into DOM. A pure function of the clock, so scrub, speed and export all use it. */
(function(){
const {R,byId,makeActor,placeSVG,clockText,COLORS}=W;
function createStage(host,T,o){
 o=o||{};const kind=o.setting||'rooftop';
 host.classList.add('stagehost');
 const st=document.createElement('div');st.className='stage nofx';host.append(st);
 const cam=document.createElement('div');cam.className='cam';st.append(cam);
 const plate=document.createElement('div');plate.className='plateholder';cam.append(plate);
 const plate2=document.createElement('div');plate2.className='plateholder';plate2.style.opacity=0;cam.append(plate2);
 const pool=document.createElement('div');pool.className='pool';cam.append(pool);
 const actors={};R.agents.forEach(a=>{const h=document.createElement('div');h.className='actor';cam.append(h);actors[a.id]=makeActor(h,a,a.idx);h.querySelector('.nm').style.display='none'});
 const vig=document.createElement('div');vig.className='vig';st.append(vig);
 const inset=document.createElement('div');inset.className='inset';inset.innerHTML='<div class="in"></div><span>through the door: still on the roof</span>';st.append(inset);inset.style.opacity=0;
 const bl=B.Layer(st),mk=B.Marks(st);
 const caps=document.createElement('div');caps.className='caps';st.append(caps);
 const chip=document.createElement('div');chip.className='clockchip';st.append(chip);
 const fit=()=>{const s=host.clientWidth/1200;st.style.transform=`scale(${s})`;host.style.height=(host.clientWidth/2)+'px'};
 new ResizeObserver(fit).observe(host);fit();
 let lastMin=-99,lastT=0,capCache={};
 function render(t,ro){
  ro=ro||{};const S=D.sample(T,t);const c=S.cam;
  cam.style.transform=`translate(${(600-c.cx*c.z).toFixed(2)}px,${(300-c.cy*c.z).toFixed(2)}px) scale(${c.z.toFixed(4)})`;
  const qm=Math.round(S.min/2)*2;if(qm!==lastMin){lastMin=qm;plate.innerHTML=placeSVG(kind,qm,'s');plate2.innerHTML=placeSVG(o.room2||'stairwell',qm,'r')}
  plate.style.opacity=(1-.96*(c.room||0)).toFixed(3);plate2.style.opacity=(c.room||0).toFixed(3);inset.style.opacity=Math.max(0,(c.room||0)*2-1).toFixed(2);
  (function(){const q=inset.querySelector('.in');if(!q.firstChild)q.innerHTML=placeSVG(kind,1420,'i')})();plate.style.filter=c.bg>.05?`blur(${(c.bg*1.1).toFixed(2)}px) brightness(${(1-c.pool*.12).toFixed(2)})`:'';
  // light pool where the huddle stands
  const sc=S.scene;let px=250,py=470;if(sc&&sc.type==='huddle'){const xs=sc.members.map((m,k)=>D.hudPx(k).x);px=xs.reduce((a,b)=>a+b,0)/xs.length;py=D.hudPx(0).y-70}
  pool.style.cssText=`left:${px-300}px;top:${py-260}px;opacity:${(c.pool*.9).toFixed(2)}`;
  vig.style.opacity=Math.min(1,Math.max(0,(c.z-1)/.9)).toFixed(2);
  const dt=Math.min(.1,Math.abs(t-lastT));lastT=t;
  R.agents.forEach((a,i)=>{
   const ch=S.chars[a.id],v=ch.v,A=actors[a.id],h=A.el;
   h.style.left=v.x.toFixed(1)+'px';h.style.top=v.y.toFixed(1)+'px';h.style.width=v.w.toFixed(1)+'px';h.style.zIndex=Math.round(v.y);
   const ph=(t*.9+i*1.7)%4.3,blink=ph<.14?Math.abs(ph-.07)/.07:1;
   A.update(v,dt,t,{walking:ch.walking,speak:ch.speak,blink});
  });
  bl.sync(S,c,{omni:ro.omni!==false});
  mk.sync(S,c);
  // captions
  const seen=new Set();S.captions.forEach(({c:cp,op})=>{const id=cp.t0+cp.text;seen.add(id);let e=capCache[id];if(!e){e=capCache[id]=document.createElement('div');e.className='cap cap-'+cp.where;e.textContent=cp.text;caps.append(e)}e.style.display='block';e.style.opacity=op.toFixed(2)});
  for(const id in capCache)if(!seen.has(id))capCache[id].style.display='none';
  chip.textContent=clockText(Math.round(S.min));
  return S;
 }
 return{render,host,st};
}
window.Stage={createStage};
})();
