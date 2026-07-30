const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- World config ----
const MAP_WIDTH = 2400;
const MAP_HEIGHT = 1600;
const TICK_MS = 50; // 20 ticks/sec
const PLAYER_SPEED = 4.2; // px per tick
const NPC_SPEED = 2.1; // px per tick
const INTERACT_RANGE = 52;
const MATING_DURATION_MS = 4000;
const UPBREED_MIN_TIER = 4;
const EDGE_MARGIN = 50;

// index = tier (1-indexed, [0] unused)
const ANIMALS = [
  null,
  { tier: 1, emoji: '🐭', name: 'Fare' },
  { tier: 2, emoji: '🐰', name: 'Tavşan' },
  { tier: 3, emoji: '🐔', name: 'Tavuk' },
  { tier: 4, emoji: '🐱', name: 'Kedi' },
  { tier: 5, emoji: '🦊', name: 'Tilki' },
  { tier: 6, emoji: '🐺', name: 'Kurt' },
  { tier: 7, emoji: '🐆', name: 'Leopar' },
  { tier: 8, emoji: '🦁', name: 'Aslan' },
];
const MAX_TIER = ANIMALS.length - 1;

// score required to REACH tier (index = tier - 1)
const TIER_THRESHOLDS = [0, 60, 150, 270, 430, 650, 930, 1300];

// how many NPCs to keep alive per tier (weaker animals are more common)
const NPC_COUNTS = { 1: 12, 2: 10, 3: 9, 4: 7, 5: 6, 6: 5, 7: 4, 8: 2 };
const NPC_TIER_WEIGHTS = Object.entries(NPC_COUNTS).map(([t, c]) => ({ tier: Number(t), weight: c }));
const NPC_TOTAL_WEIGHT = NPC_TIER_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);

function randomNpcTier() {
  let r = Math.random() * NPC_TOTAL_WEIGHT;
  for (const w of NPC_TIER_WEIGHTS) {
    if (r < w.weight) return w.tier;
    r -= w.weight;
  }
  return 1;
}

function randomPointInMap() {
  return {
    x: EDGE_MARGIN + Math.random() * (MAP_WIDTH - EDGE_MARGIN * 2),
    y: EDGE_MARGIN + Math.random() * (MAP_HEIGHT - EDGE_MARGIN * 2),
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tierForScore(score) {
  let tier = 1;
  for (let t = 1; t < TIER_THRESHOLDS.length; t++) {
    if (score >= TIER_THRESHOLDS[t]) tier = t + 1;
  }
  return Math.min(tier, MAX_TIER);
}

function canMateWith(playerTier, targetTier) {
  if (targetTier === playerTier) return true;
  if (playerTier >= UPBREED_MIN_TIER && targetTier === playerTier + 1) return true;
  return false;
}

function matingPoints(myTier, partnerTier) {
  const effectiveTier = Math.max(myTier, partnerTier > myTier ? partnerTier : myTier);
  return effectiveTier * 12;
}

function sanitizeNickname(raw) {
  return String(raw || '').trim().slice(0, 20) || 'Oyuncu';
}

// ---- World state ----
const npcs = new Map();
const players = new Map();

function spawnNpc(id) {
  const tier = randomNpcTier();
  const pos = randomPointInMap();
  const target = randomPointInMap();
  npcs.set(id, { id, tier, x: pos.x, y: pos.y, tx: target.x, ty: target.y, busy: false });
}

function respawnNpc(npc) {
  const tier = randomNpcTier();
  const pos = randomPointInMap();
  const target = randomPointInMap();
  npc.tier = tier;
  npc.x = pos.x;
  npc.y = pos.y;
  npc.tx = target.x;
  npc.ty = target.y;
  npc.busy = false;
}

let npcSeq = 0;
for (const { tier, weight } of NPC_TIER_WEIGHTS) {
  for (let i = 0; i < weight; i += 1) {
    spawnNpc(`npc-${npcSeq}`);
    npcSeq += 1;
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function tickNpcs() {
  for (const npc of npcs.values()) {
    if (npc.busy) continue;
    const d = dist(npc, { x: npc.tx, y: npc.ty });
    if (d < 8) {
      const target = randomPointInMap();
      npc.tx = target.x;
      npc.ty = target.y;
      continue;
    }
    const dx = (npc.tx - npc.x) / d;
    const dy = (npc.ty - npc.y) / d;
    npc.x = clamp(npc.x + dx * NPC_SPEED, EDGE_MARGIN, MAP_WIDTH - EDGE_MARGIN);
    npc.y = clamp(npc.y + dy * NPC_SPEED, EDGE_MARGIN, MAP_HEIGHT - EDGE_MARGIN);
  }
}

function tickPlayers() {
  for (const player of players.values()) {
    if (player.busy) continue;
    const { up, down, left, right } = player.input;
    let dx = (right ? 1 : 0) - (left ? 1 : 0);
    let dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx === 0 && dy === 0) continue;
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    player.x = clamp(player.x + dx * PLAYER_SPEED, EDGE_MARGIN, MAP_WIDTH - EDGE_MARGIN);
    player.y = clamp(player.y + dy * PLAYER_SPEED, EDGE_MARGIN, MAP_HEIGHT - EDGE_MARGIN);
  }
}

function broadcastWorld() {
  const payload = {
    npcs: Array.from(npcs.values()).map((n) => ({
      id: n.id,
      tier: n.tier,
      x: Math.round(n.x),
      y: Math.round(n.y),
      busy: n.busy,
    })),
    players: Array.from(players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      tier: p.tier,
      score: p.score,
      x: Math.round(p.x),
      y: Math.round(p.y),
      busy: p.busy,
    })),
  };
  io.emit('world', payload);
}

setInterval(() => {
  tickNpcs();
  tickPlayers();
  broadcastWorld();
}, TICK_MS);

function finishMating(session) {
  const { player, targetType, targetRef } = session;

  const playerPoints = matingPoints(player.tier, targetRef.tier);
  const playerPrevTier = player.tier;
  player.score += playerPoints;
  player.tier = tierForScore(player.score);
  player.busy = false;
  player.matingSession = null;
  io.to(player.id).emit('mating_end', {
    points: playerPoints,
    score: player.score,
    tier: player.tier,
    evolved: player.tier > playerPrevTier,
  });

  if (targetType === 'npc') {
    respawnNpc(targetRef);
  } else {
    const partnerPoints = matingPoints(targetRef.tier, playerPrevTier);
    const partnerPrevTier = targetRef.tier;
    targetRef.score += partnerPoints;
    targetRef.tier = tierForScore(targetRef.score);
    targetRef.busy = false;
    targetRef.matingSession = null;
    io.to(targetRef.id).emit('mating_end', {
      points: partnerPoints,
      score: targetRef.score,
      tier: targetRef.tier,
      evolved: targetRef.tier > partnerPrevTier,
    });
  }
}

function startMating(player, target) {
  const session = {
    player,
    targetType: target.type,
    targetRef: target.ref,
  };
  player.busy = true;
  player.matingSession = session;

  if (target.type === 'player') {
    target.ref.busy = true;
    target.ref.matingSession = session;
  } else {
    target.ref.busy = true;
  }

  const partnerLabel = target.type === 'npc' ? ANIMALS[target.ref.tier].name : target.ref.nickname;
  io.to(player.id).emit('mating_start', {
    partnerName: partnerLabel,
    partnerTier: target.ref.tier,
    duration: MATING_DURATION_MS,
  });
  if (target.type === 'player') {
    io.to(target.ref.id).emit('mating_start', {
      partnerName: player.nickname,
      partnerTier: player.tier,
      duration: MATING_DURATION_MS,
    });
  }

  session.timeout = setTimeout(() => finishMating(session), MATING_DURATION_MS);
}

function interruptMating(session, disconnectedPlayer) {
  clearTimeout(session.timeout);
  if (session.targetType === 'npc') {
    session.targetRef.busy = false;
  } else if (session.targetRef.id !== disconnectedPlayer.id) {
    session.targetRef.busy = false;
    session.targetRef.matingSession = null;
    io.to(session.targetRef.id).emit('mating_end', {
      points: 0,
      score: session.targetRef.score,
      tier: session.targetRef.tier,
      evolved: false,
      interrupted: true,
    });
  }
  if (session.player.id !== disconnectedPlayer.id) {
    session.player.busy = false;
    session.player.matingSession = null;
    io.to(session.player.id).emit('mating_end', {
      points: 0,
      score: session.player.score,
      tier: session.player.tier,
      evolved: false,
      interrupted: true,
    });
  }
}

io.on('connection', (socket) => {
  socket.on('join', ({ nickname }) => {
    const pos = randomPointInMap();
    const player = {
      id: socket.id,
      nickname: sanitizeNickname(nickname),
      tier: 1,
      score: 0,
      x: pos.x,
      y: pos.y,
      input: { up: false, down: false, left: false, right: false },
      busy: false,
      matingSession: null,
    };
    players.set(socket.id, player);

    socket.emit('joined', {
      id: socket.id,
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      animals: ANIMALS,
      tierThresholds: TIER_THRESHOLDS,
      upbreedMinTier: UPBREED_MIN_TIER,
    });
  });

  socket.on('input', (state) => {
    const player = players.get(socket.id);
    if (!player || player.busy) return;
    player.input = {
      up: Boolean(state && state.up),
      down: Boolean(state && state.down),
      left: Boolean(state && state.left),
      right: Boolean(state && state.right),
    };
  });

  socket.on('interact', () => {
    const player = players.get(socket.id);
    if (!player || player.busy) return;

    let best = null;
    let bestDist = Infinity;

    for (const npc of npcs.values()) {
      if (npc.busy) continue;
      if (!canMateWith(player.tier, npc.tier)) continue;
      const d = dist(player, npc);
      if (d <= INTERACT_RANGE && d < bestDist) {
        best = { type: 'npc', ref: npc };
        bestDist = d;
      }
    }

    for (const other of players.values()) {
      if (other.id === player.id || other.busy) continue;
      if (!canMateWith(player.tier, other.tier)) continue;
      const d = dist(player, other);
      if (d <= INTERACT_RANGE && d < bestDist) {
        best = { type: 'player', ref: other };
        bestDist = d;
      }
    }

    if (!best) {
      socket.emit('interact_fail');
      return;
    }

    startMating(player, best);
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      if (player.busy && player.matingSession) {
        interruptMating(player.matingSession, player);
      }
      players.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Safari Evrim server running on http://localhost:${PORT}`);
});
