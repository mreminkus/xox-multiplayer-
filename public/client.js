import * as THREE from 'three';

const socket = io(window.XOX_SERVER_URL || undefined);

const screenLogin = document.getElementById('screen-login');
const screenGame = document.getElementById('screen-game');
const nicknameInput = document.getElementById('nickname');
const loginError = document.getElementById('login-error');
const btnJoin = document.getElementById('btn-join');

const canvas = document.getElementById('canvas');

const hudEmoji = document.getElementById('hud-emoji');
const hudName = document.getElementById('hud-name');
const hudScore = document.getElementById('hud-score');
const hudProgressBar = document.getElementById('hud-progress-bar');
const hudUnlock = document.getElementById('hud-unlock');
const toast = document.getElementById('toast');

const matingBanner = document.getElementById('mating-banner');
const matingBannerText = document.getElementById('mating-banner-text');
const matingBannerBar = document.getElementById('mating-banner-bar');

const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

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

// ================= Login =================
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

// ================= Input =================
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

// ================= HUD =================
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

let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ================= Mating (state only — visuals happen in the 3D scene) =================
let matingActive = null; // { partnerId, partnerType, partnerName }
let matingTimer = null;

socket.on('mating_start', ({ partnerName, partnerId, partnerType, duration }) => {
  matingActive = { partnerId, partnerType, partnerName };
  cameraShake.until = performance.now() + 350;
  cameraShake.duration = 350;
  cameraShake.magnitude = 9;

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

socket.on('interact_fail', (info) => {
  if (info && info.reason === 'too_strong') {
    showToast('Bu hayvan senden çok güçlü — önce evrimleşmen lazım. 😬');
  } else {
    showToast('Yakında uygun bir eş yok.');
  }
});

// ================= Three.js scene =================
let renderer, scene, camera, sunLight;
const clock = new THREE.Clock();

const unitSphere = new THREE.SphereGeometry(1, 14, 10);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
const unitCone = new THREE.ConeGeometry(1, 1, 10);
const unitCapsule = new THREE.CapsuleGeometry(1, 1, 4, 8);

const materialCache = new Map();
function getMaterial(hex) {
  if (!materialCache.has(hex)) {
    materialCache.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0.02 }));
  }
  return materialCache.get(hex);
}

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc8e8);
  scene.fog = new THREE.Fog(0x8fc8e8, 480, 1400);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 3000);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a5220, 0.95);
  scene.add(hemi);

  sunLight = new THREE.DirectionalLight(0xfff2d0, 1.15);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -260;
  sunLight.shadow.camera.right = 260;
  sunLight.shadow.camera.top = 260;
  sunLight.shadow.camera.bottom = -260;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 800;
  scene.add(sunLight);
  scene.add(sunLight.target);

  buildGround();

  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function buildGrassTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4c7a34';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i += 1) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.fillStyle = Math.random() > 0.5 ? 'rgba(58,98,38,0.55)' : 'rgba(112,150,72,0.4)';
    g.fillRect(x, y, 2, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildGround() {
  const tex = buildGrassTexture();
  tex.repeat.set(mapWidth / 55, mapHeight / 55);
  const geo = new THREE.PlaneGeometry(mapWidth + 500, mapHeight + 500);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(mapWidth / 2, 0, mapHeight / 2);
  ground.receiveShadow = true;
  scene.add(ground);
}

let pondMeshes = [];
function buildDecorations() {
  const decorGroup = new THREE.Group();
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const treeMat = getMaterial(0x2d5c28);
  const trunkMat = getMaterial(0x6b4a2b);
  const rockMat = getMaterial(0x8a8a86);
  const bushMat = getMaterial(0x3f6b32);

  const count = Math.floor((mapWidth * mapHeight) / 62000);
  for (let i = 0; i < count; i += 1) {
    const type = rand();
    let obj;
    if (type < 0.55) {
      obj = new THREE.Group();
      const trunk = new THREE.Mesh(unitCylinder, trunkMat);
      trunk.scale.set(2.4, 14, 2.4);
      trunk.position.y = 7;
      const foliage = new THREE.Mesh(unitCone, treeMat);
      foliage.scale.set(11, 22, 11);
      foliage.position.y = 24;
      obj.add(trunk, foliage);
      obj.scale.setScalar(0.75 + rand() * 0.6);
    } else if (type < 0.8) {
      obj = new THREE.Mesh(unitSphere, rockMat);
      const s = 4.5 + rand() * 4;
      obj.scale.set(s, s * 0.8, s);
      obj.position.y = s * 0.4;
    } else {
      obj = new THREE.Mesh(unitSphere, bushMat);
      const s = 6 + rand() * 3;
      obj.scale.setScalar(s);
      obj.position.y = s * 0.7;
    }
    obj.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    obj.position.x = rand() * mapWidth;
    obj.position.z = rand() * mapHeight;
    decorGroup.add(obj);
  }
  scene.add(decorGroup);

  const pondCount = Math.max(2, Math.floor((mapWidth * mapHeight) / 1500000));
  for (let i = 0; i < pondCount; i += 1) {
    const rx = 60 + rand() * 50;
    const rz = 40 + rand() * 30;
    const geo = new THREE.CircleGeometry(1, 28);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3f8cbd, transparent: true, opacity: 0.82, roughness: 0.2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(rx, rz, 1);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(rand() * mapWidth, 0.6, rand() * mapHeight);
    mesh.userData.phase = rand() * Math.PI * 2;
    scene.add(mesh);
    pondMeshes.push(mesh);
  }
}

function updatePonds(t) {
  for (const mesh of pondMeshes) {
    mesh.material.opacity = 0.72 + Math.sin(t * 1.4 + mesh.userData.phase) * 0.1;
  }
}

// ---- Minimap (bottom-right, full-map overview; click top/bottom to zoom) ----
const MINIMAP_MIN_ZOOM = 1;
const MINIMAP_MAX_ZOOM = 6;
let minimapZoom = MINIMAP_MIN_ZOOM;

minimapCanvas.addEventListener('click', (e) => {
  const rect = minimapCanvas.getBoundingClientRect();
  const clickY = e.clientY - rect.top;
  if (clickY < rect.height / 2) {
    minimapZoom = Math.min(MINIMAP_MAX_ZOOM, minimapZoom * 1.35);
  } else {
    minimapZoom = Math.max(MINIMAP_MIN_ZOOM, minimapZoom / 1.35);
  }
});

function drawMinimap() {
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;

  minimapCtx.fillStyle = '#4c7a34';
  minimapCtx.fillRect(0, 0, w, h);

  const me = avatars.get(myId);
  const centerX = me ? me.renderPos.x : mapWidth / 2;
  const centerZ = me ? me.renderPos.z : mapHeight / 2;

  const viewW = mapWidth / minimapZoom;
  const viewH = mapHeight / minimapZoom;
  const halfW = viewW / 2;
  const halfH = viewH / 2;
  const cx = Math.max(halfW, Math.min(mapWidth - halfW, centerX));
  const cz = Math.max(halfH, Math.min(mapHeight - halfH, centerZ));
  const minX = cx - halfW;
  const minZ = cz - halfH;

  const toMini = (wx, wz) => ({ x: ((wx - minX) / viewW) * w, y: ((wz - minZ) / viewH) * h });

  minimapCtx.fillStyle = 'rgba(63,140,189,0.9)';
  for (const pond of pondMeshes) {
    const p = toMini(pond.position.x, pond.position.z);
    const rx = (pond.scale.x / viewW) * w;
    const ry = (pond.scale.y / viewH) * h;
    if (p.x < -rx || p.x > w + rx || p.y < -ry || p.y > h + ry) continue;
    minimapCtx.beginPath();
    minimapCtx.ellipse(p.x, p.y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  minimapCtx.fillStyle = 'rgba(255,255,255,0.4)';
  for (const npc of world.npcs) {
    const p = toMini(npc.x, npc.y);
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
    minimapCtx.beginPath();
    minimapCtx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  for (const pl of world.players) {
    if (pl.id === myId) continue;
    const p = toMini(pl.x, pl.y);
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
    minimapCtx.fillStyle = '#ff8fab';
    minimapCtx.beginPath();
    minimapCtx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  if (me) {
    const p = toMini(me.renderPos.x, me.renderPos.z);
    minimapCtx.fillStyle = '#6c8dff';
    minimapCtx.beginPath();
    minimapCtx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    minimapCtx.fill();
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.stroke();
  }

  minimapCtx.strokeStyle = 'rgba(255,255,255,0.4)';
  minimapCtx.lineWidth = 2;
  minimapCtx.strokeRect(1, 1, w - 2, h - 2);
}

// ---- Animal models (stylized low-poly, built from primitives) ----
const ANIMAL_CONFIGS = {
  1: { build: 'quad', bodyColor: 0x9b9b9b, headColor: 0xa8a8a8, bodyLength: 14, bodyRadius: 6, headRadius: 5.5, legHeight: 6, legRadius: 1.2, earType: 'round', earSize: 4, earColor: 0xe8a8b0, tailLength: 16, tailRadius: 0.8, bushyTail: false, tailColor: 0x9b9b9b },
  2: { build: 'quad', bodyColor: 0xf0ead6, headColor: 0xf5f0e0, bodyLength: 17, bodyRadius: 7.5, headRadius: 6.5, legHeight: 7, legRadius: 1.6, earType: 'long', earSize: 11, earColor: 0xf0d8d8, tailLength: 6, tailRadius: 2.4, bushyTail: true, tailColor: 0xffffff, tailTipColor: 0xffffff },
  3: { build: 'bird', bodyColor: 0xf2e6c8, legHeight: 9, bodyRadius: 8 },
  4: { build: 'quad', bodyColor: 0xd98c4a, headColor: 0xdb974f, bodyLength: 22, bodyRadius: 9, headRadius: 7.5, legHeight: 9, legRadius: 2, earType: 'pointy', earSize: 6, earColor: 0xd98c4a, tailLength: 20, tailRadius: 1.4, bushyTail: false, tailColor: 0xd98c4a },
  5: { build: 'quad', bodyColor: 0xc1552c, headColor: 0xc85f34, bodyLength: 26, bodyRadius: 10, headRadius: 8.5, legHeight: 11, legRadius: 2.2, earType: 'pointy', earSize: 7, earColor: 0xc1552c, tailLength: 22, tailRadius: 2.6, bushyTail: true, tailColor: 0xc1552c, tailTipColor: 0xffffff },
  6: { build: 'quad', bodyColor: 0x6b6f76, headColor: 0x74787f, bodyLength: 32, bodyRadius: 12, headRadius: 10, legHeight: 14, legRadius: 2.6, earType: 'pointy', earSize: 7.5, earColor: 0x6b6f76, tailLength: 22, tailRadius: 2.4, bushyTail: true, tailColor: 0x6b6f76 },
  7: { build: 'quad', bodyColor: 0xd9a441, headColor: 0xdbab4c, bodyLength: 36, bodyRadius: 13, headRadius: 11, legHeight: 15, legRadius: 2.8, earType: 'round', earSize: 5.5, earColor: 0xd9a441, tailLength: 28, tailRadius: 2, bushyTail: false, tailColor: 0xd9a441, spots: true, spotColor: 0x2a1a10 },
  8: { build: 'quad', bodyColor: 0xc98a3e, headColor: 0xcd934a, bodyLength: 42, bodyRadius: 16, headRadius: 13, legHeight: 17, legRadius: 3.4, earType: 'round', earSize: 6, earColor: 0xc98a3e, tailLength: 26, tailRadius: 2.6, bushyTail: true, tailColor: 0xc98a3e, tailTipColor: 0x3a2a1a, mane: true, maneColor: 0x8a5a28 },
};

function buildQuadruped(cfg) {
  const group = new THREE.Group();
  const bodyMat = getMaterial(cfg.bodyColor);
  const headMat = getMaterial(cfg.headColor || cfg.bodyColor);
  const legMat = getMaterial(cfg.legColor || cfg.bodyColor);
  const earMat = getMaterial(cfg.earColor || cfg.bodyColor);
  const tailMat = getMaterial(cfg.tailColor || cfg.bodyColor);

  const { legHeight, bodyRadius, bodyLength } = cfg;

  const body = new THREE.Mesh(unitSphere, bodyMat);
  body.scale.set(bodyLength / 2, bodyRadius, bodyRadius);
  body.position.y = legHeight + bodyRadius * 0.7;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(unitSphere, headMat);
  head.scale.setScalar(cfg.headRadius);
  head.position.set(bodyLength / 2 + cfg.headRadius * 0.5, legHeight + bodyRadius * 0.9, 0);
  head.castShadow = true;
  group.add(head);

  const snout = new THREE.Mesh(unitSphere, headMat);
  snout.scale.set(cfg.headRadius * 0.55, cfg.headRadius * 0.4, cfg.headRadius * 0.4);
  snout.position.set(head.position.x + cfg.headRadius * 0.75, head.position.y - cfg.headRadius * 0.15, 0);
  snout.castShadow = true;
  group.add(snout);

  const legPositions = [
    [bodyLength / 2 - bodyRadius * 0.3, bodyRadius * 0.8],
    [bodyLength / 2 - bodyRadius * 0.3, -bodyRadius * 0.8],
    [-bodyLength / 2 + bodyRadius * 0.3, bodyRadius * 0.8],
    [-bodyLength / 2 + bodyRadius * 0.3, -bodyRadius * 0.8],
  ];
  const legs = [];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(unitCylinder, legMat);
    leg.scale.set(cfg.legRadius, legHeight, cfg.legRadius);
    leg.position.set(lx, legHeight / 2, lz);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
  }
  group.userData.legs = legs;

  if (cfg.earType !== 'none') {
    for (const side of [1, -1]) {
      let ear;
      if (cfg.earType === 'long') {
        ear = new THREE.Mesh(unitCapsule, earMat);
        ear.scale.set(cfg.earSize * 0.3, cfg.earSize, cfg.earSize * 0.3);
        ear.position.set(head.position.x - cfg.headRadius * 0.2, head.position.y + cfg.headRadius * 0.7 + cfg.earSize * 0.4, side * cfg.headRadius * 0.5);
      } else if (cfg.earType === 'pointy') {
        ear = new THREE.Mesh(unitCone, earMat);
        ear.scale.set(cfg.earSize * 0.5, cfg.earSize, cfg.earSize * 0.5);
        ear.position.set(head.position.x - cfg.headRadius * 0.1, head.position.y + cfg.headRadius * 0.7 + cfg.earSize * 0.4, side * cfg.headRadius * 0.55);
      } else {
        ear = new THREE.Mesh(unitSphere, earMat);
        ear.scale.setScalar(cfg.earSize * 0.5);
        ear.position.set(head.position.x - cfg.headRadius * 0.1, head.position.y + cfg.headRadius * 0.6, side * cfg.headRadius * 0.6);
      }
      ear.castShadow = true;
      group.add(ear);
    }
  }

  const tail = new THREE.Mesh(unitCylinder, tailMat);
  const tailLen = cfg.tailLength;
  tail.scale.set(cfg.tailRadius, tailLen, cfg.tailRadius);
  tail.position.set(-bodyLength / 2 - tailLen * 0.3, legHeight + bodyRadius * 0.9, 0);
  tail.rotation.z = Math.PI / 2.6;
  tail.castShadow = true;
  group.add(tail);

  if (cfg.bushyTail) {
    const tuft = new THREE.Mesh(unitSphere, getMaterial(cfg.tailTipColor || cfg.tailColor));
    tuft.scale.setScalar(cfg.tailRadius * 1.8);
    tuft.position.set(
      tail.position.x - Math.cos(Math.PI / 2.6) * tailLen * 0.9,
      tail.position.y + Math.sin(Math.PI / 2.6) * tailLen * 0.9,
      0,
    );
    tuft.castShadow = true;
    group.add(tuft);
  }

  if (cfg.mane) {
    const maneMat = getMaterial(cfg.maneColor);
    const maneCount = 10;
    for (let i = 0; i < maneCount; i += 1) {
      const angle = (i / maneCount) * Math.PI * 2;
      const tuftMesh = new THREE.Mesh(unitSphere, maneMat);
      const r = cfg.headRadius * 1.05;
      tuftMesh.scale.setScalar(cfg.headRadius * 0.55);
      tuftMesh.position.set(head.position.x + Math.cos(angle) * r * 0.5, head.position.y + Math.sin(angle) * r, Math.sin(angle) * r * 0.6);
      tuftMesh.castShadow = true;
      group.add(tuftMesh);
    }
  }

  if (cfg.spots) {
    const spotMat = getMaterial(cfg.spotColor || 0x2a1a10);
    for (let i = 0; i < 9; i += 1) {
      const spot = new THREE.Mesh(unitSphere, spotMat);
      const sx = (Math.random() - 0.5) * bodyLength * 0.8;
      const angle = Math.random() * Math.PI * 2;
      spot.scale.setScalar(bodyRadius * 0.18);
      spot.position.set(sx, legHeight + bodyRadius * 0.7 + Math.sin(angle) * bodyRadius * 0.5, Math.cos(angle) * bodyRadius * 0.95);
      group.add(spot);
    }
  }

  return group;
}

function buildBird(cfg) {
  const group = new THREE.Group();
  const bodyMat = getMaterial(cfg.bodyColor);
  const combMat = getMaterial(0xd93a3a);
  const beakMat = getMaterial(0xe8a83a);
  const legMat = getMaterial(0xd9a83a);
  const { legHeight, bodyRadius } = cfg;

  const body = new THREE.Mesh(unitSphere, bodyMat);
  body.scale.set(bodyRadius * 0.9, bodyRadius, bodyRadius * 1.1);
  body.position.y = legHeight + bodyRadius * 0.8;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(unitSphere, bodyMat);
  head.scale.setScalar(bodyRadius * 0.45);
  head.position.set(0, body.position.y + bodyRadius * 0.9, bodyRadius * 0.9);
  head.castShadow = true;
  group.add(head);

  const beak = new THREE.Mesh(unitCone, beakMat);
  beak.scale.set(bodyRadius * 0.18, bodyRadius * 0.3, bodyRadius * 0.18);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, head.position.y - bodyRadius * 0.05, head.position.z + bodyRadius * 0.4);
  group.add(beak);

  const comb = new THREE.Mesh(unitSphere, combMat);
  comb.scale.set(bodyRadius * 0.12, bodyRadius * 0.22, bodyRadius * 0.12);
  comb.position.set(0, head.position.y + bodyRadius * 0.4, head.position.z - bodyRadius * 0.1);
  group.add(comb);

  const legs = [];
  for (const side of [1, -1]) {
    const leg = new THREE.Mesh(unitCylinder, legMat);
    leg.scale.set(bodyRadius * 0.09, legHeight, bodyRadius * 0.09);
    leg.position.set(0, legHeight / 2, side * bodyRadius * 0.35);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
  }
  group.userData.legs = legs;

  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(unitSphere, bodyMat);
    wing.scale.set(bodyRadius * 0.15, bodyRadius * 0.5, bodyRadius * 0.35);
    wing.position.set(side * bodyRadius * 0.75, body.position.y, 0);
    group.add(wing);
  }

  const tailFan = new THREE.Mesh(unitCone, bodyMat);
  tailFan.scale.set(bodyRadius * 0.35, bodyRadius * 0.55, bodyRadius * 0.12);
  tailFan.rotation.x = -Math.PI / 2.4;
  tailFan.position.set(0, body.position.y + bodyRadius * 0.2, -bodyRadius * 1.0);
  group.add(tailFan);

  return group;
}

function buildAnimalModel(tier) {
  const cfg = ANIMAL_CONFIGS[tier] || ANIMAL_CONFIGS[1];
  return cfg.build === 'bird' ? buildBird(cfg) : buildQuadruped(cfg);
}

// ---- Avatars (live entities synced from server snapshots) ----
const avatars = new Map();

function ensureAvatar(id, tier, isMe) {
  let av = avatars.get(id);
  if (!av) {
    const group = buildAnimalModel(tier);
    scene.add(group);
    av = {
      group, tier, isMe,
      targetPos: { x: group.position.x, z: group.position.z },
      renderPos: { x: group.position.x, z: group.position.z },
      facing: 0,
      walkPhase: Math.random() * 10,
      busy: false,
      ring: null,
    };
    if (isMe) {
      const ringGeo = new THREE.RingGeometry(1, 1.18, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x6c8dff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.scale.setScalar(20);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);
      av.ring = ring;
    }
    avatars.set(id, av);
  } else if (av.tier !== tier) {
    scene.remove(av.group);
    av.group = buildAnimalModel(tier);
    av.group.position.set(av.renderPos.x, 0, av.renderPos.z);
    scene.add(av.group);
    av.tier = tier;
  }
  return av;
}

function removeAvatar(id) {
  const av = avatars.get(id);
  if (!av) return;
  scene.remove(av.group);
  if (av.ring) scene.remove(av.ring);
  avatars.delete(id);
}

socket.on('world', (data) => {
  world = data;
  const seenIds = new Set();

  for (const npc of data.npcs) {
    seenIds.add(npc.id);
    const av = ensureAvatar(npc.id, npc.tier, false);
    av.targetPos.x = npc.x;
    av.targetPos.z = npc.y;
    av.busy = npc.busy;
  }
  for (const p of data.players) {
    seenIds.add(p.id);
    const av = ensureAvatar(p.id, p.tier, p.id === myId);
    av.targetPos.x = p.x;
    av.targetPos.z = p.y;
    av.busy = p.busy;
  }

  for (const id of Array.from(avatars.keys())) {
    if (!seenIds.has(id)) removeAvatar(id);
  }

  const me = data.players.find((p) => p.id === myId);
  if (me) {
    myTier = me.tier;
    myScore = me.score;
    updateHud();
  }
});

// ---- Heart particles (playful, non-explicit) ----
let heartTexture = null;
function buildHeartTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '46px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('❤️', 32, 34);
  return new THREE.CanvasTexture(c);
}

let heartSprites = [];
let lastHeartSpawn = 0;

function spawnHearts(x, z) {
  for (let i = 0; i < 2; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: heartTexture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const scale = 7 + Math.random() * 4;
    sprite.scale.set(scale, scale, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 14, 14, z + (Math.random() - 0.5) * 14);
    sprite.userData = { born: performance.now(), life: 1100 + Math.random() * 500, vy: 9 + Math.random() * 5, swayPhase: Math.random() * Math.PI * 2 };
    scene.add(sprite);
    heartSprites.push(sprite);
  }
}

function updateHeartParticles(t) {
  const now = performance.now();
  heartSprites = heartSprites.filter((s) => {
    const age = now - s.userData.born;
    if (age > s.userData.life) {
      scene.remove(s);
      s.material.dispose();
      return false;
    }
    const p = age / s.userData.life;
    s.position.y = 14 + (s.userData.vy * age) / 1000;
    s.position.x += Math.sin(t * 3 + s.userData.swayPhase) * 0.06;
    s.material.opacity = 1 - p;
    return true;
  });

  if (matingActive) {
    const me = avatars.get(myId);
    const partner = avatars.get(matingActive.partnerId);
    if (me && partner && now - lastHeartSpawn > 260) {
      spawnHearts((me.renderPos.x + partner.renderPos.x) / 2, (me.renderPos.z + partner.renderPos.z) / 2);
      lastHeartSpawn = now;
    }
  }
}

// ---- Camera: elevated follow cam, cinematic orbit + zoom while mating ----
const cameraFocus = new THREE.Vector3(mapWidth / 2, 8, mapHeight / 2);
let cameraOrbitAngle = 0;
const cameraShake = { until: 0, duration: 1, magnitude: 0 };

function updateCamera(dt) {
  const me = avatars.get(myId);
  if (!me) return;

  let targetX = me.renderPos.x;
  let targetZ = me.renderPos.z;
  let distance = 170;
  let height = 150;
  let orbiting = false;
  const desiredAngle = me.facing + Math.PI; // camera trails behind the direction the player faces

  if (matingActive) {
    const partner = avatars.get(matingActive.partnerId);
    if (partner) {
      targetX = (me.renderPos.x + partner.renderPos.x) / 2;
      targetZ = (me.renderPos.z + partner.renderPos.z) / 2;
      distance = 55;
      height = 42;
      orbiting = true;
    }
  }

  const followEase = Math.min(1, dt * 3);
  cameraFocus.x += (targetX - cameraFocus.x) * followEase;
  cameraFocus.z += (targetZ - cameraFocus.z) * followEase;
  cameraFocus.y = 8;

  if (orbiting) {
    cameraOrbitAngle += dt * 0.4;
  } else {
    let diff = desiredAngle - cameraOrbitAngle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    cameraOrbitAngle += diff * Math.min(1, dt * 3.5);
  }
  const angle = cameraOrbitAngle;

  let camX = cameraFocus.x + Math.sin(angle) * distance;
  let camZ = cameraFocus.z + Math.cos(angle) * distance;

  const now = performance.now();
  if (cameraShake.until > now) {
    const remain = (cameraShake.until - now) / cameraShake.duration;
    const mag = cameraShake.magnitude * remain;
    camX += (Math.random() - 0.5) * mag;
    camZ += (Math.random() - 0.5) * mag;
  }

  const camEase = Math.min(1, dt * 4);
  camera.position.x += (camX - camera.position.x) * camEase;
  camera.position.z += (camZ - camera.position.z) * camEase;
  camera.position.y += (height - camera.position.y) * camEase;
  camera.lookAt(cameraFocus.x, cameraFocus.y, cameraFocus.z);

  sunLight.position.set(cameraFocus.x - 180, 260, cameraFocus.z - 140);
  sunLight.target.position.set(cameraFocus.x, 0, cameraFocus.z);
  sunLight.target.updateMatrixWorld();
}

// ================= Main loop =================
function animate() {
  if (!gameActive) return;
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  for (const av of avatars.values()) {
    const dx = av.targetPos.x - av.renderPos.x;
    const dz = av.targetPos.z - av.renderPos.z;
    const moved = Math.hypot(dx, dz);
    const posEase = Math.min(1, dt * 10);
    av.renderPos.x += dx * posEase;
    av.renderPos.z += dz * posEase;

    if (moved > 0.4) {
      const desiredFacing = Math.atan2(dx, dz);
      let diff = desiredFacing - av.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      av.facing += diff * Math.min(1, dt * 8);
      av.walkPhase += dt * 10;
    }

    let extraX = 0;
    let extraZ = 0;
    let bounce = 0;
    let matingFacing = null;
    let tilt = 0;
    if (av.busy) {
      // playful courting circle: both animals orbit their shared midpoint,
      // always turned to face each other — lively but entirely non-explicit
      const orbitR = 11;
      const spinSpeed = 2.3;
      const phaseOffset = av.isMe ? 0 : Math.PI;
      const orbitAngle = t * spinSpeed + phaseOffset;
      extraX = Math.cos(orbitAngle) * orbitR;
      extraZ = Math.sin(orbitAngle) * orbitR;
      bounce = Math.abs(Math.sin(t * 5.5)) * 2.5;
      matingFacing = Math.atan2(-extraX, -extraZ);
      tilt = Math.sin(t * 5.5 + phaseOffset) * 0.14;
    }

    av.group.position.set(av.renderPos.x + extraX, bounce, av.renderPos.z + extraZ);
    // models face local +X; av.facing/matingFacing use a compass-style angle (sin=dx, cos=dz),
    // so a -90° correction is needed to align the model's nose with the actual movement direction
    av.group.rotation.y = (matingFacing !== null ? matingFacing : av.facing) - Math.PI / 2;
    av.group.rotation.z = tilt;

    if (av.group.userData.legs) {
      const swing = Math.sin(av.walkPhase) * (moved > 0.4 ? 0.5 : 0.05);
      av.group.userData.legs.forEach((leg, i) => {
        leg.rotation.x = i % 2 === 0 ? swing : -swing;
      });
    }

    if (av.ring) {
      av.ring.position.set(av.renderPos.x + extraX, 0.3, av.renderPos.z + extraZ);
    }
  }

  updateCamera(dt);
  updateHeartParticles(t);
  updatePonds(t);
  drawMinimap();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ================= Boot =================
socket.on('joined', (data) => {
  myId = data.id;
  mapWidth = data.mapWidth;
  mapHeight = data.mapHeight;
  animals = data.animals;
  tierThresholds = data.tierThresholds;
  upbreedMinTier = data.upbreedMinTier;

  heartTexture = buildHeartTexture();
  cameraFocus.set(mapWidth / 2, 8, mapHeight / 2);

  initScene();
  buildDecorations();

  screenLogin.classList.remove('active');
  screenGame.classList.add('active');
  gameActive = true;
  requestAnimationFrame(animate);
});
