/* Online room client for the turn battle (round-trip online mode).
 * Manages one WebSocket to <origin>/ws: hello handshake, session token in sessionStorage,
 * exponential-backoff reconnect, and a small typed message API used by turn-ui online mode.
 * Protocol: JSON messages, see server/net-server.mjs.
 */
(()=>{
'use strict';
const TOKEN_KEY='abstract-online-token-v1';
const PROTOCOL_VERSION=1;
const RECONNECT_BASE=700;   // ms
const RECONNECT_MAX=15000;  // ms cap

class NetClient{
 constructor(){
  this.ws=null; this.connected=false; this.closing=false;
  this.handlers=new Map();      // type -> fn[]
  this.pending=null;            // fn to call once hello is answered
  this.attempts=0; this.retryTimer=null;
  this.session=null;            // {code, side, token}
  this.lastError=null;
  this.hadSession=false;        // true once we entered a room
  this.url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
 }
 on(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn);return this;}
 emit(type,msg){const list=this.handlers.get(type);if(list)for(const fn of list)fn(msg);}
 connect(){
  if(this.connected&&this.ws?.readyState===WebSocket.OPEN)return Promise.resolve(this);
  this.closing=false; clearTimeout(this.retryTimer);
  return new Promise((resolve,reject)=>{
   this.pending={resolve,reject};
   try{if(this.ws){try{this.ws.close();}catch{}}this.ws=new WebSocket(this.url);}catch(e){this.scheduleRetry();return;}
   this.ws.onopen=()=>{
    let token=null;
    try{token=sessionStorage.getItem(TOKEN_KEY);}catch{}
    this.ws.send(JSON.stringify({type:'hello',name:this.name||'玩家',version:PROTOCOL_VERSION,token:token??undefined}));
   };
   this.ws.onmessage=e=>{
    let msg;try{msg=JSON.parse(e.data);}catch{return;}
    if(msg.type==='welcome'){
     this.connected=true;this.attempts=0;
     try{if(msg.token)sessionStorage.setItem(TOKEN_KEY,msg.token);}catch{}
     if(msg.sessionExpired){this.session=null;this.hadSession=false;this.emit('session_expired',msg);}
     if(this.pending){const p=this.pending;this.pending=null;p.resolve(this);}
    }
    else if(msg.type==='created'||msg.type==='joined'){
      this.session={code:msg.code,side:msg.side,token:msg.token,game:msg.game,isPublic:msg.isPublic,title:msg.title,mode:msg.mode};
      this.hadSession=true;
    }
    else if(msg.type==='room_state'){
      this.session={code:msg.code,side:msg.side,token:sessionStorage.getItem(TOKEN_KEY),game:msg.game,isPublic:msg.isPublic,title:msg.title,mode:msg.mode};
    }
    else if(msg.type==='room_closed'){this.session=null;this.hadSession=false;}
    else if(msg.type==='error'&&msg.code==='TOKEN_INVALID'){
     this.forgetSession();
     if(this.ws?.readyState===WebSocket.OPEN){
      this.ws.send(JSON.stringify({type:'hello',name:this.name||'玩家',version:PROTOCOL_VERSION}));
      return;
     }
    }
    this.emit(msg.type,msg);
    if(this.pending&&msg.type==='error'){const p=this.pending;this.pending=null;p.reject(new Error(msg.message||'连接失败'));}
   };
   this.ws.onerror=()=>{/* onclose handles retry */};
   this.ws.onclose=()=>{
    this.connected=false; this.ws=null;
    const wasInRoom=this.session!=null||this.hadSession;
    this.emit('disconnect',{wasInRoom});
    if(this.pending){const p=this.pending;this.pending=null;p.reject(new Error('连接已断开'));}
    if(!this.closing&&document.visibilityState!=='hidden')this.scheduleRetry();
   };
  });
 }
 scheduleRetry(){
  clearTimeout(this.retryTimer);
  const wait=Math.min(RECONNECT_MAX,RECONNECT_BASE*Math.pow(2,this.attempts++));
  this.retryTimer=setTimeout(()=>{this.connect().catch(()=>{});},wait);
  this.emit('retry_scheduled',{ms:wait,attempt:this.attempts});
 }
 close(){this.closing=true;clearTimeout(this.retryTimer);try{this.ws?.close(1000);}catch{}}
 send(obj){if(this.connected&&this.ws?.readyState===WebSocket.OPEN){try{this.ws.send(JSON.stringify(obj));return true;}catch{return false;}}return false;}
 setName(name){this.name=typeof name==='string'?name.trim().slice(0,12):'玩家';}
 create(name){this.name=name;return this.send({type:'create',game:'turn'});}
 createFightRoom(opts={}){if(opts.name)this.name=opts.name;return this.send({type:'create',game:'fight',isPublic:opts.isPublic!==false,title:opts.title||opts.name||'格斗擂台',mode:opts.mode||'1v1'});}
 createTurnRoom(opts={}){if(opts.name)this.name=opts.name;return this.send({type:'create',game:'turn',isPublic:opts.isPublic!==false,title:opts.title||opts.name||'回合对战',mode:opts.mode||'1v1'});}
 getRooms(game='fight'){return this.send({type:'get_rooms',game});}
 join(code){return this.send({type:'join',code:String(code).trim()});}
 lock(team){return this.send({type:'lock',team});}
 act(slot,target,move){return this.send({type:'action',slot,target,move:Number.isInteger(move)?move:undefined});}
 rematch(){return this.send({type:'rematch'});}
 sendFightSelect(charId){return this.send({type:'fight_select',charId});}
 sendFightStage(stage){return this.send({type:'fight_stage',stage});}
 sendFightLock(locked=true,stage=null){return this.send({type:'fight_lock',locked:!!locked,stage});}
 sendFightStart(stage,seed){return this.send({type:'fight_start',stage,seed});}
 sendFightInput(mask,tick,state){return this.send({type:'fight_input',mask,tick,...(state||{})});}
 sendFightSync(data){return this.send({type:'fight_sync',...data});}
 sendFightEnd(winner=null){return this.send({type:'fight_end',winner});}
 sendFightReselect(){return this.send({type:'fight_reselect'});}
 sendFightRematch(){return this.send({type:'fight_rematch'});}
 leave(){const ok=this.send({type:'leave'});this.session=null;return ok;}
 forgetSession(){try{sessionStorage.removeItem(TOKEN_KEY);}catch{}this.session=null;this.hadSession=false;}
}
window.AbstractNet={NetClient,TOKEN_KEY,PROTOCOL_VERSION};
})();
