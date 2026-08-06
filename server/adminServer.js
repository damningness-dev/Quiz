// 게임 서버(socket.io, 부저 로직) 없이 "문제 관리(admin.html)" 화면만 띄우는 가벼운 서버.
// 콘솔 텍스트 프롬프트 대신, 검색 결과 썸네일/미리듣기/표 형태의 목록을 볼 수 있는
// admin.html을 브라우저로 열어서 좀 더 눈으로 보고 다루기 편하게 하려는 용도.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

// exe로 패키징된 경우(pkg) __dirname은 실행 파일 내부의 읽기 전용 가상 경로를 가리키므로,
// .env나 문제 데이터처럼 실제로 읽고 써야 하는 파일은 실행 파일(.exe)이 놓인 폴더를 기준으로 삼는다.
const DATA_BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

require('dotenv').config({ path: path.join(DATA_BASE_DIR, '.env') });
const express = require('express');

const app = express();

// exe를 더블클릭해서 실행했을 때는, 오류가 나서 프로세스가 죽으면 콘솔 창도 같이
// 닫혀버려서 무슨 에러였는지 읽을 새도 없이 사라진다. 그래서 여기서 잡히는 오류는
// 메시지를 출력한 뒤 "아무 키나 누르면 창이 닫히도록" 잠깐 멈춰서, 최소한 무엇이
// 문제인지는 보고 닫을 수 있게 한다.
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
  console.error('\n❌ 예기치 못한 오류로 종료됩니다:');
  console.error(err && err.stack ? err.stack : err);
  await pauseBeforeExitIfPackaged();
  process.exit(1);
});

process.on('unhandledRejection', async (err) => {
  console.error('\n❌ 처리되지 않은 오류로 종료됩니다:');
  console.error(err && err.stack ? err.stack : err);
  await pauseBeforeExitIfPackaged();
  process.exit(1);
});

// 게임 서버(QuizServer.exe, 기본 3000번 포트)와 동시에 띄워도 겹치지 않도록 기본 포트를 다르게 둔다.
const PORT = process.env.ADMIN_PORT || process.env.PORT || 3010;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const QUESTIONS_FILE = path.join(DATA_BASE_DIR, 'data', 'questions.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.redirect('/admin.html'));

// ---------- 문제 데이터 저장/로드 (server/index.js와 동일한 형식) ----------
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

// ---------- 로컬 IP 안내 ----------
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

// 서버가 뜨자마자 기본 브라우저로 admin.html을 열어준다 (탐색기 아이콘 더블클릭하듯
// 바로 화면이 보이게). 실패해도(브라우저를 못 찾음 등) 서버 자체는 계속 실행되어야
// 하므로 조용히 무시하고, 콘솔에 뜬 주소를 직접 열면 된다.
function openBrowser(url) {
  try {
    let child;
    if (process.platform === 'win32') child = execFile('cmd', ['/c', 'start', '""', url]);
    else if (process.platform === 'darwin') child = execFile('open', [url]);
    else child = execFile('xdg-open', [url]);
    child.on('error', () => {});
  } catch (err) {
    // 무시
  }
}

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}/admin.html`;
  console.log(`\n🛠️  문제 관리 화면 서버가 실행 중입니다.`);
  console.log(`주소: ${url}`);
  console.log(`잠시 후 브라우저가 자동으로 열립니다. 안 열리면 위 주소를 직접 여세요.\n`);
  openBrowser(url);
});

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 포트 ${PORT}번이 이미 다른 프로그램에서 사용 중입니다.`);
    console.error(`   .env 파일에 ADMIN_PORT=3011 처럼 다른 포트를 지정해보세요.`);
  } else {
    console.error('\n❌ 서버를 시작하는 중 오류가 발생했습니다:', err.message);
  }
  await pauseBeforeExitIfPackaged();
  process.exit(1);
});
