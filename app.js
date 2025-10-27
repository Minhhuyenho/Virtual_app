const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadedImg = document.getElementById('uploadedImg');

let overlayImg = null;
let overlaySrc = '';
let overlayType = '';
let overlayScale = 1.0;
let overlayOffsetY = 0.0;
let faceMesh = null;
let isUsingUploadedImage = false;
let camera = null;
let detectedLandmarks = null;
let currentStream = null;

// Face mesh indices for different overlay types
const FACE_LANDMARKS = {
  glasses: {
    // Left eye outer corner (point 33) and right eye outer corner (point 263)
    left: 33, right: 263, top: 10, bottom: 152
  },
  hat: {
    // Forehead points
    top: 10, bottom: 152, left: 234, right: 454
  },
  shirt: {
    // Lower face/neck area
    top: 152, bottom: 175, left: 234, right: 454
  }
};

// Initialize MediaPipe Face Mesh
function initFaceMesh() {
  if (typeof FaceMesh === 'undefined') {
    status.textContent = 'Loading face detection models...';
    setTimeout(initFaceMesh, 100);
    return;
  }
  
  const faceMeshModel = new FaceMesh({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
    }
  });

  faceMeshModel.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  faceMeshModel.onResults(onResults);
  faceMesh = faceMeshModel;
  status.textContent = 'Ready - No face detected';
  status.className = 'status';
  startCamera();
}

// Handle face detection results
function onResults(results) {
  detectedLandmarks = results.multiFaceLandmarks && results.multiFaceLandmarks[0] 
    ? results.multiFaceLandmarks[0] 
    : null;
  
  if (detectedLandmarks) {
    status.textContent = 'Face detected ✓';
    status.className = 'status detected';
    draw();
  } else {
    status.textContent = 'No face detected';
    status.className = 'status';
    if (!isUsingUploadedImage) {
      draw(); // Still draw video even if no face is detected
    }
  }
}

// Start camera
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user' }, 
      audio: false 
    });
    video.srcObject = stream;
    currentStream = stream;
    canvas.width = 360;
    canvas.height = 640;
    
    camera = new Camera(video, {
      onFrame: async () => {
        await faceMesh.send({ image: video });
      },
      width: 360,
      height: 640
    });
    camera.start();
    status.textContent = 'Camera ready - Face detection active';
    requestAnimationFrame(draw);
  } catch (err) {
    status.textContent = 'Camera error: ' + err.message;
    status.className = 'status error';
  }
}

// Calculate overlay position based on face landmarks
function calculateOverlayPosition(type, landmarks, imgWidth, imgHeight) {
  if (!landmarks || !type) return null;

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const faceBox = calculateFaceBox(landmarks, canvasWidth, canvasHeight);
  
  let x, y, width, height;

  if (type === 'glasses') {
    // Position glasses on eyes
    const eyeRegion = {
      left: faceBox.x + faceBox.width * 0.3,
      right: faceBox.x + faceBox.width * 0.7,
      top: faceBox.y + faceBox.height * 0.25,
      bottom: faceBox.y + faceBox.height * 0.45
    };
    width = (eyeRegion.right - eyeRegion.left) * overlayScale;
    height = (imgHeight / imgWidth) * width;
    x = eyeRegion.left - width * 0.1;
    y = eyeRegion.top - height * 0.3 + (canvasHeight * overlayOffsetY);
  } 
  else if (type === 'hat') {
    // Position hat on forehead/head
    width = faceBox.width * overlayScale;
    height = (imgHeight / imgWidth) * width;
    x = faceBox.x + (faceBox.width - width) / 2;
    y = faceBox.y - height * 0.7 + (canvasHeight * overlayOffsetY);
  }
  else if (type === 'shirt') {
    // Position shirt on lower face/neck
    width = faceBox.width * overlayScale * 1.5;
    height = (imgHeight / imgWidth) * width;
    x = faceBox.x + (faceBox.width - width) / 2;
    y = faceBox.y + faceBox.height * 0.6 + (canvasHeight * overlayOffsetY);
  }
  else {
    return null;
  }

  return { x, y, width, height };
}

// Calculate face bounding box from landmarks
function calculateFaceBox(landmarks, width, height) {
  let minX = width, maxX = 0, minY = height, maxY = 0;

  landmarks.forEach(landmark => {
    const x = landmark.x * width;
    const y = landmark.y * height;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

// Draw video/image + overlay with face detection
function draw() {
  if (isUsingUploadedImage) {
    if (uploadedImg.complete && uploadedImg.naturalWidth > 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(uploadedImg, 0, 0, canvas.width, canvas.height);
      
      if (overlayImg && overlayImg.complete && overlaySrc && detectedLandmarks) {
        const pos = calculateOverlayPosition(overlayType, detectedLandmarks, overlayImg.width, overlayImg.height);
        if (pos) {
          ctx.drawImage(overlayImg, pos.x, pos.y, pos.width, pos.height);
        }
      }
    }
  } else {
    // Camera mode
    if (video.readyState >= 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (overlayImg && overlayImg.complete && overlaySrc && detectedLandmarks) {
        const pos = calculateOverlayPosition(overlayType, detectedLandmarks, overlayImg.width, overlayImg.height);
        if (pos) {
          ctx.drawImage(overlayImg, pos.x, pos.y, pos.width, pos.height);
        }
      }
    }
    requestAnimationFrame(draw);
  }
}

// Handle file upload
uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    uploadedImg.src = event.target.result;
    await uploadedImg.decode();
    
    // Stop camera
    if (camera) {
      camera.stop();
      camera = null;
    }
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }

    isUsingUploadedImage = true;
    
    // Set canvas to match uploaded image
    canvas.width = uploadedImg.naturalWidth;
    canvas.height = uploadedImg.naturalHeight;

    status.textContent = 'Processing image...';
    status.className = 'status';

    // Process image with face mesh
    await faceMesh.send({ image: uploadedImg });
    
    // Start draw loop for uploaded images
    if (isUsingUploadedImage) {
      function drawLoop() {
        draw();
        if (isUsingUploadedImage) {
          requestAnimationFrame(drawLoop);
        }
      }
      drawLoop();
    }
  };
  reader.readAsDataURL(file);
});

// Thumbnail buttons
document.querySelectorAll('.thumb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.thumb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const src = btn.dataset.src;
    const type = btn.dataset.type;
    
    if (!src) {
      overlaySrc = '';
      overlayType = '';
      overlayImg = null;
      draw();
      return;
    }
    
    overlayImg = new Image();
    overlayImg.onload = () => { 
      overlaySrc = src;
      overlayType = type;
      draw();
    };
    overlayImg.src = src;
  });
});

// Sliders
document.getElementById('scale').addEventListener('input', (e) => {
  overlayScale = parseFloat(e.target.value);
  draw();
});

document.getElementById('offY').addEventListener('input', (e) => {
  overlayOffsetY = parseFloat(e.target.value);
  draw();
});

// Settings button
document.getElementById('settings').addEventListener('click', () => {
  // Reset to camera
  if (isUsingUploadedImage) {
    isUsingUploadedImage = false;
    fileInput.value = '';
    uploadedImg.style.display = 'none';
    
    // Clear overlay
    overlaySrc = '';
    overlayType = '';
    overlayImg = null;
    
    // Reinitialize camera
    startCamera();
  }
});

// Initialize
initFaceMesh();