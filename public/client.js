const socket = io(window.XOX_SERVER_URL || undefined);

const screenLogin = document.getElementById('screen-login');
const screenGame = document.getElementById('screen-game');
const nicknameInput = document.getElementById('nickname');
const loginError = document.getElementById('login-error');
const btnJoin = document.getElementById('btn-join');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const hudEmoji = document.getElementById('hud-emoji');
const hudName = document.getElementById('hud-name');
const hudScore = document.getElementById('hud-score');
const hudProgressBar = document.getElementById('hud-progress-bar');
const hudUnlock = document.getElementById('hud-unlock');
const toast = document.getElementById('toast');

const matingBanner = document.getElementById('mating-banner');
const matingBannerText = document.getElementById('mating-banner-text');
const matingBannerBar = document.getElementById('mating-banner-bar');

let gameActive = false;
let myId = null;
let mapWidth = 2400;
let mapHeight = 1600;
let animals = [];
let tierThresholds = [0];
let upbreedMinTier = 4;

let world = { npcs: [], players: [] };
let myTier = 1;
let myScore = 0;

// ---- Decorative background (deterministic, purely cosmetic) ----
const DECOR_SYMBOLS = ['🌳', '🌳', '🌴', '🌿', '🪨', '🌵', '🌾'];
let decorations = [];
let ponds = [];

function buildDecorations() {
  decorations = [];
  ponds = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const count = Math.floor((mapWidth * mapHeight) / 50000);
  for (let i = 0; i < count; i += 1) {
    decorations.push({
      x: rand() * mapWidth,
      y: rand() * mapHeight,
      symbol: DECOR_SYMBOLS[Math.floor(rand() * DECOR_SYMBOLS.length)],
      size: 22 + rand() * 18,
    });
  }
  const pondCount = Math.max(2, Math.floor((mapWidth * mapHeight) / 1500000));
  for (let i = 0; i < pondCount; i += 1) {
    ponds.push({
      x: rand() * mapWidth,
      y: rand() * mapHeight,
      rx: 70 + rand() * 60,
      ry: 40 + rand() * 30,
      phase: rand() * Math.PI * 2,
    });
  }
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ---- Login ----
function getNickname() {
  const val = nicknameInput.value.trim();
  if (!val) {
    loginError.textContent = 'Lütfen bir nickname gir.';
    return null;
  }
  loginError.textContent = '';
  return val;
}

btnJoin.addEventListener('click', () => {
  const nickname = getNickname();
  if (!nickname) return;
  socket.emit('join', { nickname });
});

nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

socket.on('joined', (data) => {
  myId = data.id;
  mapWidth = data.mapWidth;
  mapHeight = data.mapHeight;
  animals = data.animals;
  tierThresholds = data.tierThresholds;
  upbreedMinTier = data.upbreedMinTier;

  buildDecorations();
  screenLogin.classList.remove('active');
  screenGame.classList.add('active');
  gameActive = true;
  requestAnimationFrame(renderLoop);
});

// ---- Input ----
const keys = { up: false, down: false, left: false, right: false };
const KEY_MAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

function sendInput() {
  socket.emit('input', keys);
}

window.addEventListener('keydown', (e) => {
  if (!gameActive) return;
  const mapped = KEY_MAP[e.key];
  if (mapped) {
    if (!keys[mapped]) {
      keys[mapped] = true;
      sendInput();
    }
    e.preventDefault();
    return;
  }
  if (e.code === 'Space' && !e.repeat) {
    socket.emit('interact');
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  if (!gameActive) return;
  const mapped = KEY_MAP[e.key];
  if (mapped) {
    keys[mapped] = false;
    sendInput();
    e.preventDefault();
  }
});

// ---- World updates ----
socket.on('world', (data) => {
  world = data;
  const me = world.players.find((p) => p.id === myId);
  if (me) {
    myTier = me.tier;
    myScore = me.score;
    updateHud();
  }
});

function updateHud() {
  const animal = animals[myTier];
  if (!animal) return;
  hudEmoji.textContent = animal.emoji;
  hudName.textContent = `${animal.name} (Kademe ${myTier})`;
  hudScore.textContent = `${myScore} puan`;

  const base = tierThresholds[myTier - 1] || 0;
  const next = tierThresholds[myTier];
  if (next === undefined) {
    hudProgressBar.style.width = '100%';
  } else {
    const pct = Math.max(0, Math.min(1, (myScore - base) / (next - base)));
    hudProgressBar.style.width = `${pct * 100}%`;
  }

  hudUnlock.hidden = myTier < upbreedMinTier;
}

// ---- Mating ----
let matingActive = null; // { partnerId, partnerType, partnerName }
let matingTimer = null;

socket.on('mating_start', ({ partnerName, partnerTier, partnerId, partnerType, duration }) => {
  matingActive = { partnerId, partnerType, partnerName };

  matingBannerText.textContent = `${partnerName} ile çiftleşiyor... ❤️`;
  matingBannerBar.style.transition = 'none';
  matingBannerBar.style.width = '0%';
  matingBanner.classList.add('show');
  void matingBannerBar.offsetWidth;
  matingBannerBar.style.transition = `width ${duration}ms linear`;
  matingBannerBar.style.width = '100%';

  clearTimeout(matingTimer);
  matingTimer = setTimeout(() => {
    matingBanner.classList.remove('show');
  }, duration + 150);
});

socket.on('mating_end', ({ points, evolved, interrupted }) => {
  matingActive = null;
  matingBanner.classList.remove('show');
  clearTimeout(matingTimer);
  if (interrupted) {
    showToast('Eş bağlantıyı kesti, çiftleşme yarım kaldı.');
    return;
  }
  const animal = animals[myTier];
  if (evolved && animal) {
    showToast(`+${points} puan! 🎉 ${animal.name}'e evrildin!`);
  } else {
    showToast(`+${points} puan!`);
  }
});

socket.on('interact_fail', () => {
  showToast('Yakında uygun bir eş yok.');
});

let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ---- Camera (smoothed pan + zoom, dramatic zoom-in when mating starts) ----
const camera = { x: mapWidth / 2, y: mapHeight / 2, zoom: 1 };
const MATING_ZOOM = 2.4;
let cameraInitialized = false;

function findEntity(id, type) {
  if (type === 'npc') return world.npcs.find((n) => n.id === id);
  return world.players.find((p) => p.id === id);
}

function clampedCenter(c, canvasSize, mapSize, zoom) {
  const viewportWorld = canvasSize / zoom;
  if (viewportWorld >= mapSize) return mapSize / 2;
  return Math.max(viewportWorld / 2, Math.min(c, mapSize - viewportWorld / 2));
}

function updateCamera() {
  const me = world.players.find((p) => p.id === myId);
  let targetX = camera.x;
  let targetY = camera.y;
  let targetZoom = 1;

  if (matingActive && me) {
    const partner = findEntity(matingActive.partnerId, matingActive.partnerType);
    if (partner) {
      targetX = (me.x + partner.x) / 2;
      targetY = (me.y + partner.y) / 2;
      targetZoom = MATING_ZOOM;
    } else if (me) {
      targetX = me.x;
      targetY = me.y;
    }
  } else if (me) {
    targetX = me.x;
    targetY = me.y;
  }

  if (!cameraInitialized && me) {
    camera.x = targetX;
    camera.y = targetY;
    cameraInitialized = true;
  }

  const ease = 0.09;
  camera.x += (targetX - camera.x) * ease;
  camera.y += (targetY - camera.y) * ease;
  camera.zoom += (targetZoom - camera.zoom) * ease;
}

function worldToScreen(wx, wy) {
  const cx = clampedCenter(camera.x, canvas.width, mapWidth, camera.zoom);
  const cy = clampedCenter(camera.y, canvas.height, mapHeight, camera.zoom);
  return {
    x: (wx - cx) * camera.zoom + canvas.width / 2,
    y: (wy - cy) * camera.zoom + canvas.height / 2,
  };
}

// ---- Floating heart particles (playful, entirely non-explicit) ----
let heartParticles = [];
let lastHeartSpawn = 0;
const HEART_SYMBOLS = ['❤️', '💕', '💖'];

function spawnHearts(worldX, worldY) {
  for (let i = 0; i < 2; i += 1) {
    heartParticles.push({
      x: worldX + (Math.random() - 0.5) * 34,
      y: worldY - 10,
      vy: -0.018 - Math.random() * 0.012,
      born: performance.now(),
      life: 1000 + Math.random() * 500,
      swayPhase: Math.random() * Math.PI * 2,
      symbol: HEART_SYMBOLS[Math.floor(Math.random() * HEART_SYMBOLS.length)],
      size: 15 + Math.random() * 11,
    });
  }
}

function updateAndDrawHearts(now) {
  heartParticles = heartParticles.filter((h) => now - h.born < h.life);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of heartParticles) {
    const age = now - h.born;
    const t = age / h.life;
    const wx = h.x + Math.sin(age / 260 + h.swayPhase) * 10;
    const wy = h.y + h.vy * age;
    const screen = worldToScreen(wx, wy);
    ctx.globalAlpha = Math.max(0, 1 - t) * (camera.zoom > 1.3 ? 1 : 0.85);
    ctx.font = `${h.size * Math.min(camera.zoom, 1.6)}px serif`;
    ctx.fillText(h.symbol, screen.x, screen.y);
  }
  ctx.globalAlpha = 1;
}

// ---- Rendering ----
function drawBackground(now) {
  const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bgGradient.addColorStop(0, '#4c7a34');
  bgGradient.addColorStop(1, '#243d1e');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // soft dot texture instead of a harsh grid
  const cx = clampedCenter(camera.x, canvas.width, mapWidth, camera.zoom);
  const cy = clampedCenter(camera.y, canvas.height, mapHeight, camera.zoom);
  const spacing = 70 * camera.zoom;
  const offX = (-cx * camera.zoom + canvas.width / 2) % spacing;
  const offY = (-cy * camera.zoom + canvas.height / 2) % spacing;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = offX; x < canvas.width; x += spacing) {
    for (let y = offY; y < canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6 * camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ponds with a gentle shimmer
  for (const pond of ponds) {
    const s = worldToScreen(pond.x, pond.y);
    const rx = pond.rx * camera.zoom;
    const ry = pond.ry * camera.zoom;
    if (s.x < -rx - 40 || s.x > canvas.width + rx + 40 || s.y < -ry - 40 || s.y > canvas.height + ry + 40) continue;
    const shimmer = 0.55 + Math.sin(now / 700 + pond.phase) * 0.12;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(63, 140, 189, ${shimmer})`;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s.x - rx * 0.25, s.y - ry * 0.25, rx * 0.35, ry * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.12 + shimmer * 0.08})`;
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of decorations) {
    const s = worldToScreen(d.x, d.y);
    const size = d.size * camera.zoom;
    if (s.x < -size || s.x > canvas.width + size || s.y < -size || s.y > canvas.height + size) continue;
    ctx.font = `${size}px serif`;
    ctx.fillText(d.symbol, s.x, s.y);
  }
}

function drawEntity(entity, animal, label, busy, isMe, now) {
  if (!animal) return;
  const screen = worldToScreen(entity.x, entity.y);
  const size = 32 * camera.zoom;
  if (screen.x < -size * 2 || screen.x > canvas.width + size * 2 || screen.y < -size * 2 || screen.y > canvas.height + size * 2) return;

  const bob = Math.sin(now / 260 + entity.x * 0.05 + entity.y * 0.05) * 2.2 * camera.zoom;
  const sx = screen.x;
  const sy = screen.y + bob;

  ctx.beginPath();
  ctx.ellipse(sx, screen.y + 15 * camera.zoom, 13 * camera.zoom, 5 * camera.zoom, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  if (busy) {
    const pulse = 0.5 + Math.sin(now / 220) * 0.15;
    ctx.beginPath();
    ctx.arc(sx, sy, 24 * camera.zoom, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,107,152,${0.16 * pulse + 0.08})`;
    ctx.fill();
  }

  if (isMe) {
    ctx.beginPath();
    ctx.arc(sx, sy, 26 * camera.zoom, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(108,141,255,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6 * camera.zoom;
  ctx.font = `${size}px serif`;
  ctx.fillText(animal.emoji, sx, sy);
  ctx.shadowBlur = 0;

  if (label) {
    ctx.font = `${12 * Math.min(camera.zoom, 1.4)}px sans-serif`;
    ctx.fillStyle = isMe ? '#6c8dff' : '#f0f1f5';
    ctx.fillText(label, sx, sy + 26 * camera.zoom);
  }
}

function renderLoop(now) {
  if (!gameActive) return;
  now = now || performance.now();

  updateCamera();
  drawBackground(now);

  for (const npc of world.npcs) {
    drawEntity(npc, animals[npc.tier], null, npc.busy, false, now);
  }
  for (const p of world.players) {
    const isMe = p.id === myId;
    drawEntity(p, animals[p.tier], p.nickname, p.busy, isMe, now);
  }

  if (matingActive) {
    const me = world.players.find((p) => p.id === myId);
    const partner = findEntity(matingActive.partnerId, matingActive.partnerType);
    if (me && partner && now - lastHeartSpawn > 260) {
      spawnHearts((me.x + partner.x) / 2, (me.y + partner.y) / 2 - 30);
      lastHeartSpawn = now;
    }
  }
  updateAndDrawHearts(now);

  requestAnimationFrame(renderLoop);
}
