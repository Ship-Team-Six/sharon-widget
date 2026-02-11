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
// Transparent background for widget
scene.background = null;

const camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.3, 4.5);
camera.lookAt(0, 0.9, 0);

// ── Lighting ──
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfff0e6, 1.2);
dirLight.position.set(2, 3, 2);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xc0d0ff, 0.4);
fillLight.position.set(-2, 1, -1);
scene.add(fillLight);

// Subtle rim light
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
    
    // VRM models face +Z by default; no rotation needed if already facing camera
    vrm.scene.rotation.y = 0;
    scene.add(vrm.scene);

    console.log('VRM loaded:', vrm);
    console.log('Expressions:', vrm.expressionManager?.expressionMap ? Object.keys(vrm.expressionManager.expressionMap) : 'none');
    console.log('Bones:', vrm.humanoid ? Object.keys(vrm.humanoid.humanBones) : 'none');

    // Start idle animation
    startIdleAnimation();
    
    // Init lip sync with audio analyser
    initLipSync(vrm, getAnalyser());
    
    // Init chat UI
    initChatUI();
  },
  (progress) => {
    console.log(`Loading: ${((progress.loaded / progress.total) * 100).toFixed(1)}%`);
  },
  (error) => {
    console.error('Error loading VRM:', error);
  }
);

// ── Idle Animation System ──
let animationState = {
  breathPhase: 0,
  blinkTimer: 0,
  nextBlinkTime: 2 + Math.random() * 4,
  isBlinking: false,
  blinkProgress: 0,
  headSwayPhase: Math.random() * Math.PI * 2,
  bodySwayPhase: Math.random() * Math.PI * 2,
  expressionTimer: 0,
  nextExpressionTime: 5 + Math.random() * 10,
  currentExpression: null,
  expressionWeight: 0,
  expressionFadeDir: 0, // -1 fading out, 0 none, 1 fading in
};

function startIdleAnimation() {
  // Nothing special needed — update loop handles it
}

function updateIdleAnimation(delta) {
  if (!vrm) return;

  const state = animationState;

  // ── Breathing ──
  state.breathPhase += delta * 1.2;
  const breathValue = Math.sin(state.breathPhase) * 0.003;
  
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  if (spine) {
    spine.position.y += breathValue;
  }
  
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  if (chest) {
    chest.rotation.x = Math.sin(state.breathPhase) * 0.01;
  }

  // ── Blinking ──
  state.blinkTimer += delta;
  if (!state.isBlinking && state.blinkTimer >= state.nextBlinkTime) {
    state.isBlinking = true;
    state.blinkProgress = 0;
    // Sometimes double-blink
    state.nextBlinkTime = Math.random() < 0.3 ? 0.15 : (2 + Math.random() * 5);
    state.blinkTimer = 0;
  }

  if (state.isBlinking) {
    state.blinkProgress += delta * 8; // blink speed
    let blinkWeight;
    if (state.blinkProgress < 0.5) {
      // Closing
      blinkWeight = state.blinkProgress * 2;
    } else if (state.blinkProgress < 1.0) {
      // Opening
      blinkWeight = 1.0 - (state.blinkProgress - 0.5) * 2;
    } else {
      blinkWeight = 0;
      state.isBlinking = false;
    }
    
    if (vrm.expressionManager) {
      vrm.expressionManager.setValue('blink', blinkWeight);
    }
  }

  // ── Head sway ──
  state.headSwayPhase += delta * 0.3;
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.y = Math.sin(state.headSwayPhase) * 0.03;
    head.rotation.x = Math.sin(state.headSwayPhase * 0.7) * 0.015;
    head.rotation.z = Math.sin(state.headSwayPhase * 0.5) * 0.01;
  }

  // ── Subtle body sway ──
  state.bodySwayPhase += delta * 0.15;
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  if (hips) {
    hips.rotation.z = Math.sin(state.bodySwayPhase) * 0.008;
    hips.rotation.y = Math.sin(state.bodySwayPhase * 0.7) * 0.005;
  }

  // ── Occasional expressions ──
  state.expressionTimer += delta;
  if (state.expressionFadeDir === 0 && state.expressionTimer >= state.nextExpressionTime) {
    // Pick a random subtle expression
    const expressions = ['happy', 'relaxed'];
    const available = expressions.filter(e => 
      vrm.expressionManager?.expressionMap?.[e]
    );
    if (available.length > 0) {
      state.currentExpression = available[Math.floor(Math.random() * available.length)];
      state.expressionFadeDir = 1;
      state.expressionWeight = 0;
      state.expressionTimer = 0;
      state.nextExpressionTime = 5 + Math.random() * 10;
    }
  }

  if (state.currentExpression && vrm.expressionManager) {
    if (state.expressionFadeDir === 1) {
      state.expressionWeight = Math.min(1, state.expressionWeight + delta * 0.8);
      if (state.expressionWeight >= 0.4) {
        state.expressionFadeDir = -1;
      }
    } else if (state.expressionFadeDir === -1) {
      state.expressionWeight = Math.max(0, state.expressionWeight - delta * 0.5);
      if (state.expressionWeight <= 0) {
        state.expressionFadeDir = 0;
        vrm.expressionManager.setValue(state.currentExpression, 0);
        state.currentExpression = null;
      }
    }
    if (state.currentExpression) {
      vrm.expressionManager.setValue(state.currentExpression, state.expressionWeight);
    }
  }

  // ── Arm pose (slight relaxation from T-pose) ──
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  if (leftUpperArm) {
    leftUpperArm.rotation.z = -1.2 + Math.sin(state.bodySwayPhase * 0.5) * 0.02;
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.z = 1.2 + Math.sin(state.bodySwayPhase * 0.5 + 1) * 0.02;
  }
  
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  if (leftLowerArm) {
    leftLowerArm.rotation.z = 0.05;
  }
  if (rightLowerArm) {
    rightLowerArm.rotation.z = -0.05;
  }

  // Update VRM
  vrm.update(delta);
}

// ── Mouse tracking (look at cursor) ──
let mouseX = 0, mouseY = 0;
let targetLookX = 0, targetLookY = 0;

window.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;
  mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
});

function updateLookAt(delta) {
  if (!vrm?.lookAt) return;
  
  // Smooth follow
  targetLookX += (mouseX * 15 - targetLookX) * delta * 3;
  targetLookY += (mouseY * 10 - targetLookY) * delta * 3;
  
  // VRM lookAt uses yaw/pitch in degrees
  vrm.lookAt.target = null; // disable auto target
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  if (head) {
    // Add look-at on top of idle sway
    head.rotation.y += targetLookX * 0.02;
    head.rotation.x += targetLookY * -0.015;
  }
}

// ── Render loop (30 FPS) ──
const FPS = 30;
const frameInterval = 1000 / FPS;
let lastFrameTime = 0;

function animate(time) {
  requestAnimationFrame(animate);

  if (time - lastFrameTime < frameInterval) return;
  lastFrameTime = time;

  const delta = Math.min(clock.getDelta(), 0.1); // cap delta to avoid jumps

  updateIdleAnimation(delta);
  updateLookAt(delta);
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
  } catch {
    window.close();
  }
});

// ── Position window bottom-right on startup ──
async function positionBottomRight() {
  try {
    const tauriWindow = await import('@tauri-apps/api/window');
    const dpi = await import('@tauri-apps/api/dpi');
    const win = tauriWindow.getCurrentWindow();
    const monitor = await win.currentMonitor();
    if (monitor) {
      const sf = monitor.scaleFactor;
      const screenW = monitor.size.width / sf;
      const screenH = monitor.size.height / sf;
      const winSize = await win.outerSize();
      const winW = winSize.width / sf;
      const winH = winSize.height / sf;
      const x = Math.round(screenW - winW - 20);
      const y = Math.round(screenH - winH - 60); // offset for dock
      console.log(`Screen: ${screenW}x${screenH}, Win: ${winW}x${winH}, Pos: ${x},${y}`);
      await win.setPosition(new dpi.LogicalPosition(x, y));
    }
  } catch (e) {
    console.warn('Could not position window:', e);
  }
}
positionBottomRight();

// ── Drag support for Tauri — click anywhere on canvas to drag ──
canvas.addEventListener('mousedown', async (e) => {
  // Don't drag if clicking on chat area
  if (e.target.closest('#chat-container')) return;
  if (e.buttons === 1) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch {}
  }
});

// Also keep the top drag region
document.getElementById('drag-region')?.addEventListener('mousedown', async (e) => {
  if (e.buttons === 1) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch {}
  }
});

// ── Emotion → VRM Expression mapping ──
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
    targetEmotionWeight = 0.6;
  }
}

// Blend emotion in the animation loop (called from updateIdleAnimation won't work cleanly, so patch animate)
const _origAnimate = animate;
// We'll just add emotion update inline

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
    
    // Auto-remove old messages (keep last 10)
    while (messages.children.length > 10) {
      messages.removeChild(messages.firstChild);
    }
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
        const labels = {
          'thinking': '💭 thinking...',
          'translating': '🌸 translating...',
          'speaking': '🎤 speaking...',
          'idle': '',
        };
        if (statusBubble && labels[status]) {
          statusBubble.textContent = labels[status];
        }
        if (status === 'speaking') {
          startLipSync();
        }
      });

      // Remove status bubble
      if (statusBubble) statusBubble.remove();

      // Add Sharon's response
      addBubble(result.text, 'sharon');

      // Set emotion expression
      setEmotion(result.emotion);

      // Stop lip sync after speech ends
      stopLipSync();

    } catch (err) {
      console.error('Chat error:', err);
      if (statusBubble) {
        statusBubble.textContent = `❌ ${err.message || 'error'}`;
        // Auto-remove error after 5s
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
}
