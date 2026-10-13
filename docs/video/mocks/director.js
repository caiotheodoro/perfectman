/* Prototype of the director. A run becomes a timeline of continuous tracks; sample(T, t) is a pure function of the clock.
   Timing is driven by the text: how many words there are, how fast a person reads, when each word is spoken. No DOM in here. */
(function(){
const {R,byId,pubId,chanMeta,minOf,actFrom,toVec,sigOf,clamp}=W;
const AG=R.agents,N=AG.length;
const STAGE={w:1200,h:600};
const ringPct=i=>[(N<2?50:22+i*(56/(N-1))),[91,94,92,91,96,89,95,93][i%8]];
const WID=N<=5?.17:N<=6?.14:.12;
const HUD=[[9,92],[25,95],[17,87]];
const ringPx=i=>{const[x,y]=ringPct(i);return{x:x*12,y:y*6,w:WID*1200}};
const hudPx=k=>({x:HUD[k][0]*12,y:HUD[k][1]*6,w:.18*1200});

/* ---------- the timing model (one place, so it can be tuned and tested) ---------- */
const CJK=/[぀-ヿ一-鿿]/;
const tokens=t=>CJK.test(t)?[...t]:t.split(/\s+/).filter(Boolean);
const PACES={relaxed:3.6,normal:4.6,fast:6.0};          // words per second a viewer reads at
const SPEAK_X=1.5;                                      // the reveal runs 1.5x faster than reading, so the eye is never ahead of the words
function timing(text,pace,pageWords){
 const tk=tokens(text),wc=CJK.test(text)?Math.max(1,Math.ceil(tk.length/2.2)):tk.length;
 const w=tk.map(x=>x.length+1.6),pages=pageWords&&pageWords.length>1?pageWords:null;
 let off=[],reveal,read;
 if(pages){
  // a paged balloon is paced by the reading: each page lasts as long as its words take to read, and its words land across 90% of that
  let T0=0,k=0;pages.forEach(n=>{const seg=w.slice(k,k+n),tot=seg.reduce((a,b)=>a+b,0),span=n/pace*.9;let a=0;seg.forEach(x=>{off.push(T0+span*a/tot);a+=x});T0+=.5+n/pace;k+=n});
  reveal=T0-.5;read=reveal+.6;
 }else{
  // a single balloon is revealed faster than it is read, so the eye is never ahead of the words
  reveal=clamp(wc/(pace*SPEAK_X),.8,8);read=.6+wc/pace;
  const tot=w.reduce((a,b)=>a+b,0);let a=0;w.forEach(x=>{off.push(reveal*a/tot);a+=x});
 }
 return{wc,reveal,read,tk,w,off,pages:pages?pages.length:1};
}
const convOf=e=>{const ch=chanMeta[e.ch],members=(ch?ch.members:[]).filter(m=>byId[m]);
 if(e.ch===pubId||members.length>=N||members.length>3||members.length<2)return{type:'wide',key:'wide',members:AG.map(a=>a.id)};
 return{type:'huddle',key:e.ch,members}};
const capsRatio=t=>{const l=t.replace(/[^A-Za-z]/g,'');return l.length?l.replace(/[^A-Z]/g,'').length/l.length:0};
function kindOf(e,conv,ar){if(conv.type==='huddle')return'whisper';const t=e.text;if((capsRatio(t)>.6&&t.length>10)||(t.match(/!/g)||[]).length>=2||ar>.72)return'shout';return'speech'}
const MARK={anger:'steam',fear:'sweat',warm:'heart',suspicion:'?',shame:'sweat',proud:'*'};

function buildTimeline(opts){
 opts=opts||{};const MODE=opts.huddle||'push',pace=opts.pace||PACES.normal;
 const T={mode:MODE,pace,keys:{},cam:[],light:[],balloons:[],marks:[],captions:[],scenes:[],msgs:[],speak:{},lapses:[],pulseT:{},cues:[],words:0};
 AG.forEach(a=>{T.keys[a.id]=[];T.speak[a.id]=[]});
 let cursor=0,scene=null;
 const pos={},bl={},dm={},hd={};AG.forEach((a,i)=>{pos[a.id]=ringPx(i);bl[a.id]=0;dm[a.id]=0;hd[a.id]=0});
 const baseP=(id,p,o)=>actFrom(R.pulses[p].mood[id],R.pulses[p].soc[id],o||{});
 function vecOf(id,P,at){const v=toVec(P,sigOf(byId[id]));const q=at||pos[id];v.x=q.x;v.y=q.y;v.w=q.w;v.blur=bl[id];v.dim=dm[id];v.hide=hd[id];return v}
 const key=(id,t,P,at)=>T.keys[id].push({t,v:vecOf(id,P,at)});
 const camFor=sc=>{
  if(sc.type==='wide'||MODE==='wide')return{cx:600,cy:300,z:1,pool:sc.type==='wide'?0:.5,bg:0,room:0};
  if(MODE==='door')return{cx:600,cy:300,z:1,pool:.4,bg:0,room:1};
  const xs=sc.members.map((m,k)=>hudPx(k).x),cx=xs.reduce((a,b)=>a+b,0)/xs.length;
  return{cx:Math.max(330,cx+40),cy:395,z:1.65,pool:1,bg:1.6,room:0};
 };
 const CUT=1.3;                                         // camera move and walk, in seconds
 function enterScene(conv,p,t){
  const prev=scene;scene={key:conv.key,type:conv.type,members:conv.members,t0:t,t1:t,ch:conv.key};scene.cam=camFor(scene);
  if(prev)prev.t1=Math.max(prev.t1,t);T.scenes.push(scene);
  const tArr=t+CUT,oldCam=prev?prev.cam:scene.cam;T.cam.push({t,c:oldCam},{t:tArr,c:scene.cam});
  AG.forEach((a,i)=>{
   const P0=baseP(a.id,p),old=pos[a.id];key(a.id,t,P0,old);
   let np=ringPx(i),b=0,d=0,h=0;
   if(conv.type==='huddle'){const k=conv.members.indexOf(a.id);
    if(MODE==='door'){if(k>=0)np={x:380+k*430,y:520,w:.2*1200};else h=1}
    else if(k>=0)np=hudPx(k);else if(MODE==='push'){b=3.2;d=.12}}
   pos[a.id]=np;bl[a.id]=b;dm[a.id]=d;hd[a.id]=h;
   const P1=Object.assign({},P0);
   if(conv.type==='huddle'&&!conv.members.includes(a.id)&&MODE!=='door'){P1.gx=-1;P1.lean=-3;P1.armL=P1.armR='folded';P1.kind='peek'}
   if(MODE==='door'&&conv.type==='huddle'&&conv.members.includes(a.id))key(a.id,t+.55,P0,{x:150,y:old.y,w:old.w});
   if(MODE==='door'&&conv.type==='wide'&&prev&&prev.type==='huddle'&&prev.members.includes(a.id))key(a.id,t+.2,P0,{x:150,y:np.y,w:np.w});
   key(a.id,tArr,P1,np);
  });
  if(conv.type==='huddle')T.captions.push({t0:t+.1,t1:t+2.6,text:`${conv.members.map(m=>byId[m].short).join(' and ')} slip away from the others`,where:'bl'});
  return tArr;
 };
 const pulseGroups=p=>{const gs=[];R.pulses[p].events.filter(e=>e.kind==='say').forEach(e=>{const c=convOf(e);let g=gs.find(x=>x.conv.key===c.key);if(!g){g={conv:c,ev:[]};gs.push(g)}g.ev.push(e)});return gs};
 T.light.push({t:0,min:minOf(0)});
 for(let p=0;p<R.pulses.length;p++){
  const gs=pulseGroups(p);T.pulseT[p]=cursor;
  if(!gs.length){const t0=cursor,t1=cursor+1.1;T.lapses.push({t0,t1,p});T.light.push({t:t1,min:minOf(p)});AG.forEach(a=>key(a.id,t1,baseP(a.id,p)));T.captions.push({t0:t0+.1,t1:t1+.4,text:'Time passes…',where:'bl'});cursor=t1;continue}
  T.light.push({t:cursor,min:minOf(p)});
  gs.forEach(g=>{
   if(!scene||scene.key!==g.conv.key)cursor=enterScene(g.conv,p,cursor+(scene?.15:0));
   const sc=scene;let prev=null;const lastBy={},items=[];
   g.ev.forEach((e,i)=>{
    const ar0=R.pulses[p].mood[e.actor].a,kind0=kindOf(e,g.conv,ar0);
    const tm=timing(e.text,pace,opts.measure?opts.measure({kind:kind0,actor:e.actor,text:e.text,ar:ar0}):null),th=R.pulses[p].think[e.actor];
    const hasThought=th&&!T.balloons.some(b=>b.kind==='thought'&&b.actor===e.actor&&b.p===p)&&!g.ev.slice(0,i).some(x=>x.actor===e.actor);
    const thSec=hasThought?clamp(.5+Math.min(14,tokens(th.motive.split(/(?<=[.;—])\s/)[0]).length)/pace,1.2,2.4):0;
    let s0=i===0?cursor+.5:Math.max(prev.s0+prev.tm.reveal*.6,prev.readEnd-.5,(lastBy[e.actor]||-9)+.3);
    s0+=thSec;
    const m={e,p,tm,s0,s1:s0+tm.reveal,readEnd:s0+Math.max(tm.reveal,tm.read)+.1,actor:e.actor,conv:g.conv,sc,th,thSec,hasThought};
    // when each word lands: proportional to its length, so the mouth and the lettering move together
    m.words=tm.tk.map((tok,k)=>({t:s0+tm.off[k],len:tok.length}));
    items.push(m);prev=m;lastBy[e.actor]=m.s1;T.speak[e.actor].push([m.s0,m.s1,m.words]);T.words+=tm.wc;
   });
   items.forEach(m=>{
    const e=m.e,S=e.actor,mem=sc.members;
    const tgt=(e.to&&e.to.find(x=>mem.includes(x)&&x!==S))||mem.find(x=>x!==S);
    const sx=pos[S].x,tx=tgt?pos[tgt].x:sx,toward=Math.sign(tx-sx)||0;
    const base=baseP(S,m.p);
    const ant=Object.assign({},base,{lean:base.lean+3*toward,gx:toward,breath:Math.max(1.5,base.breath*.8)});
    const talk=baseP(S,m.p,{speaking:true,toward});talk.gx=toward*.9;
    const GE={anger:'up',fear:'wring',shame:'hug',warm:'open',rest:'open',proud:'akimbo',suspicion:'folded'};
    const ges=Object.assign({},talk,{armR:GE[talk.kind]||talk.armR,armL:talk.kind==='anger'?'up':talk.armL,lean:talk.lean+1.2*toward});
    key(S,m.s0-.5,ant);key(S,m.s0+.08,talk);if(m.tm.reveal>1.6)key(S,m.s0+m.tm.reveal*.5,ges);key(S,m.s1+.45,Object.assign({},base,{gx:toward*.4}));
    AG.forEach(a=>{
     const L=a.id;if(L===S)return;
     const speaking=T.speak[L].some(([a0,a1])=>a0<=m.s0+.3&&a1>=m.s0)||T.speak[L].some(([a0])=>a0>m.s0&&a0<m.s1);
     if(speaking)return;
     const lt=Math.sign(pos[S].x-pos[L].x)||0,bs=baseP(L,m.p);
     if(!mem.includes(L)){key(L,m.s0+.3,Object.assign({},bs,{gx:sc.type==='huddle'?-1:lt,lean:bs.lean+(sc.type==='huddle'?-3:0),kind:'peek'}));key(L,m.readEnd+.5,Object.assign({},bs,{gx:sc.type==='huddle'?-.6:0}));return}
     key(L,m.s0+.2,Object.assign({},bs,{gx:lt*.9,lean:bs.lean+2*lt}));
     const R2=baseP(L,m.p,{toward:lt});R2.gx=lt*.8;
     const tr=m.s0+Math.max(.6,m.tm.reveal*.45);key(L,tr,R2);
     if(R2.kind!=='rest'&&R2.strength>.42&&MARK[R2.kind])T.marks.push({t:tr,dur:1.8,actor:L,kind:MARK[R2.kind]});
     key(L,m.readEnd+.4,Object.assign({},bs,{gx:lt*.3}));
    });
    const ar=R.pulses[m.p].mood[S].a,kind=kindOf(e,m.conv,ar);
    T.balloons.push({id:'b'+T.balloons.length,kind,actor:S,text:e.text,to:e.to,s0:m.s0,s1:m.s1,t0:m.s0-.12,t1:m.readEnd+.8,ar,sc,conv:m.conv.type,p:m.p,msg:m,words:m.words,wc:m.tm.wc});
    if(m.hasThought){const th=m.th;
     T.balloons.push({id:'b'+T.balloons.length,kind:'thought',actor:S,text:th.motive,drivers:th.drivers,s0:m.s0-m.thSec,s1:m.s0-m.thSec+.25,t0:m.s0-m.thSec,t1:m.s0-.02,ar,sc,conv:m.conv.type,p:m.p,msg:m,omni:true,words:[]});}
    m.words.forEach((w,k)=>T.cues.push({t:w.t,idx:byId[S].idx,text:'kamitorebusonaleku'.slice(k%7,k%7+Math.max(2,Math.min(w.len,6))),actor:S,whisper:m.conv.type==='huddle'}));
    T.msgs.push(m);
   });
   const end=Math.max(...items.map(m=>m.readEnd));sc.t1=end+.5;cursor=end+.2;
  });
  T.light.push({t:cursor,min:minOf(p)+3});
 }
 T.duration=cursor+1.2;
 AG.forEach(a=>key(a.id,T.duration,baseP(a.id,R.pulses.length-1)));
 T.cam.push({t:T.duration,c:scene?scene.cam:camFor({type:'wide',members:[]})});
 // sort and prune keys that are too close together: a tiny gap would be a snap
 AG.forEach(a=>{const k=T.keys[a.id].sort((x,y)=>x.t-y.t),out=[];k.forEach(q=>{if(out.length&&q.t-out[out.length-1].t<.06)out[out.length-1]=q;else out.push(q)});T.keys[a.id]=out;tangents(out)});
 T.cam.sort((x,y)=>x.t-y.t);for(let i=1;i<T.cam.length;i++)if(T.cam[i].t<=T.cam[i-1].t)T.cam[i].t=T.cam[i-1].t+1e-3;
 T.light.sort((x,y)=>x.t-y.t);T.marks.sort((a,b)=>a.t-b.t);T.cues.sort((a,b)=>a.t-b.t);
 return T;
}
/* ---------- smooth interpolation: monotone cubic Hermite, so motion flows through keys instead of stopping at each ---------- */
function tangents(keys){
 const n=keys.length;
 const comp=(f)=>{ // f(key)->number ; returns tangent array
  const m=new Array(n).fill(0),d=[];for(let i=0;i<n-1;i++)d.push((f(keys[i+1])-f(keys[i]))/(keys[i+1].t-keys[i].t));
  for(let i=1;i<n-1;i++){const a=d[i-1],b=d[i];m[i]=a*b<=0?0:2*a*b/(a+b)}
  if(n>1){m[0]=d[0];m[n-1]=d[n-2]}return m};
 const proto=keys[0].v,mk={};
 for(const f in proto){const x=proto[f];
  if(Array.isArray(x))mk[f]=x.map((_,j)=>comp(k=>k.v[f][j]));else mk[f]=comp(k=>k.v[f])}
 keys.forEach((k,i)=>{k.m={};for(const f in mk)k.m[f]=Array.isArray(proto[f])?mk[f].map(a=>a[i]):mk[f][i]});
}
function hermite(a,b,t){
 const h=b.t-a.t,s=(t-a.t)/h,s2=s*s,s3=s2*s,h00=2*s3-3*s2+1,h10=s3-2*s2+s,h01=-2*s3+3*s2,h11=s3-s2,o={};
 for(const f in a.v){const x=a.v[f];
  if(Array.isArray(x))o[f]=x.map((_,j)=>h00*x[j]+h10*h*a.m[f][j]+h01*b.v[f][j]+h11*h*b.m[f][j]);
  else o[f]=h00*x+h10*h*a.m[f]+h01*b.v[f]+h11*h*b.m[f]}
 return o;
}
const ease=k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
const seg=(arr,t)=>{if(t<=arr[0].t)return[arr[0],arr[0],0];const n=arr.length-1;if(t>=arr[n].t)return[arr[n],arr[n],0];let lo=0,hi=n;while(hi-lo>1){const m=(lo+hi)>>1;arr[m].t<=t?lo=m:hi=m}return[arr[lo],arr[hi],(t-arr[lo].t)/(arr[hi].t-arr[lo].t)]};
function camAt(T,t){const[a,b,k]=seg(T.cam,t),e=ease(k),c={};
 for(const f in a.c)c[f]=f==='z'?Math.exp(Math.log(a.c.z)+(Math.log(b.c.z)-Math.log(a.c.z))*e):a.c[f]+(b.c[f]-a.c[f])*e;   // zoom in log space, so the dolly feels even
 const zc=Math.max(1,c.z);c.cx=Math.max(600/zc,Math.min(1200-600/zc,c.cx));c.cy=Math.max(300/zc,Math.min(600-300/zc,c.cy));return c}
function sample(T,t){
 const S={t,chars:{},cam:camAt(T,t)};
 AG.forEach(a=>{
  const ks=T.keys[a.id],[x,y,k]=seg(ks,t);
  const v=x===y?x.v:hermite(x,y,t);
  const walking=x!==y&&Math.hypot(y.v.x-x.v.x,y.v.y-x.v.y)>30&&k>.02&&k<.98;
  // the mouth opens on each word as it lands and relaxes between words
  let sp=0;for(const[a0,a1,ws] of T.speak[a.id])if(t>=a0-.05&&t<=a1+.15){let w=0;for(let i=ws.length-1;i>=0;i--)if(ws[i].t<=t){w=Math.exp(-(t-ws[i].t)/.09)*Math.min(1,.55+ws[i].len/7);break}
   sp=(t<=a1?1:Math.max(0,1-(t-a1)/.15))*Math.max(.25,w);break}
  S.chars[a.id]={v,walking,speak:Math.max(0,sp)};
 });
 const[la,lb,lk]=seg(T.light,t);S.min=la.min+(lb.min-la.min)*lk;
 S.balloons=T.balloons.filter(b=>t>=b.t0&&t<=b.t1).map(b=>({b}));
 S.marks=T.marks.filter(m=>t>=m.t&&t<=m.t+m.dur).map(m=>({m,k:(t-m.t)/m.dur}));
 S.captions=T.captions.filter(c=>t>=c.t0&&t<=c.t1).map(c=>({c,op:Math.min(clamp((t-c.t0)/.3,0,1),clamp((c.t1-t)/.3,0,1))}));
 S.scene=T.scenes.find(s=>t>=s.t0&&t<=s.t1)||T.scenes[T.scenes.length-1];
 return S;
}
window.D={buildTimeline,sample,camAt,STAGE,ringPx,hudPx,WID,seg,PACES,timing,tokens};
})();
