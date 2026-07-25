const socket = io();

const joinInfo = document.getElementById('join-info');
const qTitleEl = document.getElementById('q-title');
const qProgressEl = document.getElementById('q-progress');
const qButtonsEl = document.getElementById('q-buttons');
const statusBanner = document.getElementById('status-banner');
const judgeCorrectBtn = document.getElementById('judge-correct');
const judgeWrongBtn = document.getElementById('judge-wrong');
const revealBtn = document.getElementById('reveal-btn');
const resetBuzzBtn = document.getElementById('reset-buzz-btn');
const scoreboardEl = document.getElementById('scoreboard');

let questions = [];
let ytPlayer = null;
let ytReady = false;
window.onYouTubeIframeAPIReady = () => { ytReady = true; };

const RANDOM_DURATIONS = [5, 10, 15, 30, 60]; // 초 단위: 문제마다 이 중 하나를 무작위로 재생

fetch('/api/local-ip').then((r) => r.json()).then((data) => {
  if (data.addresses.length) {
    joinInfo.innerHTML = '참가자 접속 주소: ' + data.addresses
      .map((ip) => `<b>http://${ip}:${data.port}/player.html</b>`)
      .join(' 또는 ');
  } else {
    joinInfo.textContent = '이 PC의 로컬 IP를 찾을 수 없습니다. 같은 네트워크에서 http://<PC IP>:포트/player.html 로 접속하세요.';
  }
});

function renderQuestionButtons() {
  qButtonsEl.innerHTML = '';
  questions.forEach((q, i) => {
    const btn = document.createElement('button');
    btn.textContent = `${i + 1}. ${q.title}`;
    btn.addEventListener('click', () => socket.emit('host:startQuestion', i));
    qButtonsEl.appendChild(btn);
  });
}

socket.emit('host:getQuestions');
socket.on('host:questions', (data) => {
  questions = data;
  renderQuestionButtons();
});

function loadYT(videoId, start, end) {
  const create = () => {
    if (ytPlayer) {
      ytPlayer.loadVideoById({ videoId, startSeconds: start, endSeconds: end || undefined });
    } else {
      ytPlayer = new YT.Player('yt-player', {
        height: '270',
        width: '480',
        videoId,
        playerVars: { start, end: end || undefined, autoplay: 1 },
      });
    }
  };
  if (ytReady && window.YT && window.YT.Player) create();
  else {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { ytReady = true; create(); if (prev) prev(); };
  }
}

socket.on('question:show', ({ index, total, videoId, start, end }) => {
  const q = questions[index];
  qTitleEl.textContent = `문제 ${index + 1}`;

  const duration = RANDOM_DURATIONS[Math.floor(Math.random() * RANDOM_DURATIONS.length)];
  let clipEnd = start + duration;
  if (end !== null && end !== undefined && end < clipEnd) clipEnd = end;

  qProgressEl.textContent = `${index + 1} / ${total} · 이번 재생 길이: ${duration}초`;
  loadYT(videoId, start, clipEnd);
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 부저를 기다리는 중...';
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
  revealBtn.disabled = false;
});

socket.on('buzz:locked', ({ nickname }) => {
  statusBanner.className = 'status-banner locked';
  statusBanner.textContent = `🚨 ${nickname}님이 부저를 눌렀습니다!`;
  judgeCorrectBtn.disabled = false;
  judgeWrongBtn.disabled = false;
});

socket.on('buzz:reset', ({ nickname }) => {
  statusBanner.className = 'status-banner';
  statusBanner.textContent = `❌ ${nickname}님 오답! 다시 부저를 기다립니다...`;
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
});

socket.on('buzz:cleared', () => {
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 부저를 기다리는 중...';
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
});

socket.on('question:result', ({ correct, nickname, answer }) => {
  statusBanner.className = 'status-banner correct';
  statusBanner.textContent = correct
    ? `🎉 정답! ${nickname} — 정답은 "${answer}"`
    : `정답 공개: "${answer}"`;
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
  revealBtn.disabled = true;
});

judgeCorrectBtn.addEventListener('click', () => socket.emit('host:judge', true));
judgeWrongBtn.addEventListener('click', () => socket.emit('host:judge', false));
revealBtn.addEventListener('click', () => socket.emit('host:reveal'));
resetBuzzBtn.addEventListener('click', () => socket.emit('host:resetBuzz'));

socket.on('scoreboard:update', (list) => {
  scoreboardEl.innerHTML = '';
  list.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="rank">${i + 1}</span>${p.nickname}</span><span class="score">${p.score}점</span>`;
    scoreboardEl.appendChild(li);
  });
});
