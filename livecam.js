/* ============================================================
   SlabCraft beta: live camera with card frame, grid and level.
   window.SlabCam.open(side, onPhoto) -> calls onPhoto(File)
   ============================================================ */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const LEVEL_OK=2.5;      // degrees from flat that counts as level
const HOLD_MS=1200;      // how long to stay level before auto-capture
let stream=null,raf=0,onPhoto=null,side="front",tilt=null,levelSince=0,taken=false,orientSeen=false,orientTimer=0;

function html(){
  if($("#cam"))return;
  const d=document.createElement("div");d.id="cam";d.className="cam";d.hidden=true;
  d.innerHTML=`<video id="camVideo" playsinline autoplay muted></video><canvas id="camOverlay"></canvas>
    <div class="camtop"><b id="camTitle">Front</b><span id="camMsg">Hold your phone flat over the card</span></div>
    <div class="camlevel" id="camLevel" aria-hidden="true"><i></i><span class="bub" id="camBub"></span></div>
    <div class="cambar">
      <button type="button" class="cambtn" id="camClose">Cancel</button>
      <button type="button" class="shutter" id="camShot" aria-label="Take photo"></button>
      <label class="cambtn"><input type="checkbox" id="camAuto" checked> Auto</label>
    </div>`;
  document.body.appendChild(d);
  $("#camClose").addEventListener("click",close);
  $("#camShot").addEventListener("click",()=>capture(false));
}
function onOrient(e){
  if(e.beta==null||e.gamma==null)return;orientSeen=true;
  // phone lying face-down over a card: beta and gamma both near 0
  tilt={b:e.beta,g:e.gamma,t:Math.hypot(e.beta,e.gamma)};
}
async function open(s,cb){
  html();side=s;onPhoto=cb;taken=false;levelSince=0;tilt=null;orientSeen=false;
  $("#camTitle").textContent=s==="back"?"Back of card":"Front of card";
  $("#camMsg").textContent="Hold your phone flat over the card";
  // iPhone needs permission for the level; ask on this tap
  try{if(typeof DeviceOrientationEvent!=="undefined"&&DeviceOrientationEvent.requestPermission){await DeviceOrientationEvent.requestPermission()}}catch(_){}
  window.addEventListener("deviceorientation",onOrient);
  clearTimeout(orientTimer);orientTimer=setTimeout(()=>{if(!orientSeen){$("#camLevel").hidden=true;$("#camAuto").closest("label").hidden=true}},1500);
  $("#camLevel").hidden=false;$("#camAuto").closest("label").hidden=false;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:3840},height:{ideal:2160}}});
  }catch(e){
    alert("The camera couldn't open. Allow camera access for this site, or use Upload instead.");return;
  }
  const v=$("#camVideo");v.srcObject=stream;$("#cam").hidden=false;document.body.style.overflow="hidden";
  try{await v.play()}catch(_){}
  loop();
}
function close(){
  cancelAnimationFrame(raf);window.removeEventListener("deviceorientation",onOrient);clearTimeout(orientTimer);
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  const c=$("#cam");if(c)c.hidden=true;document.body.style.overflow="";
}
function frameRect(W,H){ // card-shaped frame, 5:7, as large as fits
  let fh=H*.72,fw=fh*5/7;if(fw>W*.86){fw=W*.86;fh=fw*7/5}
  return {x:(W-fw)/2,y:(H-fh)/2-H*.02,w:fw,h:fh};
}
function loop(){
  const cv=$("#camOverlay"),r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  if(cv.width!==Math.round(r.width*dpr)){cv.width=Math.round(r.width*dpr);cv.height=Math.round(r.height*dpr)}
  const x=cv.getContext("2d"),W=cv.width,H=cv.height;x.clearRect(0,0,W,H);
  const f=frameRect(W,H);const ok=!orientSeen||(tilt&&tilt.t<LEVEL_OK);
  // dim outside the frame
  x.fillStyle="rgba(0,0,0,.45)";x.beginPath();x.rect(0,0,W,H);x.rect(f.x,f.y,f.w,f.h);x.fill("evenodd");
  // thirds grid inside the frame
  x.strokeStyle="rgba(255,255,255,.45)";x.lineWidth=1*dpr;x.setLineDash([6*dpr,6*dpr]);
  for(let i=1;i<3;i++){x.beginPath();x.moveTo(f.x+f.w*i/3,f.y);x.lineTo(f.x+f.w*i/3,f.y+f.h);x.stroke();x.beginPath();x.moveTo(f.x,f.y+f.h*i/3);x.lineTo(f.x+f.w,f.y+f.h*i/3);x.stroke()}
  x.setLineDash([]);
  // frame + corner brackets (green when level)
  const col=orientSeen?(ok?"#2FD37F":"#F2A93B"):"#2FD37F";
  x.strokeStyle=col;x.lineWidth=2.5*dpr;x.strokeRect(f.x,f.y,f.w,f.h);
  x.lineWidth=6*dpr;const k=30*dpr;
  [[f.x,f.y,1,1],[f.x+f.w,f.y,-1,1],[f.x,f.y+f.h,1,-1],[f.x+f.w,f.y+f.h,-1,-1]].forEach(([a,b,dx,dy])=>{x.beginPath();x.moveTo(a+dx*k,b);x.lineTo(a,b);x.lineTo(a,b+dy*k);x.stroke()});
  // bubble level
  if(orientSeen&&tilt){
    const bub=$("#camBub"),R=34;const clamp=v=>Math.max(-R,Math.min(R,v));
    bub.style.transform=`translate(${clamp(tilt.g*3)}px,${clamp(tilt.b*3)}px)`;
    $("#camLevel").classList.toggle("ok",ok);
    const now=performance.now();
    if(ok){if(!levelSince)levelSince=now}else levelSince=0;
    const auto=$("#camAuto").checked;
    if(ok&&auto&&!taken){const left=Math.max(0,HOLD_MS-(now-levelSince));$("#camMsg").textContent=left>0?"Level. Hold still…":"Taking photo…";if(left===0)capture(true)}
    else if(!ok)$("#camMsg").textContent=`Tilt ${tilt.t.toFixed(1)}°. Level the phone until the bubble turns green`;
    else $("#camMsg").textContent="Level. Tap the shutter";
  }
  raf=requestAnimationFrame(loop);
}
async function capture(auto){
  if(taken)return;taken=true;
  const v=$("#camVideo");if(!v.videoWidth){taken=false;return}
  const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);
  try{navigator.vibrate&&navigator.vibrate(40)}catch(_){}
  const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",.92));
  const t=tilt?tilt.t:null;close();
  if(blob&&onPhoto)onPhoto(new File([blob],`${side}-${Date.now()}.jpg`,{type:"image/jpeg"}),{tilt:t,auto});
}
window.SlabCam={open,close,supported:()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)};
})();
