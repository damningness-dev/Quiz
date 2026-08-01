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

// 화면이 꺼지거나 앱을 잠깐 벗어나 연결이 끊겨도, 같은 토큰으로 재접속하면
// 서버가 기존 점수/참가 상태를 그대로 유지해준다.
const TOKEN_KEY = 'quizPlayerToken';
const NICK_KEY = 'quizPlayerNickname';

function getOrCreateToken() {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

const myToken = getOrCreateToken();
const savedNickname = localStorage.getItem(NICK_KEY);

if (savedNickname) {
  // 이전에 입장한 적이 있으면 닉네임 화면을 건너뛰고 바로 재접속을 시도한다.
  nicknameInput.value = savedNickname;
  joinScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  statusBanner.textContent = '다시 연결하는 중...';
  buzzBtn.disabled = true;
}

joinBtn.addEventListener('click', () => join(nicknameInput.value.trim()));
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(nicknameInput.value.trim()); });

function join(nickname) {
  if (!nickname) { nicknameInput.focus(); return; }
  localStorage.setItem(NICK_KEY, nickname);
  socket.emit('player:join', { nickname, token: myToken });
}

// 최초 연결이든, 화면 꺼짐 등으로 인한 재연결이든 이 이벤트가 항상 불리므로
// 저장된 닉네임이 있으면 여기서 자동으로 다시 입장한다.
socket.on('connect', () => {
  if (savedNickname) join(savedNickname);
});

socket.on('player:joined', ({ id, nickname }) => {
  myId = id;
  myNameEl.textContent = `${nickname}님, 환영합니다!`;
  joinScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '문제를 기다리는 중...';
  buzzBtn.disabled = true; // 다음 문제가 시작되면 question:show에서 다시 활성화됨
});

socket.on('question:show', () => {
  clearBuzzCountdown();
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
  buzzBtn.disabled = false;
});

buzzBtn.addEventListener('click', () => {
  socket.emit('player:buzz');
  buzzBtn.disabled = true;
  statusBanner.textContent = '🚨 버저를 눌렀습니다! 판정을 기다리세요...';
});

// 부저를 누른 사람에게 남은 답변 시간(10초)을 보여준다. 실제 자동 오답 처리는
// 서버가 판단해서 buzz:reset(auto: true)으로 알려주므로, 여기서는 표시만 담당한다.
let buzzCountdownInterval = null;
function clearBuzzCountdown() {
  if (buzzCountdownInterval) {
    clearInterval(buzzCountdownInterval);
    buzzCountdownInterval = null;
  }
}

function startBuzzCountdown(deadline) {
  clearBuzzCountdown();
  const tick = () => {
    const remainingMs = deadline - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    statusBanner.textContent = `🚨 당신 차례! 정답을 말하세요! (남은 시간 ${remaining}초)`;
    if (remainingMs <= 0) clearBuzzCountdown();
  };
  tick();
  buzzCountdownInterval = setInterval(tick, 200);
}

socket.on('buzz:locked', ({ id, nickname, deadline }) => {
  buzzBtn.disabled = true;
  statusBanner.className = 'status-banner locked';
  if (id === myId) {
    statusBanner.textContent = '🚨 당신 차례! 정답을 말하세요!';
    if (deadline) startBuzzCountdown(deadline);
  } else {
    statusBanner.textContent = `🚨 ${nickname}님이 먼저 눌렀습니다.`;
  }
});

socket.on('buzz:reset', ({ id, nickname, auto }) => {
  clearBuzzCountdown();
  statusBanner.className = 'status-banner';
  if (id === myId) {
    statusBanner.textContent = auto
      ? '⏰ 시간 초과로 자동 오답 처리되었습니다. 이번 문제는 다시 누를 수 없어요.'
      : '❌ 오답 처리되었습니다. 이번 문제는 다시 누를 수 없어요.';
    buzzBtn.disabled = true;
  } else {
    statusBanner.textContent = auto
      ? `⏰ ${nickname}님 시간 초과! 다시 버저를 누르세요!`
      : `❌ ${nickname}님 오답! 다시 버저를 누르세요!`;
    buzzBtn.disabled = false;
  }
});

socket.on('buzz:cleared', () => {
  clearBuzzCountdown();
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
  buzzBtn.disabled = false;
});

socket.on('question:result', ({ correct, nickname, answer }) => {
  clearBuzzCountdown();
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
