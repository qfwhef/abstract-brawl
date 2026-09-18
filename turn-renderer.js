(()=>{
'use strict';
class Art{
 constructor(){this.animations=ANIMATIONS;this.animationSheets=new Map();this.images=new Map();this.pending=new Map();this.loadingCharacters=new Map();this.generation=0;}
 image(url){if(this.pending.has(url))return this.pending.get(url);const p=new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('素材未载入，请重试'));im.src=window.EMBEDDED_IMAGES?.[url]||url;});this.pending.set(url,p);p.catch(()=>this.pending.delete(url));return p;}
 async character(c,full=false){
  const e=ANIMATIONS[c.id];if(!e)return;this.loadingCharacters.set(c.id,(this.loadingCharacters.get(c.id)||0)+1);let sheets=this.animationSheets.get(c.id);if(!sheets){sheets=new Map();this.animationSheets.set(c.id,sheets);}
  const states=full?['idle','run','hurt','down','block',...c.skills.map(s=>FighterAnimation.attackStates[s.sourceIndex??0])]:['idle'];
  const clips=[e.clips,...Object.values(e.directionalClips||{})];const need=new Set(clips.flatMap(cl=>states.flatMap(state=>(cl[state]||[]).map(r=>r.sheet))));
  try{await Promise.all([...need].map(async key=>{if(!sheets.has(key))sheets.set(key,await this.image(e.sheets[key]));}));}finally{const n=this.loadingCharacters.get(c.id)-1;if(n)this.loadingCharacters.set(c.id,n);else this.loadingCharacters.delete(c.id);}
 }
 trim(ids){for(const id of this.animationSheets.keys())if(!ids.has(id)&&!this.loadingCharacters.has(id)){const e=ANIMATIONS[id];for(const url of Object.values(e.sheets))this.pending.delete(url);this.animationSheets.delete(id);}}
 ready(c,state='idle',facing=1){const e=ANIMATIONS[c.id],map=this.animationSheets.get(c.id);return !!map&&(e.directionalClips?.[facing]?.[state]||e.clips[state]||[]).every(r=>map.has(r.sheet));}
 preview(canvas,c,time=0){if(!this.ready(c))return;const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;const scale=canvas.height/205;ctx.save();try{ctx.translate(canvas.width/2,canvas.height-5);ctx.scale(scale,scale);FighterAnimation.drawCharacter(ctx,{data:c.original||c,hp:1,y:443,facing:1,animTime:time},this,1,0,0);}finally{ctx.restore();}}
 cancelBattle(){this.generation++;}
 prune(units){
  const sources=units.flatMap(u=>u.data.skills.map(s=>s.source)),ids=new Set([...units.map(u=>u.data.id),...sources.map(s=>s.summonId).filter(id=>id!=null)]);this.trim(ids);
  const keys=new Set(),add=fx=>{for(const r of MEME_ART.clips[fx]||[])keys.add(r.sheet);},form=name=>{if(MEME_ART.forms?.[name])for(const clip of Object.values(MEME_ART.forms[name].clips))for(const r of clip)keys.add(r.sheet);else for(const key of Object.keys(MEME_ART.clips))if(key===name||key.startsWith(name+'-'))add(key);};
  for(const s of sources){[s.fx,s.openingFx,s.extraShot,...(s.sequence||[])].forEach(add);if(s.form)form(s.form);}for(const u of units)if(u.form)form(u.form);['crescent','wave','cannon','flame','rabbit_bite','pan'].forEach(add);
  for(const key of MemeVisuals.sheets.keys())if(!keys.has(key))MemeVisuals.sheets.delete(key);
  const urls=new Set([...this.animationSheets.keys()].flatMap(id=>Object.values(ANIMATIONS[id].sheets)));for(const key of keys)urls.add(MEME_ART.sheets[key]);for(const url of this.pending.keys())if(!urls.has(url))this.pending.delete(url);
 }
 async battle(units){
  const generation=++this.generation;
  await Promise.all(units.map(u=>this.character(u.data,true)));
  if(generation!==this.generation)return;
  const originals=units.map(u=>({skills:u.data.skills.map(s=>s.source)}));
  const summonIds=new Set(originals.flatMap(c=>c.skills.map(s=>s.summonId)).filter(id=>id!=null));
  await Promise.all([...summonIds].map(id=>this.character(TURN_BY_ID.get(id),true)));
  if(generation!==this.generation)return;await MemeVisuals.load(url=>this.image(url),originals,true);if(generation!==this.generation)return;this.prune(units);
 }
 async skill(s,origin){if(origin!=null)await this.character(TURN_BY_ID.get(origin),true);if(s?.source?.summonId!=null)await this.character(TURN_BY_ID.get(s.source.summonId),true);if(s)await MemeVisuals.load(url=>this.image(url),[{skills:[s.source]}],true);}
}
class Renderer{
 constructor(canvas,art){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.art=art;this.battle=null;this.background=null;this.time=0;this.playing=null;this.paused=false;this.speed=1;this.last=0;this.targets=[];this.target=null;this.mySide=0;this.raf=requestAnimationFrame(t=>this.frame(t));}
 layout(){
  const portrait=typeof matchMedia==='function'&&matchMedia('(max-width:700px) and (orientation:portrait)').matches;
  const width=portrait?740:1100,cw=this.canvas.clientWidth,ch=this.canvas.clientHeight,height=portrait&&cw>0&&ch>0?Math.round(width*ch/cw):portrait?790:680;
  return Renderer.fieldLayout(width,height,portrait);
 }
 static fieldLayout(width,height,portrait=false){const rowHeight=(height-(height>=750?100:30))/2,scale=Math.max(.22,Math.min(portrait?.82:.85,(rowHeight-103)/173));return {width,height,scale,front:portrait?286:405,back:portrait?96:164,top:rowHeight-30,gap:rowHeight};}
 position(u){const l=this.layout(),x=u.cell>=2?l.back:l.front;return {x:u.side?l.width-x:x,y:l.top+(u.cell%2)*l.gap};}
 hitTest(x,y,legal=this.targets){const l=this.layout();return [...(this.battle?.units||[])].filter(u=>u.hp>0&&legal.includes(u.uid)).sort((a,b)=>this.position(b).y-this.position(a).y).find(u=>{const p=this.position(u);return x>=p.x-77&&x<=p.x+77&&y>=p.y-205*l.scale-25&&y<=p.y+48;})?.uid??null;}
 setBattle(b,image,mySide=0,roomCode=null){this.battle=b;this.background=image;this.playing=null;this.time=0;this.targets=[];this.target=null;this.mySide=mySide;this.roomCode=roomCode;}
 play(action,before){return new Promise((resolve,reject)=>{this.playing={action,before,t:0,duration:action.guard?.7:1.5,resolve,reject,sounded:false};});}
 cancel(){const pending=this.playing;this.playing=null;pending?.resolve(false);this.battle=null;}
 frame(now){const dt=Math.min(.05,(now-this.last)/1000);this.last=now;if(!document.hidden&&!this.paused){this.time+=dt;if(this.playing){this.playing.t+=dt*this.speed;if(!this.playing.sounded&&this.playing.t>=this.playing.duration*.48){this.playing.sounded=true;this.onImpact?.(this.playing.action);}if(this.playing.t>=this.playing.duration){const p=this.playing;this.playing=null;p.resolve(true);}}}if(this.battle&&!document.hidden){try{this.draw();}catch(e){const p=this.playing;this.playing=null;if(p)p.reject(e);else{this.paused=true;this.onError?.(e);}}}this.raf=requestAnimationFrame(t=>this.frame(t));}
 actor(u){const p=this.playing,src=p?.action.skill?.source,f={data:u.data.original,hp:u.hp,y:443,x:0,facing:u.side?-1:1,animTime:this.time,vy:0,walk:0,hitFlash:0,invuln:0,form:u.form?{name:u.form,age:this.time}:null};
  if(!p)return f;const progress=p.t/p.duration,old=p.before.find(x=>x.uid===u.uid);if(progress<.49&&old)f.hp=old.hp;
  if(p.action.actor===u.uid){if(p.action.guard){f.blocking=true;return f;}const origin=TURN_BY_ID.get(p.action.origin);if(origin)f.data=origin.original;if(src){const elapsed=progress*(src.duration||.7);f.attack={index:p.action.skill.sourceIndex,serial:1,t:elapsed,skill:{...src,start:(src.duration||.7)*.42}};f.animTime=elapsed;}}
  else if(p.action.targets.includes(u.uid)&&progress>.46&&progress<.78&&p.action.skill?.power){f.stun=1;f.hitFlash=(progress% .13)<.065?.15:0;f.animTime=(progress-.46)*2;}
  return f;
 }
 draw(){
  const c=this.ctx,b=this.battle,l=this.layout(),w=l.width,h=l.height;
  if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.imageSmoothingEnabled=false;
  if(this.background){const iw=this.background.naturalWidth||this.background.width||w,ih=this.background.naturalHeight||this.background.height||h,k=Math.max(w/iw,h/ih);c.drawImage(this.background,(w-iw*k)/2,(h-ih*k)/2,iw*k,ih*k);}
  c.fillStyle='#10132266';c.fillRect(0,0,w,h);if(h>=750){c.fillStyle='#0c0f18aa';c.fillRect(0,h-31,w,31);}
  if(h>=750){const leftMine=(this.mySide??0)===0;c.font='bold 22px Microsoft YaHei';c.textAlign='left';c.fillStyle=leftMine?'#76e7ff':'#ff92ac';c.fillText(leftMine?'我方小队':'对手小队',24,38);c.textAlign='right';c.fillStyle=leftMine?'#ff92ac':'#76e7ff';c.fillText(leftMine?'对手小队':'我方小队',w-24,38);c.textAlign='center';c.fillStyle='#ffe2ad';c.fillText('第 '+b.round+' / 24 轮'+(this.roomCode?' · 房号 '+this.roomCode:''),w/2,38);}else if(this.roomCode){c.font='bold 14px Microsoft YaHei';c.textAlign='center';c.fillStyle='#ffe2adaa';c.fillText('房号 '+this.roomCode,w/2,18);}
  for(const side of [0,1])for(let cell=0;cell<4;cell++){const p=this.position({side,cell}),isAlly=side===(this.mySide??0);c.fillStyle=isAlly?'#47b8c42b':'#a8426b25';c.strokeStyle=isAlly?'#91edff55':'#f59aaa55';c.lineWidth=1;c.beginPath();c.ellipse(p.x,p.y+4,75,22,0,0,Math.PI*2);c.fill();c.stroke();}
  const action=this.playing,progress=action?action.t/action.duration:0;
  for(const u of [...b.units].sort((a,z)=>this.position(a).y-this.position(z).y)){
   const home=this.position(u),head=173*l.scale+34;let p={...home};if(action?.action.actor===u.uid&&action.action.skill?.melee){const target=b.unit(action.action.targets[0]);if(target){const dest=this.position(target),travel=progress<.36?progress/.36:progress>.75?(1-progress)/.25:1;p.x+=(dest.x+(u.side?85:-85)-p.x)*Math.max(0,travel);p.y+=(dest.y-p.y)*Math.max(0,travel);}}
   const selected=this.target===u.uid,legal=this.targets.includes(u.uid),active=b.active===u.uid&&!action;
   if(u.hp>0&&(active||selected||legal)){c.strokeStyle=selected?'#ffd278':active?'#87efff':'#ffffff88';c.lineWidth=selected||active?4:2;c.beginPath();c.ellipse(home.x,home.y+4,77,23,0,0,Math.PI*2);c.stroke();}
   const actor=this.actor(u);c.save();try{c.translate(p.x,p.y);c.scale(l.scale,l.scale);if(!MemeVisuals.form({ctx:c,options:this.art},actor,actor.hp<=0?.38:1,0,0))FighterAnimation.drawCharacter(c,actor,this.art,actor.hp<=0?.38:1,0,0);}finally{c.restore();}
   c.textAlign='center';c.font='bold 21px Microsoft YaHei';c.fillStyle=selected?'#ffd278':u.hp>0?'#fff6e8':'#9396a0';c.shadowColor='#000';c.shadowBlur=5;c.fillText((selected?'▼ ':'')+u.data.name,home.x,home.y-head);c.shadowBlur=0;
   c.fillStyle='#111622';c.fillRect(home.x-63,home.y+16,126,10);c.fillStyle=u.side===(this.mySide??0)?'#78dfea':'#f18da5';c.fillRect(home.x-63,home.y+16,126*u.hp/u.maxHp,10);if(u.shield){c.fillStyle='#ddd4b9';c.fillRect(home.x-63,home.y+28,126*Math.min(1,u.shield/u.maxHp),3);}
   c.font='16px Microsoft YaHei';c.fillStyle='#ecdfc6';c.fillText(u.hp<=0?'退场':`${Math.ceil(u.hp)}/${u.maxHp} · ${u.energy}能`,home.x,home.y+43);
   if(u.hp>0){for(let n=0;n<u.maxGuard;n++){c.fillStyle=n<u.guard?'#fbd593':'#45404c';c.fillRect(home.x-u.maxGuard*6+n*12,home.y-head+12,9,6);}c.fillStyle=u.broken?'#ffdc74':'#e1d6be';c.font='16px Microsoft YaHei';const flags=u.broken?'击破！':u.breakSafe?'击破保护':u.data.weak.map(x=>'弱'+x).join(' ');c.fillText(flags,home.x,home.y-head+33);if(h>=750&&Object.keys(u.status).length){c.fillStyle='#bdecca';c.fillText(Object.keys(u.status).map(x=>({burn:'烧',slow:'缓',expose:'脆',weaken:'弱',attack:'攻↑',haste:'速↑',defend:'防',counter:'反',regen:'愈'}[x]||'')).join(' '),home.x,home.y+63);}}
  }
  if(action&&!action.action.guard)this.effect(action,progress);
  if(h>=750){c.font='18px Microsoft YaHei';c.textAlign='center';c.fillStyle='#e6d8bd';c.fillText('点角色选目标 · 下方执行招式',w/2,h-10);}
 }
 effect(p,t){
  const a=p.action,s=a.skill,source=s.source,c=this.ctx,actor=this.battle.unit(a.actor),start=this.position(actor),targets=a.targets.map(id=>this.battle.unit(id)).filter(Boolean);if(t<.18||t>.9)return;
  for(const target of targets){const end=this.position(target),phase=Math.max(0,Math.min(1,(t-.2)/.36));
   if(s.power&&(s.melee||source.physical)){if(t>.43&&t<.78){c.save();c.translate(end.x,end.y-60);c.strokeStyle='#fff1c9';c.lineWidth=5;for(let n=0;n<5;n++){const angle=n*1.25+t*7;c.beginPath();c.moveTo(Math.cos(angle)*12,Math.sin(angle)*12);c.lineTo(Math.cos(angle)*54,Math.sin(angle)*42);c.stroke();}c.restore();}}
   else if(s.power){
    const x=start.x+(end.x-start.x)*phase,y=start.y-55+(end.y-start.y)*phase-(source.type==='throw'?Math.sin(phase*Math.PI)*72:0);
    if(source.summonId!=null){const summoned=TURN_BY_ID.get(source.summonId);const f={data:summoned.original,hp:1,y:443,vy:0,walk:1,facing:actor.side?-1:1,animTime:p.t};c.save();c.translate(x,y+35);c.scale(.5,.5);FighterAnimation.drawCharacter(c,f,this.art,.85,0,0);c.restore();}
    else {const fx=source.sequence?.[Math.floor(p.t*8)%source.sequence.length]||source.fx;let painted=false;if(!source.noIcons&&fx)painted=MemeVisuals.sprite(c,fx,x,y,source.size?Math.min(125,source.size):85,p.t,actor.side?-1:1,.95,false);if(!painted){c.save();c.strokeStyle=s.school==='声'?'#79dcff':s.school==='巧'?'#fae284':'#c4adff';c.lineWidth=4;c.beginPath();c.arc(x,y,20+Math.sin(p.t*9)*7,-1,1);c.stroke();c.restore();}}
   }else if(t>.35){c.save();c.strokeStyle=s.heal?'#a2efb0':'#8ee6ef';c.globalAlpha=(1-t)*1.4;c.lineWidth=4;c.beginPath();c.ellipse(end.x,end.y-45,58,85,0,0,Math.PI*2);c.stroke();c.restore();}
   if(t>.52){const events=(a.events||[]).filter(e=>e.uid===target.uid&&['damage','heal','break'].includes(e.type));c.save();c.textAlign='center';c.font='bold 23px Microsoft YaHei';events.slice(0,3).forEach((event,i)=>{c.fillStyle=event.type==='heal'?'#a4ffc1':event.type==='break'?'#ffd465':'#fff';c.shadowColor='#101119';c.shadowBlur=5;const text=event.type==='break'?'BREAK!':event.type==='heal'?'+'+event.amount:'−'+event.amount;c.fillText(text,end.x,end.y-95-(t-.52)*60-i*24);});c.restore();}
  }
  if(source.openingFx&&t>.4)MemeVisuals.sprite(c,source.openingFx,start.x,start.y-30,185,p.t,actor.side?-1:1,.65);
 }
}
window.TurnArt=Art;window.TurnRenderer=Renderer;
})();
