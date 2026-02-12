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
camera.lookAt(0, 0.22, 0); // Camera lookAt position (was 0.9 → 0.6 → 0.4 → 0.29)

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

// ── Animation System ──
const ANIMATION_STATE = {
  IDLE: 'idle',
  CHAT: 'chat',
  TWIRL: 'twirl',
  TRANSITION: 'transition'
};

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
  expressionFadeDir: 0,
  
  // Animation cycling
  state: ANIMATION_STATE.IDLE,
  currentIdleIndex: 0,
  idleTimer: 0,
  idleDuration: 10, // seconds per idle animation (was 15, then 6)
  currentChatIndex: 0,
  chatTimer: 0,
  transitionProgress: 0,
  isTransitioning: false,
  
  // Animation blend values
  idleBlend: 1,
  chatBlend: 0,
  
  // Twirl animation state
  twirlTimer: 0,
  twirlPhase: 'twirl', // 'twirl' | 'smile' | 'wink' | 'return'
  twirlRotation: 0,
  isBeingDragged: false,
  wasDragged: false,
  dragEndTimer: 0,
};

// ── Default Pose (neutral/rest position) ──
// All animations blend from/to this state
const DEFAULT_POSE = {
  hipsPosY: 0,
  hipsRotY: 0,
  hipsRotZ: 0,
  hipsRotX: 0,
  spineRotX: 0,
  chestRotX: 0,
  leftArmRotZ: -1.2,
  rightArmRotZ: 1.2,
  leftArmRotX: 0,
  rightArmRotX: 0,
  leftLowerArmRot: 0.05,
  rightLowerArmRot: -0.05,
  headRotY: 0,
  headRotX: 0,
  headRotZ: 0,
};

// ── Idle Animation Definitions ──
// Each returns pose offsets for bones
const IDLE_ANIMATIONS = [
  // 1. Gentle Sway - relaxed standing with subtle hip movement
  {
    name: 'gentleSway',
    update: (delta, phase) => ({
      hipsRotY: Math.sin(phase * 0.5) * 0.015,
      hipsRotZ: Math.sin(phase * 0.3) * 0.008,
      spineRotX: Math.sin(phase * 0.7) * 0.01,
      leftArmRotZ: -1.2 + Math.sin(phase * 0.4) * 0.03,
      rightArmRotZ: 1.2 - Math.sin(phase * 0.4) * 0.03,
      headRotY: Math.sin(phase * 0.3) * 0.04,
      headRotX: Math.sin(phase * 0.5) * 0.02,
    })
  },
  // 2. Thoughtful Tilt - head tilts as if thinking
  {
    name: 'thoughtfulTilt',
    update: (delta, phase) => ({
      hipsRotY: Math.sin(phase * 0.2) * 0.005,
      hipsRotZ: 0,
      spineRotX: 0.02 + Math.sin(phase * 0.4) * 0.015,
      leftArmRotZ: -1.15 + Math.sin(phase * 0.3) * 0.02,
      rightArmRotZ: 1.15,
      headRotY: Math.sin(phase * 0.25) * 0.12,
      headRotX: -0.05 + Math.sin(phase * 0.35) * 0.04,
      headRotZ: Math.sin(phase * 0.2) * 0.08,
    })
  },
  // 3. Weight Shift - shifting weight from foot to foot
  {
    name: 'weightShift',
    update: (delta, phase) => ({
      hipsPosY: Math.sin(phase * 1.5) * 0.008,
      hipsRotY: Math.sin(phase * 0.8) * 0.025,
      hipsRotZ: Math.sin(phase) * 0.012,
      spineRotX: Math.sin(phase * 0.6) * 0.008,
      leftArmRotZ: -1.25 + Math.sin(phase * 0.5) * 0.04,
      rightArmRotZ: 1.25 - Math.sin(phase * 0.5) * 0.04,
      headRotY: Math.sin(phase * 0.4) * 0.03,
    })
  },
  // 4. Confident Pose - stronger stance with subtle chest expansion
  {
    name: 'confidentPose',
    update: (delta, phase) => ({
      hipsRotY: Math.sin(phase * 0.3) * 0.01,
      hipsRotZ: Math.sin(phase * 0.25) * 0.005,
      spineRotX: -0.015 + Math.sin(phase * 0.5) * 0.012,
      chestRotX: Math.sin(phase * 0.8) * 0.02,
      leftArmRotZ: -1.1 + Math.sin(phase * 0.35) * 0.025,
      rightArmRotZ: 1.1 - Math.sin(phase * 0.35) * 0.025,
      leftArmRotX: Math.sin(phase * 0.4) * 0.015,
      rightArmRotX: Math.sin(phase * 0.4) * 0.015,
      headRotY: Math.sin(phase * 0.2) * 0.025,
      headRotX: -0.02,
    })
  },
  // 5. Playful Bounce - light energetic micro-movements
  {
    name: 'playfulBounce',
    update: (delta, phase) => ({
      hipsPosY: Math.abs(Math.sin(phase * 2)) * 0.006,
      hipsRotY: Math.sin(phase * 0.9) * 0.018,
      hipsRotZ: Math.sin(phase * 0.7) * 0.01,
      spineRotX: Math.sin(phase * 1.2) * 0.015,
      leftArmRotZ: -1.18 + Math.sin(phase * 0.8) * 0.035,
      rightArmRotZ: 1.18 - Math.sin(phase * 0.6) * 0.035,
      leftLowerArmRot: 0.1 + Math.sin(phase) * 0.05,
      rightLowerArmRot: -0.1 - Math.sin(phase) * 0.05,
      headRotY: Math.sin(phase * 0.85) * 0.05,
      headRotX: Math.sin(phase * 1.1) * 0.025,
    })
  },
];

// ── Chat Animation Definitions ──
// Triggered when user sends a message
const CHAT_ANIMATIONS = [
  // 1. Engaged Lean - leans forward attentively
  {
    name: 'engagedLean',
    duration: 3,
    update: (progress) => {
      const ease = 1 - Math.pow(1 - progress, 3);
      return {
        hipsPosY: 0,
        hipsRotX: 0.08 * ease,
        spineRotX: 0.12 * ease,
        chestRotX: 0.05 * ease,
        headRotX: -0.15 * ease,
        headRotY: 0,
        leftArmRotZ: -1.0,
        rightArmRotZ: 1.0,
      };
    }
  },
  // 2. Thoughtful Chin - hand-to-chin gesture simulation
  {
    name: 'thoughtfulChin',
    duration: 4,
    update: (progress) => {
      const ease = progress < 0.2 ? progress / 0.2 : (progress > 0.8 ? (1 - progress) / 0.2 : 1);
      return {
        hipsPosY: 0,
        hipsRotY: -0.05 * ease,
        spineRotX: 0.05 * ease,
        headRotY: 0.1 * ease,
        headRotX: 0.08 * ease,
        headRotZ: -0.05 * ease,
        leftArmRotZ: -0.8 * ease,
        leftArmRotX: -0.3 * ease,
        rightArmRotZ: 1.15,
      };
    }
  },
  // 3. Enthusiastic Response - slight bounce with raised energy
  {
    name: 'enthusiastic',
    duration: 2.5,
    update: (progress) => {
      const bounce = Math.sin(progress * Math.PI * 2) * 0.5 + 0.5;
      return {
        hipsPosY: 0.015 * bounce,
        hipsRotY: 0,
        spineRotX: -0.03 * bounce,
        chestRotX: 0.03 * bounce,
        headRotX: -0.05 * bounce,
        leftArmRotZ: -1.05 - 0.1 * bounce,
        rightArmRotZ: 1.05 + 0.1 * bounce,
      };
    }
  },
  // 4. Curious Tilt - questioning head tilt
  {
    name: 'curiousTilt',
    duration: 3.5,
    update: (progress) => {
      const ease = progress < 0.15 ? progress / 0.15 : (progress > 0.85 ? (1 - progress) / 0.15 : 1);
      return {
        hipsPosY: 0,
        hipsRotY: 0.03 * ease,
        spineRotX: 0,
        headRotY: -0.08 * ease,
        headRotX: 0.05 * ease,
        headRotZ: 0.12 * ease,
        leftArmRotZ: -1.2,
        rightArmRotZ: 1.1,
      };
    }
  },
  // 5. Warm Open - welcoming open posture
  {
    name: 'warmOpen',
    duration: 3,
    update: (progress) => {
      const ease = 1 - Math.pow(1 - progress, 2);
      return {
        hipsPosY: 0,
        hipsRotY: 0,
        spineRotX: -0.02 * ease,
        chestRotX: 0.04 * ease,
        headRotX: -0.08 * ease,
        headRotY: 0,
        leftArmRotZ: -1.05 - 0.08 * ease,
        rightArmRotZ: 1.05 + 0.08 * ease,
        leftArmRotX: 0.05 * ease,
        rightArmRotX: 0.05 * ease,
      };
    }
  },
];

// ── Animation Helpers ──
function lerp(start, end, t) {
  return start + (end - start) * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function startIdleAnimation() {
  // Initialize with random idle
  animationState.currentIdleIndex = Math.floor(Math.random() * IDLE_ANIMATIONS.length);
  animationState.idleTimer = 0;
  animationState.state = ANIMATION_STATE.IDLE;
  console.log('🎭 Animation system started with:', IDLE_ANIMATIONS[animationState.currentIdleIndex].name);
}

function pickNextIdle() {
  // SEQUENTIAL: Go through animations in order instead of random
  const next = (animationState.currentIdleIndex + 1) % IDLE_ANIMATIONS.length;
  
  animationState.currentIdleIndex = next;
  animationState.idleTimer = 0;
  console.log('🎭 Sequential switch to idle:', IDLE_ANIMATIONS[next].name);
}

// Reset all bones to default pose
function resetToDefaultPose() {
  if (!vrm) return;
  
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  
  if (hips) {
    hips.position.y = 0;
    hips.rotation.set(0, 0, 0);
  }
  if (spine) spine.rotation.set(0, 0, 0);
  if (chest) chest.rotation.set(0, 0, 0);
  if (head) head.rotation.set(0, 0, 0);
  if (leftUpperArm) leftUpperArm.rotation.set(0, 0, -1.2);
  if (rightUpperArm) rightUpperArm.rotation.set(0, 0, 1.2);
  if (leftLowerArm) leftLowerArm.rotation.set(0, 0, 0.05);
  if (rightLowerArm) rightLowerArm.rotation.set(0, 0, -0.05);
}

// Note: triggerChatAnimation defined below in Chat Animation section

// ── Animation Update Functions ──

function updateIdleAnimation(delta) {
  if (!vrm) return;

  const state = animationState;
  
  // ── Idle Animation Cycling ──
  // Sequential cycling, only switch when in default pose (at cycle boundaries)
  state.idleTimer += delta;
  
  // Only switch animation when we're at the end AND in the default pose blending zone (>85%)
  const cycleProgress = state.idleTimer / state.idleDuration;
  const inDefaultPoseZone = cycleProgress > 0.85;
  
  if (state.idleTimer >= state.idleDuration && state.state === ANIMATION_STATE.IDLE && inDefaultPoseZone) {
    // Reset to default pose first, then switch
    resetToDefaultPose();
    state.idleTimer = 0;
    // Sequential: next animation in list
    state.currentIdleIndex = (state.currentIdleIndex + 1) % IDLE_ANIMATIONS.length;
    console.log('🎭 Sequential switch to idle:', IDLE_ANIMATIONS[state.currentIdleIndex].name);
  }
  
  // Get current idle animation
  const idleAnim = IDLE_ANIMATIONS[state.currentIdleIndex];
  const idlePhase = state.bodySwayPhase + state.idleTimer;
  const rawIdlePose = idleAnim.update(delta, idlePhase);
  
  // (cycleProgress already defined above for cycling logic)
  
  // Blend FROM default at start (first 15%) AND TO default at end (last 15%)
  let blendFactor = 0;
  if (cycleProgress < 0.15) {
    // Easing in from default pose
    const t = cycleProgress / 0.15;
    blendFactor = t * t * (3 - 2 * t); // smoothstep - more default at start
  } else if (cycleProgress > 0.85) {
    // Easing out to default pose
    const t = (cycleProgress - 0.85) / 0.15;
    blendFactor = 1 - t * t * (3 - 2 * t); // smoothstep - more default at end
  }
  
  // Blend current pose with default pose
  const idlePose = {};
  for (const key of Object.keys(DEFAULT_POSE)) {
    const animValue = rawIdlePose[key] !== undefined ? rawIdlePose[key] : DEFAULT_POSE[key];
    idlePose[key] = animValue * (1 - blendFactor) + DEFAULT_POSE[key] * blendFactor;
  }
  
  // ── Breathing (always active, layered on top) ──
  state.breathPhase += delta * 1.2;
  const breathValue = Math.sin(state.breathPhase) * 0.003;
  
  // ── Blinking ──
  state.blinkTimer += delta;
  if (!state.isBlinking && state.blinkTimer >= state.nextBlinkTime) {
    state.isBlinking = true;
    state.blinkProgress = 0;
    state.nextBlinkTime = Math.random() < 0.3 ? 0.15 : (2 + Math.random() * 5);
    state.blinkTimer = 0;
  }

  if (state.isBlinking) {
    state.blinkProgress += delta * 8;
    let blinkWeight;
    if (state.blinkProgress < 0.5) {
      blinkWeight = state.blinkProgress * 2;
    } else if (state.blinkProgress < 1.0) {
      blinkWeight = 1.0 - (state.blinkProgress - 0.5) * 2;
    } else {
      blinkWeight = 0;
      state.isBlinking = false;
    }
    if (vrm.expressionManager) {
      vrm.expressionManager.setValue('blink', blinkWeight);
    }
  }

  // ── Apply Idle Pose ──
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  if (hips) {
    hips.position.y = breathValue + (idlePose.hipsPosY || 0);
    hips.rotation.y = idlePose.hipsRotY || 0;
    hips.rotation.z = idlePose.hipsRotZ || 0;
    hips.rotation.x = idlePose.hipsRotX || 0;
  }
  
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  if (spine) {
    spine.rotation.x = (idlePose.spineRotX || 0) + Math.sin(state.breathPhase) * 0.01;
  }
  
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  if (chest && idlePose.chestRotX !== undefined) {
    chest.rotation.x = idlePose.chestRotX;
  }

  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.y = idlePose.headRotY || 0;
    head.rotation.x = idlePose.headRotX || 0;
    head.rotation.z = idlePose.headRotZ || 0;
  }

  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  if (leftUpperArm) {
    leftUpperArm.rotation.z = idlePose.leftArmRotZ || -1.2;
    leftUpperArm.rotation.x = idlePose.leftArmRotX || 0;
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.z = idlePose.rightArmRotZ || 1.2;
    rightUpperArm.rotation.x = idlePose.rightArmRotX || 0;
  }
  
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  if (leftLowerArm) {
    leftLowerArm.rotation.z = idlePose.leftLowerArmRot !== undefined ? idlePose.leftLowerArmRot : 0.05;
  }
  if (rightLowerArm) {
    rightLowerArm.rotation.z = idlePose.rightLowerArmRot !== undefined ? idlePose.rightLowerArmRot : -0.05;
  }

  // ── Occasional expressions ──
  state.expressionTimer += delta;
  if (state.expressionFadeDir === 0 && state.expressionTimer >= state.nextExpressionTime) {
    const expressions = ['happy', 'relaxed'];
    const available = expressions.filter(e => vrm.expressionManager?.expressionMap?.[e]);
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
      if (state.expressionWeight >= 0.4) state.expressionFadeDir = -1;
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

  // Update sway phases
  state.bodySwayPhase += delta * 0.15;
  state.headSwayPhase += delta * 0.3;

  // Update VRM
  vrm.update(delta);
}

// ── Chat Animation ──
function triggerChatAnimation() {
  const state = animationState;
  state.state = ANIMATION_STATE.CHAT;
  state.chatTimer = 0;
  
  // Pick random chat animation
  let nextIndex;
  do {
    nextIndex = Math.floor(Math.random() * CHAT_ANIMATIONS.length);
  } while (nextIndex === state.currentChatIndex && CHAT_ANIMATIONS.length > 1);
  state.currentChatIndex = nextIndex;
  
  console.log('Chat animation triggered:', CHAT_ANIMATIONS[nextIndex].name);
}

function updateChatAnimation(delta) {
  if (!vrm) return;
  
  const state = animationState;
  const chatAnim = CHAT_ANIMATIONS[state.currentChatIndex];
  
  state.chatTimer += delta;
  const progress = Math.min(1, state.chatTimer / chatAnim.duration);
  const pose = chatAnim.update(progress);
  
  // Apply chat pose
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  if (hips) {
    hips.position.y = pose.hipsPosY || 0;
    hips.rotation.x = pose.hipsRotX || 0;
    hips.rotation.y = pose.hipsRotY || 0;
    hips.rotation.z = pose.hipsRotZ || 0;
  }
  
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  if (spine) {
    spine.rotation.x = pose.spineRotX || 0;
  }
  
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  if (chest && pose.chestRotX !== undefined) {
    chest.rotation.x = pose.chestRotX;
  }
  
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.x = pose.headRotX || 0;
    head.rotation.y = pose.headRotY || 0;
    head.rotation.z = pose.headRotZ || 0;
  }
  
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  if (leftUpperArm) {
    leftUpperArm.rotation.z = pose.leftArmRotZ !== undefined ? pose.leftArmRotZ : -1.2;
    leftUpperArm.rotation.x = pose.leftArmRotX || 0;
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.z = pose.rightArmRotZ !== undefined ? pose.rightArmRotZ : 1.2;
  }
  
  // Continue breathing
  state.breathPhase += delta * 1.2;
  const breathValue = Math.sin(state.breathPhase) * 0.003;
  if (hips) hips.position.y += breathValue;
  
  vrm.update(delta);
  
  // Return to idle when done
  if (progress >= 1) {
    state.state = ANIMATION_STATE.IDLE;
    state.idleTimer = 0;
    console.log('Chat animation complete, returning to idle');
  }
}

// ── Twirl Animation ──
function triggerTwirlAnimation() {
  const state = animationState;
  state.state = ANIMATION_STATE.TWIRL;
  state.twirlTimer = 0;
  state.twirlPhase = 'twirl';
  state.twirlRotation = 0;
  console.log('🎭 Twirl animation triggered!');
}

function updateTwirlAnimation(delta) {
  if (!vrm) return;
  
  const state = animationState;
  state.twirlTimer += delta;
  
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips');
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  
  // TWIRL PHASE (0-1.5s) - Full 360 spin with playful arm raise
  if (state.twirlPhase === 'twirl') {
    const twirlProgress = Math.min(1, state.twirlTimer / 1.5);
    const ease = 1 - Math.pow(1 - twirlProgress, 3); // Ease out cubic
    
    // Full 360 rotation + extra for momentum feel
    state.twirlRotation = ease * Math.PI * 2;
    
    if (hips) {
      hips.rotation.y = state.twirlRotation;
      // Slight hop during twirl
      hips.position.y = Math.sin(twirlProgress * Math.PI) * 0.03;
    }
    
    // Arms out for balance
    if (leftUpperArm) {
      leftUpperArm.rotation.z = -1.5 + Math.sin(twirlProgress * Math.PI * 2) * 0.2;
    }
    if (rightUpperArm) {
      rightUpperArm.rotation.z = 1.5 - Math.sin(twirlProgress * Math.PI * 2) * 0.2;
    }
    
    if (twirlProgress >= 1) {
      state.twirlPhase = 'smile';
      state.twirlTimer = 0;
      console.log('🎭 Twirl complete, smiling...');
    }
  }
  
  // SMILE PHASE (0-0.8s) - Big smile expression
  else if (state.twirlPhase === 'smile') {
    const smileProgress = Math.min(1, state.twirlTimer / 0.8);
    
    // Big happy expression
    if (vrm.expressionManager) {
      vrm.expressionManager.setValue('happy', Math.sin(smileProgress * Math.PI) * 0.8);
    }
    
    // Head tilt for cute factor
    if (head) {
      head.rotation.z = Math.sin(smileProgress * Math.PI) * 0.1;
    }
    
    if (smileProgress >= 1) {
      state.twirlPhase = 'wink';
      state.twirlTimer = 0;
      console.log('🎭 Smiling, now winking...');
    }
  }
  
  // WINK PHASE (0-0.6s) - Wink with one eye
  else if (state.twirlPhase === 'wink') {
    const winkProgress = Math.min(1, state.twirlTimer / 0.6);
    
    // Maintain smile
    if (vrm.expressionManager) {
      vrm.expressionManager.setValue('happy', 0.7);
    }
    
    // Wink (blink left eye only - simulated with full blink for VRM standard)
    if (winkProgress < 0.5) {
      const winkWeight = winkProgress * 2;
      if (vrm.expressionManager) {
        vrm.expressionManager.setValue('blink', winkWeight * 0.7);
      }
    } else {
      const winkWeight = (1 - winkProgress) * 2;
      if (vrm.expressionManager) {
        vrm.expressionManager.setValue('blink', winkWeight * 0.7);
      }
    }
    
    if (winkProgress >= 1) {
      state.twirlPhase = 'return';
      state.twirlTimer = 0;
      console.log('🎭 Wink complete, returning to idle...');
    }
  }
  
  // RETURN PHASE (0-1.0s) - Blend back to default pose smoothly
  else if (state.twirlPhase === 'return') {
    const returnProgress = Math.min(1, state.twirlTimer / 1.0);
    const ease = 1 - Math.pow(1 - returnProgress, 3);
    
    // Reset hips rotation back to 0
    if (hips) {
      hips.rotation.y = (1 - ease) * Math.PI * 2;
      hips.position.y = ease * breathValue;
    }
    
    // Reset arms to default
    if (leftUpperArm) {
      leftUpperArm.rotation.z = -1.2 * ease + (1 - ease) * (-1.5);
    }
    if (rightUpperArm) {
      rightUpperArm.rotation.z = 1.2 * ease + (1 - ease) * 1.5;
    }
    
    // Fade out expressions
    if (vrm.expressionManager) {
      vrm.expressionManager.setValue('happy', (1 - returnProgress) * 0.5);
      vrm.expressionManager.setValue('blink', 0);
    }
    
    // Reset head completely (all axes)
    if (head) {
      head.rotation.x = 0;
      head.rotation.y = (1 - ease) * state.twirlRotation; // Unwind any rotation
      head.rotation.z = (1 - ease) * 0.1;
    }
    
    // Reset spine and chest too
    if (spine) spine.rotation.x = 0;
    if (chest) chest.rotation.x = 0;
    
    if (returnProgress >= 1) {
      state.state = ANIMATION_STATE.IDLE;
      state.twirlPhase = 'twirl';
      state.twirlRotation = 0;
      state.wasDragged = false;
      state.idleTimer = 0;
      // Force reset all bones to default
      resetToDefaultPose();
      console.log('🎭 Twirl sequence complete, back to idle!');
    }
  }
  
  // Breathing continues during twirl
  state.breathPhase += delta * 1.2;
  const breathValue = Math.sin(state.breathPhase) * 0.003;
  
  vrm.update(delta);
}

// ── Main Animation Update ──
function updateAnimation(delta) {
  const state = animationState;
  
  if (state.state === ANIMATION_STATE.TWIRL) {
    updateTwirlAnimation(delta);
  } else if (state.state === ANIMATION_STATE.CHAT) {
    updateChatAnimation(delta);
  } else {
    updateIdleAnimation(delta);
  }
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

  updateAnimation(delta);
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
// Track drag state for twirl animation
let dragStartTime = 0;
let isDragging = false;

canvas.addEventListener('mousedown', async (e) => {
  // Don't drag if clicking on chat area
  if (e.target.closest('#chat-container')) return;
  if (e.buttons === 1) {
    dragStartTime = Date.now();
    isDragging = true;
    animationState.isBeingDragged = true;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch {}
  }
});

// Detect drag end and trigger twirl
window.addEventListener('mouseup', () => {
  if (isDragging) {
    const dragDuration = Date.now() - dragStartTime;
    isDragging = false;
    animationState.isBeingDragged = false;
    animationState.wasDragged = true;
    animationState.dragEndTimer = 0;
    
    // Only trigger twirl if drag was significant (>100ms) and not currently twirling
    if (dragDuration > 100 && animationState.state !== ANIMATION_STATE.TWIRL) {
      triggerTwirlAnimation();
    }
  }
});

// Also keep the top drag region
document.getElementById('drag-region')?.addEventListener('mousedown', async (e) => {
  if (e.buttons === 1) {
    dragStartTime = Date.now();
    isDragging = true;
    animationState.isBeingDragged = true;
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

    // Trigger chat animation when user sends message
    triggerChatAnimation();

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
