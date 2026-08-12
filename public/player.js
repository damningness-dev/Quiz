const socket = io();

const joinScreen = document.getElementById('join-screen');
const kickedMessageEl = document.getElementById('kicked-message');
const gameScreen = document.getElementById('game-screen');
const nicknameInput = document.getElementById('nickname-input');
const joinBtn = document.getElementById('join-btn');
const myNameEl = document.getElementById('my-name');
const statusBanner = document.getElementById('status-banner');
const buzzBtn = document.getElementById('buzz-btn');
const passBtn = document.getElementById('pass-btn');
const scoreboardEl = document.getElementById('scoreboard');
const votePanel = document.getElementById('vote-panel');
const voteStatusEl = document.getElementById('vote-status');
const voteCorrectBtn = document.getElementById('vote-correct-btn');
const voteWrongBtn = document.getElementById('vote-wrong-btn');
const hostPresenceNote = document.getElementById('host-presence-note');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsPanel = document.getElementById('settings-panel');

let myId = null;
let iHavePassed = false; // 이번 문제를 이미 패스했는지 (다른 사람 오답으로 버튼이 다시 풀릴 때도 계속 비활성 유지)
let iHaveVoted = false; // 이번 부저에 대해 이미 투표했는지
let isHostPresent = false;

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
  passBtn.disabled = true;
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
  kickedMessageEl.style.display = 'none';
  myNameEl.textContent = `${nickname}님, 환영합니다!`;
  joinScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '문제를 기다리는 중...';
  buzzBtn.disabled = true; // 다음 문제가 시작되면 question:show에서 다시 활성화됨
  passBtn.disabled = true;
});

socket.on('question:show', () => {
  clearBuzzCountdown();
  iHavePassed = false;
  showVotePanel(false);
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
  buzzBtn.disabled = false;
  passBtn.disabled = false;
});

buzzBtn.addEventListener('click', () => {
  socket.emit('player:buzz');
  buzzBtn.disabled = true;
  passBtn.disabled = true;
  statusBanner.textContent = '🚨 버저를 눌렀습니다! 판정을 기다리세요...';
});

passBtn.addEventListener('click', () => {
  if (iHavePassed) return;
  socket.emit('player:pass');
  iHavePassed = true;
  buzzBtn.disabled = true;
  passBtn.disabled = true;
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🙅 패스했습니다. 다음 문제를 기다려주세요.';
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

socket.on('buzz:locked', ({ id, nickname, deadline, votingEnabled }) => {
  buzzBtn.disabled = true;
  passBtn.disabled = true;
  statusBanner.className = 'status-banner locked';
  if (id === myId) {
    statusBanner.textContent = '🚨 당신 차례! 정답을 말하세요!';
    if (deadline) startBuzzCountdown(deadline);
  } else {
    statusBanner.textContent = `🚨 ${nickname}님이 먼저 눌렀습니다.`;
  }
  showVotePanel(votingEnabled && id !== myId);
});

socket.on('vote:update', ({ correct, wrong, total }) => {
  voteStatusEl.textContent = `✅ 정답 ${correct}표 · ❌ 오답 ${wrong}표 (과반수: ${Math.floor(total / 2) + 1}표 / 참여 가능 ${total}명)`;
});

voteCorrectBtn.addEventListener('click', () => castVote(true));
voteWrongBtn.addEventListener('click', () => castVote(false));

function castVote(vote) {
  if (iHaveVoted) return;
  socket.emit('player:vote', vote);
  iHaveVoted = true;
  voteCorrectBtn.disabled = true;
  voteWrongBtn.disabled = true;
}

function showVotePanel(show) {
  iHaveVoted = false;
  voteCorrectBtn.disabled = false;
  voteWrongBtn.disabled = false;
  voteStatusEl.textContent = show ? '판정에 투표해주세요. 과반수가 모이면 자동으로 판정됩니다.' : '';
  votePanel.style.display = show ? 'block' : 'none';
}

socket.on('buzz:reset', ({ id, nickname, auto }) => {
  clearBuzzCountdown();
  showVotePanel(false);
  statusBanner.className = 'status-banner';
  if (id === myId) {
    statusBanner.textContent = auto
      ? '⏰ 시간 초과로 자동 오답 처리되었습니다. 이번 문제는 다시 누를 수 없어요.'
      : '❌ 오답 처리되었습니다. 이번 문제는 다시 누를 수 없어요.';
    buzzBtn.disabled = true;
    passBtn.disabled = true;
  } else if (!iHavePassed) {
    statusBanner.textContent = auto
      ? `⏰ ${nickname}님 시간 초과! 다시 버저를 누르세요!`
      : `❌ ${nickname}님 오답! 다시 버저를 누르세요!`;
    buzzBtn.disabled = false;
    passBtn.disabled = false;
  }
});

socket.on('buzz:cleared', () => {
  clearBuzzCountdown();
  showVotePanel(false);
  statusBanner.className = 'status-banner';
  if (!iHavePassed) {
    statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
    buzzBtn.disabled = false;
    passBtn.disabled = false;
  }
});

socket.on('question:result', ({ correct, nickname, answer, autoPassed }) => {
  clearBuzzCountdown();
  showVotePanel(false);
  statusBanner.className = 'status-banner correct';
  if (correct) {
    statusBanner.textContent = `🎉 ${nickname}님 정답! ("${answer}")`;
  } else if (autoPassed) {
    statusBanner.textContent = `🙅 전원 오답/패스로 자동 패스! 정답: "${answer}"`;
  } else {
    statusBanner.textContent = `정답 공개: "${answer}"`;
  }
  buzzBtn.disabled = true;
  passBtn.disabled = true;
});

// ---------- 진행자 접속 여부 표시 ----------
socket.on('host:presence', ({ present }) => {
  isHostPresent = present;
  hostPresenceNote.textContent = present
    ? '진행자 화면이 연결되어 있습니다. (진행자가 판정합니다)'
    : '진행자 화면이 연결되어 있지 않습니다. (참가자 투표로 판정합니다)';
});

socket.on('scoreboard:update', (list) => {
  scoreboardEl.innerHTML = '';
  list.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === myId) li.style.outline = '2px solid var(--accent)';
    li.innerHTML = `<span><span class="rank">${i + 1}.</span> ${p.nickname}</span><span class="score">${p.score}점</span>`;
    scoreboardEl.appendChild(li);
  });
});

// 진행자가 추방하면 저장된 토큰/닉네임을 지우고 입장 화면으로 돌려보낸다.
// (토큰을 지우지 않으면 재연결 시 자동으로 같은 토큰으로 다시 입장해버려서
// 추방이 무의미해짐 — 대신 새 참가자로는 언제든 다시 입장할 수 있다.)
socket.on('player:kicked', () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NICK_KEY);
  kickedMessageEl.style.display = 'block';
  gameScreen.style.display = 'none';
  joinScreen.style.display = 'block';
  nicknameInput.value = '';
});

// ==================== 호스트리스 모드: 진행 설정 패널 ====================
// 진행자(host.html) 없이도 참가자 한 명이 자기 휴대폰에서 문제를 고르고 소리를
// 재생할 수 있게 해주는 패널이다. host.js의 진행 로직을 참가자 화면에 맞게
// 옮겨왔지만, host:hello는 보내지 않으므로 서버는 계속 "진행자 없음"으로 보고
// 판정은 그대로 참가자 투표로 이뤄진다.
const pDurationPickerEl = document.getElementById('p-duration-picker');
const pFilterYearButtonsEl = document.getElementById('p-filter-year-buttons');
const pFilterCategoryButtonsEl = document.getElementById('p-filter-category-buttons');
const pHideVideoCheckbox = document.getElementById('p-hide-video-checkbox');
const pYtPlayerContainerEl = document.getElementById('p-yt-player-container');
const pPlayStatusEl = document.getElementById('p-play-status');
const pRevealBtn = document.getElementById('p-reveal-btn');
const pResetBuzzBtn = document.getElementById('p-reset-buzz-btn');
const pQButtonsEl = document.getElementById('p-q-buttons');
const pQButtonsCountEl = document.getElementById('p-q-buttons-count');

let hostlessQuestions = [];
let hostlessQuestionsLoaded = false;
let pYtPlayer = null;
let pYtReady = false;
const prevOnYouTubeIframeAPIReady = window.onYouTubeIframeAPIReady;
window.onYouTubeIframeAPIReady = () => { pYtReady = true; if (prevOnYouTubeIframeAPIReady) prevOnYouTubeIframeAPIReady(); };

const P_DURATION_OPTIONS = [5, 10, 15, 30, 60];
let pSelectedDuration = 15;
let pPlayToken = 0;
let pSelectedYears = new Set();
let pSelectedCategories = new Set();

function speak(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  } catch (err) {
    // TTS 미지원 기기에서도 게임 진행에는 지장 없게 조용히 무시
  }
}

function renderDurationPicker() {
  pDurationPickerEl.innerHTML = '';
  P_DURATION_OPTIONS.forEach((sec) => {
    const btn = document.createElement('button');
    btn.textContent = sec < 60 ? `${sec}초` : '1분';
    if (sec === pSelectedDuration) btn.classList.add('btn-primary');
    btn.addEventListener('click', () => {
      pSelectedDuration = sec;
      renderDurationPicker();
    });
    pDurationPickerEl.appendChild(btn);
  });
}

const HIDE_VIDEO_STORAGE_KEY = 'quizHideVideo';
pHideVideoCheckbox.checked = localStorage.getItem(HIDE_VIDEO_STORAGE_KEY) === '1';

function applyHideVideoState() {
  pYtPlayerContainerEl.classList.toggle('screen-hidden', pHideVideoCheckbox.checked);
}

pHideVideoCheckbox.addEventListener('change', () => {
  localStorage.setItem(HIDE_VIDEO_STORAGE_KEY, pHideVideoCheckbox.checked ? '1' : '0');
  applyHideVideoState();
});

function renderFilterButtons() {
  const years = [...new Set(hostlessQuestions.map((q) => q.year).filter((y) => y !== null && y !== undefined))].sort((a, b) => a - b);
  const categories = [...new Set(hostlessQuestions.map((q) => q.category).filter((c) => c))].sort();

  const yearStrs = years.map(String);
  pSelectedYears.forEach((y) => { if (!yearStrs.includes(y)) pSelectedYears.delete(y); });
  pSelectedCategories.forEach((c) => { if (!categories.includes(c)) pSelectedCategories.delete(c); });

  function buildButtonRow(container, options, selectedSet, onChange) {
    container.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.textContent = '전체';
    if (selectedSet.size === 0) allBtn.classList.add('btn-primary');
    allBtn.addEventListener('click', () => { selectedSet.clear(); onChange(); });
    container.appendChild(allBtn);

    options.forEach((opt) => {
      const value = String(opt);
      const btn = document.createElement('button');
      btn.textContent = value;
      if (selectedSet.has(value)) btn.classList.add('btn-primary');
      btn.addEventListener('click', () => {
        if (selectedSet.has(value)) selectedSet.delete(value);
        else selectedSet.add(value);
        onChange();
      });
      container.appendChild(btn);
    });
  }

  const onChange = () => { renderFilterButtons(); renderQuestionButtons(); };
  buildButtonRow(pFilterYearButtonsEl, years, pSelectedYears, onChange);
  buildButtonRow(pFilterCategoryButtonsEl, categories, pSelectedCategories, onChange);
}

function renderQuestionButtons() {
  pQButtonsEl.innerHTML = '';
  let count = 0;
  hostlessQuestions.forEach((q, i) => {
    if (pSelectedYears.size > 0 && !pSelectedYears.has(String(q.year))) return;
    if (pSelectedCategories.size > 0 && !pSelectedCategories.has(q.category)) return;
    count++;
    const btn = document.createElement('button');
    btn.style.textAlign = 'left';
    btn.textContent = `${i + 1}. ${q.title}`;
    btn.addEventListener('click', () => startQuestionWithCountdown(i));
    pQButtonsEl.appendChild(btn);
  });
  pQButtonsCountEl.textContent = count;
}

function primeAudioUnlock(videoId) {
  const create = () => {
    if (pYtPlayer) {
      try {
        pYtPlayer.mute();
        pYtPlayer.loadVideoById(videoId);
      } catch (err) { /* 무시 */ }
    } else {
      pYtPlayer = new YT.Player('p-yt-player', {
        height: '270',
        width: '480',
        videoId,
        playerVars: { autoplay: 1 },
        events: { onReady: (e) => { e.target.mute(); } }
      });
    }
  };
  if (pYtReady && window.YT && window.YT.Player) create();
  else {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { pYtReady = true; create(); if (prev) prev(); };
  }
}

let pCountdownToken = 0;
function startQuestionWithCountdown(index) {
  const myToken = ++pCountdownToken;
  const q = hostlessQuestions[index];
  pYtPlayerContainerEl.classList.add('priming');
  if (q) primeAudioUnlock(q.videoId);
  let n = 3;
  pPlayStatusEl.textContent = q ? `곧 시작: ${index + 1}번 문제` : '문제 준비 중';
  const tick = () => {
    if (myToken !== pCountdownToken) return;
    if (n > 0) {
      pPlayStatusEl.textContent = `⏳ ${n}...`;
      speak(String(n));
      n--;
      setTimeout(tick, 1000);
    } else {
      pPlayStatusEl.textContent = '🎵 시작!';
      socket.emit('host:startQuestion', index);
    }
  };
  tick();
}

function waitForDuration(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const d = pYtPlayer && typeof pYtPlayer.getDuration === 'function' ? pYtPlayer.getDuration() : 0;
      if (d && d > 0) return resolve(d);
      if (Date.now() - startedAt > timeoutMs) return resolve(0);
      setTimeout(check, 150);
    };
    check();
  });
}

function playClip(videoId, start, end) {
  pYtPlayerContainerEl.classList.remove('priming');
  applyHideVideoState();
  pYtPlayer.unMute();
  pYtPlayer.loadVideoById({ videoId, startSeconds: start, endSeconds: end });
}

// 진행 설정 패널이 열려있을 때만 의미 있는 재생 로직이므로, 문제가 시작되면 이
// 패널의 플레이어로도 같은 구간을 재생한다 (패널을 연 사람의 폰이 스피커 역할).
socket.on('question:show', async ({ index, total, videoId, start, end }) => {
  const myToken = ++pPlayToken;
  const q = hostlessQuestions[index];
  if (!q) return;
  pPlayStatusEl.textContent = `${index + 1} / ${total} · 재생 구간 준비 중...`;

  if (!pYtPlayer) {
    await new Promise((resolve) => {
      const check = () => { if (pYtPlayer) resolve(); else setTimeout(check, 100); };
      check();
    });
  }
  const totalDuration = await waitForDuration();
  if (myToken !== pPlayToken) return;

  const minStart = start || 0;
  const hardEnd = totalDuration > 0
    ? (end !== null && end !== undefined ? Math.min(end, totalDuration) : totalDuration)
    : (end !== null && end !== undefined ? end : null);

  let randomStart = minStart;
  if (hardEnd !== null) {
    const maxStart = Math.max(minStart, hardEnd - pSelectedDuration - 2);
    randomStart = maxStart > minStart ? minStart + Math.random() * (maxStart - minStart) : minStart;
  }
  const clipEnd = randomStart + pSelectedDuration;

  pPlayStatusEl.textContent = `${index + 1} / ${total} · 재생 길이: ${pSelectedDuration < 60 ? pSelectedDuration + '초' : '1분'} (영상 중 무작위 구간)`;
  playClip(videoId, randomStart, clipEnd);
});

socket.on('buzz:locked', () => {
  if (pYtPlayer && typeof pYtPlayer.pauseVideo === 'function') pYtPlayer.pauseVideo();
});

pRevealBtn.addEventListener('click', () => socket.emit('host:reveal'));
pResetBuzzBtn.addEventListener('click', () => socket.emit('host:resetBuzz'));

let settingsPanelOpen = false;
settingsToggleBtn.addEventListener('click', () => {
  settingsPanelOpen = !settingsPanelOpen;
  settingsPanel.style.display = settingsPanelOpen ? 'block' : 'none';
  if (settingsPanelOpen && !hostlessQuestionsLoaded) {
    hostlessQuestionsLoaded = true;
    renderDurationPicker();
    applyHideVideoState();
    socket.emit('host:getQuestions');
  }
});

socket.on('host:questions', (data) => {
  hostlessQuestions = data;
  renderFilterButtons();
  renderQuestionButtons();
});
