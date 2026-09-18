(()=>{
'use strict';
const $=id=>document.getElementById(id),h=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let audioContext=null;
const getAudio=()=>{try{return audioContext||(audioContext=new (window.AudioContext||window.webkitAudioContext)());}catch{return null;}};
const art=new TurnArt(),renderer=new TurnRenderer($('board'),art),music=new ModeMusic({getContext:getAudio,volume:.25,mode:'turn'});
const cells=[0,1,2,3],emptyTeam=()=>cells.map(cell=>({id:null,cell})),modeTeams={quick:[emptyTeam(),emptyTeam()],local:[emptyTeam(),emptyTeam()],run:[emptyTeam(),emptyTeam()],online:[emptyTeam(),emptyTeam()]};let teams=modeTeams.quick;const completeTeam=team=>Array.isArray(team)&&team.length===4&&team.every(s=>TURN_BY_ID.has(s.id))&&new Set(team.map(s=>s.id)).size===4;
let editSide=0,editSlot=0,mode='quick',view='setup',battle=null,run=null,busy=false,paused=false,automatic=false,speed=1,selectedSkill=0,selectedTarget=null,moving=false,ticket=0,timer=null,previewTime=0,previewLast=0,focused=true,muted=false,planCache=null,campCell=null,loading=false,stage=null,lastMoveCell=null;
const net=new AbstractNet.NetClient();let online={phase:'idle',code:null,side:0,locked:[false,false],waiting:false,turnSent:false,pendingAction:null};
const saveKey='abstract-tactics-run-v1',roleNames=Object.keys(AbstractTactics.ROLES),learnedKey='abstract-tactics-learned-v1';
const selectedCharacter=()=>TURN_BY_ID.get(teams[editSide][editSlot]?.id);
const setupFormation=new TurnFormation($('setup-formation'),art,{getTeam:()=>teams[editSide],getSide:()=>editSide,getFocusCell:()=>teams[editSide][editSlot].cell,canEdit:()=>view==='setup'&&!loading&&!busy&&!$('help').open,onSelect:i=>{editSlot=i;refreshSetup();},onChange:i=>{editSlot=i;refreshSetup();}});
const campFormation=new TurnFormation($('camp-formation'),art,{getTeam:()=>run?.party||[],canEdit:()=>view==='results'&&run?.phase==='camp'&&!loading&&!$('help').open,onChange:()=>{saveRun();renderCamp();}});
let formationSceneTicket=0;
async function loadFormationScene(){const serial=++formationSceneTicket,choice=$('stage-select').value,pick=STAGES.find(x=>x.id===choice)||STAGES[0];try{const image=await art.image(pick.file);if(serial!==formationSceneTicket)return;setupFormation.background=image;}catch{}}
$('stage-select').onchange=loadFormationScene;
function message(text){$('load-status').textContent=text;}
function setView(next){setupFormation.cancel();campFormation.cancel();view=next;for(const name of ['setup','combat','results'])$(name).hidden=name!==next;document.body.classList.toggle('in-tactics',next==='combat');if(next==='results'&&run?.phase==='camp')campFormation.update();syncMusic();window.scrollTo(0,0);}
function syncMusic(){music.setMuted(muted);music.setPaused(document.hidden||!focused||(view==='combat'&&paused));music.play(view==='combat'?(run&&run.index>=2?'elite':'battle'):view==='results'&&battle?.winner===0?'victory':'select');}
function unlock(){music.unlock().then(syncMusic).catch(()=>{});}
renderer.onImpact=action=>{if(muted||!audioContext||audioContext.state!=='running')return;try{const t=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain(),heavy=action.skill?.slot===3;o.type=action.guard?'triangle':'square';o.frequency.setValueAtTime(heavy?110:action.skill?.power?230:640,t);o.frequency.exponentialRampToValueAtTime(heavy?40:120,t+.18);g.gain.setValueAtTime(.055,t);g.gain.exponentialRampToValueAtTime(.0001,t+.22);o.connect(g).connect(audioContext.destination);o.start(t);o.stop(t+.24);o.onended=()=>{o.disconnect();g.disconnect();};}catch{}};
renderer.onError=()=>{togglePause(true);$('preview').textContent='角色素材尚未就绪，请返回编队重新出击。';};
document.addEventListener('pointerdown',unlock,{capture:true});document.addEventListener('keydown',unlock,{capture:true});
$('music-toggle').onclick=()=>{muted=!muted;$('music-toggle').textContent=muted?'音乐关':'音乐开';syncMusic();};$('music-volume').oninput=e=>music.setVolume(+e.target.value/100);
window.addEventListener('blur',()=>{focused=false;if(view==='combat'&&!paused)togglePause(true);syncMusic();});window.addEventListener('focus',()=>{focused=true;syncMusic();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&view==='combat')togglePause(true);syncMusic();});window.addEventListener('pagehide',()=>{clearTimeout(timer);if(view==='combat')togglePause(true);music.stop();});window.addEventListener('pageshow',()=>{focused=document.hasFocus?.()??true;syncMusic();});
$('help-open').onclick=()=>{if(view==='combat')togglePause(true);$('help').showModal();try{localStorage.setItem(learnedKey,'1');}catch{}};$('help-close').onclick=()=>$('help').close();
for(const r of roleNames){const o=document.createElement('option');o.value=r;o.textContent=r;$('role-filter').append(o);}for(const s of STAGES){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;$('stage-select').append(o);}
function randomTeam(){const pool=[...TURN_ROSTER];for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}const chosen=pool.slice(0,4);chosen.sort((a,b)=>(a.role==='先锋'?-1:0)-(b.role==='先锋'?-1:0));return chosen.map((c,i)=>({id:c.id,cell:cells[i]}));}
function counts(team){const count={};for(const slot of team){const c=TURN_BY_ID.get(slot.id);if(!c)continue;count[c.role]=(count[c.role]||0)+1;}return count;}
function describeBonds(team){const count=counts(team);return Object.entries(count).sort((a,b)=>b[1]-a[1]).map(([r,n])=>`<span class="bond ${n<2?'off':''}" title="${h(AbstractTactics.ROLES[r].bond)}">${h(r)} ${n}/2${n>=2?' · '+h(AbstractTactics.ROLES[r].bond)+(n===4?' ×2':''):''}</span>`).join('');}
async function preview(canvas,c){try{await art.character(c);if(canvas.isConnected&&selectedCharacter()?.id===c.id)art.preview(canvas,c);}catch{if(canvas.isConnected&&selectedCharacter()?.id===c.id)canvas.setAttribute('aria-label',c.name+'，图片待加载');}}
function refreshSetup(){
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 $('online-panel').hidden=mode!=='online';
 const launchSettings=$('launch-settings')||document.querySelector('.launch-settings');if(launchSettings)launchSettings.style.display=mode==='online'?'none':'';
 $('start').style.display='';
 if(mode==='online')editSide=online.side;
 const c=selectedCharacter(),team=teams[editSide];$('team-title').textContent=mode==='online'?(online.locked[online.side]?'我方已锁定':'我方阵容（联机）'):editSide?(mode==='local'?'2P 阵容':'敌方阵容'):(mode==='local'?'1P 阵容':'我方阵容');$('edit-ally').classList.toggle('active',editSide===0);$('edit-enemy').classList.toggle('active',editSide===1);$('edit-enemy').disabled=mode==='run'||mode==='online';$('edit-ally').textContent=mode==='local'?'1P':'我方';$('edit-enemy').textContent=mode==='local'?'2P':mode==='online'?'对手':'敌方';
 setupFormation.update();
 $('bonds').innerHTML=describeBonds(team);if(c){$('detail-name').textContent=c.name;$('detail-role').textContent=c.role;$('detail-feature').textContent=c.feature;$('detail-stats').innerHTML=[['生命',c.hp],['攻击',c.attack],['护甲',c.armor],['速度',c.speed]].map(([n,v])=>`<span>${n}<b>${v}</b></span>`).join('');$('detail-passive').textContent=c.passive+' 弱点：'+c.weak.map(s=>TURN_SCHOOLS[s]).join('、');$('detail-skills').innerHTML=c.skills.map((s,i)=>`<div class="detail-skill"><div><b>${h(s.name)}</b><small>${i===0?'免费':s.cost+' 能量'}</small></div><p>${h(s.desc)}</p></div>`).join('');preview($('detail-art'),c);}else{$('detail-name').textContent='选择一名角色';$('detail-role').textContent='空位';$('detail-feature').textContent='从下方角色列表加入小队';$('detail-stats').innerHTML='';$('detail-passive').textContent='';$('detail-skills').innerHTML='';const canvas=$('detail-art');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}
 $('turn-roster').querySelectorAll('[data-id]').forEach(b=>{const id=+b.dataset.id;b.classList.toggle('chosen',team.some(s=>s.id===id));b.classList.toggle('active',c?.id===id);b.setAttribute('aria-pressed',String(c?.id===id));});
 const required=mode==='run'?[teams[0]]:mode==='online'?[teams[online.side]]:teams,ready=required.every(completeTeam),chosen=required.reduce((n,t)=>n+t.filter(s=>TURN_BY_ID.has(s.id)).length,0);
 if(mode==='online'){
  const inRoom=online.phase==='select'||online.phase==='waiting';
  const isWaiting=online.phase==='waiting';
  const isSelect=online.phase==='select';
  const isLocked=online.locked[online.side];
  if($('online-box-create'))$('online-box-create').hidden=inRoom;
  if($('online-box-join'))$('online-box-join').hidden=inRoom;
  if($('online-wait'))$('online-wait').hidden=!isWaiting;
  if($('online-joined')){
   $('online-joined').hidden=!isSelect;
   if(isSelect){
    if($('online-joined-code-display'))$('online-joined-code-display').textContent=online.code||'';
    if($('online-joined-role'))$('online-joined-role').textContent=online.side===0?'1P (房主)':'2P (挑战者)';
   }
  }
  $('start').disabled=loading||!ready||isLocked||!inRoom;
  $('start').innerHTML=isLocked?'阵容已锁定 · 等待对手…':!inRoom?'创建或加入房间后锁定':ready?'锁定阵容 <span>↗</span>':'还需选择 '+(4-chosen)+' 名角色';
 }else{
  if($('online-box-create'))$('online-box-create').hidden=false;
  if($('online-box-join'))$('online-box-join').hidden=false;
  if($('online-wait'))$('online-wait').hidden=true;
  if($('online-joined'))$('online-joined').hidden=true;
  $('start').disabled=loading||!ready;
  $('start').innerHTML=ready?'小队出击 <span>↗</span>':'还需选择 '+(required.length*4-chosen)+' 名角色';
 }
 $('mode-description').textContent={quick:'为我方和敌方各选四名角色，组好双方阵容后出击。',run:'自己选择四名角色，带同一支小队连战五场。每次胜利选择强化，战间恢复并调整站位。',local:'1P 和 2P 各选四名角色，选满后在同一台设备上轮流下达指令。',online:'先开房间或加入房间，然后双方各自选择阵容并锁定，即可开战。'}[mode];$('difficulty').disabled=mode==='local'||mode==='online';$('launch-note').textContent=mode==='run'?'常规战 → 常规战 → 精英战 → 精英战 → 决战；成长只在本次远征生效。':'前排挡住近战，远程可打后排。先削破绽，再放必杀。';
}
const cardQueue=[];let workers=0;const renderedCards=new Set();
function enqueueCard(button){if(renderedCards.has(button))return;renderedCards.add(button);cardQueue.push(button);pumpCards();}
function pumpCards(){while(workers<2&&cardQueue.length){const button=cardQueue.shift(),c=TURN_BY_ID.get(+button.dataset.id);workers++;art.character(c).then(()=>{if(button.isConnected)art.preview(button.querySelector('canvas'),c);if(view==='setup'&&!loading)art.trim(new Set(teams.flatMap(t=>t.map(s=>s.id))));}).catch(()=>renderedCards.delete(button)).finally(()=>{workers--;pumpCards();});}}
let observer;
function renderRoster(){observer?.disconnect();cardQueue.length=0;const query=$('search').value.trim(),role=$('role-filter').value,list=TURN_ROSTER.filter(c=>(!query||c.name.includes(query))&&(!role||c.role===role));$('roster-count').textContent=list.length+' 名角色';$('turn-roster').innerHTML=list.map(c=>`<button class="roster-card" data-id="${c.id}" title="${h(c.name+' · '+c.role)}" aria-label="选择${h(c.name)}"><canvas width="100" height="95" aria-hidden="true"></canvas><b>${h(c.name)}</b><small>${h(c.role)}</small></button>`).join('');if(!list.length){$('turn-roster').textContent='没有匹配的角色';return;}
 for(const b of $('turn-roster').children)b.onclick=()=>{setupFormation.cancel();const id=+b.dataset.id,team=teams[editSide],other=team.findIndex(s=>s.id===id);if(other>=0){editSlot=other;}else{const wasEmpty=team[editSlot].id==null;team[editSlot].id=id;if(wasEmpty){const next=team.findIndex(s=>s.id==null);if(next>=0)editSlot=next;}}refreshSetup();};
 if(window.IntersectionObserver){observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){enqueueCard(e.target);observer.unobserve(e.target);}},{root:$('turn-roster'),rootMargin:'80px'});for(const b of $('turn-roster').children)observer.observe(b);}else for(const b of $('turn-roster').children)enqueueCard(b);refreshSetup();
}
$('search').oninput=renderRoster;$('role-filter').onchange=renderRoster;$('edit-ally').onclick=()=>{if(mode==='online')editSide=online.side;else editSide=0;refreshSetup();};$('edit-enemy').onclick=()=>{if(mode==='online')return;editSide=1;refreshSetup();};$('random-team').onclick=()=>{teams[editSide]=randomTeam();refreshSetup();};document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(mode==='online'&&!onlineLeaving())return;mode=b.dataset.mode;teams=modeTeams[mode];setupFormation.cancel();editSide=0;editSlot=0;lastMoveCell=null;online={phase:'idle',code:null,side:0,locked:[false,false],waiting:false,turnSent:false,pendingAction:null};$('online-wait').hidden=true;$('online-status').textContent='';document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));refreshSetup();if(mode==='online'&&!net.connected)net.connect().catch(()=>{});});

/* --- 在线对战：房间与对局同步 --- */
const onlineStatus=text=>{$('online-status').textContent=text||'';};
function onlineLeaving(){if(online.phase!=='idle'){const yes=confirm('退出在线对战将离开当前房间。确定？');if(!yes)return false;net.leave();net.forgetSession();online={phase:'idle',code:null,side:0,locked:[false,false],waiting:false,turnSent:false,pendingAction:null};onlineStatus('');}return true;}
$('online-create').onclick=async()=>{
 if(!net.connected){onlineStatus('正在连接服务器…');try{await net.connect();}catch(e){onlineStatus('无法连接联机服务器。');return;}}
 if(!net.create()){onlineStatus('重置会话重试中…');net.forgetSession();await net.connect().catch(()=>{});if(net.create()){online.phase='waiting';onlineStatus('创建房间中…');}else onlineStatus('创建房间失败，请重试。');}
 else{online.phase='waiting';onlineStatus('创建房间中…');}
};
$('online-join').onclick=async()=>{
 const code=$('online-code').value.trim();
 if(!/^\d{6}$/.test(code)){onlineStatus('请输入六位数字房号。');return;}
 if(!net.connected){onlineStatus('正在连接服务器…');try{await net.connect();}catch(e){onlineStatus('无法连接联机服务器。');return;}}
 if(!net.join(code)){onlineStatus('重置会话重试中…');net.forgetSession();await net.connect().catch(()=>{});if(net.join(code)){onlineStatus('加入房间中…');}else onlineStatus('加入房间失败，请重试。');}
 else{onlineStatus('加入房间中…');}
};
$('online-code').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,6);};
$('online-cancel').onclick=()=>{net.leave();net.forgetSession();online={phase:'idle',code:null,side:0,locked:[false,false],waiting:false,turnSent:false,pendingAction:null};$('online-wait').hidden=true;onlineStatus('');refreshSetup();};
const leaveBtn=$('online-leave-room');if(leaveBtn)leaveBtn.onclick=()=>{if(!onlineLeaving())return;back();};
net.on('created',msg=>{online.code=msg.code;online.side=msg.side;online.phase='waiting';$('online-code-display').textContent=msg.code;$('online-wait').hidden=false;onlineStatus('房间已创建，等待对手…');refreshSetup();});
net.on('joined',msg=>{online.code=msg.code;online.side=msg.side;online.phase='select';editSide=msg.side;onlineStatus('已加入房间，请选择阵容。');refreshSetup();});
net.on('opponent_joined',()=>{online.phase='select';onlineStatus('对手已加入！双方各自选阵容，锁定后自动开战。');refreshSetup();});
/* 在线模式下“出击”按钮即“锁定阵容”，队伍仅本方需要完整 */
$('start').addEventListener('click',()=>{
 if(mode!=='online'||loading)return;
 if(online.phase!=='select'&&online.phase!=='waiting'){onlineStatus('当前不能锁定：先创建或加入房间。');return;}
 if(!completeTeam(teams[online.side])){onlineStatus('请先选择四名不同角色组成本方阵容。');return;}
 if(online.locked[online.side]){onlineStatus('已锁定，等待对手…');return;}
 net.lock(teams[online.side].map(s=>({id:s.id,cell:s.cell})));onlineStatus('锁定中…');refreshSetup();
});
net.on('error',msg=>{
 onlineStatus(msg.message||'联机错误。');
 if(online.turnSent){
  online.turnSent=false;online.pendingAction=null;busy=false;
  online.lastError=msg.message||'指令未被执行，请重试。';
  if(mode==='online'&&view==='combat'){
   $('action-banner').textContent=online.lastError;
   setTimeout(()=>{if($('action-banner').textContent===online.lastError)$('action-banner').textContent='';},3000);
   renderCombat();
  }
 }
 if(msg.code==='TOKEN_INVALID'){net.forgetSession();onlineStatus('会话已刷新，请重试创建或加入房间。');}
 if(['ROOM_NOT_FOUND','ROOM_FULL','RATE_LIMITED','TOKEN_INVALID','VERSION_MISMATCH'].includes(msg.code))online.phase='idle';
 refreshSetup();
});
net.on('session_expired',()=>{
 online={phase:'idle',code:null,side:0,locked:[false,false],waiting:false,turnSent:false,pendingAction:null};
 $('online-wait').hidden=true;
 onlineStatus('之前的对局已结束，已重新连接至大厅。');
 refreshSetup();
});
net.on('room_closed',()=>{online={phase:'idle',code:null,side:0,locked:[false,false],waiting:false,turnSent:false,pendingAction:null};onlineStatus('房间已关闭。');$('online-wait').hidden=true;net.forgetSession();refreshSetup();});
net.on('opponent_locked',msg=>{online.locked[msg.side]=true;onlineStatus('对手已锁定阵容。');refreshSetup();});
net.on('locked',()=>{online.locked[online.side]=true;onlineStatus('已锁定，等待对手…');refreshSetup();});
net.on('rematch',()=>{
 online.phase='select';
 online.locked=[false,false];
 online.rematchRequested=false;
 modeTeams.online=[emptyTeam(),emptyTeam()];
 teams=modeTeams.online;
 onlineStatus('双方同意再战！请重新选择阵容并锁定。');
 editSide=online.side;
 editSlot=0;
 battle=null;
 busy=false;
 paused=false;
 setView('setup');
 refreshSetup();
});
net.on('rematch_ready',()=>{
 onlineStatus('对手想再来一局…点“再来一局”接受。');
 if(mode==='online'&&view==='results'&&!online.rematchRequested){
  $('again').textContent='对手已就绪 · 再来一局 ↗';
 }
});
net.on('opponent_reconnected',()=>{onlineStatus('对手已重新连接。');});
net.on('opponent_left',msg=>{if(mode==='online'&&view==='combat'){togglePause(true);$('preview').textContent=(msg.graceMs?'对手掉线，'+Math.round(msg.graceMs/1000)+' 秒内可重连恢复；':'对手已离开。')+'超时未归则判对手负。';}else onlineStatus('对手离开了房间。');});
net.on('start',msg=>{online.phase='battle';startOnlineBattle(msg);});
net.on('action_ack',msg=>{
 online.turnSent=false;busy=false;
 const slot=msg.slot??online.pendingAction?.slot??selectedSkill;
 const target=msg.target!==undefined?msg.target:(online.pendingAction?.target??selectedTarget);
 online.pendingAction=null;
 if(mode==='online'&&view==='combat')perform(slot,target,msg.origin??undefined,true,msg);
});
net.on('opponent_action',msg=>{if(mode==='online'&&view==='combat'){if(Number.isInteger(msg.move))battle.move(msg.move);perform(msg.slot,msg.target,msg.origin??undefined,true,msg);}});
net.on('result',msg=>{
 if(mode==='online'){
  online.phase='finished';
  if(view==='combat'&&battle&&battle.winner===null){
   battle.winner=msg.winner;
   battle.active=null;
   finish();
  }
 }
});
net.on('desync',()=>{onlineStatus('');if(mode==='online'&&view==='combat'){togglePause(true);$('preview').textContent='状态校验不一致，已暂停。若反复出现请刷新重连。';}});
net.on('retry_scheduled',msg=>{onlineStatus('连接断开，'+(msg.ms/1000).toFixed(1)+' 秒后自动重连…');});
net.on('room_state',msg=>{
 online.code=msg.code;online.side=msg.side;
 if(msg.phase==='battle'){online.phase='battle';startOnlineBattle(msg,true);}
 else if(msg.phase==='select'){online.phase='select';online.locked=msg.locked||[false,false];onlineStatus('已恢复到选人阶段。');refreshSetup();}
 else if(msg.phase==='finished'&&msg.winner!=null){online.phase='finished';onlineStatus('对局已结束（服务器判定）。');}
 else{online.phase='select';onlineStatus('房间已恢复。');refreshSetup();}
});
net.on('disconnect',({wasInRoom})=>{if(mode==='online'&&wasInRoom)onlineStatus('连接已断开，正在自动重连…');});
function validateRun(x){return x&&x.v===2&&['battle','camp'].includes(x.phase)&&Number.isInteger(x.index)&&x.index>=0&&x.index<5&&Number.isInteger(x.difficulty)&&x.difficulty>=0&&x.difficulty<=3&&Array.isArray(x.party)&&x.party.length===4&&new Set(x.party.map(s=>s.id)).size===4&&new Set(x.party.map(s=>s.cell)).size===4&&x.party.every(s=>TURN_BY_ID.has(s.id)&&Number.isInteger(s.cell)&&s.cell>=0&&s.cell<4&&(s.hp==null||Number.isFinite(s.hp)&&s.hp>0&&s.hp<=1))&&x.boons&&Object.entries(x.boons).every(([key,n])=>AbstractTactics.REWARDS.some(r=>r.id===key)&&Number.isInteger(n)&&n>=0&&n<=4);}
function migrateRun(x){
 if(!x||![1,2].includes(x.v))return null;
 const validTeam=(team,max)=>Array.isArray(team)&&team.length===4&&new Set(team.map(s=>s.id)).size===4&&new Set(team.map(s=>s.cell)).size===4&&team.every(s=>TURN_BY_ID.has(s.id)&&Number.isInteger(s.cell)&&s.cell>=0&&s.cell<max&&(s.hp==null||Number.isFinite(s.hp)&&s.hp>0&&s.hp<=1));
 if(!validTeam(x.party,x.v===1?6:4)||!validTeam(x.enemy,x.v===1?6:4))return null;
 if(x.v===1){const convert=team=>{const occupied=new Set(),out=team.map(s=>({...s})),pending=[];for(const s of out){const row=Math.floor(s.cell/3),lane=s.cell%3;if(lane<2){s.cell=row*2+lane;occupied.add(s.cell);}else pending.push({s,row});}for(const {s,row} of pending){const dest=[row*2,row*2+1,0,1,2,3].find(n=>!occupied.has(n));s.cell=dest;occupied.add(dest);}return out;};x={...x,v:2,party:convert(x.party),enemy:convert(x.enemy)};}
 return validateRun(x)?x:null;
}
function readRun(){try{return migrateRun(JSON.parse(localStorage.getItem(saveKey)));}catch{return null;}}
function saveRun(){if(!run)return;try{localStorage.setItem(saveKey,JSON.stringify(run));}catch{message('当前浏览器无法保存远征；本次仍可继续游玩。');}updateResume();}
function clearRun(){try{localStorage.removeItem(saveKey);}catch{}updateResume();}
function updateResume(){$('resume-run').hidden=!readRun();}
function newRun(){return {v:2,index:0,phase:'battle',party:teams[0].map(s=>({...s})),enemy:randomTeam(),seed:Math.floor(Math.random()*0xffffffff),boons:{},difficulty:+$('difficulty').value,stageChoice:$('stage-select').value};}
async function start(isResume=false){
 if(loading)return;const required=mode==='run'?[isResume&&run?run.party:teams[0]]:teams;if(!required.every(completeTeam)){message(mode==='run'?'请先选择四名不同角色组成远征小队。':'请先为双方各选择四名不同角色。');refreshSetup();return;}setupFormation.cancel();campFormation.cancel();loading=true;busy=true;const serial=++ticket;clearTimeout(timer);$('setup').inert=true;$('start').disabled=true;$('again').disabled=true;message('小队与技能素材载入中…');
 try{
  if(mode==='run'&&!isResume)run=newRun();if(mode!=='run')run=null;
  const choice=run?.stageChoice||$('stage-select').value;stage=STAGES.find(s=>s.id===choice)||STAGES[Math.floor(Math.random()*STAGES.length)];
  const matchTeams=run?[run.party,run.enemy]:teams;const options={difficulty:run?.difficulty??+$('difficulty').value,seed:run?.seed??Math.floor(Math.random()*0xffffffff),boons:run?.boons||{},enemyScale:run?1+run.index*.07:1};
  const candidate=new AbstractTactics.Battle(TURN_ROSTER,matchTeams,options);const [image]=await Promise.all([art.image(stage.file),art.battle(candidate.units)]);if(serial!==ticket)return;
  battle=candidate;campFormation.background=image;renderer.setBattle(battle,image);renderer.paused=false;renderer.speed=speed;paused=false;busy=false;automatic=false;selectedSkill=0;selectedTarget=null;planCache=null;$('pause').textContent='暂停';$('auto').textContent='自动 关';$('auto').setAttribute('aria-pressed','false');$('auto').disabled=mode==='local';$('paused-overlay').hidden=true;$('action-banner').textContent='';setView('combat');message('');if(run){run.phase='battle';saveRun();}togglePause(document.hidden||!focused);renderCombat();pump();
 }catch(e){if(serial!==ticket)return;message(e.message+'，请点击出击重试。');if(view==='results')$('result-description').textContent=e.message+'，请重试。';busy=false;}
 finally{if(serial===ticket){loading=false;$('setup').inert=false;$('start').disabled=false;$('again').disabled=false;}}
}
$('start').onclick=()=>{if(mode==='online')return;start();};
/* 在线开局：以服务器下发的 seed 与双方队伍构造确定性对局；replay 时先重放 actionLog。 */
async function startOnlineBattle(msg,isReplay){
 if(loading)return;loading=true;busy=true;const serial=++ticket;clearTimeout(timer);$('setup').inert=true;$('start').disabled=true;$('again').disabled=true;message(isReplay?'重连中，正在恢复战局…':'对手已就绪，载入战斗素材…');
 try{
  run=null;stage=STAGES[Math.floor(Math.random()*STAGES.length)];
  const options={difficulty:1,seed:msg.seed>>>0};
  const candidate=new AbstractTactics.Battle(TURN_ROSTER,msg.teams,options);
  if(isReplay&&Array.isArray(msg.actions)){for(const a of msg.actions){if(Number.isInteger(a.move))candidate.move(a.move);candidate.act(a.slot,a.target,a.origin??undefined);}}
  if(msg.active!=null)candidate.active=msg.active;
  if(Array.isArray(msg.queue))candidate.queue=[...msg.queue];
  if(msg.round!=null)candidate.round=msg.round;
  const [image]=await Promise.all([art.image(stage.file),art.battle(candidate.units)]);if(serial!==ticket)return;
  battle=candidate;campFormation.background=image;renderer.setBattle(battle,image,online.side,online.code);renderer.paused=false;renderer.speed=speed;paused=false;busy=false;automatic=false;online.turnSent=false;online.pendingAction=null;lastMoveCell=null;selectedSkill=0;selectedTarget=null;planCache=null;$('pause').textContent='暂停';$('auto').textContent='自动 关';$('auto').setAttribute('aria-pressed','false');$('auto').disabled=true;$('paused-overlay').hidden=true;$('action-banner').textContent='';setView('combat');message('');togglePause(document.hidden||!focused);renderCombat();
  if(battle.winner!==null)finish();else pump();
  if(isReplay)onlineStatus('已恢复战局。');
 }catch(e){if(serial!==ticket)return;message((e.message||'联机开局失败')+'。');onlineStatus('联机开局失败，请重试或刷新页面。');busy=false;}
 finally{if(serial===ticket){loading=false;$('setup').inert=false;$('start').disabled=false;$('again').disabled=false;}}
}
$('resume-run').onclick=()=>{const saved=readRun();if(!saved)return;run=saved;mode='run';teams=modeTeams.run;teams[0]=run.party.map(s=>({id:s.id,cell:s.cell}));if(run.phase==='camp'){showCamp();setView('results');}else start(true);};
function playerCanAct(){if(!battle||battle.winner!==null||busy||paused||view!=='combat')return false;const u=battle.unit(battle.active);if(mode==='online')return !!u&&u.side===online.side&&!online.turnSent;return !!u&&!automatic&&(mode==='local'||u.side===0);}
function currentPlan(){if(!battle)return null;const u=battle.unit(battle.active);if(!u)return null;if(planCache?.turn!==battle.turn)planCache={turn:battle.turn,plan:battle.plan(u.uid)};return planCache.plan;}
function renderCombat(){
 if(!battle)return;const u=battle.unit(battle.active),manual=playerCanAct();$('battle-heading').textContent=(run?'远征 '+(run.index+1)+' / 5 · ':mode==='local'?'同屏轮流 · ':mode==='online'?'在线对战 · 房号 '+(online.code||'')+' · ':'自由对战 · ')+(stage?.name||'');const roomTag=$('battle-room-tag');if(roomTag){roomTag.hidden=mode!=='online'||!online.code;if(mode==='online'&&online.code)$('battle-room-code').textContent=online.code;}$('initiative').innerHTML=(u?[u.uid,...battle.queue]:battle.queue).map((id,i)=>{const t=battle.unit(id);if(t.hp<=0)return '';return `<span class="${(mode==='online'?t.side!==online.side:t.side)?'enemy':''} ${i===0?'current':''}">${i===0?'▶ ':''}${h(t.data.name)}${t.broken?' · 破':''}</span>`;}).join('');
 $('turn-state').textContent=busy?'招式演出中':paused?'已暂停':u?(mode==='online'?(online.turnSent?'发送指令中':u.side===online.side?'我方行动':'对手行动'):u.side?(mode==='local'?'2P 指挥':'CPU 行动'):(mode==='local'?'1P 指挥':'我方行动')):'战斗结束';$('active-name').textContent=u?.data.name||'本场结算';$('active-energy').textContent=u?'能量 '+u.energy+' / 100':'';$('turn-advice').textContent=u?u.data.role+' · 生命 '+Math.ceil(u.hp)+' / '+u.maxHp:'';
 if(!u){$('command-skills').innerHTML='';$('target-list').innerHTML='';$('execute').disabled=true;renderLog();return;}
 if(selectedSkill!=='guard'&&!battle.canUse(u,selectedSkill))selectedSkill=0;
 $('command-skills').innerHTML=u.data.skills.map((s,i)=>`<button class="command ${i===selectedSkill?'active':''} ${i===3?'ultimate':''}" data-skill="${i}" ${!manual||!battle.canUse(u,i)?'disabled':''}><b>${h(s.name)}</b><p>${h(s.desc)}</p><small>${i===0?'免费 · 回能 24':battle.cost(u,s)+' 能量'}</small></button>`).join('');$('command-skills').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedSkill=+b.dataset.skill;selectedTarget=null;moving=false;online.lastError=null;renderCombat();});
 $('guard').disabled=!manual;$('guard').classList.toggle('active',selectedSkill==='guard');$('move').disabled=!manual||u.moved;$('move').textContent=u.moved?'已换位':'换位';$('move-cells').hidden=!moving||!manual;
 if(moving&&manual){$('move-cells').innerHTML=Array.from({length:4},(_,cell)=>{const same=battle.living(u.side).find(t=>t.cell===cell),distance=Math.abs(cell%2-u.cell%2)+Math.abs(Math.floor(cell/2)-Math.floor(u.cell/2));return `<button data-cell="${cell}" ${distance!==1?'disabled':''}>${cell<2?'前':'后'}${cell%2+1} · ${same?h(same.data.name):'空位'}</button>`;}).join('');$('move-cells').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(battle.move(+b.dataset.cell)){if(mode==='online')lastMoveCell=+b.dataset.cell;moving=false;online.lastError=null;planCache=null;renderCombat();}});}
 let targets=selectedSkill==='guard'?[u]:battle.targets(u,u.data.skills[selectedSkill]);if(!targets.some(t=>t.uid===selectedTarget))selectedTarget=targets[0]?.uid??null;renderer.targets=manual?targets.map(t=>t.uid):[];renderer.target=manual?selectedTarget:null;
 $('target-list').innerHTML=targets.map(t=>`<button class="target ${(mode==='online'?t.side!==online.side:t.side)?'enemy':''} ${t.uid===selectedTarget?'selected':''}" data-target="${t.uid}" ${!manual?'disabled':''}><b>${h(t.data.name)}${t.broken?' · 击破':''}</b><div class="bar"><i style="width:${t.hp/t.maxHp*100}%"></i></div><small>${Math.ceil(t.hp)}/${t.maxHp}${t.shield?' · 盾 '+Math.ceil(t.shield):''} · ${t.cell<2?'前':'后'}${t.cell%2+1}</small><small class="weak">${t.breakSafe?'击破保护':`破绽 ${t.guard}/${t.maxGuard} · 弱 `+t.data.weak.join(' / ')}</small></button>`).join('');$('target-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedTarget=+b.dataset.target;online.lastError=null;renderCombat();});
 $('execute').disabled=!manual||selectedTarget==null;$('execute').textContent=selectedSkill==='guard'?'防御蓄能 →':'执行 →';$('preview').textContent=online.turnSent?'指令发送中…':online.lastError?('【提示】'+online.lastError):manual?(selectedSkill==='guard'?'直到下次行动结束前，受到伤害降低 45%；恢复 1 格破绽。':(battle.unit(selectedTarget)?.data.name||'')+' · '+battle.preview(u,selectedSkill,battle.unit(selectedTarget))):busy?'角色正在出招…':paused?'点击继续恢复战斗。':mode==='online'?'等待对手行动…':(()=>{const p=currentPlan();return p?'对手准备：'+(p.slot==='guard'?'防御':u.data.skills[p.slot].name):'';})();
 $('order-hint').textContent=manual?(selectedSkill==='guard'?'减少受伤并回复能量。':u.data.skills[selectedSkill].desc):automatic?'自动指挥中，可随时切回手动。':mode==='online'?'对手回合：指令经服务器校验后同步执行。':'等待本次行动完成。';renderLog();
}
function renderLog(){const events=battle?.events||[];const lines=events.map(e=>{const u=battle.unit(e.uid);if(e.type==='round')return '第 '+e.number+' 轮';if(e.type==='action')return (u?.data.name||'')+'：'+e.name;if(e.type==='break')return (u?.data.name||'')+' 被击破，下一次行动跳过';if(e.type==='ko')return (u?.data.name||'')+' 退场';if(e.type==='damage')return (u?.data.name||'')+' −'+e.amount+(e.absorbed?'（护盾吸收 '+e.absorbed+'）':'');if(e.type==='heal')return (u?.data.name||'')+' +'+e.amount;return null;}).filter(Boolean).slice(-45);$('log').innerHTML=lines.map(t=>'<li>'+h(t)+'</li>').join('');}
function pump(){clearTimeout(timer);if(!battle||busy||paused||document.hidden||view!=='combat'||battle.winner!==null)return;const u=battle.unit(battle.active);if(!u)return;if(mode==='online'){if(u.side!==online.side&&battle.winner===null){/* 等待对手通过网络出招 */}return;}if(automatic||(mode!=='local'&&u.side===1)){const serial=ticket,turn=battle.turn;timer=setTimeout(()=>{if(serial===ticket&&battle?.turn===turn&&!paused&&!busy&&view==='combat'){const p=currentPlan();perform(p.slot,p.target);}},650/speed);}}
function stateCopy(b){return {...b,queue:[...b.queue],events:[...b.events],units:b.units.map(u=>({...u,status:{...u.status}}))};}
async function perform(slot,target,forcedOrigin,fromNetwork,syncMsg){
 if(!battle||(!fromNetwork&&busy)||paused||view!=='combat')return;const serial=ticket,b=battle,before=stateCopy(b);
 if(mode==='online'&&!fromNetwork){
  const u=battle.unit(battle.active);
  if(!u||u.side!==online.side)return;          // 只能替本侧行动
  if(online.turnSent)return;
  online.turnSent=true;moving=false;clearTimeout(timer);
  const move=lastMoveCell;lastMoveCell=null;
  online.pendingAction={slot,target};
  net.act(slot,target,move);$('preview').textContent='指令发送中…';renderCombat();return;
 }
 busy=true;moving=false;clearTimeout(timer);
 try{const result=b.act(slot,target,forcedOrigin);if(!result.ok){busy=false;online.turnSent=false;online.pendingAction=null;$('preview').textContent=result.reason;renderCombat();return;}await art.skill(result.skill,result.origin);if(serial!==ticket||b!==battle)return;
  $('action-banner').textContent=result.guard?'防御蓄能':(result.origin!=null?'模仿 · ':'')+result.skill.name;renderCombat();const finished=await renderer.play(result,before.units);if(!finished||serial!==ticket||b!==battle)return;
  busy=false;online.turnSent=false;online.pendingAction=null;lastMoveCell=null;$('action-banner').textContent='';selectedSkill=0;selectedTarget=null;planCache=null;
  if(mode==='online'&&syncMsg){
   if(syncMsg.active!=null)b.active=syncMsg.active;
   if(Array.isArray(syncMsg.queue))b.queue=[...syncMsg.queue];
   if(syncMsg.round!=null)b.round=syncMsg.round;
  }
  if(b.winner!==null)finish();else{renderCombat();pump();}
 }catch(e){if(serial===ticket&&b===battle){Object.assign(b,before);busy=false;online.turnSent=false;online.pendingAction=null;lastMoveCell=null;automatic=false;$('auto').textContent='自动 关';$('auto').setAttribute('aria-pressed','false');$('action-banner').textContent='';togglePause(true);$('preview').textContent=e.message+'。指令已撤回，点击“继续”后重试。';}}
}
$('board').onclick=e=>{
 if(!playerCanAct())return;const rect=$('board').getBoundingClientRect();if(!rect.width||!rect.height)return;
 const u=battle.unit(battle.active),targets=selectedSkill==='guard'?[u]:battle.targets(u,u.data.skills[selectedSkill]);
 const id=renderer.hitTest((e.clientX-rect.left)*$('board').width/rect.width,(e.clientY-rect.top)*$('board').height/rect.height,targets.map(t=>t.uid));
 if(id!=null){selectedTarget=id;moving=false;renderCombat();}
};
$('execute').onclick=()=>{if(playerCanAct())perform(selectedSkill,selectedTarget);};$('guard').onclick=()=>{if(playerCanAct()){selectedSkill='guard';moving=false;renderCombat();}};$('move').onclick=()=>{if(playerCanAct()){moving=!moving;renderCombat();}};
function togglePause(value=!paused){paused=value;renderer.paused=paused;$('pause').textContent=paused?'继续':'暂停';$('paused-overlay').hidden=!paused;clearTimeout(timer);syncMusic();if(battle){renderCombat();if(!paused)pump();}}
$('pause').onclick=()=>togglePause();$('resume-battle').onclick=()=>{if(view==='combat'&&battle&&paused)togglePause(false);};$('auto').onclick=()=>{if(mode==='local'||mode==='online')return;automatic=!automatic;$('auto').textContent=automatic?'自动 开':'自动 关';$('auto').setAttribute('aria-pressed',String(automatic));renderCombat();pump();};$('speed').onclick=()=>{speed=speed===1?2:speed===2?3:1;renderer.speed=speed;$('speed').textContent=speed+'×';pump();};
function back(){ticket++;art.cancelBattle();clearTimeout(timer);renderer.cancel();battle=null;busy=false;paused=false;loading=false;planCache=null;online.turnSent=false;online.pendingAction=null;$('setup').inert=false;$('start').disabled=false;setView('setup');refreshSetup();updateResume();}
$('return-setup').onclick=()=>{if(mode==='online'&&view==='combat'&&!onlineLeaving())return;back();};$('result-back').onclick=()=>{if(mode==='online'&&!onlineLeaving())return;back();};
function finish(){
 renderer.targets=[];renderer.target=null;setView('results');const won=battle.winner===0,draw=battle.winner===-1;const mySide=mode==='online'?online.side:0;
 if(mode==='online'){online.phase='finished';online.rematchRequested=false;}
 $('result-kicker').textContent=run?'EXPEDITION · '+(run.index+1)+' / 5':mode==='online'?'ONLINE BATTLE':'BATTLE COMPLETE';$('result-title').textContent=draw?'势均力敌':mode==='local'?(won?'1P 小队获胜':'2P 小队获胜'):mode==='online'?(battle.winner===mySide?'联机对战获胜！':'本次挑战结束'):won?'小队获胜！':'本次挑战结束';$('result-description').textContent='经历 '+battle.round+' 轮 · '+(draw?'双方剩余生命比例相同。':battle.winner===mySide?'阵容和出招时机，缺一不可。':'试试调整前排保护，集中攻击弱点。');
 const squad=battle.units.filter(u=>u.side===(mode==='online'?mySide:mode==='local'&&battle.winner===1?1:0));$('result-stats').innerHTML=squad.map(u=>`<div class="result-stat"><b>${h(u.data.name)}</b><span>伤害 ${Math.round(u.damage)}</span><span>治疗 ${Math.round(u.healing)}</span><span>击倒 ${u.kills} · ${u.hp>0?'存活':'退场'}</span></div>`).join('');$('reward-zone').hidden=true;$('camp').hidden=true;$('again').hidden=false;$('again').disabled=false;$('again').textContent=mode==='online'?'再来一局 ↗':'再来一场 ↗';
 if(run){if(won&&run.index<4){$('reward-zone').hidden=false;$('again').hidden=true;const pool=[...AbstractTactics.REWARDS].sort(()=>Math.random()-.5).slice(0,3);$('rewards').innerHTML=pool.map(r=>`<button class="reward" data-reward="${r.id}"><b>${h(r.name)}</b><p>${h(r.desc)}</p></button>`).join('');$('rewards').querySelectorAll('button').forEach(button=>button.onclick=()=>chooseReward(button.dataset.reward));}
  else{if(won){$('result-title').textContent='五战全胜！';$('result-description').textContent='你的四人小队完成了本次远征。换一组角色，还能打出新的配合。';}clearRun();run=null;$('again').textContent='重新出发 ↗';}}
}
function chooseReward(id){if(!run||!battle||battle.winner!==0||run.phase==='camp'||!AbstractTactics.REWARDS.some(r=>r.id===id))return;run.boons[id]=(run.boons[id]||0)+1;run.party=battle.units.filter(u=>u.side===0).map(u=>({id:u.data.id,cell:u.cell,hp:u.hp<=0?.35:Math.min(1,u.hp/u.maxHp+.24+.10*(run.boons.care||0)+(id==='vital'?.20:0))}));run.index++;run.enemy=randomTeam();run.seed=Math.floor(Math.random()*0xffffffff);run.phase='camp';saveRun();showCamp();}
function showCamp(){campCell=null;campFormation.cancel();$('reward-zone').hidden=true;$('camp').hidden=false;$('again').hidden=false;$('again').disabled=false;$('again').textContent='进入第 '+(run.index+1)+' 场 ↗';$('result-title').textContent='营地补给';$('result-description').textContent='强化已获得。点两个位置交换站位，然后继续远征。';$('result-kicker').textContent='EXPEDITION CAMP';$('result-stats').innerHTML='';$('boon-list').textContent=Object.entries(run.boons).map(([id,n])=>AbstractTactics.REWARDS.find(r=>r.id===id).name+' ×'+n).join(' · ');renderCamp();}
function renderCamp(){campFormation.update();}
$('again').onclick=()=>{
 if(mode==='online'){
  online.phase='finished';
  online.rematchRequested=true;
  net.rematch();
  $('again').disabled=true;
  $('again').textContent='等待对手接受…';
  onlineStatus('已申请再战，等待对手确认…');
  return;
 }
 if(run&&run.phase==='camp'){run.phase='battle';saveRun();start(true);}else start();
};
document.addEventListener('keydown',e=>{if(e.target.matches?.('input,select,textarea')||$('help').open)return;if(view==='combat'&&e.key==='Escape'){e.preventDefault();togglePause();}if(!playerCanAct())return;if(/^[1-4]$/.test(e.key)){const slot=+e.key-1;if(battle.canUse(battle.unit(battle.active),slot)){selectedSkill=slot;selectedTarget=null;renderCombat();e.preventDefault();}}else if(e.key==='Enter'){e.preventDefault();perform(selectedSkill,selectedTarget);}});
function animatePreviews(now){previewTime+=Math.min(.05,(now-previewLast)/1000);previewLast=now;try{if(!document.hidden){if(view==='setup'){if(selectedCharacter())art.preview($('detail-art'),selectedCharacter(),previewTime);setupFormation.draw(previewTime);}else if(view==='results'&&run?.phase==='camp')campFormation.draw(previewTime);}}finally{requestAnimationFrame(animatePreviews);}}
renderRoster();updateResume();loadFormationScene();requestAnimationFrame(animatePreviews);
})();
