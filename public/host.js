const socket = io();
socket.emit('host:hello'); // 이 화면이 "진행자"로 접속했음을 서버에 알려, 참가자 투표 판정 대신 진행자 판정을 사용하게 함
socket.on('connect', () => socket.emit('host:hello')); // 재연결 시에도 다시 알림

const joinInfo = document.getElementById('join-info');
const setupScreen = document.getElementById('setup-screen');
const playScreen = document.getElementById('play-screen');
const gotoManualPlayBtn = document.getElementById('goto-manual-play-btn');
const backToSetupBtn = document.getElementById('back-to-setup-btn');
const answerDisplayEl = document.getElementById('answer-display');
const qTitleEl = document.getElementById('q-title');
const qTitleEditBtn = document.getElementById('q-title-edit-btn');
const qProgressEl = document.getElementById('q-progress');
const qButtonsEl = document.getElementById('q-buttons');
const qButtonsCountEl = document.getElementById('q-buttons-count');
const qListToggleBtn = document.getElementById('q-list-toggle-btn');
const qListPanel = document.getElementById('q-list-panel');
const filterYearButtonsEl = document.getElementById('filter-year-buttons');
const filterCategoryButtonsEl = document.getElementById('filter-category-buttons');
const durationPickerEl = document.getElementById('duration-picker');
const ytPlayerContainerEl = document.getElementById('yt-player-container');
const hideVideoCheckbox = document.getElementById('hide-video-checkbox');
const pauseBtn = document.getElementById('pause-btn');
const modeManualBtn = document.getElementById('mode-manual-btn');
const modeAutoBtn = document.getElementById('mode-auto-btn');
const autoSettingsEl = document.getElementById('auto-settings');
const autoCountInput = document.getElementById('auto-count');
const autoGapInput = document.getElementById('auto-gap');
const autoStartBtn = document.getElementById('auto-start-btn');
const autoStopBtn = document.getElementById('auto-stop-btn');
const autoStatusEl = document.getElementById('auto-status');
const statusBanner = document.getElementById('status-banner');
const judgeCorrectBtn = document.getElementById('judge-correct');
const judgeWrongBtn = document.getElementById('judge-wrong');
const revealBtn = document.getElementById('reveal-btn');
const resetBuzzBtn = document.getElementById('reset-buzz-btn');
const scoreboardEl = document.getElementById('scoreboard');
const editModalOverlay = document.getElementById('edit-modal-overlay');
const editModalTitle = document.getElementById('edit-modal-title');
const editQTitle = document.getElementById('edit-q-title');
const editQCategory = document.getElementById('edit-q-category');
const editQYear = document.getElementById('edit-q-year');
const editQUrl = document.getElementById('edit-q-url');
const editQStart = document.getElementById('edit-q-start');
const editQEnd = document.getElementById('edit-q-end');
const editQNote = document.getElementById('edit-q-note');
const editQMsg = document.getElementById('edit-q-msg');
const editSaveBtn = document.getElementById('edit-save-btn');
const editCancelBtn = document.getElementById('edit-cancel-btn');
const correctPointsInput = document.getElementById('correct-points-input');
const correctPointsMinus = document.getElementById('correct-points-minus');
const correctPointsPlus = document.getElementById('correct-points-plus');
const wrongPointsInput = document.getElementById('wrong-points-input');
const wrongPointsMinus = document.getElementById('wrong-points-minus');
const wrongPointsPlus = document.getElementById('wrong-points-plus');
const eventsEnabledCheckbox = document.getElementById('events-enabled-checkbox');
const eventTriggerRateWrapEl = document.getElementById('event-trigger-rate-wrap');
const eventTriggerRateInput = document.getElementById('event-trigger-rate-input');
const eventSettingsPanelEl = document.getElementById('event-settings-panel');
const eventBannerEl = document.getElementById('event-banner');

// ---------- 설정 화면 / 진행 화면 전환 ----------
// 출제 방식·재생 길이·필터를 고르는 "설정 화면"과, 실제로 문제를 재생하고
// 판정하는 "진행 화면"을 분리한다. 자동 출제를 시작하거나 수동 출제 화면으로
// 넘어가면 진행 화면으로 전환되고, 언제든 "⚙️ 출제 설정" 버튼으로 되돌아가
// 필터/재생길이를 바꿀 수 있다(진행 중이던 게임 상태 자체는 그대로 유지됨).
function showPlayScreen() {
  setupScreen.style.display = 'none';
  playScreen.style.display = '';
}
function showSetupScreen() {
  playScreen.style.display = 'none';
  setupScreen.style.display = '';
}
gotoManualPlayBtn.addEventListener('click', showPlayScreen);
backToSetupBtn.addEventListener('click', showSetupScreen);

// ---------- 점수 설정 (정답/오답 시 점수 변화량) ----------
function emitScoreSettings() {
  socket.emit('host:setScoreSettings', {
    correctPoints: Number(correctPointsInput.value) || 0,
    wrongPoints: Number(wrongPointsInput.value) || 0
  });
}
correctPointsMinus.addEventListener('click', () => { correctPointsInput.value = (Number(correctPointsInput.value) || 0) - 1; emitScoreSettings(); });
correctPointsPlus.addEventListener('click', () => { correctPointsInput.value = (Number(correctPointsInput.value) || 0) + 1; emitScoreSettings(); });
wrongPointsMinus.addEventListener('click', () => { wrongPointsInput.value = (Number(wrongPointsInput.value) || 0) - 1; emitScoreSettings(); });
wrongPointsPlus.addEventListener('click', () => { wrongPointsInput.value = (Number(wrongPointsInput.value) || 0) + 1; emitScoreSettings(); });
correctPointsInput.addEventListener('change', emitScoreSettings);
wrongPointsInput.addEventListener('change', emitScoreSettings);

socket.on('score:settings', ({ correctPoints, wrongPoints }) => {
  correctPointsInput.value = correctPoints;
  wrongPointsInput.value = wrongPoints;
});

// ---------- 이벤트 설정 (문제마다 특별 규칙을 무작위/수동으로 발동) ----------
const EVENT_TYPES = [
  { id: 'duel', name: '⚔️ 1:1 대결', desc: '참가자 두 명만 골라 그 둘만 버저를 누를 수 있음' },
  { id: 'multiplier', name: '💰 점수 2배~5배', desc: '이번 문제는 정답 점수가 무작위로 2~5배' },
  { id: 'lowestFirst', name: '🎯 최하위 먼저 풀기', desc: '지금 점수가 가장 낮은 사람(들)만 버저를 누를 수 있음' },
  { id: 'oneVsMany', name: '👥 1:다수', desc: '먼저 버저 누른 사람이 정답이면 그 사람만, 틀리면 나머지 전원이 점수 획득' }
];

let eventConfigs = {};
EVENT_TYPES.forEach((e) => { eventConfigs[e.id] = { enabled: true, weight: 25 }; });
let eventTriggerRate = 20; // 전체 발동 확률(%) — 매 문제마다 이벤트가 발동될지를 이 확률로 결정

function emitEventConfig() {
  socket.emit('host:setEventConfig', {
    enabled: eventsEnabledCheckbox.checked,
    triggerRate: eventTriggerRate,
    events: eventConfigs
  });
}

function renderEventSettingsPanel() {
  eventSettingsPanelEl.innerHTML = '';
  EVENT_TYPES.forEach(({ id, name, desc }) => {
    const cfg = eventConfigs[id];
    const row = document.createElement('div');
    row.className = 'panel';
    row.style.cssText = 'background:var(--panel-2); margin-bottom:10px; padding:14px;';

    const header = document.createElement('label');
    header.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:4px;';
    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.style.width = 'auto';
    enabledCheckbox.checked = cfg.enabled;
    enabledCheckbox.addEventListener('change', () => { cfg.enabled = enabledCheckbox.checked; emitEventConfig(); });
    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '700';
    nameSpan.textContent = name + ' (사용)';
    header.appendChild(enabledCheckbox);
    header.appendChild(nameSpan);
    row.appendChild(header);

    const descP = document.createElement('p');
    descP.className = 'muted';
    descP.style.cssText = 'margin:0 0 8px; font-size:.85rem;';
    descP.textContent = desc;
    row.appendChild(descP);

    const weightWrap = document.createElement('div');
    weightWrap.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';
    const weightLabel = document.createElement('label');
    weightLabel.style.cssText = 'margin:0; white-space:nowrap;';
    weightLabel.textContent = '개별 확률(%) — 이벤트 발동 시 이 이벤트가 뽑힐 확률';
    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.min = '0';
    weightInput.max = '100';
    weightInput.value = cfg.weight;
    weightInput.style.width = '80px';
    weightInput.style.textAlign = 'center';
    weightInput.addEventListener('change', () => { cfg.weight = Number(weightInput.value) || 0; emitEventConfig(); });
    weightWrap.appendChild(weightLabel);
    weightWrap.appendChild(weightInput);
    row.appendChild(weightWrap);

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

    eventSettingsPanelEl.appendChild(row);
  });
}
renderEventSettingsPanel();

eventsEnabledCheckbox.addEventListener('change', () => {
  const on = eventsEnabledCheckbox.checked;
  eventTriggerRateWrapEl.style.display = on ? 'flex' : 'none';
  eventSettingsPanelEl.style.display = on ? '' : 'none';
  emitEventConfig();
});

eventTriggerRateInput.addEventListener('change', () => {
  eventTriggerRate = Number(eventTriggerRateInput.value) || 20;
  emitEventConfig();
});

socket.on('event:settings', ({ enabled, triggerRate, events }) => {
  eventsEnabledCheckbox.checked = !!enabled;
  eventTriggerRateWrapEl.style.display = enabled ? 'flex' : 'none';
  eventSettingsPanelEl.style.display = enabled ? '' : 'none';
  if (triggerRate !== undefined) {
    eventTriggerRate = triggerRate;
    eventTriggerRateInput.value = triggerRate;
  }
  if (events) {
    EVENT_TYPES.forEach(({ id }) => {
      if (events[id]) eventConfigs[id] = { ...events[id] };
    });
  }
  renderEventSettingsPanel();
});

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

// ---------- 정답 표시 (스포일러 방지 — 클릭해야 보임) ----------
// 참가자 화면이 옆에 보이거나 실수로 눈에 들어오는 상황을 막기 위해, 정답은
// 새 문제가 시작될 때마다 다시 가려두고 진행자가 직접 눌러야만 보이게 한다.
let currentAnswerText = '';
let answerRevealed = false;
answerDisplayEl.style.cursor = 'pointer';
answerDisplayEl.title = '눌러서 정답 보기/숨기기';

function renderAnswerDisplay() {
  if (!currentAnswerText) { answerDisplayEl.textContent = ''; return; }
  answerDisplayEl.textContent = answerRevealed ? `정답: ${currentAnswerText}` : '🙈 정답 보기 (눌러서 확인)';
}

function setCurrentAnswer(title) {
  currentAnswerText = title || '';
  answerRevealed = false;
  renderAnswerDisplay();
}

answerDisplayEl.addEventListener('click', () => {
  if (!currentAnswerText) return;
  answerRevealed = !answerRevealed;
  renderAnswerDisplay();
});

let questions = [];
let ytPlayer = null;
let ytReady = false;
window.onYouTubeIframeAPIReady = () => { ytReady = true; };

// ---------- 재생 일시정지/재개 ----------
let isPaused = false;
function setPausedUiState(paused) {
  isPaused = paused;
  pauseBtn.textContent = paused ? '▶️ 재생' : '⏸️ 일시정지';
}
pauseBtn.addEventListener('click', () => {
  if (!ytPlayer) return;
  if (isPaused) {
    ytPlayer.playVideo();
    setPausedUiState(false);
  } else {
    ytPlayer.pauseVideo();
    setPausedUiState(true);
  }
});

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

// ---------- 화면 가리기 (소리만 들려주고 영상은 숨김) ----------
// 체크 상태를 기억해뒀다가(다음에 켤 때도 유지) 재생 중인 영상에도 바로 적용한다.
const HIDE_VIDEO_STORAGE_KEY = 'quizHideVideo';
hideVideoCheckbox.checked = localStorage.getItem(HIDE_VIDEO_STORAGE_KEY) === '1';

function applyHideVideoState() {
  ytPlayerContainerEl.classList.toggle('screen-hidden', hideVideoCheckbox.checked);
}
applyHideVideoState();

hideVideoCheckbox.addEventListener('change', () => {
  localStorage.setItem(HIDE_VIDEO_STORAGE_KEY, hideVideoCheckbox.checked ? '1' : '0');
  applyHideVideoState();
});

// ---------- 출제 방식 (수동/자동) ----------
let mode = 'manual';
let autoRunning = false;
let autoTotal = 0; // 자동 출제로 진행하기로 한 전체 문제 수
let autoPlayedCount = 0; // 지금까지 진행된 문제 수
let autoPlayedIndices = new Set(); // 이번 자동 출제 세션에서 이미 나온 문제(중복 방지)

// ---------- 연도/카테고리 버튼 필터 (비어있으면 전체) ----------
// 여러 개를 동시에 선택할 수 있도록 Set으로 관리한다 (예: 2005년 + 2006년 동시 선택).
let selectedYears = new Set();
let selectedCategories = new Set();

function setMode(newMode) {
  mode = newMode;
  modeManualBtn.classList.toggle('btn-primary', mode === 'manual');
  modeAutoBtn.classList.toggle('btn-primary', mode === 'auto');
  autoSettingsEl.style.display = mode === 'auto' ? '' : 'none';
  if (mode === 'manual') stopAuto();
}
modeManualBtn.addEventListener('click', () => setMode('manual'));
modeAutoBtn.addEventListener('click', () => setMode('auto'));
setMode('manual');

function currentFilteredIndices() {
  const indices = [];
  questions.forEach((q, i) => {
    if (selectedYears.size > 0 && !selectedYears.has(String(q.year))) return;
    if (selectedCategories.size > 0 && !selectedCategories.has(q.category)) return;
    indices.push(i);
  });
  return indices;
}

// 전체 문제 보관함(318개 등)에서의 원래 순번 대신, "지금 진행 중인 세트" 안에서
// 몇 번째 문제인지를 보여준다(예: "1 / 30"). 자동 출제 중이면 그 세트의
// 진행 수/전체 수를 그대로 쓰고, 수동 출제라면 현재 선택된 연도/카테고리 필터
// 안에서의 순번을 사용한다(필터가 없으면 전체 문제 수가 곧 분모가 됨).
function questionPositionLabel(index) {
  if (mode === 'auto' && autoRunning) return `${autoPlayedCount} / ${autoTotal}`;
  const filtered = currentFilteredIndices();
  const pos = filtered.indexOf(index);
  if (pos === -1) return `${index + 1} / ${questions.length}`;
  return `${pos + 1} / ${filtered.length}`;
}

qListToggleBtn.addEventListener('click', () => {
  if (qListPanel.hasAttribute('hidden')) qListPanel.removeAttribute('hidden');
  else qListPanel.setAttribute('hidden', '');
});

function getAutoGapMs() {
  let gap = parseFloat(autoGapInput.value);
  if (isNaN(gap) || gap < 0) gap = 0;
  return gap * 1000;
}

function stopAuto(message) {
  autoRunning = false;
  autoTotal = 0;
  autoPlayedCount = 0;
  autoPlayedIndices = new Set();
  autoStartBtn.style.display = '';
  autoStopBtn.style.display = 'none';
  autoStatusEl.textContent = message || '';
}

// 자동 출제 중 다음 문제를 고를 때마다 "그 순간"의 연도/카테고리 필터를 다시
// 적용한다. 이렇게 하면 진행 도중 필터 버튼을 바꿔도 다음 문제부터 바로 반영된다.
function pickNextAutoIndex() {
  const pool = currentFilteredIndices().filter((i) => !autoPlayedIndices.has(i));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function playNextAutoQuestion() {
  const nextIndex = pickNextAutoIndex();
  if (nextIndex === null) {
    stopAuto(`✅ 자동 출제 종료 (총 ${autoPlayedCount}문제 진행, 조건에 맞는 남은 문제 없음)`);
    return;
  }
  autoPlayedIndices.add(nextIndex);
  autoPlayedCount++;
  autoStatusEl.textContent = `자동 출제 진행 중 (${autoPlayedCount}/${autoTotal})`;
  startQuestionWithCountdown(nextIndex);
}

document.querySelectorAll('.auto-count-preset').forEach((btn) => {
  btn.addEventListener('click', () => { autoCountInput.value = btn.dataset.count; });
});

document.querySelectorAll('.auto-gap-preset').forEach((btn) => {
  btn.addEventListener('click', () => { autoGapInput.value = btn.dataset.gap; });
});

autoStartBtn.addEventListener('click', () => {
  const pool = currentFilteredIndices();
  if (!pool.length) {
    autoStatusEl.textContent = '조건에 맞는 문제가 없습니다. 필터를 확인하세요.';
    return;
  }
  let count = parseInt(autoCountInput.value, 10);
  if (!count || count < 1) count = 1;
  if (count > pool.length) count = pool.length;
  autoCountInput.value = count;

  autoTotal = count;
  autoPlayedCount = 0;
  autoPlayedIndices = new Set();
  autoRunning = true;
  autoStartBtn.style.display = 'none';
  autoStopBtn.style.display = '';
  showPlayScreen();
  playNextAutoQuestion();
});

autoStopBtn.addEventListener('click', () => stopAuto());

// 카운트다운 중에는 화면에 보이지 않게 가려둔 채로(.priming, 음소거) 미리 재생을
// 계속 걸어둔다. 이렇게 하면 사용자의 클릭(제스처) 직후에 자동재생 허용을
// "확보"해두는 동시에, 영상의 실제 길이(duration)를 알아낼 시간도 충분히 벌 수
// 있다. 몇 초 뒤 실제로 소리를 트는 시점에는 이미 재생 중이던 플레이어를
// unMute()만 하면 되므로 브라우저의 자동재생 차단을 피할 수 있다 (음소거 재생은
// 항상 허용되고, 이미 재생 중인 미디어의 음소거 해제는 새로운 사용자 제스처 없이도
// 대부분의 브라우저에서 허용됨). 화면은 CSS로 가려두므로(.priming) 실제로 재생 중
// 이어도 보이지 않는다.
// (예전에는 여기서 재생 직후 곧바로 pauseVideo()를 걸었었는데, duration 정보가
// 다 로딩되기 전에 멈춰버려서 무작위 구간 계산이 실패하고(항상 0으로 폴백) 영상이
// 늘 맨 처음부터 재생되는 문제가 있었다. 화면 가림은 이미 CSS가 처리해주므로
// 굳이 멈출 필요가 없어 제거함.)
// loadVideoById()로 새 영상(또는 새 구간)을 불러오면 실제로 그 위치로 넘어가기까지
// 약간의 시간이 걸리는데, 그사이에는 직전까지 로드되어 있던(음소거 상태로 미리
// 재생 중이던) 영상이 그대로 재생되고 있다. 이 시점에 곧바로 unMute()하면 아직
// 옛 위치(영상 맨 처음)에서 재생 중이던 소리가 아주 짧게 들렸다가 실제 구간으로
// 넘어가버려서 "영상이 두 번 재생되는" 것처럼 들린다. 그래서 실제로 재생 상태가
// PLAYING으로 바뀐 뒤에야 음소거를 해제하도록 이벤트를 기다린다.
let pendingUnmuteResolve = null;
function handleYtStateChange(e) {
  if (e.data === YT.PlayerState.PLAYING && pendingUnmuteResolve) {
    const resolve = pendingUnmuteResolve;
    pendingUnmuteResolve = null;
    resolve();
  }
}
function waitForPlayingState(timeoutMs = 1500) {
  return new Promise((resolve) => {
    pendingUnmuteResolve = resolve;
    setTimeout(() => {
      if (pendingUnmuteResolve === resolve) { pendingUnmuteResolve = null; resolve(); }
    }, timeoutMs);
  });
}

function primeAudioUnlock(videoId) {
  const create = () => {
    if (ytPlayer) {
      try {
        ytPlayer.mute();
        ytPlayer.loadVideoById(videoId);
      } catch (err) { /* 무시 */ }
    } else {
      ytPlayer = new YT.Player('yt-player', {
        height: '270',
        width: '480',
        videoId,
        playerVars: { autoplay: 1 },
        events: {
          onReady: (e) => { e.target.mute(); },
          onStateChange: handleYtStateChange
        }
      });
    }
  };
  if (ytReady && window.YT && window.YT.Player) create();
  else {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { ytReady = true; create(); if (prev) prev(); };
  }
}

// 문제를 바로 틀지 않고 "3, 2, 1"(TTS 음성 포함) 카운트다운 후 재생을 시작한다.
// 지금 화면에 표시 중인 문제의 인덱스 (제목 옆 ✏️ 아이콘으로 바로 수정하러 갈 때 사용)
let currentDisplayedIndex = null;
function updateQTitleEditBtn(index) {
  currentDisplayedIndex = index;
  qTitleEditBtn.style.display = index !== null && questions[index] ? '' : 'none';
}
qTitleEditBtn.addEventListener('click', () => {
  if (currentDisplayedIndex === null) return;
  const q = questions[currentDisplayedIndex];
  if (q) openEditModal(q);
});

let countdownToken = 0;
function startQuestionWithCountdown(index) {
  const myToken = ++countdownToken;
  const q = questions[index];
  ytPlayerContainerEl.classList.add('priming'); // 카운트다운 동안 영상 영역을 가려서 미리듣기 재생이 보이지 않게 함
  if (q) primeAudioUnlock(q.videoId); // 클릭 직후 곧바로(제스처 범위 안에서) 자동재생 잠금 해제
  let n = 3;
  qTitleEl.textContent = q ? questionPositionLabel(index) : '문제 준비 중';
  qProgressEl.textContent = '';
  setCurrentAnswer(q ? q.title : '');
  updateQTitleEditBtn(index);
  pauseBtn.disabled = true; // 실제 재생이 시작되기 전(카운트다운/구간 준비 중)에는 일시정지가 의미 없음
  setPausedUiState(false);
  renderEventBanner(null); // 어떤 이벤트가 걸릴지는 question:show가 와야 확정되므로 일단 비워둠
  statusBanner.className = 'status-banner';
  const tick = () => {
    if (myToken !== countdownToken) return; // 그 사이 다른 문제가 시작되어 이 카운트다운은 취소됨
    if (n > 0) {
      statusBanner.textContent = `⏳ ${n}...`;
      speak(String(n)); // 삼, 이, 일
      n--;
      setTimeout(tick, 1000);
    } else {
      statusBanner.textContent = '🎵 시작!';
      socket.emit('host:startQuestion', index);
    }
  };
  tick();
}

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

// 문제 제목이 "가수 - 곡명" 형식이면 TTS가 하이픈을 그대로("가수 대시 곡명") 읽어서
// 어색하게 들린다. 정답을 소리내어 읽을 때만 "가수의 곡명"처럼 자연스럽게 바꿔서
// 발음하고, 화면에 표시되는 텍스트(정답 배너, 점수판 등)는 원래 제목 그대로 둔다.
function formatAnswerForSpeech(title) {
  if (!title) return title;
  const m = title.match(/^(.+?)\s*-\s*(.+)$/);
  return m ? `${m[1]}의 ${m[2]}` : title;
}

// 음성이 다 끝나는 시점을 알아야 "TTS가 다 나온 뒤 3초 후 다음 문제 카운트 시작"을
// 구현할 수 있어서, 발화가 끝나면(또는 실패/미지원 시 즉시) resolve되는 Promise를 반환한다.
function speak(text) {
  return new Promise((resolve) => {
    try {
      if (!window.speechSynthesis) return resolve();
      window.speechSynthesis.cancel(); // 이전에 말하던 게 남아있으면 끊고 새로 말함
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ko-KR';
      utter.rate = 1.05;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    } catch (err) {
      // TTS를 지원하지 않는 기기에서도 게임 진행에는 지장 없게 조용히 무시
      resolve();
    }
  });
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

// 연도/카테고리 필터를 버튼으로 렌더링한다 (여러 개 동시 선택 가능, 예: 2005+2006).
// 데이터가 바뀌거나(문제 로드) 버튼을 눌러 선택이 바뀔 때마다 다시 그린다
// (버튼 개수가 많지 않아 매번 새로 그려도 무리 없음).
function renderFilterButtons() {
  const years = [...new Set(questions.map((q) => q.year).filter((y) => y !== null && y !== undefined))].sort((a, b) => a - b);
  const categories = [...new Set(questions.map((q) => q.category).filter((c) => c))].sort();

  // 더 이상 존재하지 않는 값이 선택되어 있으면 제거
  const yearStrs = years.map(String);
  selectedYears.forEach((y) => { if (!yearStrs.includes(y)) selectedYears.delete(y); });
  selectedCategories.forEach((c) => { if (!categories.includes(c)) selectedCategories.delete(c); });

  function buildButtonRow(container, options, selectedSet, onChange) {
    container.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.textContent = '전체';
    if (selectedSet.size === 0) allBtn.classList.add('btn-primary');
    allBtn.addEventListener('click', () => {
      selectedSet.clear();
      onChange();
    });
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

  const onChange = () => {
    renderFilterButtons();
    renderQuestionButtons();
  };
  buildButtonRow(filterYearButtonsEl, years, selectedYears, onChange);
  buildButtonRow(filterCategoryButtonsEl, categories, selectedCategories, onChange);
}

function renderQuestionButtons() {
  qButtonsEl.innerHTML = '';
  let count = 0;
  questions.forEach((q, i) => {
    if (selectedYears.size > 0 && !selectedYears.has(String(q.year))) return;
    if (selectedCategories.size > 0 && !selectedCategories.has(q.category)) return;
    count++;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:6px;';
    const btn = document.createElement('button');
    btn.style.flex = '1';
    btn.style.textAlign = 'left';
    btn.textContent = `${i + 1}. ${q.title}`;
    btn.addEventListener('click', () => {
      if (mode === 'auto') stopAuto(); // 자동 진행 중 수동으로 다른 문제를 고르면 자동 모드는 중지
      showPlayScreen();
      startQuestionWithCountdown(i);
    });
    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️';
    editBtn.title = '문제 수정';
    editBtn.style.flexShrink = '0';
    editBtn.addEventListener('click', () => openEditModal(q));
    row.appendChild(btn);
    row.appendChild(editBtn);
    qButtonsEl.appendChild(row);
  });
  qButtonsCountEl.textContent = count;
}

// ---------- 문제 수정 (진행 중 화면을 벗어나지 않고 바로 고칠 수 있게) ----------
function extractVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed; // 이미 11자리 videoId만 붙여넣은 경우
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

let editingQuestionId = null;

function openEditModal(q) {
  editingQuestionId = q.id;
  editModalTitle.textContent = `문제 수정: ${q.title}`;
  editQTitle.value = q.title;
  editQCategory.value = q.category || '';
  editQYear.value = q.year !== null && q.year !== undefined ? q.year : '';
  editQUrl.value = `https://www.youtube.com/watch?v=${q.videoId}`;
  editQStart.value = q.start || 0;
  editQEnd.value = q.end !== null && q.end !== undefined ? q.end : '';
  editQNote.value = q.note || '';
  editQMsg.textContent = '';
  editModalOverlay.style.display = 'flex';
}

function closeEditModal() {
  editingQuestionId = null;
  editModalOverlay.style.display = 'none';
}

editCancelBtn.addEventListener('click', closeEditModal);
editModalOverlay.addEventListener('click', (e) => {
  if (e.target === editModalOverlay) closeEditModal(); // 바깥(어두운 배경) 클릭 시 닫기
});

editSaveBtn.addEventListener('click', async () => {
  if (!editingQuestionId) return;
  const videoId = extractVideoId(editQUrl.value);
  const title = editQTitle.value.trim();
  if (!title) { editQMsg.textContent = '이름(정답)을 입력하세요.'; return; }
  if (!videoId) { editQMsg.textContent = '유효한 유튜브 URL을 입력하세요.'; return; }
  const body = {
    title,
    category: editQCategory.value.trim(),
    year: editQYear.value !== '' ? Number(editQYear.value) : '',
    videoId,
    start: Number(editQStart.value) || 0,
    end: editQEnd.value ? Number(editQEnd.value) : '',
    note: editQNote.value.trim()
  };
  editSaveBtn.disabled = true;
  try {
    const res = await fetch('/api/questions/' + editingQuestionId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      closeEditModal();
      socket.emit('host:getQuestions'); // 목록을 다시 받아와 화면을 새로고침 (host:questions 핸들러가 다시 그려줌)
    } else {
      const data = await res.json();
      editQMsg.textContent = '저장 실패: ' + (data.error || '알 수 없는 오류');
    }
  } catch (err) {
    editQMsg.textContent = '저장 중 오류: ' + err.message;
  } finally {
    editSaveBtn.disabled = false;
  }
});

socket.emit('host:getQuestions');
socket.on('host:questions', (data) => {
  questions = data;
  renderFilterButtons();
  renderQuestionButtons();
});

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
  ytPlayerContainerEl.classList.remove('priming'); // 실제 재생 시작과 함께 영상 화면을 다시 보여줌 (단, "화면 가리기"가 켜져 있으면 아래에서 다시 가려짐)
  applyHideVideoState();
  ytPlayer.mute(); // 구간 이동 중에는 계속 음소거 유지 (직전 위치의 소리가 잠깐 새어나가는 것을 막음)
  ytPlayer.loadVideoById({ videoId, startSeconds: start, endSeconds: end });
  pauseBtn.disabled = false;
  setPausedUiState(false);
  waitForPlayingState().then(() => {
    try { ytPlayer.unMute(); } catch (err) { /* 무시 */ }
  });
}

socket.on('question:show', async ({ index, total, videoId, start, end, event }) => {
  clearBuzzCountdown();
  const myToken = ++playToken;
  const q = questions[index];
  qTitleEl.textContent = questionPositionLabel(index);
  updateQTitleEditBtn(index);
  qProgressEl.textContent = '재생 구간 준비 중...';
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔎 영상 중 무작위 구간을 고르는 중...';
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
  revealBtn.disabled = false;
  passedTokens.clear(); // 새 문제가 시작됐으니 점수판의 "패스함" 표시를 초기화
  renderScoreboard();
  renderEventBanner(event);

  // primeAudioUnlock()에서 이미 이 영상으로 음소거 재생을 시작해뒀을 것이다 (자동재생
  // 잠금 해제 목적). 여기서 cueVideoById 등으로 다시 로드하면 그 상태가 풀려버릴 수
  // 있으므로 건드리지 않고, 혹시나 아직 플레이어가 준비되지 않았을 경우에만 기다린다.
  if (!ytPlayer) {
    await new Promise((resolve) => {
      const check = () => { if (ytPlayer) resolve(); else setTimeout(check, 100); };
      check();
    });
  }
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

  qProgressEl.textContent = `재생 길이: ${selectedDuration < 60 ? selectedDuration + '초' : '1분'} (영상 중 무작위 구간)`;
  playClip(videoId, randomStart, clipEnd);
  statusBanner.textContent = '🔔 부저를 기다리는 중...';
});

// 부저가 잠긴 뒤(누군가 눌렀을 때) 답변 제한시간(10초)을 화면에 보여주고,
// 남은 시간이 5초 이하로 줄어들면 TTS로 숫자를 읽어준다("5, 4, 3, 2, 1").
// 실제 자동 오답 처리는 서버가 판단하므로(host:judge를 안 받으면 서버가 타임아웃
// 처리 후 buzz:reset을 보냄), 여기서는 어디까지나 시각/음성 안내만 담당한다.
let buzzCountdownInterval = null;
function clearBuzzCountdown() {
  if (buzzCountdownInterval) {
    clearInterval(buzzCountdownInterval);
    buzzCountdownInterval = null;
  }
}

function startBuzzCountdown(deadline, nickname) {
  clearBuzzCountdown();
  let lastSpoken = null;
  const tick = () => {
    const remainingMs = deadline - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    statusBanner.textContent = `🚨 ${nickname}님이 부저를 눌렀습니다! (남은 시간 ${remaining}초)`;
    if (remaining <= 5 && remaining >= 1 && remaining !== lastSpoken) {
      speak(String(remaining)); // 5초부터 카운팅: 5, 4, 3, 2, 1
      lastSpoken = remaining;
    }
    if (remainingMs <= 0) clearBuzzCountdown();
  };
  tick();
  buzzCountdownInterval = setInterval(tick, 200);
}

socket.on('buzz:locked', ({ nickname, deadline }) => {
  playBuzzerSound();
  if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') ytPlayer.pauseVideo();
  setPausedUiState(true); // 부저가 눌리면 자동으로 멈추므로 버튼 표시도 "재생"으로 맞춰둠
  statusBanner.className = 'status-banner locked';
  statusBanner.textContent = `🚨 ${nickname}님이 부저를 눌렀습니다!`;
  judgeCorrectBtn.disabled = false;
  judgeWrongBtn.disabled = false;
  if (deadline) startBuzzCountdown(deadline, nickname);
});

socket.on('buzz:reset', ({ nickname, auto }) => {
  clearBuzzCountdown();
  speak(auto ? `시간 초과! ${nickname}님 자동 오답 처리되었습니다.` : '땡! 오답입니다.');
  statusBanner.className = 'status-banner';
  statusBanner.textContent = auto
    ? `⏰ ${nickname}님 시간 초과로 자동 오답 처리되었습니다. 다시 부저를 기다립니다...`
    : `❌ ${nickname}님 오답! 다시 부저를 기다립니다...`;
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
});

socket.on('buzz:cleared', () => {
  clearBuzzCountdown();
  statusBanner.className = 'status-banner';
  statusBanner.textContent = '🔔 부저를 기다리는 중...';
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
});

// 참가자가 패스하면(부저를 아무도 안 누르고 있을 때만 가능) 진행자 화면에 알려주고,
// 점수판의 이름 옆에도 "패스함" 표시가 뜨도록 기록해둔다. 새 문제가 시작되면 초기화된다.
socket.on('player:passed', ({ id, nickname }) => {
  statusBanner.textContent = `🙅 ${nickname}님 패스`;
  passedTokens.add(id);
  renderScoreboard();
});

socket.on('question:result', ({ correct, nickname, answer, autoPassed, pointsAwarded, oneVsManyAwarded }) => {
  clearBuzzCountdown();
  statusBanner.className = 'status-banner correct';
  if (correct) {
    const pointsText = pointsAwarded !== undefined ? ` (+${pointsAwarded}점)` : '';
    statusBanner.textContent = `🎉 정답! ${nickname}${pointsText} — 정답은 "${answer}"`;
  } else if (oneVsManyAwarded) {
    statusBanner.textContent = `👥 ${nickname}님 오답! 나머지 전원 +${pointsAwarded}점 — 정답은 "${answer}"`;
  } else if (autoPassed) {
    statusBanner.textContent = `🙅 참가자 전원 오답/패스 — 정답은 "${answer}"`;
  } else {
    statusBanner.textContent = `정답 공개: "${answer}"`;
  }
  judgeCorrectBtn.disabled = true;
  judgeWrongBtn.disabled = true;
  revealBtn.disabled = true;

  // TTS 음성이 끝까지 다 나온 뒤에야 대기시간(기본 3초)을 세기 시작한다. 그래야
  // "정답은 ~입니다" 안내가 다 끝나기도 전에 다음 문제의 "3, 2, 1" 카운트다운
  // 음성이 겹쳐 나오는 일이 없다.
  speak(correct ? `딩동댕! ${nickname}님 정답입니다.` : `정답은 ${formatAnswerForSpeech(answer)} 입니다.`).then(() => {
    if (!autoRunning) return;
    if (autoPlayedCount < autoTotal) {
      setTimeout(() => {
        if (autoRunning) playNextAutoQuestion();
      }, getAutoGapMs());
    } else {
      stopAuto(`✅ 자동 출제 완료! (총 ${autoPlayedCount}문제)`);
    }
  });
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

// 진행자 화면 점수판: +/-로 점수를 직접 조정하거나, 개인별로만 초기화하거나, 이름을
// 고치거나, 문제를 일으키는 참가자를 게임에서 추방할 수 있다. 이번 문제를 패스한
// 참가자는 이름 옆에 "🙅 패스함" 표시가, 참가자 중 진행자로 지정된 사람이 있으면
// "👑 진행자" 표시가 뜬다.
let lastScoreboardList = [];
const passedTokens = new Set();
let appointedHostToken = null;

function renderScoreboard() {
  scoreboardEl.innerHTML = '';
  lastScoreboardList.forEach((p, i) => {
    const li = document.createElement('li');
    li.style.flexWrap = 'wrap';

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; cursor:pointer;';
    nameSpan.title = '눌러서 이름 수정';
    nameSpan.innerHTML = `<span class="rank">${i + 1}.</span> ${p.nickname}`;
    nameSpan.addEventListener('click', () => {
      const newName = prompt('새 닉네임을 입력하세요', p.nickname);
      if (newName && newName.trim()) {
        socket.emit('host:renamePlayer', { token: p.id, nickname: newName.trim() });
      }
    });
    if (p.id === appointedHostToken) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'badge badge-host';
      hostBadge.textContent = '👑 진행자';
      nameSpan.appendChild(hostBadge);
    }
    if (passedTokens.has(p.id)) {
      const passBadge = document.createElement('span');
      passBadge.className = 'badge badge-pass';
      passBadge.textContent = '🙅 패스함';
      nameSpan.appendChild(passBadge);
    }
    li.appendChild(nameSpan);

    const controls = document.createElement('div');
    controls.className = 'sb-controls';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'sb-btn';
    minusBtn.textContent = '−';
    minusBtn.addEventListener('click', () => socket.emit('host:adjustScore', { token: p.id, delta: -1 }));

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'score';
    scoreSpan.textContent = `${p.score}점`;

    const plusBtn = document.createElement('button');
    plusBtn.className = 'sb-btn';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => socket.emit('host:adjustScore', { token: p.id, delta: 1 }));

    const resetBtn = document.createElement('button');
    resetBtn.className = 'sb-btn';
    resetBtn.textContent = '초기화';
    resetBtn.addEventListener('click', () => socket.emit('host:resetPlayerScore', p.id));

    const kickBtn = document.createElement('button');
    kickBtn.className = 'sb-btn sb-kick';
    kickBtn.textContent = '추방';
    kickBtn.addEventListener('click', () => {
      if (confirm(`${p.nickname}님을 게임에서 추방할까요? (다시 입장은 가능합니다)`)) {
        socket.emit('host:kickPlayer', p.id);
      }
    });

    controls.appendChild(minusBtn);
    controls.appendChild(scoreSpan);
    controls.appendChild(plusBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(kickBtn);
    li.appendChild(controls);
    scoreboardEl.appendChild(li);
  });
}

socket.on('scoreboard:update', (list) => {
  lastScoreboardList = list;
  renderScoreboard();
});

socket.on('host:appointed', ({ token }) => {
  appointedHostToken = token;
  renderScoreboard();
});
