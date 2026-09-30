/**
 * TokTok Clone - Vite entry module.
 *
 * Side-effect imports only: each runtime file publishes its API on the shared
 * `globalThis.TokTok` namespace, so evaluation ORDER matters and must stay
 * data -> canvas-engine -> audio-synth -> app (app.js boots immediately and
 * reads the namespace at evaluation time).
 *
 * The emitted bundle is a single classic IIFE script (see vite.config.js), so
 * the built page still runs straight from file:// with no server.
 */
import './data.js';
import './canvas-engine.js';
import './audio-synth.js';
import './app.js';
