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

// ── Simple Organic Idle Animation ──
let organicIdleTime = 0;
let blinkTimer = 0, nextBlinkTime = 2 + Math.random() * 4;
let isBlinking = false, blinkProgress = 0;
let expressionTimer = 0, nextExpressionTime = 5 + Math.random() * 10;
let currentExpression = null, expressionWeight = 0, expressionFadeDir = 0;

function updateOrganicIdle(delta) {
  if (!vrm) return;
  
  organicIdleTime += delta;
  
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  
  // Base breathing (1.2s cycle)
  const breathCycle = organicIdleTime * 1.2;
  const breathY = Math.sin(breathCycle) * 0.004;
  const breathChest = Math.sin(breathCycle) * 0.015;
  
  // Slow organic drift
  const drift1 = organicIdleTime * 0.3;
  const drift2 = organicIdleTime * 0.5;
  const drift3 = organicIdleTime * 0.2;
  
  if (hips) {
    hips.position.y = breathY;
    hips.rotation.y = Math.sin(drift3) * 0.008;
    hips.rotation.z = Math.sin(drift3 * 0.7) * 0.003;
  }
  if (spine) spine.rotation.x = breathChest * 0.3;
  if (chest) chest.rotation.x = breathChest;
  if (head) {
    head.rotation.y = Math.sin(drift2) * 0.025 + Math.sin(drift2 * 0.6) * 0.015;
    head.rotation.x = Math.sin(drift2 * 0.8) * 0.012 - 0.02;
    head.rotation.z = Math.sin(drift1 * 0.5) * 0.008;
  }
  if (leftUpperArm) {
    leftUpperArm.rotation.z = -1.15 + Math.sin(drift1) * 0.02;
    leftUpperArm.rotation.x = Math.sin(drift2 * 0.6) * 0.015;
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.z = 1.15 - Math.sin(drift1) * 0.02;
    rightUpperArm.rotation.x = Math.sin(drift2 * 0.6) * 0.015;
  }
  if (leftLowerArm) leftLowerArm.rotation.z = 0.05 + Math.sin(drift1 * 1.2) * 0.01;
  if (rightLowerArm) rightLowerArm.rotation.z = -0.05 - Math.sin(drift1 * 1.2) * 0.01;
  
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

// ── Drag support ──
canvas.addEventListener('mousedown', async (e) => {
  if (e.target.closest('#chat-container')) return;
  if (e.buttons === 1) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch {}
  }
});

document.getElementById('drag-region')?.addEventListener('mousedown', async (e) => {
  if (e.buttons === 1) {
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
