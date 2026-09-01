/**
 * Attract mode.
 *
 * Every card in the hub runs a tiny live animation of its game — a snake
 * winding through an isometric grid, a tetromino landing, invaders marching.
 * They are drawn procedurally from a single clock, so the whole wall of them
 * costs one requestAnimationFrame and no assets.
 *
 * Previews pause the moment they scroll out of view.
 */

const registry = new Set();
let rafId = 0;
let observer = null;

const DPR = Math.min(2, window.devicePixelRatio || 1);

function startDriver() {
  if (rafId) return;
  const tick = (now) => {
    rafId = requestAnimationFrame(tick);
    const t = now / 1000;
    for (const entry of registry) {
      if (!entry.visible) continue;
      const { ctx, canvas, draw, accent, accent2 } = entry;
      const w = canvas.width / DPR;
      const h = canvas.height / DPR;
      ctx.save();
      ctx.scale(DPR, DPR);
      ctx.clearRect(0, 0, w, h);
      try {
        draw(ctx, w, h, t + entry.offset, accent, accent2);
      } catch {
        /* one bad preview must not take down the wall */
      }
      ctx.restore();
    }
  };
  rafId = requestAnimationFrame(tick);
}

function ensureObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const entry = [...registry].find((r) => r.canvas === e.target);
        if (entry) entry.visible = e.isIntersecting;
      }
    },
    { rootMargin: '120px' },
  );
  return observer;
}

function resize(entry) {
  const { canvas } = entry;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * DPR || canvas.height !== h * DPR) {
    canvas.width = w * DPR;
    canvas.height = h * DPR;
  }
}

/**
 * Attach a live preview to a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {string} gameId
 * @param {{accent: string, accent2: string}} colors
 */
export function attachPreview(canvas, gameId, colors) {
  const draw = PREVIEWS[gameId] ?? PREVIEWS.default;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const entry = {
    canvas,
    ctx,
    draw,
    visible: false,
    accent: colors.accent,
    accent2: colors.accent2,
    // Stagger so the wall of cards does not pulse in unison.
    offset: Math.random() * 20,
  };

  registry.add(entry);
  ensureObserver().observe(canvas);
  startDriver();

  const ro = new ResizeObserver(() => resize(entry));
  ro.observe(canvas);
  resize(entry);

  return () => {
    registry.delete(entry);
    observer?.unobserve(canvas);
    ro.disconnect();
    if (registry.size === 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}

/** Stop everything — used when leaving the hub. */
export function stopPreviews() {
  for (const entry of registry) observer?.unobserve(entry.canvas);
  registry.clear();
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/* ================================================================ utils == */

const fade = (ctx, w, h, color, alpha = 0.06) => {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
};

/** Canvas has no color-mix(), so blend by hand. `amount` is how much of `a`. */
function mixHex(a, b, amount) {
  const parse = (hex) => {
    const v = hex.replace('#', '');
    const n = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const k = Math.max(0, Math.min(1, amount));
  const ch = (x, y) => Math.round(x * k + y * (1 - k));
  return `rgb(${ch(r1, r2)}, ${ch(g1, g2)}, ${ch(b1, b2)})`;
}

function glow(ctx, color, blur, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  fn();
  ctx.restore();
}

/* ============================================================ previews == */

const PREVIEWS = {
  /* --- Snake 3D: an isometric grid with a snake winding across it --- */
  snake3d(ctx, w, h, t, accent, accent2) {
    const cols = 9;
    const rows = 9;
    const cell = Math.min(w / (cols + 4), h / (rows + 2)) * 1.15;
    const originX = w / 2;
    const originY = h * 0.32;

    // Isometric projection of grid coordinates.
    const iso = (gx, gy, gz = 0) => ({
      x: originX + (gx - gy) * cell * 0.62,
      y: originY + (gx + gy) * cell * 0.3 - gz * cell * 0.5,
    });

    // Floor.
    ctx.lineWidth = 1;
    for (let i = 0; i <= cols; i++) {
      const a = iso(i - cols / 2, -rows / 2);
      const b = iso(i - cols / 2, rows / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const c = iso(-cols / 2, i - rows / 2);
      const d = iso(cols / 2, i - rows / 2);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }

    // A snake that walks a fixed loop around the arena.
    const path = [];
    const R = 3;
    for (let i = 0; i < 4 * 2 * R; i++) {
      const side = Math.floor(i / (2 * R));
      const k = (i % (2 * R)) - R;
      if (side === 0) path.push([k, -R]);
      else if (side === 1) path.push([R, k]);
      else if (side === 2) path.push([-k, R]);
      else path.push([-R, -k]);
    }

    const speed = 4.2;
    const head = Math.floor(t * speed) % path.length;
    const len = 9;

    for (let i = len - 1; i >= 0; i--) {
      const idx = (head - i + path.length * 2) % path.length;
      const [gx, gy] = path[idx];
      const p = iso(gx, gy, 0.5);
      const s = cell * 0.42;
      const shade = i === 0 ? accent : accent2;
      ctx.globalAlpha = 1 - (i / len) * 0.55;
      glow(ctx, shade, i === 0 ? 14 : 6, () => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 0.5);
        ctx.lineTo(p.x + s * 0.78, p.y);
        ctx.lineTo(p.x, p.y + s * 0.5);
        ctx.lineTo(p.x - s * 0.78, p.y);
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    // Pellet, bobbing.
    const pel = iso(0, 0, 0.6 + Math.sin(t * 3) * 0.18);
    glow(ctx, '#ffd23f', 16, () => {
      ctx.beginPath();
      ctx.arc(pel.x, pel.y, cell * 0.2, 0, Math.PI * 2);
      ctx.fill();
    });
  },

  /* --- Chomp: the chase, in profile --- */
  chomp(ctx, w, h, t, accent, accent2) {
    const y = h * 0.55;
    const r = Math.min(w, h) * 0.11;
    const loop = 3.4;
    const phase = (t % loop) / loop;
    const x = -r * 2 + phase * (w + r * 4);

    // Pellet trail — dots vanish as he passes.
    for (let i = 0; i < 9; i++) {
      const px = (w / 9) * (i + 0.5);
      if (px < x - r * 0.4) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(px, y, i % 4 === 0 ? 4 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // The mouth opens and closes twice per grid step.
    const mouth = Math.abs(Math.sin(t * 9)) * 0.32 + 0.04;
    glow(ctx, accent, 18, () => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, mouth * Math.PI, (2 - mouth) * Math.PI);
      ctx.closePath();
      ctx.fill();
    });

    // A ghost, always a little behind.
    const gx = x - r * 3.4;
    const gr = r * 0.92;
    ctx.save();
    ctx.shadowColor = accent2;
    ctx.shadowBlur = 14;
    ctx.fillStyle = accent2;
    ctx.beginPath();
    ctx.arc(gx, y - gr * 0.18, gr, Math.PI, 0);
    ctx.lineTo(gx + gr, y + gr * 0.7);
    for (let i = 0; i < 4; i++) {
      const seg = gr / 2;
      ctx.lineTo(gx + gr - seg * (i + 0.5), y + gr * (i % 2 ? 0.7 : 0.42));
    }
    ctx.lineTo(gx - gr, y + gr * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Eyes, looking the way he is going.
    ctx.fillStyle = '#fff';
    for (const dx of [-gr * 0.36, gr * 0.36]) {
      ctx.beginPath();
      ctx.ellipse(gx + dx, y - gr * 0.24, gr * 0.24, gr * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0b0e15';
    for (const dx of [-gr * 0.3, gr * 0.42]) {
      ctx.beginPath();
      ctx.arc(gx + dx, y - gr * 0.2, gr * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /* --- Blockfall: a piece landing on a stack --- */
  blockfall(ctx, w, h, t, accent, accent2) {
    const cols = 10;
    const rows = 14;
    const cell = Math.min(w / cols, h / rows);
    const ox = (w - cell * cols) / 2;
    const oy = (h - cell * rows) / 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, cell * cols, cell * rows);

    // A stable, slightly ragged stack.
    const heights = [3, 4, 2, 5, 3, 4, 2, 3, 5, 1];
    for (let c = 0; c < cols; c++) {
      for (let i = 0; i < heights[c]; i++) {
        const x = ox + c * cell;
        const y = oy + (rows - 1 - i) * cell;
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    }

    // A T-piece dropping in on a loop.
    const loop = 2.6;
    const phase = (t % loop) / loop;
    const dropRow = Math.floor(phase * (rows - 6));
    const shape = [[0, 0], [1, 0], [2, 0], [1, 1]];
    const bx = 3;
    for (const [dx, dy] of shape) {
      const x = ox + (bx + dx) * cell;
      const y = oy + (dropRow + dy) * cell;
      glow(ctx, accent, 10, () => ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2));
    }

    // Ghost preview at the landing spot.
    ctx.strokeStyle = accent2;
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 1;
    for (const [dx, dy] of shape) {
      const x = ox + (bx + dx) * cell;
      const y = oy + (rows - 6 + dy) * cell;
      ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
    }
    ctx.globalAlpha = 1;
  },

  /* --- Invaders: the grid marches, a shot rises --- */
  invaders(ctx, w, h, t, accent, accent2) {
    const cols = 7;
    const rows = 3;
    const cw = w / (cols + 3);
    const step = Math.floor(t * 2.2) % 2;
    const sway = Math.sin(t * 0.9) * cw * 1.1;
    const size = cw * 0.5;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = cw * 1.5 + c * cw + sway;
        const y = h * 0.18 + r * cw * 0.78;
        ctx.fillStyle = r === 0 ? accent2 : accent;
        ctx.globalAlpha = 0.9;
        // A blocky two-frame invader.
        const legs = step ? [-1, 1] : [-1.5, 1.5];
        ctx.fillRect(x - size / 2, y - size / 3, size, size * 0.62);
        ctx.fillRect(x - size * 0.34, y - size * 0.62, size * 0.68, size * 0.3);
        for (const s of legs) {
          ctx.fillRect(x + s * size * 0.34 - 1.5, y + size * 0.28, 3, size * 0.3);
        }
        ctx.globalAlpha = 1;
      }
    }

    // Player cannon.
    const px = w / 2 + Math.sin(t * 1.4) * w * 0.24;
    const py = h * 0.88;
    glow(ctx, accent, 12, () => {
      ctx.fillRect(px - cw * 0.4, py, cw * 0.8, cw * 0.22);
      ctx.fillRect(px - cw * 0.08, py - cw * 0.2, cw * 0.16, cw * 0.24);
    });

    // A shot climbing the screen.
    const shotPhase = (t * 1.6) % 1;
    const sy = py - shotPhase * (py - h * 0.16);
    glow(ctx, '#ffffff', 10, () => ctx.fillRect(px - 1.5, sy, 3, cw * 0.3));
  },

  /* --- Bricks: paddle tracking a bouncing ball --- */
  bricks(ctx, w, h, t, accent, accent2) {
    const rows = 4;
    const cols = 8;
    const bw = w / cols;
    const bh = h * 0.055;
    const top = h * 0.12;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // A few gaps, so it reads as a game in progress.
        if ((r * cols + c + Math.floor(t * 0.4)) % 11 === 0) continue;
        const x = c * bw;
        const y = top + r * (bh + 3);
        ctx.fillStyle = [accent, accent2, '#ffd23f', '#39ff88'][r % 4];
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 2, y, bw - 4, bh);
        ctx.globalAlpha = 1;
      }
    }

    // Ball on a triangle-wave path so it always stays on screen.
    const tri = (v) => Math.abs(((v % 2) + 2) % 2 - 1);
    const bx = tri(t * 0.62) * (w - 16) + 8;
    const by = top + rows * (bh + 3) + tri(t * 0.9 + 0.3) * (h * 0.5);
    glow(ctx, '#ffffff', 14, () => {
      ctx.beginPath();
      ctx.arc(bx, by, Math.min(w, h) * 0.022, 0, Math.PI * 2);
      ctx.fill();
    });

    // Paddle, lagging slightly behind the ball.
    const px = tri(t * 0.62 - 0.06) * (w - 16) + 8;
    glow(ctx, accent, 12, () => {
      ctx.fillRect(px - w * 0.09, h * 0.9, w * 0.18, h * 0.028);
    });
  },

  /* --- Vector: a ship adrift among rocks --- */
  vector(ctx, w, h, t, accent, accent2) {
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h);

    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';

    // Three rocks on slow independent orbits.
    const rocks = [
      { r: scale * 0.16, d: scale * 0.3, speed: 0.24, seed: 5, phase: 0 },
      { r: scale * 0.1, d: scale * 0.36, speed: -0.3, seed: 9, phase: 2.1 },
      { r: scale * 0.07, d: scale * 0.24, speed: 0.42, seed: 3, phase: 4.2 },
    ];

    for (const rock of rocks) {
      const a = t * rock.speed + rock.phase;
      const x = cx + Math.cos(a) * rock.d;
      const y = cy + Math.sin(a * 1.3) * rock.d * 0.55;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      const points = 9;
      for (let i = 0; i <= points; i++) {
        const ang = (i / points) * Math.PI * 2;
        // A stable pseudo-random silhouette per rock.
        const wobble = 0.72 + ((Math.sin(i * rock.seed) + 1) / 2) * 0.5;
        const px = x + Math.cos(ang + a * 0.4) * rock.r * wobble;
        const py = y + Math.sin(ang + a * 0.4) * rock.r * wobble;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // The ship, rotating and puffing its thruster.
    const angle = t * 0.7;
    const s = scale * 0.075;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(s * 1.5, 0);
    ctx.lineTo(-s, s * 0.9);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(-s, -s * 0.9);
    ctx.closePath();
    ctx.stroke();

    if (Math.sin(t * 18) > 0) {
      ctx.strokeStyle = accent2;
      ctx.shadowColor = accent2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, s * 0.35);
      ctx.lineTo(-s * 1.7, 0);
      ctx.lineTo(-s * 0.6, -s * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  },

  /* --- Paddles: the original rally --- */
  paddles(ctx, w, h, t, accent, accent2) {
    // Dashed centre line.
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 8);
    ctx.lineTo(w / 2, h - 8);
    ctx.stroke();
    ctx.setLineDash([]);

    const tri = (v) => Math.abs(((v % 2) + 2) % 2 - 1);
    const bx = 14 + tri(t * 0.85) * (w - 28);
    const by = 14 + tri(t * 1.31 + 0.4) * (h - 28);

    const ph = h * 0.24;
    const leftY = 10 + tri(t * 1.31 + 0.36) * (h - 20) - ph / 2;
    const rightY = 10 + tri(t * 1.31 + 0.46) * (h - 20) - ph / 2;

    glow(ctx, accent, 12, () => {
      ctx.fillRect(10, Math.max(4, Math.min(h - ph - 4, leftY)), 6, ph);
    });
    glow(ctx, accent2, 12, () => {
      ctx.fillRect(w - 16, Math.max(4, Math.min(h - ph - 4, rightY)), 6, ph);
    });
    glow(ctx, '#ffffff', 14, () => ctx.fillRect(bx - 4, by - 4, 8, 8));
  },

  /* --- 2048: a board mid-run --- */
  twenty48(ctx, w, h, t, accent, accent2) {
    const n = 4;
    const pad = Math.min(w, h) * 0.06;
    const size = Math.min(w, h) - pad * 2;
    const cell = size / n;
    const ox = (w - size) / 2;
    const oy = (h - size) / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(ox, oy, size, size);

    const board = [
      [2, 4, 8, 16],
      [0, 2, 32, 64],
      [0, 0, 4, 128],
      [0, 0, 2, 256],
    ];

    // The 2 in the corner pulses, as if it just spawned.
    const pop = 0.9 + Math.sin(t * 2.4) * 0.1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r][c];
        const x = ox + c * cell;
        const y = oy + r * cell;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        if (!v) continue;

        const scale = r === 3 && c === 2 ? pop : 1;
        const inset = (cell * (1 - scale)) / 2;
        const tier = Math.log2(v) / 8;
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 6 + tier * 14;
        ctx.fillStyle = mixHex(accent, '#1a1f2b', 0.2 + tier * 0.7);
        ctx.fillRect(x + 2 + inset, y + 2 + inset, cell - 4 - inset * 2, cell - 4 - inset * 2);
        ctx.restore();

        ctx.fillStyle = tier > 0.5 ? '#04060a' : '#e9edf6';
        ctx.font = `700 ${Math.round(cell * (v > 99 ? 0.26 : 0.34))}px ui-monospace, monospace`;
        ctx.fillText(String(v), x + cell / 2, y + cell / 2);
      }
    }
  },

  /* --- Solitaire: a card dealing onto a fanned pile --- */
  solitaire(ctx, w, h, t, accent, accent2) {
    const cw = Math.min(w * 0.17, h * 0.3);
    const ch = cw * 1.4;
    const baseY = h * 0.52;

    const card = (x, y, faceUp, pip, red) => {
      ctx.save();
      ctx.fillStyle = faceUp ? '#f4f7ff' : '#161d33';
      ctx.strokeStyle = faceUp ? 'rgba(0,0,0,0.3)' : accent;
      ctx.lineWidth = 1.4;
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + cw, y, x + cw, y + ch, r);
      ctx.arcTo(x + cw, y + ch, x, y + ch, r);
      ctx.arcTo(x, y + ch, x, y, r);
      ctx.arcTo(x, y, x + cw, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (faceUp && pip) {
        ctx.fillStyle = red ? '#d81f4a' : '#141821';
        ctx.font = `${Math.round(cw * 0.38)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pip, x + cw / 2, y + ch / 2);
      }
      ctx.restore();
    };

    // A small fanned tableau.
    const fanX = w * 0.16;
    card(fanX, baseY - ch * 0.5, false);
    card(fanX, baseY - ch * 0.28, false);
    card(fanX, baseY, true, '♠', false);

    // Foundation on the right, slowly accepting cards.
    card(w * 0.66, baseY - ch * 0.25, true, '♥', true);

    // One card in flight between them, on a loop.
    const loop = 2.8;
    const phase = ((t % loop) / loop) ** 0.85;
    const fx = fanX + (w * 0.66 - fanX) * phase;
    const fy = baseY - Math.sin(phase * Math.PI) * h * 0.3;
    ctx.save();
    ctx.shadowColor = accent2;
    ctx.shadowBlur = 14;
    card(fx, fy, true, '♦', true);
    ctx.restore();
  },

  /* --- Lexicon: a row of tiles flipping to green and amber --- */
  lexicon(ctx, w, h, t, accent, accent2) {
    const cols = 5;
    const size = Math.min(w / (cols + 1.5), h / 3.4);
    const gap = size * 0.14;
    const totalW = cols * size + (cols - 1) * gap;
    const ox = (w - totalW) / 2;

    const rows = [
      { letters: 'CRANE', marks: [0, 1, 0, 2, 0] },
      { letters: 'SPEED', marks: [0, 0, 2, 1, 0] },
    ];
    const oy = h / 2 - (size * 2 + gap) / 2;

    rows.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * (size + gap);
        const y = oy + r * (size + gap);

        // Each tile turns over on a staggered loop.
        const phase = ((t * 0.55 + r * 0.5) % 3) - c * 0.12;
        const flip = Math.max(0, Math.min(1, phase));
        const scaleY = flip <= 0 || flip >= 1 ? 1 : Math.abs(Math.cos(flip * Math.PI));
        const th = Math.max(2, size * scaleY);
        const ty = y + (size - th) / 2;

        const mark = flip > 0.5 ? row.marks[c] : 0;
        ctx.fillStyle = mark === 2 ? '#4ade80' : mark === 1 ? '#facc15' : '#161b26';
        ctx.fillRect(x, ty, size, th);
        if (mark === 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.16)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, ty + 0.5, size - 1, th - 1);
        }
        if (scaleY > 0.35) {
          ctx.fillStyle = mark ? '#0b0e15' : '#cbd5e6';
          ctx.font = `700 ${Math.round(size * 0.5)}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(row.letters[c], x + size / 2, y + size / 2);
        }
      }
    });
  },

  /* --- Word Search: a letter grid with a word lighting up --- */
  wordsearch(ctx, w, h, t, accent, accent2) {
    const n = 7;
    const cell = Math.min(w, h) / (n + 1);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;
    const letters = 'ARCADENEONPIXELTOKENMAZEGHOST';

    // The highlighted run sweeps around on a loop.
    const runs = [
      { r: 1, c: 1, dr: 0, dc: 1, len: 5 },
      { r: 0, c: 5, dr: 1, dc: 0, len: 5 },
      { r: 5, c: 1, dr: -1, dc: 1, len: 5 },
    ];
    const run = runs[Math.floor(t / 2.6) % runs.length];
    const reveal = Math.min(1, ((t % 2.6) / 2.6) * 2.2);

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = cell * 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const sx = ox + (run.c + 0.5) * cell;
    const sy = oy + (run.r + 0.5) * cell;
    ctx.moveTo(sx, sy);
    ctx.lineTo(
      sx + run.dc * cell * (run.len - 1) * reveal,
      sy + run.dr * cell * (run.len - 1) * reveal,
    );
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#cbd5e6';
    ctx.font = `600 ${Math.round(cell * 0.52)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        ctx.fillText(
          letters[(r * n + c) % letters.length],
          ox + (c + 0.5) * cell,
          oy + (r + 0.5) * cell,
        );
      }
    }
  },

  /* --- Bingo: a card with numbers daubing themselves --- */
  bingo(ctx, w, h, t, accent, accent2) {
    const n = 5;
    const cell = Math.min(w / (n + 2), h / (n + 2));
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2 + cell * 0.3;
    const cols = ['#fb7185', '#fbbf24', '#4ade80', '#38bdf8', '#c084fc'];

    'BINGO'.split('').forEach((letter, i) => {
      ctx.fillStyle = cols[i];
      ctx.font = `700 ${Math.round(cell * 0.52)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, ox + (i + 0.5) * cell, oy - cell * 0.45);
    });

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = ox + c * cell;
        const y = oy + r * cell;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);

        // Daubs arrive one at a time, then the card resets.
        const index = (r * n + c) * 7 % 25;
        const daubed = (t * 2.2) % 30 > index;
        if (daubed) {
          ctx.save();
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = cols[c];
          ctx.shadowColor = cols[c];
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.34, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = '#8b93a7';
          ctx.font = `${Math.round(cell * 0.34)}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(c * 15 + r + 1), x + cell / 2, y + cell / 2);
        }
      }
    }
  },

  /* --- Minefield: a board opening up around the numbers --- */
  minefield(ctx, w, h, t, accent, accent2) {
    const n = 8;
    const cell = Math.min(w, h) / (n + 1);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;
    const numberColors = ['', '#38bdf8', '#4ade80', '#fb7185', '#c084fc'];

    // A wave of squares opening outward from the middle.
    const wave = (t % 4) * 3.2;

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = ox + c * cell;
        const y = oy + r * cell;
        const dist = Math.hypot(r - n / 2 + 0.5, c - n / 2 + 0.5);
        const open = dist < wave;

        if (open) {
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
          const near = (r * 3 + c * 5) % 5;
          if (near > 0) {
            ctx.fillStyle = numberColors[near];
            ctx.font = `700 ${Math.round(cell * 0.46)}px ui-monospace, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(near), x + cell / 2, y + cell / 2);
          }
        } else {
          ctx.fillStyle = '#1b2230';
          ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(x + 3, y + 3, cell - 6, 1.5);
          // The odd flag.
          if ((r * 7 + c * 3) % 11 === 0) {
            ctx.save();
            ctx.fillStyle = accent;
            ctx.shadowColor = accent;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(x + cell * 0.36, y + cell * 0.24);
            ctx.lineTo(x + cell * 0.7, y + cell * 0.38);
            ctx.lineTo(x + cell * 0.36, y + cell * 0.52);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
  },

  /* --- Memory: cards flipping over to reveal shapes --- */
  memory(ctx, w, h, t, accent, accent2) {
    const cols = 4;
    const rows = 3;
    const cw = Math.min(w / (cols + 1), h / (rows + 0.8));
    const ch = cw * 1.14;
    const gap = cw * 0.14;
    const ox = (w - (cols * cw + (cols - 1) * gap)) / 2;
    const oy = (h - (rows * ch + (rows - 1) * gap)) / 2;
    const colors = ['#38bdf8', '#f472b6', '#4ade80', '#fbbf24', '#c084fc', '#fb7185'];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = ox + c * (cw + gap);
        const y = oy + r * (ch + gap);

        // Pairs turn over together, on their own staggered cycle.
        const pair = i % 6;
        const phase = (t * 0.6 + pair * 0.9) % 5;
        const faceUp = phase > 1 && phase < 2.6;
        const flip = faceUp ? 1 : 0;
        const scaleX = Math.abs(Math.cos(flip * Math.PI));
        const dw = cw * (scaleX === 1 ? 1 : Math.max(0.1, scaleX));

        ctx.save();
        if (faceUp) {
          ctx.fillStyle = '#141a26';
          ctx.strokeStyle = colors[pair];
          ctx.shadowColor = colors[pair];
          ctx.shadowBlur = 10;
        } else {
          ctx.fillStyle = '#101726';
          ctx.strokeStyle = 'rgba(56,189,248,0.3)';
        }
        ctx.lineWidth = 1.5;
        ctx.fillRect(x + (cw - dw) / 2, y, dw, ch);
        ctx.strokeRect(x + (cw - dw) / 2 + 0.75, y + 0.75, dw - 1.5, ch - 1.5);

        if (faceUp) {
          ctx.fillStyle = colors[pair];
          const cx = x + cw / 2;
          const cy = y + ch / 2;
          const rad = cw * 0.24;
          ctx.beginPath();
          if (pair % 3 === 0) ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          else if (pair % 3 === 1) ctx.rect(cx - rad, cy - rad, rad * 2, rad * 2);
          else {
            ctx.moveTo(cx, cy - rad);
            ctx.lineTo(cx + rad, cy + rad);
            ctx.lineTo(cx - rad, cy + rad);
            ctx.closePath();
          }
          ctx.fill();
        }
        ctx.restore();
      }
    }
  },

  /* --- Simon: the four pads lighting in sequence --- */
  simon(ctx, w, h, t) {
    const cx = w / 2;
    const cy = h / 2;
    const outer = Math.min(w, h) * 0.42;
    const inner = outer * 0.36;

    const pads = [
      { color: '#22c55e', lit: '#86efac', start: Math.PI, end: Math.PI * 1.5 },
      { color: '#ef4444', lit: '#fca5a5', start: Math.PI * 1.5, end: Math.PI * 2 },
      { color: '#eab308', lit: '#fde047', start: Math.PI * 0.5, end: Math.PI },
      { color: '#3b82f6', lit: '#93c5fd', start: 0, end: Math.PI * 0.5 },
    ];

    const order = [0, 3, 1, 2, 0, 1, 3];
    const active = order[Math.floor(t * 1.8) % order.length];

    pads.forEach((pad, i) => {
      const lit = i === active;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, outer, pad.start + 0.04, pad.end - 0.04);
      ctx.arc(cx, cy, inner, pad.end - 0.04, pad.start + 0.04, true);
      ctx.closePath();
      if (lit) {
        ctx.fillStyle = pad.lit;
        ctx.shadowColor = pad.color;
        ctx.shadowBlur = 26;
      } else {
        ctx.fillStyle = pad.color;
        ctx.globalAlpha = 0.36;
      }
      ctx.fill();
      ctx.restore();
    });

    ctx.fillStyle = '#0b1018';
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 3, 0, Math.PI * 2);
    ctx.fill();
  },

  /* --- Tic Tac Toe: a game playing itself out --- */
  tictactoe(ctx, w, h, t, accent, accent2) {
    const size = Math.min(w, h) * 0.72;
    const cell = size / 3;
    const ox = (w - size) / 2;
    const oy = (h - size) / 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(ox + i * cell, oy + 6);
      ctx.lineTo(ox + i * cell, oy + size - 6);
      ctx.moveTo(ox + 6, oy + i * cell);
      ctx.lineTo(ox + size - 6, oy + i * cell);
    }
    ctx.stroke();

    // A fixed game, revealed one move at a time then reset.
    const script = [
      [4, 1], [0, 2], [8, 1], [2, 2], [6, 1], [7, 2], [3, 1],
    ];
    const shown = Math.floor((t % 6) * 1.6);

    script.slice(0, Math.min(shown, script.length)).forEach(([index, player]) => {
      const cx = ox + (index % 3) * cell + cell / 2;
      const cy = oy + Math.floor(index / 3) * cell + cell / 2;
      const r = cell * 0.26;
      ctx.save();
      ctx.strokeStyle = player === 1 ? accent : accent2;
      ctx.shadowColor = player === 1 ? accent : accent2;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 4;
      ctx.beginPath();
      if (player === 1) {
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
    });

    // The winning diagonal, once it is there.
    if (shown >= script.length) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = accent;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ox + cell * 0.5, oy + cell * 2.5);
      ctx.lineTo(ox + cell * 2.5, oy + cell * 0.5);
      ctx.stroke();
      ctx.restore();
    }
  },

  /* --- Connect Four: discs dropping into the slab --- */
  connectfour(ctx, w, h, t, accent, accent2) {
    const cols = 7;
    const rows = 6;
    const cell = Math.min(w / (cols + 1), h / (rows + 1));
    const bw = cols * cell;
    const bh = rows * cell;
    const ox = (w - bw) / 2;
    const oy = (h - bh) / 2;
    const r = cell * 0.38;

    const stack = [2, 3, 1, 4, 2, 1, 0];
    const owner = (c, i) => ((c + i) % 2 === 0 ? accent : accent2);

    // Settled discs.
    for (let c = 0; c < cols; c++) {
      for (let i = 0; i < stack[c]; i++) {
        const x = ox + c * cell + cell / 2;
        const y = oy + bh - (i + 0.5) * cell;
        ctx.save();
        ctx.fillStyle = owner(c, i);
        ctx.shadowColor = owner(c, i);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // One falling.
    const loop = 2.4;
    const phase = (t % loop) / loop;
    const col = Math.floor(t / loop) % cols;
    const fx = ox + col * cell + cell / 2;
    const fy = oy - cell * 0.5 + phase * phase * (bh - stack[col] * cell + cell * 0.5);
    ctx.save();
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The slab, punched through so the discs sit inside it.
    ctx.save();
    ctx.fillStyle = '#141c3a';
    ctx.beginPath();
    ctx.rect(ox - 5, oy - 5, bw + 10, bh + 10);
    for (let c = 0; c < cols; c++) {
      for (let rr = 0; rr < rows; rr++) {
        const x = ox + c * cell + cell / 2;
        const y = oy + rr * cell + cell / 2;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2, true);
      }
    }
    ctx.fill('evenodd');
    ctx.restore();
  },

  /* --- Reversi: a corner of the board flipping --- */
  reversi(ctx, w, h, t, accent, accent2) {
    const n = 6;
    const cell = Math.min(w, h) / (n + 1);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;

    ctx.fillStyle = '#0c2b1e';
    ctx.fillRect(ox, oy, n * cell, n * cell);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      ctx.moveTo(ox + i * cell, oy);
      ctx.lineTo(ox + i * cell, oy + n * cell);
      ctx.moveTo(ox, oy + i * cell);
      ctx.lineTo(ox + n * cell, oy + i * cell);
    }
    ctx.stroke();

    // A run of discs flipping one after another, then flipping back.
    const wave = (t * 1.4) % 8;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const seed = (r * 7 + c * 3) % 5;
        if (seed === 0) continue;
        const isRun = r === 2 && c >= 1 && c <= 4;
        let white = seed % 2 === 0;
        if (isRun && wave > c) white = !white;

        const x = ox + c * cell + cell / 2;
        const y = oy + r * cell + cell / 2;
        const squash = isRun && Math.abs(wave - c) < 0.4 ? Math.abs(wave - c) / 0.4 : 1;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(Math.max(0.08, squash), 1);
        ctx.fillStyle = white ? '#e9edf6' : '#1f2937';
        ctx.shadowColor = white ? accent2 : accent;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.36, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  },

  /* --- Sudoku: a grid filling itself in --- */
  sudoku(ctx, w, h, t, accent) {
    const n = 9;
    const size = Math.min(w, h) * 0.86;
    const cell = size / n;
    const ox = (w - size) / 2;
    const oy = (h - size) / 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      if (i % 3 === 0) continue;
      ctx.moveTo(ox + i * cell, oy);
      ctx.lineTo(ox + i * cell, oy + size);
      ctx.moveTo(ox, oy + i * cell);
      ctx.lineTo(ox + size, oy + i * cell);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56,189,248,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= n; i += 3) {
      ctx.moveTo(ox + i * cell, oy);
      ctx.lineTo(ox + i * cell, oy + size);
      ctx.moveTo(ox, oy + i * cell);
      ctx.lineTo(ox + size, oy + i * cell);
    }
    ctx.stroke();

    // A valid-looking Latin square, revealed cell by cell.
    const filled = Math.floor((t % 8) * 14);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(cell * 0.62)}px ui-monospace, monospace`;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if ((i * 5) % 13 > 6) continue; // sparse, like a real puzzle
        const digit = ((r * 3 + Math.floor(r / 3) + c) % 9) + 1;
        const given = (i * 7) % 11 > 4;
        if (!given && i > filled) continue;
        ctx.fillStyle = given ? 'rgba(233,237,246,0.85)' : accent;
        ctx.fillText(String(digit), ox + c * cell + cell / 2, oy + r * cell + cell / 2);
      }
    }
  },

  /* --- Lights Out: a cross of lights toggling --- */
  lightsout(ctx, w, h, t, accent) {
    const n = 5;
    const cell = Math.min(w, h) / (n + 0.8);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;

    // A press sweeps around the board, toggling a plus shape each time.
    const step = Math.floor(t * 0.9) % 6;
    const centres = [[2, 2], [1, 1], [3, 3], [1, 3], [3, 1], [2, 2]];
    const [pr, pc] = centres[step];

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        let on = (r * 3 + c * 5 + step * 2) % 4 > 1;
        if ((r === pr && Math.abs(c - pc) <= 1) || (c === pc && Math.abs(r - pr) <= 1)) on = !on;

        const x = ox + c * cell;
        const y = oy + r * cell;
        ctx.save();
        if (on) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 16;
        } else {
          ctx.fillStyle = '#161d2b';
        }
        const pad = cell * 0.1;
        ctx.beginPath();
        ctx.roundRect?.(x + pad, y + pad, cell - pad * 2, cell - pad * 2, 6);
        if (!ctx.roundRect) ctx.rect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  },

  /* --- Fifteen: a tile sliding into the gap --- */
  fifteen(ctx, w, h, t, accent, accent2) {
    const n = 4;
    const cell = Math.min(w, h) / (n + 0.6);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(ox - 4, oy - 4, n * cell + 8, n * cell + 8);

    const loop = 1.6;
    const phase = Math.min(1, ((t % loop) / loop) * 2.2);
    const moving = 11; // the tile that slides each cycle
    const gapIndex = 15;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 16; i++) {
      if (i === gapIndex) continue;
      let x = ox + (i % n) * cell;
      let y = oy + Math.floor(i / n) * cell;
      if (i === moving) y += phase * cell; // slides down into the gap

      const home = i < 11;
      ctx.save();
      ctx.fillStyle = home ? '#14351f' : '#1a2333';
      ctx.shadowColor = home ? accent2 : accent;
      ctx.shadowBlur = home ? 8 : 4;
      const pad = cell * 0.06;
      ctx.beginPath();
      ctx.roundRect?.(x + pad, y + pad, cell - pad * 2, cell - pad * 2, 5);
      if (!ctx.roundRect) ctx.rect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = home ? '#86efac' : '#e9edf6';
      ctx.font = `700 ${Math.round(cell * 0.38)}px ui-monospace, monospace`;
      ctx.fillText(String(i + 1), x + cell / 2, y + cell / 2);
    }
  },

  /* --- Hangman: the drawing filling in under a part-solved word --- */
  hangman(ctx, w, h, t, accent, accent2) {
    const scale = Math.min(w / 220, h / 150);
    const gx = w * 0.3;
    const gy = h * 0.18;
    const s = (v) => v * scale;

    ctx.save();
    ctx.strokeStyle = '#3f4a5f';
    ctx.lineWidth = Math.max(2, s(4));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gx - s(40), gy + s(110));
    ctx.lineTo(gx + s(16), gy + s(110));
    ctx.moveTo(gx - s(12), gy + s(110));
    ctx.lineTo(gx - s(12), gy);
    ctx.lineTo(gx + s(34), gy);
    ctx.lineTo(gx + s(34), gy + s(14));
    ctx.stroke();
    ctx.restore();

    const stage = Math.floor(t * 0.8) % 8;
    const head = { x: gx + s(34), y: gy + s(28) };

    ctx.save();
    ctx.strokeStyle = stage >= 6 ? accent2 : '#e9edf6';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 6;
    ctx.lineWidth = Math.max(1.6, s(3));
    ctx.lineCap = 'round';
    if (stage >= 1) { ctx.beginPath(); ctx.arc(head.x, head.y, s(12), 0, Math.PI * 2); ctx.stroke(); }
    if (stage >= 2) { ctx.beginPath(); ctx.moveTo(head.x, head.y + s(12)); ctx.lineTo(head.x, head.y + s(50)); ctx.stroke(); }
    if (stage >= 3) { ctx.beginPath(); ctx.moveTo(head.x, head.y + s(22)); ctx.lineTo(head.x - s(19), head.y + s(38)); ctx.stroke(); }
    if (stage >= 4) { ctx.beginPath(); ctx.moveTo(head.x, head.y + s(22)); ctx.lineTo(head.x + s(19), head.y + s(38)); ctx.stroke(); }
    if (stage >= 5) { ctx.beginPath(); ctx.moveTo(head.x, head.y + s(50)); ctx.lineTo(head.x - s(16), head.y + s(76)); ctx.stroke(); }
    if (stage >= 6) { ctx.beginPath(); ctx.moveTo(head.x, head.y + s(50)); ctx.lineTo(head.x + s(16), head.y + s(76)); ctx.stroke(); }
    ctx.restore();

    // The word, filling in as the figure does.
    const word = 'ARCADE';
    const slot = Math.min(s(20), (w * 0.42) / word.length);
    const startX = w * 0.56;
    const y = h * 0.62;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(slot * 0.82)}px ui-monospace, monospace`;
    [...word].forEach((letter, i) => {
      const x = startX + i * slot;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - slot * 0.36, y + slot * 0.5);
      ctx.lineTo(x + slot * 0.36, y + slot * 0.5);
      ctx.stroke();
      if (i <= stage) {
        ctx.fillStyle = accent;
        ctx.fillText(letter, x, y);
      }
    });
  },

  /* --- Bulwark: a road, two towers, and something walking into range --- */
  bulwark(ctx, w, h, t, accent, accent2) {
    const cell = Math.min(w / 9, h / 6);
    const ox = (w - cell * 9) / 2;
    const oy = (h - cell * 6) / 2;
    const pt = (c, r) => [ox + (c + 0.5) * cell, oy + (r + 0.5) * cell];

    // A short serpentine road.
    const road = [[-0.5, 1], [3, 1], [3, 4], [6, 4], [6, 2], [9, 2]].map(([c, r]) => pt(c, r));

    ctx.save();
    ctx.strokeStyle = '#1e2a22';
    ctx.lineWidth = cell * 0.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    road.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(163,230,53,0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 9]);
    ctx.lineDashOffset = -(t * 26) % 15;
    ctx.beginPath();
    road.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();

    // Walk a marker along the polyline.
    const legs = [];
    let total = 0;
    for (let i = 0; i < road.length - 1; i++) {
      const len = Math.hypot(road[i + 1][0] - road[i][0], road[i + 1][1] - road[i][1]);
      legs.push({ a: road[i], b: road[i + 1], start: total, len });
      total += len;
    }
    const walked = ((t * 0.22) % 1) * total;
    let ex = road[0][0];
    let ey = road[0][1];
    for (const leg of legs) {
      if (walked <= leg.start + leg.len) {
        const k = (walked - leg.start) / leg.len;
        ex = leg.a[0] + (leg.b[0] - leg.a[0]) * k;
        ey = leg.a[1] + (leg.b[1] - leg.a[1]) * k;
        break;
      }
    }

    // Two towers, tracking it.
    const towers = [pt(2, 3), pt(5, 2)];
    for (const [tx, ty] of towers) {
      const angle = Math.atan2(ey - ty, ex - tx);
      ctx.save();
      ctx.fillStyle = '#131c18';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.rect(tx - cell * 0.34, ty - cell * 0.34, cell * 0.68, cell * 0.68);
      ctx.fill();
      ctx.stroke();
      ctx.translate(tx, ty);
      ctx.rotate(angle);
      ctx.fillStyle = accent;
      ctx.fillRect(0, -2, cell * 0.4, 4);
      ctx.restore();
    }

    // The enemy.
    ctx.save();
    ctx.fillStyle = accent2;
    ctx.shadowColor = accent2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ex, ey, cell * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  /* --- Bastion: incoming trails and a blast blooming --- */
  bastion(ctx, w, h, t, accent, accent2) {
    const groundY = h * 0.8;

    ctx.fillStyle = 'rgba(163,230,53,0.5)';
    ctx.fillRect(0, groundY, w, 1.5);

    // Three little skylines.
    for (const f of [0.22, 0.5, 0.78]) {
      const x = w * f;
      ctx.save();
      ctx.fillStyle = '#38bdf8';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 8;
      [6, 11, 8, 13].forEach((hh, i) => ctx.fillRect(x - 12 + i * 7, groundY - hh, 5, hh));
      ctx.restore();
    }

    // Incoming, on a loop.
    const loop = 3;
    const phase = (t % loop) / loop;
    const shots = [
      { sx: w * 0.15, tx: w * 0.4, off: 0 },
      { sx: w * 0.7, tx: w * 0.55, off: 0.35 },
      { sx: w * 0.9, tx: w * 0.78, off: 0.66 },
    ];

    ctx.lineWidth = 1.4;
    for (const shot of shots) {
      const p = (phase + shot.off) % 1;
      const y = p * groundY;
      const x = shot.sx + (shot.tx - shot.sx) * p;
      ctx.strokeStyle = 'rgba(251,113,133,0.45)';
      ctx.beginPath();
      ctx.moveTo(shot.sx, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.save();
      ctx.fillStyle = accent2;
      ctx.shadowColor = accent2;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // A blast opening and closing in the middle of the sky.
    const bp = (t % 1.8) / 1.8;
    const r = Math.sin(bp * Math.PI) * Math.min(w, h) * 0.12;
    if (r > 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#fbbf24';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(w * 0.46, groundY * 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // A battery firing upward.
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, groundY);
    ctx.lineTo(w * 0.46, groundY * 0.5);
    ctx.stroke();
    ctx.restore();
  },

  /* --- Cascade: a column of gems clearing and refilling --- */
  cascade(ctx, w, h, t, accent, accent2) {
    const n = 6;
    const cell = Math.min(w, h) / (n + 0.6);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;
    const colors = ['#fb7185', '#38bdf8', '#a3e635', '#fbbf24', '#c084fc', '#2dd4bf'];

    // Row 3 clears on a loop, and the gems above drop into the gap.
    const loop = 2.6;
    const phase = (t % loop) / loop;
    const clearing = phase < 0.25;
    const drop = phase >= 0.25 && phase < 0.6 ? (phase - 0.25) / 0.35 : phase >= 0.6 ? 1 : 0;

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const matched = r === 3 && c >= 1 && c <= 3;
        if (matched && clearing) continue;

        let y = oy + r * cell;
        if (drop > 0 && r < 3 && c >= 1 && c <= 3) y += drop * cell;

        const kind = (r * 5 + c * 3) % colors.length;
        const color = matched ? colors[2] : colors[kind];
        const cx = ox + c * cell + cell / 2;
        const cy = y + cell / 2;
        const rad = cell * 0.32 * (matched && phase < 0.25 ? 1 + phase * 2 : 1);

        ctx.save();
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.globalAlpha = matched && clearing ? 1 - phase * 4 : 1;
        ctx.beginPath();
        const sides = 3 + (kind % 4);
        if (sides === 3) ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        else {
          for (let i = 0; i < sides; i++) {
            const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
            const px = cx + Math.cos(a) * rad;
            const py = cy + Math.sin(a) * rad;
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.closePath();
        }
        ctx.fill();
        ctx.restore();
      }
    }
  },

  /* --- Blackjack: a hand flipping toward 21, chips stacking below --- */
  blackjack(ctx, w, h, t, accent, accent2) {
    const cw = Math.min(w * 0.2, h * 0.32);
    const ch = cw * 1.4;
    const card = (x, y, faceUp, label, red) => {
      ctx.save();
      ctx.fillStyle = faceUp ? '#f4f7ff' : '#161d33';
      ctx.strokeStyle = faceUp ? 'rgba(0,0,0,0.3)' : accent;
      ctx.lineWidth = 1.4;
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + cw, y, x + cw, y + ch, r);
      ctx.arcTo(x + cw, y + ch, x, y + ch, r);
      ctx.arcTo(x, y + ch, x, y, r);
      ctx.arcTo(x, y, x + cw, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (faceUp && label) {
        ctx.fillStyle = red ? '#d81f4a' : '#141821';
        ctx.font = `700 ${Math.round(cw * 0.34)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + cw / 2, y + ch / 2);
      }
      ctx.restore();
    };
    const cy = h * 0.38;
    card(w / 2 - cw * 1.05, cy, true, 'A', false);
    const flip = ((t * 0.7) % 3) < 1;
    card(w / 2 + cw * 0.05, cy, flip, flip ? 'K' : '', true);

    // Chips stacking underneath.
    const chipY = h * 0.8;
    const bounce = Math.abs(Math.sin(t * 1.6)) * 4;
    for (let i = 0; i < 4; i++) {
      glow(ctx, i % 2 ? accent : accent2, 6, () => {
        ctx.beginPath();
        ctx.arc(w / 2, chipY - i * 6 - (i === 3 ? bounce : 0), cw * 0.32, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  },

  /* --- Gin Rummy: a hand of cards sorting itself into melds --- */
  ginrummy(ctx, w, h, t, accent, accent2) {
    const cw = Math.min(w * 0.13, h * 0.22);
    const ch = cw * 1.35;
    const n = 6;
    const spread = w * 0.62;
    const x0 = (w - spread) / 2;
    const sorted = ((t * 0.5) % 4) > 2;
    const y = h * 0.48;
    for (let i = 0; i < n; i++) {
      const groupGap = sorted && i >= 3 ? cw * 0.35 : 0;
      const x = x0 + i * (spread / (n - 1)) + groupGap;
      const lift = sorted ? Math.sin(t * 2 + i) * 2 : 0;
      ctx.save();
      ctx.translate(x, y + lift);
      ctx.fillStyle = '#f4f7ff';
      ctx.strokeStyle = i < 3 ? accent : accent2;
      ctx.lineWidth = 1.6;
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(-cw / 2 + r, -ch / 2);
      ctx.arcTo(cw / 2, -ch / 2, cw / 2, ch / 2, r);
      ctx.arcTo(cw / 2, ch / 2, -cw / 2, ch / 2, r);
      ctx.arcTo(-cw / 2, ch / 2, -cw / 2, -ch / 2, r);
      ctx.arcTo(-cw / 2, -ch / 2, cw / 2, -ch / 2, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  },

  /* --- FreeCell: a card gliding from a full column into an empty one --- */
  freecell(ctx, w, h, t, accent, accent2) {
    const cw = Math.min(w * 0.14, h * 0.2);
    const ch = cw * 1.35;
    const cols = 5;
    const gap = w * 0.7 / (cols - 1);
    const x0 = w * 0.15;
    const topY = h * 0.24;

    for (let c = 0; c < cols; c++) {
      const stack = c === 2 ? 0 : 2 + (c % 2);
      for (let i = 0; i < stack; i++) {
        ctx.save();
        ctx.fillStyle = '#f4f7ff';
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1.2;
        const x = x0 + c * gap;
        const y = topY + i * (ch * 0.32);
        const r = 3;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + cw, y, x + cw, y + ch, r);
        ctx.arcTo(x + cw, y + ch, x, y + ch, r);
        ctx.arcTo(x, y + ch, x, y, r);
        ctx.arcTo(x, y, x + cw, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    // Empty slot at column 2, dashed.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.setLineDash([3, 4]);
    ctx.strokeRect(x0 + 2 * gap, topY, cw, ch);
    ctx.restore();

    // A card gliding from column 0's stack into the empty column.
    const loop = 2.6;
    const phase = (t % loop) / loop;
    const fromX = x0 + cw / 2;
    const fromY = topY + 2 * (ch * 0.32) + ch / 2;
    const toX = x0 + 2 * gap + cw / 2;
    const p = phase < 0.6 ? phase / 0.6 : 1;
    const fx = fromX + (toX - fromX) * p;
    const fy = fromY - Math.sin(p * Math.PI) * h * 0.16;
    ctx.save();
    ctx.shadowColor = accent2;
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#f4f7ff';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.fillRect(fx - cw / 2, fy - ch / 2, cw, ch);
    ctx.strokeRect(fx - cw / 2, fy - ch / 2, cw, ch);
    ctx.restore();
  },

  /* --- Checkers: a piece hopping a diagonal capture --- */
  checkers(ctx, w, h, t, accent, accent2) {
    const n = 6;
    const cell = Math.min(w, h) / (n + 1);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if ((r + c) % 2 === 0) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      }
    }
    const piece = (x, y, color, rim) => {
      ctx.save();
      ctx.shadowColor = rim;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    };
    // Static pieces.
    piece(ox + 1 * cell + cell / 2, oy + 4 * cell + cell / 2, '#1f2937', accent2);
    piece(ox + 3 * cell + cell / 2, oy + 4 * cell + cell / 2, '#1f2937', accent2);
    piece(ox + 5 * cell + cell / 2, oy + 4 * cell + cell / 2, '#1f2937', accent2);

    // A hopping capture: (2,3) jumps over (3,4)'s neighbour to (4,5).
    const loop = 2.2;
    const phase = (t % loop) / loop;
    const r0 = 2, c0 = 3, r1 = 4, c1 = 5;
    const x0 = ox + c0 * cell + cell / 2, y0 = oy + r0 * cell + cell / 2;
    const x1 = ox + c1 * cell + cell / 2, y1 = oy + r1 * cell + cell / 2;
    const jx = x0 + (x1 - x0) * phase;
    const jy = y0 + (y1 - y0) * phase - Math.sin(phase * Math.PI) * cell * 0.7;
    piece(jx, jy, '#e9edf6', accent);
  },

  /* --- Backgammon: a checker running its points, dice settling --- */
  backgammon(ctx, w, h, t, accent, accent2) {
    const rows = 2;
    const pts = 6;
    const pw = w * 0.11;
    const rowH = h * 0.34;
    const x0 = w * 0.08;
    for (let row = 0; row < rows; row++) {
      const y = row === 0 ? h * 0.14 : h * 0.86;
      const dir = row === 0 ? 1 : -1;
      for (let p = 0; p < pts; p++) {
        const x = x0 + p * pw;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + pw / 2, y + dir * rowH);
        ctx.lineTo(x + pw, y);
        ctx.closePath();
        ctx.fillStyle = p % 2 ? mixHex(accent, '#000000', 0.16) : mixHex(accent2, '#000000', 0.1);
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // A checker racing along the top row.
    const loop = 3;
    const phase = (t % loop) / loop;
    const p = phase * (pts - 1);
    const cx = x0 + p * pw + pw / 2;
    const cy = h * 0.14 + 14;
    glow(ctx, '#e9edf6', 8, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, pw * 0.28, 0, Math.PI * 2);
      ctx.fill();
    });
    // Two small dice.
    const dx = w * 0.8;
    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.fillStyle = '#f4f7ff';
      ctx.fillRect(dx + i * 20 - 8, h * 0.5 - 8, 16, 16);
      ctx.fillStyle = '#141821';
      ctx.beginPath();
      ctx.arc(dx + i * 20, h * 0.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  /* --- Battleship: a targeting reticle sweeping a grid, a hit flashing --- */
  battleship(ctx, w, h, t, accent, accent2) {
    const n = 7;
    const cell = Math.min(w, h) / (n + 1);
    const ox = (w - n * cell) / 2;
    const oy = (h - n * cell) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      ctx.moveTo(ox + i * cell, oy);
      ctx.lineTo(ox + i * cell, oy + n * cell);
      ctx.moveTo(ox, oy + i * cell);
      ctx.lineTo(ox + n * cell, oy + i * cell);
    }
    ctx.stroke();

    // A small ship silhouette.
    ctx.save();
    ctx.fillStyle = mixHex(accent2, '#000000', 0.2);
    ctx.fillRect(ox + 1 * cell, oy + 2 * cell + cell * 0.3, cell * 3, cell * 0.5);
    ctx.restore();

    const loop = 2.4;
    const phase = (t % loop) / loop;
    const rc = Math.floor(phase * 9);
    const r = Math.floor(rc / 3) + 1;
    const c = (rc % 3) + 1;
    const cx = ox + c * cell + cell / 2;
    const cy = oy + r * cell + cell / 2;
    const isHit = r === 2 && c >= 1 && c <= 3;

    ctx.save();
    ctx.strokeStyle = isHit ? accent : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - cell * 0.3, cy);
    ctx.lineTo(cx + cell * 0.3, cy);
    ctx.moveTo(cx, cy - cell * 0.3);
    ctx.lineTo(cx, cy + cell * 0.3);
    ctx.stroke();
    ctx.restore();

    if (isHit && phase % 0.34 < 0.17) {
      glow(ctx, accent, 12, () => {
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.22, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  },

  /* --- Word Ladder: letter tiles morphing one at a time --- */
  wordladder(ctx, w, h, t, accent, accent2) {
    const words = ['CAT', 'COT', 'COG', 'DOG'];
    const tile = Math.min(w * 0.16, h * 0.2);
    const gap = tile * 0.22;
    const rowGap = tile * 0.3;
    const totalW = 3 * tile + 2 * gap;
    const x0 = (w - totalW) / 2;
    const y0 = h * 0.14;

    const loop = words.length * 1.1;
    const phase = (t % loop) / 1.1;
    const rowFloat = Math.min(words.length - 1, phase);
    const activeRow = Math.floor(rowFloat);
    const changedLetter = activeRow % 3;

    for (let row = 0; row < words.length; row++) {
      const y = y0 + row * (tile + rowGap);
      const word = words[row];
      for (let col = 0; col < 3; col++) {
        const x = x0 + col * (tile + gap);
        const isChanging = row === activeRow + 1 && col === changedLetter;
        ctx.save();
        ctx.fillStyle = row <= activeRow ? 'rgba(74,222,128,0.14)' : 'rgba(255,255,255,0.04)';
        ctx.strokeStyle = isChanging ? accent : row <= activeRow ? accent2 : 'rgba(255,255,255,0.16)';
        ctx.lineWidth = isChanging ? 2 : 1.2;
        const r = 5;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + tile, y, x + tile, y + tile, r);
        ctx.arcTo(x + tile, y + tile, x, y + tile, r);
        ctx.arcTo(x, y + tile, x, y, r);
        ctx.arcTo(x, y, x + tile, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (row <= activeRow) {
          ctx.fillStyle = '#e9edf6';
          ctx.font = `700 ${Math.round(tile * 0.44)}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(word[col], x + tile / 2, y + tile / 2 + 1);
        }
        ctx.restore();
      }
    }
  },

  /* --- Contagion: a dot-grid world going red from one point outward --- */
  contagion(ctx, w, h, t, accent, accent2) {
    // A coarse mask of "land", so the spread has a shape to crawl over rather
    // than filling a rectangle. One bit per cell, read left to right.
    const MAP = [
      '..##.....###...',
      '.####...#####..',
      '.###...#######.',
      '..#....##..####',
      '..#...####..##.',
      '..##..####.###.',
      '...#...##...#..',
      '...#...#...###.',
    ];
    const cols = MAP[0].length;
    const rows = MAP.length;
    const cell = Math.min(w / (cols + 2), h / (rows + 2));
    const x0 = (w - cols * cell) / 2;
    const y0 = (h - rows * cell) / 2;

    // Patient zero sits in the middle-left landmass; the wave is a radius that
    // grows over the loop, so a cell lights when the wave reaches it.
    const seed = { c: 3, r: 5 };
    // The wave finishes with a quarter of the loop to spare, so the card
    // spends real time showing a half-infected world rather than a finished
    // one — which is the state the game is actually about.
    const loop = 9;
    const phase = (t % loop) / loop;
    const wave = phase * (cols * 1.7);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (MAP[r][c] !== '#') continue;
        const x = x0 + c * cell;
        const y = y0 + r * cell;
        const d = Math.hypot(c - seed.c, (r - seed.r) * 1.35);
        const edge = wave - d;
        const s = cell * 0.72;

        if (edge <= 0) {
          ctx.fillStyle = 'rgba(96,140,190,0.30)';
          ctx.fillRect(x, y, s, s);
        } else if (edge < 1) {
          // The leading edge is the brightest thing on the card.
          glow(ctx, accent, 10, () => ctx.fillRect(x, y, s, s));
        } else {
          ctx.fillStyle = edge > 7 ? accent2 : accent;
          ctx.globalAlpha = edge > 7 ? 0.55 : 0.9;
          ctx.fillRect(x, y, s, s);
          ctx.globalAlpha = 1;
        }
      }
    }

    // One DNA bubble surfacing over infected ground, on its own slower clock.
    const bt = (t % 2.6) / 2.6;
    if (bt < 0.72) {
      const bx = x0 + (seed.c + 3.5) * cell;
      const by = y0 + (seed.r - 2.5) * cell;
      const rad = cell * 0.6 * Math.min(1, bt * 6) * (1 + Math.sin(t * 7) * 0.08);
      ctx.globalAlpha = 1 - Math.max(0, (bt - 0.5) / 0.22);
      glow(ctx, '#fbbf24', 12, () => {
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
  },

  default(ctx, w, h, t, accent) {
    glow(ctx, accent, 16, () => {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.14 * (1 + Math.sin(t * 2) * 0.08), 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

export { PREVIEWS };
