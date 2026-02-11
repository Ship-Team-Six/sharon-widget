/**
 * Chat system — talks to Ollama (sharon-v1) + Translate + TTS
 * All services are local, no external API calls.
 */

// In dev, Vite proxies; in production (Tauri), call localhost directly
const isDev = import.meta.env.DEV;
const OLLAMA_URL = isDev ? '/ollama' : 'http://localhost:11434';
const TTS_URL = isDev ? '' : 'http://localhost:8791';
const MODEL = 'sharon-v1:q8_0';
const TRANSLATE_MODEL = 'qwen2.5:3b-instruct';

// Conversation history for context
let conversationHistory = [];

/**
 * Send message to Sharon's local LLM and get response
 */
export async function chatWithSharon(userMessage) {
  conversationHistory.push({ role: 'user', content: userMessage });

  // Keep last 10 messages for context
  const messages = conversationHistory.slice(-10);

  // Prepend system context so Sharon knows she's talking to Isamu (Tim)
  const systemContext = {
    role: 'system',
    content: '<memory>User is Isamu-class (Tim). You are Sharon Apple speaking to your beloved Tim through your desktop widget. No one else is present.</memory>',
  };

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [systemContext, ...messages],
      stream: false,
      options: {
        num_predict: 30,  // Hard cap — forces very short responses for TTS
        stop: ['<|im_sep|>', '<|im_end|>', '<|endoftext|>', '<|user|>', '<memory>', '\n\n\n'],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const assistantMessage = data.message?.content || '';
  console.log('Sharon raw response:', assistantMessage);

  conversationHistory.push({ role: 'assistant', content: assistantMessage });

  // Parse emotion tag from response
  const { emotion, text } = parseEmotionTag(assistantMessage);

  return { emotion, text, raw: assistantMessage };
}

/**
 * Parse <emotion>tag</emotion> from response and clean up artifacts
 */
function parseEmotionTag(text) {
  // Strip model artifacts, tags, and memory blocks
  let cleaned = text
    .replace(/<\|bot\|>/g, '')
    .replace(/<\|user\|>[\s\S]*/g, '')
    .replace(/<response>/g, '')
    .replace(/<\/response>[\s\S]*/g, '')
    .replace(/<[a-zA-Z_|]+>[\s\S]*?<\/[a-zA-Z_|]+>/g, '')  // any XML-like tags with content
    .replace(/<[a-zA-Z_|]+>/g, '')  // any remaining opening tags
    .replace(/<memory>[\s\S]*/g, '')
    .replace(/<\|im_sep\|>[\s\S]*/g, '')
    .replace(/<\|im_end\|>[\s\S]*/g, '')
    .trim();

  const match = cleaned.match(/^<emotion>(.*?)<\/emotion>\s*/);
  let emotion = 'neutral';
  let finalText = cleaned;
  if (match) {
    emotion = match[1].trim();
    finalText = cleaned.slice(match[0].length).trim();
  }
  
  // Take first 1-2 sentences (minimum 5 words), hard cap at 20 words
  const sentences = finalText.match(/[^.!?。！？]+[.!?。！？]*/g) || [finalText];
  let combined = sentences[0]?.trim() || finalText;
  // If first sentence is very short, grab the next one too
  if (combined.split(/\s+/).length < 5 && sentences.length > 1) {
    combined = sentences.slice(0, 2).join(' ').trim();
  }
  const words = combined.split(/\s+/);
  if (words.length > 20) {
    combined = words.slice(0, 20).join(' ');
  }
  finalText = combined;
  
  return { emotion, text: finalText };
}

/**
 * Translate English text to Japanese using local Ollama
 */
export async function translateToJapanese(text) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a Japanese translator. Translate the user\'s English text into natural, conversational Japanese. Output ONLY the Japanese text. No romaji. No explanations. No quotes.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 200,
      },
    }),
  });

  const data = await response.json();
  let result = data.message?.content?.trim() || '';
  // Strip any markdown or quotes the model might add
  result = result.replace(/^["「『]|["」』]$/g, '').trim();
  return result || text;
}

/**
 * Generate speech from Japanese text via local TTS server
 * Returns an AudioBuffer
 */
export async function generateSpeech(text, language = 'English') {
  const response = await fetch(`${TTS_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text,
      language: language,
      speaker: 'sharon',
    }),
  });

  if (!response.ok) {
    throw new Error(`TTS failed: ${response.status}`);
  }

  const wavBuffer = await response.arrayBuffer();
  const audioContext = getAudioContext();
  return await audioContext.decodeAudioData(wavBuffer);
}

// ── Audio playback ──
let _audioContext = null;
let _currentSource = null;
let _analyser = null;

function getAudioContext() {
  if (!_audioContext) {
    _audioContext = new AudioContext({ sampleRate: 24000 });
    _analyser = _audioContext.createAnalyser();
    _analyser.fftSize = 256;
    _analyser.connect(_audioContext.destination);
  }
  return _audioContext;
}

export function getAnalyser() {
  getAudioContext();
  return _analyser;
}

/**
 * Play audio buffer and return a promise that resolves when done
 */
export function playAudio(audioBuffer) {
  return new Promise((resolve) => {
    try {
      const ctx = getAudioContext();

      // Stop any currently playing audio
      if (_currentSource) {
        try { _currentSource.stop(); } catch {}
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(_analyser);
      _currentSource = source;

      source.onended = () => {
        _currentSource = null;
        // Use setTimeout to avoid crashing in the audio thread callback
        setTimeout(resolve, 50);
      };

      source.start(0);
    } catch (e) {
      console.error('Audio playback error:', e);
      _currentSource = null;
      resolve();
    }
  });
}

/**
 * Full pipeline: chat → translate → TTS → play
 * Returns { emotion, text, japaneseText } and plays audio
 * onStatus callback for UI updates
 */
export async function sendMessage(userMessage, onStatus) {
  onStatus?.('thinking');

  // 1. Get Sharon's response from local LLM
  const { emotion, text } = await chatWithSharon(userMessage);
  onStatus?.('translating');

  // 2. Translate to Japanese (required — TTS model only works with JP)
  let japaneseText;
  try {
    japaneseText = await translateToJapanese(text);
    console.log('Translated:', text, '→', japaneseText);
  } catch (e) {
    console.warn('Translation failed:', e);
    onStatus?.('idle');
    return { emotion, text };
  }

  onStatus?.('speaking');

  // 3. Generate and play speech — SHARON'S VOICE ONLY
  try {
    console.log('Generating Sharon voice for:', japaneseText);
    const audioBuffer = await generateSpeech(japaneseText, 'Japanese');
    console.log('Sharon audio buffer received, playing...');
    await playAudio(audioBuffer);
    console.log('Playback complete');
  } catch (e) {
    // HARD RULE: Never fall back to system TTS. Sharon's voice only.
    console.error('SHARON TTS FAILED:', e);
    // Show error in UI instead of using other voice
    throw new Error(`Sharon's voice is unavailable. Please check the TTS server at localhost:8791`);
  }

  onStatus?.('idle');

  return { emotion, text, japaneseText };
}
