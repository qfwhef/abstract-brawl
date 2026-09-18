const $=id=>document.getElementById(id);
let selected=[ROSTER.findIndex(c=>c.name==='奶龙'),ROSTER.findIndex(c=>c.name==='电棍'),ROSTER.findIndex(c=>c.name==='贝拉'),ROSTER.findIndex(c=>c.name==='七海')],side=0,mode='cpu',difficulty=1,currentGame=null,sound=true;
const images=new Map(),animationSheets=new Map();let ready=false;
const stagePicker=new StagePicker();let currentStage=null,starting=false,musicEnabled=true,musicStarted=false,startTicket=0;
let musicWindowFocused=document.hasFocus?.()??true;
const assetURL=url=>window.EMBEDDED_IMAGES?.[url]||url;
function sprite(c){return c.file;}
const mobileQuery=window.matchMedia('(pointer:coarse)');
const isMobile=()=>mobileQuery.matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&navigator.platform==='MacIntel');
const modeNames={cpu:'人机 1V1',local:'双人 1V1',training:'训练场','team-cpu':'单人 2V2','team-coop':'双人合作 2V2','team-versus':'双人对抗 2V2',online:'在线 1V1'};
const teamMode=()=>mode.startsWith('team-');
const activeSlots=()=>teamMode()?[0,1,2,3]:[0,1];
const activeSelected=()=>activeSlots().map(i=>selected[i]);
const slotController=i=>mode==='online'?(i===(onlineState.mySide??0)?0:null):i===0?0:i===1&&['local','team-versus'].includes(mode)?1:i===2&&mode==='team-coop'?1:null;
function slotLabel(i){
 if(mode==='online'){
  const isMe=i===(onlineState.mySide??0);
  return (i===0?'1P':'2P')+(isMe?' (你)':' (对手)');
 }
 const player=slotController(i);
 return teamMode()?(i%2===0?'A':'B')+(i<2?'1':'2')+' · '+(player===null?'CPU':(player+1)+'P'):player===null?(mode==='training'?'训练对手':'CPU'):(player+1)+'P';
}
function changeMode(next){
 if(starting)return;
 if(isMobile()&&['local','team-coop','team-versus'].includes(next))return;
 const prevMode=mode;
 mode=next;
 if(prevMode==='online'&&mode!=='online'){
  if(onlineState.inRoom){netClient?.leave();onlineState.inRoom=false;}
  $('online-panel').hidden=true;
  document.querySelector('.difficulty').style.display='';
 }
 if(mode==='online'){
  $('online-panel').hidden=false;
  document.querySelector('.difficulty').style.display='none';
  if(!onlineState.inRoom){
   $('online-lobby').hidden=false;
   $('online-room-view').hidden=true;
   initNetClient().then(()=>refreshRoomList());
  }else{
   $('online-lobby').hidden=true;
   $('online-room-view').hidden=false;
  }
  side=onlineState.mySide;
 }else{
  $('online-panel').hidden=true;
  document.querySelector('.difficulty').style.display='';
  if(!activeSlots().includes(side))side=0;
 }
 refresh();
}
const animatedNames=ROSTER.filter(c=>window.ANIMATIONS?.[c.id]).map(c=>c.name);
const audioFX={ctx:null,muted:false,say(text,pitch=1){if(this.muted||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;try{const u=new SpeechSynthesisUtterance(text);u.lang='zh-CN';u.rate=.9;u.pitch=pitch;u.volume=.7;const voice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('zh'));if(voice)u.voice=voice;speechSynthesis.cancel();speechSynthesis.speak(u);}catch{}},unlock(){try{if(!this.ctx)this.ctx=new(window.AudioContext||window.webkitAudioContext)();this.ctx.resume();}catch{}},tone(freq=250,duration=.1,type='square',volume=.06){if(this.muted||!this.ctx)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(35,freq/3),t+duration);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g).connect(this.ctx.destination);o.start(t);o.stop(t+duration);},play(kind){const cfg={light:[380,.07],heavy:[140,.18],hit:[180,.1],block:[680,.055],super:[780,.55],select:[650,.06],jump:[260,.12],ko:[105,.65],cast:[470,.17]};this.tone(...(cfg[kind]||cfg.hit));}};
const music=new FighterMusic({getContext:()=>audioFX.ctx,volume:.22});
music.play('select');
function syncMusic(){music.setMuted(!musicEnabled);music.setPaused(!musicWindowFocused||document.hidden||!!currentGame?.paused);music.play(currentGame&&currentStage?currentStage.music:'select');updateMusicLabel();}
function updateMusicLabel(){$('music').textContent=(musicEnabled?'♫ BGM 开':'♫ BGM 关')+' ▾';const id=currentGame&&currentStage?currentStage.music:'select';const track=FighterMusic.tracks[id];$('now-playing').textContent=!musicEnabled?'BGM 已关闭':!musicStarted?'点击任意按钮，开启选角 BGM':(currentGame?.paused?'已暂停 · ':'正在播放 · ')+(track?.title||track?.name||id);document.querySelectorAll('[data-bgm-toggle]').forEach(b=>{b.textContent=musicEnabled?'♫ BGM 开':'♫ BGM 关';b.setAttribute('aria-pressed',String(musicEnabled));});}
function unlockMusic(){audioFX.unlock();if(!musicEnabled)return;music.unlock().then(()=>{musicStarted=audioFX.ctx?.state==='running';syncMusic();}).catch(()=>{});}
function toggleMusic(){musicEnabled=!musicEnabled;syncMusic();if(musicEnabled)unlockMusic();}
document.querySelectorAll('[data-bgm-toggle]').forEach(b=>b.onclick=toggleMusic);
document.addEventListener('pointerdown',e=>{const settings=$('music-settings');if(settings.open&&!settings.contains(e.target))settings.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('music-settings').open){$('music-settings').open=false;$('music').focus();e.stopImmediatePropagation();e.preventDefault();}},{capture:true});
$('music-volume').oninput=e=>{const value=+e.target.value;music.setVolume(value/100*.63);$('music-volume-value').textContent=value+'%';};
document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('[data-bgm-toggle]'))unlockMusic();},{capture:true});
document.addEventListener('keydown',e=>{if(!e.repeat)unlockMusic();},{capture:true});
window.addEventListener('blur',()=>{musicWindowFocused=false;syncMusic();});
window.addEventListener('focus',()=>{musicWindowFocused=true;syncMusic();});
document.addEventListener('visibilitychange',syncMusic);
window.addEventListener('pagehide',()=>music.stop());
window.addEventListener('pageshow',()=>{musicWindowFocused=document.hasFocus?.()??true;syncMusic();});
function renderStages(){
 $('stage-grid').innerHTML='<button class="stage-card stage-random active" data-stage="random" aria-pressed="true"><span class="stage-random-art">?</span><b>随机场景</b></button>'+STAGES.map(s=>`<button class="stage-card" data-stage="${s.id}" aria-pressed="false" title="${s.description}"><img src="${assetURL(s.thumbnail||s.file)}" loading="lazy" alt="${s.name}像素场景"><b>${s.name}</b></button>`).join('');
 $('stage-grid').querySelectorAll('button').forEach(b=>b.onclick=()=>{
  if(mode==='online'&&!onlineState.isHost)return;
  stagePicker.select(b.dataset.stage);
  refreshStage();
  if(mode==='online'&&onlineState.isHost)netClient?.sendFightStage(b.dataset.stage);
  audioFX.play('select');
 });
 refreshStage();
}
function refreshStage(){const selectedStage=STAGES.find(s=>s.id===stagePicker.selected);$('stage-grid').querySelectorAll('button').forEach(b=>{const active=b.dataset.stage===stagePicker.selected;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('stage-choice-status').textContent=selectedStage?'已选 · '+selectedStage.name:'每场随机 · 同场回合保持场景';$('stage-caption').textContent=selectedStage?selectedStage.name:'随机场景 · 开打时揭晓';document.querySelector('.select-stage').style.backgroundImage=`url("${assetURL((selectedStage||STAGES[0]).file)}")`;}
renderStages();
function skillHTML(c){return c.skills.map((s,i)=>`<div class="skill ${s.super?'super':''}" data-skill="${i}"><kbd>${s.key}</kbd><div><b>${s.name}</b><p>${s.mimic?'随机招式':s.damage?((s.count||s.pulses)?(s.count||s.pulses)+' × ':'')+s.damage+' 基础伤害':s.type==='wall'?'可破坏障碍':'持续强化'}${s.mimic?(s.super?' · 100 气':' · 冷却随招式'):s.cd?' · '+s.cd+'s 冷却':s.super?' · 100 气':''}<br>${s.desc}</p></div></div>`).join('');}
function refresh(){
 const slots=activeSlots();
 if(mode==='online'){side=onlineState.mySide;}else if(!slots.includes(side)){side=0;}
 $('selection').classList.toggle('team-selection',teamMode());$('team-options').hidden=!teamMode();
 for(let p=0;p<4;p++){
  const enabled=slots.includes(p),button=$('choose'+(p+1)),canvas=$('portrait'+(p+1));button.hidden=!enabled;canvas.closest('.fighter-preview').hidden=!enabled;if(!enabled)continue;
  const c=ROSTER[selected[p]];canvas.setAttribute('aria-label',slotLabel(p)+' '+c.name+' · 实战待机动画');ensureCharacter(c,true).then(()=>{drawCard(c);trimSheets();}).catch(showAssetError);
  $('name'+(p+1)).textContent=c.name;$('style'+(p+1)).textContent=c.title+' / '+c.style.split(' / ')[0];$('quote'+(p+1)).textContent=c.quote;$('p'+(p+1)+'tag').textContent=slotLabel(p);
  button.textContent=mode==='online'?(p===onlineState.mySide?'你的角色':'对手角色'):(slotLabel(p)+' 选人');
  button.classList.toggle('active',side===p);button.setAttribute('aria-pressed',String(side===p));
  button.disabled=(mode==='online'&&p!==onlineState.mySide);
 }
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode==='team-cpu'?teamMode():b.dataset.mode===mode));
 document.querySelectorAll('[data-team-mode]').forEach(b=>b.classList.toggle('active',b.dataset.teamMode===mode));
 $('team-description').textContent={'team-cpu':'你与 CPU 队友迎战两名 CPU。','team-coop':'1P 与 2P 同队，迎战两名 CPU。','team-versus':'1P 与 2P 各带一名 CPU 队友，分队对抗。'}[mode]||'';
 $('round-rules').textContent=mode==='online'?'在线 1V1 · 两胜制 · 60 秒 / 回合':teamMode()?'四人同时上场 · 队内无伤害 · 全队倒下判负 · 90 秒 / 回合':'两胜制 · 60 秒 / 回合 · 全角色解锁';
 $('roster').querySelectorAll('button').forEach((b,i)=>{
  const chosen=slots.filter(p=>selected[p]===i);
  b.classList.toggle('p1',chosen.some(p=>p%2===0));
  b.classList.toggle('p2',chosen.some(p=>p%2===1));
  b.setAttribute('aria-pressed',String(i===selected[side]));
  const tag=b.querySelector('.slot-tag');tag.hidden=!chosen.length;
  tag.textContent=chosen.map(p=>mode==='online'?(p===0?'1P':'2P'):teamMode()?(p%2===0?'A':'B')+(p<2?'1':'2'):p===0?'1P':mode==='local'?'2P':'CPU').join('/');
 });
 const c=ROSTER[selected[side]];$('skill-owner').textContent=slotLabel(side)+' · '+c.name;$('passive').textContent=c.passive[0]+'：'+c.passive[1];$('skills').innerHTML=skillHTML(c);
 document.querySelector('.difficulty').style.opacity=['local','training','online'].includes(mode)?'.45':'1';
  if(mode==='online'){
   const bothLocked=onlineState.locked[0]&&onlineState.locked[1];
   $('start').disabled=true;$('quick-start').disabled=true;
   if(bothLocked){
    $('start').innerHTML='双方已锁定 · 自动开战中…';
   }else if(onlineState.locked[onlineState.mySide]){
    $('start').innerHTML='已锁定 · 等待对手锁定…';
   }else{
    $('start').innerHTML='请在上方锁定角色 🔒';
   }
  }else{
   $('start').disabled=false;$('quick-start').disabled=false;
   $('start').innerHTML='准备好了，开打！ <span>↗</span>';
  }
}
$('roster').innerHTML=ROSTER.map(c=>`<button class="character" title="${c.name} · ${c.title}" aria-label="选择${c.name}"><canvas width="96" height="96" aria-hidden="true"></canvas><span class="slot-tag" hidden></span><span class="char-name">${c.name}</span></button>`).join('');
$('roster').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>{
 if(mode==='online'&&onlineState.locked[onlineState.mySide])toggleOnlineLock(false);
 selected[side]=i;
 if(mode==='online')netClient?.sendFightSelect(i);
 audioFX.unlock();audioFX.play('select');refresh();
});
for(let i=0;i<4;i++)$('choose'+(i+1)).onclick=()=>{if(starting)return;if(mode==='online'&&i!==onlineState.mySide)return;side=i;refresh();};
$('random').onclick=()=>{
 if(starting)return;
 if(mode==='online'&&onlineState.locked[onlineState.mySide])toggleOnlineLock(false);
 selected[side]=Math.floor(Math.random()*ROSTER.length);
 if(mode==='online')netClient?.sendFightSelect(selected[side]);
 refresh();
};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.mode));document.querySelectorAll('[data-team-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.teamMode));
document.querySelectorAll('[data-difficulty]').forEach(b=>b.onclick=()=>{difficulty=Number(b.dataset.difficulty);document.querySelectorAll('[data-difficulty]').forEach(x=>x.classList.toggle('active',x===b));});
function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('图片加载失败：'+url));im.src=url;});}
function buildHUD(count){
 const card=i=>`<div class="hud-player ${i%2?'second':''}" id="hud-card${i+1}"><div><b id="hud-name${i+1}"></b><span id="score${i+1}"></span></div><div class="health"><span id="hp${i+1}"></span></div><small id="health${i+1}"></small><div class="energy"><span id="mp${i+1}"></span></div></div>`;
 document.querySelector('.hud').classList.toggle('team-hud',count===4);document.querySelector('.hud').innerHTML=`<div class="hud-team">${card(0)}${count===4?card(2):''}</div><div class="timer"><small id="round">ROUND 1</small><b id="timer">60</b></div><div class="hud-team">${card(1)}${count===4?card(3):''}</div>`;
}

/* Online Networking State & Methods */
let netClient=null;
const onlineState={
 inRoom:false,
 isHost:false,
 mySide:0,
 roomCode:'',
 roomTitle:'',
 isPublic:true,
 locked:[false,false],
 playerNames:['玩家','等待加入...']
};

function initNetClient(){
 if(netClient)return netClient.connect();
 netClient=new window.AbstractNet.NetClient();
 try{
  const savedName=localStorage.getItem('abstract-fighter-name');
  if(savedName){netClient.name=savedName;if($('create-player-name'))$('create-player-name').value=savedName;}
 }catch{}
 netClient.on('welcome',()=>{$('online-lobby-status').textContent='';});
 netClient.on('room_list',msg=>renderOnlineRoomList(msg.rooms||[]));
 netClient.on('created',msg=>{
  onlineState.inRoom=true;onlineState.isHost=true;onlineState.mySide=0;
  onlineState.roomCode=msg.code;onlineState.roomTitle=msg.title||'格斗擂台';
  onlineState.isPublic=msg.isPublic!==false;onlineState.locked=[false,false];
  onlineState.playerNames=[netClient.name||'玩家','等待加入...'];
  updateRoomViewUI();
  netClient.sendFightSelect(selected[0]);
  refresh();
 });
 netClient.on('joined',msg=>{
  onlineState.inRoom=true;onlineState.isHost=false;onlineState.mySide=1;
  onlineState.roomCode=msg.code;onlineState.roomTitle=msg.title||'格斗擂台';
  onlineState.isPublic=msg.isPublic!==false;onlineState.locked=[false,false];
  onlineState.playerNames=[msg.hostName||'房主',netClient.name||'玩家'];
  if(msg.fightChars&&msg.fightChars[0]!=null)selected[0]=msg.fightChars[0];
  updateRoomViewUI();
  netClient.sendFightSelect(selected[1]);
  refresh();
 });
 netClient.on('opponent_joined',msg=>{
  onlineState.playerNames[1]=msg.name||'挑战者';
  updateRoomViewUI();
  audioFX.play('select');
  netClient.sendFightSelect(selected[0]);
  refresh();
 });
 netClient.on('fight_opponent_select',msg=>{
  if(msg.side!=null&&Number.isInteger(msg.charId)){selected[msg.side]=msg.charId;refresh();}
 });
 netClient.on('fight_opponent_lock',msg=>{
  if(msg.side!=null){onlineState.locked[msg.side]=!!msg.locked;updateLockBadges();refresh();}
 });
 netClient.on('fight_both_locked',()=>{
  onlineState.locked=[true,true];updateLockBadges();refresh();
 });
 netClient.on('fight_start',msg=>{
  startOnlineBattle(msg);
 });
 netClient.on('fight_remote_input',msg=>{
  if(currentGame)currentGame.applyRemoteInput(msg.side,msg.mask);
 });
 netClient.on('fight_sync',msg=>{
  if(currentGame)currentGame.applySyncSnapshot(msg);
 });
 netClient.on('rematch_ready',msg=>{
  if(msg.side!==onlineState.mySide)showBanner('对手已准备再战','点击「再来一局」即可重开');
 });
 netClient.on('rematch',()=>{
  onlineState.locked=[false,false];updateLockBadges();goBack();refresh();
 });
 netClient.on('opponent_left',()=>{
  if(onlineState.inRoom){
   if(currentGame&&!$('battle').hidden){
    showBanner('对手已退出对决','比赛结束');
    setTimeout(()=>{goBack();updateRoomViewUI();},2000);
   }else{
    onlineState.playerNames[1]='等待加入...';
    onlineState.locked=[false,false];
    updateRoomViewUI();
    refresh();
   }
  }
 });
 netClient.on('room_closed',()=>{
  onlineState.inRoom=false;
  if(!$('battle').hidden)goBack();
  $('online-lobby').hidden=false;
  $('online-room-view').hidden=true;
  refreshRoomList();
 });
 netClient.on('error',msg=>{$('online-lobby-status').textContent=msg.message||'网络错误';});
 return netClient.connect();
}

function refreshRoomList(){
 if(!netClient)return;
 netClient.getRooms('fight');
}

function escapeHTML(str){
 return String(str||'').replace(/[&<>'"]/g,tag=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[tag]||tag));
}

function renderOnlineRoomList(rooms){
 const container=$('room-list-container');
 if(!container)return;
 $('room-count-badge').textContent=rooms.length+' 房间';
 if(rooms.length===0){
  container.innerHTML='<div class="room-empty"><div class="empty-icon">🥊</div><p>暂无公开房间</p><small>在右侧创建房间，或直接输入好友房号加入！</small></div>';
  return;
 }
 container.innerHTML=rooms.map(r=>{
  const isPlaying=r.phase==='battle';
  const isFull=r.full||(r.count>=2);
  let statusClass='waiting';
  let statusText='等待中';
  let canJoin=true;
  let btnText='加入对战 ↗';

  if(isPlaying){
   statusClass='playing';
   statusText='对局进行中';
   canJoin=false;
   btnText='对局进行中';
  }else if(isFull){
   statusClass='full';
   statusText=r.phase==='finished'?'对局结算中':'房间已满';
   canJoin=false;
   btnText=r.phase==='finished'?'对局结算中':'房间已满';
  }

  return `
  <div class="room-item ${canJoin?'':'room-item-disabled'}">
   <div class="room-item-info">
    <div class="room-item-top">
     <span class="room-num">#${r.code}</span>
     <b class="room-name">${escapeHTML(r.title)}</b>
     <span class="room-mode-tag">${r.mode||'1V1'}</span>
     <span class="room-status-tag ${statusClass}">${statusText}</span>
    </div>
    <div class="room-item-sub">
     <span>房主：${escapeHTML(r.host)}</span>
     <span class="room-count">👥 ${r.count}/2</span>
    </div>
   </div>
   <button class="btn-room-join ${canJoin?'':'disabled'}" type="button" data-join-code="${r.code}" ${canJoin?'':'disabled'}>${btnText}</button>
  </div>
 `;}).join('');
 container.querySelectorAll('[data-join-code]:not([disabled])').forEach(btn=>{
  btn.onclick=()=>joinRoomByCode(btn.dataset.joinCode);
 });
}

function updateRoomViewUI(){
 $('online-lobby').hidden=true;
 $('online-room-view').hidden=false;
 $('active-title').textContent=onlineState.roomTitle;
 $('active-code').textContent=onlineState.roomCode;
 $('active-privacy-badge').textContent=onlineState.isPublic?'公开':'私密';
 $('name-player-0').textContent=onlineState.playerNames[0];
 $('name-player-1').textContent=onlineState.playerNames[1];
 updateLockBadges();
}

function updateLockBadges(){
 for(let p=0;p<2;p++){
  const badge=$('lock-badge-'+p);
  const locked=onlineState.locked[p];
  badge.textContent=locked?'已锁定 ✓':(p===1&&onlineState.playerNames[1]==='等待加入...'?'等待加入':'选人中...');
  badge.classList.toggle('locked',locked);
 }
 const myLocked=onlineState.locked[onlineState.mySide];
 const oppLocked=onlineState.locked[1-onlineState.mySide];
 const btnLock=$('btn-lock-char');
 if(btnLock){
  btnLock.textContent=myLocked?'已锁定 ✓ (点击取消)':'锁定角色 🔒';
  btnLock.classList.toggle('locked',myLocked);
 }
 const tip=$('online-guide-tip');
 if(tip){
  if(myLocked&&oppLocked){
   tip.textContent='双方已锁定！正在自动开启对决…';
  }else if(myLocked){
   tip.textContent='你已锁定角色，等待对手锁定后自动开战…';
  }else if(oppLocked){
   tip.textContent='对手已锁定角色，请点击「锁定角色」即可自动开战！';
  }else{
   tip.textContent='请选择角色并点击锁定；双方均锁定后将自动开启对决！';
  }
 }
}

function toggleOnlineLock(force){
 if(!onlineState.inRoom)return;
 const next=force!=null?force:!onlineState.locked[onlineState.mySide];
 onlineState.locked[onlineState.mySide]=next;
 updateLockBadges();
 const stage=onlineState.isHost?stagePicker.choose().id:null;
 netClient?.sendFightLock(next,stage);
 refresh();
}

function joinRoomByCode(code){
 const trimmed=String(code||'').trim();
 if(!trimmed||trimmed.length!==6){
  $('online-lobby-status').textContent='请输入 6 位有效数字房号';
  return;
 }
 const name=($('create-player-name')?.value.trim())||'玩家';
 try{localStorage.setItem('abstract-fighter-name',name);}catch{}
 initNetClient().then(()=>{
  netClient.setName(name);
  netClient.join(trimmed);
 }).catch(e=>{$('online-lobby-status').textContent=e.message||'连接失败';});
}

$('btn-refresh-rooms').onclick=()=>refreshRoomList();
$('btn-create-room').onclick=()=>{
 const name=($('create-player-name')?.value.trim())||'玩家';
 const title=($('create-room-title')?.value.trim())||'格斗擂台';
 const isPublic=document.querySelector('input[name="room-privacy"]:checked')?.value==='public';
 try{localStorage.setItem('abstract-fighter-name',name);}catch{}
 initNetClient().then(()=>{
  netClient.setName(name);
  netClient.createFightRoom({name,title,isPublic,mode:'1v1'});
 }).catch(e=>{$('online-lobby-status').textContent=e.message||'创建房间失败';});
};
$('btn-join-code').onclick=()=>joinRoomByCode($('input-join-code')?.value);
$('input-join-code').onkeydown=e=>{if(e.key==='Enter')joinRoomByCode($('input-join-code')?.value);};
$('btn-copy-code').onclick=()=>{
 if(!onlineState.roomCode)return;
 try{
  navigator.clipboard.writeText(onlineState.roomCode);
  $('btn-copy-code').textContent='已复制!';
  setTimeout(()=>{$('btn-copy-code').textContent='📋 复制';},1500);
 }catch{$('btn-copy-code').textContent='复制失败';}
};
$('btn-leave-room').onclick=()=>{
 if(!onlineState.inRoom)return;
 netClient?.leave();
 onlineState.inRoom=false;
 $('online-lobby').hidden=false;
 $('online-room-view').hidden=true;
 refreshRoomList();
 refresh();
};
$('btn-lock-char').onclick=()=>toggleOnlineLock();

async function startOnlineBattle(msg){
 if(starting)return;starting=true;const ticket=++startTicket;lastResourceTrim=0;
 releaseTouches();unlockMusic();
 $('selection').inert=true;$('rematch').disabled=true;$('start').disabled=true;$('quick-start').disabled=true;$('start').textContent='角色入场中…';
 try{
  const chosenStage=STAGES.find(s=>s.id===msg.stage)||STAGES[0];
  const chars=[ROSTER[selected[0]],ROSTER[selected[1]]];
  const needIds=new Set(chars.flatMap(c=>[c.id,...c.skills.filter(s=>s.summonId!=null).map(s=>s.summonId)]));
  await Promise.all([...needIds].map(id=>ensureCharacter(ROSTER_BY_ID.get(id))));
  await window.MemeVisuals?.load?.(loadImage,chars);
  const stageImage=await loadImage(chosenStage.file);
  if(ticket!==startTicket)return;
  images.set('stage',stageImage);currentStage=chosenStage;stagePicker.commit(chosenStage);
  if(currentGame)currentGame.destroy();
  window.MemeVisuals?.releaseUnused?.();
  $('selection').hidden=true;$('battle').hidden=false;document.body.classList.add('in-battle');$('end').hidden=true;
  buildHUD(2);
  const mySide=onlineState.mySide;
  $('battle-mode').textContent='在线 1V1 · '+currentStage.name;
  const myChar=chars[mySide];
  $('battle-skills').innerHTML=skillHTML(myChar);
  $('battle-guide').open=!isMobile();
  document.querySelectorAll('[data-touch-skill]').forEach(b=>{
   const i=+b.dataset.touchSkill;
   b.querySelector('b').textContent=myChar.skills[i].name;
   b.setAttribute('aria-label',myChar.skills[i].name);
  });
  $('battle-tip').textContent='A / D 移动 · W 跳跃 · S 格挡 · J K 普攻 · U I O 技能 · L 必杀';
  currentGame=new FightGame($('game'),chars,{
   mode:'online',online:true,mySide:mySide,seed:msg.seed,stage:currentStage,
   images,animationSheets,animations:window.ANIMATIONS,memeVisuals:window.MemeVisuals,audio:audioFX,prepareSkill,
   onRoundReset:g=>touchInput.reapply(g),
   onPause:paused=>{$('pause').textContent=paused?'继续 ESC':'暂停 ESC';},
   onLocalInput:(mask,age)=>netClient?.sendFightInput(mask,age),
   onSyncSnapshot:snap=>netClient?.sendFightSync(snap),
   onHUD:updateHUD,onBanner:showBanner,
   onEnd:(winner,stats)=>{
    showEnd(winner,stats);
    $('rematch').textContent='再来一局 ↻';
    $('rematch').disabled=false;
    if(mode==='online'&&onlineState.inRoom){
     const winnerSide=winner?(winner.team!=null?winner.team:(winner===currentGame?.fighters[0]?0:1)):null;
     netClient?.sendFightEnd(winnerSide);
    }
   }
  });
  currentGame.start();
  $('pause').textContent='暂停 ESC';$('resume-battle').hidden=true;syncMusic();$('game').focus();window.scrollTo(0,0);
 }catch(e){
  if(ticket===startTicket)$('start').textContent=e.message+'，点击重试';return;
 }finally{
  if(ticket===startTicket){
   $('selection').inert=false;starting=false;$('rematch').disabled=false;$('start').disabled=false;$('quick-start').disabled=false;
  }
  $('start').innerHTML='准备好了，开打！ <span>↗</span>';
 }
}

async function startGame(){
 if(starting)return;
 if(mode==='online'){
  if(!onlineState.locked[onlineState.mySide]){
   toggleOnlineLock(true);
  }
  return;
 }
 starting=true;const ticket=++startTicket;lastResourceTrim=0;if(isMobile()&&mode==='local'){mode='cpu';applyDeviceModes();}const matchMode=mode,matchDifficulty=difficulty;releaseTouches();unlockMusic();$('selection').inert=true;$('rematch').disabled=true;$('start').disabled=true;$('quick-start').disabled=true;$('start').textContent='角色入场中…';try{const chosenStage=stagePicker.choose();const chars=activeSelected().map(i=>ROSTER[i]);const needIds=new Set(chars.flatMap(c=>[c.id,...c.skills.filter(s=>s.summonId!=null).map(s=>s.summonId)]));await Promise.all([...needIds].map(id=>ensureCharacter(ROSTER_BY_ID.get(id))));await window.MemeVisuals?.load?.(loadImage,chars);const stageImage=await loadImage(chosenStage.file);if(ticket!==startTicket)return;if(isMobile()&&['local','team-coop','team-versus'].includes(matchMode))throw Error('当前设备请选单人模式，再点击开打');images.set('stage',stageImage);currentStage=chosenStage;stagePicker.commit(chosenStage);if(currentGame)currentGame.destroy();window.MemeVisuals?.releaseUnused?.();$('selection').hidden=true;$('battle').hidden=false;document.body.classList.add('in-battle');$('end').hidden=true;buildHUD(chars.length);$('battle-mode').textContent=modeNames[matchMode]+' · '+currentStage.name;$('battle-skills').innerHTML=skillHTML(chars[0]);$('battle-guide').open=!isMobile();document.querySelectorAll('[data-touch-skill]').forEach(b=>{const i=+b.dataset.touchSkill;b.querySelector('b').textContent=chars[0].skills[i].name;b.setAttribute('aria-label',chars[0].skills[i].name);});$('battle-tip').textContent=['local','team-coop','team-versus'].includes(matchMode)?'2P：方向键移动 · 数字小键盘 1 2 4 5 6 3':'按 ESC 暂停';currentGame=new FightGame($('game'),chars,{mode:matchMode,difficulty:matchDifficulty,stage:currentStage,images,animationSheets,animations:window.ANIMATIONS,memeVisuals:window.MemeVisuals,audio:audioFX,prepareSkill,onRoundReset:g=>touchInput.reapply(g),onPause:paused=>{releaseTouches();syncMusic();$('pause').textContent=paused?'继续 ESC':'暂停 ESC';$('resume-battle').hidden=!paused;},onHUD:updateHUD,onBanner:showBanner,onEnd:showEnd});currentGame.start();$('pause').textContent='暂停 ESC';$('resume-battle').hidden=true;syncMusic();$('game').focus();window.scrollTo(0,0);}catch(e){if(ticket===startTicket)$('start').textContent=e.message+'，点击重试';return;}finally{if(ticket===startTicket){$('selection').inert=false;starting=false;$('rematch').disabled=false;$('start').disabled=false;$('quick-start').disabled=false;}} $('start').innerHTML='准备好了，开打！ <span>↗</span>';
}
let lastResourceTrim=0;
async function prepareSkill(skill){const ids=new Set([skill.summonId,skill.mimicOrigin?.characterId].filter(id=>id!=null));await Promise.all([MemeVisuals.load(loadImage,[{skills:[skill]}],true),...[...ids].map(id=>ensureCharacter(ROSTER_BY_ID.get(id)))]);}
function updateHUD(g){
 if(g.age-lastResourceTrim>1){lastResourceTrim=g.age;trimSheets();MemeVisuals.releaseUnused(g);}
 const mySide=g.options.online?(g.options.mySide??0):0;
 const myFighter=g.fighters[mySide]||g.fighters[0];
 document.querySelectorAll('[data-touch-skill]').forEach(b=>{
  const f=myFighter,i=+b.dataset.touchSkill,cd=f.cooldowns[i];
  b.querySelector('em').textContent=f.hp<=0?'K.O.':f.castPending?.index===i?'…':cd>0?cd.toFixed(1):i===5&&f.energy<100?Math.floor(f.energy)+'气':'';
  b.classList.toggle('available',f.hp>0&&cd<=0&&(i!==5||f.energy>=100));
 });
 g.fighters.forEach((f,i)=>{
  const n=i+1,team=f.team??i;
  let displayName=f.data.name;
  if(g.options.online){
   const pName=onlineState.playerNames[i]||(i===0?'房主':'挑战者');
   displayName=pName+(i===onlineState.mySide?' (你)':'')+' · '+f.data.name;
  }else if(g.isTeamMatch){
   displayName=(f.controller===null?'CPU':(f.controller+1)+'P')+' · '+f.data.name;
  }
  $('hud-name'+n).textContent=displayName;
  $('hp'+n).style.width=(f.hp/f.data.hp*100)+'%';
  $('health'+n).textContent=f.hp<=0?'K.O. · 已退场':`${Math.ceil(f.hp)} / ${f.data.hp}  ·  防御 ${Math.ceil(f.guard)}%`;
  $('mp'+n).style.width=f.energy+'%';
  $('mp'+n).style.background=f.energy>=100?'#d8ff62':'#76e7ff';
  $('score'+n).textContent=i<2?'●'.repeat(g.wins[team])+'○'.repeat(2-g.wins[team]):'';
  $('hud-card'+n).classList.toggle('defeated',f.hp<=0);
 });
 $('timer').textContent=g.mode==='training'?'∞':Math.max(0,Math.ceil(g.time));
 $('round').textContent='ROUND '+g.round;
 $('battle-skills').querySelectorAll('.skill').forEach((el,i)=>{
  let cd=myFighter.cooldowns[i],existing=el.querySelector('.cooldown');
  let msg=cd>0?cd.toFixed(1):i===5&&myFighter.energy<100?Math.floor(myFighter.energy)+' / 100':'';
  if(msg){
   if(!existing){existing=document.createElement('span');existing.className='cooldown';el.append(existing);}
   existing.textContent=msg;
  }else existing?.remove();
 });
}
function showBanner(title,sub=''){$('banner-text').textContent=title;$('banner-sub').textContent=sub;}
function showEnd(winner,stats){$('end').hidden=false;$('end-sub').textContent='MATCH COMPLETE';$('end-title').textContent=(currentGame?.isTeamMatch?currentGame.teamTitle(winner.team):winner.data.name)+' 获胜';$('end-info').textContent=stats;showBanner('');}
function goBack(){
 $('selection').inert=false;startTicket++;starting=false;$('rematch').disabled=false;$('start').disabled=false;$('quick-start').disabled=false;$('start').innerHTML='准备好了，开打！ <span>↗</span>';
 if(currentGame){currentGame.destroy();currentGame=null;}
 $('battle').hidden=true;$('selection').hidden=false;document.body.classList.remove('in-battle');
 releaseTouches();$('end').hidden=true;syncMusic();
 if(mode==='online'){
  onlineState.locked=[false,false];
  updateLockBadges();
  netClient?.sendFightReselect();
 }
 refresh();refreshStage();
}
$('start').onclick=startGame;$('quick-start').onclick=startGame;$('back').onclick=goBack;$('reselect').onclick=goBack;
$('rematch').onclick=()=>{
 if(mode==='online'){
  netClient?.sendFightRematch();
  $('rematch').textContent='已就绪，等待对手…';
  $('rematch').disabled=true;
  return;
 }
 startGame();
};
$('pause').onclick=()=>currentGame?.togglePause();$('resume-battle').onclick=()=>{if(currentGame?.paused)currentGame.togglePause(false);};
$('help').onclick=()=>{if(currentGame&&!currentGame.paused)currentGame.togglePause();$('help-dialog').showModal();};$('close-help').onclick=()=>$('help-dialog').close();$('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog'))$('help-dialog').close();});
$('sound').onclick=()=>{sound=!sound;audioFX.muted=!sound;if(!sound)window.speechSynthesis?.cancel();$('sound').textContent=sound?'♪ 音效开':'♪ 音效关';if(sound)audioFX.unlock();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='不支持';}};
// Block browser gestures on the play surfaces without cancelling menu clicks or scrolling.
for(const surface of [$('arena'),$('touch')]){
 for(const type of ['contextmenu','selectstart','dragstart','dblclick']){
  surface.addEventListener(type,e=>{if(e.cancelable)e.preventDefault();});
 }
}
const touchInput=new FightTouchInput(document,{getGame:()=>currentGame,unlock:()=>audioFX.unlock()});
function releaseTouches(){touchInput.releaseAll();}
window.addEventListener('blur',releaseTouches);
window.addEventListener('orientationchange',releaseTouches);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseTouches();});
const pendingAssets=new Map();
function trimSheets(){const keep=new Set(activeSelected().map(i=>ROSTER[i].id));for(const c of [...activeSelected().map(i=>ROSTER[i]),...(currentGame?.characters||[])]){keep.add(c.id);for(const s of c.skills)if(s.summonId!=null)keep.add(s.summonId);}for(const f of currentGame?.fighters||[])for(const s of [f.attack?.skill,f.castPending?.skill]){if(s?.summonId!=null)keep.add(s.summonId);if(s?.mimicOrigin)keep.add(s.mimicOrigin.characterId);}for(const p of currentGame?.projectiles||[])if(p.summonId!=null)keep.add(p.summonId);for(const id of animationSheets.keys())if(!keep.has(id)&&![...pendingAssets.keys()].some(k=>k.startsWith(id+':')))animationSheets.delete(id);}
function showAssetError(e){$('animation-status').hidden=false;$('animation-status').textContent=e.message+'；请重新选择该角色重试。';}
const idleFrames=entry=>[...(entry.clips.idle||[]),...Object.values(entry.directionalClips||{}).flatMap(clips=>clips.idle||[])];
async function ensureCharacter(c,previewOnly=false){
 if(!c)return;const entry=window.ANIMATIONS?.[c.id];
 if(!entry){if(!images.has(c.id)){const k='portrait:'+c.id;if(!pendingAssets.has(k))pendingAssets.set(k,loadImage(c.file).then(im=>images.set(c.id,im)).finally(()=>pendingAssets.delete(k)));await pendingAssets.get(k);}return;}
 if(!animationSheets.has(c.id))animationSheets.set(c.id,new Map());
 const sheets=animationSheets.get(c.id),needed=previewOnly?[...new Set(idleFrames(entry).map(r=>r.sheet))]:Object.keys(entry.sheets);
 await Promise.all(needed.map(async key=>{if(sheets.has(key))return;const k=c.id+':'+key;if(!pendingAssets.has(k))pendingAssets.set(k,loadImage(entry.sheets[key]).then(im=>sheets.set(key,FighterAnimation.prepareSheet(im,entry))).finally(()=>pendingAssets.delete(k)));await pendingAssets.get(k);}));
}
function previewFighter(c,facing,time){return {data:c,x:0,y:443,facing,hp:1,vy:0,knocked:0,stun:0,blocking:false,attack:null,landing:0,walk:0,animTime:time,hitFlash:0,invuln:0};}
const previewResources={images,animationSheets,animations:window.ANIMATIONS};
function drawPreview(canvas,c,facing,time,card=false){
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
 const entry=window.ANIMATIONS?.[c.id],sheets=animationSheets.get(c.id);
 if(entry&&!idleFrames(entry).every(r=>sheets?.has(r.sheet)))return;
 ctx.save();const scale=card?.46:1.3;ctx.translate(canvas.width/2,card?93:276);ctx.scale(scale,scale);
 FighterAnimation.drawCharacter(ctx,previewFighter(c,facing,time),previewResources,1,0,0);ctx.restore();
}
function drawCard(c){const canvas=$('roster').children[ROSTER.indexOf(c)]?.querySelector('canvas');if(canvas)drawPreview(canvas,c,1,0,true);}
let previewTime=0,previewLast=0;
function animateSelection(now){const dt=Math.min((now-previewLast)/1000,.05);previewLast=now;if(!$('selection').hidden&&!document.hidden){previewTime+=dt;for(const p of activeSlots())drawPreview($('portrait'+(p+1)),ROSTER[selected[p]],p%2===0?1:-1,previewTime);for(const id of new Set(activeSelected())){const c=ROSTER[id],canvas=$('roster').children[id].querySelector('canvas');const owner=selected[side]===id?side:activeSlots().find(p=>selected[p]===id);drawPreview(canvas,c,owner%2===0?1:-1,previewTime,true);}}requestAnimationFrame(animateSelection);}
// Fetch visible roster rows first; each thumbnail retains the actual idle crop
// after its full sheet is released, keeping phone memory bounded.
function loadCards(){
 const queue=[],queued=new Set();let workers=0;
 function pump(){while(workers<3&&queue.length){const c=queue.shift();workers++;ensureCharacter(c,true).then(()=>{drawCard(c);trimSheets();}).catch(showAssetError).finally(()=>{workers--;pump();});}}
 function enqueue(id){if(!queued.has(id)){queued.add(id);queue.push(ROSTER[id]);pump();}}
 if(!window.IntersectionObserver){ROSTER.forEach((c,i)=>enqueue(i));return;}
 const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){enqueue(+e.target.dataset.characterId);observer.unobserve(e.target);}},{rootMargin:'180px'});
 [...$('roster').children].forEach((b,id)=>{b.dataset.characterId=id;observer.observe(b);});
}
function applyDeviceModes(){const mobile=isMobile();document.body.classList.toggle('mobile-device',mobile);document.querySelectorAll('[data-mode="local"],[data-team-mode="team-coop"],[data-team-mode="team-versus"]').forEach(button=>{button.hidden=mobile;button.disabled=mobile;});$('p2-help').hidden=mobile;$('battle-guide').open=!mobile;if(mobile&&['local','team-coop','team-versus'].includes(mode))mode=teamMode()?'team-cpu':'cpu';refresh();}
mobileQuery.addEventListener?.('change',applyDeviceModes);
applyDeviceModes();loadCards();requestAnimationFrame(animateSelection);

