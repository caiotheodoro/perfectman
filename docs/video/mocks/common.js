/* Shared helpers for the video mocks: persona signatures, beat building, player, babble. */
(function(){
const R=window.RUN;
const WHEEL=[18,52,95,150,200,245,290,330];
const hash=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const A=Object.fromEntries(R.agents.map(a=>[a.id,a]));
const msgs=R.pulses.flatMap(p=>p.events.filter(e=>e.kind==='say').map(e=>({...e,p:p.i})));
R.agents.forEach(a=>{
  const h=hash(a.id), mine=msgs.filter(m=>m.actor===a.id);
  const avg=mine.reduce((n,m)=>n+m.text.length,0)/Math.max(1,mine.length);
  a.hue=WHEEL[h%8]; a.color=`oklch(0.78 0.13 ${a.hue})`;
  a.initials=a.name.replace(/^(Dona|Mr\.|Ms\.)\s+/,'').slice(0,1).toUpperCase();
  a.short=a.name.replace(/^(Dona|Mr\.|Ms\.)\s+/,'');
  a.avgChars=Math.round(avg);                 // derived from what they actually wrote
  a.msPerChar=Math.max(14,Math.min(46,Math.round(9000/Math.max(60,avg)))); // long writers type faster per char, never slower than 46ms
  a.pitch=0.85+((h>>3)%100)/100*0.9;          // babble pitch from persona hash
});
const meta={}; R.channels.forEach(c=>meta[c.id]=c);
const chLabel=c=>{const m=meta[c];if(!m)return c;if(m.type==='public_channel')return m.name;return m.members.map(i=>A[i].short).join(' + ')};
const moodHue=(v)=>Math.round(230-(Math.max(-.12,Math.min(.12,v))+.12)/.24*190); // cold blue -> warm amber by valence
const moodNorm=(m)=>({v:Math.max(-1,Math.min(1,m.v*8)),a:Math.max(0,Math.min(1,m.a*1.6))}); // data lives in a narrow band; widen for display
const haloFor=(id,pi)=>{const m=R.pulses[pi]?.mood[id];if(!m)return{};const n=moodNorm(m);return{color:`oklch(0.75 0.15 ${moodHue(n.v/8)})`,period:(4.2-n.a*2.8).toFixed(2)+'s'}};

function beats(opts={}){
  const out=[];let lastClock=null;
  R.pulses.forEach(p=>{
    const evs=p.events.filter(e=>e.kind==='say'||e.kind==='react'||e.kind==='open'||e.kind==='invite');
    if(!evs.length)return;
    if(opts.channel&&!evs.some(e=>opts.channel(e.ch)))return;
    out.push({t:'clock',p:p.i,clock:p.clock,dur:.9});
    evs.forEach(e=>{
      if(opts.channel&&!opts.channel(e.ch))return;
      if(e.kind==='say')out.push({t:'say',p:p.i,e,typing:Math.min(2400,e.text.length*A[e.actor].msPerChar),dur:Math.max(1.3,.6+e.text.length/24)});
      else out.push({t:e.kind,p:p.i,e,dur:.9});
    });
  });
  return out;
}

class Player{
  constructor(bs,h){this.bs=bs;this.h=h;this.i=-1;this.speed=1;this.playing=false;this.timer=null;}
  set(i){this.i=i;this.h.onState&&this.h.onState(this)}
  seek(i){i=Math.max(-1,Math.min(this.bs.length-1,i));clearTimeout(this.timer);this.h.onReset&&this.h.onReset();
    for(let k=0;k<=i;k++)this.h.onBeat(this.bs[k],{instant:true});this.set(i);if(this.playing)this.next()}
  play(){if(this.i>=this.bs.length-1)this.seek(-1);this.playing=true;this.h.onState&&this.h.onState(this);this.next()}
  pause(){this.playing=false;clearTimeout(this.timer);this.h.onState&&this.h.onState(this)}
  setSpeed(s){this.speed=s;this.h.onState&&this.h.onState(this)}
  next(){
    if(!this.playing)return;
    if(this.i>=this.bs.length-1){this.playing=false;this.h.onState&&this.h.onState(this);return}
    const b=this.bs[this.i+1],ty=b.t==='say'?b.typing/this.speed:0;
    if(ty&&this.h.onTyping)this.h.onTyping(b,ty);
    this.timer=setTimeout(()=>{
      if(!this.playing)return;
      this.h.onTypingEnd&&this.h.onTypingEnd(b);
      this.h.onBeat(b,{});this.set(this.i+1);
      this.timer=setTimeout(()=>this.next(),b.dur*1000/this.speed);
    },ty);
  }
}

/* "Animalese"-style babble: one short formant blip per letter, pitch and tempo per persona. */
const Babble={on:false,ctx:null,
  enable(){this.ctx=this.ctx||new (window.AudioContext||window.webkitAudioContext)();this.on=true;this.ctx.resume()},
  disable(){this.on=false},
  say(id,text){
    if(!this.on||!this.ctx)return;const a=A[id],c=this.ctx;let t=c.currentTime+.02;
    const letters=[...text.toLowerCase()].filter(ch=>/\p{L}/u.test(ch)).slice(0,28);
    letters.forEach((ch,k)=>{
      if(k%2)return;                                  // every other letter keeps it a murmur, not a drone
      const o=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter();
      const code=ch.charCodeAt(0),vowel='aeiou'.includes(ch);
      o.type='triangle';o.frequency.value=(200+(code%13)*22)*a.pitch*(vowel?1.1:.92);
      f.type='bandpass';f.frequency.value=vowel?900+(code%5)*220:1600;f.Q.value=2.2;
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.06,t+.008);g.gain.exponentialRampToValueAtTime(.0008,t+.07);
      o.connect(f).connect(g).connect(c.destination);o.start(t);o.stop(t+.08);t+=.052/Math.max(.7,a.pitch*.8);
    });
  },
  ping(){if(!this.on)return;const c=this.ctx,o=c.createOscillator(),g=c.createGain(),t=c.currentTime;o.frequency.value=880;g.gain.setValueAtTime(.04,t);g.gain.exponentialRampToValueAtTime(.0005,t+.18);o.connect(g).connect(c.destination);o.start(t);o.stop(t+.2)}
};

function avatar(id,size=36,extra=''){const a=A[id];return `<div class="av" style="--c:${a.color};--s:${size}px" title="${a.name}">${a.initials}${extra}</div>`}
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function transport(root,player,opts={}){
  root.innerHTML=`<button data-a="prev" aria-label="Previous message">Back</button><button data-a="play" aria-label="Play or pause">Play</button><button data-a="next" aria-label="Next message">Next</button>
  <input class="scrub grow" type="range" min="-1" max="${player.bs.length-1}" value="-1" aria-label="Scrub">
  ${[1,2,4].map(s=>`<button data-s="${s}" aria-pressed="${s===1}">${s}x</button>`).join('')}
  ${opts.sound===false?'':'<button data-a="snd" aria-pressed="false">Sound</button>'}`;
  const r=root.querySelector('.scrub');
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.a==='play')player.playing?player.pause():player.play();
    if(b.dataset.a==='prev')player.seek(player.i-1);
    if(b.dataset.a==='next')player.seek(player.i+1);
    if(b.dataset.s){player.setSpeed(+b.dataset.s)}
    if(b.dataset.a==='snd'){const on=b.getAttribute('aria-pressed')!=='true';on?Babble.enable():Babble.disable();b.setAttribute('aria-pressed',on)}});
  r.addEventListener('input',()=>player.seek(+r.value));
  return st=>{r.value=st.i;root.querySelector('[data-a=play]').textContent=st.playing?'Pause':'Play';
    root.querySelectorAll('[data-s]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.s===st.speed))};
}
window.M={R,A,meta,chLabel,haloFor,moodNorm,moodHue,beats,Player,Babble,avatar,esc,transport,msgs};
})();
