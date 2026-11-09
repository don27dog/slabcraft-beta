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
const LEVEL_OK=4;        // degrees from flat that counts as level
const LEVEL_SOFT=7;      // close enough to level if held steady a little longer
const HOLD_MS=700;       // how long everything must stay good before the photo
const SOFT_HOLD_MS=1800; // hold time when only roughly level
const GRACE_MS=700;      // one missed check doesn't restart the countdown
const CHECK_MS=250;      // how often to look for the card
let stream=null,raf=0,onPhoto=null,side="front",tilt=null,goodSince=0,taken=false,orientSeen=false,orientTimer=0;
let lastCheck=0,card=null,align=null,lastGood=0,sm=null,lostSince=0;const small=document.createElement("canvas");

function html(){
  if($("#cam"))return;
  const d=document.createElement("div");d.id="cam";d.className="cam";d.hidden=true;
  d.innerHTML=`<video id="camVideo" playsinline autoplay muted></video><canvas id="camOverlay"></canvas>
    <div class="camtop"><b id="camTitle">Front</b><span id="camMsg">Line the card up with the frame</span></div>
    <div class="camlevel" id="camLevel" aria-hidden="true"><i></i><span class="bub" id="camBub"></span></div>
    <button type="button" class="cambtn camlvlbtn" id="camLvlOn" hidden>Tap to turn on the level</button>
    <div class="cambar">
      <button type="button" class="cambtn" id="camClose">Cancel</button>
      <button type="button" class="shutter" id="camShot" aria-label="Take photo"></button>
      <label class="cambtn"><input type="checkbox" id="camAuto" checked> Auto</label>
    </div>`;
  document.body.appendChild(d);
  $("#camClose").addEventListener("click",close);
  $("#camLvlOn").addEventListener("click",async()=>{
    try{if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){const r=await DeviceOrientationEvent.requestPermission();if(r!=="granted"){$("#camLvlOn").textContent="Level blocked: allow Motion & Orientation for this site in Settings"}}}catch(_){}
  });
  $("#camShot").addEventListener("click",()=>capture(false));
}
function onOrient(e){
  if(e.beta==null||e.gamma==null)return;if(!orientSeen){const b=document.getElementById("camLvlOn");if(b)b.hidden=true;const l=document.getElementById("camLevel");if(l)l.hidden=false}orientSeen=true;
  // smooth out hand shake so the bubble and the check don't jitter
  if(!sm)sm={b:e.beta,g:e.gamma};else{sm.b=sm.b*.75+e.beta*.25;sm.g=sm.g*.75+e.gamma*.25}
  tilt={b:sm.b,g:sm.g,t:Math.hypot(sm.b,sm.g)};
}
async function open(s,cb){
  html();side=s;onPhoto=cb;taken=false;goodSince=0;tilt=null;orientSeen=false;card=null;align=null;lastGood=0;sm=null;lostSince=0;
  $("#camTitle").textContent=s==="back"?"Back of card":"Front of card";
  $("#camMsg").textContent="Line the card up with the frame";
  // iPhone asks permission for the level; this must happen on the tap
  try{if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){await DeviceOrientationEvent.requestPermission()}}catch(_){}
  window.addEventListener("deviceorientation",onOrient);
  $("#camLevel").hidden=false;$("#camLvlOn").hidden=true;
  clearTimeout(orientTimer);orientTimer=setTimeout(()=>{if(!orientSeen){
    const ios=typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function";
    $("#camLevel").hidden=!ios;$("#camLvlOn").hidden=!ios}},1500);
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:3840},height:{ideal:2160}}});
  }catch(e){
    window.removeEventListener("deviceorientation",onOrient);
    alert("The camera couldn't open. Allow camera access for this site in your browser settings. If you opened the link inside another app (like Facebook or Messenger), open it in Chrome or Safari instead.");return;
  }
  const v=$("#camVideo");v.srcObject=stream;$("#cam").hidden=false;document.body.style.overflow="hidden";
  cancelAnimationFrame(raf);loop();
  try{await v.play()}catch(_){}
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
  if(!r){card=null;if(!lostSince)lostSince=performance.now();
    align={ok:false,msg:performance.now()-lostSince>3000?"Can't see the card's edges. Try a darker, plain surface":"Line the card up with the frame"};return}
  lostSince=0;
  const m=v2o(v,W,H),k=v.videoWidth/sw;
  const cx=m.ox+r.cx*k*m.sc,cy=m.oy+r.cy*k*m.sc,maj=r.major*k*m.sc,min=r.minor*k*m.sc;
  // angle of the long side away from vertical, in degrees
  let ang=Math.abs((r.angle*180/Math.PI)%180);ang=Math.abs(90-ang);
  card={cx,cy,maj,min,a:r.angle,quad:r.quad?r.quad.map(p=>({x:m.ox+p.x*k*m.sc,y:m.oy+p.y*k*m.sc})):null};
  const f=frameRect(W,H),fcx=f.x+f.w/2,fcy=f.y+f.h/2;
  const off=Math.hypot(cx-fcx,cy-fcy)/f.h,size=maj/f.h;
  let msg="";
  if(ang>45)msg="Turn the card upright";
  else if(size<.72)msg="Move closer";
  else if(size>1.14)msg="Move back a little";
  else if(off>.09)msg="Center the card in the frame";
  else if(ang>7)msg="Straighten the card";
  align={ok:!msg,msg};if(!msg)lastGood=performance.now();
}
function loop(){
  try{draw()}catch(e){try{console.warn("camera overlay",e)}catch(_){}}
  if(stream)raf=requestAnimationFrame(loop);
}
function draw(){
  const cv=$("#camOverlay"),r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  if(cv.width!==Math.round(r.width*dpr)){cv.width=Math.round(r.width*dpr);cv.height=Math.round(r.height*dpr)}
  const x=cv.getContext("2d"),W=cv.width,H=cv.height;x.clearRect(0,0,W,H);
  const now=performance.now();
  if(now-lastCheck>CHECK_MS){lastCheck=now;checkAlignment(W,H)}
  const f=frameRect(W,H);
  const levelOk=!orientSeen||(tilt&&tilt.t<LEVEL_OK);
  const levelSoft=!orientSeen||(tilt&&tilt.t<LEVEL_SOFT);
  const alignOk=!!(align&&align.ok)||(lastGood&&now-lastGood<GRACE_MS);
  const allOk=levelSoft&&alignOk;const need=levelOk?HOLD_MS:SOFT_HOLD_MS;
  // dim outside the frame
  x.fillStyle="rgba(0,0,0,.45)";x.beginPath();x.rect(0,0,W,H);x.rect(f.x,f.y,f.w,f.h);x.fill("evenodd");
  // tight grid inside the frame: 6 across, 8 down (square-ish cells on a 5:7 card)
  x.strokeStyle="rgba(255,255,255,.32)";x.lineWidth=1*dpr;
  for(let i=1;i<6;i++){if(i===3)continue;const gx=f.x+f.w*i/6;x.beginPath();x.moveTo(gx,f.y);x.lineTo(gx,f.y+f.h);x.stroke()}
  for(let i=1;i<8;i++){if(i===4)continue;const gy=f.y+f.h*i/8;x.beginPath();x.moveTo(f.x,gy);x.lineTo(f.x+f.w,gy);x.stroke()}
  // border guide: where a typical printed border sits, to help square the card
  x.strokeStyle="rgba(120,200,255,.6)";x.setLineDash([5*dpr,5*dpr]);x.strokeRect(f.x+f.w*.06,f.y+f.h*.045,f.w*.88,f.h*.91);x.setLineDash([]);
  // centre lines, full length
  const cx=f.x+f.w/2,cy=f.y+f.h/2;
  x.strokeStyle="rgba(255,255,255,.8)";x.lineWidth=1.6*dpr;
  x.beginPath();x.moveTo(cx,f.y);x.lineTo(cx,f.y+f.h);x.moveTo(f.x,cy);x.lineTo(f.x+f.w,cy);x.stroke();
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
    const left=Math.max(0,need-(now-goodSince));
    if(auto&&!taken){msgEl.textContent=left>0?(levelOk?"Lined up and level. Hold still…":"Almost level. Hold still…"):"Taking photo…";
      // countdown ring around the shutter
      const sh=$("#camShot");if(sh)sh.style.boxShadow=`0 0 0 ${3+Math.round(6*(1-left/need))}px #2FD37F`;
      if(left===0)capture(true)}
    else msgEl.textContent="Lined up and level. Tap the shutter";
  }else{
    goodSince=0;{const sh=$("#camShot");if(sh)sh.style.boxShadow=""}
    if(!alignOk)msgEl.textContent=align?align.msg:"Line the card up with the frame";
    else msgEl.textContent=`Level the phone: tilted ${tilt.t.toFixed(1)}°. Center the bubble`;
  }
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
