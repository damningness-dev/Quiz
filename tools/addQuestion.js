// 서버를 켜지 않고도(npm start 없이) PC에서 바로 문제를 등록하는 대화형 CLI 도구.
// data/questions.json 파일을 직접 읽고 써서, admin.html에서 저장하는 것과
// 동일한 형식의 항목을 추가한다.
//
// 사용법:
//   node tools/addQuestion.js
//   (또는 package.json에 등록된 스크립트로) npm run add-question
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const QUESTIONS_FILE = path.join(__dirname, '..', 'data', 'questions.json');

function extractVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed; // 이미 11자리 videoId만 입력한 경우
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

function loadQuestions() {
  try {
    return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function saveQuestions(questions) {
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2), 'utf-8');
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// rl.question()을 그대로 연속 호출하면, 입력이 한꺼번에(파이프/붙여넣기 등) 들어올 때
// 먼저 도착한 줄들이 아직 리스너가 붙기 전에 소비되어 사라지는 타이밍 문제가 있다.
// 비동기 반복자(for-await 프로토콜)를 직접 당겨쓰면 내부 큐에 안전하게 쌓여
// 이런 유실 없이 순서대로 받을 수 있다.
function makeQuestioner(rl) {
  const it = rl[Symbol.asyncIterator]();
  return async function question(promptText) {
    process.stdout.write(promptText);
    const { value, done } = await it.next();
    if (done) throw new Error('입력이 예기치 않게 종료되었습니다.');
    return value;
  };
}

async function promptQuestion(question) {
  console.log('\n--- 새 문제 등록 ---');

  let title = '';
  while (!title) {
    title = (await question('이름 (정답, 필수): ')).trim();
    if (!title) console.log('  ⚠️ 이름은 비워둘 수 없습니다.');
  }

  const category = (await question('카테고리 (예: 보드게임, 가요 / 선택): ')).trim();

  let year = null;
  const yearInput = (await question('연도 (선택, 숫자만): ')).trim();
  if (yearInput) {
    const n = Number(yearInput);
    year = Number.isNaN(n) ? null : n;
  }

  let videoId = null;
  while (!videoId) {
    const urlInput = await question('유튜브 URL 또는 영상 ID (필수): ');
    videoId = extractVideoId(urlInput);
    if (!videoId) console.log('  ⚠️ 유효한 유튜브 URL 또는 11자리 영상 ID가 아닙니다.');
  }

  let start = 0;
  const startInput = (await question('시작 시간(초, 기본 0): ')).trim();
  if (startInput) {
    const n = Number(startInput);
    start = Number.isNaN(n) ? 0 : n;
  }

  let end = null;
  const endInput = (await question('종료 시간(초, 비워두면 끝까지): ')).trim();
  if (endInput) {
    const n = Number(endInput);
    end = Number.isNaN(n) ? null : n;
  }

  const note = (await question('메모 (선택): ')).trim();

  return {
    id: makeId(),
    category,
    year,
    title,
    videoId,
    start,
    end,
    note
  };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = makeQuestioner(rl);
  const questions = loadQuestions();

  console.log(`📋 현재 등록된 문제: ${questions.length}개`);
  console.log('서버를 켜지 않고도 data/questions.json에 바로 저장됩니다. (Ctrl+C로 언제든 중단 가능)');

  let addedCount = 0;
  try {
    let again = true;
    while (again) {
      const q = await promptQuestion(question);
      questions.push(q);
      saveQuestions(questions); // 한 문제씩 바로 저장 (중간에 중단돼도 앞서 등록한 건 남음)
      addedCount++;
      console.log(`  ✅ 등록됨: [${q.category || '-'}] ${q.year || '-'} · ${q.title}`);

      const more = (await question('\n다른 문제를 더 등록할까요? (Y/n): ')).trim().toLowerCase();
      again = more === '' || more === 'y' || more === 'yes';
    }
  } catch (err) {
    if (err.message !== '입력이 예기치 않게 종료되었습니다.') throw err;
  } finally {
    rl.close();
  }

  console.log(`\n==========================================`);
  console.log(`🎉 총 ${addedCount}개 문제를 등록했습니다. (전체 ${questions.length}개)`);
  console.log(`나중에 서버를 켜면(npm start) 자동으로 반영됩니다.`);
  console.log(`==========================================`);
}

main();
