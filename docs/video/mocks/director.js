/* Prototype of the director: a run becomes a timeline of continuous tracks, and sample(T, t) is a pure function of the clock.
   Seeking, speed and export all go through sample(), so nothing is "triggered". No DOM in here. */
(function(){
const {R,byId,pubId,chanMeta,minOf,actFrom,toVec,lerpVec,sigOf,clamp}=W;
const ease=k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
const AG=R.agents,N=AG.length;
const STAGE={w:1200,h:600};
/* where everybody stands in a wide shot, and the nook where private talk happens (percent of the plate) */
const ringPct=i=>[ (N<2?50:22+i*(56/(N-1))), [91,94,92,91,96,89,95,93][i%8] ];
const WID=N<=5?.17:N<=6?.14:.12;
const HUD=[[9,92],[25,95],[17,87]];
const ringPx=i=>{const[x,y]=ringPct(i);return{x:x*12,y:y*6,w:WID*1200}};
const hudPx=k=>({x:HUD[k][0]*12,y:HUD[k][1]*6,w:.18*1200});
const idxOf=id=>AG.findIndex(a=>a.id===id);

function convOf(e){
 const ch=chanMeta[e.ch],members=(ch?ch.members:[]).filter(m=>byId[m]);
 if(e.ch===pubId||members.length>=N||members.length>3||members.length<2)return{type:'wide',key:'wide',members:AG.map(a=>a.id)};
 return{type:'huddle',key:e.ch,members};
}
const speechSec=len=>clamp(1.5+len/17,2.0,8.0);
const capsRatio=t=>{const l=t.replace(/[^A-Za-z]/g,'');return l.length?l.replace(/[^A-Z]/g,'').length/l.length:0};
function kindOf(e,conv,ar){
 if(conv.type==='huddle')return'whisper';
 const t=e.text;if((capsRatio(t)>.6&&t.length>10)||(t.match(/!/g)||[]).length>=2||ar>.72)return'shout';
 return'speech';
}
/* meaningful reaction marks */
const MARK={anger:'steam',fear:'sweat',warm:'heart',suspicion:'?',shame:'sweat',proud:'*'};

function buildTimeline(opts){
 opts=opts||{};const MODE=opts.huddle||'push';
 const T={mode:MODE,chars:{},keys:{},cam:[],light:[],balloons:[],marks:[],captions:[],scenes:[],msgs:[],speak:{},lapses:[],pulseT:{}};
 AG.forEach(a=>{T.keys[a.id]=[];T.speak[a.id]=[]});
 let cursor=0,scene=null;
 const pos={},bl={},dm={},hd={};AG.forEach((a,i)=>{pos[a.id]=ringPx(i);bl[a.id]=0;dm[a.id]=0});
 const baseP=(id,p,o)=>actFrom(R.pulses[p].mood[id],R.pulses[p].soc[id],o||{});
 function vecOf(id,P,at){const v=toVec(P,sigOf(byId[id]));const q=at||pos[id];v.x=q.x;v.y=q.y;v.w=q.w;v.blur=bl[id];v.dim=dm[id];v.hide=hd[id]||0;return v}
 const key=(id,t,P,at)=>T.keys[id].push({t,v:vecOf(id,P,at)});
 const camFor=sc=>{
  if(sc.type==='wide'||MODE==='wide')return{cx:600,cy:300,z:1,pool:sc.type==='wide'?0:.5,bg:0,room:0};
  if(MODE==='door')return{cx:600,cy:300,z:1,pool:.4,bg:0,room:1};
  const xs=sc.members.map((m,k)=>hudPx(k).x),cx=xs.reduce((a,b)=>a+b,0)/xs.length;
  return{cx:Math.max(330,cx+40),cy:395,z:1.65,pool:1,bg:1.6,room:0};
 };
 function enterScene(conv,p,t){
  const prev=scene;
  scene={key:conv.key,type:conv.type,members:conv.members,t0:t,t1:t,ch:conv.key};
  scene.cam=camFor(scene);
  if(prev){prev.t1=Math.max(prev.t1,t);}
  T.scenes.push(scene);
  const tArr=t+1.3;
  // cameras
  const oldCam=prev?prev.cam:scene.cam;
  T.cam.push({t,c:oldCam},{t:tArr,c:scene.cam});
  // positions + focus for everybody
  AG.forEach((a,i)=>{
   const P0=baseP(a.id,p),old=pos[a.id];
   key(a.id,t,P0,old);
   let np=ringPx(i),b=0,d=0,h=0;
   if(conv.type==='huddle'){const k=conv.members.indexOf(a.id);
    if(MODE==='door'){if(k>=0){np={x:380+k*430,y:520,w:.2*1200}}else{h=1}}
    else if(k>=0)np=hudPx(k);else if(MODE==='push'){b=3.2;d=.12}}
   pos[a.id]=np;bl[a.id]=b;dm[a.id]=d;hd[a.id]=h;
   const P1=Object.assign({},P0);
   if(conv.type==='huddle'&&!conv.members.includes(a.id)&&MODE!=='door'){P1.gx=-1;P1.lean=-3;P1.armL=P1.armR='folded';P1.kind='peek'}
   if(MODE==='door'&&conv.type==='huddle'&&conv.members.includes(a.id)){key(a.id,t+.55,P0,{x:150,y:old.y,w:old.w})}
   if(MODE==='door'&&conv.type==='wide'&&prev&&prev.type==='huddle'&&prev.members.includes(a.id)){key(a.id,t+.2,P0,{x:150,y:np.y,w:np.w})}
   key(a.id,tArr,P1,np);
  });
  if(conv.type==='huddle')T.captions.push({t0:t+.1,t1:t+2.6,text:`${conv.members.map(m=>byId[m].short).join(' and ')} slip away from the others`,where:'bl'});
  return tArr;
 }
 const pulseGroups=p=>{const ev=R.pulses[p].events.filter(e=>e.kind==='say'),gs=[];ev.forEach(e=>{const c=convOf(e);let g=gs.find(x=>x.conv.key===c.key);if(!g){g={conv:c,ev:[]};gs.push(g)}g.ev.push(e)});return gs};
 T.light.push({t:0,min:minOf(0)});
 for(let p=0;p<R.pulses.length;p++){
  const gs=pulseGroups(p);
  T.pulseT[p]=cursor;
  if(!gs.length){ // time-lapse: nothing is said, the light and the clock move
   const t0=cursor,t1=cursor+1.1;
   T.lapses.push({t0,t1,p});T.light.push({t:t1,min:minOf(p)});
   AG.forEach(a=>key(a.id,t1,baseP(a.id,p)));
   T.captions.push({t0:t0+.1,t1:t1+.4,text:'Time passes…',where:'bl',clock:true});
   cursor=t1;continue;
  }
  T.light.push({t:cursor,min:minOf(p)});
  gs.forEach(g=>{
   if(!scene||scene.key!==g.conv.key){cursor=enterScene(g.conv,p,cursor+(scene?.15:0))-(scene&&scene.type===g.conv.type&&g.conv.type==='wide'?1:0)}
   const sc=scene;let prev=null;const lastBy={};const items=[];
   g.ev.forEach((e,i)=>{
    const D=speechSec(e.text.length);
    let s0=i===0?cursor+.5:Math.max(prev.s0+.6*prev.D,(lastBy[e.actor]||-9)+.4);
    if(i>0&&prev.actor===e.actor)s0=Math.max(s0,prev.s0+prev.D+.3);
    const m={e,p,D,s0,s1:s0+D,actor:e.actor,conv:g.conv,sc};
    items.push(m);prev=m;lastBy[e.actor]=m.s1;
    T.speak[e.actor].push([m.s0,m.s1]);
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
    key(S,m.s0-.45,ant);key(S,m.s0+.05,talk);key(S,m.s0+m.D*.5,ges);key(S,m.s1+.35,Object.assign({},base,{gx:toward*.4}));
    const view=mem; // who is reacting
    AG.forEach(a=>{
     const L=a.id;if(L===S)return;
     const inside=T.speak[L].some(([a0,a1])=>a0<=m.s0+.3&&a1>=m.s0)||T.speak[L].some(([a0,a1])=>a0>m.s0&&a0<m.s1);
     if(inside)return;
     const lt=Math.sign(pos[S].x-pos[L].x)||0,bs=baseP(L,m.p);
     if(!view.includes(L)){ // bystander: low gain glance
      key(L,m.s0+.3,Object.assign({},bs,{gx:sc.type==='huddle'?-1:lt,lean:bs.lean+(sc.type==='huddle'?-3:0),kind:'peek'}));
      key(L,m.s1+.5,Object.assign({},bs,{gx:sc.type==='huddle'?-.6:0}));return}
     key(L,m.s0+.15,Object.assign({},bs,{gx:lt*.9,lean:bs.lean+2*lt}));
     const R2=baseP(L,m.p,{toward:lt});R2.gx=lt*.8;
     key(L,m.s0+m.D*.35,R2);
     if(R2.kind!=='rest'&&R2.strength>.42&&MARK[R2.kind])T.marks.push({t:m.s0+m.D*.35,dur:1.8,actor:L,kind:MARK[R2.kind]});
     key(L,m.s1+.5,Object.assign({},bs,{gx:lt*.3}));
    });
    // balloons
    const ar=R.pulses[m.p].mood[S].a,kind=kindOf(e,m.conv,ar);
    T.balloons.push({id:'b'+T.balloons.length,kind,actor:S,text:e.text,to:e.to,s0:m.s0,s1:m.s1,t0:m.s0-.05,t1:m.s1+Math.max(1.4,1.2),ar,sc,conv:m.conv.type,p:m.p,msg:m});
    const th=R.pulses[m.p].think[S];
    if(th&&!T.balloons.some(b=>b.kind==='thought'&&b.actor===S&&b.p===m.p)){
     T.balloons.push({id:'b'+T.balloons.length,kind:'thought',actor:S,text:th.motive,drivers:th.drivers,s0:m.s0-1.8,s1:m.s0-1.7,t0:m.s0-1.8,t1:m.s0+.5,ar,sc,conv:m.conv.type,p:m.p,msg:m,omni:true});
    }
    T.msgs.push(m);
   });
   const end=Math.max(...items.map(m=>m.s1));
   sc.t1=end+.6;cursor=end+.5;
  });
  T.light.push({t:cursor,min:minOf(p)+3});
 }
 // settle: everybody relaxes to the final base state
 T.duration=cursor+1.2;
 AG.forEach(a=>key(a.id,T.duration,baseP(a.id,R.pulses.length-1)));
 T.cam.push({t:T.duration,c:scene?scene.cam:camFor({type:'wide',members:[]})});T.hideIfDoor=MODE==='door';
 AG.forEach(a=>{const k=T.keys[a.id];k.sort((x,y)=>x.t-y.t);for(let i=1;i<k.length;i++)if(k[i].t<=k[i-1].t)k[i].t=k[i-1].t+1e-3});
 T.cam.sort((x,y)=>x.t-y.t);for(let i=1;i<T.cam.length;i++)if(T.cam[i].t<=T.cam[i-1].t)T.cam[i].t=T.cam[i-1].t+1e-3;
 T.light.sort((x,y)=>x.t-y.t);
 T.marks.sort((a,b)=>a.t-b.t);
 return T;
}
const seg=(arr,t)=>{if(t<=arr[0].t)return[arr[0],arr[0],0];const n=arr.length-1;if(t>=arr[n].t)return[arr[n],arr[n],0];let lo=0,hi=n;while(hi-lo>1){const m=(lo+hi)>>1;arr[m].t<=t?lo=m:hi=m}return[arr[lo],arr[hi],(t-arr[lo].t)/(arr[hi].t-arr[lo].t)]};
function camAt(T,t){const[a,b,k]=seg(T.cam,t),e=ease(k),c={};for(const f in a.c)c[f]=a.c[f]+(b.c[f]-a.c[f])*e;
 const zc=Math.max(1,c.z);c.cx=Math.max(600/zc,Math.min(1200-600/zc,c.cx));c.cy=Math.max(300/zc,Math.min(600-300/zc,c.cy));return c}
function sample(T,t){
 const S={t,chars:{},cam:camAt(T,t)};
 AG.forEach(a=>{
  const[x,y,k]=seg(T.keys[a.id],t),v=lerpVec(x.v,y.v,ease(k));
  const walking=Math.hypot(y.v.x-x.v.x,y.v.y-x.v.y)>30&&k>0&&k<1;
  let sp=0;for(const[a0,a1] of T.speak[a.id])if(t>=a0&&t<=a1)sp=Math.min(1,(t-a0)/.15,(a1-t)/.25);
  S.chars[a.id]={v,walking,speak:Math.max(0,sp)};
 });
 const[la,lb,lk]=seg(T.light,t);S.min=la.min+(lb.min-la.min)*lk;
 S.balloons=T.balloons.filter(b=>t>=b.t0&&t<=b.t1).map(b=>{
  const inK=clamp((t-b.t0)/.24,0,1),outK=clamp((b.t1-t)/.4,0,1);
  const scale=(inK<1?.72+.28*ease(inK)+Math.sin(inK*Math.PI)*.1:1)*(outK<1?.9+.1*outK:1);
  return{b,scale,op:Math.min(inK*1.4,outK,1),reveal:clamp((t-b.s0)/Math.max(.3,(b.s1-b.s0)*.9),0,1)};
 });
 S.marks=T.marks.filter(m=>t>=m.t&&t<=m.t+m.dur).map(m=>({m,k:(t-m.t)/m.dur}));
 S.captions=T.captions.filter(c=>t>=c.t0&&t<=c.t1).map(c=>({c,op:Math.min(clamp((t-c.t0)/.3,0,1),clamp((c.t1-t)/.3,0,1))}));
 S.scene=T.scenes.find(s=>t>=s.t0&&t<=s.t1+.0)||T.scenes[T.scenes.length-1];
 return S;
}
window.D={buildTimeline,sample,camAt,STAGE,ringPx,hudPx,WID,seg};
})();
