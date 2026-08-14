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
const settingsToggleWrap = document.getElementById('settings-toggle-wrap');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsPanel = document.getElementById('settings-panel');
const myNameEditBtn = document.getElementById('my-name-edit-btn');
const hostJudgePanel = document.getElementById('host-judge-panel');
const pJudgeCorrectBtn = document.getElementById('p-judge-correct-btn');
const pJudgeWrongBtn = document.getElementById('p-judge-wrong-btn');
const eventBannerEl = document.getElementById('event-banner');

let myId = null;
let myNickname = '';
let iHavePassed = false; // 이번 문제를 이미 패스했는지 (다른 사람 오답으로 버튼이 다시 풀릴 때도 계속 비활성 유지)
let iHaveVoted = false; // 이번 부저에 대해 이미 투표했는지
let isHostPresent = false;
let appointedHostToken = null; // 진행자가 없을 때 참가자 중 진행자로 지정된 사람의 토큰
let currentBuzzLockedId = null; // 지금 부저를 누르고 판정을 기다리는 사람의 토큰 (없으면 null)
let currentQuestionEvent = null; // 이번 문제에 걸린 이벤트 (진행자 화면에서 설정, 없으면 null)

// ---------- 이벤트 표시/버저 자격 (진행자 화면에서 설정한 이벤트를 그대로 적용) ----------
function isEligibleForEvent(event) {
  if (!event) return true;
  if (event.type === 'duel') return event.duelTokens.includes(myId);
  if (event.type === 'lowestFirst') return event.eligibleTokens.includes(myId);
  return true;
}
function eventIneligibleMessage(event) {
  if (event.type === 'duel') return `⚔️ 이번 문제는 ${event.duelNicknames.join(' vs ')}의 1:1 대결입니다. 기다려주세요.`;
  if (event.type === 'lowestFirst') return `🎯 이번 문제는 최하위 참가자(${event.eligibleNicknames.join(', ')})만 버저를 누를 수 있습니다.`;
  return '';
}
function eventBannerText(event) {
  if (!event) return '';
  if (event.type === 'duel') return `⚔️ 1:1 대결! ${event.duelNicknames.join(' vs ')}`;
  if (event.type === 'multiplier') return `💰 점수 ${event.multiplier}배 문제!`;
  if (event.type === 'lowestFirst') return `🎯 최하위 먼저 풀기! (${event.eligibleNicknames.join(', ')})`;
  if (event.type === 'oneVsMany') return '👥 1:다수 — 틀리면 나머지 전원이 점수 획득!';
  return '';
}
function renderEventBanner(event) {
  const text = eventBannerText(event);
  eventBannerEl.textContent = text;
  eventBannerEl.style.display = text ? '' : 'none';
}

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
  myNickname = nickname;
  kickedMessageEl.style.display = 'none';
  myNameEl.textContent = `${nickname}님, 환영합니다!`;
  joinScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '문제를 기다리는 중...';
  buzzBtn.disabled = true; // 다음 문제가 시작되면 question:show에서 다시 활성화됨
  passBtn.disabled = true;
  updateHostAppointmentUI();
});

myNameEditBtn.addEventListener('click', () => {
  const newName = prompt('새 닉네임을 입력하세요', myNickname);
  if (newName && newName.trim()) {
    socket.emit('player:renameSelf', newName.trim());
  }
});

socket.on('player:renamed', ({ nickname }) => {
  myNickname = nickname;
  localStorage.setItem(NICK_KEY, nickname);
  myNameEl.textContent = `${nickname}님, 환영합니다!`;
});

socket.on('question:show', ({ event } = {}) => {
  clearBuzzCountdown();
  iHavePassed = false;
  currentBuzzLockedId = null;
  currentQuestionEvent = event || null;
  showVotePanel(false);
  updateJudgeButtonsState();
  renderEventBanner(currentQuestionEvent);
  statusBanner.className = 'status-banner';
  if (isEligibleForEvent(currentQuestionEvent)) {
    statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
    buzzBtn.disabled = false;
    passBtn.disabled = false;
  } else {
    statusBanner.textContent = eventIneligibleMessage(currentQuestionEvent);
    buzzBtn.disabled = true;
    passBtn.disabled = true;
  }
});

buzzBtn.addEventListener('click', () => {
  socket.emit('player:buzz');
  buzzBtn.disabled = true;
  passBtn.disabled = true;
  statusBanner.textContent = '🚨 버저를 눌렀습니다! 판정을 기다리세요...';
});

passBtn.addEventListener('click', () => {
  if (iHavePassed) return;
  if (!confirm('패스하시겠습니까? 이번 문제는 다시 도전할 수 없어요.')) return;
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
  currentBuzzLockedId = id;
  updateJudgeButtonsState();
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
  currentBuzzLockedId = null;
  updateJudgeButtonsState();
  statusBanner.className = 'status-banner';
  if (id === myId) {
    statusBanner.textContent = auto
      ? '⏰ 시간 초과로 자동 오답 처리되었습니다. 이번 문제는 다시 누를 수 없어요.'
      : '❌ 오답 처리되었습니다. 이번 문제는 다시 누를 수 없어요.';
    buzzBtn.disabled = true;
    passBtn.disabled = true;
  } else if (!iHavePassed && isEligibleForEvent(currentQuestionEvent)) {
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
  currentBuzzLockedId = null;
  updateJudgeButtonsState();
  statusBanner.className = 'status-banner';
  if (!iHavePassed && isEligibleForEvent(currentQuestionEvent)) {
    statusBanner.textContent = '🔔 소리를 듣고 정답이면 버저를 누르세요!';
    buzzBtn.disabled = false;
    passBtn.disabled = false;
  }
});

socket.on('question:result', ({ correct, nickname, answer, autoPassed, pointsAwarded, oneVsManyAwarded }) => {
  clearBuzzCountdown();
  showVotePanel(false);
  currentBuzzLockedId = null;
  updateJudgeButtonsState();
  statusBanner.className = 'status-banner correct';
  const pointsText = pointsAwarded !== undefined ? ` (+${pointsAwarded}점)` : '';
  if (correct) {
    statusBanner.textContent = `🎉 ${nickname}님 정답!${pointsText} ("${answer}")`;
  } else if (oneVsManyAwarded) {
    statusBanner.textContent = `👥 ${nickname}님 오답! 나머지 전원 +${pointsAwarded}점 — 정답: "${answer}"`;
  } else if (autoPassed) {
    statusBanner.textContent = `🙅 전원 오답/패스로 자동 패스! 정답: "${answer}"`;
  } else {
    statusBanner.textContent = `정답 공개: "${answer}"`;
  }
  buzzBtn.disabled = true;
  passBtn.disabled = true;
});

// ---------- 진행자 접속 여부 / 진행자 지정 표시 ----------
socket.on('host:presence', ({ present }) => {
  isHostPresent = present;
  hostPresenceNote.textContent = present
    ? '진행자 화면이 연결되어 있습니다. (진행자가 판정합니다)'
    : '진행자 화면이 연결되어 있지 않습니다. (참가자 투표로 판정합니다)';
  renderScoreboard(); // 진행자 지정 버튼 노출 여부가 바뀌므로 다시 그림
});

socket.on('host:appointed', ({ token }) => {
  appointedHostToken = token;
  updateHostAppointmentUI();
});

// 진행자 없이 진행할 때, 내가 진행자로 지정되면 ⚙️ 진행 설정 패널과 정답/오답
// 판정 버튼이 나에게만 보이도록 한다. 진행자 자격을 잃으면(다른 사람이 새로
// 지정되거나, 실제 진행자가 접속) 열려 있던 설정 패널도 함께 닫는다.
function updateHostAppointmentUI() {
  const iAmHost = myId !== null && appointedHostToken === myId;
  settingsToggleWrap.style.display = iAmHost ? '' : 'none';
  hostJudgePanel.style.display = iAmHost ? '' : 'none';
  if (!iAmHost && settingsPanelOpen) {
    settingsPanelOpen = false;
    settingsPanel.style.display = 'none';
  }
  updateJudgeButtonsState();
  renderScoreboard();
}

function updateJudgeButtonsState() {
  const canJudge = myId !== null && appointedHostToken === myId
    && currentBuzzLockedId !== null && currentBuzzLockedId !== myId;
  pJudgeCorrectBtn.disabled = !canJudge;
  pJudgeWrongBtn.disabled = !canJudge;
}

pJudgeCorrectBtn.addEventListener('click', () => socket.emit('host:judge', true));
pJudgeWrongBtn.addEventListener('click', () => socket.emit('host:judge', false));

let lastScoreboardList = [];

function renderScoreboard() {
  scoreboardEl.innerHTML = '';
  const iAmHost = myId !== null && appointedHostToken === myId;
  lastScoreboardList.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === myId) li.style.outline = '2px solid var(--accent)';
    li.style.flexWrap = 'wrap';

    const nameSpan = document.createElement('span');
    nameSpan.innerHTML = `<span class="rank">${i + 1}.</span> ${p.nickname}`;
    if (p.id === appointedHostToken) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'badge badge-host';
      hostBadge.textContent = '👑 진행자';
      nameSpan.appendChild(hostBadge);
    }
    li.appendChild(nameSpan);

    const right = document.createElement('div');
    right.className = 'sb-controls';

    // 실제 진행자가 없을 때만, 참가자 중 한 명을 진행자로 지정할 수 있다.
    if (!isHostPresent && p.id !== appointedHostToken) {
      const appointBtn = document.createElement('button');
      appointBtn.className = 'sb-btn';
      appointBtn.textContent = '👑 진행자 지정';
      appointBtn.addEventListener('click', () => socket.emit('player:appointHost', p.id));
      right.appendChild(appointBtn);
    }

    if (iAmHost) {
      // 내가 진행자로 지정된 참가자라면, 진행자 화면과 동일하게 점수 조정/이름수정/추방 기능을 쓸 수 있다.
      const minusBtn = document.createElement('button');
      minusBtn.className = 'sb-btn';
      minusBtn.textContent = '−';
      minusBtn.addEventListener('click', () => socket.emit('host:adjustScore', { token: p.id, delta: -1 }));
      right.appendChild(minusBtn);

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `${p.score}점`;
      right.appendChild(scoreSpan);

      const plusBtn = document.createElement('button');
      plusBtn.className = 'sb-btn';
      plusBtn.textContent = '+';
      plusBtn.addEventListener('click', () => socket.emit('host:adjustScore', { token: p.id, delta: 1 }));
      right.appendChild(plusBtn);

      const resetBtn = document.createElement('button');
      resetBtn.className = 'sb-btn';
      resetBtn.textContent = '초기화';
      resetBtn.addEventListener('click', () => socket.emit('host:resetPlayerScore', p.id));
      right.appendChild(resetBtn);

      const renameBtn = document.createElement('button');
      renameBtn.className = 'sb-btn';
      renameBtn.textContent = '✏️ 이름수정';
      renameBtn.addEventListener('click', () => {
        const newName = prompt('새 닉네임을 입력하세요', p.nickname);
        if (newName && newName.trim()) {
          socket.emit('host:renamePlayer', { token: p.id, nickname: newName.trim() });
        }
      });
      right.appendChild(renameBtn);

      const kickBtn = document.createElement('button');
      kickBtn.className = 'sb-btn sb-kick';
      kickBtn.textContent = '추방';
      kickBtn.addEventListener('click', () => {
        if (confirm(`${p.nickname}님을 게임에서 추방할까요? (다시 입장은 가능합니다)`)) {
          socket.emit('host:kickPlayer', p.id);
        }
      });
      right.appendChild(kickBtn);
    } else {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score';
      scoreSpan.textContent = `${p.score}점`;
      right.appendChild(scoreSpan);
    }

    li.appendChild(right);
    scoreboardEl.appendChild(li);
  });
}

socket.on('scoreboard:update', (list) => {
  lastScoreboardList = list;
  renderScoreboard();
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
const pFilterToggleBtn = document.getElementById('p-filter-toggle-btn');
const pFilterSettingsPanel = document.getElementById('p-filter-settings-panel');
const pQListToggleBtn = document.getElementById('p-q-list-toggle-btn');
const pQListPanel = document.getElementById('p-q-list-panel');
const pDurationPickerEl = document.getElementById('p-duration-picker');
const pFilterYearButtonsEl = document.getElementById('p-filter-year-buttons');
const pFilterCategoryButtonsEl = document.getElementById('p-filter-category-buttons');
const pHideVideoCheckbox = document.getElementById('p-hide-video-checkbox');
const pYtPlayerContainerEl = document.getElementById('p-yt-player-container');
const pPlayStatusEl = document.getElementById('p-play-status');
const pAnswerDisplayEl = document.getElementById('p-answer-display');
const pRevealBtn = document.getElementById('p-reveal-btn');
const pResetBuzzBtn = document.getElementById('p-reset-buzz-btn');
const pQButtonsEl = document.getElementById('p-q-buttons');
const pQButtonsCountEl = document.getElementById('p-q-buttons-count');

pFilterToggleBtn.addEventListener('click', () => {
  if (pFilterSettingsPanel.hasAttribute('hidden')) pFilterSettingsPanel.removeAttribute('hidden');
  else pFilterSettingsPanel.setAttribute('hidden', '');
});
pQListToggleBtn.addEventListener('click', () => {
  if (pQListPanel.hasAttribute('hidden')) pQListPanel.removeAttribute('hidden');
  else pQListPanel.setAttribute('hidden', '');
});

// ---------- 정답 표시 (스포일러 방지 — 클릭해야 보임, 진행자 화면과 동일) ----------
let pCurrentAnswerText = '';
let pAnswerRevealed = false;
function renderPAnswerDisplay() {
  if (!pCurrentAnswerText) { pAnswerDisplayEl.textContent = ''; return; }
  pAnswerDisplayEl.textContent = pAnswerRevealed ? `정답: ${pCurrentAnswerText}` : '🙈 정답 보기 (눌러서 확인)';
}
function setPCurrentAnswer(title) {
  pCurrentAnswerText = title || '';
  pAnswerRevealed = false;
  renderPAnswerDisplay();
}
pAnswerDisplayEl.addEventListener('click', () => {
  if (!pCurrentAnswerText) return;
  pAnswerRevealed = !pAnswerRevealed;
  renderPAnswerDisplay();
});

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

function currentFilteredIndicesP() {
  const indices = [];
  hostlessQuestions.forEach((q, i) => {
    if (pSelectedYears.size > 0 && !pSelectedYears.has(String(q.year))) return;
    if (pSelectedCategories.size > 0 && !pSelectedCategories.has(q.category)) return;
    indices.push(i);
  });
  return indices;
}

function renderQuestionButtons() {
  pQButtonsEl.innerHTML = '';
  const filtered = new Set(currentFilteredIndicesP());
  let count = 0;
  hostlessQuestions.forEach((q, i) => {
    if (!filtered.has(i)) return;
    count++;
    const btn = document.createElement('button');
    btn.style.textAlign = 'left';
    btn.textContent = `${i + 1}. ${q.title}`;
    btn.addEventListener('click', () => {
      if (pAutoRunning) stopPAuto(); // 자동 진행 중 수동으로 다른 문제를 고르면 자동 모드는 중지
      startQuestionWithCountdown(i);
    });
    pQButtonsEl.appendChild(btn);
  });
  pQButtonsCountEl.textContent = count;
}

// ---------- 자동 출제 (진행자 화면과 동일한 기능을 참가자 진행 설정에도 이식) ----------
const pAutoCountInput = document.getElementById('p-auto-count');
const pAutoGapInput = document.getElementById('p-auto-gap');
const pAutoStartBtn = document.getElementById('p-auto-start-btn');
const pAutoStopBtn = document.getElementById('p-auto-stop-btn');
const pAutoStatusEl = document.getElementById('p-auto-status');

let pAutoRunning = false;
let pAutoTotal = 0;
let pAutoPlayedCount = 0;
let pAutoPlayedIndices = new Set();

function getPAutoGapMs() {
  let gap = parseFloat(pAutoGapInput.value);
  if (isNaN(gap) || gap < 0) gap = 0;
  return gap * 1000;
}

function stopPAuto(message) {
  pAutoRunning = false;
  pAutoTotal = 0;
  pAutoPlayedCount = 0;
  pAutoPlayedIndices = new Set();
  pAutoStartBtn.style.display = '';
  pAutoStopBtn.style.display = 'none';
  pAutoStatusEl.textContent = message || '';
}

function pickNextPAutoIndex() {
  const pool = currentFilteredIndicesP().filter((i) => !pAutoPlayedIndices.has(i));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function playNextPAutoQuestion() {
  const nextIndex = pickNextPAutoIndex();
  if (nextIndex === null) {
    stopPAuto(`✅ 자동 출제 종료 (총 ${pAutoPlayedCount}문제 진행, 조건에 맞는 남은 문제 없음)`);
    return;
  }
  pAutoPlayedIndices.add(nextIndex);
  pAutoPlayedCount++;
  pAutoStatusEl.textContent = `자동 출제 진행 중 (${pAutoPlayedCount}/${pAutoTotal})`;
  startQuestionWithCountdown(nextIndex);
}

document.querySelectorAll('.p-auto-count-preset').forEach((btn) => {
  btn.addEventListener('click', () => { pAutoCountInput.value = btn.dataset.count; });
});
document.querySelectorAll('.p-auto-gap-preset').forEach((btn) => {
  btn.addEventListener('click', () => { pAutoGapInput.value = btn.dataset.gap; });
});

pAutoStartBtn.addEventListener('click', () => {
  const pool = currentFilteredIndicesP();
  if (!pool.length) {
    pAutoStatusEl.textContent = '조건에 맞는 문제가 없습니다. 필터를 확인하세요.';
    return;
  }
  let count = parseInt(pAutoCountInput.value, 10);
  if (!count || count < 1) count = 1;
  if (count > pool.length) count = pool.length;
  pAutoCountInput.value = count;

  pAutoTotal = count;
  pAutoPlayedCount = 0;
  pAutoPlayedIndices = new Set();
  pAutoRunning = true;
  pAutoStartBtn.style.display = 'none';
  pAutoStopBtn.style.display = '';
  playNextPAutoQuestion();
});

pAutoStopBtn.addEventListener('click', () => stopPAuto());

// 문제 결과가 나오면(정답/오답 판정이든, 진행자 없이 전원 패스로 자동 공개든) 자동
// 출제 중이었다면 대기시간 후 다음 문제로 넘어간다.
socket.on('question:result', () => {
  if (!pAutoRunning) return;
  if (pAutoPlayedCount < pAutoTotal) {
    setTimeout(() => {
      if (pAutoRunning) playNextPAutoQuestion();
    }, getPAutoGapMs());
  } else {
    stopPAuto(`✅ 자동 출제 완료! (총 ${pAutoPlayedCount}문제)`);
  }
});

// ---------- 점수 설정 (진행자 화면과 동일한 기능) ----------
const pCorrectPointsInput = document.getElementById('p-correct-points-input');
const pCorrectPointsMinus = document.getElementById('p-correct-points-minus');
const pCorrectPointsPlus = document.getElementById('p-correct-points-plus');
const pWrongPointsInput = document.getElementById('p-wrong-points-input');
const pWrongPointsMinus = document.getElementById('p-wrong-points-minus');
const pWrongPointsPlus = document.getElementById('p-wrong-points-plus');

function emitPScoreSettings() {
  socket.emit('host:setScoreSettings', {
    correctPoints: Number(pCorrectPointsInput.value) || 0,
    wrongPoints: Number(pWrongPointsInput.value) || 0
  });
}
pCorrectPointsMinus.addEventListener('click', () => { pCorrectPointsInput.value = (Number(pCorrectPointsInput.value) || 0) - 1; emitPScoreSettings(); });
pCorrectPointsPlus.addEventListener('click', () => { pCorrectPointsInput.value = (Number(pCorrectPointsInput.value) || 0) + 1; emitPScoreSettings(); });
pWrongPointsMinus.addEventListener('click', () => { pWrongPointsInput.value = (Number(pWrongPointsInput.value) || 0) - 1; emitPScoreSettings(); });
pWrongPointsPlus.addEventListener('click', () => { pWrongPointsInput.value = (Number(pWrongPointsInput.value) || 0) + 1; emitPScoreSettings(); });
pCorrectPointsInput.addEventListener('change', emitPScoreSettings);
pWrongPointsInput.addEventListener('change', emitPScoreSettings);

socket.on('score:settings', ({ correctPoints, wrongPoints }) => {
  pCorrectPointsInput.value = correctPoints;
  pWrongPointsInput.value = wrongPoints;
});

// ---------- 이벤트 설정 (진행자 화면과 동일한 기능) ----------
const pEventsEnabledCheckbox = document.getElementById('p-events-enabled-checkbox');
const pEventSettingsPanelEl = document.getElementById('p-event-settings-panel');

const P_EVENT_TYPES = [
  { id: 'duel', name: '⚔️ 1:1 대결', desc: '참가자 두 명만 골라 그 둘만 버저를 누를 수 있음' },
  { id: 'multiplier', name: '💰 점수 2배~5배', desc: '이번 문제는 정답 점수가 무작위로 2~5배' },
  { id: 'lowestFirst', name: '🎯 최하위 먼저 풀기', desc: '지금 점수가 가장 낮은 사람(들)만 버저를 누를 수 있음' },
  { id: 'oneVsMany', name: '👥 1:다수', desc: '먼저 버저 누른 사람이 정답이면 그 사람만, 틀리면 나머지 전원이 점수 획득' }
];

let pEventConfigs = {};
P_EVENT_TYPES.forEach((e) => { pEventConfigs[e.id] = { enabled: false, mode: 'manual', rate: 10 }; });

function emitPEventConfig() {
  socket.emit('host:setEventConfig', { enabled: pEventsEnabledCheckbox.checked, events: pEventConfigs });
}

function renderPEventSettingsPanel() {
  pEventSettingsPanelEl.innerHTML = '';
  P_EVENT_TYPES.forEach(({ id, name, desc }) => {
    const cfg = pEventConfigs[id];
    const row = document.createElement('div');
    row.className = 'panel';
    row.style.cssText = 'background:var(--panel-2); margin-bottom:10px; padding:14px;';

    const header = document.createElement('label');
    header.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:4px;';
    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.style.width = 'auto';
    enabledCheckbox.checked = cfg.enabled;
    enabledCheckbox.addEventListener('change', () => { cfg.enabled = enabledCheckbox.checked; emitPEventConfig(); });
    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '700';
    nameSpan.textContent = name;
    header.appendChild(enabledCheckbox);
    header.appendChild(nameSpan);
    row.appendChild(header);

    const descP = document.createElement('p');
    descP.className = 'muted';
    descP.style.cssText = 'margin:0 0 8px; font-size:.85rem;';
    descP.textContent = desc;
    row.appendChild(descP);

    const modeRow = document.createElement('div');
    modeRow.className = 'row';
    const manualBtn = document.createElement('button');
    manualBtn.type = 'button';
    manualBtn.textContent = '수동';
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.textContent = '자동';
    function refreshModeButtons() {
      manualBtn.classList.toggle('btn-primary', cfg.mode === 'manual');
      autoBtn.classList.toggle('btn-primary', cfg.mode === 'auto');
      rateWrap.style.display = cfg.mode === 'auto' ? '' : 'none';
      triggerBtn.style.display = cfg.mode === 'manual' ? '' : 'none';
    }
    manualBtn.addEventListener('click', () => { cfg.mode = 'manual'; refreshModeButtons(); emitPEventConfig(); });
    autoBtn.addEventListener('click', () => { cfg.mode = 'auto'; refreshModeButtons(); emitPEventConfig(); });
    modeRow.appendChild(manualBtn);
    modeRow.appendChild(autoBtn);
    row.appendChild(modeRow);

    const rateWrap = document.createElement('div');
    rateWrap.style.marginTop = '8px';
    const rateLabel = document.createElement('label');
    rateLabel.style.marginTop = '0';
    rateLabel.textContent = '발생 확률(%) — 예: 10%면 30문제 중 약 3번';
    const rateInput = document.createElement('input');
    rateInput.type = 'number';
    rateInput.min = '1';
    rateInput.max = '100';
    rateInput.value = cfg.rate;
    rateInput.addEventListener('change', () => { cfg.rate = Number(rateInput.value) || 10; emitPEventConfig(); });
    rateWrap.appendChild(rateLabel);
    rateWrap.appendChild(rateInput);
    row.appendChild(rateWrap);

    const triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.className = 'btn-primary';
    triggerBtn.style.marginTop = '8px';
    triggerBtn.textContent = '▶ 다음 문제에 발동';
    triggerBtn.addEventListener('click', () => {
      socket.emit('host:triggerEventNextQuestion', id);
      triggerBtn.textContent = '✅ 다음 문제에 예약됨';
      setTimeout(() => { triggerBtn.textContent = '▶ 다음 문제에 발동'; }, 2000);
    });
    row.appendChild(triggerBtn);

    refreshModeButtons();
    pEventSettingsPanelEl.appendChild(row);
  });
}
renderPEventSettingsPanel();

pEventsEnabledCheckbox.addEventListener('change', () => {
  pEventSettingsPanelEl.style.display = pEventsEnabledCheckbox.checked ? '' : 'none';
  emitPEventConfig();
});

socket.on('event:settings', ({ enabled, events }) => {
  pEventsEnabledCheckbox.checked = !!enabled;
  pEventSettingsPanelEl.style.display = enabled ? '' : 'none';
  if (events) {
    P_EVENT_TYPES.forEach(({ id }) => {
      if (events[id]) pEventConfigs[id] = { ...events[id] };
    });
  }
  renderPEventSettingsPanel();
});

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
  setPCurrentAnswer(q ? q.title : '');
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
