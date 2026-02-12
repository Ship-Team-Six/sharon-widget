import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { sendMessage, getAnalyser } from './chat.js';
import { initLipSync, startLipSync, stopLipSync, updateLipSync } from './lipsync.js';

// ── Scene setup ──
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.3, 4.5);
camera.lookAt(0, 0.22, 0);

// ── Lighting ──
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfff0e6, 1.2);
dirLight.position.set(2, 3, 2);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xc0d0ff, 0.4);
fillLight.position.set(-2, 1, -1);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xff88cc, 0.3);
rimLight.position.set(0, 2, -3);
scene.add(rimLight);

// ── VRM Loading ──
let vrm = null;
const clock = new THREE.Clock();

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load(
  '/sharon1.vrm',
  (gltf) => {
    vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
    vrm.scene.rotation.y = 0;
    scene.add(vrm.scene);
    console.log('VRM loaded:', vrm);
    initLipSync(vrm, getAnalyser());
    initChatUI();
  },
  (progress) => console.log(`Loading: ${((progress.loaded / progress.total) * 100).toFixed(1)}%`),
  (error) => console.error('Error loading VRM:', error)
);

// ── Sequential Animation Loop ──
// gentle sway → thoughtful tilt → confident pose → playful bounce → back to gentle sway
let loopTime = 0;
const PHASE_DURATION = 10; // 10 seconds per pose, 40 second total loop
let blinkTimer = 0, nextBlinkTime = 2 + Math.random() * 4;
let isBlinking = false, blinkProgress = 0;
let expressionTimer = 0, nextExpressionTime = 5 + Math.random() * 10;
let currentExpression = null, expressionWeight = 0, expressionFadeDir = 0;

// ── Twirl Animation State ──
let isTwirling = false;
let twirlTime = 0;
const TWIRL_DURATION = 1.5; // seconds for 360 spin
const TWIRL_RESET_DURATION = 0.5; // seconds to reset to neutral
let twirlPhase = 'spin'; // 'spin' | 'reset'
let preTwirlPose = null; // Store pose before twirl for smooth return

// Pose definitions
const POSES = {
  gentleSway: (phase) => ({
    hipsRotY: Math.sin(phase * 0.5) * 0.015,
    hipsRotZ: Math.sin(phase * 0.3) * 0.008,
    spineRotX: Math.sin(phase * 0.7) * 0.01,
    leftArmRotZ: -1.2 + Math.sin(phase * 0.4) * 0.03,
    rightArmRotZ: 1.2 - Math.sin(phase * 0.4) * 0.03,
    headRotY: Math.sin(phase * 0.3) * 0.04,
    headRotX: Math.sin(phase * 0.5) * 0.02,
    headRotZ: 0,
  }),
  thoughtfulTilt: (phase) => ({
    hipsRotY: Math.sin(phase * 0.2) * 0.005,
    hipsRotZ: 0,
    spineRotX: 0.02 + Math.sin(phase * 0.4) * 0.015,
    leftArmRotZ: -1.15 + Math.sin(phase * 0.3) * 0.02,
    rightArmRotZ: 1.15,
    headRotY: Math.sin(phase * 0.25) * 0.12,
    headRotX: -0.05 + Math.sin(phase * 0.35) * 0.04,
    headRotZ: Math.sin(phase * 0.2) * 0.08,
  }),
  confidentPose: (phase) => ({
    hipsRotY: Math.sin(phase * 0.3) * 0.01,
    hipsRotZ: Math.sin(phase * 0.25) * 0.005,
    spineRotX: -0.015 + Math.sin(phase * 0.5) * 0.012,
    leftArmRotZ: -1.1 + Math.sin(phase * 0.35) * 0.025,
    rightArmRotZ: 1.1 - Math.sin(phase * 0.35) * 0.025,
    headRotY: Math.sin(phase * 0.2) * 0.025,
    headRotX: -0.02 + Math.sin(phase * 0.4) * 0.01,
    headRotZ: 0,
  }),
  playfulBounce: (phase) => ({
    hipsRotY: Math.sin(phase * 0.9) * 0.018,
    hipsRotZ: Math.sin(phase * 0.7) * 0.01,
    spineRotX: Math.sin(phase * 1.2) * 0.015,
    leftArmRotZ: -1.18 + Math.sin(phase * 0.8) * 0.035,
    rightArmRotZ: 1.18 - Math.sin(phase * 0.6) * 0.035,
    headRotY: Math.sin(phase * 0.85) * 0.05,
    headRotX: Math.sin(phase * 1.1) * 0.025,
    headRotZ: Math.sin(phase) * 0.02,
  }),
};

// Smooth interpolation between two poses
function lerpPose(poseA, poseB, t) {
  const result = {};
  for (const key of Object.keys(poseA)) {
    const a = poseA[key] || 0;
    const b = poseB[key] || 0;
    result[key] = a + (b - a) * t;
  }
  return result;
}

// Trigger twirl animation
function triggerTwirl() {
  if (isTwirling) return;
  isTwirling = true;
  twirlTime = 0;
  twirlPhase = 'spin';
  // Reset loop to start from gentle sway after twirl
  console.log('🎭 Twirl triggered!');
}

function updateOrganicIdle(delta) {
  if (!vrm) return;
  
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  
  // ── TWIRL ANIMATION ──
  if (isTwirling) {
    twirlTime += delta;
    
    if (twirlPhase === 'spin') {
      // SPIN PHASE: Controlled 360° rotation over 1.5 seconds
      const spinProgress = Math.min(1, twirlTime / TWIRL_DURATION);
      // Ease out cubic for smooth deceleration
      const ease = 1 - Math.pow(1 - spinProgress, 3);
      
      // Rotate entire model around Y axis via hips
      if (hips) {
        hips.rotation.y = ease * Math.PI * 2;
        // Subtle hop during spin
        hips.position.y = Math.sin(spinProgress * Math.PI) * 0.02;
      }
      
      // Arms slightly out for balance (controlled, not ragdoll)
      if (leftUpperArm) {
        leftUpperArm.rotation.z = -1.3 + Math.sin(spinProgress * Math.PI * 2) * 0.1;
        leftUpperArm.rotation.x = 0.1;
      }
      if (rightUpperArm) {
        rightUpperArm.rotation.z = 1.3 - Math.sin(spinProgress * Math.PI * 2) * 0.1;
        rightUpperArm.rotation.x = 0.1;
      }
      
      // Keep head facing forward (counter-rotate slightly for focus)
      if (head) {
        head.rotation.y = -hips.rotation.y * 0.3; // Partial counter-rotation
        head.rotation.x = 0;
        head.rotation.z = 0;
      }
      
      // Reset spine and chest to neutral during spin
      if (spine) spine.rotation.x = 0;
      if (chest) chest.rotation.x = Math.sin(spinProgress * Math.PI) * 0.02;
      
      if (spinProgress >= 1) {
        twirlPhase = 'reset';
        twirlTime = 0;
        console.log('🎭 Twirl spin complete, resetting...');
      }
      
    } else if (twirlPhase === 'reset') {
      // RESET PHASE: Smoothly return ALL bones to zero/default over 0.5 seconds
      const resetProgress = Math.min(1, twirlTime / TWIRL_RESET_DURATION);
      const ease = 1 - Math.pow(1 - resetProgress, 3);
      
      // Reset hips rotation back to 0
      if (hips) {
        hips.rotation.y = (1 - ease) * Math.PI * 2;
        hips.position.y = 0;
        hips.rotation.z = 0;
      }
      
      // Reset ALL bones to their default neutral positions
      if (spine) spine.rotation.set(0, 0, 0);
      if (chest) chest.rotation.set(0, 0, 0);
      
      // Head: fully reset
      if (head) head.rotation.set(0, 0, 0);
      
      // Arms: return to relaxed T-pose
      if (leftUpperArm) {
        leftUpperArm.rotation.z = -1.2 * ease;
        leftUpperArm.rotation.x = 0;
      }
      if (rightUpperArm) {
        rightUpperArm.rotation.z = 1.2 * ease;
        rightUpperArm.rotation.x = 0;
      }
      if (leftLowerArm) leftLowerArm.rotation.z = 0.05 * ease;
      if (rightLowerArm) rightLowerArm.rotation.z = -0.05 * ease;
      
      if (resetProgress >= 1) {
        // TWIRL COMPLETE: Reset everything and restart idle from beginning
        isTwirling = false;
        twirlPhase = 'spin';
        loopTime = 0; // Reset idle loop to start (gentle sway)
        console.log('🎭 Twirl complete, returning to idle!');
      }
    }
    
    vrm.update(delta);
    return; // Skip idle animation during twirl
  }
  
  // ── IDLE ANIMATION ──
  loopTime += delta;
  
  // Determine current phase (0-3) and position within phase
  const totalLoop = PHASE_DURATION * 4;
  const loopPosition = loopTime % totalLoop;
  const phaseIndex = Math.floor(loopPosition / PHASE_DURATION);
  const phaseProgress = (loopPosition % PHASE_DURATION) / PHASE_DURATION;
  
  // Calculate poses
  const phase = loopTime;
  const poseKeys = ['gentleSway', 'thoughtfulTilt', 'confidentPose', 'playfulBounce'];
  const currentPoseKey = poseKeys[phaseIndex];
  const nextPoseKey = poseKeys[(phaseIndex + 1) % 4];
  
  const currentPose = POSES[currentPoseKey](phase);
  const nextPose = POSES[nextPoseKey](phase);
  
  // Smooth transition (blend last 25% of each phase into next)
  let blendT = phaseProgress;
  if (blendT > 0.75) {
    // Ease into next pose during last 25%
    const transitionProgress = (blendT - 0.75) / 0.25;
    blendT = transitionProgress;
  } else {
    blendT = 0;
  }
  
  const pose = lerpPose(currentPose, nextPose, blendT);
  
  // Apply pose
  if (hips) {
    hips.rotation.y = pose.hipsRotY || 0;
    hips.rotation.z = pose.hipsRotZ || 0;
  }
  if (spine) spine.rotation.x = pose.spineRotX || 0;
  // Chest and breathing
  const breathCycle = loopTime * 1.2;
  if (chest) chest.rotation.x = (pose.spineRotX || 0) + Math.sin(breathCycle) * 0.015;
  if (head) {
    head.rotation.y = pose.headRotY || 0;
    head.rotation.x = pose.headRotX || 0;
    head.rotation.z = pose.headRotZ || 0;
  }
  if (leftUpperArm) leftUpperArm.rotation.z = pose.leftArmRotZ || -1.2;
  if (rightUpperArm) rightUpperArm.rotation.z = pose.rightArmRotZ || 1.2;
  if (leftLowerArm) leftLowerArm.rotation.z = 0.05;
  if (rightLowerArm) rightLowerArm.rotation.z = -0.05;
  
  // Blinking
  blinkTimer += delta;
  if (!isBlinking && blinkTimer >= nextBlinkTime) {
    isBlinking = true;
    blinkProgress = 0;
    nextBlinkTime = Math.random() < 0.3 ? 0.15 : (2 + Math.random() * 5);
    blinkTimer = 0;
  }
  if (isBlinking && vrm.expressionManager) {
    blinkProgress += delta * 10;
    let w = blinkProgress < 0.5 ? blinkProgress * 2 : (blinkProgress < 1 ? (1 - blinkProgress) * 2 : 0);
    if (blinkProgress >= 1) isBlinking = false;
    vrm.expressionManager.setValue('blink', w);
  }
  
  // Expressions
  expressionTimer += delta;
  if (expressionFadeDir === 0 && expressionTimer >= nextExpressionTime) {
    const exprs = ['happy', 'relaxed'].filter(e => vrm.expressionManager?.expressionMap?.[e]);
    if (exprs.length > 0) {
      currentExpression = exprs[Math.floor(Math.random() * exprs.length)];
      expressionFadeDir = 1;
      expressionWeight = 0;
      expressionTimer = 0;
      nextExpressionTime = 4 + Math.random() * 8;
    }
  }
  if (currentExpression && vrm.expressionManager) {
    if (expressionFadeDir === 1) {
      expressionWeight = Math.min(0.3, expressionWeight + delta * 0.5);
      if (expressionWeight >= 0.3) expressionFadeDir = -1;
    } else if (expressionFadeDir === -1) {
      expressionWeight = Math.max(0, expressionWeight - delta * 0.3);
      if (expressionWeight <= 0) {
        expressionFadeDir = 0;
        vrm.expressionManager.setValue(currentExpression, 0);
        currentExpression = null;
      }
    }
    if (currentExpression) vrm.expressionManager.setValue(currentExpression, expressionWeight);
  }
  
  vrm.update(delta);
}

// ── Render loop ──
const FPS = 30;
const frameInterval = 1000 / FPS;
let lastFrameTime = 0;

function animate(time) {
  requestAnimationFrame(animate);
  if (time - lastFrameTime < frameInterval) return;
  lastFrameTime = time;
  const delta = Math.min(clock.getDelta(), 0.1);
  updateOrganicIdle(delta);
  updateLipSync();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Window controls ──
document.getElementById('btn-close')?.addEventListener('click', async () => {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch { window.close(); }
});

// ── Position window bottom-right ──
async function positionBottomRight() {
  try {
    const tauriWindow = await import('@tauri-apps/api/window');
    const dpi = await import('@tauri-apps/api/dpi');
    const win = tauriWindow.getCurrentWindow();
    const monitor = await win.currentMonitor();
    if (monitor) {
      const sf = monitor.scaleFactor;
      const x = Math.round((monitor.size.width / sf) - 420);
      const y = Math.round((monitor.size.height / sf) - 520);
      await win.setPosition(new dpi.LogicalPosition(x, y));
    }
  } catch (e) { console.warn('Could not position window:', e); }
}
positionBottomRight();

// ── Drag and Click support ──
let mouseDownTime = 0;
let isDraggingWindow = false;

canvas.addEventListener('mousedown', async (e) => {
  if (e.target.closest('#chat-container')) return;
  mouseDownTime = Date.now();
  isDraggingWindow = false;
  if (e.buttons === 1) {
    isDraggingWindow = true;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch {}
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (e.target.closest('#chat-container')) return;
  const clickDuration = Date.now() - mouseDownTime;
  // If it was a quick click (not a drag), trigger twirl
  if (clickDuration < 200 && !isTwirling) {
    triggerTwirl();
  }
  isDraggingWindow = false;
});

document.getElementById('drag-region')?.addEventListener('mousedown', async (e) => {
  if (e.buttons === 1) {
    mouseDownTime = Date.now();
    isDraggingWindow = true;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch {}
  }
});

// ── Emotion mapping ──
const EMOTION_MAP = {
  'happy': 'happy', 'excited': 'happy', 'playful': 'happy', 'mischievous': 'happy',
  'neutral': 'neutral', 'thoughtful': 'neutral', 'curious': 'neutral',
  'concerned': 'sad', 'apologetic': 'sad',
  'annoyed': 'angry', 'disgusted': 'angry', 'possessive': 'angry', 'protective': 'angry',
};

function setEmotion(emotion) {
  const expr = EMOTION_MAP[emotion] || 'neutral';
  if (vrm?.expressionManager) {
    vrm.expressionManager.setValue(expr, expr === 'neutral' ? 0 : 0.5);
  }
}

// ── Chat UI ──
function initChatUI() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const messages = document.getElementById('chat-messages');
  let isSending = false;

  function addBubble(text, className) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${className}`;
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    while (messages.children.length > 10) messages.removeChild(messages.firstChild);
    return bubble;
  }

  async function handleSend() {
    const text = input.value.trim();
    if (!text || isSending) return;
    isSending = true;
    sendBtn.disabled = true;
    input.value = '';
    addBubble(text, 'user');
    let statusBubble = addBubble('thinking...', 'status');

    try {
      const result = await sendMessage(text, (status) => {
        const labels = { 'thinking': '💭...', 'translating': '🌸...', 'speaking': '🎤...', 'idle': '' };
        if (statusBubble && labels[status]) statusBubble.textContent = labels[status];
        if (status === 'speaking') startLipSync();
      });
      if (statusBubble) statusBubble.remove();
      addBubble(result.text, 'sharon');
      setEmotion(result.emotion);
      stopLipSync();
    } catch (err) {
      console.error('Chat error:', err);
      if (statusBubble) {
        statusBubble.textContent = `❌ ${err.message || 'error'}`;
        setTimeout(() => statusBubble?.remove(), 5000);
      }
      stopLipSync();
    }
    isSending = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
}
