/* ============================================================
   SlabCraft beta: live camera with card frame, grid and level.
   Takes the photo by itself once the card is lined up with the
   frame AND the phone is level (or just lined up, on phones
   without a motion sensor).
   window.SlabCam.open(side, onPhoto) -> calls onPhoto(File)
   ============================================================ */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const LEVEL_OK=3;        // degrees from flat that counts as level
const HOLD_MS=900;       // how long everything must stay good before the photo
const CHECK_MS=250;      // how often to look for the card
let stream=null,raf=0,onPhoto=null,side="front",tilt=null,goodSince=0,taken=false,orientSeen=false,orientTimer=0;
let lastCheck=0,card=null,align=null;const small=document.createElement("canvas");

function html(){
  if($("#cam"))return;
  const d=document.createElement("div");d.id="cam";d.className="cam";d.hidden=true;
  d.innerHTML=`<video id="camVideo" playsinline autoplay muted></video><canvas id="camOverlay"></canvas>
    <div class="camtop"><b id="camTitle">Front</b><span id="camMsg">Line the card up with the frame</span></div>
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
  tilt={b:e.beta,g:e.gamma,t:Math.hypot(e.beta,e.gamma)};
}
async function open(s,cb){
  html();side=s;onPhoto=cb;taken=false;goodSince=0;tilt=null;orientSeen=false;card=null;align=null;
  $("#camTitle").textContent=s==="back"?"Back of card":"Front of card";
  $("#camMsg").textContent="Line the card up with the frame";
  // iPhone asks permission for the level; this must happen on the tap
  try{if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){await DeviceOrientationEvent.requestPermission()}}catch(_){}
  window.addEventListener("deviceorientation",onOrient);
  $("#camLevel").hidden=false;
  clearTimeout(orientTimer);orientTimer=setTimeout(()=>{if(!orientSeen)$("#camLevel").hidden=true},1500);
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:3840},height:{ideal:2160}}});
  }catch(e){
    window.removeEventListener("deviceorientation",onOrient);
    alert("The camera couldn't open. Allow camera access for this site in your browser settings. If you opened the link inside another app (like Facebook or Messenger), open it in Chrome or Safari instead.");return;
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
  let fh=H*.66,fw=fh*5/7;if(fw>W*.84){fw=W*.84;fh=fw*7/5}
  return {x:(W-fw)/2,y:(H-fh)/2+H*.02,w:fw,h:fh};
}
// map a point in video pixels to overlay pixels (video uses object-fit: cover)
function v2o(v,W,H){const vw=v.videoWidth,vh=v.videoHeight,sc=Math.max(W/vw,H/vh);return {sc,ox:(W-vw*sc)/2,oy:(H-vh*sc)/2}}
function checkAlignment(W,H){
  const v=$("#camVideo");if(!v.videoWidth||!window.SlabDetect)return;
  const sw=360,sh=Math.round(sw*v.videoHeight/v.videoWidth);small.width=sw;small.height=sh;
  small.getContext("2d",{willReadFrequently:true}).drawImage(v,0,0,sw,sh);
  let r=null;try{r=window.SlabDetect(small)}catch(_){r=null}
  if(!r){card=null;align={ok:false,msg:"Line the card up with the frame"};return}
  const m=v2o(v,W,H),k=v.videoWidth/sw;
  const cx=m.ox+r.cx*k*m.sc,cy=m.oy+r.cy*k*m.sc,maj=r.major*k*m.sc,min=r.minor*k*m.sc;
  // angle of the long side away from vertical, in degrees
  let ang=Math.abs((r.angle*180/Math.PI)%180);ang=Math.abs(90-ang);
  card={cx,cy,maj,min,a:r.angle,quad:r.quad?r.quad.map(p=>({x:m.ox+p.x*k*m.sc,y:m.oy+p.y*k*m.sc})):null};
  const f=frameRect(W,H),fcx=f.x+f.w/2,fcy=f.y+f.h/2;
  const off=Math.hypot(cx-fcx,cy-fcy)/f.h,size=maj/f.h;
  let msg="";
  if(ang>45)msg="Turn the card upright";
  else if(size<.78)msg="Move closer";
  else if(size>1.08)msg="Move back a little";
  else if(off>.06)msg="Center the card in the frame";
  else if(ang>4)msg="Straighten the card";
  align={ok:!msg,msg};
}
function loop(){
  const cv=$("#camOverlay"),r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  if(cv.width!==Math.round(r.width*dpr)){cv.width=Math.round(r.width*dpr);cv.height=Math.round(r.height*dpr)}
  const x=cv.getContext("2d"),W=cv.width,H=cv.height;x.clearRect(0,0,W,H);
  const now=performance.now();
  if(now-lastCheck>CHECK_MS){lastCheck=now;checkAlignment(W,H)}
  const f=frameRect(W,H);
  const levelOk=!orientSeen||(tilt&&tilt.t<LEVEL_OK);
  const alignOk=!!(align&&align.ok);
  const allOk=levelOk&&alignOk;
  // dim outside the frame
  x.fillStyle="rgba(0,0,0,.45)";x.beginPath();x.rect(0,0,W,H);x.rect(f.x,f.y,f.w,f.h);x.fill("evenodd");
  // thirds grid inside the frame
  x.strokeStyle="rgba(255,255,255,.55)";x.lineWidth=1.2*dpr;x.setLineDash([6*dpr,6*dpr]);
  for(let i=1;i<3;i++){x.beginPath();x.moveTo(f.x+f.w*i/3,f.y);x.lineTo(f.x+f.w*i/3,f.y+f.h);x.stroke();x.beginPath();x.moveTo(f.x,f.y+f.h*i/3);x.lineTo(f.x+f.w,f.y+f.h*i/3);x.stroke()}
  x.setLineDash([]);
  // centre cross
  x.strokeStyle="rgba(255,255,255,.8)";x.lineWidth=2*dpr;const cx=f.x+f.w/2,cy=f.y+f.h/2,cl=12*dpr;
  x.beginPath();x.moveTo(cx-cl,cy);x.lineTo(cx+cl,cy);x.moveTo(cx,cy-cl);x.lineTo(cx,cy+cl);x.stroke();
  // the card the camera sees
  if(card&&card.quad){x.strokeStyle=alignOk?"rgba(47,211,127,.95)":"rgba(242,169,59,.95)";x.lineWidth=3*dpr;x.beginPath();
    const q=card.quad;x.moveTo(q[0].x,q[0].y);[1,3,2].forEach(i=>x.lineTo(q[i].x,q[i].y));x.closePath();x.stroke()}
  // frame + corner brackets
  const col=allOk?"#2FD37F":"#F2A93B";
  x.strokeStyle=col;x.lineWidth=3*dpr;x.strokeRect(f.x,f.y,f.w,f.h);
  x.lineWidth=7*dpr;const k=30*dpr;
  [[f.x,f.y,1,1],[f.x+f.w,f.y,-1,1],[f.x,f.y+f.h,1,-1],[f.x+f.w,f.y+f.h,-1,-1]].forEach(([a,b,dx,dy])=>{x.beginPath();x.moveTo(a+dx*k,b);x.lineTo(a,b);x.lineTo(a,b+dy*k);x.stroke()});
  // bubble level
  if(orientSeen&&tilt){
    const bub=$("#camBub"),R=34;const clamp=v=>Math.max(-R,Math.min(R,v));
    bub.style.transform=`translate(${clamp(tilt.g*3)}px,${clamp(tilt.b*3)}px)`;
    $("#camLevel").classList.toggle("ok",levelOk);
  }
  // guidance + automatic photo
  const msgEl=$("#camMsg"),auto=$("#camAuto").checked;
  if(allOk){
    if(!goodSince)goodSince=now;
    const left=Math.max(0,HOLD_MS-(now-goodSince));
    if(auto&&!taken){msgEl.textContent=left>0?"Lined up and level. Hold still…":"Taking photo…";if(left===0)capture(true)}
    else msgEl.textContent="Lined up and level. Tap the shutter";
  }else{
    goodSince=0;
    if(!alignOk)msgEl.textContent=align?align.msg:"Line the card up with the frame";
    else msgEl.textContent=`Level the phone: tilted ${tilt.t.toFixed(1)}°. Center the bubble`;
  }
  raf=requestAnimationFrame(loop);
}
async function capture(auto){
  if(taken)return;taken=true;
  const v=$("#camVideo");if(!v.videoWidth){taken=false;return}
  const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);
  try{navigator.vibrate&&navigator.vibrate(60)}catch(_){}
  const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",.92));
  const t=tilt?tilt.t:null;close();
  if(blob&&onPhoto)onPhoto(new File([blob],`${side}-${Date.now()}.jpg`,{type:"image/jpeg"}),{tilt:t,auto});
}
window.SlabCam={open,close,supported:()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)};
})();
