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
let faceRotation = { roll: 0, pitch: 0, yaw: 0 }; // Face rotation angles in radians
let referenceFaceSize = null; // Reference face size for distance calculation
let referenceEyeDistance = null; // Reference eye distance for scaling glasses
let referenceFaceWidth = null; // Reference face width for scaling hats/shirts

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
    // Calculate face rotation angles
    faceRotation = calculateFaceRotation(detectedLandmarks);
    
    // Update reference measurements for smart fitting
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    // Store reference eye distance for glasses scaling
    const leftEye = getLandmark(detectedLandmarks, 33, canvasWidth, canvasHeight);
    const rightEye = getLandmark(detectedLandmarks, 263, canvasWidth, canvasHeight);
    if (leftEye && rightEye) {
      const currentEyeDistance = calculateDistance(leftEye, rightEye);
      if (!referenceEyeDistance) {
        referenceEyeDistance = currentEyeDistance;
      }
    }
    
    // Store reference face width for hats/shirts
    const faceLeft = getLandmark(detectedLandmarks, 234, canvasWidth, canvasHeight);
    const faceRight = getLandmark(detectedLandmarks, 454, canvasWidth, canvasHeight);
    if (faceLeft && faceRight) {
      const currentFaceWidth = calculateDistance(faceLeft, faceRight);
      if (!referenceFaceWidth) {
        referenceFaceWidth = currentFaceWidth;
      }
    }
    
    // Update reference face size for overall distance estimation
    const faceBox = calculateFaceBox(detectedLandmarks, canvas.width, canvas.height);
    const currentFaceSize = Math.sqrt(faceBox.width * faceBox.width + faceBox.height * faceBox.height);
    if (!referenceFaceSize) {
      referenceFaceSize = currentFaceSize;
    }
    
    status.textContent = 'Face detected ✓';
    status.className = 'status detected';
    draw();
  } else {
    status.textContent = 'No face detected';
    status.className = 'status';
    // Reset references when face is lost
    referenceFaceSize = null;
    referenceEyeDistance = null;
    referenceFaceWidth = null;
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

// Get landmark point in canvas coordinates
function getLandmark(landmarks, index, canvasWidth, canvasHeight) {
  if (!landmarks || index >= landmarks.length) return null;
  return {
    x: landmarks[index].x * canvasWidth,
    y: landmarks[index].y * canvasHeight
  };
}

// Calculate distance between two points
function calculateDistance(p1, p2) {
  if (!p1 || !p2) return 0;
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// Calculate 3D rotation angles from face landmarks
function calculateFaceRotation(landmarks) {
  if (!landmarks || landmarks.length < 468) return { roll: 0, pitch: 0, yaw: 0 };
  
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  
  // Key landmarks for rotation calculation
  // Left eye outer corner: 33, Right eye outer corner: 263
  // Left eye inner corner: 133, Right eye inner corner: 362
  // Nose tip: 1, Forehead center: 10, Chin: 175
  // Left cheek: 234, Right cheek: 454
  // Left temple: 234, Right temple: 454
  
  const leftEyeOuter = getLandmark(landmarks, 33, canvasWidth, canvasHeight);
  const rightEyeOuter = getLandmark(landmarks, 263, canvasWidth, canvasHeight);
  const leftEyeInner = getLandmark(landmarks, 133, canvasWidth, canvasHeight);
  const rightEyeInner = getLandmark(landmarks, 362, canvasWidth, canvasHeight);
  const forehead = getLandmark(landmarks, 10, canvasWidth, canvasHeight);
  const chin = getLandmark(landmarks, 175, canvasWidth, canvasHeight);
  const noseTip = getLandmark(landmarks, 1, canvasWidth, canvasHeight);
  const leftCheek = getLandmark(landmarks, 234, canvasWidth, canvasHeight);
  const rightCheek = getLandmark(landmarks, 454, canvasWidth, canvasHeight);
  
  let roll = 0, pitch = 0, yaw = 0;
  
  // Calculate ROLL (head tilt left/right) - angle between eyes
  if (leftEyeOuter && rightEyeOuter) {
    const eyeAngle = Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x);
    roll = eyeAngle;
  }
  
  // Calculate PITCH (head up/down) - using forehead to chin distance
  if (forehead && chin && noseTip) {
    // Vertical distance from forehead to chin
    const verticalDistance = chin.y - forehead.y;
    // Horizontal distance from nose to face center
    const faceCenterX = (leftCheek && rightCheek) ? (leftCheek.x + rightCheek.x) / 2 : noseTip.x;
    const horizontalDistance = Math.abs(noseTip.x - faceCenterX);
    
    if (verticalDistance > 0) {
      // Calculate pitch based on vertical to horizontal ratio
      pitch = Math.atan2(horizontalDistance, verticalDistance) * 0.3; // Dampened for stability
    }
    
    // Also consider forehead-to-chin relative to eye level
    const eyeLevel = leftEyeOuter && rightEyeOuter ? (leftEyeOuter.y + rightEyeOuter.y) / 2 : noseTip.y;
    if (forehead && chin) {
      const faceHeight = chin.y - forehead.y;
      const noseOffset = noseTip.y - eyeLevel;
      if (faceHeight > 0) {
        pitch = (noseOffset / faceHeight) * Math.PI * 0.2; // Pitch in radians, dampened
      }
    }
  }
  
  // Calculate YAW (head left/right turn) - using cheek symmetry
  if (leftCheek && rightCheek && noseTip) {
    const leftDistance = calculateDistance(noseTip, leftCheek);
    const rightDistance = calculateDistance(noseTip, rightCheek);
    const totalWidth = leftDistance + rightDistance;
    
    if (totalWidth > 0) {
      // Normalize and convert to angle (-1 to 1 range)
      const asymmetry = (rightDistance - leftDistance) / totalWidth;
      yaw = asymmetry * Math.PI * 0.3; // Yaw in radians, limited to ±30 degrees
    }
  }
  
  // Smooth rotation values to reduce jitter
  const smoothingFactor = 0.7;
  const currentRoll = (faceRotation && faceRotation.roll !== undefined) ? faceRotation.roll : 0;
  const currentPitch = (faceRotation && faceRotation.pitch !== undefined) ? faceRotation.pitch : 0;
  const currentYaw = (faceRotation && faceRotation.yaw !== undefined) ? faceRotation.yaw : 0;
  
  faceRotation.roll = currentRoll * smoothingFactor + roll * (1 - smoothingFactor);
  faceRotation.pitch = currentPitch * smoothingFactor + pitch * (1 - smoothingFactor);
  faceRotation.yaw = currentYaw * smoothingFactor + yaw * (1 - smoothingFactor);
  
  return { roll: faceRotation.roll, pitch: faceRotation.pitch, yaw: faceRotation.yaw };
}

// Calculate smart scale factor based on eye distance (primary for glasses)
function calculateEyeDistanceScale() {
  if (!referenceEyeDistance || !detectedLandmarks) return 1.0;
  
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const leftEye = getLandmark(detectedLandmarks, 33, canvasWidth, canvasHeight);
  const rightEye = getLandmark(detectedLandmarks, 263, canvasWidth, canvasHeight);
  
  if (!leftEye || !rightEye) return 1.0;
  
  const currentEyeDistance = calculateDistance(leftEye, rightEye);
  
  // Scale based on eye distance ratio (maintains proportion across different faces and distances)
  const scaleFactor = currentEyeDistance / referenceEyeDistance;
  
  // Clamp scale factor to reasonable range (0.4x to 2.5x)
  return Math.max(0.4, Math.min(2.5, scaleFactor));
}

// Calculate smart scale factor based on face width (for hats and shirts)
function calculateFaceWidthScale() {
  if (!referenceFaceWidth || !detectedLandmarks) return 1.0;
  
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const faceLeft = getLandmark(detectedLandmarks, 234, canvasWidth, canvasHeight);
  const faceRight = getLandmark(detectedLandmarks, 454, canvasWidth, canvasHeight);
  
  if (!faceLeft || !faceRight) return 1.0;
  
  const currentFaceWidth = calculateDistance(faceLeft, faceRight);
  
  // Scale based on face width ratio
  const scaleFactor = currentFaceWidth / referenceFaceWidth;
  
  // Clamp scale factor to reasonable range (0.4x to 2.5x)
  return Math.max(0.4, Math.min(2.5, scaleFactor));
}

// Calculate distance-based scale factor (fallback/overall)
function calculateDistanceScale() {
  if (!referenceFaceSize || !detectedLandmarks) return 1.0;
  
  const faceBox = calculateFaceBox(detectedLandmarks, canvas.width, canvas.height);
  const currentFaceSize = Math.sqrt(faceBox.width * faceBox.width + faceBox.height * faceBox.height);
  
  // Scale inversely proportional to face size (closer = larger face = larger overlay)
  const scaleFactor = referenceFaceSize / currentFaceSize;
  
  // Clamp scale factor to reasonable range (0.5x to 2x)
  return Math.max(0.5, Math.min(2.0, scaleFactor));
}

/**
 * Smart Fitting System for Virtual Try-On
 * 
 * This function implements intelligent automatic scaling and positioning:
 * 
 * 1. SCALING:
 *    - Glasses: Uses eye distance (left/right eye corners) as primary reference
 *    - Hats: Uses face width (temple-to-temple) as primary reference  
 *    - Shirts: Uses jaw width as primary reference
 * 
 * 2. POSITIONING:
 *    - Glasses: Aligned precisely with eye center (between inner/outer corners)
 *    - Hats: Aligned with forehead landmark and face center
 *    - Shirts: Aligned with chin landmark and body center
 * 
 * 3. CONTINUOUS UPDATES:
 *    - Automatically adjusts as user moves closer/farther (distance-based scaling)
 *    - Tracks rotation and applies perspective transformations
 *    - Maintains proportions across different face sizes
 * 
 * @param {string} type - Overlay type: 'glasses', 'hat', or 'shirt'
 * @param {Array} landmarks - MediaPipe face mesh landmarks (468 points)
 * @param {number} imgWidth - Overlay image width
 * @param {number} imgHeight - Overlay image height
 * @returns {Object} Position and size data with rotation center points
 */
function calculateOverlayPosition(type, landmarks, imgWidth, imgHeight) {
  if (!landmarks || !type) return null;

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const faceBox = calculateFaceBox(landmarks, canvasWidth, canvasHeight);
  
  let x, y, width, height, centerX, centerY;
  
  // Smart fitting multipliers - calibrated for realistic proportions
  const smartFittingMultipliers = {
    glasses: 2.2,  // Eye distance multiplier for glasses
    hat: 1.6,       // Face width multiplier for hats
    shirt: 2.4      // Face width multiplier for shirts
  };
  
  const fittingMultiplier = smartFittingMultipliers[type] || 1.0;

  if (type === 'glasses') {
    // SMART FITTING: Use eye distance as primary scale reference
    const leftEye = getLandmark(landmarks, 33, canvasWidth, canvasHeight);
    const rightEye = getLandmark(landmarks, 263, canvasWidth, canvasHeight);
    const leftEyeInner = getLandmark(landmarks, 133, canvasWidth, canvasHeight);
    const rightEyeInner = getLandmark(landmarks, 362, canvasWidth, canvasHeight);
    
    if (leftEye && rightEye) {
      // Calculate eye distance - primary scaling reference
      const eyeDistance = calculateDistance(leftEye, rightEye);
      
      // Use smart eye-distance-based scaling
      const eyeScale = calculateEyeDistanceScale();
      
      // Calculate width based on eye distance with smart fitting
      width = eyeDistance * fittingMultiplier * overlayScale * eyeScale;
      
      // Calculate precise center position aligned with eye level
      centerX = (leftEye.x + rightEye.x) / 2;
      
      // Use eye center point for vertical alignment (between inner and outer corners)
      let eyeCenterY;
      if (leftEyeInner && rightEyeInner) {
        const leftEyeCenter = (leftEye.y + leftEyeInner.y) / 2;
        const rightEyeCenter = (rightEye.y + rightEyeInner.y) / 2;
        eyeCenterY = (leftEyeCenter + rightEyeCenter) / 2;
      } else {
        eyeCenterY = (leftEye.y + rightEye.y) / 2;
      }
      
      centerY = eyeCenterY;
      
      // Calculate aspect-ratio-preserved height
      height = (imgHeight / imgWidth) * width;
      
      // Position glasses centered on eyes, slightly above eye level
      x = centerX - width / 2;
      y = centerY - height * 0.45 + (canvasHeight * overlayOffsetY);
    } else {
      // Fallback to face box if eyes not detected
      const fallbackScale = calculateDistanceScale();
      width = faceBox.width * 0.6 * fittingMultiplier * overlayScale * fallbackScale;
      height = (imgHeight / imgWidth) * width;
      centerX = faceBox.x + faceBox.width / 2;
      centerY = faceBox.y + faceBox.height * 0.25;
      x = centerX - width / 2;
      y = centerY - height * 0.5 + (canvasHeight * overlayOffsetY);
    }
  } 
  else if (type === 'hat') {
    // SMART FITTING: Use face width as primary scale reference
    const faceLeft = getLandmark(landmarks, 234, canvasWidth, canvasHeight);  // Left temple
    const faceRight = getLandmark(landmarks, 454, canvasWidth, canvasHeight); // Right temple
    const forehead = getLandmark(landmarks, 10, canvasWidth, canvasHeight); // Top of head
    const leftEye = getLandmark(landmarks, 33, canvasWidth, canvasHeight);
    const rightEye = getLandmark(landmarks, 263, canvasWidth, canvasHeight);
    
    if (faceLeft && faceRight) {
      // Calculate face width - primary scaling reference
      const faceWidth = calculateDistance(faceLeft, faceRight);
      
      // Use smart face-width-based scaling
      const faceScale = calculateFaceWidthScale();
      
      // Calculate width based on face width with smart fitting
      width = faceWidth * fittingMultiplier * overlayScale * faceScale;
      height = (imgHeight / imgWidth) * width;
      
      // Precise positioning aligned with forehead and face center
      if (forehead) {
        // Use forehead point as vertical reference
        centerX = (faceLeft.x + faceRight.x) / 2;
        centerY = forehead.y;
        x = centerX - width / 2;
        // Position hat above forehead
        y = forehead.y - height * 0.75 + (canvasHeight * overlayOffsetY);
      } else if (leftEye && rightEye) {
        // Fallback: estimate forehead from eye position
        const eyeMidpointY = (leftEye.y + rightEye.y) / 2;
        centerX = (faceLeft.x + faceRight.x) / 2;
        centerY = eyeMidpointY - faceBox.height * 0.15;
        x = centerX - width / 2;
        y = centerY - height * 0.75 + (canvasHeight * overlayOffsetY);
      } else {
        centerX = faceBox.x + faceBox.width / 2;
        centerY = faceBox.y;
        x = centerX - width / 2;
        y = faceBox.y - height * 0.7 + (canvasHeight * overlayOffsetY);
      }
    } else {
      // Fallback
      const fallbackScale = calculateDistanceScale();
      width = faceBox.width * fittingMultiplier * overlayScale * fallbackScale;
      height = (imgHeight / imgWidth) * width;
      centerX = faceBox.x + faceBox.width / 2;
      centerY = faceBox.y;
      x = centerX - width / 2;
      y = faceBox.y - height * 0.7 + (canvasHeight * overlayOffsetY);
    }
  }
  else if (type === 'shirt') {
    // SMART FITTING: Use jaw width as primary scale reference
    const jawLeft = getLandmark(landmarks, 234, canvasWidth, canvasHeight);  // Left jaw
    const jawRight = getLandmark(landmarks, 454, canvasWidth, canvasHeight); // Right jaw
    const chin = getLandmark(landmarks, 175, canvasWidth, canvasHeight); // Chin point
    const noseTip = getLandmark(landmarks, 1, canvasWidth, canvasHeight);
    
    if (jawLeft && jawRight) {
      // Calculate jaw width - primary scaling reference
      const jawWidth = calculateDistance(jawLeft, jawRight);
      
      // Use smart face-width-based scaling
      const faceScale = calculateFaceWidthScale();
      
      // Calculate width based on jaw width with smart fitting
      width = jawWidth * fittingMultiplier * overlayScale * faceScale;
      height = (imgHeight / imgWidth) * width;
      
      // Precise positioning aligned with chin and body center
      if (chin) {
        // Use chin as vertical reference point
        centerX = (jawLeft.x + jawRight.x) / 2;
        centerY = chin.y;
        x = centerX - width / 2;
        // Position shirt starting from chin level
        y = chin.y - height * 0.25 + (canvasHeight * overlayOffsetY);
      } else if (noseTip) {
        // Fallback: estimate chin position from nose
        centerX = (jawLeft.x + jawRight.x) / 2;
        centerY = noseTip.y + faceBox.height * 0.3;
        x = centerX - width / 2;
        y = centerY - height * 0.25 + (canvasHeight * overlayOffsetY);
      } else {
        centerX = faceBox.x + faceBox.width / 2;
        centerY = faceBox.y + faceBox.height * 0.6;
        x = centerX - width / 2;
        y = faceBox.y + faceBox.height * 0.6 + (canvasHeight * overlayOffsetY);
      }
    } else {
      // Fallback
      const fallbackScale = calculateDistanceScale();
      width = faceBox.width * fittingMultiplier * overlayScale * fallbackScale;
      height = (imgHeight / imgWidth) * width;
      centerX = faceBox.x + faceBox.width / 2;
      centerY = faceBox.y + faceBox.height * 0.6;
      x = centerX - width / 2;
      y = faceBox.y + faceBox.height * 0.6 + (canvasHeight * overlayOffsetY);
    }
  }
  else {
    return null;
  }

  return { 
    x, y, width, height, 
    centerX: centerX || x + width / 2, 
    centerY: centerY || y + height / 2 
  };
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

// Draw rotated overlay using canvas transformations
function drawRotatedOverlay(image, pos, rotation) {
  if (!pos || !image || !rotation) return;
  
  // Ensure rotation values exist, default to 0
  const roll = rotation.roll || 0;
  const pitch = rotation.pitch || 0;
  const yaw = rotation.yaw || 0;
  
  // Save current canvas state
  ctx.save();
  
  // Move to rotation center and apply transformations
  ctx.translate(pos.centerX, pos.centerY);
  
  // Apply rotations - roll is most important for 2D rotation (head tilt)
  ctx.rotate(roll);
  
  // Apply perspective effects from pitch and yaw using scaling
  // When looking up/down (pitch), scale vertically
  // When looking left/right (yaw), apply horizontal scaling for perspective
  const pitchScale = 1.0 + Math.sin(pitch) * 0.15;
  const yawScale = 1.0 - Math.abs(yaw) * 0.25;
  
  // Apply scaling (yaw affects horizontal, pitch affects vertical)
  ctx.scale(yawScale, pitchScale);
  
  // Draw image centered at origin (since we translated to center)
  ctx.drawImage(
    image,
    -pos.width / 2,
    -pos.height / 2,
    pos.width,
    pos.height
  );
  
  // Restore canvas state
  ctx.restore();
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
          // Draw with rotation transformation
          drawRotatedOverlay(overlayImg, pos, faceRotation);
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
          // Draw with rotation transformation
          drawRotatedOverlay(overlayImg, pos, faceRotation);
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
  
  // Reset smart fitting references to allow recalibration
  referenceFaceSize = null;
  referenceEyeDistance = null;
  referenceFaceWidth = null;
  
  // Deactivate thumb buttons
  document.querySelectorAll('.thumb').forEach(b => b.classList.remove('active'));
  
  // Reinitialize camera
  startCamera();
}

// Initialize
initFaceMesh();