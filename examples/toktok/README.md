# TokTok Clone (Vanilla JS + CSS)

A self-contained TikTok-style short-form video app built with pure **Vanilla JavaScript** and modern **CSS**, designed according to the specification:
> **Objective**: TokTok clone without real URL without server  
> **Company**: Jonh (`build and ship`)

---

## Key Highlights

1. **Zero External Media URLs / Zero Server Dependencies**:
   - Runs 100% offline directly in any modern browser without remote video servers or video streaming CDNs.
   - Built-in **procedural HTML5 Canvas video simulation engine** with 5 dynamic, fluid real-time animated video scenes:
     - **Cyber Neon Pulse** (`@cyber_pulse`): High-energy visualizer with audio spectrum equalizer, neon geometric portals, and floating particles.
     - **Cozy Lo-Fi Coffee Chill** (`@cozy_vibes`): Atmospheric pixel rain, steaming coffee mug, warm vinyl grain, and ambient night window.
     - **Satisfying Fluid Sim & Wave** (`@satisfy_art`): Hypnotic morphing organic liquid blobs and physics color ripples.
     - **Matrix Code Stream** (`@dev_ninja`): Cascading phosphor green digital rain terminal with glitch text pulses.
     - **Retro Synthwave Highway** (`@retro_driver`): 3D wireframe perspective highway heading towards a retro synth sun.
   - **Offline Procedural Web Audio Engine**: Synthesizes custom rhythmic ambient audio loops per video using browser native Web Audio API oscillators and gain envelopes without loading any external mp3/wav files!

2. **Complete TikTok Interaction Suite**:
   - **Vertical Snap Scroll**: Butter-smooth `scroll-snap-type: y mandatory` feed with touch swipe, mouse drag, mouse wheel, or Arrow Up/Down navigation.
   - **Double-Tap to Like**: Tap anywhere on the video twice (or click the heart) to spawn floating dynamic heart bursts at the exact touch/click coordinates!
   - **Single-Tap Play/Pause**: Smooth central animated play/pause indicator with automatic canvas frame loop control.
   - **Interactive Action Sidebar**:
     - Follow button on avatar with checkmark morph.
     - Animated like heart with incrementing formatted counters (`1.2M`, `850.4K`).
     - Comment button opening the sliding bottom sheet drawer.
     - Favorite / Bookmark button with bookmark toggle and counter.
     - Share modal with real clipboard copy ("Copy Link") and simulated social sharing.
     - Spinning vinyl music disc with rising musical notes.
   - **Interactive Comment Drawer**:
     - Realistic existing comments with avatars, timestamps, and interactive like counts.
     - Live comment submission: type and post custom comments with instant insertion and local persistence!
     - Quick emoji reaction picker (❤️, 🔥, 😂, 👏, 💯, ✨).
   - **Create Custom Video (+)**:
     - In-app video creator dialog: pick from procedural canvas renderers, set custom caption, username, audio title, and tags. Instantly prepends the new custom video to the live feed!
   - **Top Feed Switcher**: Switch between "For You" (FYP) and "Following" feeds.
   - **Search / Filter**: Search creators, captions, or hashtag keywords in real-time.
   - **Sound Scrubber & Progress Bar**: Real-time progress bar reflecting simulated video playback loop.
   - **Bottom Navigation**: Home, Discover, Create (+), Inbox (notifications badge), and Profile tabs.

3. **Accessibility & Controls**:
   - `ArrowUp` / `ArrowDown` or `k` / `j`: Next / Previous video
   - `Space`: Play / Pause toggle
   - `m`: Mute / Unmute audio
   - `l`: Like current video
   - `c`: Open / Close comment drawer
   - `Escape`: Close any open drawer or modal
   - Fully semantic markup with ARIA roles, `aria-live` screen-reader status announcer, and accessible focus states.

---

## Quick Start

Open `index.html` directly in any web browser, or run a local static server:

```bash
# Using Node.js built-in script
npm start

# Or open directly in your favorite browser:
# double click index.html or run:
# start index.html (Windows) / open index.html (macOS)
```

Run test suite:
```bash
npm test
# Or comprehensive verification:
npm run verify
```
