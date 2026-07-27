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

  default(ctx, w, h, t, accent) {
    glow(ctx, accent, 16, () => {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.14 * (1 + Math.sin(t * 2) * 0.08), 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

export { PREVIEWS };
