/**
 * Lip sync system — drives VRM mouth blend shapes from audio analyser
 */

const VOWEL_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh'];

// Map frequency bands to mouth shapes (simplified viseme mapping)
// We use volume-based approach: louder = more open mouth
let _vrm = null;
let _analyser = null;
let _active = false;
let _dataArray = null;

export function initLipSync(vrm, analyser) {
  _vrm = vrm;
  _analyser = analyser;
  _dataArray = new Uint8Array(analyser.frequencyBinCount);
}

export function startLipSync() {
  _active = true;
}

export function stopLipSync() {
  _active = false;
  // Reset mouth to closed — delayed slightly to avoid audio thread race
  setTimeout(() => {
    if (_vrm?.expressionManager) {
      VOWEL_SHAPES.forEach(shape => {
        try { _vrm.expressionManager.setValue(shape, 0); } catch {}
      });
    }
  }, 100);
}

/**
 * Call this every frame during animation loop
 */
export function updateLipSync() {
  if (!_active || !_vrm?.expressionManager || !_analyser || !_dataArray) return;

  _analyser.getByteFrequencyData(_dataArray);

  // Get volume from frequency data (focus on voice range ~80-3000Hz)
  // At 24kHz sample rate with 256 FFT, each bin = ~93.75Hz
  // Voice fundamentals: bins 1-10 roughly
  let sum = 0;
  const voiceBins = Math.min(16, _dataArray.length);
  for (let i = 1; i < voiceBins; i++) {
    sum += _dataArray[i];
  }
  const avgVolume = sum / (voiceBins - 1) / 255; // normalize to 0-1

  // Simple volume-to-mouth mapping
  // Cycle through vowel shapes based on time for variety
  const time = performance.now() / 1000;
  const vowelIndex = Math.floor(time * 8) % VOWEL_SHAPES.length;

  // Reset all
  VOWEL_SHAPES.forEach(shape => {
    try { _vrm.expressionManager.setValue(shape, 0); } catch {}
  });

  if (avgVolume > 0.05) {
    // Primary mouth shape based on volume
    const mouthOpen = Math.min(1, avgVolume * 2.5);
    
    // Blend between 'aa' (open) and cycling vowels
    try {
      _vrm.expressionManager.setValue('aa', mouthOpen * 0.6);
      _vrm.expressionManager.setValue(VOWEL_SHAPES[vowelIndex], mouthOpen * 0.4);
    } catch {}
  }
}
