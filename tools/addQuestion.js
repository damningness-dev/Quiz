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

// exe로 패키징된 경우(pkg) __dirname은 실행 파일 내부의 읽기 전용 가상 경로를 가리키므로,
// 실제로 읽고 써야 하는 파일(.env, 문제 데이터)은 실행 파일(.exe)이 놓인 폴더를 기준으로 삼는다.
const DATA_BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
require('dotenv').config({ path: path.join(DATA_BASE_DIR, '.env') });
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const QUESTIONS_FILE = path.join(DATA_BASE_DIR, 'data', 'questions.json');

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

// admin.html의 유튜브 검색과 동일한 YouTube Data API v3 검색을 그대로 호출한다.
async function searchYoutube(query) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('q', query);
  url.searchParams.set('key', YOUTUBE_API_KEY);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || '유튜브 검색 실패');
  }
  return (data.items || [])
    .filter((item) => item.id && item.id.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle
    }));
}

// 먼저 유튜브에서 검색해 목록 중 하나를 고르고, 그 영상의 videoId/제목을 반환한다.
// API 키가 없거나 검색어를 비워두고 Enter만 누르면 URL/영상 ID 직접 입력으로 넘어간다.
async function selectVideo(question) {
  while (true) {
    if (YOUTUBE_API_KEY) {
      const keyword = (await question('유튜브 검색어 (Enter만 누르면 URL을 직접 입력): ')).trim();
      if (keyword) {
        console.log('  🔎 검색 중...');
        let results;
        try {
          results = await searchYoutube(keyword);
        } catch (err) {
          console.log(`  ⚠️ 검색 실패: ${err.message}`);
          continue;
        }
        if (!results.length) {
          console.log('  검색 결과가 없습니다. 다른 검색어로 다시 시도하세요.');
          continue;
        }
        results.forEach((r, i) => {
          console.log(`  [${i + 1}] ${r.title}  (${r.channelTitle})`);
        });
        let picked = false;
        while (!picked) {
          const pick = (await question(`번호를 선택하세요 (1-${results.length}, 0=다시 검색): `)).trim();
          const idx = Number(pick);
          if (!pick || idx === 0) { picked = true; break; } // 바깥 while로 나가 검색어부터 다시
          if (Number.isInteger(idx) && idx >= 1 && idx <= results.length) {
            const chosen = results[idx - 1];
            console.log(`  ✔ 선택됨: ${chosen.title}`);
            return chosen;
          }
          console.log('  ⚠️ 올바른 번호를 입력하세요.');
        }
        continue;
      }
      // 검색어를 비워뒀으면 아래에서 URL 직접 입력으로 넘어간다.
    }

    let videoId = null;
    while (!videoId) {
      const urlInput = await question('유튜브 URL 또는 영상 ID (필수): ');
      videoId = extractVideoId(urlInput);
      if (!videoId) console.log('  ⚠️ 유효한 유튜브 URL 또는 11자리 영상 ID가 아닙니다.');
    }
    return { videoId, title: null };
  }
}

function loadQuestions() {
  try {
    return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function saveQuestions(questions) {
  fs.mkdirSync(path.dirname(QUESTIONS_FILE), { recursive: true }); // exe를 처음 실행할 때 data 폴더가 없을 수 있음
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2), 'utf-8');
}

// exe를 더블클릭해서 실행했을 때 오류로 죽으면 콘솔 창도 같이 닫혀버려 원인을 읽을
// 새가 없다. 그래서 패키징된 윈도우 exe에서만 종료 전 잠깐 멈춰 메시지를 볼 수 있게 한다.
// (cmd.exe 등 외부 프로세스를 새로 띄우면 일부 백신이 의심스러운 동작으로 보고 통째로
// 종료시킬 수 있어서, 프로세스를 새로 띄우지 않고 순수 Node 코드로만 키 입력을 기다린다.)
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

  const video = await selectVideo(question);

  let title = '';
  while (!title) {
    const suggestion = video.title;
    const promptText = suggestion
      ? `이름 (정답, 필수) [Enter=${suggestion}]: `
      : '이름 (정답, 필수): ';
    const input = (await question(promptText)).trim();
    title = input || suggestion || '';
    if (!title) console.log('  ⚠️ 이름은 비워둘 수 없습니다.');
  }

  const category = (await question('카테고리 (예: 보드게임, 가요 / 선택): ')).trim();

  let year = null;
  const yearInput = (await question('연도 (선택, 숫자만): ')).trim();
  if (yearInput) {
    const n = Number(yearInput);
    year = Number.isNaN(n) ? null : n;
  }

  const videoId = video.videoId;

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
  console.log(
    YOUTUBE_API_KEY
      ? '🔎 유튜브 자동 검색을 사용합니다. (검색어를 비워두고 Enter만 누르면 URL을 직접 입력할 수 있어요)'
      : '⚠️ YOUTUBE_API_KEY가 설정되어 있지 않아 유튜브 URL을 직접 입력해야 합니다. (.env에 키를 넣으면 검색을 쓸 수 있어요)'
  );

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
  console.log(`나중에 서버를 실행하면 자동으로 반영됩니다.`);
  console.log(`==========================================`);
  await pauseBeforeExitIfPackaged();
}

main().catch(async (err) => {
  console.error('\n❌ 예기치 못한 오류가 발생했습니다:');
  console.error(err && err.stack ? err.stack : err);
  await pauseBeforeExitIfPackaged();
  process.exitCode = 1;
});
