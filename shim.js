/* ============================================================
   SlabCraft beta: stand-ins for the Claude page runtime.
   AI goes through YOUR server (Cloudflare Worker), the vault is
   kept on the phone, and downloads use the browser.
   ============================================================ */
(function(){
"use strict";
const CFG=window.SLABCRAFT_CONFIG||{};
const LS={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v);return true}catch(e){return e}},del(k){try{localStorage.removeItem(k)}catch(_){}}};
const err=(code,message)=>({code,message:message||code});

/* ---------- beta code ---------- */
function betaCode(force){
  let c=LS.get("slabcraft.betaCode");
  if(!c||force){
    c=(window.prompt(force?"That beta code didn't work. Enter the beta code from the person who invited you:":"Enter your SlabCraft beta code:")||"").trim();
    if(c)LS.set("slabcraft.betaCode",c);
  }
  return c||"";
}

/* ---------- images: shrink to save cost, send as base64 JPEG ---------- */
async function toJpegB64(blob){
  const url=URL.createObjectURL(blob);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});
    const max=CFG.maxImageSide||1568,sc=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement("canvas");c.width=Math.round(img.naturalWidth*sc);c.height=Math.round(img.naturalHeight*sc);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);
    return c.toDataURL("image/jpeg",.85).split(",")[1];
  }finally{URL.revokeObjectURL(url)}
}

/* ---------- AI ("sample") ---------- */
async function callAI(input,opts,wantJson,retried){
  opts=opts||{};
  if(!CFG.serverUrl)throw err("upstream_error","No server URL set in config.js");
  const prompt=typeof input==="string"?input:input.map(t=>t.content).join("\n\n");
  let imgs=opts.images||[];if(imgs instanceof Blob)imgs=[imgs];imgs=Array.from(imgs);
  const images=[];for(const b of imgs)images.push(await toJpegB64(b));
  const code=betaCode(false);if(!code)throw err("not_granted","No beta code");
  let r;
  try{
    r=await fetch(CFG.serverUrl.replace(/\/$/,"")+"/ai",{method:"POST",signal:opts.signal,
      headers:{"content-type":"application/json","x-beta-code":code},
      body:JSON.stringify({prompt,images,json:!!wantJson,tier:opts.modelTier||"default"})});
  }catch(e){if(e&&e.name==="AbortError")throw err("cancelled");throw err("upstream_error","Can't reach the SlabCraft server")}
  let data={};try{data=await r.json()}catch(_){}
  if(r.status===401){LS.del("slabcraft.betaCode");if(!retried&&betaCode(true))return callAI(input,opts,wantJson,true);throw err("beta_code")}
  if(r.status===429)throw err(data.error&&data.error.code||"daily_limit");
  if(!r.ok)throw err(data.error&&data.error.code||"upstream_error",data.error&&data.error.message);
  const text=String(data.text||"");
  if(!text.trim())throw err("empty_completion");
  if(opts.onText)try{opts.onText({text,delta:text})}catch(_){}
  if(!wantJson)return {text,truncated:!!data.truncated,modelTierApplied:"default"};
  return parseJson(text);
}
function parseJson(t){
  const tries=[t];const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f)tries.push(f[1]);
  const a=Math.min(...["{","["].map(ch=>{const i=t.indexOf(ch);return i<0?1e9:i})),b=Math.max(t.lastIndexOf("}"),t.lastIndexOf("]"));
  if(a<1e9&&b>a)tries.push(t.slice(a,b+1));
  for(const s of tries){try{return JSON.parse(s)}catch(_){}}
  throw Object.assign(err("invalid_json"),{text:t});
}
const sample=(input,opts)=>callAI(input,opts,false);
sample.json=(input,opts)=>callAI(input,opts,true);
sample.limits=async()=>({maxPromptBytes:262144,images:{maxCount:5,maxInputBytes:20e6,mediaTypes:["image/jpeg","image/png","image/webp"]}});

/* ---------- vault ("db"), kept on this phone ---------- */
const KEY="slabcraft.vault";
let store={};try{store=JSON.parse(LS.get(KEY)||"{}")||{}}catch(_){store={}}
const listeners=new Map();
function persist(){const r=LS.set(KEY,JSON.stringify(store));if(r!==true)throw err("quota_exceeded","This phone's storage for the vault is full. Delete a few cards first.")}
function snap(col){
  const docs=Object.entries(store[col]||{}).map(([id,v])=>({id,exists:true,data:()=>v,metadata:{fromCache:false,hasPendingWrites:false}}));
  return {docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false,hasPendingWrites:false},docChanges:()=>[]};
}
function emit(col){(listeners.get(col)||[]).forEach(fn=>{try{fn(snap(col))}catch(_){}})}
function collection(col){
  return {path:col,
    doc(id){id=id||("d"+Date.now().toString(36)+Math.random().toString(36).slice(2,6));return {id,path:col+"/"+id,
      async get(){const v=(store[col]||{})[id];return {id,exists:!!v,data:()=>v,metadata:{fromCache:false,hasPendingWrites:false}}},
      async set(data){const prev=JSON.stringify(store[col]||{});store[col]=store[col]||{};store[col][id]=JSON.parse(JSON.stringify(data));try{persist()}catch(e){store[col]=JSON.parse(prev);throw e}emit(col)},
      async update(data){if(!(store[col]||{})[id])throw err("invalid_argument");Object.assign(store[col][id],data);persist();emit(col)},
      async delete(){if(store[col]){delete store[col][id];persist();emit(col)}}}},
    onSnapshot(next){const a=listeners.get(col)||[];a.push(next);listeners.set(col,a);setTimeout(()=>next(snap(col)),0);return ()=>{listeners.set(col,(listeners.get(col)||[]).filter(f=>f!==next))}},
    async get(){return snap(col)}};
}
const db={collection,doc(p){const i=p.lastIndexOf("/");return collection(p.slice(0,i)).doc(p.slice(i+1))}};

/* ---------- downloads ---------- */
const downloads={async save({filename,data}){
  const blob=data instanceof Blob?data:new Blob([data]);const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);return {status:"saved"};
}};

/* ---------- who's viewing ---------- */
const user={async id(){return "local"},isOwner:()=>true,canEdit:()=>true,can:()=>true,async me(){return {id:"local",name:""}}};

const caps={sample,db,downloads,user};
window.claude={use:async name=>caps[name]||null};
})();
