/**
 * Unit tests for audio-synth.js (offline procedural Web Audio engine).
 * Node has no window/AudioContext, so these tests prove the engine degrades
 * gracefully instead of throwing when audio APIs are unavailable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../audio-synth.js';

const T = globalThis.TokTok;
const synth = T.audioSynth;

test('engine starts muted', () => {
  assert.equal(synth.isMuted(), true);
});

test('toggleMute flips state and returns the new value', () => {
  const first = synth.toggleMute();
  assert.equal(first, false);
  const second = synth.toggleMute();
  assert.equal(second, true);
});

test('setMuted is idempotent', () => {
  assert.equal(synth.setMuted(true), true);
  assert.equal(synth.setMuted(true), true);
  assert.equal(synth.setMuted(false), false);
  assert.equal(synth.setMuted(false), false);
  synth.setMuted(true);
});

test('getAudioEnergy returns a bounded value without an analyser', () => {
  const energy = synth.getAudioEnergy();
  assert.equal(typeof energy, 'number');
  assert.ok(energy >= 0 && energy <= 1, `energy ${energy} out of range`);
});

test('playTrack accepts every visual type and stopTrack cleans up', () => {
  for (const type of ['cyber-neon', 'lofi-coffee', 'fluid-wave', 'matrix-code', 'sunset-drive', 'unknown']) {
    assert.doesNotThrow(() => synth.playTrack(type));
    assert.doesNotThrow(() => synth.stopTrack());
  }
  assert.equal(synth.currentTrack, null);
});

test('tone and noise helpers are no-ops without an AudioContext', () => {
  assert.doesNotThrow(() => synth.playTone(440, 'sine', 0.1, 0.2));
  assert.doesNotThrow(() => synth.playNoise(0.05, 0.1));
});
