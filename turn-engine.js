/* Pure deterministic rules. Manual orders and auto battle share this engine. */
((root)=>{
'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const copy=x=>JSON.parse(JSON.stringify(x));
const ROLES={
 '先锋':{hp:1100,attack:96,armor:25,speed:84,weak:['术','声'],guard:4,passive:'守阵：前排受到的伤害降低 12%。',bond:'全队生命上限 +8%'},
 '强攻':{hp:950,attack:120,armor:15,speed:96,weak:['术','巧'],guard:3,passive:'乘胜：攻击击破目标时伤害再提高 10%。',bond:'全队伤害 +6%'},
 '游击':{hp:860,attack:110,armor:12,speed:120,weak:['力','声'],guard:3,passive:'追击：攻击生命低于一半的敌人时伤害 +12%。',bond:'全队速度 +6'},
 '术士':{hp:870,attack:115,armor:13,speed:98,weak:['力','巧'],guard:3,passive:'共鸣：特色技能与必杀伤害 +8%。',bond:'特色技能消耗降低 4'},
 '控场':{hp:960,attack:101,armor:18,speed:103,weak:['力','术'],guard:3,passive:'破局：造成击破时，自身额外回复 15 能量。',bond:'每人每轮首次弱点攻击额外削 1 破绽'},
 '支援':{hp:980,attack:97,armor:17,speed:101,weak:['声','巧'],guard:3,passive:'援护：治疗与护盾效果 +15%。',bond:'每轮结束全队回复 3% 生命'}
};
const REWARDS=[
 {id:'power',name:'火力全开',desc:'全队伤害 +8%，可叠加。'},
 {id:'vital',name:'再战一场',desc:'全队最大生命 +10%，并立即恢复 20% 生命。'},
 {id:'charge',name:'满电出发',desc:'之后每场初始能量 +18，最多 90。'},
 {id:'break',name:'趁热打铁',desc:'每次击破，全队回复 7 能量。'},
 {id:'speed',name:'先声夺人',desc:'全队速度 +8。'},
 {id:'care',name:'后勤补给',desc:'治疗与护盾 +15%；战后恢复量 +10%。'}
];
class Battle{
 constructor(catalog,teams,options={}){
  if(!Array.isArray(teams)||teams.length!==2||teams.some(t=>t.length!==4||new Set(t.map(x=>x.id)).size!==4||new Set(t.map(x=>x.cell)).size!==4||t.some(x=>!Number.isInteger(x.cell)||x.cell<0||x.cell>3||!catalog.some(c=>c.id===x.id))))throw Error('双方都需四名不同角色，且站位不能重复。');
  this.catalog=catalog;this.options=options;this.seed=(options.seed??Date.now())>>>0;this.round=0;this.turn=0;this.queue=[];this.active=null;this.winner=null;this.events=[];this.lastAction=null;
  this.bonds=teams.map(t=>{const counts={};t.forEach(s=>{const c=catalog.find(c=>c.id===s.id);counts[c.role]=(counts[c.role]||0)+1;});return Object.fromEntries(Object.entries(counts).filter(([,n])=>n>=2).map(([r,n])=>[r,n>=4?2:1]));});
  this.units=teams.flatMap((team,side)=>team.map((slot,i)=>{
   const c=catalog.find(c=>c.id===slot.id),b=this.bonds[side],bo=side===0?(options.boons||{}):{},scale=side===1?(options.enemyScale||1):1;
   const maxHp=Math.round(c.hp*(1+.08*(b['先锋']||0)+.1*(bo.vital||0))*scale);
   return {uid:side*4+i,side,cell:slot.cell,data:c,maxHp,hp:slot.hp==null?maxHp:clamp(Math.round(slot.hp*maxHp),1,maxHp),attack:c.attack*scale,armor:c.armor,speed:c.speed+6*(b['游击']||0)+8*(bo.speed||0),energy:clamp(35+18*(bo.charge||0),0,90),guard:c.guard,maxGuard:c.guard,broken:0,breakSafe:0,status:{},shield:Math.round(maxHp*.04*(b['先锋']||0)),moved:false,usedBond:false,form:null,formTurns:0,damage:0,healing:0,kills:0};
  }));this.next();
 }
 random(){let s=this.seed+=0x6D2B79F5;s=Math.imul(s^s>>>15,s|1);s^=s+Math.imul(s^s>>>7,s|61);return ((s^s>>>14)>>>0)/4294967296;}
 unit(uid){return this.units.find(u=>u.uid===uid);}
 living(side){return this.units.filter(u=>u.hp>0&&(side==null||u.side===side));}
 emit(type,data={}){const event={type,round:this.round,...data};this.events.push(event);this._capture?.push(event);if(this.events.length>160)this.events.shift();}
 energy(u,n){u.energy=clamp(u.energy+n,0,100);}
 checkEnd(){const a=this.living(0),b=this.living(1);if(a.length&&b.length)return false;this.winner=a.length?0:b.length?1:-1;this.active=null;this.emit('end',{winner:this.winner});return true;}
 startRound(){
  this.round++;if(this.round>24){const hp=side=>this.units.filter(u=>u.side===side).reduce((s,u)=>s+u.hp,0)/this.units.filter(u=>u.side===side).reduce((s,u)=>s+u.maxHp,0);const d=hp(0)-hp(1);this.winner=Math.abs(d)<.00001?-1:d>0?0:1;this.active=null;this.emit('end',{winner:this.winner,timeout:true});return;}
  if(this.round>1)for(const side of [0,1]){const n=this.bonds[side]['支援']||0;if(n)this.living(side).forEach(u=>this.heal(u,Math.round(u.maxHp*.03*n)));}
  const order=this.living().map(u=>({u,tie:this.random()}));order.sort((a,b)=>(b.u.speed*(b.u.status.haste?1.22:1)*(b.u.status.slow?.8:1))-(a.u.speed*(a.u.status.haste?1.22:1)*(a.u.status.slow?.8:1))||a.tie-b.tie||a.u.uid-b.u.uid);this.queue=order.map(x=>x.u.uid);this.emit('round',{number:this.round});
 }
 next(){
  if(this.winner!==null)return;this.active=null;
  for(let safety=0;safety<300;safety++){
   if(this.checkEnd())return;if(!this.queue.length)this.startRound();if(this.winner!==null)return;
   const u=this.unit(this.queue.shift());if(!u||u.hp<=0)continue;
   u.moved=false;u.usedBond=false;if(u.breakSafe>0)u.breakSafe--;
   if(u.status.burn){this.rawDamage(u,Math.max(1,Math.round(u.maxHp*.055)),null,'灼烧');if(u.hp<=0)continue;}
   if(u.status.regen)this.heal(u,Math.round(u.maxHp*.075));
   for(const key of Object.keys(u.status)){if(--u.status[key]<=0)delete u.status[key];}
   if(u.formTurns>0&&--u.formTurns===0)u.form=null;
   this.energy(u,12);if(u.broken){u.broken=0;u.guard=u.maxGuard;u.breakSafe=2;this.emit('recover',{uid:u.uid});continue;}
   u.guard=Math.min(u.maxGuard,u.guard+1);this.active=u.uid;this.turn++;this.emit('turn',{uid:u.uid});return;
  }
  throw Error('行动顺序未能推进');
 }
 protector(target){return target.cell>=2?this.living(target.side).find(u=>u.cell===target.cell-2):null;}
 cost(u,s){return s.slot===3?100:Math.max(0,s.cost-((this.bonds[u.side]['术士']||0)*4));}
 targets(u,s){
  if(s.target==='self')return [u];if(s.target==='ally')return this.living(u.side);
  return this.living(1-u.side).filter(t=>!s.melee||!this.protector(t));
 }
 area(u,s,target){
  const list=this.living(s.target==='ally'||s.target==='self'?u.side:1-u.side).filter(t=>s.target!=='enemy'||!s.melee||!this.protector(t));
  if(s.area==='all')return list;if(s.area==='row')return list.filter(t=>Math.floor(t.cell/2)===Math.floor(target.cell/2));if(s.area==='column')return list.filter(t=>t.cell%2===target.cell%2);return [target];
 }
 canUse(u,slot){const s=u?.data.skills[slot];return !!s&&u.hp>0&&u.energy>=this.cost(u,s);}
 skillDesc(s){return s.desc;}
 damageAmount(u,t,s){
  const bo=u.side===0?(this.options.boons||{}):{};
  let n=u.attack*s.power*(1+.06*(this.bonds[u.side]['强攻']||0)+.08*(bo.power||0));
  n*=100/(100+t.armor);if(u.status.attack)n*=1.22;if(u.status.weaken)n*=.8;if(u.form)n*=1.12;
  if(t.status.expose)n*=1.18;if(t.status.defend)n*=.55;if(t.data.role==='先锋'&&t.cell<2)n*=.88;
  if(t.broken)n*=1.35*(u.data.role==='强攻'?1.1:1);if(u.data.role==='游击'&&t.hp<t.maxHp*.5)n*=1.12;if(u.data.role==='术士'&&s.slot>0)n*=1.08;
  if(s.execute&&t.hp<t.maxHp*.4)n*=1.25;return Math.max(1,Math.round(n));
 }
 preview(u,slot,target){const s=u.data.skills[slot];if(!s)return '';if(s.mimic)return '随机模仿同类招式，目标会按招式重新选择';if(s.power)return `${this.damageAmount(u,target,s)} 伤害${target.data.weak.includes(s.school)&&!target.breakSafe?' · 弱点 −'+s.break+' 破绽':''}`;if(s.heal)return '回复约 '+Math.round(u.attack*s.heal)+' 生命';if(s.shield)return '获得护盾';return '施加强化';}
 rawDamage(t,n,u,label){
  if(t.hp<=0)return 0;let absorbed=Math.min(t.shield,n);t.shield-=absorbed;n-=absorbed;const dealt=Math.min(t.hp,n);t.hp=Math.max(0,t.hp-n);if(u)u.damage+=dealt;this.emit('damage',{uid:t.uid,amount:dealt,absorbed,label});
  if(t.hp<=0){t.status={};t.broken=0;t.form=null;if(u)u.kills++;this.emit('ko',{uid:t.uid});}return dealt;
 }
 heal(t,n,u){if(t.hp<=0)return;const amount=Math.min(t.maxHp-t.hp,Math.round(n));t.hp+=amount;if(u)u.healing+=amount;if(amount)this.emit('heal',{uid:t.uid,amount});}
 status(t,key,duration=2){if(t.hp>0)t.status[key]=Math.max(t.status[key]||0,duration);}
 breakTarget(u,t,s){
  if(t.hp<=0||t.broken||t.breakSafe||!t.data.weak.includes(s.school))return;
  let n=s.break||1;if(this.bonds[u.side]['控场']&&!u.usedBond){n+=this.bonds[u.side]['控场'];u.usedBond=true;}
  t.guard=Math.max(0,t.guard-n);if(t.guard===0){t.broken=1;this.energy(u,12+(u.data.role==='控场'?15:0));this.emit('break',{uid:t.uid,by:u.uid});const bo=u.side===0?(this.options.boons||{}):{};if(bo.break)this.living(u.side).forEach(a=>this.energy(a,7*bo.break));}
 }
 move(cell){const u=this.unit(this.active);if(!u||u.moved||!Number.isInteger(cell)||cell<0||cell>3||cell===u.cell)return false;const distance=Math.abs(cell%2-u.cell%2)+Math.abs(Math.floor(cell/2)-Math.floor(u.cell/2));if(distance!==1)return false;const other=this.living(u.side).find(t=>t.cell===cell);if(other)other.cell=u.cell;const from=u.cell;u.cell=cell;u.moved=true;this.emit('move',{uid:u.uid,from,cell,swap:other?.uid});return true;}
 act(slot,targetId,forcedOriginId){
  const u=this.unit(this.active);if(!u||this.winner!==null)return {ok:false,reason:'当前没有可行动角色'};
  if(slot==='guard'){this.status(u,'defend',2);this.energy(u,26);u.guard=Math.min(u.maxGuard,u.guard+1);this.lastAction={actor:u.uid,guard:true,targets:[u.uid]};this.emit('action',{uid:u.uid,name:'防御蓄能',targets:[u.uid]});this.next();return {ok:true,...this.lastAction};}
  const original=u.data.skills[slot];if(!original||!this.canUse(u,slot))return {ok:false,reason:'能量不足'};
  let s=original,origin=null,target=this.unit(targetId);
  if(original.mimic){const pool=this.catalog.filter(c=>c.id!==u.data.id&&!c.skills[slot].mimic);const pick=pool[Math.floor(this.random()*pool.length)];origin=(forcedOriginId!=null&&pool.some(c=>c.id===forcedOriginId))?pool.find(c=>c.id===forcedOriginId):pick;s={...origin.skills[slot],cost:original.cost,slot};const legal=this.targets(u,s);target=legal.find(t=>t.uid===targetId)||legal[Math.floor(this.random()*legal.length)];}
  if(!target||!this.targets(u,s).some(t=>t.uid===target.uid))return {ok:false,reason:'请选择有效目标'};
  const targets=this.area(u,s,target);this.energy(u,-this.cost(u,original));this._capture=[];
  this.lastAction={actor:u.uid,slot,skill:s,origin:origin?.id,targets:targets.map(t=>t.uid)};this.emit('action',{uid:u.uid,name:s.name,targets:targets.map(t=>t.uid),mimic:!!origin});
  const affected=[];
  for(const t of targets){
   if(u.hp<=0)break;
   affected.push(t.uid);
   if(s.power){const n=this.damageAmount(u,t,s),counter=t.status.counter&&u.side!==t.side;this.rawDamage(t,n,u);this.breakTarget(u,t,s);this.energy(t,8);if(s.leech&&u.hp>0)this.heal(u,n*.35,u);if(counter&&t.hp>0)this.rawDamage(u,Math.round(t.attack*.45),t,'反击');}
   const care=(u.data.role==='支援'?1.15:1)*(1+.15*((u.side===0?this.options.boons?.care:0)||0));
   if(s.heal)this.heal(t,u.attack*s.heal*care,u);if(s.shield&&t.hp>0)t.shield=Math.min(t.maxHp*.45,t.shield+Math.round(u.attack*s.shield*care));
   if(s.grantEnergy&&t.hp>0)this.energy(t,s.grantEnergy);
   if(s.cleanse){delete t.status.burn;delete t.status.slow;delete t.status.weaken;delete t.status.expose;}
   for(const [key,duration] of Object.entries(s.status||{}))this.status(t,key,duration);
   if(s.push&&t.hp>0){const to=t.cell<2?t.cell+2:t.cell-2;if(!this.living(t.side).some(x=>x.cell===to))t.cell=to;}
  }
  this.lastAction.targets=affected;
  if(u.hp>0){const care=(u.data.role==='支援'?1.15:1)*(1+.15*((u.side===0?this.options.boons?.care:0)||0));if(slot===0)this.energy(u,24);if(s.energy)this.energy(u,s.energy);if(s.form){u.form=s.form;u.formTurns=3;this.status(u,'attack',3);}if(s.selfHeal)this.heal(u,u.maxHp*s.selfHeal*care,u);if(s.selfShield)u.shield=Math.min(u.maxHp*.45,u.shield+Math.round(u.attack*s.selfShield*care));if(s.teamShield)this.living(u.side).forEach(t=>t.shield=Math.min(t.maxHp*.45,t.shield+Math.round(u.attack*s.teamShield*care)));if(s.teamHeal)this.living(u.side).forEach(t=>this.heal(t,t.maxHp*s.teamHeal,u));}
  const result={ok:true,...this.lastAction,events:this._capture};if(!this.checkEnd())this.next();this._capture=null;return result;
 }
 plan(uid=this.active,level=this.options.difficulty??1){
  const u=this.unit(uid);if(!u||u.hp<=0)return {slot:'guard'};
  const candidates=[];for(let slot=0;slot<4;slot++){if(!this.canUse(u,slot))continue;const s=u.data.skills[slot];for(const t of this.targets(u,s)){
   let score=0;for(const a of this.area(u,s,t)){
    if(s.power){const dmg=this.damageAmount(u,a,s);score+=Math.min(a.hp,dmg);if(dmg>=a.hp)score+=95;if(a.data.weak.includes(s.school)&&!a.broken&&!a.breakSafe)score+=s.break*18+(a.guard<=s.break?90:0);if(level>=3&&this.queue.includes(a.uid))score+=a.attack*.18;if(a.status.counter)score-=Math.min(u.hp,a.attack*.45);}
    if(s.heal)score+=Math.min(a.maxHp-a.hp,u.attack*s.heal)*1.1;if(s.shield)score+=Math.max(0,u.attack*s.shield-a.shield)*.45;
    if(s.status?.attack&&!a.status.attack)score+=75;if(s.status?.haste&&!a.status.haste)score+=55;if(s.status?.counter&&!a.status.counter)score+=45;
    if(s.status?.burn&&!a.status.burn)score+=Math.min(a.hp,a.maxHp*.055*s.status.burn)*.8;if(s.status?.slow&&!a.status.slow)score+=30;if(s.status?.weaken&&!a.status.weaken)score+=45;if(s.status?.expose&&!a.status.expose)score+=35;
    if(s.grantEnergy)score+=Math.min(100-a.energy,s.grantEnergy)*2;if(s.cleanse)score+=Object.keys(a.status).filter(k=>['burn','slow','expose','weaken'].includes(k)).length*30;
   }
   if(s.form&&!u.form)score+=85;if(s.selfHeal)score+=Math.min(u.maxHp-u.hp,u.maxHp*s.selfHeal);if(s.mimic)score+=slot===3?280:115;
   score-=this.cost(u,s)*.55;if(slot===0)score+=20+(u.energy>=55?28:0);const jitter=(((Math.sin((this.turn+1)*997+slot*31+(t.uid+1)*17)*43758.5453)%1)+1)%1;if(level===0)score=score*.4+jitter*140;else if(level===1)score+=jitter*25;
   candidates.push({slot,target:t.uid,score});
  }}
  if(u.energy<85)candidates.push({slot:'guard',score:(u.hp<u.maxHp*.3?95:40)+(u.energy<25?35:0)});
  candidates.sort((a,b)=>b.score-a.score);return candidates[0]||{slot:'guard'};
 }
 snapshot(){return copy({round:this.round,turn:this.turn,queue:this.queue,active:this.active,winner:this.winner,units:this.units,seed:this.seed});}
}
root.AbstractTactics={Battle,ROLES,REWARDS};
})(typeof window!=='undefined'?window:globalThis);
