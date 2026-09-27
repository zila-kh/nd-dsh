/**
 * TokTok Clone - Procedural HTML5 Canvas Video Simulation Engine
 * Pure Vanilla JS - Zero external video assets, zero server needed.
 * Features 5 distinct visual experiences rendered in real-time.
 *
 * Classic (non-module) script so the app runs from file:// with no server.
 * Public API is exposed on the shared `TokTok` namespace.
 */

// Characters for the Matrix rain
const MATRIX_CHARS = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ'.split('');

// Pre-initialized state caches for persistent particle / column simulations
const matrixColumns = [];
const coffeeSteamParticles = [];
const rainDrops = [];
const cyberParticles = [];
const fluidNodes = [];

// Initialize persistent simulation elements
function initSimulations() {
  // Matrix columns
  matrixColumns.length = 0;
  const colCount = 35;
  for (let i = 0; i < colCount; i++) {
    matrixColumns.push({
      y: Math.random() * -100,
      speed: 1.5 + Math.random() * 2.5,
      chars: Array.from({ length: 24 }, () => MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]),
      switchInterval: Math.floor(Math.random() * 8) + 4
    });
  }

  // Coffee steam particles
  coffeeSteamParticles.length = 0;
  for (let i = 0; i < 40; i++) {
    coffeeSteamParticles.push({
      x: 0,
      y: Math.random() * 140,
      radius: 4 + Math.random() * 10,
      alpha: Math.random() * 0.4,
      drift: (Math.random() - 0.5) * 0.8,
      speed: 0.6 + Math.random() * 0.8
    });
  }

  // Lo-Fi rain drops
  rainDrops.length = 0;
  for (let i = 0; i < 70; i++) {
    rainDrops.push({
      x: Math.random(),
      y: Math.random(),
      len: 12 + Math.random() * 20,
      speed: 0.015 + Math.random() * 0.02,
      opacity: 0.2 + Math.random() * 0.4
    });
  }

  // Cyber particles
  cyberParticles.length = 0;
  for (let i = 0; i < 45; i++) {
    cyberParticles.push({
      angle: Math.random() * Math.PI * 2,
      radius: 30 + Math.random() * 180,
      speed: 0.005 + Math.random() * 0.015,
      size: 1.5 + Math.random() * 3,
      color: Math.random() > 0.5 ? '#00f2fe' : '#fe2c55'
    });
  }

  // Fluid wave nodes
  fluidNodes.length = 0;
  for (let i = 0; i < 8; i++) {
    fluidNodes.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.002,
      vy: (Math.random() - 0.5) * 0.002,
      radius: 80 + Math.random() * 90,
      hue: Math.random() * 360
    });
  }
}

initSimulations();

/**
 * Visual Renderer 1: Cyber Neon Pulse & Spectrum Equalizer
 */
function renderCyberNeon(ctx, width, height, time, audioEnergy = 0.5) {
  // Deep cyberpunk dark background with subtle vignette
  const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, height * 0.7);
  bgGrad.addColorStop(0, '#0a0d24');
  bgGrad.addColorStop(0.6, '#040510');
  bgGrad.addColorStop(1, '#000000');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height * 0.46;
  const pulse = Math.sin(time * 3.5) * 0.15 + (audioEnergy * 0.2);

  // Concentric neon portal rings
  ctx.save();
  for (let r = 3; r >= 1; r--) {
    const ringRadius = (55 * r + Math.sin(time * 2 + r) * 12) * (1 + pulse);
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = r === 1 ? '#fe2c55' : (r === 2 ? '#25f4ee' : '#7928ca');
    ctx.lineWidth = 3 + pulse * 4;
    ctx.shadowBlur = 18;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.stroke();
  }

  // Central pulsating emblem / hexagon
  ctx.beginPath();
  const hexRadius = (32 + Math.cos(time * 4) * 6) * (1 + pulse);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + time * 0.8;
    const hx = cx + Math.cos(a) * hexRadius;
    const hy = cy + Math.sin(a) * hexRadius;
    if (i === 0) ctx.moveTo(hx, hy);
    else ctx.lineTo(hx, hy);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(37, 244, 238, 0.2)';
  ctx.fill();
  ctx.strokeStyle = '#25f4ee';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Floating orbit particles
  cyberParticles.forEach(p => {
    p.angle += p.speed;
    const px = cx + Math.cos(p.angle) * p.radius * (1 + pulse * 0.3);
    const py = cy + Math.sin(p.angle) * p.radius * 0.7;
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.color;
    ctx.fill();
  });
  ctx.restore();

  // Equalizer spectrum bars at bottom
  const barCount = 28;
  const barSpacing = width / barCount;
  const barWidth = barSpacing * 0.65;
  const baseY = height * 0.84;

  ctx.save();
  for (let i = 0; i < barCount; i++) {
    const freqOffset = Math.sin(time * 6 + i * 0.4) * 0.5 + 0.5;
    const barHeight = 20 + freqOffset * 110 * (0.6 + audioEnergy * 0.8);
    const bx = i * barSpacing + (barSpacing - barWidth) / 2;

    const barGrad = ctx.createLinearGradient(0, baseY, 0, baseY - barHeight);
    barGrad.addColorStop(0, '#25f4ee');
    barGrad.addColorStop(0.6, '#0070f3');
    barGrad.addColorStop(1, '#fe2c55');

    ctx.fillStyle = barGrad;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#25f4ee';

    // Rounded top bar
    ctx.beginPath();
    const topY = baseY - barHeight;
    ctx.roundRect ? ctx.roundRect(bx, topY, barWidth, barHeight, [4, 4, 0, 0]) : ctx.rect(bx, topY, barWidth, barHeight);
    ctx.fill();

    // Mirror reflection below
    ctx.fillStyle = 'rgba(37, 244, 238, 0.12)';
    ctx.fillRect(bx, baseY + 4, barWidth, barHeight * 0.25);
  }
  ctx.restore();

  // Subtle cyber scanlines
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1.5);
  }
}

/**
 * Visual Renderer 2: Cozy Lo-Fi Coffee Rain
 */
function renderLofiCoffee(ctx, width, height, time) {
  // Warm twilight night sky through window
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
  skyGrad.addColorStop(0, '#101322');
  skyGrad.addColorStop(0.6, '#281c32');
  skyGrad.addColorStop(1, '#1b1420');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Distant blurred city window lights
  ctx.save();
  const cityY = height * 0.48;
  const lights = [
    { x: 0.2, y: 0.38, col: '#f59e0b', r: 8 },
    { x: 0.35, y: 0.42, col: '#ec4899', r: 12 },
    { x: 0.65, y: 0.35, col: '#3b82f6', r: 10 },
    { x: 0.8, y: 0.44, col: '#10b981', r: 7 },
    { x: 0.5, y: 0.39, col: '#eab308', r: 9 }
  ];
  lights.forEach(l => {
    const lx = l.x * width;
    const ly = l.y * height;
    ctx.beginPath();
    ctx.arc(lx, ly, l.r + Math.sin(time * 2 + lx) * 2, 0, Math.PI * 2);
    ctx.fillStyle = l.col;
    ctx.filter = 'blur(10px)';
    ctx.fill();
  });
  ctx.filter = 'none';
  ctx.restore();

  // Rain streaks on the window
  ctx.save();
  ctx.strokeStyle = 'rgba(190, 215, 255, 0.4)';
  ctx.lineWidth = 1.5;
  rainDrops.forEach(drop => {
    drop.y += drop.speed;
    if (drop.y > 1) {
      drop.y = 0;
      drop.x = Math.random();
    }
    const dx = drop.x * width;
    const dy = drop.y * height;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx - 3, dy + drop.len);
    ctx.stroke();
  });
  ctx.restore();

  // Wooden desk sill
  const deskY = height * 0.62;
  const deskGrad = ctx.createLinearGradient(0, deskY, 0, height);
  deskGrad.addColorStop(0, '#2d1b16');
  deskGrad.addColorStop(0.3, '#1c100d');
  deskGrad.addColorStop(1, '#0f0806');
  ctx.fillStyle = deskGrad;
  ctx.fillRect(0, deskY, width, height - deskY);

  // Warm amber desk lamp glow
  const lampGlow = ctx.createRadialGradient(width * 0.75, deskY - 30, 10, width * 0.75, deskY + 60, 240);
  lampGlow.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
  lampGlow.addColorStop(0.5, 'rgba(245, 158, 11, 0.1)');
  lampGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = lampGlow;
  ctx.fillRect(0, deskY - 120, width, height - deskY + 120);

  // Ceramic Coffee Mug
  const mugX = width * 0.38;
  const mugY = deskY + 25;
  const mugW = 74;
  const mugH = 82;

  // Mug shadow
  ctx.beginPath();
  ctx.ellipse(mugX + mugW / 2, mugY + mugH - 2, mugW * 0.6, 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fill();

  // Mug Body
  ctx.save();
  const mugGrad = ctx.createLinearGradient(mugX, 0, mugX + mugW, 0);
  mugGrad.addColorStop(0, '#f1f5f9');
  mugGrad.addColorStop(0.35, '#e2e8f0');
  mugGrad.addColorStop(0.7, '#cbd5e1');
  mugGrad.addColorStop(1, '#94a3b8');
  ctx.fillStyle = mugGrad;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(mugX, mugY, mugW, mugH, [4, 4, 16, 16]) : ctx.rect(mugX, mugY, mugW, mugH);
  ctx.fill();

  // Mug Handle
  ctx.beginPath();
  ctx.arc(mugX + mugW + 8, mugY + mugH * 0.45, 20, -Math.PI * 0.4, Math.PI * 0.4);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 10;
  ctx.stroke();

  // Dark Rich Coffee Liquid inside rim
  ctx.beginPath();
  ctx.ellipse(mugX + mugW / 2, mugY + 4, mugW * 0.46, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#3c2415';
  ctx.fill();
  ctx.strokeStyle = '#5a3822';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Floating coffee foam heart
  ctx.fillStyle = '#ecd2b9';
  ctx.beginPath();
  ctx.arc(mugX + mugW / 2, mugY + 4, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Rising animated curly steam particles
  ctx.save();
  coffeeSteamParticles.forEach((sp, idx) => {
    sp.y -= sp.speed;
    if (sp.y < 0) {
      sp.y = 130 + Math.random() * 20;
      sp.x = (Math.random() - 0.5) * 30;
      sp.alpha = 0.4;
    }
    const waveX = Math.sin(time * 2 + idx + sp.y * 0.05) * 16;
    const sx = mugX + mugW / 2 + sp.x + waveX;
    const sy = mugY - sp.y;

    const currentAlpha = Math.max(0, sp.alpha * (1 - sp.y / 150));
    ctx.beginPath();
    ctx.arc(sx, sy, sp.radius * (1 + sp.y / 80), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha * 0.35})`;
    ctx.fill();
  });
  ctx.restore();
}

/**
 * Visual Renderer 3: Hypnotic Fluid Wave & Physics Particles
 */
function renderFluidWave(ctx, width, height, time) {
  // Gradient backdrop
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#090a14');
  bgGrad.addColorStop(0.5, '#120f26');
  bgGrad.addColorStop(1, '#040b17');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  // Flowing organic fluid sine waves
  const waveLayers = [
    { freq: 0.008, speed: 1.8, amp: 55, yRatio: 0.42, color: 'rgba(37, 244, 238, 0.3)' },
    { freq: 0.012, speed: -1.4, amp: 45, yRatio: 0.48, color: 'rgba(254, 44, 85, 0.25)' },
    { freq: 0.006, speed: 2.2, amp: 65, yRatio: 0.55, color: 'rgba(168, 85, 247, 0.3)' },
    { freq: 0.015, speed: -2.0, amp: 40, yRatio: 0.62, color: 'rgba(56, 189, 248, 0.28)' }
  ];

  waveLayers.forEach(wave => {
    ctx.beginPath();
    const baseY = height * wave.yRatio;
    ctx.moveTo(0, baseY);

    for (let x = 0; x <= width; x += 6) {
      const y = baseY + Math.sin(x * wave.freq + time * wave.speed) * wave.amp +
                       Math.cos(x * wave.freq * 0.5 - time) * (wave.amp * 0.4);
      ctx.lineTo(x, y);
    }

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = wave.color;
    ctx.fill();
  });

  // Morphing liquid metaball / central orb
  const orbX = width / 2;
  const orbY = height * 0.45;
  const baseR = 75;

  ctx.beginPath();
  const points = 16;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const distortion = Math.sin(angle * 4 + time * 3) * 12 + Math.cos(angle * 2 - time * 2) * 8;
    const r = baseR + distortion;
    const px = orbX + Math.cos(angle) * r;
    const py = orbY + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const orbGrad = ctx.createRadialGradient(orbX - 20, orbY - 20, 10, orbX, orbY, baseR + 15);
  orbGrad.addColorStop(0, '#25f4ee');
  orbGrad.addColorStop(0.4, '#a855f7');
  orbGrad.addColorStop(0.8, '#fe2c55');
  orbGrad.addColorStop(1, 'rgba(254, 44, 85, 0.2)');
  ctx.fillStyle = orbGrad;
  ctx.shadowBlur = 30;
  ctx.shadowColor = '#25f4ee';
  ctx.fill();

  // Floating iridescent bokeh bubbles
  fluidNodes.forEach(node => {
    node.x += node.vx;
    node.y += node.vy;
    if (node.x < 0 || node.x > 1) node.vx *= -1;
    if (node.y < 0 || node.y > 1) node.vy *= -1;

    const nx = node.x * width;
    const ny = node.y * height;
    ctx.beginPath();
    ctx.arc(nx, ny, 12 + Math.sin(time + node.hue) * 4, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${node.hue + time * 20}, 85%, 65%, 0.4)`;
    ctx.shadowBlur = 12;
    ctx.shadowColor = `hsla(${node.hue}, 85%, 60%, 0.8)`;
    ctx.fill();
  });
  ctx.restore();
}

/**
 * Visual Renderer 4: Matrix Terminal Code Stream
 */
function renderMatrixCode(ctx, width, height, time) {
  // Dark terminal background with slight green glow
  ctx.fillStyle = '#020b05';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.font = '14px monospace';
  const fontSize = 16;
  const colWidth = width / matrixColumns.length;

  matrixColumns.forEach((col, idx) => {
    col.y += col.speed;
    const cx = idx * colWidth + 4;

    // Reset when stream passes bottom
    if (col.y * fontSize > height + 200) {
      col.y = -Math.random() * 8;
      col.speed = 1.2 + Math.random() * 2.4;
    }

    // Occasional random character mutation
    if (Math.random() < 0.08) {
      const randIdx = Math.floor(Math.random() * col.chars.length);
      col.chars[randIdx] = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
    }

    col.chars.forEach((ch, charIdx) => {
      const cy = (col.y + charIdx) * fontSize;
      if (cy < 0 || cy > height) return;

      // Head character is glowing white/bright green
      if (charIdx === col.chars.length - 1) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 14;
        ctx.shadowColor = '#00ff66';
      } else {
        const fade = (charIdx / col.chars.length);
        ctx.fillStyle = `rgba(0, 255, 85, ${fade * 0.85 + 0.15})`;
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#00ff55';
      }
      ctx.fillText(ch, cx, cy);
    });
  });

  // Terminal Status HUD overlay
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0, 255, 120, 0.85)';
  ctx.font = '11px monospace';
  ctx.fillText('ROOT@SYSTEM_OVERRIDE:~# RUN ./toktok_stream.sh', 16, height * 0.18);
  ctx.fillText(`STATUS: CONNECTED // BYTES: ${(Math.floor(time * 1284) % 999999).toString(16).toUpperCase()}`, 16, height * 0.205);
  ctx.fillText(`ZERO_DEPENDENCY_ENGINE: ACTIVE [60 FPS]`, 16, height * 0.23);

  // Scanline overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (let y = 0; y < height; y += 3) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();
}

/**
 * Visual Renderer 5: Retro Synthwave 3D Highway
 */
function renderSunsetDrive(ctx, width, height, time) {
  // Synthwave gradient sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.58);
  skyGrad.addColorStop(0, '#090117');
  skyGrad.addColorStop(0.5, '#2e0854');
  skyGrad.addColorStop(0.85, '#9d174d');
  skyGrad.addColorStop(1, '#f43f5e');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height * 0.58);

  ctx.save();
  // Twinkling stars
  for (let i = 0; i < 35; i++) {
    const sx = ((i * 47) % width);
    const sy = ((i * 31) % (height * 0.45));
    const starBlink = Math.sin(time * 3 + i) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(255, 255, 255, ${starBlink * 0.8})`;
    ctx.fillRect(sx, sy, 1.8, 1.8);
  }

  // Giant Striped Retro Synthwave Sun
  const sunX = width / 2;
  const sunY = height * 0.44;
  const sunR = 85;

  const sunGrad = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
  sunGrad.addColorStop(0, '#fef08a');
  sunGrad.addColorStop(0.5, '#f59e0b');
  sunGrad.addColorStop(1, '#ef4444');

  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fillStyle = sunGrad;
  ctx.shadowBlur = 40;
  ctx.shadowColor = '#f43f5e';
  ctx.fill();

  // Horizontal blind cutouts across the sun
  ctx.shadowBlur = 0;
  const stripeCount = 7;
  for (let s = 0; s < stripeCount; s++) {
    const stY = sunY + (s / stripeCount) * (sunR * 0.95);
    const stH = 3 + s * 1.4;
    ctx.fillStyle = '#1e0533';
    ctx.fillRect(sunX - sunR - 10, stY, (sunR + 10) * 2, stH);
  }

  // Distant neon wireframe mountains
  const horizonY = height * 0.58;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(width * 0.2, horizonY - 45);
  ctx.lineTo(width * 0.35, horizonY - 20);
  ctx.lineTo(width * 0.5, horizonY - 60);
  ctx.lineTo(width * 0.65, horizonY - 15);
  ctx.lineTo(width * 0.85, horizonY - 50);
  ctx.lineTo(width, horizonY);
  ctx.closePath();
  ctx.fillStyle = '#160426';
  ctx.fill();
  ctx.strokeStyle = '#25f4ee';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 3D Perspective Road & Grid Floor
  const floorGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  floorGrad.addColorStop(0, '#0f051d');
  floorGrad.addColorStop(1, '#05010a');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  // Perspective moving horizontal road lines
  const gridSpeed = (time * 1.5) % 1;
  const numGridLines = 14;
  ctx.strokeStyle = '#fe2c55';
  ctx.lineWidth = 1.5;

  for (let g = 0; g < numGridLines; g++) {
    const p = Math.pow((g + gridSpeed) / numGridLines, 2.4);
    const lineY = horizonY + p * (height - horizonY);
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(width, lineY);
    ctx.stroke();
  }

  // Perspective vanishing lines toward center
  const vpX = width / 2;
  const vpY = horizonY;
  const numVPLines = 12;
  ctx.strokeStyle = '#25f4ee';
  ctx.lineWidth = 1.5;

  for (let v = 0; v <= numVPLines; v++) {
    const bottomX = (v / numVPLines) * width;
    ctx.beginPath();
    ctx.moveTo(vpX, vpY);
    ctx.lineTo(bottomX, height);
    ctx.stroke();
  }

  // Central highway neon dashed line
  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(vpX, vpY);
  ctx.lineTo(vpX, height);
  ctx.stroke();
  ctx.restore();
}

/**
 * Main dispatcher to render a given visual type on canvas
 */
function renderCanvasScene(visualType, ctx, width, height, time, audioEnergy = 0.5) {
  switch (visualType) {
    case 'cyber-neon':
      renderCyberNeon(ctx, width, height, time, audioEnergy);
      break;
    case 'lofi-coffee':
      renderLofiCoffee(ctx, width, height, time);
      break;
    case 'fluid-wave':
      renderFluidWave(ctx, width, height, time);
      break;
    case 'matrix-code':
      renderMatrixCode(ctx, width, height, time);
      break;
    case 'sunset-drive':
      renderSunsetDrive(ctx, width, height, time);
      break;
    default:
      renderCyberNeon(ctx, width, height, time, audioEnergy);
      break;
  }
}

/* Expose the public API on the shared namespace (works in browser + Node tests). */
globalThis.TokTok = Object.assign(globalThis.TokTok || {}, {
  renderCanvasScene,
  VISUAL_TYPES: ['cyber-neon', 'lofi-coffee', 'fluid-wave', 'matrix-code', 'sunset-drive']
});
