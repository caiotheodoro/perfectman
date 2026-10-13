/* Cartoon balloons: measured text, shaped bubbles with tails, stable placement, paging, marks around the head.
   Prototype of the balloon planner and renderer; plan() is pure given a timeline and a text measurer. */
(function(){
const INK='#1d1f1a',PAPER='#fffdf6',NS='http://www.w3.org/2000/svg';
const LET={
 gatekeeper:{font:'"Special Elite"',size:15,lh:1.24,wt:400},
 trickster:{font:'"Shantell Sans"',size:16,lh:1.2,wt:400},
 organizer:{font:'"Patrick Hand"',size:20,lh:1.12,wt:400},
 elder:{font:'"Kalam"',size:18,lh:1.16,wt:400},
 house:{font:'"Shantell Sans"',size:16,lh:1.2,wt:400}};
const SHOUT={font:'"Londrina Solid"',size:27,lh:1.0,wt:400},THINK={font:'"Caveat"',size:21,lh:1.02,wt:500},WHISP={font:'"Shantell Sans"',size:14,lh:1.2,wt:400};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const cv=document.createElement('canvas').getContext('2d');
function styleFor(b,agent){
 if(b.kind==='shout')return Object.assign({},SHOUT);
 if(b.kind==='thought')return Object.assign({},THINK);
 if(b.kind==='whisper')return Object.assign({},LET[agent.archetype]||LET.house,{size:Math.round((LET[agent.archetype]||LET.house).size*.9)});
 const s=Object.assign({},LET[agent.archetype]||LET.house);s.size=Math.round(s.size*(.94+clamp(b.ar,.2,.8)*.3));return s;
}
const fontStr=s=>`${s.wt} ${s.size}px ${s.font}`;
function wrap(text,s,maxW){
 cv.font=fontStr(s);const cjk=/[\u3040-\u30ff\u4e00-\u9fff]/.test(text),words=cjk?[...text]:text.split(/\s+/).filter(Boolean),lines=[],sep=cjk?'':' ';let cur='';
 for(const w of words){const t=cur?cur+sep+w:w;if(cv.measureText(t).width<=maxW||!cur)cur=t;else{lines.push(cur);cur=w}}
 if(cur)lines.push(cur);return lines;
}
/* choose a width that gives a pleasant ~2.3:1 balloon; page the text if it needs more than 4 lines */
function fit(text,s,kind){
 const padX=kind==='shout'?48:kind==='thought'?42:20,padY=kind==='shout'?36:kind==='thought'?30:14,lineH=s.size*s.lh;
 const best=(t)=>{let bestR=null;for(let w=150;w<=330;w+=15){const lines=wrap(t,s,w);if(lines.length>4)continue;
   const tw=Math.max(...lines.map(l=>{cv.font=fontStr(s);return cv.measureText(l).width}))*1.06+4,W=tw+padX*2,H=lines.length*lineH+padY*2,sc=Math.abs(W/H-2.3)+lines.length*.03;
   if(!bestR||sc<bestR.sc)bestR={lines,W,H,sc}}return bestR};
 const one=best(text);if(one)return[one];
 // page: greedy fill of 4-line pages at width 300
 const lines=wrap(text,s,300),pages=[];for(let i=0;i<lines.length;i+=4){const L=lines.slice(i,i+4);cv.font=fontStr(s);
   const tw=Math.max(...L.map(l=>cv.measureText(l).width))*1.06+4;pages.push({lines:L,W:tw+padX*2,H:L.length*lineH+padY*2})}return pages;
}
/* ---------- placement ---------- */
function choose(b,pg,bods,placed,me,cands){
 const ov=(a,c)=>Math.max(0,Math.min(a.x1,c.x1)-Math.max(a.x0,c.x0))*Math.max(0,Math.min(a.y1,c.y1)-Math.max(a.y0,c.y0));
 let bestC=null;
 cands.forEach(c=>{
  const box={x0:c.cx-pg.W/2,x1:c.cx+pg.W/2,y0:c.cy-pg.H/2,y1:c.cy+pg.H/2};let pen=0;
  bods.forEach(o=>pen+=ov(box,o)*(o.id===b.actor?1.6:1));
  placed.forEach(p=>{if(Math.min(p.t1,b.t1)-Math.max(p.t0,b.t0)>.6)pen+=ov(box,p.box)*8});
  const out=(Math.max(0,12-box.x0)+Math.max(0,box.x1-1188))*pg.H+(Math.max(0,12-box.y0)+Math.max(0,box.y1-588))*pg.W;pen+=out*3;
  pen+=Math.hypot(c.tip.x-c.cx,c.tip.y-c.cy)*3.2+Math.abs(c.cx-600)*.02;
  for(let u=.3;u<1;u+=.1){const px=c.cx+(c.tip.x-c.cx)*u,py=c.cy+(c.tip.y-c.cy)*u;
   placed.forEach(p=>{if(Math.min(p.t1,b.t1)-Math.max(p.t0,b.t0)>.6&&px>p.box.x0&&px<p.box.x1&&py>p.box.y0&&py<p.box.y1)pen+=900});
   bods.forEach(o=>{if(o.id!==b.actor&&px>o.x0&&px<o.x1&&py>o.y0&&py<o.y1)pen+=700})}
  if(!bestC||pen<bestC.pen)bestC={c,pen,box}
 });
 return bestC;
}
function candidatesFor(me,pg){
 const topY=me.sy-.97*me.h,cands=[];
 const addUp=(dx,up)=>cands.push({cx:me.sx+dx,cy:topY-pg.H/2-up,tip:{x:me.sx+clamp(dx*.4,-me.hw*.45,me.hw*.45),y:topY+me.h*.12}});
 [0,-.5,.5,-.95,.95,-1.4,1.4,-1.9,1.9].forEach(k=>[14,40,80,130].forEach(up=>addUp(k*pg.W*.6,up)));
 [-1,1].forEach(sd=>[.45,.7].forEach(hy=>cands.push({cx:me.sx+sd*(me.hw+pg.W/2+26),cy:me.sy-hy*me.h,tip:{x:me.sx+sd*me.hw*.55,y:me.sy-.62*me.h}})));
 return cands;
}

function plan(T){
 const D=window.D,W0=window.W,placed=[];
 const bodies=(S,cam)=>W0.R.agents.map(a=>{const v=S.chars[a.id].v,h=v.w*.99,sx=(v.x-cam.cx)*cam.z+600,sy=(v.y-cam.cy)*cam.z+300;
   return{id:a.id,sx,sy,hw:.5*v.w*cam.z,h:h*cam.z,x0:sx-.5*v.w*cam.z-6,x1:sx+.5*v.w*cam.z+6,y0:sy-.97*h*cam.z-6,y1:sy+4}});
 const ov=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
 const list=T.balloons.slice().sort((a,b)=>a.t0-b.t0);
 list.forEach(b=>{
  const agent=W0.byId[b.actor];b.style=styleFor(b,agent);
  if(b.kind==='thought'&&!b.short){let t=b.text.split(/(?<=[.;—])\s/)[0];if(t.length>112)t=t.slice(0,112).replace(/\s+\S*$/,'')+'…';b.text=t;b.short=1}
  b.pages=fit(b.kind==='shout'?b.text.toUpperCase():b.text,b.style,b.kind);
  const tS=Math.min(b.s1-.05,Math.max(b.t0,b.sc.t0+1.4)+.1),S=D.sample(T,Math.max(tS,b.t0)),cam=S.cam,bods=bodies(S,cam),me=bods.find(x=>x.id===b.actor);
  const pg=b.pages[0];
  const cands=candidatesFor(me,pg);
  const bestC=choose(b,pg,bods,placed,me,cands);
  const c=bestC.c;
  b.slot={cx:c.cx,cy:c.cy,tip:c.tip};
  // convert the slot to world coordinates at the scene camera, so it follows the camera when the camera moves
  const toW=(x,y)=>({x:(x-600)/cam.z+cam.cx,y:(y-300)/cam.z+cam.cy});
  b.world={c:toW(c.cx,c.cy),tip:toW(c.tip.x,c.tip.y),z:cam.z};
  placed.push({t0:b.t0,t1:b.t1,box:bestC.box});
  // page timing: each page appears when its first word lands and gives way when the next page's first word lands
  const CJK=/[\u3040-\u30ff\u4e00-\u9fff]/,np=b.pages.length;let kk=0;
  b.pages.forEach(p=>{p.w0=kk;p.n=p.lines.reduce((s,l)=>s+(CJK.test(l)?[...l].length:l.split(' ').filter(Boolean).length),0);kk+=p.n});
  b.pages.forEach((p,i)=>{
   const first=b.words&&b.words[p.w0]?b.words[p.w0].t:b.s0;
   p.t0=i===0?b.t0:first-.12;
   const nf=i<np-1&&b.words&&b.words[b.pages[i+1].w0]?b.words[b.pages[i+1].w0].t:null;
   p.t1=i<np-1?(nf!=null?nf+.18:b.t1):b.t1;
  });
 });
}
/* ---------- shapes ---------- */
const f=n=>n.toFixed(1);
function rr(W,H,r){return`M${r} 0H${W-r}Q${W} 0 ${W} ${r}V${H-r}Q${W} ${H} ${W-r} ${H}H${r}Q0 ${H} 0 ${H-r}V${r}Q0 0 ${r} 0Z`}
function tailPath(W,H,tx,ty,kind){
 const cx=W/2,cy=H/2,dx=tx-cx,dy=ty-cy;let bx,by,nx,ny;
 const sx=Math.abs(dx)/(W/2),sy=Math.abs(dy)/(H/2);
 if(sy>=sx){by=dy>0?H:0;bx=clamp(cx+dx*.35,W*.2,W*.8);nx=1;ny=0}else{bx=dx>0?W:0;by=clamp(cy+dy*.35,H*.25,H*.75);nx=0;ny=1}
 const len=Math.hypot(tx-bx,ty-by),hw=clamp(len*.16,kind==='whisper'?7:9,kind==='whisper'?10:16);
 const a={x:bx-nx*hw,y:by-ny*hw},b2={x:bx+nx*hw,y:by+ny*hw};
 const mx=(bx+tx)/2+(ny?(dx>0?-6:6):0)+(nx?0:0),my=(by+ty)/2;
 return{d:`M${f(a.x)} ${f(a.y)}Q${f(mx-nx*3)} ${f(my-ny*3)} ${f(tx)} ${f(ty)}Q${f(mx+nx*7)} ${f(my+ny*7)} ${f(b2.x)} ${f(b2.y)}Z`,a,b:b2};
}
function burst(W,H){const cx=W/2,cy=H/2,n=16,pts=[];for(let i=0;i<n*2;i++){const k=i%2?0.8:1.06,an=i/(n*2)*Math.PI*2,rx=(W/2+8)*k,ry=(H/2+8)*k;pts.push([cx+Math.cos(an)*rx,cy+Math.sin(an)*ry])}return'M'+pts.map(p=>f(p[0])+' '+f(p[1])).join('L')+'Z'}
function cloud(W,H){const cx=W/2,cy=H/2,n=14,rx=W/2-8,ry=H/2-8,r=Math.max(15,Math.min(28,H*.26)),cs=[];for(let i=0;i<n;i++){const an=i/n*Math.PI*2;cs.push([cx+Math.cos(an)*rx,cy+Math.sin(an)*ry,r])}return cs}
function svgFor(b,pg,tx,ty,agentColor){
 const W=pg.W,H=pg.H,sw=3.2,k=b.kind;let inner='';
 if(k==='thought'){
  const cs=cloud(W,H);
  inner+=cs.map(c=>`<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(c[2])}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}"/>`).join('')+`<ellipse cx="${W/2}" cy="${H/2}" rx="${W/2-10}" ry="${H/2-10}" fill="${PAPER}"/>`;
  // trail of little bubbles toward the thinker
  const dx=tx-W/2,dy=ty-H/2,L=Math.hypot(dx,dy)||1;const ex=W/2+dx/L*Math.min(W/2,H/2*Math.abs(dx/(dy||1))||W/2),ey=H/2+dy/L*(H/2);
  [[.14,10],[.5,7],[.84,5]].forEach(([u,r])=>{const px=ex+(tx-ex)*u,py=ey+(ty-ey)*u;inner+=`<circle cx="${f(px)}" cy="${f(py)}" r="${r}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw-.6}"/>`});
 }else if(k==='shout'){
  const tp=tailPath(W,H,tx,ty,'shout');
  inner+=`<path d="${tp.d}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><path d="${burst(W,H)}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw+.4}" stroke-linejoin="round"/>`;
 }else if(k==='whisper'){
  const tp=tailPath(W,H,tx,ty,'whisper');
  inner+=`<path d="${tp.d}" fill="${PAPER}" fill-opacity=".94" stroke="${INK}" stroke-width="2.2" stroke-dasharray="5 5"/><path d="${rr(W,H,Math.min(22,H/2))}" fill="${PAPER}" fill-opacity=".94" stroke="${INK}" stroke-width="2.2" stroke-dasharray="6 5"/>`;
 }else{
  const tp=tailPath(W,H,tx,ty,'speech');
  inner+=`<path d="${tp.d}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><path d="${rr(W,H,Math.min(26,H/2))}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}"/>`+
   // paint over the seam where tail meets body
   `<path d="M${f(tp.a.x)} ${f(tp.a.y)}L${f(tp.b.x)} ${f(tp.b.y)}" stroke="${PAPER}" stroke-width="${sw+1.5}" stroke-linecap="butt" transform="translate(0 0)"/>`;
 }
 return`<svg class="bl-shape" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible"><g filter="url(#wob)">${inner}</g></svg>`;
}
/* ---------- DOM layer ---------- */
function make(b,i,host){
  const agent=W.byId[b.actor],pg=b.pages[i];
  const dy=b.slot.tip.y>b.slot.cy?(b.pages[0].H-pg.H)/2:0;       // a shorter page stays glued to the head, it does not float away
  const tx=pg.W/2+(b.slot.tip.x-b.slot.cx),ty=pg.H/2+(b.slot.tip.y-(b.slot.cy+dy));
  const n=document.createElement('div');n.className='bl bl-'+b.kind;n.style.cssText=`width:${pg.W}px;height:${pg.H}px;`;
  const col=W.COLORS[agent.idx%6];
  n.innerHTML=svgFor(b,pg,tx,ty,col);
  const s=b.style,pad=b.kind==='shout'?'34px 46px':b.kind==='thought'?'22px 34px 30px':'12px 20px';
  const txt=document.createElement('div');txt.className='bl-txt';
  txt.style.cssText=`font:${s.wt} ${s.size}px/${s.lh} ${s.font};padding:${pad};color:${INK};${b.kind==='shout'?'text-transform:uppercase;letter-spacing:.01em;':''}`;
  let k=0;const cjk=/[\u3040-\u30ff\u4e00-\u9fff]/;txt.innerHTML='<div class="t">'+pg.lines.map(l=>'<div class="ln">'+(cjk.test(l)?[...l]:l.split(' ')).map(w=>`<span class="w" data-i="${k++}">${W.esc(w)}</span>`).join(cjk.test(l)?'':' ')+'</div>').join('')+'</div>';
  n.append(txt);
  if(b.kind!=='thought'){const tag=document.createElement('span');tag.className='bl-tag';tag.textContent=agent.short;tag.style.background=col;n.append(tag)}
  else{const ch=document.createElement('div');ch.className='bl-chips';ch.innerHTML=(b.drivers||[]).slice(0,2).map(d=>`<span>${W.esc(d)}</span>`).join('');n.append(ch)}
  if(b.pages.length>1&&i<b.pages.length-1){const mo=document.createElement('span');mo.className='bl-more';mo.textContent='▸';n.append(mo)}
  host.append(n);return{n,words:n.querySelectorAll('.w'),count:k,last:-1,pg,tx,ty};
}
function Layer(host){
 const el=document.createElement('div');el.className='bl-layer';host.append(el);
 el.innerHTML=`<svg width="0" height="0" style="position:absolute"><defs><filter id="wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.4"/></filter></defs></svg>`;
 const cache={},wm=W.R;
 const build=(b,i)=>make(b,i,el);
 return{el,
  sync(S,cam,opts){
   const seen=new Set();
   S.balloons.forEach(it=>{
    const b=it.b;if(b.omni&&!opts.omni)return;
    b.pages.forEach((pg,i)=>{
     if(S.t<pg.t0||S.t>pg.t1)return;
     const id=b.id+':'+i,c=cache[id]||(cache[id]=build(b,i));seen.add(id);
     const sx=(b.world.c.x-cam.cx)*cam.z+600,sy=(b.world.c.y-cam.cy)*cam.z+300+(b.slot.tip.y>b.slot.cy?(b.pages[0].H-pg.H)/2:0);
     const lc=clamp((S.t-pg.t0)/.22,0,1),lo=clamp((pg.t1-S.t)/.35,0,1);
     const pop=lc<1?.7+.3*(1-Math.pow(1-lc,3))+Math.sin(lc*Math.PI)*.08:1;           // ease-out with a small overshoot
     const scl=pop*(lo<1?.92+.08*lo:1)*(b.kind==='whisper'?.96:1);
     const op=Math.min(lc*1.6,lo,1)*(b.kind==='whisper'?.93:1);
     const tf=`translate(${(sx-pg.W/2).toFixed(1)}px,${(sy-pg.H/2).toFixed(1)}px) scale(${scl.toFixed(3)})`;
     if(c.tf!==tf){c.tf=tf;c.n.style.transform=tf}
     const os=op.toFixed(3);if(c.op!==os){c.op=os;c.n.style.opacity=os}
     if(!c.shown){c.shown=1;c.n.style.display='block';c.n.style.transformOrigin=`${c.tx}px ${c.ty}px`;c.n.style.zIndex=Math.round(1000+b.t0*10)}
     let cnt=c.count;if(b.kind!=='thought'&&b.words&&b.words.length){cnt=0;for(let k=0;k<pg.n;k++)if(b.words[pg.w0+k]&&b.words[pg.w0+k].t<=S.t)cnt++;else break}
     if(cnt!==c.last){c.words.forEach((w,k)=>w.style.opacity=k<cnt?1:0);c.last=cnt}
     if(!c.fv){c.fv=1;const bnce=clamp((b.ar-.3)*220,-60,90);c.n.querySelector('.bl-txt').style.fontVariationSettings=`"BNCE" ${bnce.toFixed(0)},"INFM" 70`}
    });
   });
   for(const id in cache)if(!seen.has(id)&&cache[id].shown){cache[id].shown=0;cache[id].n.style.display='none'}
   return;   for(const id in cache)if(!seen.has(id))cache[id].n.style.display='none';
  }};
}
/* ---------- marks around the head ---------- */
const GLYPH={
 '!':`<text x="0" y="0" font-family="Londrina Solid" font-size="38" fill="#e0453a" stroke="#1d1f1a" stroke-width="2.4" paint-order="stroke" text-anchor="middle">!</text>`,
 '?':`<text x="0" y="0" font-family="Londrina Solid" font-size="38" fill="#f0b43a" stroke="#1d1f1a" stroke-width="2.4" paint-order="stroke" text-anchor="middle">?</text>`,
 '*':`<path d="M0-14L4-4 15-4 6 3 9 14 0 8-9 14-6 3-15-4-4-4Z" fill="#f4cf5a" stroke="#1d1f1a" stroke-width="2.2" stroke-linejoin="round"/>`,
 heart:`<path d="M0 12C-18-2-12-16-4-14-1-13 0-10 0-8 0-10 1-13 4-14 12-16 18-2 0 12Z" fill="#ee5d7a" stroke="#1d1f1a" stroke-width="2.4" stroke-linejoin="round"/>`,
 sweat:`<path d="M0-14Q-10 2 0 10Q10 2 0-14Z" fill="#9fd6ff" stroke="#1d1f1a" stroke-width="2.4" stroke-linejoin="round"/>`,
 steam:`<g fill="none" stroke="#1d1f1a" stroke-width="3" stroke-linecap="round"><path d="M-12 12Q-18 2-10-2Q-4-6-10-14"/><path d="M0 14Q-6 4 2-2Q8-8 2-16"/><path d="M12 12Q6 2 14-2Q20-6 14-14"/></g>`};
function Marks(host){const el=document.createElement('div');el.className='mk-layer';host.append(el);const cache={};
 return{sync(S,cam){const seen=new Set();S.marks.forEach(({m,k},i)=>{const id=m.t+m.actor;seen.add(id);const v=S.chars[m.actor].v;
   let c=cache[id];if(!c){c=cache[id]=document.createElementNS(NS,'svg');c.setAttribute('class','mk');c.setAttribute('viewBox','-30 -30 60 60');c.setAttribute('width','60');c.setAttribute('height','60');c.innerHTML=GLYPH[m.kind]||'';el.append(c)}
   const h=v.w*.99,sx=(v.x+v.w*.34-cam.cx)*cam.z+600,sy=(v.y-.92*h-cam.cy)*cam.z+300;
   const pop=k<.12?k/.12*1.25:k<.2?1.25-(k-.12)/.08*.25:1,fl=-k*14,op=k>.75?(1-k)/.25:1,wob=Math.sin(k*30)*(m.kind==='steam'?3:0);
   c.style.cssText=`display:block;transform:translate(${(sx-30+wob).toFixed(1)}px,${(sy-30+fl).toFixed(1)}px) scale(${pop.toFixed(2)});opacity:${op.toFixed(2)}`})
  for(const id in cache)if(!seen.has(id))cache[id].style.display='none'}}}
/* how many words land on each page of a balloon, so the director can pace paged balloons by the reading */
function pageCounts(b){const ag=W.byId[b.actor],s=styleFor(b,ag),CJK=/[\u3040-\u30ff\u4e00-\u9fff]/;
 const pg=fit(b.kind==='shout'?b.text.toUpperCase():b.text,s,b.kind);return pg.map(p=>p.lines.reduce((n,l)=>n+(CJK.test(l)?[...l].length:l.split(' ').filter(Boolean).length),0))}
window.B={plan,Layer,Marks,fit,styleFor,make,choose,candidatesFor,pageCounts,INK,PAPER};
})();
