require('dotenv').config();
const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const QUESTIONS_FILE = path.join(__dirname, '..', 'data', 'questions.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2), 'utf-8');
}

let questions = loadQuestions();

// ---------- 문제 관리 API ----------
app.get('/api/questions', (req, res) => {
  res.json(questions);
});

app.post('/api/questions', (req, res) => {
  const { title, videoId, start, end, note } = req.body;
  if (!title || !videoId) {
    return res.status(400).json({ error: 'title과 videoId는 필수입니다.' });
  }
  const question = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
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
  const { title, videoId, start, end, note } = req.body;
  questions[idx] = {
    ...questions[idx],
    title: title ?? questions[idx].title,
    videoId: videoId ?? questions[idx].videoId,
    start: start !== undefined ? Number(start) : questions[idx].start,
    end: end !== undefined && end !== '' ? Number(end) : questions[idx].end,
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
const state = {
  players: new Map(), // socketId -> { id, nickname, score }
  currentQuestionIndex: -1,
  buzzLockedBy: null, // socketId
  excludedFromBuzz: new Set(), // 오답 처리된 참가자 (같은 문제에서 재도전 불가)
  revealed: false
};

function publicScoreboard() {
  return Array.from(state.players.values())
    .map((p) => ({ id: p.id, nickname: p.nickname, score: p.score }))
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

  // 참가자 입장
  socket.on('player:join', (nickname) => {
    const name = (nickname || '').trim().slice(0, 20) || `참가자${socket.id.slice(0, 4)}`;
    state.players.set(socket.id, { id: socket.id, nickname: name, score: 0 });
    socket.emit('player:joined', { id: socket.id, nickname: name });
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
    state.excludedFromBuzz = new Set();
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
    if (!state.players.has(socket.id)) return;
    if (state.buzzLockedBy) return; // 이미 누군가 부저를 누름
    if (state.excludedFromBuzz.has(socket.id)) return; // 이 문제에서 이미 오답 처리됨
    if (state.currentQuestionIndex === -1) return;
    state.buzzLockedBy = socket.id;
    const player = state.players.get(socket.id);
    io.emit('buzz:locked', { id: player.id, nickname: player.nickname });
  });

  // 진행자: 정답/오답 판정
  socket.on('host:judge', (correct) => {
    const lockedId = state.buzzLockedBy;
    if (!lockedId || !state.players.has(lockedId)) return;
    const player = state.players.get(lockedId);
    if (correct) {
      player.score += 1;
      state.revealed = true;
      const q = currentQuestion();
      io.emit('question:result', {
        correct: true,
        nickname: player.nickname,
        answer: q ? q.title : ''
      });
      broadcastScoreboard();
    } else {
      state.excludedFromBuzz.add(lockedId);
      state.buzzLockedBy = null;
      io.emit('buzz:reset', { id: lockedId, nickname: player.nickname });
    }
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
    io.emit('buzz:cleared');
  });

  socket.on('disconnect', () => {
    if (state.players.has(socket.id)) {
      state.players.delete(socket.id);
      if (state.buzzLockedBy === socket.id) state.buzzLockedBy = null;
      broadcastScoreboard();
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n보드게임 사운드 퀴즈쇼 서버가 실행 중입니다.`);
  console.log(`PC(진행자):  http://localhost:${PORT}/host.html`);
  console.log(`관리자(문제 등록): http://localhost:${PORT}/admin.html`);
  console.log(`참가자(모바일)는 같은 Wi-Fi에서 http://<이 PC의 IP>:${PORT}/player.html 로 접속하세요.\n`);
});
