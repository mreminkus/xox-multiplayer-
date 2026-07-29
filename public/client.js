const socket = io(window.XOX_SERVER_URL || undefined);

const screens = {
  login: document.getElementById('screen-login'),
  waiting: document.getElementById('screen-waiting'),
  roomCode: document.getElementById('screen-room-code'),
  game: document.getElementById('screen-game'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

const nicknameInput = document.getElementById('nickname');
const loginError = document.getElementById('login-error');
const roomCodeInput = document.getElementById('room-code-input');
const cells = Array.from(document.querySelectorAll('.cell'));
const turnIndicator = document.getElementById('turn-indicator');
const playerYouEl = document.getElementById('player-you');
const playerOppEl = document.getElementById('player-opponent');
const gameMessage = document.getElementById('game-message');
const btnRematch = document.getElementById('btn-rematch');
const opponentLeftMsg = document.getElementById('opponent-left-msg');

let currentState = null;

function getNickname() {
  const val = nicknameInput.value.trim();
  if (!val) {
    loginError.textContent = 'Lütfen bir nickname gir.';
    return null;
  }
  loginError.textContent = '';
  return val;
}

document.getElementById('btn-quick-match').addEventListener('click', () => {
  const nickname = getNickname();
  if (!nickname) return;
  socket.emit('find_match', { nickname });
  document.getElementById('waiting-text').textContent = 'Rakip aranıyor...';
  showScreen('waiting');
});

document.getElementById('btn-cancel-wait').addEventListener('click', () => {
  socket.emit('cancel_find_match');
  showScreen('login');
});

document.getElementById('btn-create-room').addEventListener('click', () => {
  const nickname = getNickname();
  if (!nickname) return;
  socket.emit('create_room', { nickname });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const nickname = getNickname();
  if (!nickname) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    loginError.textContent = 'Oda kodu gir.';
    return;
  }
  socket.emit('join_room', { nickname, code });
});

document.getElementById('btn-cancel-room').addEventListener('click', () => {
  socket.emit('leave_room');
  showScreen('login');
});

document.getElementById('btn-leave').addEventListener('click', () => {
  socket.emit('leave_room');
  currentState = null;
  showScreen('login');
});

btnRematch.addEventListener('click', () => {
  socket.emit('rematch');
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join-room').click();
});

nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-quick-match').click();
});

cells.forEach((cell) => {
  cell.addEventListener('click', () => {
    if (!currentState || !currentState.you) return;
    const index = Number(cell.dataset.index);
    if (currentState.board[index]) return;
    if (currentState.result) return;
    if (currentState.turn !== currentState.you.symbol) return;
    socket.emit('make_move', { index });
  });
});

socket.on('waiting_for_match', () => {
  showScreen('waiting');
});

socket.on('room_created', ({ code }) => {
  document.getElementById('room-code-display').textContent = code;
  showScreen('roomCode');
});

socket.on('join_error', ({ message }) => {
  loginError.textContent = message;
});

socket.on('opponent_left', () => {
  opponentLeftMsg.hidden = false;
  btnRematch.hidden = true;
});

socket.on('room_update', (state) => {
  currentState = state;

  if (!state.opponent) {
    document.getElementById('room-code-display').textContent = state.code;
    showScreen('roomCode');
    return;
  }

  opponentLeftMsg.hidden = true;
  showScreen('game');
  playerYouEl.textContent = `${state.you.nickname} (${state.you.symbol})`;
  playerOppEl.textContent = `${state.opponent.nickname} (${state.opponent.symbol})`;

  cells.forEach((cell, i) => {
    cell.textContent = state.board[i] || '';
    cell.classList.remove('win');
    cell.disabled = Boolean(state.board[i]) || Boolean(state.result);
  });

  if (state.result) {
    if (state.result.winner === 'draw') {
      gameMessage.textContent = 'Berabere!';
    } else if (state.result.winner === state.you.symbol) {
      gameMessage.textContent = 'Kazandın! 🎉';
    } else {
      gameMessage.textContent = 'Kaybettin.';
    }
    if (state.result.line) {
      state.result.line.forEach((i) => cells[i].classList.add('win'));
    }
    turnIndicator.textContent = '';
    btnRematch.hidden = false;
  } else {
    btnRematch.hidden = true;
    gameMessage.textContent = '';
    turnIndicator.textContent = state.turn === state.you.symbol
      ? 'Sıra sende'
      : `Sıra ${state.opponent.nickname}'de`;
  }
});

socket.on('disconnect', () => {
  gameMessage.textContent = 'Bağlantı koptu, sayfayı yenile.';
});
