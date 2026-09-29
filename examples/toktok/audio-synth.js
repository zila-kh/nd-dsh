/**
 * TokTok Clone - Offline Procedural Web Audio Engine
 * Pure Vanilla JS - Zero external MP3/audio files, runs 100% offline.
 * Synthesizes rhythmic beats, chill chords, and ambient soundscapes using native Web Audio API.
 *
 * Classic (non-module) script so the app runs from file:// with no server.
 * Public API is exposed on the shared `TokTok` namespace.
 */

class ProceduralAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this.muted = true;
    this.currentTrack = null;
    this.timerId = null;
    this.step = 0;
    this.frequencyData = new Uint8Array(32);
    this.noiseNode = null;
  }

  ensureContext() {
    if (!this.ctx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.45, this.ctx.currentTime);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;

      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  isMuted() {
    return this.muted;
  }

  setMuted(muted) {
    this.muted = muted;
    this.ensureContext();
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(this.muted ? 0 : 0.45, now + 0.1);
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  /**
   * Helper to play an oscillator note with an ADSR envelope
   */
  playTone(freq, type = 'sine', duration = 0.3, volume = 0.3, detune = 0) {
    if (!this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (detune) osc.detune.setValueAtTime(detune, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + duration + 0.05);
    } catch {
      // Audio node cleanup on error
    }
  }

  /**
   * White/pink noise burst for percussion / rain
   */
  playNoise(duration = 0.1, volume = 0.15) {
    if (!this.ctx || this.muted) return;
    try {
      const bufferSize = this.ctx.sampleRate * duration;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(3000, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noise.start();
    } catch {
      // Ignore audio glitches
    }
  }

  /**
   * Stop any running sequence loop
   */
  stopTrack() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.currentTrack = null;
  }

  /**
   * Start synth sequencing loop matching the visual theme
   */
  playTrack(visualType) {
    this.stopTrack();
    this.currentTrack = visualType;
    this.step = 0;

    // 16-step rhythmic scheduler
    const intervalMs = visualType === 'matrix-code' ? 120 : (visualType === 'lofi-coffee' ? 240 : 160);

    this.timerId = setInterval(() => {
      if (this.muted) {
        this.step = (this.step + 1) % 16;
        return;
      }
      this.ensureContext();

      switch (this.currentTrack) {
        case 'cyber-neon':
          this.stepCyberNeon(this.step);
          break;
        case 'lofi-coffee':
          this.stepLofiCoffee(this.step);
          break;
        case 'fluid-wave':
          this.stepFluidWave(this.step);
          break;
        case 'matrix-code':
          this.stepMatrixCode(this.step);
          break;
        case 'sunset-drive':
          this.stepSunsetDrive(this.step);
          break;
        default:
          this.stepCyberNeon(this.step);
          break;
      }

      this.step = (this.step + 1) % 16;
    }, intervalMs);
  }

  stepCyberNeon(step) {
    // 4-on-the-floor kick
    if (step % 4 === 0) {
      this.playTone(110, 'sine', 0.22, 0.45);
    }
    // Cyber bass groove
    const bassNotes = [55, 55, 65, 55, 73, 55, 65, 82];
    this.playTone(bassNotes[step % bassNotes.length], 'sawtooth', 0.18, 0.22);

    // Arpeggio lead
    const leadNotes = [220, 261.6, 329.6, 392, 440, 523.2, 392, 329.6];
    if (step % 2 === 1) {
      this.playTone(leadNotes[step % leadNotes.length], 'square', 0.12, 0.15);
    }
    // Hi-hat tick
    if (step % 2 === 1) {
      this.playNoise(0.04, 0.1);
    }
  }

  stepLofiCoffee(step) {
    // Warm Rhodes electric piano 7th chords
    const chordFmaj7 = [174.6, 220, 261.6, 329.6];
    const chordEm7 = [164.8, 196, 246.9, 293.7];
    const chordDm7 = [146.8, 174.6, 220, 261.6];
    const chordAm7 = [220, 261.6, 329.6, 392];

    const currentChord = step < 4 ? chordFmaj7 : (step < 8 ? chordEm7 : (step < 12 ? chordDm7 : chordAm7));

    if (step % 4 === 0) {
      currentChord.forEach((f, idx) => {
        this.playTone(f, 'triangle', 1.2, 0.14, idx * 3);
      });
    }

    // Soft lo-fi vinyl hiss / rain texture
    if (step % 2 === 0) {
      this.playNoise(0.18, 0.04);
    }

    // Soft kick & snare
    if (step === 0 || step === 8) {
      this.playTone(70, 'sine', 0.35, 0.3);
    }
    if (step === 4 || step === 12) {
      this.playNoise(0.09, 0.12);
    }
  }

  stepFluidWave(step) {
    // Ambient floating harmonic chimes
    const pentatonic = [261.6, 293.7, 329.6, 392, 440, 523.2];
    if (step % 3 === 0) {
      const note = pentatonic[(step + 2) % pentatonic.length];
      this.playTone(note, 'sine', 1.4, 0.2);
    }
    // Water droplet blip
    if (step === 7 || step === 14) {
      this.playTone(880, 'sine', 0.08, 0.15);
    }
  }

  stepMatrixCode(step) {
    // Fast cyber hacking data arps
    const hexScale = [130.8, 146.8, 164.8, 196, 220, 261.6, 293.7, 329.6];
    const note = hexScale[(step * 3) % hexScale.length];
    this.playTone(note, 'square', 0.09, 0.16);

    // Deep sub drop
    if (step === 0) {
      this.playTone(45, 'sawtooth', 0.45, 0.35);
    }
  }

  stepSunsetDrive(step) {
    // Outrun saw octave bass
    const bassOctave = (step % 2 === 0) ? 65.4 : 130.8;
    this.playTone(bassOctave, 'sawtooth', 0.15, 0.25);

    // Bright 80s poly chord
    if (step % 4 === 0) {
      [329.6, 392, 493.9, 587.3].forEach(note => {
        this.playTone(note, 'sawtooth', 0.6, 0.1);
      });
    }
    // Kick drum
    if (step % 4 === 0) {
      this.playTone(90, 'sine', 0.2, 0.4);
    }
    // Snare
    if (step === 4 || step === 12) {
      this.playNoise(0.12, 0.18);
    }
  }

  /**
   * Get current visualizer energy (0.0 to 1.0)
   */
  getAudioEnergy() {
    if (!this.analyser || this.muted) {
      return 0.3; // Default baseline simulated bounce
    }
    try {
      this.analyser.getByteFrequencyData(this.frequencyData);
      let sum = 0;
      for (let i = 0; i < 16; i++) {
        sum += this.frequencyData[i];
      }
      return Math.min(1, Math.max(0.1, (sum / 16) / 128));
    } catch {
      return 0.3;
    }
  }
}

const audioSynth = new ProceduralAudioEngine();

/* Expose the public API on the shared namespace (works in browser + Node tests). */
globalThis.TokTok = Object.assign(globalThis.TokTok || {}, {
  audioSynth
});
