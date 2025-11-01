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

// Lighting adaptation system
let lightingAnalysis = {
  brightness: 1.0,      // 0.0 (dark) to 2.0 (bright)
  contrast: 1.0,        // 0.0 to 2.0
  saturation: 1.0,      // 0.0 (grayscale) to 2.0 (vibrant)
  temperature: 6500,    // Color temperature in Kelvin (2000-10000)
  enabled: true         // Enable/disable lighting adaptation
};

let targetLighting = { ...lightingAnalysis }; // Target values for smooth transitions
let lightingSampleCanvas = null; // Hidden canvas for lighting analysis
let lightingSampleCtx = null;
let frameCount = 0; // Frame counter for performance throttling

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

// Initialize lighting analysis canvas
function initLightingAnalysis() {
  // Create a small canvas for efficient lighting sampling
  lightingSampleCanvas = document.createElement('canvas');
  lightingSampleCanvas.width = 64;  // Low resolution for performance
  lightingSampleCanvas.height = 64;
  lightingSampleCtx = lightingSampleCanvas.getContext('2d', { willReadFrequently: true });
}

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
  initLightingAnalysis(); // Initialize lighting system
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
    
    // Get container dimensions for responsive sizing
    const container = video.parentElement;
    const containerWidth = container.clientWidth || 360;
    const containerHeight = container.clientHeight || Math.round(containerWidth * 16/9);
    
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    
    camera = new Camera(video, {
      onFrame: async () => {
        await faceMesh.send({ image: video });
      },
      width: containerWidth,
      height: containerHeight
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

/**
 * Analyze lighting from video frame
 * Samples the face region and surrounding area to detect brightness and color temperature
 */
function analyzeLighting(sourceImage, faceBox) {
  if (!lightingSampleCtx || !sourceImage) return;
  
  try {
    // Resize source to sample canvas for efficient analysis
    lightingSampleCtx.clearRect(0, 0, lightingSampleCanvas.width, lightingSampleCanvas.height);
    lightingSampleCtx.drawImage(
      sourceImage,
      0, 0, sourceImage.width, sourceImage.height,
      0, 0, lightingSampleCanvas.width, lightingSampleCanvas.height
    );
    
    // Sample pixels from the face region (if detected) or center region
    const sampleSize = Math.min(lightingSampleCanvas.width, lightingSampleCanvas.height);
    const centerX = faceBox ? (faceBox.x / canvas.width) * lightingSampleCanvas.width : lightingSampleCanvas.width / 2;
    const centerY = faceBox ? (faceBox.y / canvas.height) * lightingSampleCanvas.height : lightingSampleCanvas.height / 2;
    const sampleRadius = sampleSize * 0.3;
    
    const imageData = lightingSampleCtx.getImageData(
      Math.max(0, centerX - sampleRadius),
      Math.max(0, centerY - sampleRadius),
      Math.min(sampleRadius * 2, lightingSampleCanvas.width - (centerX - sampleRadius)),
      Math.min(sampleRadius * 2, lightingSampleCanvas.height - (centerY - sampleRadius))
    );
    
    const data = imageData.data;
    let totalR = 0, totalG = 0, totalB = 0;
    let maxBrightness = 0;
    let minBrightness = 255;
    let pixelCount = 0;
    
    // Analyze each pixel
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Calculate brightness (luminance)
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      maxBrightness = Math.max(maxBrightness, brightness);
      minBrightness = Math.min(minBrightness, brightness);
      
      totalR += r;
      totalG += g;
      totalB += b;
      pixelCount++;
    }
    
    if (pixelCount === 0) return;
    
    // Calculate average RGB
    const avgR = totalR / pixelCount;
    const avgG = totalG / pixelCount;
    const avgB = totalB / pixelCount;
    const avgBrightness = (maxBrightness + minBrightness) / 2;
    const contrastRange = maxBrightness - minBrightness;
    
    // Calculate brightness adjustment (normalize to 0-1 range, then scale)
    const brightnessRatio = avgBrightness / 128; // 128 is middle gray
    targetLighting.brightness = Math.max(0.5, Math.min(1.5, brightnessRatio));
    
    // Calculate contrast (based on dynamic range)
    const contrastRatio = contrastRange / 128;
    targetLighting.contrast = Math.max(0.8, Math.min(1.3, 0.9 + contrastRatio * 0.4));
    
    // Calculate saturation (colorfulness)
    const colorVariance = Math.sqrt(
      Math.pow(avgR - avgBrightness, 2) +
      Math.pow(avgG - avgBrightness, 2) +
      Math.pow(avgB - avgBrightness, 2)
    ) / 128;
    targetLighting.saturation = Math.max(0.7, Math.min(1.3, 0.9 + colorVariance * 0.4));
    
    // Calculate color temperature from RGB balance
    // Warmer (red/yellow) = lower temp, Cooler (blue) = higher temp
    const colorBalance = avgR > avgB ? (avgR / (avgR + avgB)) : (avgB / (avgR + avgB));
    // Map to color temperature range (2000K-10000K)
    targetLighting.temperature = 4000 + (colorBalance * 4000); // Adjust range as needed
    
    // Smooth transitions to avoid flickering
    const smoothingFactor = 0.85; // Higher = slower transitions
    lightingAnalysis.brightness = lightingAnalysis.brightness * smoothingFactor + targetLighting.brightness * (1 - smoothingFactor);
    lightingAnalysis.contrast = lightingAnalysis.contrast * smoothingFactor + targetLighting.contrast * (1 - smoothingFactor);
    lightingAnalysis.saturation = lightingAnalysis.saturation * smoothingFactor + targetLighting.saturation * (1 - smoothingFactor);
    lightingAnalysis.temperature = lightingAnalysis.temperature * smoothingFactor + targetLighting.temperature * (1 - smoothingFactor);
    
  } catch (err) {
    // Silently fail if analysis encounters issues
    console.warn('Lighting analysis error:', err);
  }
}

/**
 * Apply lighting adaptation to an image using canvas filters
 * Returns a filtered image element
 */
function applyLightingAdaptation(image) {
  if (!lightingAnalysis.enabled || !image) return image;
  
  // Create temporary canvas for lighting effects
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext('2d');
  
  // Draw original image
  tempCtx.drawImage(image, 0, 0);
  
  // Get image data
  const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  const data = imageData.data;
  
  // Apply lighting adjustments
  const brightness = lightingAnalysis.brightness;
  const contrast = lightingAnalysis.contrast;
  const saturation = lightingAnalysis.saturation;
  const tempAdjustment = (lightingAnalysis.temperature - 6500) / 6500; // Normalize around 6500K
  
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    
    // Apply brightness
    r = r * brightness;
    g = g * brightness;
    b = b * brightness;
    
    // Apply contrast
    const contrastFactor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;
    
    // Apply color temperature (warm/cool shift)
    if (tempAdjustment > 0) {
      // Cooler (add blue, reduce red)
      r = r * (1 - tempAdjustment * 0.3);
      b = b * (1 + tempAdjustment * 0.3);
    } else {
      // Warmer (add red/yellow, reduce blue)
      r = r * (1 - tempAdjustment * 0.3);
      g = g * (1 - tempAdjustment * 0.2);
      b = b * (1 + tempAdjustment * 0.3);
    }
    
    // Apply saturation
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * saturation;
    g = gray + (g - gray) * saturation;
    b = gray + (b - gray) * saturation;
    
    // Clamp values
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  
  // Put modified data back
  tempCtx.putImageData(imageData, 0, 0);
  
  // Create new image from canvas
  const adaptedImage = new Image();
  adaptedImage.src = tempCanvas.toDataURL();
  adaptedImage.width = image.width;
  adaptedImage.height = image.height;
  
  return adaptedImage;
}

// Draw rotated overlay using canvas transformations with lighting adaptation
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
  
  // Apply lighting adaptation filters if enabled
  if (lightingAnalysis.enabled) {
    // Use globalCompositeOperation for blending modes
    ctx.globalCompositeOperation = 'source-over';
    
    // Apply brightness and contrast using filter operations
    ctx.filter = `brightness(${lightingAnalysis.brightness}) contrast(${lightingAnalysis.contrast}) saturate(${lightingAnalysis.saturation})`;
    
    // For color temperature, we'll use a color matrix approach via globalCompositeOperation
    // This is more performant than pixel-by-pixel manipulation
    const tempRatio = (lightingAnalysis.temperature - 6500) / 6500;
    
    // Create a color overlay for temperature adjustment
    if (Math.abs(tempRatio) > 0.05) { // Only apply if significant change
      const tempAlpha = Math.abs(tempRatio) * 0.3; // Subtle effect
      if (tempRatio > 0) {
        // Cooler (blue tint)
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgba(150, 180, 255, ${tempAlpha})`;
        ctx.fillRect(-pos.width / 2, -pos.height / 2, pos.width, pos.height);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        // Warmer (orange/yellow tint)
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgba(255, 220, 180, ${Math.abs(tempAlpha)})`;
        ctx.fillRect(-pos.width / 2, -pos.height / 2, pos.width, pos.height);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
  
  // Draw image centered at origin (since we translated to center)
  ctx.drawImage(
    image,
    -pos.width / 2,
    -pos.height / 2,
    pos.width,
    pos.height
  );
  
  // Reset filter
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  
  // Restore canvas state
  ctx.restore();
}

// Draw video/image + overlay with face detection and lighting adaptation
function draw() {
  let faceBox = null;
  
  if (isUsingUploadedImage) {
    if (uploadedImg.complete && uploadedImg.naturalWidth > 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(uploadedImg, 0, 0, canvas.width, canvas.height);
      
      // Analyze lighting from uploaded image (throttled for performance)
      if (detectedLandmarks && lightingAnalysis.enabled) {
        faceBox = calculateFaceBox(detectedLandmarks, canvas.width, canvas.height);
        // Analyze every 5 frames (20% frequency) for performance
        if (frameCount % 5 === 0) {
          analyzeLighting(uploadedImg, faceBox);
        }
      }
      frameCount++;
      
      if (overlayImg && overlayImg.complete && overlaySrc && detectedLandmarks) {
        const pos = calculateOverlayPosition(overlayType, detectedLandmarks, overlayImg.width, overlayImg.height);
        if (pos) {
          // Draw with rotation transformation and lighting adaptation
          drawRotatedOverlay(overlayImg, pos, faceRotation);
        }
      }
    }
  } else {
    // Camera mode
    if (video.readyState >= 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Analyze lighting from video feed (throttled for performance)
      if (detectedLandmarks && lightingAnalysis.enabled) {
        faceBox = calculateFaceBox(detectedLandmarks, canvas.width, canvas.height);
        // Analyze every 3 frames (~33% frequency) for real-time performance
        if (frameCount % 3 === 0) {
          analyzeLighting(video, faceBox);
        }
      }
      frameCount++;

      if (overlayImg && overlayImg.complete && overlaySrc && detectedLandmarks) {
        const pos = calculateOverlayPosition(overlayType, detectedLandmarks, overlayImg.width, overlayImg.height);
        if (pos) {
          // Draw with rotation transformation and lighting adaptation
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

// Product Library and Shopping Cart System
let shoppingCart = [];
let currentCategory = 'all';

// Product data structure
const products = [
  { id: 1, name: 'Classic Glasses', src: 'assets/glasses.png', type: 'glasses', category: 'glasses', price: 29.99 },
  { id: 2, name: 'Classic Hat', src: 'assets/hat.png', type: 'hat', category: 'hat', price: 24.99 },
  { id: 3, name: 'Classic Shirt', src: 'assets/shirt.png', type: 'shirt', category: 'shirt', price: 39.99 },
  { id: 4, name: 'Hello Kitty Glasses', src: 'assets/hello_kitty_glasses.png', type: 'glasses', category: 'glasses', price: 34.99 },
  { id: 5, name: 'Oval Black Glasses', src: 'assets/oval_black_glasses.png', type: 'glasses', category: 'glasses', price: 49.99 },
  { id: 6, name: 'Round Black Glasses', src: 'assets/round_black_glasses.png', type: 'glasses', category: 'glasses', price: 44.99 },
  { id: 7, name: 'Square Red Glasses', src: 'assets/square_red_glasses.png', type: 'glasses', category: 'glasses', price: 39.99 },
  { id: 8, name: 'Eyelash', src: 'assets/eyelash.png', type: 'glasses', category: 'glasses', price: 14.99 },
  { id: 9, name: 'Blue Woolen Hat', src: 'assets/blue_woolen_hat.png', type: 'hat', category: 'hat', price: 29.99 },
  { id: 10, name: 'Long Braided Hair', src: 'assets/long_braided_hair.png', type: 'hat', category: 'hat', price: 54.99 },
  { id: 11, name: 'Long Curved Hair', src: 'assets/long_curved_hair.png', type: 'hat', category: 'hat', price: 49.99 },
  { id: 12, name: 'Black Office Wear', src: 'assets/black_office_wear_women.png', type: 'shirt', category: 'shirt', price: 79.99 },
  { id: 13, name: 'Green Office Wear', src: 'assets/green_office_wear_winter_women.png', type: 'shirt', category: 'shirt', price: 89.99 },
  { id: 14, name: 'Navy Suit', src: 'assets/navy_suit_man.png', type: 'shirt', category: 'shirt', price: 129.99 },
  { id: 15, name: 'Office Wear', src: 'assets/office_wear_women.png', type: 'shirt', category: 'shirt', price: 69.99 },
  { id: 16, name: 'Pink Bodycon Dress', src: 'assets/pink_bodycon_dress.png', type: 'shirt', category: 'shirt', price: 59.99 },
  { id: 17, name: 'Pink Suit', src: 'assets/pink_suit_man.png', type: 'shirt', category: 'shirt', price: 119.99 },
  { id: 18, name: 'Suit with Bow Tie', src: 'assets/suit_with_bow_tie.png', type: 'shirt', category: 'shirt', price: 149.99 },
  { id: 19, name: 'White Dress', src: 'assets/white_dress.png', type: 'shirt', category: 'shirt', price: 49.99 }
];

// Apply product to try-on (used by both thumbnail buttons and product library)
function applyProduct(src, type) {
  // Remove active state from all thumbnails and product cards
  document.querySelectorAll('.thumb').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.product-card').forEach(card => {
    card.classList.remove('ring-2', 'ring-blue-500');
  });
  
  // Find and activate matching product card
  if (src) {
    const productCard = document.querySelector(`[data-product-src="${src}"]`);
    if (productCard) {
      productCard.classList.add('ring-2', 'ring-blue-500');
    }
  }
  
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
}

// Render products in library
function renderProducts(category = 'all') {
  const productGrid = document.getElementById('productGrid');
  const filteredProducts = category === 'all' 
    ? products 
    : products.filter(p => p.category === category);
  
  productGrid.innerHTML = filteredProducts.map(product => `
    <div class="bg-gray-700 rounded-lg p-3 hover:bg-gray-600 transition cursor-pointer product-card" data-product-src="${product.src}">
      <div class="flex gap-3">
        <img src="${product.src}" alt="${product.name}" class="w-20 h-20 object-contain bg-gray-800 rounded" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27200%27 height=%27200%27%3E%3Crect fill=%27%23333%27 width=%27200%27 height=%27200%27/%3E%3Ctext fill=%27%23999%27 font-family=%27sans-serif%27 font-size=%2714%27 dy=%2710.5%27 font-weight=%27bold%27 x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27%3ENo Image%3C/text%3E%3C/svg%3E';">
        <div class="flex-1">
          <h3 class="font-semibold text-sm mb-1">${product.name}</h3>
          <p class="text-xs text-gray-400 mb-2">${product.category.charAt(0).toUpperCase() + product.category.slice(1)}</p>
          <div class="flex items-center justify-between">
            <span class="text-green-400 font-bold">$${product.price.toFixed(2)}</span>
            <div class="flex gap-2">
              <button class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs try-on-btn" data-src="${product.src}" data-type="${product.type}">
                Try On
              </button>
              <button class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs add-to-cart-btn" data-product-id="${product.id}">
                + Cart
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `).join('');
  
  // Add event listeners
  document.querySelectorAll('.try-on-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = btn.dataset.src;
      const type = btn.dataset.type;
      applyProduct(src, type);
    });
  });
  
  document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = parseInt(btn.dataset.productId);
      addToCart(productId);
    });
  });
  
  // Click on product card to try on
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('add-to-cart-btn') && !e.target.classList.contains('try-on-btn')) {
        const src = card.dataset.productSrc;
        const product = products.find(p => p.src === src);
        if (product) {
          applyProduct(src, product.type);
        }
      }
    });
  });
}

// Add to cart
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  shoppingCart.push({ ...product, cartId: Date.now() });
  updateCartUI();
  
  // Show notification
  const btn = document.querySelector(`[data-product-id="${productId}"]`);
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = '✓ Added';
    btn.classList.add('bg-green-500');
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('bg-green-500');
    }, 1500);
  }
}

// Remove from cart
function removeFromCart(cartId) {
  shoppingCart = shoppingCart.filter(item => item.cartId !== cartId);
  updateCartUI();
}

// Update cart UI
function updateCartUI() {
  const cartBadge = document.getElementById('cartBadge');
  const cartItems = document.getElementById('cartItems');
  const cartTotal = document.getElementById('cartTotal');
  const checkoutBtn = document.getElementById('checkoutBtn');
  
  // Update badge
  const itemCount = shoppingCart.length;
  if (itemCount > 0) {
    cartBadge.textContent = itemCount;
    cartBadge.classList.remove('hidden');
  } else {
    cartBadge.classList.add('hidden');
  }
  
  // Update cart items
  if (shoppingCart.length === 0) {
    cartItems.innerHTML = '<p class="text-gray-400 text-center py-8">Your cart is empty</p>';
    checkoutBtn.disabled = true;
  } else {
    const total = shoppingCart.reduce((sum, item) => sum + item.price, 0);
    cartItems.innerHTML = shoppingCart.map(item => `
      <div class="flex items-center gap-3 p-3 bg-gray-700 rounded-lg mb-2">
        <img src="${item.src}" alt="${item.name}" class="w-16 h-16 object-contain bg-gray-800 rounded">
        <div class="flex-1">
          <h4 class="font-semibold text-sm">${item.name}</h4>
          <p class="text-green-400 font-bold">$${item.price.toFixed(2)}</p>
        </div>
        <button class="remove-from-cart-btn text-red-400 hover:text-red-300 px-2" data-cart-id="${item.cartId}">
          ✕
        </button>
      </div>
    `).join('');
    
    cartTotal.textContent = `$${total.toFixed(2)}`;
    checkoutBtn.disabled = false;
    
    // Add remove listeners
    document.querySelectorAll('.remove-from-cart-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cartId = parseInt(btn.dataset.cartId);
        removeFromCart(cartId);
      });
    });
  }
}

// Category filter
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.remove('active', 'bg-blue-600');
      b.classList.add('bg-gray-700');
    });
    btn.classList.add('active', 'bg-blue-600');
    btn.classList.remove('bg-gray-700');
    currentCategory = btn.dataset.category;
    renderProducts(currentCategory);
  });
});

// Cart modal
const cartBtn = document.getElementById('cartBtn');
const cartModal = document.getElementById('cartModal');
const closeCartBtn = document.getElementById('closeCartBtn');

cartBtn.addEventListener('click', () => {
  cartModal.classList.remove('hidden');
});

closeCartBtn.addEventListener('click', () => {
  cartModal.classList.add('hidden');
});

cartModal.addEventListener('click', (e) => {
  if (e.target === cartModal) {
    cartModal.classList.add('hidden');
  }
});

// Checkout
document.getElementById('checkoutBtn').addEventListener('click', () => {
  if (shoppingCart.length > 0) {
    alert(`Checkout complete! ${shoppingCart.length} item(s) for $${shoppingCart.reduce((sum, item) => sum + item.price, 0).toFixed(2)}`);
    // In a real app, you would redirect to checkout or send data to backend
  }
});

// Mobile library toggle
const toggleLibraryBtn = document.getElementById('toggleLibraryBtn');
const closeLibraryBtn = document.getElementById('closeLibraryBtn');
const productLibrary = document.querySelector('.product-library');

if (toggleLibraryBtn) {
  toggleLibraryBtn.addEventListener('click', () => {
    productLibrary.classList.add('open');
  });
}

if (closeLibraryBtn) {
  closeLibraryBtn.addEventListener('click', () => {
    productLibrary.classList.remove('open');
  });
}

// Thumbnail buttons (legacy support)
document.querySelectorAll('.thumb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.thumb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const src = btn.dataset.src;
    const type = btn.dataset.type;
    applyProduct(src, type);
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
renderProducts(); // Initialize product library