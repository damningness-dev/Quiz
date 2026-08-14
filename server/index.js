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

// ---------- 메인 화면의 "서버 닫기" 버튼 ----------
// 응답을 먼저 보낸 뒤 서버(콘솔 창)를 종료한다. (예전엔 화면이 모두 닫히면 자동으로
// 서버도 종료되게 했었지만, background tab throttling 등으로 화면이 열려있는데도
// 오작동으로 서버가 꺼지는 버그가 있어 제거했다. 이제는 이 버튼으로만 종료한다.)
app.post('/api/shutdown', (req, res) => {
  res.sendStatus(204);
  console.log('\n"서버 닫기" 버튼으로 서버를 종료합니다.');
  setTimeout(() => process.exit(0), 200);
});

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

// ---------- 중복 문제 감지 ----------
// videoId가 완전히 같으면 확실한 중복으로 보고 기본적으로 등록을 막는다(강제
// 등록 옵션은 열어둠). 제목만 비슷한 경우(예: 재업로드, 라이브 버전 등)는
// 서로 다른 문제일 수도 있으므로 등록은 막지 않고 경고만 보여준다.
function bigrams(str) {
  const s = String(str).toLowerCase().replace(/\s+/g, '');
  const result = [];
  for (let i = 0; i < s.length - 1; i++) result.push(s.slice(i, i + 2));
  return result;
}

function titleSimilarity(a, b) {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (!bigramsA.length || !bigramsB.length) return 0;
  const counts = new Map();
  bigramsB.forEach((bg) => counts.set(bg, (counts.get(bg) || 0) + 1));
  let matches = 0;
  bigramsA.forEach((bg) => {
    const count = counts.get(bg) || 0;
    if (count > 0) {
      matches++;
      counts.set(bg, count - 1);
    }
  });
  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

const TITLE_SIMILARITY_THRESHOLD = 0.6;

// videoId가 같은 기존 문제가 있으면 그것을, 없으면 제목이 비슷한 기존 문제를
// 찾아 돌려준다(둘 다 없으면 null). excludeId는 수정 중인 문제 자신은 검사에서
// 빼기 위한 용도.
function findDuplicateQuestion(videoId, title, excludeId) {
  const exactMatch = questions.find((q) => q.videoId === videoId && q.id !== excludeId);
  if (exactMatch) return { type: 'videoId', match: exactMatch };
  let best = null;
  for (const q of questions) {
    if (q.id === excludeId) continue;
    const sim = titleSimilarity(title, q.title);
    if (sim >= TITLE_SIMILARITY_THRESHOLD && (!best || sim > best.sim)) best = { sim, match: q };
  }
  return best ? { type: 'title', match: best.match, similarity: best.sim } : null;
}

// ---------- 문제 관리 API ----------
app.get('/api/questions', (req, res) => {
  res.json(questions);
});

app.post('/api/questions', (req, res) => {
  const { title, videoId, start, end, note, category, year, allowDuplicate } = req.body;
  if (!title || !videoId) {
    return res.status(400).json({ error: 'title과 videoId는 필수입니다.' });
  }
  const dup = findDuplicateQuestion(videoId, title, null);
  if (dup && dup.type === 'videoId' && !allowDuplicate) {
    return res.status(409).json({
      error: `이미 등록된 영상입니다: "${dup.match.title}"`,
      duplicate: true,
      existing: { id: dup.match.id, title: dup.match.title }
    });
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
  const response = { ...question };
  if (dup && dup.type === 'title') {
    response.warning = `제목이 비슷한 문제가 이미 있습니다: "${dup.match.title}" (다른 곡/버전이면 무시하세요)`;
  }
  res.json(response);
});

app.put('/api/questions/:id', (req, res) => {
  const idx = questions.findIndex((q) => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
  const { title, videoId, start, end, note, category, year, allowDuplicate } = req.body;
  const nextVideoId = videoId ?? questions[idx].videoId;
  const nextTitle = title ?? questions[idx].title;
  const dup = findDuplicateQuestion(nextVideoId, nextTitle, req.params.id);
  if (dup && dup.type === 'videoId' && !allowDuplicate) {
    return res.status(409).json({
      error: `이미 등록된 영상입니다: "${dup.match.title}"`,
      duplicate: true,
      existing: { id: dup.match.id, title: dup.match.title }
    });
  }
  questions[idx] = {
    ...questions[idx],
    category: category !== undefined ? category : questions[idx].category,
    year: year !== undefined ? (year !== '' ? Number(year) : null) : questions[idx].year,
    title: nextTitle,
    videoId: nextVideoId,
    start: start !== undefined ? Number(start) : questions[idx].start,
    end: end !== undefined ? (end !== '' ? Number(end) : null) : questions[idx].end,
    note: note ?? questions[idx].note
  };
  saveQuestions(questions);
  const response = { ...questions[idx] };
  if (dup && dup.type === 'title') {
    response.warning = `제목이 비슷한 문제가 이미 있습니다: "${dup.match.title}" (다른 곡/버전이면 무시하세요)`;
  }
  res.json(response);
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
const APPOINTED_HOST_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 참가자 진행자가 이 시간 동안 아무 반응이 없으면 자동으로 진행자 권한을 잃음

// 이벤트 종류. 서버가 판정/버저 제한 로직의 기준으로 삼는 유일한 목록이라
// 클라이언트가 보내는 타입은 항상 이 목록에 있는지 검증한다.
const EVENT_TYPE_IDS = ['duel', 'multiplier', 'lowestFirst', 'oneVsMany'];

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
  appointedHostToken: null, // 실제 진행자(host.html)가 없을 때, 참가자 중 진행자로 지정된 사람의 토큰
  appointedHostLastActiveAt: null, // 참가자 진행자가 마지막으로 어떤 조작이든 한 시각 (무응답 자동 해제 판정용)
  scoreSettings: { correctPoints: 1, wrongPoints: 0 }, // 정답/오답 시 점수 변화량
  eventSettings: {
    enabled: false, // 이벤트 기능 전체 on/off
    triggerRate: 10, // 전체 발동 확률(%) — 매 문제마다 이벤트가 발동될지 여부를 이 확률로 결정
    events: {
      // enabled: 자동 발동 대상에 포함할지 여부, weight: 발동이 결정됐을 때 이 이벤트가 뽑힐 상대적 확률(%)
      duel: { enabled: true, weight: 25 },
      multiplier: { enabled: true, weight: 25 },
      lowestFirst: { enabled: true, weight: 25 },
      oneVsMany: { enabled: true, weight: 25 }
    }
  },
  pendingManualEvent: null, // 수동으로 예약된, 다음 문제에 발동될 이벤트 종류
  activeEvent: null // 지금 진행 중인 문제에 적용된 이벤트 (없으면 null)
};

// 지정된 진행자를 해제하고 모두에게 알린다 (진행자 추방/퇴장, 실제 진행자 접속 등으로 호출됨)
function clearAppointedHost() {
  if (state.appointedHostToken === null) return;
  state.appointedHostToken = null;
  state.appointedHostLastActiveAt = null;
  io.emit('host:appointed', { token: null });
}

// 참가자 진행자가 APPOINTED_HOST_IDLE_TIMEOUT_MS 동안 아무 조작도 하지 않으면
// 자동으로 진행자 권한을 풀어준다 (다른 참가자가 다시 진행자를 맡을 수 있도록).
setInterval(() => {
  if (state.appointedHostToken === null || state.appointedHostLastActiveAt === null) return;
  if (Date.now() - state.appointedHostLastActiveAt > APPOINTED_HOST_IDLE_TIMEOUT_MS) clearAppointedHost();
}, 30 * 1000);

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

// 이번 문제에서 실제로 부저를 누를 수 있는 참가자 토큰 목록. 평소엔 전원이지만,
// "1:1 대결"/"최하위 먼저 풀기" 이벤트가 걸려 있으면 그 대상자로만 좁혀진다.
function getEligibleBuzzTokens() {
  const allTokens = Array.from(state.players.keys());
  const event = state.activeEvent;
  if (event && event.type === 'duel') return event.duelTokens.filter((t) => state.players.has(t));
  if (event && event.type === 'lowestFirst') return event.eligibleTokens.filter((t) => state.players.has(t));
  return allTokens;
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
  const eligible = getEligibleBuzzTokens();
  if (eligible.length === 0) return;
  const allDone = eligible.every((token) => state.excludedFromBuzz.has(token) || state.passedPlayers.has(token));
  if (!allDone) return;
  const q = currentQuestion();
  state.revealed = true;
  io.emit('question:result', { correct: false, nickname: null, answer: q ? q.title : '', autoPassed: true });
}

// 자동 이벤트 확률 판정 및 수동 예약 이벤트를 확인해, 이번에 시작하는 문제에
// 적용할 이벤트를 하나 고른다(동시에 여러 이벤트가 겹치지 않게 하나만 선택).
// 1) 전체 발동 확률(triggerRate)로 "이번 문제에 이벤트가 발동되는지"를 먼저 정하고,
// 2) 발동이 결정되면 사용 체크된 이벤트들 중 개별 확률(weight)에 비례한 가중치 추첨으로
//    어떤 이벤트를 발동시킬지 고른다.
function determineActiveEvent() {
  if (state.pendingManualEvent) {
    const type = state.pendingManualEvent;
    state.pendingManualEvent = null;
    return buildEventInstance(type);
  }
  if (!state.eventSettings.enabled) return null;
  if (Math.random() * 100 >= Number(state.eventSettings.triggerRate)) return null;

  let candidates = EVENT_TYPE_IDS.filter((type) => state.eventSettings.events[type]?.enabled);
  while (candidates.length > 0) {
    const weights = candidates.map((type) => Math.max(0, Number(state.eventSettings.events[type].weight) || 0));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) return null;
    let roll = Math.random() * totalWeight;
    let picked = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { picked = candidates[i]; break; }
    }
    const instance = buildEventInstance(picked);
    if (instance) return instance;
    candidates = candidates.filter((type) => type !== picked); // 인원 부족 등으로 발동 불가하면 제외하고 다시 추첨
  }
  return null;
}

// 이벤트 종류별로 필요한 부가 정보(대결 상대, 배율, 대상자 등)를 채워 넣는다.
// 조건이 안 맞으면(예: 인원 부족) null을 돌려줘서 이벤트 없이 넘어가게 한다.
function buildEventInstance(type) {
  const tokens = Array.from(state.players.keys());
  if (type === 'duel') {
    if (tokens.length < 2) return null;
    const shuffled = [...tokens].sort(() => Math.random() - 0.5);
    const duelTokens = shuffled.slice(0, 2);
    return { type, duelTokens, duelNicknames: duelTokens.map((t) => state.players.get(t).nickname) };
  }
  if (type === 'multiplier') {
    const multiplier = 2 + Math.floor(Math.random() * 4); // 2~5배
    return { type, multiplier };
  }
  if (type === 'lowestFirst') {
    if (tokens.length === 0) return null;
    const minScore = Math.min(...tokens.map((t) => state.players.get(t).score));
    const eligibleTokens = tokens.filter((t) => state.players.get(t).score === minScore);
    return { type, eligibleTokens, eligibleNicknames: eligibleTokens.map((t) => state.players.get(t).nickname) };
  }
  if (type === 'oneVsMany') {
    return { type };
  }
  return null;
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
  const event = state.activeEvent;
  if (correct) {
    let points = state.scoreSettings.correctPoints;
    if (event && event.type === 'multiplier') points *= event.multiplier;
    player.score += points;
    state.revealed = true;
    const q = currentQuestion();
    io.emit('question:result', { correct: true, nickname: player.nickname, answer: q ? q.title : '', pointsAwarded: points });
    broadcastScoreboard();
  } else {
    player.score += state.scoreSettings.wrongPoints;
    // "1:다수" 이벤트: 먼저 버저 누른 사람이 틀리면, 그 문제는 거기서 끝나고
    // 나머지 전원("다수")이 대신 정답 점수를 받는다.
    if (event && event.type === 'oneVsMany') {
      const bonus = state.scoreSettings.correctPoints;
      for (const [tok, p] of state.players) {
        if (tok !== lockedId) p.score += bonus;
      }
      state.excludedFromBuzz.add(lockedId);
      state.buzzLockedBy = null;
      state.revealed = true;
      const q = currentQuestion();
      io.emit('question:result', {
        correct: false,
        nickname: player.nickname,
        answer: q ? q.title : '',
        oneVsManyAwarded: true,
        pointsAwarded: bonus
      });
      broadcastScoreboard();
      return;
    }
    state.excludedFromBuzz.add(lockedId);
    state.buzzLockedBy = null;
    io.emit('buzz:reset', { id: lockedId, nickname: player.nickname });
    broadcastScoreboard();
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
  socket.emit('score:settings', state.scoreSettings);
  socket.emit('event:settings', {
    enabled: state.eventSettings.enabled,
    triggerRate: state.eventSettings.triggerRate,
    events: state.eventSettings.events
  });

  // 참가자 진행자가 뭔가(버저, 판정, 설정 변경 등) 조작할 때마다 "마지막 활동 시각"을
  // 갱신해, 5분 동안 아무 반응이 없으면 자동으로 진행자 권한을 잃게 한다.
  socket.onAny(() => {
    const token = state.socketToToken.get(socket.id);
    if (token && token === state.appointedHostToken) state.appointedHostLastActiveAt = Date.now();
  });

  // 진행자: 정답/오답 시 점수 변화량 설정 (기본 정답 +1 / 오답 0)
  socket.on('host:setScoreSettings', ({ correctPoints, wrongPoints } = {}) => {
    if (correctPoints !== undefined && !isNaN(Number(correctPoints))) state.scoreSettings.correctPoints = Number(correctPoints);
    if (wrongPoints !== undefined && !isNaN(Number(wrongPoints))) state.scoreSettings.wrongPoints = Number(wrongPoints);
    io.emit('score:settings', state.scoreSettings);
  });

  // 진행자: 이벤트 기능 on/off, 전체 발동 확률, 종류별 사용여부/개별(선택) 확률 설정
  socket.on('host:setEventConfig', ({ enabled, triggerRate, events } = {}) => {
    state.eventSettings.enabled = !!enabled;
    if (triggerRate !== undefined && !isNaN(Number(triggerRate))) {
      state.eventSettings.triggerRate = Math.max(1, Math.min(100, Number(triggerRate)));
    }
    if (events && typeof events === 'object') {
      for (const type of EVENT_TYPE_IDS) {
        const cfg = events[type];
        if (!cfg) continue;
        state.eventSettings.events[type] = {
          enabled: !!cfg.enabled,
          weight: Math.max(0, Math.min(100, Number(cfg.weight) || 0))
        };
      }
    }
    io.emit('event:settings', {
      enabled: state.eventSettings.enabled,
      triggerRate: state.eventSettings.triggerRate,
      events: state.eventSettings.events
    });
  });

  // 진행자: 수동 이벤트를 다음 문제에 발동되도록 예약
  socket.on('host:triggerEventNextQuestion', (type) => {
    if (!EVENT_TYPE_IDS.includes(type)) return;
    state.pendingManualEvent = type;
    io.emit('event:pending', { type });
  });

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
    if (state.appointedHostToken !== null) return; // 이미 진행자로 지정된 사람이 있으면 다른 사람으로 바꿀 수 없음(먼저 스스로 내려놓거나 무응답으로 풀려야 함)
    if (!state.players.has(token)) return;
    state.appointedHostToken = token;
    state.appointedHostLastActiveAt = Date.now();
    io.emit('host:appointed', { token });
  });

  // 참가자 진행자 스스로 진행자 권한을 내려놓기
  socket.on('player:relinquishHost', () => {
    const token = state.socketToToken.get(socket.id);
    if (!token || state.appointedHostToken !== token) return;
    clearAppointedHost();
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
    state.activeEvent = determineActiveEvent();
    const q = questions[index];
    io.emit('question:show', {
      index,
      total: questions.length,
      videoId: q.videoId,
      start: q.start,
      end: q.end,
      event: state.activeEvent
    });
  });

  // 참가자: 부저
  socket.on('player:buzz', () => {
    const token = state.socketToToken.get(socket.id);
    if (!token || !state.players.has(token)) return;
    if (state.buzzLockedBy) return; // 이미 누군가 부저를 누름
    if (state.excludedFromBuzz.has(token)) return; // 이 문제에서 이미 오답 처리됨
    if (state.currentQuestionIndex === -1) return;
    if (!getEligibleBuzzTokens().includes(token)) return; // 이벤트로 버저 대상이 제한된 경우(1:1 대결, 최하위 먼저 풀기 등)
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
      // 진행자로 지정됐던 참가자가 오래 끊겨서 완전히 제거된 경우, 지정을 그대로
      // 두면 아무도 다시 진행자를 맡을 수 없는 상태로 멈춰버리므로 함께 해제한다.
      if (state.appointedHostToken === token) clearAppointedHost();
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
