/* The stage: renders sample(T, t) into DOM. A pure function of the clock, so scrub, speed and export all use it.
   Smoothness rules: write only what changed, crossfade the light instead of swapping it, never layout in the loop. */
(function(){
const {R,byId,makeActor,placeSVG,clockText,COLORS}=W;
function createStage(host,T,o){
 o=o||{};const kind=o.setting||'rooftop';
 host.classList.add('stagehost');
 const st=document.createElement('div');st.className='stage nofx';host.append(st);
 const cam=document.createElement('div');cam.className='cam';st.append(cam);
 // two plates, crossfaded: the light changes slowly, so a swap would flicker and a re-render per frame would stutter
 const mk=()=>{const d=document.createElement('div');d.className='plateholder';d.style.transition='opacity .7s linear';return d};
 const P=[mk(),mk()],P2=[mk(),mk()];P.forEach(p=>cam.append(p));P2.forEach(p=>cam.append(p));
 let front=0,front2=0,shown=-99,shown2=-99;
 const pool=document.createElement('div');pool.className='pool';cam.append(pool);
 const actors={};R.agents.forEach(a=>{const h=document.createElement('div');h.className='actor';cam.append(h);actors[a.id]=makeActor(h,a,a.idx);h.querySelector('.nm').style.display='none'});
 const vig=document.createElement('div');vig.className='vig';st.append(vig);
 const inset=document.createElement('div');inset.className='inset';inset.innerHTML='<div class="in"></div><span>through the door: still on the roof</span>';st.append(inset);inset.style.opacity=0;
 let insetDone=false;
 const bl=B.Layer(st),mkl=B.Marks(st);
 const caps=document.createElement('div');caps.className='caps';st.append(caps);
 const chip=document.createElement('div');chip.className='clockchip';st.append(chip);
 const fit=()=>{const s=host.clientWidth/1200;st.style.transform=`scale(${s})`;host.style.height=(host.clientWidth/2)+'px'};
 new ResizeObserver(fit).observe(host);fit();
 const W6=6; // story minutes between light updates
 function relight(layers,idx,which,min,k){ // render into the hidden plate, then fade to it (the per-frame loop owns the final opacity)
  const back=1-idx;layers[back].innerHTML=placeSVG(k,min,'p'+back+Math.round(min));layers[back].style.opacity=1;layers[idx].style.opacity=0;return back};
 const cache={};const set=(el,k,v)=>{if(cache[k]!==v){cache[k]=v;el.style[k.split('.')[1]]=v}};
 let lastT=0,capCache={};
 function render(t,ro){
  ro=ro||{};const S=D.sample(T,t),c=S.cam;
  const tf=`translate(${(600-c.cx*c.z).toFixed(2)}px,${(300-c.cy*c.z).toFixed(2)}px) scale(${c.z.toFixed(4)})`;set(cam,'cam.transform',tf);
  const qm=Math.round(S.min/W6)*W6;
  if(shown===-99){P[0].innerHTML=placeSVG(kind,qm,'pa');P[0].style.opacity=1;P[1].style.opacity=0;shown=qm;P2[0].innerHTML=placeSVG(o.room2||'stairwell',qm,'ra');P2[0].style.opacity=1;P2[1].style.opacity=0;shown2=qm}
  else if(qm!==shown){front=relight(P,front,0,qm,kind);shown=qm}
  const room=c.room||0;
  P.forEach(p=>{p.style.visibility=room>.98?'hidden':'visible'});
  // second place only matters for the door staging
  if(room>.01){if(qm!==shown2){front2=relight(P2,front2,1,qm,o.room2||'stairwell');shown2=qm}}
  // plate opacity is the crossfade state times the room mix
  P.forEach((p,i)=>{p.style.opacity=(i===front?1:0)*(1-.96*room)});
  P2.forEach((p,i)=>{p.style.opacity=(i===front2?1:0)*room});
  set(inset,'in.opacity',Math.max(0,room*2-1).toFixed(2));
  if(room>.5&&!insetDone){inset.querySelector('.in').innerHTML=placeSVG(kind,1420,'i');insetDone=true}
  const bgf=c.bg>.05?`blur(${(c.bg*1.1).toFixed(1)}px) brightness(${(1-c.pool*.12).toFixed(2)})`:'';P.forEach(p=>set(p,'pf'+(p===P[0]?0:1)+'.filter',bgf));
  const sc=S.scene;let px=250,py=470;if(sc&&sc.type==='huddle'){const xs=sc.members.map((m,k)=>D.hudPx(k).x);px=xs.reduce((a,b)=>a+b,0)/xs.length;py=D.hudPx(0).y-70}
  set(pool,'pool.left',(px-300)+'px');set(pool,'pool.top',(py-260)+'px');set(pool,'pool.opacity',(c.pool*.9).toFixed(2));
  set(vig,'vig.opacity',Math.min(1,Math.max(0,(c.z-1)/.8)).toFixed(2));
  const dt=Math.min(.1,Math.abs(t-lastT));lastT=t;
  R.agents.forEach((a,i)=>{
   const ch=S.chars[a.id],v=ch.v,A=actors[a.id],h=A.el;
   set(h,a.id+'.left',v.x.toFixed(1)+'px');set(h,a.id+'.top',v.y.toFixed(1)+'px');set(h,a.id+'.width',v.w.toFixed(1)+'px');set(h,a.id+'.zIndex',String(Math.round(v.y)));
   const ph=(t*.9+i*1.7)%4.3,blink=ph<.14?Math.max(.08,Math.abs(ph-.07)/.07):1;
   A.update(v,dt,t,{walking:ch.walking,speak:ch.speak,blink});
  });
  bl.sync(S,c,{omni:ro.omni!==false});mkl.sync(S,c);
  const seen=new Set();S.captions.forEach(({c:cp,op})=>{const id=cp.t0+cp.text;seen.add(id);let e=capCache[id];if(!e){e=capCache[id]=document.createElement('div');e.className='cap cap-'+cp.where;e.textContent=cp.text;caps.append(e)}e.style.display='block';e.style.opacity=op.toFixed(2)});
  for(const id in capCache)if(!seen.has(id))capCache[id].style.display='none';
  const ct=clockText(Math.round(S.min));if(chip.textContent!==ct)chip.textContent=ct;
  return S;
 }
 return{render,host,st};
}
window.Stage={createStage};
})();
