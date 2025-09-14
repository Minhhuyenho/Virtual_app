const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let overlayImg = null;
let overlaySrc = '';
let overlayScale = 0.7;
let overlayOffsetY = -0.05;

// Start camera
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth || 360;
    canvas.height = video.videoHeight || 640;
    requestAnimationFrame(draw);
  } catch(err){
    alert('Cannot access camera: ' + err.message);
  }
}

// Draw video + overlay
function draw(){
  if(video.readyState >= 2){
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if(overlayImg && overlayImg.complete && overlaySrc){
      const w = canvas.width * overlayScale;
      const h = overlayImg.height / overlayImg.width * w;
      const x = (canvas.width - w) / 2;
      const y = canvas.height * overlayOffsetY;
      ctx.drawImage(overlayImg, x, y, w, h);
    }
  }
  requestAnimationFrame(draw);
}

// Thumbnail buttons
document.querySelectorAll('.thumb').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const src = btn.dataset.src;
    if(!src){
      overlaySrc = '';
      overlayImg = null;
      return;
    }
    overlayImg = new Image();
    overlayImg.onload = ()=> { overlaySrc = src; } // Only update after load
    overlayImg.src = src;
  });
});

// Sliders
document.getElementById('scale').addEventListener('input', (e)=>{
  overlayScale = parseFloat(e.target.value);
});
document.getElementById('offY').addEventListener('input', (e)=>{
  overlayOffsetY = parseFloat(e.target.value);
});

startCamera();
