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

const rooms = new Map(); // code -> room
let quickQueue = null; // socket waiting for a random opponent

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(code) {
  const room = {
    code,
    players: [], // { id, nickname, symbol }
    board: Array(9).fill(null),
    turn: 'X',
    started: false,
    result: null,
  };
  rooms.set(code, room);
  return room;
}

function checkResult(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every(Boolean)) return { winner: 'draw', line: null };
  return null;
}

function sanitizeNickname(raw) {
  return String(raw || '').trim().slice(0, 20) || 'Oyuncu';
}

function broadcastRoom(room) {
  room.players.forEach((player) => {
    const opponent = room.players.find((p) => p.id !== player.id) || null;
    io.to(player.id).emit('room_update', {
      code: room.code,
      board: room.board,
      turn: room.turn,
      started: room.started,
      result: room.result,
      you: { nickname: player.nickname, symbol: player.symbol },
      opponent: opponent ? { nickname: opponent.nickname, symbol: opponent.symbol } : null,
    });
  });
}

function joinRoomSocket(socket, room, nickname) {
  const symbol = room.players.length === 0 ? 'X' : 'O';
  room.players.push({ id: socket.id, nickname, symbol });
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.nickname = nickname;
  if (room.players.length === 2) {
    room.started = true;
  }
  broadcastRoom(room);
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  room.players = room.players.filter((p) => p.id !== socket.id);
  socket.leave(code);
  socket.data.roomCode = null;

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  room.started = false;
  room.board = Array(9).fill(null);
  room.turn = 'X';
  room.result = null;
  io.to(room.code).emit('opponent_left');
  broadcastRoom(room);
}

io.on('connection', (socket) => {
  socket.on('find_match', ({ nickname }) => {
    const name = sanitizeNickname(nickname);
    socket.data.nickname = name;

    if (quickQueue && quickQueue.connected && quickQueue.id !== socket.id) {
      const waiting = quickQueue;
      quickQueue = null;
      const room = createRoom(generateRoomCode());
      joinRoomSocket(waiting, room, waiting.data.nickname);
      joinRoomSocket(socket, room, name);
    } else {
      quickQueue = socket;
      socket.emit('waiting_for_match');
    }
  });

  socket.on('cancel_find_match', () => {
    if (quickQueue && quickQueue.id === socket.id) {
      quickQueue = null;
    }
  });

  socket.on('create_room', ({ nickname }) => {
    const name = sanitizeNickname(nickname);
    socket.data.nickname = name;
    const room = createRoom(generateRoomCode());
    joinRoomSocket(socket, room, name);
    socket.emit('room_created', { code: room.code });
  });

  socket.on('join_room', ({ nickname, code }) => {
    const name = sanitizeNickname(nickname);
    const roomCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('join_error', { message: 'Oda bulunamadı.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('join_error', { message: 'Oda dolu.' });
      return;
    }

    socket.data.nickname = name;
    joinRoomSocket(socket, room, name);
  });

  socket.on('make_move', ({ index }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.result) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.symbol !== room.turn) return;
    if (typeof index !== 'number' || index < 0 || index > 8 || room.board[index]) return;

    room.board[index] = player.symbol;
    const result = checkResult(room.board);
    if (result) {
      room.result = result;
    } else {
      room.turn = room.turn === 'X' ? 'O' : 'X';
    }
    broadcastRoom(room);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.players.length !== 2) return;

    room.board = Array(9).fill(null);
    room.turn = 'X';
    room.result = null;

    const [p1, p2] = room.players;
    [p1.symbol, p2.symbol] = [p2.symbol, p1.symbol];

    broadcastRoom(room);
  });

  socket.on('leave_room', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('disconnect', () => {
    if (quickQueue && quickQueue.id === socket.id) {
      quickQueue = null;
    }
    leaveCurrentRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`XOX server running on http://localhost:${PORT}`);
});
