const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const defaultRoot=__dirname+'/../';
class Element{
 constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attributes={...attrs};this.children=[];this.parentElement=null;this.dataset={};this.style={};this.hidden='hidden'in attrs;this.disabled='disabled'in attrs;this.inert=false;this.open='open'in attrs;this.textContent='';this.value=attrs.value||'';this.width=+(attrs.width||300);this.height=+(attrs.height||150);this.classes=new Set((attrs.class||'').split(/\s+/).filter(Boolean));for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=v;this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),contains:k=>this.classes.has(k),toggle:(k,on)=>{on??=!this.classes.has(k);if(on)this.classes.add(k);else this.classes.delete(k);return on;}};}
 get isConnected(){let n=this;while(n.parentElement)n=n.parentElement;return n.tagName==='DOCUMENT';}
 append(e){e.parentElement=this;this.children.push(e);}
 set innerHTML(text){for(const c of this.children)c.parentElement=null;this.children=[];this._html=text;parse(text,this);}
 get innerHTML(){return this._html||'';}
 matches(q){return q.split(',').some(s=>{s=s.trim();if(s.startsWith('[')){const m=s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return m&&m[1]in this.attributes&&(m[2]==null||this.attributes[m[1]]===m[2]);}if(s.startsWith('#'))return this.attributes.id===s.slice(1);if(s.startsWith('.'))return this.classes.has(s.slice(1));return this.tagName===s.toUpperCase();});}
 querySelectorAll(q){return this.children.flatMap(c=>[...(c.matches(q)?[c]:[]),...c.querySelectorAll(q)]);}
 querySelector(q){return this.querySelectorAll(q)[0]||null;}
 closest(q){for(let node=this;node;node=node.parentElement)if(node.matches(q))return node;return null;}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}
 showModal(){this.open=true;}close(){this.open=false;}addEventListener(){}focus(){}scrollIntoView(){}
 getContext(){return drawing;} contains(e){return e===this||this.children.some(c=>c.contains(e));} getBoundingClientRect(){return {left:0,top:0,width:this.width||300,height:this.height||150};}
}
const gradient={addColorStop(){}};
const drawing=new Proxy({measureText:t=>({width:String(t).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
function parse(text,parent){const stack=[parent],voids=new Set(['meta','link','input','br','img','hr']);for(const m of text.matchAll(/<\/?([a-z][\w-]*)([^>]*)>/gi)){const tag=m[1].toLowerCase();if(m[0][1]==='/'){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag.toUpperCase()){stack.length=i;break;}continue;}const a={};for(const v of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))a[v[1]]=v[2]??'';const e=new Element(tag,a);stack.at(-1).append(e);if(!voids.has(tag))stack.push(e);}}
function makeHarness(saved=new Map(),options={}){
 const root=options.root||defaultRoot,html=fs.readFileSync(root+(options.page||'chess.html'),'utf8'),dom=new Element('document');parse(html,dom);const all=dom.querySelectorAll('[id]'),ids=new Map(all.map(e=>[e.attributes.id,e]));assert(ids.size===all.length,'HTML has unique IDs');const get=id=>{assert(ids.has(id),'missing HTML id: '+id);return ids.get(id);};if(ids.has('stage-select'))get('stage-select').value='random';
 const events={},timers=new Map(),raf=new Map(),imageRequests=[];let tid=0;
 const document={hidden:false,body:dom.querySelector('body'),getElementById:get,createElement:t=>new Element(t),querySelector:q=>dom.querySelector(q),querySelectorAll:q=>dom.querySelectorAll(q),addEventListener:(k,fn)=>events['doc:'+k]=fn,hasFocus:()=>true};
 const ctx={innerWidth:1200,innerHeight:900,matchMedia:()=>({matches:false}),console,Map,Set,Promise,Math,Date,document,performance:{now:()=>0},requestAnimationFrame:fn=>{const id=++tid;raf.set(id,fn);return id;},cancelAnimationFrame:id=>raf.delete(id),setTimeout:fn=>{const id=++tid;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>++tid,clearInterval(){},scrollTo(){},addEventListener:(k,fn)=>events['win:'+k]=fn,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},Image:class{constructor(){this.width=1024;this.height=1536;this.naturalWidth=1024;this.naturalHeight=1536;}set src(url){this.url=url;imageRequests.push(this);Promise.resolve().then(()=>this.onload?.());}}};ctx.window=ctx;ctx.globalThis=ctx;
 ctx.navigator={userAgent:'test',maxTouchPoints:0};
 ctx.matchMedia=()=>({matches:false,addEventListener(){}});
 ctx.MutationObserver=class{observe(){}};
 vm.createContext(ctx);
 const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1].split('?')[0]);
 for(const file of scripts){let source=fs.readFileSync(root+file,'utf8');if(file==='chess-ui.js')source=source.replace(/\}\)\(\);\s*$/,`window.__chessTest={start,finish,reset,save,stored,refresh,pick,setPaused,frame,inspect,chooseStage,showTitle,showGame,art,renderer,titleRenderer,get state(){return {inGame,hasStarted,game,selected,inspected,stage,battle,pair,busy,paused,speed,ticket,casting,seenCasts,previews,lastStatus};},setGame(v){game=v;},setSpeed(v){speed=v;}};})();`);vm.runInContext(source,ctx,{filename:file});}
 return {ctx,$:get,events,timers,raf,saved,imageRequests,hook:ctx.__chessTest,drawing};
}
async function flush(){for(let i=0;i<60;i++)await Promise.resolve();}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
module.exports={makeHarness,flush,deferred,Element,drawing};
