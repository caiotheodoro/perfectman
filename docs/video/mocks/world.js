/* The world rig for the mocks: hand-drawn characters that act with their bodies, drawn places that take their light
   from the story clock, and a few helpers shared by every mock. Character silhouettes and face poses are the app's own
   (packages/web/src/stage/Figure.tsx, packages/shared/src/stage/emotion-face.ts). */
(function(){
const COLORS=["#e3ad33","#ee6149","#709344","#9693c1","#cb7286","#58a59c"];
const SHAPES=[
"M26 166Q18 143 30 120L21 102Q17 90 36 76L31 62Q29 50 54 40L59 21Q63 9 84 27L102 16Q113 9 129 28L149 24Q163 25 165 43L187 54Q197 61 186 80L199 103Q204 117 188 130L192 147Q190 166 169 172L160 190 134 180 111 192 91 179 68 186 56 171Z",
"M68 173C44 150 42 114 53 88L32 43Q25 18 44 14Q60 11 66 33L80 65Q90 60 101 61L119 24Q131 2 145 12Q158 21 145 42L126 74C153 88 163 117 153 143Q147 170 124 182L90 184Z",
"M23 100 71 76 91 18Q93 10 102 17L129 53 176 35Q185 32 181 43L166 89 204 134Q209 141 199 144L150 150 117 191Q111 199 108 188L92 153 44 168Q33 171 37 159L49 128Z",
"M48 72C13 44 65 7 95 34C123-7 174 14 166 55C214 58 215 107 179 119C211 164 171 199 131 177C101 213 54 192 57 166C11 163 4 108 48 99Z",
"M49 22 165 22 185 47 185 83 207 105 185 127 185 161 163 187 51 187 31 163 31 129 10 107 31 85 31 48Z",
"M36 37Q71 3 121 28L189 64 167 94 187 132Q184 168 145 188L101 165 57 190 31 157 57 125 28 91 65 64Z"];
const FACE={
 neutral:{r:6,bl:"M30 33L44 33",br:"M56 33L70 33",m:"M43 64Q50 64 57 64",bo:0},
 angry:{r:4.3,bl:"M29 28L44 36",br:"M56 36L71 28",m:"M40 67Q50 58 60 67",bo:1},
 worried:{r:7,bl:"M30 35L44 28",br:"M56 28L70 35",m:"M43 67Q50 60 57 67",bo:1},
 tired:{r:3.5,bl:"M30 33L44 34",br:"M56 34L70 33",m:"M43 66Q50 64 57 66",bo:.7},
 smile:{r:5.5,bl:"M30 30L44 31",br:"M56 31L70 30",m:"M40 61Q50 76 60 61",bo:0},
 shock:{r:8,bl:"M30 26L44 25",br:"M56 25L70 26",m:"M43 64Q50 64 57 64",bo:1}};
const ARMS={
 down:["M46 130 Q30 152 36 178","M174 130 Q190 152 184 178"],
 folded:["M46 134 Q80 168 118 152","M174 134 Q140 170 102 154"],
 akimbo:["M46 128 Q12 142 40 170","M174 128 Q208 142 180 170"],
 up:["M44 126 Q12 104 24 66","M176 126 Q208 104 196 66"],
 hug:["M46 138 Q78 184 114 166","M174 138 Q142 184 106 168"],
 wring:["M46 134 Q70 178 106 164","M174 134 Q150 178 114 164"],
 open:["M46 128 Q16 138 10 164","M174 128 Q204 138 210 164"],
 behind:["M46 136 Q38 156 52 172","M174 136 Q182 156 168 172"],
 point:["M46 130 Q30 152 36 178","M174 128 Q208 112 240 116"],
 hold:["M46 132 Q58 160 92 160","M174 132 Q158 160 124 158"]};
/* what a persona's body does when nobody is making it do anything: derived from archetype */
const SIGNATURE={
 gatekeeper:{arms:"folded",lean:0,squash:1.02,prop:"ledger",tell:"upright, arms folded, a ledger under the elbow"},
 trickster:{arms:"hold",lean:-3,squash:.96,prop:"phone",tell:"slouched, thumb on a lit screen"},
 organizer:{arms:"hold",lean:1,squash:1.01,prop:"clipboard",tell:"square-shouldered, clipboard against the chest"},
 elder:{arms:"behind",lean:0,squash:1.01,prop:"glasses",tell:"hands behind the back, round glasses"}};
const sigOf=a=>SIGNATURE[a.archetype]||{arms:"down",lean:0,squash:1,prop:null,tell:"arms at the sides"};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(h1,h2,t)=>{const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),a=p(h1),b=p(h2);return'#'+a.map((v,i)=>Math.round(v+(b[i]-v)*t).toString(16).padStart(2,'0')).join('')};
const dark=(h,t)=>mix(h,'#262920',t);

/* ---------- acting: recorded state -> pose ---------- */
function actFrom(m,soc,o={}){
 const s=k=>soc&&soc[k]||0, e=m.e==null?1:m.e;
 const sc={anger:s('resentment')*3+s('contempt')*2+s('jealousy')*1.6+s('envy')*1.4,
  shame:s('humiliation')*2.4+s('shame')*2.4,
  fear:s('fearOfExclusion')*.7+s('socialAnxiety')*1.4+s('neediness')*1.2,
  warm:s('affection')*1.7+s('admiration')*1.6,
  proud:s('pride')*2.3+s('desireForStatus')*.9,
  suspicion:s('suspicion')*3.6,
  tired:Math.max(0,(.45-e))*3};
 let kind='rest',top=.34;
 for(const k in sc)if(sc[k]>top){top=sc[k];kind=k}
 const a=m.a==null?.4:m.a, breath=clamp(4.7-(a-.25)*8,1.3,4.7);
 const P={kind,strength:top,breath,lean:0,squash:1,puff:1,tremor:0,armL:'down',armR:'down',face:'neutral',gx:0,gy:0,tear:0,blush:0,sweat:0,clench:0,back:0,speaking:!!o.speaking};
 const t=o.toward||0;
 switch(kind){
  case'anger':Object.assign(P,{puff:1.07,squash:.985,lean:4*t,tremor:1+a*2.4,armL:'akimbo',armR:a>.55?'up':'akimbo',face:'angry',clench:1});break;
  case'shame':Object.assign(P,{squash:.9,puff:.96,lean:-6*(t||1),armL:'hug',armR:'hug',face:'worried',gy:1,gx:-t,blush:1});break;
  case'fear':Object.assign(P,{squash:.955,lean:-8*(t||1),tremor:.5+a,armL:'wring',armR:'wring',face:'worried',sweat:1,gx:-t*.5});break;
  case'warm':Object.assign(P,{lean:7*(t||1),squash:1.01,armL:'open',armR:'open',face:'smile',blush:.5,gx:t});break;
  case'proud':Object.assign(P,{squash:1.05,puff:1.03,lean:-2,armL:'akimbo',armR:'akimbo',face:'neutral',gy:-.5});break;
  case'suspicion':Object.assign(P,{lean:-5,squash:.99,armL:'folded',armR:'folded',face:'tired',gx:t});break;
  case'tired':Object.assign(P,{squash:.91,lean:2,face:'tired',gy:.6});break;
 }
 if(kind==='rest'){P.gx=t}
 return P;
}


/* ---------- pose vectors: every number is continuous, so a sampled timeline never snaps ---------- */
const nums=d=>(d.match(/-?\d+\.?\d*/g)||[]).map(Number);
const FACEV=Object.fromEntries(Object.entries(FACE).map(([k,f])=>[k,{r:f.r,bl:nums(f.bl),br:nums(f.br),bo:f.bo,m:nums(f.m)}]));
const ARMV=Object.fromEntries(Object.entries(ARMS).map(([k,[l,r]])=>[k,[nums(l),nums(r)]]));
function toVec(P,sig){
 sig=sig||{};const f=FACEV[P.face||'neutral'];
 const ak=k=>k==='down'&&sig.arms&&sig.arms!=='down'&&P.kind==='rest'?sig.arms:k;
 return{lean:(P.lean||0)+(sig.lean||0),squash:(P.squash||1)*(sig.squash||1),puff:P.puff||1,tremor:P.tremor||0,breath:P.breath||3.4,
  ry:f.r,sry:P.face==='tired'?7:12.5,bl:f.bl,br:f.br,bo:f.bo,m:f.m,aL:ARMV[ak(P.armL||'down')][0],aR:ARMV[ak(P.armR||'down')][1],
  gx:P.gx||0,gy:P.gy||0,tear:P.tear||0,blush:P.blush||0,sweat:P.sweat||0,clench:P.clench||0,back:P.back||0,blur:P.blur||0,dim:P.dim||0,hide:P.hide||0,x:0,y:0,w:0};
}
const lerp=(a,b,k)=>a+(b-a)*k;
function lerpVec(a,b,k){
 const o={};for(const key in a){const x=a[key],y=b[key];o[key]=Array.isArray(x)?x.map((v,i)=>lerp(v,y[i],k)):lerp(x,y,k)}return o;
}

/* ---------- characters ---------- */
function makeActor(host,agent,idx){
 const col=COLORS[idx%6],ar=dark(col,.38),sig=sigOf(agent);
 const svg=`<svg viewBox="0 0 220 218" aria-hidden="true"><ellipse cx="110" cy="206" rx="64" ry="7" fill="#000" opacity=".28"/>
 <g class="body"><g class="shake"><g class="rig"><g class="breath">
  <ellipse cx="80" cy="204" rx="16" ry="7" fill="${ar}"/><ellipse cx="140" cy="204" rx="16" ry="7" fill="${ar}"/>
  <path d="${SHAPES[idx%6]}" fill="${col}"/>
  <path class="armb armL" fill="none" stroke="${ar}" stroke-width="12" stroke-linecap="round" d="${ARMS.down[0]}"/>
  <g class="props"></g>
  <g class="facegrp" transform="translate(31 25) scale(1.6)">
   <g class="look">
    <ellipse cx="39" cy="49" rx="8.5" class="sock sL" ry="12.5" fill="#fffbed"/><ellipse cx="61" cy="49" rx="8.5" class="sock sR" ry="12.5" fill="#fffbed"/>
    <ellipse class="eye eL blink" cx="39" cy="49" rx="3.4" ry="6" fill="#262920"/><ellipse class="eye eR blink" cx="61" cy="49" rx="3.4" ry="6" fill="#262920"/>
    <path class="brL" fill="none" stroke="#262920" stroke-width="2.6" stroke-linecap="round" d="M30 33L44 33"/><path class="brR" fill="none" stroke="#262920" stroke-width="2.6" stroke-linecap="round" d="M56 33L70 33"/>
    <path class="mouth" fill="none" stroke="#262920" stroke-width="2.6" stroke-linecap="round" d="M43 64Q50 64 57 64"/>
    <ellipse class="gasp" cx="50" cy="68" rx="4.5" ry="3.5" fill="#262920" opacity="0"/>
    <path class="clench" d="M42 70l3 3M50 71l0 4M58 70l-3 3" stroke="#262920" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0"/>
    <ellipse class="blush bL" cx="29" cy="62" rx="6" ry="3.4" fill="#e0505a" opacity="0"/><ellipse class="blush bR" cx="71" cy="62" rx="6" ry="3.4" fill="#e0505a" opacity="0"/>
    <path class="sweat drop" d="M76 30q-4 6 0 9q4-3 0-9z" fill="#bfe3ff" opacity="0"/>
    <path class="tear drop" d="M33 66q-4 6 0 9q4-3 0-9z" fill="#9fd0ff" opacity="0" style="animation-delay:.8s"/>
   </g></g>
  <path class="nape" d="M92 36q18-10 36 0M98 46q12-6 24 0" fill="none" stroke="${ar}" stroke-width="5" stroke-linecap="round" opacity="0"/>
  <path class="armb armR" fill="none" stroke="${ar}" stroke-width="12" stroke-linecap="round" d="${ARMS.down[1]}"/>
  <g class="fprops"></g>
 </g></g></g></g></svg>`;
 host.innerHTML=svg+`<span class="nm">${agent.short||agent.name}</span>`;
 const q=s=>host.querySelector(s);
 const E={rig:q('.rig'),breath:q('.breath'),shake:q('.shake'),armL:q('.armL'),armR:q('.armR'),eL:q('.eL'),eR:q('.eR'),sL:q('.sL'),sR:q('.sR'),brL:q('.brL'),brR:q('.brR'),mouth:q('.mouth'),gasp:q('.gasp'),clench:q('.clench'),look:q('.look'),
  blush:host.querySelectorAll('.blush'),sweat:q('.sweat'),tear:q('.tear'),face:q('.facegrp'),nape:q('.nape'),props:q('.props'),fprops:q('.fprops')};
 /* signature props */
 const pr=sig.prop;
 if(pr==='ledger')E.fprops.innerHTML=`<g transform="translate(66 138) rotate(-8)"><rect width="46" height="34" rx="3" fill="#8a3a2a"/><rect x="4" y="4" width="38" height="26" rx="2" fill="#f1e3c3"/><path d="M9 11h26M9 17h20M9 23h24" stroke="#8a3a2a" stroke-width="2"/></g>`;
 if(pr==='phone')E.fprops.innerHTML=`<g transform="translate(96 146) rotate(8)"><rect width="22" height="36" rx="4" fill="#1d2232"/><rect x="2.5" y="3" width="17" height="30" rx="2.5" fill="#8fd0ff" opacity=".9"/></g>`;
 if(pr==='clipboard')E.fprops.innerHTML=`<g transform="translate(76 134) rotate(-4)"><rect width="44" height="52" rx="3" fill="#7a5a35"/><rect x="5" y="9" width="34" height="38" fill="#f7f3e6"/><rect x="15" y="3" width="14" height="9" rx="2" fill="#aaa"/><path d="M10 20h24M10 27h24M10 34h16" stroke="#2d432c" stroke-width="2"/></g>`;
 if(pr==='glasses')E.props.innerHTML=`<g transform="translate(31 25) scale(1.6)" fill="none" stroke="#262920" stroke-width="1.8"><circle cx="39" cy="49" r="11"/><circle cx="61" cy="49" r="11"/><path d="M50 49h0M28 47l-5-3M72 47l5-3"/></g>`;
 return{el:host,agent,idx,sig,
  set(P){
   const lean=P.lean+(sig.lean||0);
   E.rig.style.transform=`rotate(${lean}deg) scale(${(P.puff||1).toFixed(3)},${((P.squash||1)*(sig.squash||1)).toFixed(3)})`;
   E.breath.style.setProperty('--bp',P.breath.toFixed(2)+'s');E.breath.style.setProperty('--by',(1+.012+.004*(4.7-P.breath)).toFixed(3));
   E.shake.style.setProperty('--ta',(P.tremor||0).toFixed(2));E.shake.style.setProperty('--tp',P.tremor>.05?'running':'paused');
   const key=k=>k==='down'&&sig.arms!=='down'&&P.kind==='rest'?sig.arms:k;
   const aL=key(P.armL),aR=key(P.armR);
   E.armL.style.d=`path("${ARMS[aL][0]}")`;E.armR.style.d=`path("${ARMS[aR][1]}")`;
   E.armL.style.transition=E.armR.style.transition='d .7s cubic-bezier(.3,.7,.3,1)';
   const f=FACE[P.face];
   E.eL.setAttribute('ry',f.r);E.eR.setAttribute('ry',f.r);
   E.sL.setAttribute('ry',P.face==='tired'?7:12.5);E.sR.setAttribute('ry',P.face==='tired'?7:12.5);
   E.brL.setAttribute('d',f.bl);E.brR.setAttribute('d',f.br);E.brL.style.opacity=E.brR.style.opacity=f.bo;
   const open=P.speaking&&(P.face==='neutral'||P.face==='angry');
   E.mouth.setAttribute('d',f.m);E.mouth.style.opacity=open?0:1;E.gasp.style.opacity=open?1:0;E.gasp.setAttribute('ry',open?4+(P.speakAmp||0):3.5);
   E.clench.style.opacity=P.clench&&!open?.7:0;
   E.look.style.transform=`translate(${(P.gx||0)*3}px,${(P.gy||0)*2.4}px)`;
   E.eL.setAttribute('cx',39+(P.gx||0)*3);E.eR.setAttribute('cx',61+(P.gx||0)*3);
   E.blush.forEach(b=>b.style.opacity=(P.blush||0)*.5);
   E.sweat.style.opacity=P.sweat?1:0;E.tear.style.opacity=P.tear?1:0;
   E.face.style.opacity=P.back?0:1;E.nape.style.opacity=P.back?.8:0;
  }
  ,update(V,dt,t,o){
   o=o||{};const ph=(this._ph=(this._ph||Math.random()*6)+dt*6.283/Math.max(1.2,V.breath));
   const by=1+.016*Math.sin(ph),bx=1+.008*Math.sin(ph+.6);
   const tw=(V.tremor||0)*1.1,jx=tw*Math.sin(t*61+idx),jy=tw*.4*Math.sin(t*47+idx*2);
   const bob=o.walking?Math.abs(Math.sin(t*9+idx))*-7:0;
   E.breath.style.transform=`scale(${bx.toFixed(4)},${by.toFixed(4)})`;
   E.shake.style.transform=`translate(${jx.toFixed(2)}px,${(jy+bob).toFixed(2)}px)`;
   E.rig.style.transition='none';E.rig.style.transform=`rotate(${V.lean.toFixed(2)}deg) scale(${V.puff.toFixed(3)},${V.squash.toFixed(3)})`;
   const q=(a)=>`M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${a[2].toFixed(1)} ${a[3].toFixed(1)} ${a[4].toFixed(1)} ${a[5].toFixed(1)}`;
   E.armL.style.transition='none';E.armR.style.transition='none';E.armL.setAttribute('d',q(V.aL));E.armR.setAttribute('d',q(V.aR));E.armL.style.d='';E.armR.style.d='';
   const gx=V.gx,gy=V.gy,blinkK=o.blink==null?1:o.blink;
   E.eL.setAttribute('ry',(V.ry*blinkK).toFixed(2));E.eR.setAttribute('ry',(V.ry*blinkK).toFixed(2));E.sL.setAttribute('ry',V.sry);E.sR.setAttribute('ry',V.sry);
   E.eL.setAttribute('cx',39+gx*3);E.eR.setAttribute('cx',61+gx*3);E.eL.style.animation=E.eR.style.animation='none';
   E.eL.setAttribute('cy',49+gy*2);E.eR.setAttribute('cy',49+gy*2);
   E.look.style.transform=`translate(${gx*3}px,${gy*2.4}px)`;
   E.brL.setAttribute('d',`M${V.bl[0].toFixed(1)} ${V.bl[1].toFixed(1)}L${V.bl[2].toFixed(1)} ${V.bl[3].toFixed(1)}`);E.brR.setAttribute('d',`M${V.br[0].toFixed(1)} ${V.br[1].toFixed(1)}L${V.br[2].toFixed(1)} ${V.br[3].toFixed(1)}`);
   E.brL.style.opacity=E.brR.style.opacity=V.bo;
   const sp=o.speak||0,open=sp>.05;
   E.mouth.setAttribute('d',q(V.m).replace(/^M/,'M'));E.mouth.style.opacity=open?0:1;
   E.gasp.style.opacity=open?1:0;E.gasp.setAttribute('ry',(1.8+3.4*Math.abs(Math.sin(t*13+idx))*sp).toFixed(2));E.gasp.setAttribute('rx',(3.6+1.4*Math.abs(Math.sin(t*9+idx))*sp).toFixed(2));
   E.clench.style.opacity=V.clench&&!open?.7:0;
   E.blush.forEach(b=>b.style.opacity=V.blush*.5);E.sweat.style.opacity=V.sweat;E.tear.style.opacity=V.tear;
   E.face.style.opacity=1-V.back;E.nape.style.opacity=V.back*.8;
   host.style.opacity=(1-V.hide).toFixed(3);host.style.filter=(V.blur>.05||V.dim>.02)?`blur(${V.blur.toFixed(2)}px) brightness(${(1-V.dim).toFixed(2)})`:'';
  }};
}
const stateRead=P=>({anger:'tense and puffed, fists on hips, a tremor in the jaw',shame:'shrunk in, arms wrapped, face turned away and flushed',fear:'cringing back, hands wringing, a bead of sweat',warm:'leaning in, arms open, easy smile',proud:'chest up, chin lifted, hands on hips',suspicion:'weight back, arms folded, eyes narrowed',tired:'sagging, eyes half shut',rest:'resting in their own habit'}[P.kind]);

/* ---------- light from the story clock ---------- */
const KEYS=[[5,'#2a3a68','#6b7aa6',.8,.3,.5],[6.5,'#7ea0d0','#f3c9a0',0,0,1],[18.5,'#3b5a9a','#f0a35a',0,0,.95],[20,'#1f2f66','#7d5a8c',.4,.3,.7],[21.5,'#172350','#34407a',.8,.7,.52],[24,'#0f1738','#1f2a58',1,1,.42],[27,'#0b1130','#18214a',1,1,.4],[29,'#2a3a68','#6b7aa6',.8,.3,.5]];
function light(min){
 let h=(min/60)%24;if(h<5)h+=24;
 let a=KEYS[0],b=KEYS[KEYS.length-1];
 for(let i=0;i<KEYS.length-1;i++){if(h>=KEYS[i][0]&&h<=KEYS[i+1][0]){a=KEYS[i];b=KEYS[i+1];break}}
 const t=b[0]===a[0]?0:(h-a[0])/(b[0]-a[0]);
 return{top:mix(a[1],b[1],t),bot:mix(a[2],b[2],t),lamp:a[3]+(b[3]-a[3])*t,stars:a[4]+(b[4]-a[4])*t,L:a[5]+(b[5]-a[5])*t,h:(min/60)%24};
}
const hhmm=s=>{const[h,m]=s.split(':').map(Number);return h*60+m};
const clockText=min=>{const h=Math.floor(min/60)%24,m=Math.round(min%60);return`${h%12||12}:${String(m).padStart(2,'0')}${h<12?'am':'pm'}`};
const rng=(seed)=>{let x=seed;return()=>((x=Math.imul(x^x>>>15,1|x)+0x6D2B79F5|0)>>>0)/4294967296};

/* ---------- places (viewBox 1200 x 600, the floor line is y=470 everywhere) ---------- */
const glow=(id,x,y,r,col,k)=>`<radialGradient id="${id}"><stop offset="0" stop-color="${col}" stop-opacity="${.85*k}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient><circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id})"/>`;
const PLACES={
rooftop(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L),R=rng(7);let w='';
 for(let b=0;b<9;b++){const x=b*150-30,hh=120+R()*110;w+=`<rect x="${x}" y="${395-hh}" width="132" height="${hh}" fill="${sh('#3a4373')}"/>`;
  for(let i=0;i<5;i++)for(let j=0;j<Math.floor(hh/26);j++)if(R()<.55*(1.15-(Lt.h<6||Lt.h>18?(Lt.h>23||Lt.h<4?.7:.2):0)))w+=`<rect x="${x+12+i*24}" y="${395-hh+10+j*26}" width="10" height="14" fill="${mix('#f3c46b','#fff3c4',R())}" opacity=".85"/>`}
 let st='';const S=rng(3);for(let i=0;i<46;i++)st+=`<circle cx="${S()*1200}" cy="${S()*240}" r="${.7+S()*1.3}" fill="#fff" opacity="${(Lt.stars*(.3+S()*.7)).toFixed(2)}"/>`;
 return`<defs><linearGradient id="${u}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${Lt.top}"/><stop offset="1" stop-color="${Lt.bot}"/></linearGradient></defs>
 <rect width="1200" height="400" fill="url(#${u}sky)"/>${st}<circle cx="960" cy="105" r="30" fill="#f4efd8" opacity="${(.25+Lt.stars*.75).toFixed(2)}"/><circle cx="974" cy="98" r="28" fill="${Lt.top}" opacity="${Lt.stars>.3?1:0}"/>
 ${w}
 <rect x="0" y="395" width="1200" height="80" fill="${sh('#cfc3a8')}"/><rect x="0" y="392" width="1200" height="12" fill="${sh('#e4dac1')}"/>
 <rect x="0" y="470" width="1200" height="130" fill="${sh('#3f424f')}"/><path d="M0 470H1200" stroke="${sh('#6b6f7d')}" stroke-width="3"/>
 <g><rect x="30" y="240" width="210" height="232" fill="${sh('#cfc3a8')}"/><rect x="22" y="232" width="226" height="14" fill="${sh('#e4dac1')}"/><rect x="78" y="318" width="92" height="154" rx="3" fill="${sh('#2c2f3b')}"/><rect x="88" y="330" width="72" height="40" fill="${mix('#2c2f3b','#f3c46b',.6*Lt.lamp)}" opacity=".9"/><circle cx="154" cy="400" r="4" fill="${sh('#e0b04a')}"/></g>
 ${glow(u+'g1',124,292,200,'#ffd48a',Lt.lamp)}<rect x="116" y="284" width="16" height="10" rx="3" fill="#ffe7b0" opacity="${.4+.6*Lt.lamp}"/>
 <g><rect x="262" y="296" width="96" height="70" fill="#8a6a43"/><rect x="268" y="302" width="84" height="58" fill="#b58e5c"/><rect x="276" y="310" width="26" height="30" fill="#f7f3e6" transform="rotate(-3 289 325)"/><rect x="310" y="312" width="30" height="22" fill="#f1e3c3" transform="rotate(4 325 323)"/><rect x="284" y="344" width="46" height="12" fill="#f7f3e6"/></g>
 <g><path d="M826 410l-12 62M1004 410l12 62M915 410v62" stroke="${sh('#6b6f7d')}" stroke-width="7"/><rect x="820" y="250" width="190" height="170" rx="6" fill="${sh('#8c7b63')}"/><ellipse cx="915" cy="250" rx="95" ry="20" fill="${sh('#a69378')}"/><path d="M820 290H1010M820 340H1010M820 390H1010" stroke="${sh('#6f604c')}" stroke-width="4"/>
  <g transform="translate(895 196)" class="cat"><ellipse cx="22" cy="28" rx="30" ry="18" fill="${sh('#e08a2a')}"/><circle cx="52" cy="14" r="14" fill="${sh('#e08a2a')}"/><path d="M42 4l4-12 8 8zM58 4l6-10 4 12z" fill="${sh('#e08a2a')}"/><path d="M-8 30q-26-4-20-28" stroke="${sh('#e08a2a')}" stroke-width="9" fill="none" stroke-linecap="round"><animate attributeName="d" dur="4s" repeatCount="indefinite" values="M-8 30q-26-4-20-28;M-8 30q-26 4-14-26;M-8 30q-26-4-20-28"/></path><circle cx="56" cy="12" r="2.4" fill="#2c3a1c"/><circle cx="48" cy="12" r="2.4" fill="#2c3a1c"/></g></g>
 <ellipse cx="700" cy="508" rx="30" ry="8" fill="${sh('#9aa0ad')}"/><ellipse cx="700" cy="504" rx="22" ry="5" fill="${sh('#d9a35a')}"/>
 <line x1="620" y1="150" x2="620" y2="395" stroke="${sh('#6b6f7d')}" stroke-width="5"/><circle cx="620" cy="146" r="6" fill="#ff4b3a"><animate attributeName="opacity" values="1;.1;1" dur="1.6s" repeatCount="indefinite"/></circle>`},
stairwell(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L+.1);let s='';for(let i=0;i<9;i++)s+=`<polygon points="${120+i*100},${470-i*34} ${220+i*100},${470-i*34} ${220+i*100},${504-i*34} ${120+i*100},${504-i*34}" fill="${sh(i%2?'#c9bfa6':'#d6ccb2')}"/><rect x="${120+i*100}" y="${470-i*34}" width="100" height="6" fill="${sh('#efe6cf')}"/>`;
 return`<rect width="1200" height="600" fill="${sh('#b7ae98')}"/><rect y="470" width="1200" height="130" fill="${sh('#6a6659')}"/>${s}<path d="M120 400Q620 130 1140 120" stroke="${sh('#3c3f4a')}" stroke-width="8" fill="none"/><path d="M120 330L1100 -10" stroke="${sh('#3c3f4a')}" stroke-width="5" opacity=".0"/>
 <rect x="990" y="150" width="120" height="260" fill="${sh('#6c4a2b')}"/><rect x="1004" y="168" width="92" height="120" fill="${mix('#6c4a2b','#cfe3ff',.3*(1-Lt.L))}"/>${glow(u+'b',560,80,300,'#ffe2a0',Lt.lamp)}<line x1="560" y1="0" x2="560" y2="70" stroke="#222" stroke-width="3"/><circle cx="560" cy="80" r="11" fill="#fff0c4"/>`},
elevator(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L+.15);let t='';for(let i=0;i<14;i++)t+=`<path d="M${i*90} 470v130" stroke="${sh('#7d7a70')}" stroke-width="2"/>`;
 return`<rect width="1200" height="600" fill="${sh('#cdbfa4')}"/><rect y="470" width="1200" height="130" fill="${sh('#8a867b')}"/>${t}
 <rect x="410" y="110" width="380" height="360" fill="${sh('#9aa3ad')}"/><rect x="418" y="118" width="178" height="352" fill="${sh('#b7c0c9')}"/><rect x="604" y="118" width="178" height="352" fill="${sh('#aeb7c0')}"/><path d="M600 118V470" stroke="${sh('#6e757d')}" stroke-width="6"/>
 <rect x="530" y="56" width="140" height="42" rx="4" fill="#12151f"/><text x="600" y="90" font-family="Fraunces,serif" font-size="30" fill="#ff5a3a" text-anchor="middle">3 ▲ 4</text>
 <rect x="830" y="240" width="46" height="84" rx="6" fill="${sh('#6e757d')}"/><circle cx="853" cy="266" r="9" fill="#ff5a3a"/><circle cx="853" cy="296" r="9" fill="#e9e1c9"/>${glow(u+'e',600,40,320,'#fff2c4',Lt.lamp*.8+.2)}`},
kitchen(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L+.2);let t='';for(let i=0;i<20;i++)for(let j=0;j<4;j++)t+=`<rect x="${i*62}" y="${210+j*46}" width="60" height="44" fill="${sh((i+j)%2?'#e4ddc9':'#ece6d3')}"/>`;
 return`<rect width="1200" height="600" fill="${sh('#cdbf9f')}"/>${t}<rect x="470" y="60" width="260" height="160" rx="4" fill="${Lt.top}"/><path d="M600 60v160M470 140h260" stroke="${sh('#6b5a3f')}" stroke-width="8"/><rect x="0" y="380" width="1200" height="90" fill="${sh('#6d5a3d')}"/><rect y="470" width="1200" height="130" fill="${sh('#8d7e62')}"/>
 <rect x="930" y="300" width="70" height="80" rx="8" fill="${sh('#b9392f')}"/><path d="M1000 330q26 4 20 28" stroke="${sh('#b9392f')}" stroke-width="8" fill="none"/><rect x="140" y="440" width="320" height="16" fill="${sh('#4a3a26')}"/><path d="M170 456v70M430 456v70" stroke="${sh('#4a3a26')}" stroke-width="10"/><rect x="220" y="414" width="34" height="28" rx="5" fill="${sh('#f1ece0')}"/><rect x="340" y="414" width="34" height="28" rx="5" fill="${sh('#f1ece0')}"/>${glow(u+'k',300,150,260,'#ffd48a',Lt.lamp*.8+.2)}<path d="M300 0V120" stroke="#222" stroke-width="3"/><path d="M262 120h76l-16-36h-44z" fill="${sh('#2f6a5a')}"/>`},
living(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L+.2);
 return`<rect width="1200" height="600" fill="${sh('#c8b79a')}"/><rect y="470" width="1200" height="130" fill="${sh('#7a5c3e')}"/><rect x="800" y="70" width="280" height="260" rx="4" fill="${Lt.top}"/><path d="M940 70v260M800 200h280" stroke="${sh('#e9e1c9')}" stroke-width="10"/>
 <rect x="150" y="300" width="400" height="160" rx="26" fill="${sh('#4e6b8c')}"/><rect x="130" y="350" width="60" height="120" rx="22" fill="${sh('#4e6b8c')}"/><rect x="510" y="350" width="60" height="120" rx="22" fill="${sh('#4e6b8c')}"/>
 <ellipse cx="640" cy="528" rx="280" ry="48" fill="${sh('#9a5a4a')}"/><rect x="620" y="150" width="8" height="320" fill="${sh('#2b2b33')}"/><path d="M586 150h86l-20-52h-46z" fill="${sh('#f1d9a0')}"/>${glow(u+'l',630,120,300,'#ffd48a',Lt.lamp*.8+.2)}<rect x="1050" y="360" width="90" height="110" fill="${sh('#3f5a3a')}"/>`},
lobby(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L+.15);let m='';for(let i=0;i<6;i++)for(let j=0;j<4;j++)m+=`<rect x="${70+i*56}" y="${170+j*52}" width="50" height="46" rx="3" fill="${sh('#9aa3ad')}"/><rect x="${86+i*56}" y="${186+j*52}" width="18" height="6" fill="${sh('#2b2f38')}"/>`;
 return`<rect width="1200" height="600" fill="${sh('#cbbf9e')}"/><rect y="470" width="1200" height="130" fill="${sh('#7b7667')}"/>${m}<rect x="800" y="110" width="300" height="360" fill="${Lt.bot}"/><path d="M950 110V470M800 290H1100" stroke="${sh('#3c3f4a')}" stroke-width="9"/><rect x="500" y="380" width="230" height="90" rx="6" fill="${sh('#5f4630')}"/><rect x="1120" y="330" width="60" height="140" fill="${sh('#3f5a3a')}"/>${glow(u+'o',560,50,340,'#fff2c4',Lt.lamp*.8+.2)}`},
street(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L);const R=rng(11);let b='';
 for(let i=0;i<8;i++){const x=i*160-20,hh=200+R()*160;b+=`<rect x="${x}" y="${470-hh}" width="150" height="${hh}" fill="${sh(i%2?'#4a527f':'#566091')}"/>`;for(let k=0;k<4;k++)for(let j=0;j<Math.floor(hh/50);j++)if(R()<.5)b+=`<rect x="${x+14+k*34}" y="${470-hh+14+j*50}" width="18" height="26" fill="#f3c46b" opacity=".8"/>`}
 return`<rect width="1200" height="600" fill="${Lt.top}"/>${b}<rect y="470" width="1200" height="130" fill="${sh('#3a3d49')}"/><rect y="470" width="1200" height="14" fill="${sh('#7d8090')}"/><rect x="40" y="410" width="260" height="70" rx="22" fill="${sh('#4f2f3a')}"/><circle cx="90" cy="486" r="20" fill="#15171f"/><circle cx="250" cy="486" r="20" fill="#15171f"/>
 <rect x="880" y="120" width="10" height="352" fill="${sh('#2b2b33')}"/><path d="M885 128h-60" stroke="${sh('#2b2b33')}" stroke-width="8"/><circle cx="822" cy="132" r="13" fill="#ffe7b0"/>${glow(u+'s',822,140,280,'#ffd48a',Lt.lamp)}<rect x="1060" y="436" width="30" height="40" rx="8" fill="${sh('#b9392f')}"/>`},
office(Lt,u){const sh=h=>mix('#0b1130',h,Lt.L+.2);let bl='';for(let i=0;i<10;i++)bl+=`<rect x="${700+0}" y="${90+i*22}" width="360" height="14" fill="${sh('#e4dfd0')}"/>`;
 return`<rect width="1200" height="600" fill="${sh('#c2c6ca')}"/><rect y="470" width="1200" height="130" fill="${sh('#59606b')}"/><rect x="690" y="80" width="380" height="240" fill="${Lt.bot}"/>${bl}<rect x="120" y="360" width="360" height="22" fill="${sh('#6b5a46')}"/><path d="M150 382v90M450 382v90" stroke="${sh('#6b5a46')}" stroke-width="12"/><rect x="230" y="260" width="140" height="96" rx="6" fill="#161a24"/><rect x="238" y="268" width="124" height="80" fill="#8fd0ff" opacity=".85"/><rect x="290" y="356" width="20" height="10" fill="#161a24"/>${glow(u+'f',300,300,260,'#8fd0ff',.5)}<rect x="1000" y="340" width="100" height="130" fill="${sh('#8a9099')}"/><circle cx="1150" cy="410" r="44" fill="${sh('#3f5a3a')}"/>`}
};
function placeSVG(kind,min,uid){const Lt=light(min),u=uid||('p'+Math.random().toString(36).slice(2,6));return`<svg class="place" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${(PLACES[kind]||PLACES.rooftop)(Lt,u)}<rect width="1200" height="600" fill="#0b1130" opacity="${((1-Lt.L)*.14).toFixed(2)}"/></svg>`}

/* ---------- data helpers ---------- */
const R=window.RUN;
const byId=Object.fromEntries(R.agents.map((a,i)=>[a.id,Object.assign(a,{idx:i,short:a.name.replace(/^(Dona|Mr\.|Ms\.)\s+/,'')})]));
const pubId=R.channels.find(c=>c.type==='public_channel').id;
const chanMeta=Object.fromEntries(R.channels.map(c=>[c.id,c]));
const startMin=hhmm(R.clockStart);
const minOf=p=>startMin+p*4;
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

/* "Animalese"-style voices: one short formant blip per letter; pitch and tempo come from the persona's hash. */
const Babble={on:false,ctx:null,
 enable(){this.ctx=this.ctx||new (window.AudioContext||window.webkitAudioContext)();this.on=true;this.ctx.resume()},
 disable(){this.on=false},
 say(idx,text,whisper){
  if(!this.on||!this.ctx)return;const c=this.ctx;let t=c.currentTime+.02;const pitch=.85+((idx*37)%10)/10*.9;
  [...text.toLowerCase()].filter(ch=>/\p{L}/u.test(ch)).slice(0,26).forEach((ch,k)=>{
   if(k%2)return;const o=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter(),code=ch.charCodeAt(0),vowel='aeiou'.includes(ch);
   o.type='triangle';o.frequency.value=(200+(code%13)*22)*pitch*(vowel?1.1:.92);f.type='bandpass';f.frequency.value=vowel?900+(code%5)*220:1600;f.Q.value=2.2;
   const v=whisper?.03:.06;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.008);g.gain.exponentialRampToValueAtTime(.0008,t+.07);
   o.connect(f).connect(g).connect(c.destination);o.start(t);o.stop(t+.08);t+=.052/Math.max(.7,pitch*.8)})}};

window.W={toVec,lerpVec,lerp,nums,FACEV,ARMV,Babble,COLORS,SHAPES,FACE,ARMS,SIGNATURE,sigOf,actFrom,makeActor,stateRead,light,placeSVG,PLACES,clockText,minOf,startMin,byId,pubId,chanMeta,esc,mix,dark,clamp,hhmm,R};
})();
