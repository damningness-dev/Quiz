const socket = io();

const joinInfo = document.getElementById('join-info');
const qTitleEl = document.getElementById('q-title');
const qProgressEl = document.getElementById('q-progress');
const qButtonsEl = document.getElementById('q-buttons');
const qButtonsCountEl = document.getElementById('q-buttons-count');
const filterYearButtonsEl = document.getElementById('filter-year-buttons');
const filterCategoryButtonsEl = document.getElementById('filter-category-buttons');
const durationPickerEl = document.getElementById('duration-picker');
const ytPlayerContainerEl = document.getElementById('yt-player-container');
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

// ---------- 출제 방식 (수동/자동) ----------
let mode = 'manual';
let autoQueue = [];
let autoPos = -1;
let autoRunning = false;

// ---------- 연도/카테고리 버튼 필터 ('' = 전체) ----------
let selectedYearFilter = '';
let selectedCategoryFilter = '';

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
  const yearFilter = selectedYearFilter;
  const categoryFilter = selectedCategoryFilter;
  const indices = [];
  questions.forEach((q, i) => {
    if (yearFilter && String(q.year) !== yearFilter) return;
    if (categoryFilter && q.category !== categoryFilter) return;
    indices.push(i);
  });
  return indices;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getAutoGapMs() {
  let gap = parseFloat(autoGapInput.value);
  if (isNaN(gap) || gap < 0) gap = 0;
  return gap * 1000;
}

function stopAuto(message) {
  autoRunning = false;
  autoQueue = [];
  autoPos = -1;
  autoStartBtn.style.display = '';
  autoStopBtn.style.display = 'none';
  autoStatusEl.textContent = message || '';
}

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

  autoQueue = shuffle(pool).slice(0, count);
  autoPos = 0;
  autoRunning = true;
  autoStartBtn.style.display = 'none';
  autoStopBtn.style.display = '';
  autoStatusEl.textContent = `자동 출제 진행 중 (1/${autoQueue.length})`;
  startQuestionWithCountdown(autoQueue[0]);
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
        events: { onReady: (e) => { e.target.mute(); } }
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
let countdownToken = 0;
function startQuestionWithCountdown(index) {
  const myToken = ++countdownToken;
  const q = questions[index];
  ytPlayerContainerEl.classList.add('priming'); // 카운트다운 동안 영상 영역을 가려서 미리듣기 재생이 보이지 않게 함
  if (q) primeAudioUnlock(q.videoId); // 클릭 직후 곧바로(제스처 범위 안에서) 자동재생 잠금 해제
  let n = 3;
  qTitleEl.textContent = q ? `곧 시작: ${index + 1}번 문제` : '문제 준비 중';
  qProgressEl.textContent = '';
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

// 연도/카테고리 필터를 버튼으로 렌더링한다. 데이터가 바뀌거나(문제 로드) 버튼을
// 눌러 선택이 바뀔 때마다 다시 그린다(버튼 개수가 많지 않아 매번 새로 그려도 무리 없음).
function renderFilterButtons() {
  const years = [...new Set(questions.map((q) => q.year).filter((y) => y !== null && y !== undefined))].sort((a, b) => a - b);
  const categories = [...new Set(questions.map((q) => q.category).filter((c) => c))].sort();

  // 더 이상 존재하지 않는 값이 선택되어 있으면 전체로 되돌림
  if (selectedYearFilter && !years.map(String).includes(selectedYearFilter)) selectedYearFilter = '';
  if (selectedCategoryFilter && !categories.includes(selectedCategoryFilter)) selectedCategoryFilter = '';

  function buildButtonRow(container, options, selectedValue, onSelect) {
    container.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.textContent = '전체';
    if (!selectedValue) allBtn.classList.add('btn-primary');
    allBtn.addEventListener('click', () => onSelect(''));
    container.appendChild(allBtn);

    options.forEach((opt) => {
      const value = String(opt);
      const btn = document.createElement('button');
      btn.textContent = value;
      if (value === selectedValue) btn.classList.add('btn-primary');
      btn.addEventListener('click', () => onSelect(value));
      container.appendChild(btn);
    });
  }

  buildButtonRow(filterYearButtonsEl, years, selectedYearFilter, (value) => {
    selectedYearFilter = value;
    renderFilterButtons();
    renderQuestionButtons();
  });
  buildButtonRow(filterCategoryButtonsEl, categories, selectedCategoryFilter, (value) => {
    selectedCategoryFilter = value;
    renderFilterButtons();
    renderQuestionButtons();
  });
}

function renderQuestionButtons() {
  const yearFilter = selectedYearFilter;
  const categoryFilter = selectedCategoryFilter;

  qButtonsEl.innerHTML = '';
  let count = 0;
  questions.forEach((q, i) => {
    if (yearFilter && String(q.year) !== yearFilter) return;
    if (categoryFilter && q.category !== categoryFilter) return;
    count++;
    const btn = document.createElement('button');
    btn.textContent = `${i + 1}. ${q.title}`;
    btn.addEventListener('click', () => {
      if (mode === 'auto') stopAuto(); // 자동 진행 중 수동으로 다른 문제를 고르면 자동 모드는 중지
      startQuestionWithCountdown(i);
    });
    qButtonsEl.appendChild(btn);
  });
  qButtonsCountEl.textContent = count;
}

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
  ytPlayerContainerEl.classList.remove('priming'); // 실제 재생 시작과 함께 영상 화면을 다시 보여줌
  ytPlayer.unMute(); // primeAudioUnlock()에서 음소거로 재생을 시작해뒀던 것을 실제 재생 시점에 해제
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

  if (autoRunning) {
    autoPos++;
    if (autoPos < autoQueue.length) {
      const nextIndex = autoQueue[autoPos];
      autoStatusEl.textContent = `자동 출제 진행 중 (${autoPos + 1}/${autoQueue.length})`;
      setTimeout(() => {
        if (autoRunning) startQuestionWithCountdown(nextIndex);
      }, getAutoGapMs());
    } else {
      const total = autoQueue.length;
      stopAuto(`✅ 자동 출제 완료! (총 ${total}문제)`);
    }
  }
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
