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

const matingOverlay = document.getElementById('mating-overlay');
const matingMe = document.getElementById('mating-me');
const matingPartner = document.getElementById('mating-partner');
const matingText = document.getElementById('mating-text');
const matingProgressBar = document.getElementById('mating-progress-bar');

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
const DECOR_SYMBOLS = ['🌳', '🌳', '🌿', '🪨', '🌵'];
let decorations = [];
function buildDecorations() {
  decorations = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const count = Math.floor((mapWidth * mapHeight) / 55000);
  for (let i = 0; i < count; i += 1) {
    decorations.push({
      x: rand() * mapWidth,
      y: rand() * mapHeight,
      symbol: DECOR_SYMBOLS[Math.floor(rand() * DECOR_SYMBOLS.length)],
      size: 22 + rand() * 18,
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
let matingTimer = null;

socket.on('mating_start', ({ partnerName, partnerTier, duration }) => {
  const myAnimal = animals[myTier];
  const partnerAnimal = animals[partnerTier];
  matingMe.textContent = myAnimal ? myAnimal.emoji : '❓';
  matingPartner.textContent = partnerAnimal ? partnerAnimal.emoji : '❓';
  matingText.textContent = `${partnerName} ile çiftleşiyor...`;

  matingProgressBar.style.transition = 'none';
  matingProgressBar.style.width = '0%';
  matingOverlay.hidden = false;
  // force reflow so the transition below actually animates
  void matingProgressBar.offsetWidth;
  matingProgressBar.style.transition = `width ${duration}ms linear`;
  matingProgressBar.style.width = '100%';

  clearTimeout(matingTimer);
  matingTimer = setTimeout(() => {
    matingOverlay.hidden = true;
  }, duration + 150);
});

socket.on('mating_end', ({ points, evolved, interrupted }) => {
  matingOverlay.hidden = true;
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

// ---- Rendering ----
function clampCam(pos, viewport, mapSize) {
  if (viewport >= mapSize) return -(mapSize - viewport) / 2;
  return Math.max(0, Math.min(pos - viewport / 2, mapSize - viewport));
}

function renderLoop() {
  if (!gameActive) return;

  const me = world.players.find((p) => p.id === myId);
  const camX = me ? clampCam(me.x, canvas.width, mapWidth) : 0;
  const camY = me ? clampCam(me.y, canvas.height, mapHeight) : 0;

  ctx.fillStyle = '#2c4a24';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  const gridSize = 80;
  const offX = -camX % gridSize;
  const offY = -camY % gridSize;
  for (let x = offX; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = offY; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of decorations) {
    const sx = d.x - camX;
    const sy = d.y - camY;
    if (sx < -40 || sx > canvas.width + 40 || sy < -40 || sy > canvas.height + 40) continue;
    ctx.font = `${d.size}px serif`;
    ctx.fillText(d.symbol, sx, sy);
  }

  for (const npc of world.npcs) {
    drawEntity(npc.x - camX, npc.y - camY, animals[npc.tier], null, npc.busy, false);
  }

  for (const p of world.players) {
    const isMe = p.id === myId;
    drawEntity(p.x - camX, p.y - camY, animals[p.tier], p.nickname, p.busy, isMe);
  }

  requestAnimationFrame(renderLoop);
}

function drawEntity(sx, sy, animal, label, busy, isMe) {
  if (!animal) return;
  if (sx < -60 || sx > canvas.width + 60 || sy < -60 || sy > canvas.height + 60) return;

  if (isMe) {
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(108,141,255,0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.font = '32px serif';
  ctx.fillText(animal.emoji, sx, sy);

  if (busy) {
    ctx.font = '16px serif';
    ctx.fillText('❤️', sx, sy - 26);
  }

  if (label) {
    ctx.font = '12px sans-serif';
    ctx.fillStyle = isMe ? '#6c8dff' : '#f0f1f5';
    ctx.fillText(label, sx, sy + 26);
  }
}
