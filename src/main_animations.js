// ── Simple Organic Idle Animation ──
// One continuous natural breathing + subtle movement, no hard cuts

let idleTime = 0;

function updateOrganicIdle(delta) {
  if (!vrm) return;
  
  idleTime += delta;
  
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  
  // Base breathing (1.2s cycle) - always present
  const breathCycle = idleTime * 1.2;
  const breathY = Math.sin(breathCycle) * 0.004;
  const breathChest = Math.sin(breathCycle) * 0.015;
  
  // Slow organic drift (different frequencies for natural feel)
  const drift1 = idleTime * 0.3;  // Very slow body drift
  const drift2 = idleTime * 0.5;  // Medium head drift
  const drift3 = idleTime * 0.2;  // Ultra slow hip drift
  
  // Hips - subtle breathing + micro-movement
  if (hips) {
    hips.position.y = breathY;
    hips.rotation.y = Math.sin(drift3) * 0.008;  // Very subtle turn
    hips.rotation.z = Math.sin(drift3 * 0.7) * 0.003;
  }
  
  // Spine - follows breath
  if (spine) {
    spine.rotation.x = breathChest * 0.3;
  }
  
  // Chest - primary breathing movement
  if (chest) {
    chest.rotation.x = breathChest;
  }
  
  // Head - slow organic drift (never snaps)
  if (head) {
    head.rotation.y = Math.sin(drift2) * 0.025 + Math.sin(drift2 * 0.6) * 0.015;
    head.rotation.x = Math.sin(drift2 * 0.8) * 0.012 - 0.02;  // Slight downward gaze
    head.rotation.z = Math.sin(drift1 * 0.5) * 0.008;
  }
  
  // Arms - relaxed, subtle sway
  if (leftUpperArm) {
    leftUpperArm.rotation.z = -1.15 + Math.sin(drift1) * 0.02;
    leftUpperArm.rotation.x = Math.sin(drift2 * 0.6) * 0.015;
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.z = 1.15 - Math.sin(drift1) * 0.02;
    rightUpperArm.rotation.x = Math.sin(drift2 * 0.6) * 0.015;
  }
  if (leftLowerArm) {
    leftLowerArm.rotation.z = 0.05 + Math.sin(drift1 * 1.2) * 0.01;
  }
  if (rightLowerArm) {
    rightLowerArm.rotation.z = -0.05 - Math.sin(drift1 * 1.2) * 0.01;
  }
  
  // Random blinking (natural)
  blinkTimer += delta;
  if (!isBlinking && blinkTimer >= nextBlinkTime) {
    isBlinking = true;
    blinkProgress = 0;
    nextBlinkTime = Math.random() < 0.3 ? 0.15 : (2 + Math.random() * 5);
    blinkTimer = 0;
  }
  
  if (isBlinking && vrm.expressionManager) {
    blinkProgress += delta * 10;
    let weight = blinkProgress < 0.5 ? blinkProgress * 2 : (blinkProgress < 1 ? (1 - blinkProgress) * 2 : 0);
    if (blinkProgress >= 1) isBlinking = false;
    vrm.expressionManager.setValue('blink', weight);
  }
  
  // Occasional subtle expressions (happy, relaxed)
  expressionTimer += delta;
  if (expressionFadeDir === 0 && expressionTimer >= nextExpressionTime) {
    const expressions = ['happy', 'relaxed'];
    const available = expressions.filter(e => vrm.expressionManager?.expressionMap?.[e]);
    if (available.length > 0) {
      currentExpression = available[Math.floor(Math.random() * available.length)];
      expressionFadeDir = 1;
      expressionWeight = 0;
      expressionTimer = 0;
      nextExpressionTime = 4 + Math.random() * 8;
    }
  }
  
  if (currentExpression && vrm.expressionManager) {
    if (expressionFadeDir === 1) {
      expressionWeight = Math.min(0.3, expressionWeight + delta * 0.5);  // Subtle expressions
      if (expressionWeight >= 0.3) expressionFadeDir = -1;
    } else if (expressionFadeDir === -1) {
      expressionWeight = Math.max(0, expressionWeight - delta * 0.3);
      if (expressionWeight <= 0) {
        expressionFadeDir = 0;
        vrm.expressionManager.setValue(currentExpression, 0);
        currentExpression = null;
      }
    }
    if (currentExpression) {
      vrm.expressionManager.setValue(currentExpression, expressionWeight);
    }
  }
  
  vrm.update(delta);
}

// Animation state variables (for compatibility)
let animationState = { state: 'idle' };
let blinkTimer = 0, nextBlinkTime = 2 + Math.random() * 4;
let isBlinking = false, blinkProgress = 0;
let expressionTimer = 0, nextExpressionTime = 5 + Math.random() * 10;
let currentExpression = null, expressionWeight = 0, expressionFadeDir = 0;

function updateAnimation(delta) {
  updateOrganicIdle(delta);
}

function startIdleAnimation() {
  console.log('🎭 Organic idle animation started');
}

// Legacy function stubs (for compatibility with existing code)
function triggerChatAnimation() { console.log('Chat animation stub'); }
function triggerTwirlAnimation() { console.log('Twirl disabled'); }
function updateChatAnimation(delta) { }
function updateTwirlAnimation(delta) { }
function resetToDefaultPose() { }

// Keep EMOTION_MAP for facial expressions during chat
const EMOTION_MAP = {
  'happy': 'happy',
  'excited': 'happy',
  'playful': 'happy',
  'mischievous': 'happy',
  'neutral': 'neutral',
  'thoughtful': 'neutral',
  'curious': 'neutral',
  'concerned': 'sad',
  'apologetic': 'sad',
  'annoyed': 'angry',
  'disgusted': 'angry',
  'possessive': 'angry',
  'protective': 'angry',
};

let currentEmotionExpression = null;
let emotionWeight = 0;
let targetEmotionWeight = 0;

function setEmotion(emotion) {
  const expr = EMOTION_MAP[emotion] || 'neutral';
  if (expr === 'neutral') {
    targetEmotionWeight = 0;
  } else {
    if (currentEmotionExpression && currentEmotionExpression !== expr && vrm?.expressionManager) {
      vrm.expressionManager.setValue(currentEmotionExpression, 0);
    }
    currentEmotionExpression = expr;
    targetEmotionWeight = 0.5;
  }
}
