const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

// exe(pkg)를 더블클릭해서 실행했을 때 콘솔 창이 그대로 화면 위에 뜨는 게 거슬릴 수
// 있어서, 항상 "최소화 실행" 배치파일과 같은 방식(작업표시줄로만 최소화된 채 실행)으로
// 동작하도록 만든다. 자기 자신을 최소화 옵션으로 다시 띄우고, 방금 뜬 이 콘솔
// 창(원본 프로세스)은 조용히 종료한다. 이미 그렇게 재실행된 상태라면(QUIZ_MINIMIZED_RELAUNCH
// 표시가 있으면) 다시 반복하지 않고 이 프로세스가 그대로 서버를 계속 띄운다.
if (process.pkg && process.platform === 'win32' && !process.env.QUIZ_MINIMIZED_RELAUNCH) {
  try {
    const cmdLine = `start "QuizServer" /min "${process.execPath}"`;
    const child = spawn(cmdLine, {
      shell: true,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, QUIZ_MINIMIZED_RELAUNCH: '1' }
    });
    child.unref();
    process.exit(0);
  } catch (err) {
    // 최소화 재실행이 실패해도(드문 권한 문제 등) 서버 자체는 이 콘솔 창에서 계속 정상 실행되어야 하므로 무시
  }
}

// exe로 패키징된 경우(pkg) __dirname은 실행 파일 내부의 읽기 전용 가상 경로를 가리키므로,
// .env나 문제 데이터처럼 실제로 읽고 써야 하는 파일은 실행 파일(.exe)이 놓인 폴더를 기준으로 삼는다.
// 일반 개발 환경(node server/index.js)에서는 지금까지처럼 프로젝트 루트를 기준으로 한다.
const DATA_BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

require('dotenv').config({ path: path.join(DATA_BASE_DIR, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// exe를 더블클릭해서 실행했을 때는, 오류가 나서 프로세스가 죽으면 콘솔 창도 같이
// 닫혀버려서 무슨 에러였는지 읽을 새도 없이 사라진다. 그래서 여기서 잡히는 오류는
// 메시지를 출력한 뒤 "아무 키나 누르면 창이 닫히도록" 잠깐 멈춰서, 최소한 무엇이
// 문제인지는 보고 닫을 수 있게 한다. (터미널에서 직접 node로 실행하는 개발 환경에서는
// 이미 창이 안 닫히므로 이 멈춤이 필요 없어 건너뛴다. cmd.exe 등 외부 프로세스를 새로
// 띄우면 일부 백신이 의심스러운 동작으로 보고 통째로 종료시킬 수 있어서, 프로세스를
// 새로 띄우지 않고 순수 Node 코드로만 키 입력을 기다린다.)
function pauseBeforeExitIfPackaged() {
  if (!(process.pkg && process.platform === 'win32')) return Promise.resolve();
  return new Promise((resolve) => {
    process.stdout.write('\n계속하려면 Enter 키를 누르세요... (60초 후 자동으로 닫힙니다)\n');
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, 60000); // stdin이 기대대로 동작하지 않는 경우를 대비한 안전장치
    process.stdin.resume();
    process.stdin.once('data', () => { clearTimeout(timer); finish(); });
  });
}

process.on('uncaughtException', async (err) => {
  console.error('\n❌ 예기치 못한 오류로 서버가 종료됩니다:');
  console.error(err && err.stack ? err.stack : err);
  await pauseBeforeExitIfPackaged();
  process.exit(1);
});

process.on('unhandledRejection', async (err) => {
  console.error('\n❌ 처리되지 않은 오류로 서버가 종료됩니다:');
  console.error(err && err.stack ? err.stack : err);
  await pauseBeforeExitIfPackaged();
  process.exit(1);
});

const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const QUESTIONS_FILE = path.join(DATA_BASE_DIR, 'data', 'questions.json');

app.use(express.json());
// 같은 Wi-Fi의 다른 기기(예: 휴대폰)에서 열어둔 admin.html이 이 서버의 API를 직접
// 호출해 문제 목록을 동기화할 수 있도록 CORS를 허용한다. 완전히 로컬 네트워크
// 전용 앱이라 민감한 데이터가 없으므로 전체 허용해도 안전하다.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- 진행자 화면이 모두 닫히면 서버(콘솔)도 같이 종료 ----------
// index.html/host.html/admin.html이 살아있는 동안 heartbeat.js가 주기적으로 이 API를
// 호출한다. 일정 시간 동안 호출이 없으면(=그 화면들이 모두 닫힘) 서버를 종료한다.
// exe를 더블클릭해서 켰다가 화면만 닫고 콘솔 창을 깜빡 잊는 상황을 위한 것이라
// 패키징된 exe에서만 동작시키고, 개발 중(npm start)에는 건드리지 않는다.
let lastHeartbeatAt = Date.now();
const HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 핑 주기(5초)보다 넉넉하게 잡아 백그라운드 탭 스로틀링 등으로 오작동하지 않게 함

app.post('/api/heartbeat', (req, res) => {
  lastHeartbeatAt = Date.now();
  res.sendStatus(204);
});

if (process.pkg) {
  setInterval(() => {
    if (Date.now() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
      console.log('\n진행자 화면이 모두 닫혀서 서버를 종료합니다.');
      process.exit(0);
    }
  }, 5000);
}

// ---------- 문제 데이터 저장/로드 ----------
function loadQuestions() {
  try {
    const raw = fs.readFileSync(QUESTIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function saveQuestions(questions) {
  fs.mkdirSync(path.dirname(QUESTIONS_FILE), { recursive: true }); // exe를 처음 실행할 때 data 폴더가 없을 수 있음
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2), 'utf-8');
}

let questions = loadQuestions();

// ---------- 문제 관리 API ----------
app.get('/api/questions', (req, res) => {
  res.json(questions);
});

app.post('/api/questions', (req, res) => {
  const { title, videoId, start, end, note, category, year } = req.body;
  if (!title || !videoId) {
    return res.status(400).json({ error: 'title과 videoId는 필수입니다.' });
  }
  const question = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    category: category || '',
    year: year !== undefined && year !== '' ? Number(year) : null,
    title,
    videoId,
    start: Number(start) || 0,
    end: end !== undefined && end !== '' ? Number(end) : null,
    note: note || ''
  };
  questions.push(question);
  saveQuestions(questions);
  res.json(question);
});

app.put('/api/questions/:id', (req, res) => {
  const idx = questions.findIndex((q) => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
  const { title, videoId, start, end, note, category, year } = req.body;
  questions[idx] = {
    ...questions[idx],
    category: category !== undefined ? category : questions[idx].category,
    year: year !== undefined ? (year !== '' ? Number(year) : null) : questions[idx].year,
    title: title ?? questions[idx].title,
    videoId: videoId ?? questions[idx].videoId,
    start: start !== undefined ? Number(start) : questions[idx].start,
    end: end !== undefined ? (end !== '' ? Number(end) : null) : questions[idx].end,
    note: note ?? questions[idx].note
  };
  saveQuestions(questions);
  res.json(questions[idx]);
});

app.delete('/api/questions/:id', (req, res) => {
  questions = questions.filter((q) => q.id !== req.params.id);
  saveQuestions(questions);
  res.json({ ok: true });
});

// ---------- 유튜브 검색 프록시 (API 키가 있을 때만 동작) ----------
app.get('/api/youtube/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  if (!YOUTUBE_API_KEY) {
    return res.status(400).json({
      error: 'YOUTUBE_API_KEY가 설정되어 있지 않습니다. .env에 키를 추가하거나, 유튜브 URL을 직접 붙여넣어주세요.'
    });
  }
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('q', q);
    url.searchParams.set('key', YOUTUBE_API_KEY);
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || '유튜브 검색 실패' });
    }
    const items = (data.items || []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.default?.url
    }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: '유튜브 검색 중 오류가 발생했습니다: ' + err.message });
  }
});

// ---------- 로컬 IP 안내 (모바일 접속용) ----------
app.get('/api/local-ip', (req, res) => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  res.json({ addresses: addrs, port: PORT });
});

// ---------- 게임 상태 (단일 세션, 로컬 파티용) ----------
const DISCONNECT_GRACE_MS = 90 * 1000; // 화면 꺼짐/앱 전환 등 일시적 연결 끊김을 봐주는 유예 시간
const BUZZ_ANSWER_TIME_MS = 10 * 1000; // 부저를 누른 뒤 답변을 위해 주어지는 시간, 초과 시 자동 오답 처리

const state = {
  players: new Map(), // token -> { token, nickname, score, socketId, disconnectTimer }
  socketToToken: new Map(), // socketId -> token
  currentQuestionIndex: -1,
  buzzLockedBy: null, // token
  buzzTimer: null, // 부저 응답 제한시간 타이머 (setTimeout)
  buzzDeadline: null, // 부저 응답 마감 시각(ms, Date.now() 기준) — 클라이언트 카운트다운 표시용
  excludedFromBuzz: new Set(), // 오답 처리된 참가자 토큰 (같은 문제에서 재도전 불가)
  passedPlayers: new Set(), // 이번 문제를 패스한 참가자 토큰
  revealed: false,
  hostSocketIds: new Set(), // host.html에서 접속한 소켓들 (host:hello를 보낸 소켓만 포함)
  votes: new Map(), // token -> boolean, 현재 부저에 대한 참가자 투표(정답/오답)
  appointedHostToken: null // 실제 진행자(host.html)가 없을 때, 참가자 중 진행자로 지정된 사람의 토큰
};

// 지정된 진행자를 해제하고 모두에게 알린다 (진행자 추방/퇴장, 실제 진행자 접속 등으로 호출됨)
function clearAppointedHost() {
  if (state.appointedHostToken === null) return;
  state.appointedHostToken = null;
  io.emit('host:appointed', { token: null });
}

// 진행자 화면(host.html)이 실제로 접속해 있는지 여부. 진행자가 있으면 진행자가
// 판정하고, 없으면(호스트리스 모드) 참가자 투표로 판정한다. 참가자가 자기 폰으로
// 재생/문제선택 같은 진행 설정을 하더라도 host:hello를 보내지 않으므로 여전히
// "진행자 없음" 상태로 취급되어 투표 판정이 계속 사용된다.
function isHostPresent() {
  return state.hostSocketIds.size > 0;
}

// 실제 진행자(host.html)가 접속해 있거나, 참가자 중 진행자로 지정된 사람이 있으면
// 판정 권한을 가진 사람이 있는 것이므로 참가자 투표 판정은 쓰지 않는다.
function judgeAuthorityAssigned() {
  return isHostPresent() || state.appointedHostToken !== null;
}

function eligibleVoterCount() {
  return Math.max(0, state.players.size - (state.buzzLockedBy ? 1 : 0)); // 부저를 누른 본인은 투표 대상에서 제외
}

function voteTally() {
  let correct = 0;
  let wrong = 0;
  for (const v of state.votes.values()) {
    if (v) correct++; else wrong++;
  }
  return { correct, wrong, total: eligibleVoterCount() };
}

// 과반수(절반 초과)가 정답 또는 오답에 투표하면 그 즉시 판정한다.
function resolveVoteIfMajority() {
  const lockedId = state.buzzLockedBy;
  if (!lockedId) return;
  const total = eligibleVoterCount();
  if (total === 0) return;
  const majority = Math.floor(total / 2) + 1;
  const tally = voteTally();
  if (tally.correct >= majority) judgeAnswer(lockedId, true);
  else if (tally.wrong >= majority) judgeAnswer(lockedId, false);
}

// 참가자 전원이 오답 처리됐거나 패스해서 더 이상 아무도 도전할 수 없게 되면
// 자동으로 정답을 공개한다(진행자의 "정답 공개(패스)"와 동일하게 처리). 단, 진행자가
// 접속해 있으면(호스트리스가 아니면) 자동으로 넘기지 않고 진행자가 직접 "정답
// 공개(패스)"를 눌러야만 다음으로 넘어가게 한다 — 자동 출제 중이라도 진행자가
// 있는 한 판정의 최종 권한은 진행자에게 있어야 하기 때문.
function checkAllPlayersDoneAndAutoReveal() {
  if (state.currentQuestionIndex === -1 || state.revealed) return;
  if (state.buzzLockedBy) return; // 누군가 판정을 기다리는 중이면 아직 끝난 게 아님
  if (state.players.size === 0) return;
  if (isHostPresent()) return;
  const allDone = Array.from(state.players.keys())
    .every((token) => state.excludedFromBuzz.has(token) || state.passedPlayers.has(token));
  if (!allDone) return;
  const q = currentQuestion();
  state.revealed = true;
  io.emit('question:result', { correct: false, nickname: null, answer: q ? q.title : '', autoPassed: true });
}

// 부저 응답 제한시간 타이머를 취소한다 (판정이 나거나, 부저가 초기화되거나, 새 문제가 시작될 때 호출)
function clearBuzzTimer() {
  if (state.buzzTimer) {
    clearTimeout(state.buzzTimer);
    state.buzzTimer = null;
  }
  state.buzzDeadline = null;
}

// 제한시간 안에 진행자가 판정하지 않으면 자동으로 오답 처리한다
function handleBuzzTimeout(token) {
  if (state.buzzLockedBy !== token) return; // 그 사이 이미 판정/초기화됨
  state.buzzTimer = null;
  state.buzzDeadline = null;
  state.excludedFromBuzz.add(token);
  state.buzzLockedBy = null;
  state.votes = new Map();
  const player = state.players.get(token);
  io.emit('buzz:reset', { id: token, nickname: player ? player.nickname : '', auto: true });
  checkAllPlayersDoneAndAutoReveal();
}

// 정답/오답 판정을 실제로 적용한다. 진행자의 ✅/❌ 버튼과 참가자 과반수 투표가
// 모두 이 함수로 귀결되어 판정 로직이 하나로 유지된다.
function judgeAnswer(lockedId, correct) {
  if (!lockedId || !state.players.has(lockedId)) return;
  clearBuzzTimer();
  const player = state.players.get(lockedId);
  state.votes = new Map();
  if (correct) {
    player.score += 1;
    state.revealed = true;
    const q = currentQuestion();
    io.emit('question:result', { correct: true, nickname: player.nickname, answer: q ? q.title : '' });
    broadcastScoreboard();
  } else {
    state.excludedFromBuzz.add(lockedId);
    state.buzzLockedBy = null;
    io.emit('buzz:reset', { id: lockedId, nickname: player.nickname });
    checkAllPlayersDoneAndAutoReveal();
  }
}

function publicScoreboard() {
  return Array.from(state.players.values())
    .map((p) => ({ id: p.token, nickname: p.nickname, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function broadcastScoreboard() {
  io.emit('scoreboard:update', publicScoreboard());
}

function currentQuestion() {
  return questions[state.currentQuestionIndex] || null;
}

io.on('connection', (socket) => {
  socket.emit('scoreboard:update', publicScoreboard());
  socket.emit('host:presence', { present: isHostPresent() });
  socket.emit('host:appointed', { token: state.appointedHostToken });

  // 진행자 화면(host.html)만 접속 시 이 이벤트를 보내 "진행자가 있음"을 표시한다.
  // 참가자가 호스트리스 설정 패널로 진행을 맡더라도 이 이벤트를 보내지 않으므로
  // 계속 "진행자 없음" 상태로 남아 투표 판정이 유지된다.
  socket.on('host:hello', () => {
    state.hostSocketIds.add(socket.id);
    clearAppointedHost(); // 실제 진행자가 접속하면 참가자 중 지정된 진행자는 의미가 없어짐
    io.emit('host:presence', { present: isHostPresent() });
  });

  // 참가자: 진행자가 없을 때, 참가자 중 한 명을 진행자로 지정 (자신 또는 다른 사람 모두 가능)
  socket.on('player:appointHost', (token) => {
    if (isHostPresent()) return; // 실제 진행자가 있으면 지정 불가
    if (!state.players.has(token)) return;
    state.appointedHostToken = token;
    io.emit('host:appointed', { token });
  });

  // 참가자 입장 (재접속 시에도 같은 token이면 점수를 유지)
  socket.on('player:join', ({ nickname, token } = {}) => {
    if (!token) return;
    const name = (nickname || '').trim().slice(0, 20) || `참가자${socket.id.slice(0, 4)}`;
    let player = state.players.get(token);
    if (player) {
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }
      player.nickname = name;
      player.socketId = socket.id;
    } else {
      player = { token, nickname: name, score: 0, socketId: socket.id, disconnectTimer: null };
      state.players.set(token, player);
    }
    state.socketToToken.set(socket.id, token);
    socket.emit('player:joined', { id: token, nickname: name });
    broadcastScoreboard();
  });

  // 진행자: 문제 목록 요청
  socket.on('host:getQuestions', () => {
    socket.emit('host:questions', questions);
  });

  // 진행자: 특정 문제 시작
  socket.on('host:startQuestion', (index) => {
    if (index < 0 || index >= questions.length) return;
    state.currentQuestionIndex = index;
    state.buzzLockedBy = null;
    clearBuzzTimer();
    state.excludedFromBuzz = new Set();
    state.passedPlayers = new Set();
    state.votes = new Map();
    state.revealed = false;
    const q = questions[index];
    io.emit('question:show', {
      index,
      total: questions.length,
      videoId: q.videoId,
      start: q.start,
      end: q.end
    });
  });

  // 참가자: 부저
  socket.on('player:buzz', () => {
    const token = state.socketToToken.get(socket.id);
    if (!token || !state.players.has(token)) return;
    if (state.buzzLockedBy) return; // 이미 누군가 부저를 누름
    if (state.excludedFromBuzz.has(token)) return; // 이 문제에서 이미 오답 처리됨
    if (state.currentQuestionIndex === -1) return;
    state.buzzLockedBy = token;
    state.buzzDeadline = Date.now() + BUZZ_ANSWER_TIME_MS;
    state.buzzTimer = setTimeout(() => handleBuzzTimeout(token), BUZZ_ANSWER_TIME_MS);
    state.votes = new Map();
    const player = state.players.get(token);
    io.emit('buzz:locked', {
      id: token,
      nickname: player.nickname,
      deadline: state.buzzDeadline,
      votingEnabled: !judgeAuthorityAssigned() // 판정할 사람(진행자 또는 지정된 진행자)이 없을 때만 참가자 투표로 판정
    });
  });

  // 참가자: 정답/오답 투표 (판정권자가 없을 때만 유효 — 과반수가 모이면 즉시 판정됨)
  socket.on('player:vote', (vote) => {
    if (judgeAuthorityAssigned()) return; // 진행자나 지정된 진행자가 있으면 그쪽이 판정하므로 투표는 무시
    const token = state.socketToToken.get(socket.id);
    if (!token || !state.players.has(token)) return;
    const lockedId = state.buzzLockedBy;
    if (!lockedId || token === lockedId) return; // 부저를 누른 본인은 투표 불가
    state.votes.set(token, !!vote);
    io.emit('vote:update', voteTally());
    resolveVoteIfMajority();
  });

  // 참가자: 패스 (이 문제는 시도하지 않음)
  socket.on('player:pass', () => {
    const token = state.socketToToken.get(socket.id);
    if (!token || !state.players.has(token)) return;
    if (state.buzzLockedBy) return; // 누군가 이미 부저를 누른 상태면 패스 불가
    if (state.excludedFromBuzz.has(token) || state.passedPlayers.has(token)) return; // 이미 오답/패스 처리됨
    if (state.currentQuestionIndex === -1) return;
    state.passedPlayers.add(token);
    const player = state.players.get(token);
    io.emit('player:passed', { id: token, nickname: player.nickname });
    checkAllPlayersDoneAndAutoReveal();
  });

  // 진행자: 정답/오답 판정
  socket.on('host:judge', (correct) => {
    judgeAnswer(state.buzzLockedBy, !!correct);
  });

  // 진행자: 정답 공개(패스)
  socket.on('host:reveal', () => {
    const q = currentQuestion();
    state.revealed = true;
    io.emit('question:result', { correct: false, nickname: null, answer: q ? q.title : '' });
  });

  // 진행자: 부저만 다시 초기화 (판정 없이)
  socket.on('host:resetBuzz', () => {
    state.buzzLockedBy = null;
    state.votes = new Map();
    clearBuzzTimer();
    io.emit('buzz:cleared');
  });

  // 진행자: 모든 참가자 점수 초기화 (참가자 목록/닉네임은 유지)
  socket.on('host:resetScores', () => {
    for (const player of state.players.values()) {
      player.score = 0;
    }
    broadcastScoreboard();
  });

  // 진행자: 특정 참가자 점수를 +1/-1 등 수동으로 조정
  socket.on('host:adjustScore', ({ token, delta } = {}) => {
    const player = state.players.get(token);
    if (!player) return;
    player.score += Number(delta) || 0;
    broadcastScoreboard();
  });

  // 진행자: 특정 참가자 점수만 0으로 초기화
  socket.on('host:resetPlayerScore', (token) => {
    const player = state.players.get(token);
    if (!player) return;
    player.score = 0;
    broadcastScoreboard();
  });

  // 진행자: 특정 참가자 추방 (게임에서 즉시 제거. 다시 입장하는 것은 막지 않음 — 새 참가자로 재입장 가능)
  socket.on('host:kickPlayer', (token) => {
    const player = state.players.get(token);
    if (!player) return;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    state.players.delete(token);
    for (const [sid, t] of state.socketToToken.entries()) {
      if (t === token) state.socketToToken.delete(sid);
    }
    state.excludedFromBuzz.delete(token);
    state.passedPlayers.delete(token);
    state.votes.delete(token);
    if (state.buzzLockedBy === token) {
      state.buzzLockedBy = null;
      clearBuzzTimer();
    }
    if (state.appointedHostToken === token) clearAppointedHost();
    if (player.socketId) io.to(player.socketId).emit('player:kicked');
    broadcastScoreboard();
    checkAllPlayersDoneAndAutoReveal(); // 추방으로 남은 참가자가 전부 오답/패스 상태가 됐다면 자동 공개
  });

  // 진행자: 특정 참가자의 닉네임을 수정 (오타 등을 진행자가 직접 고쳐줄 때 사용)
  socket.on('host:renamePlayer', ({ token, nickname } = {}) => {
    const player = state.players.get(token);
    if (!player) return;
    const name = (nickname || '').trim().slice(0, 20);
    if (!name) return;
    player.nickname = name;
    broadcastScoreboard();
    if (player.socketId) io.to(player.socketId).emit('player:renamed', { nickname: name });
  });

  // 참가자: 자기 자신의 닉네임을 직접 수정
  socket.on('player:renameSelf', (nickname) => {
    const token = state.socketToToken.get(socket.id);
    const player = state.players.get(token);
    if (!player) return;
    const name = (nickname || '').trim().slice(0, 20);
    if (!name) return;
    player.nickname = name;
    broadcastScoreboard();
    socket.emit('player:renamed', { nickname: name });
  });

  // 연결이 끊겨도 바로 제거하지 않고 잠시 기다린다 (화면 꺼짐/앱 전환 등으로
  // 인한 일시적 끊김일 수 있음). 그 사이 같은 token으로 재접속하면 위 player:join에서
  // 타이머가 취소되어 점수/닉네임이 그대로 유지된다.
  socket.on('disconnect', () => {
    if (state.hostSocketIds.delete(socket.id)) {
      io.emit('host:presence', { present: isHostPresent() });
    }
    const token = state.socketToToken.get(socket.id);
    state.socketToToken.delete(socket.id);
    if (!token) return;
    const player = state.players.get(token);
    if (!player || player.socketId !== socket.id) return; // 이미 다른 소켓으로 재접속함
    player.disconnectTimer = setTimeout(() => {
      state.players.delete(token);
      if (state.buzzLockedBy === token) {
        state.buzzLockedBy = null;
        clearBuzzTimer();
      }
      broadcastScoreboard();
      checkAllPlayersDoneAndAutoReveal(); // 남은 참가자가 전부 오답/패스 상태였다면 자동 공개
    }, DISCONNECT_GRACE_MS);
  });
});

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 포트 ${PORT}번이 이미 다른 프로그램에서 사용 중입니다.`);
    console.error(`   혹시 이 퀴즈 서버가 이미 다른 창에서 실행 중이지 않은지 확인해보세요.`);
    console.error(`   그래도 안 되면 .env 파일에 PORT=3001 처럼 다른 포트를 지정해보세요.`);
  } else {
    console.error('\n❌ 서버를 시작하는 중 오류가 발생했습니다:', err.message);
  }
  await pauseBeforeExitIfPackaged();
  process.exit(1);
});

// 항상 크롬으로 열리도록, 흔히 설치되는 경로들에서 chrome.exe를 직접 찾는다.
// (기본 브라우저 설정과 무관하게 크롬을 지정할 수 있는 가장 확실한 방법 —
// "start chrome ..."처럼 존재 여부를 모른 채 실행하면 크롬이 없을 때 윈도우가
// "프로그램을 찾을 수 없습니다" 팝업을 띄울 수 있어서, 미리 파일 존재를 확인한다.)
function findChromePath() {
  const candidates = [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];
  return candidates.find((p) => {
    try { return fs.existsSync(p); } catch (err) { return false; }
  });
}

// exe를 더블클릭해서 실행했을 때, 콘솔에 뜬 주소를 직접 입력할 필요 없이 바로 브라우저로
// 시작 화면(index.html - 문제 관리/진행자 화면 링크가 있는 곳)이 뜨도록 자동으로 열어준다.
// 크롬이 설치되어 있으면 (기본 브라우저 설정과 무관하게) 크롬으로 열고, 없으면 기본
// 브라우저로 대체한다. 브라우저를 못 찾는 등으로 실패해도 서버 자체는 계속 실행돼야
// 하므로 조용히 무시한다.
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      const chromePath = findChromePath();
      const child = chromePath
        ? execFile(chromePath, [url])
        : execFile('cmd', ['/c', 'start', '""', url]);
      child.on('error', () => {});
    } else if (process.platform === 'darwin') {
      const child = execFile('open', ['-a', 'Google Chrome', url], (err) => {
        if (err) execFile('open', [url]).on('error', () => {});
      });
      child.on('error', () => {});
    } else {
      const child = execFile('google-chrome', [url], (err) => {
        if (err) execFile('xdg-open', [url]).on('error', () => {});
      });
      child.on('error', () => {});
    }
  } catch (err) {
    // 무시
  }
}

server.listen(PORT, () => {
  console.log(`\n보드게임 사운드 퀴즈쇼 서버가 실행 중입니다.`);
  console.log(`시작 화면: http://localhost:${PORT}/index.html`);
  console.log(`PC(진행자):  http://localhost:${PORT}/host.html`);
  console.log(`관리자(문제 등록): http://localhost:${PORT}/admin.html`);
  console.log(`참가자(모바일)는 같은 Wi-Fi에서 http://<이 PC의 IP>:${PORT}/player.html 로 접속하세요.\n`);
  if (process.pkg) openBrowser(`http://localhost:${PORT}/index.html`);
});
