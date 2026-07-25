const socket = io();

const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const nicknameInput = document.getElementById('nickname-input');
const joinBtn = document.getElementById('join-btn');
const myNameEl = document.getElementById('my-name');
const statusBanner = document.getElementById('status-banner');
const buzzBtn = document.getElementById('buzz-btn');
const scoreboardEl = document.getElementById('scoreboard');

let myId = null;

joinBtn.addEventListener('click', join);
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

function join() {
  const nickname = nicknameInput.value.trim();
  if (!nickname) { nicknameInput.focus(); return; }
  socket.emit('player:join', nickname);
}

socket.on('player:joined', ({ id, nickname }) => {
  myId = id;
  myNameEl.textContent = `${nickname}님, 환영합니다!`;
  joinScreen.style.display = 'none';
  gameScreen.style.display = 'block';
});

socket.on('question:show', () => {
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
  buzzBtn.disabled = false;
});

buzzBtn.addEventListener('click', () => {
  socket.emit('player:buzz');
  buzzBtn.disabled = true;
  statusBanner.textContent = '🚨 버저를 눌렀습니다! 판정을 기다리세요...';
});

socket.on('buzz:locked', ({ id, nickname }) => {
  buzzBtn.disabled = true;
  statusBanner.className = 'status-banner locked';
  statusBanner.textContent = id === myId ? '🚨 당신 차례! 정답을 말하세요!' : `🚨 ${nickname}님이 먼저 눌렀습니다.`;
});

socket.on('buzz:reset', ({ id, nickname }) => {
  statusBanner.className = 'status-banner';
  if (id === myId) {
    statusBanner.textContent = '❌ 오답 처리되었습니다. 이번 문제는 다시 누를 수 없어요.';
    buzzBtn.disabled = true;
  } else {
    statusBanner.textContent = `❌ ${nickname}님 오답! 다시 버저를 누르세요!`;
    buzzBtn.disabled = false;
  }
});

socket.on('buzz:cleared', () => {
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
  buzzBtn.disabled = false;
});

socket.on('question:result', ({ correct, nickname, answer }) => {
  statusBanner.className = 'status-banner correct';
  statusBanner.textContent = correct
    ? `🎉 ${nickname}님 정답! ("${answer}")`
    : `정답 공개: "${answer}"`;
  buzzBtn.disabled = true;
});

socket.on('scoreboard:update', (list) => {
  scoreboardEl.innerHTML = '';
  list.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === myId) li.style.outline = '2px solid var(--accent)';
    li.innerHTML = `<span><span class="rank">${i + 1}</span>${p.nickname}</span><span class="score">${p.score}점</span>`;
    scoreboardEl.appendChild(li);
  });
});
