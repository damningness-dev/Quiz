const socket = io();

const joinInfo = document.getElementById('join-info');
const qTitleEl = document.getElementById('q-title');
const qProgressEl = document.getElementById('q-progress');
const qButtonsEl = document.getElementById('q-buttons');
const durationPickerEl = document.getElementById('duration-picker');
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

const DURATION_OPTIONS = [5, 10, 15, 30, 60]; // 초 단위 선택지
let selectedDuration = 15;
let playToken = 0; // 문제를 빠르게 연달아 눌렀을 때 이전 재생 준비가 뒤늦게 끼어드는 것을 막기 위한 순번

function renderDurationPicker() {
  durationPickerEl.innerHTML = '';
  DURATION_OPTIONS.forEach((sec) => {
    const btn = document.createElement('button');
    btn.textContent = sec < 60 ? `${sec}초` : '1분';
    if (sec === selectedDuration) btn.classList.add('btn-primary');
    btn.addEventListener('click', () => {
      selectedDuration = sec;
      renderDurationPicker();
    });
    durationPickerEl.appendChild(btn);
  });
}
renderDurationPicker();

let audioCtx = null;
function playBuzzerSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const duration = 1.0;
    const attack = 0.07; // "삐" 하고 빠르게 올라가는 구간
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square'; // 사인/톱니보다 날카롭고 삑삑거리는 음색
    osc.frequency.setValueAtTime(700, now);
    osc.frequency.exponentialRampToValueAtTime(1600, now + attack); // 삐
    osc.frequency.setValueAtTime(1600, now + attack); // 이이익 (고음 유지)
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.45, now + 0.02);
    gain.gain.setValueAtTime(0.45, now + duration - 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch (err) {
    // 오디오 재생이 막혀있어도(자동재생 정책 등) 게임 진행에는 지장 없게 조용히 무시
  }
}

function speak(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // 이전에 말하던 게 남아있으면 끊고 새로 말함
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  } catch (err) {
    // TTS를 지원하지 않는 기기에서도 게임 진행에는 지장 없게 조용히 무시
  }
}

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

// 영상을 재생 없이 먼저 큐잉만 해서(autoplay 0) 전체 길이를 알아낼 준비를 한다.
function ensurePlayerCued(videoId) {
  return new Promise((resolve) => {
    const create = () => {
      if (ytPlayer) {
        ytPlayer.cueVideoById(videoId);
        resolve();
      } else {
        ytPlayer = new YT.Player('yt-player', {
          height: '270',
          width: '480',
          videoId,
          playerVars: { autoplay: 0 },
          events: { onReady: () => resolve() }
        });
      }
    };
    if (ytReady && window.YT && window.YT.Player) create();
    else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { ytReady = true; create(); if (prev) prev(); };
    }
  });
}

// getDuration()이 0을 주다가(메타데이터 로딩 전) 값이 채워질 때까지 잠깐 기다린다.
function waitForDuration(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const d = ytPlayer && typeof ytPlayer.getDuration === 'function' ? ytPlayer.getDuration() : 0;
      if (d && d > 0) return resolve(d);
      if (Date.now() - startedAt > timeoutMs) return resolve(0);
      setTimeout(check, 150);
    };
    check();
  });
}

function playClip(videoId, start, end) {
  ytPlayer.loadVideoById({ videoId, startSeconds: start, endSeconds: end });
}

socket.on('question:show', async ({ index, total, videoId, start, end }) => {
  const myToken = ++playToken;
  const q = questions[index];
  qTitleEl.textContent = `문제 ${index + 1}`;
  qProgressEl.textContent = `${index + 1} / ${total} · 재생 구간 준비 중...`;
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔎 영상 중 무작위 구간을 고르는 중...';
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
  revealBtn.disabled = false;

  await ensurePlayerCued(videoId);
  const totalDuration = await waitForDuration();
  if (myToken !== playToken) return; // 그 사이 다른 문제가 눌렸으면 이 결과는 버림

  const minStart = start || 0;
  const hardEnd = totalDuration > 0
    ? (end !== null && end !== undefined ? Math.min(end, totalDuration) : totalDuration)
    : (end !== null && end !== undefined ? end : null);

  let randomStart = minStart;
  if (hardEnd !== null) {
    // 마지막 부분(정적/페이드아웃)을 피하려고 2초 여유를 둔다.
    const maxStart = Math.max(minStart, hardEnd - selectedDuration - 2);
    randomStart = maxStart > minStart ? minStart + Math.random() * (maxStart - minStart) : minStart;
  }
  const clipEnd = randomStart + selectedDuration;

  qProgressEl.textContent = `${index + 1} / ${total} · 재생 길이: ${selectedDuration < 60 ? selectedDuration + '초' : '1분'} (영상 중 무작위 구간)`;
  playClip(videoId, randomStart, clipEnd);
  statusBanner.textContent = '🔔 부저를 기다리는 중...';
});

socket.on('buzz:locked', ({ nickname }) => {
  playBuzzerSound();
  if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') ytPlayer.pauseVideo();
  statusBanner.className = 'status-banner locked';
  statusBanner.textContent = `🚨 ${nickname}님이 부저를 눌렀습니다!`;
  judgeCorrectBtn.disabled = false;
  judgeWrongBtn.disabled = false;
});

socket.on('buzz:reset', ({ nickname }) => {
  speak('땡! 오답입니다.');
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
  speak(correct ? `딩동댕! ${nickname}님 정답입니다.` : `정답은 ${answer} 입니다.`);
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

const resetScoresBtn = document.getElementById('reset-scores-btn');
resetScoresBtn.addEventListener('click', () => {
  if (confirm('모든 참가자의 점수를 0으로 초기화할까요?')) {
    socket.emit('host:resetScores');
  }
});

socket.on('scoreboard:update', (list) => {
  scoreboardEl.innerHTML = '';
  list.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="rank">${i + 1}</span>${p.nickname}</span><span class="score">${p.score}점</span>`;
    scoreboardEl.appendChild(li);
  });
});
