const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const captureBtn = document.getElementById('captureBtn');
const saveBtn = document.getElementById('saveBtn');
const backToCameraBtn = document.getElementById('backToCameraBtn');
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

// Capture photo from webcam
captureBtn.addEventListener('click', async () => {
  try {
    // Capture current frame from video (before overlay is drawn)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    
    // Convert to image data
    uploadedImg.src = tempCanvas.toDataURL('image/png');
    uploadedImg.style.display = 'block';
    
    // Stop camera
    if (camera) {
      camera.stop();
      camera = null;
    }
    
    isUsingUploadedImage = true;
    
    // Set canvas size
    canvas.width = tempCanvas.width;
    canvas.height = tempCanvas.height;
    
    status.textContent = 'Processing captured photo...';
    status.className = 'status';
    
    // Wait for image to load and process with face mesh
    await uploadedImg.decode();
    await faceMesh.send({ image: uploadedImg });
    
    // Draw the captured image on canvas
    draw();
    
    status.textContent = 'Photo captured! ✓';
    status.className = 'status detected';
    
    // Show back to camera button
    backToCameraBtn.style.display = 'block';
    
    // Start draw loop for captured images
    if (isUsingUploadedImage) {
      function drawLoop() {
        draw();
        if (isUsingUploadedImage) {
          requestAnimationFrame(drawLoop);
        }
      }
      drawLoop();
    }
  } catch (err) {
    status.textContent = 'Capture failed: ' + err.message;
    status.className = 'status error';
  }
});


// Save image
saveBtn.addEventListener('click', async () => {
  // If in camera mode, we need to capture first
  if (!isUsingUploadedImage) {
    status.textContent = 'Capturing photo...';
    captureBtn.click();
    // Wait for capture to complete
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  downloadImage();
});

function downloadImage() {
  try {
    // Get canvas data
    const imageData = canvas.toDataURL('image/png');
    
    // Create download link
    const link = document.createElement('a');
    link.download = `virtual-tryon-${Date.now()}.png`;
    link.href = imageData;
    link.click();
    
    status.textContent = 'Image saved! ✓';
    status.className = 'status detected';
    setTimeout(() => {
      if (isUsingUploadedImage) {
        status.textContent = 'Photo captured! ✓';
      } else {
        status.textContent = 'Face detection active';
      }
    }, 2000);
  } catch (err) {
    status.textContent = 'Failed to save image';
    status.className = 'status error';
  }
}

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

// Back to camera button
backToCameraBtn.addEventListener('click', () => {
  resetToCamera();
});

// Function to reset to camera mode
function resetToCamera() {
  isUsingUploadedImage = false;
  uploadedImg.style.display = 'none';
  uploadedImg.src = '';
  backToCameraBtn.style.display = 'none';
  
  // Clear overlay
  overlaySrc = '';
  overlayType = '';
  overlayImg = null;
  
  // Deactivate thumb buttons
  document.querySelectorAll('.thumb').forEach(b => b.classList.remove('active'));
  
  // Reinitialize camera
  startCamera();
}

// Initialize
initFaceMesh();