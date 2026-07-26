#!/usr/bin/env node
// 곡 제목/가수 목록(JSON)을 받아서, 유튜브 Data API로 각 곡의 실제 영상을 찾고
// 로컬에서 실행 중인 퀴즈 서버에 바로 등록하는 스크립트.
//
// 사용법 (~/Quiz 안에서, 서버가 켜져 있는 상태로 다른 창에서):
//   node termux/resolve-and-import.js data/song-lists/2000.json
//
// 입력 파일 형식 (배열):
//   [{ "year": 2000, "rank": 4, "artist": "가수", "song": "곡명", "note": "메모(선택)" }, ...]
//
// - 이미 등록된 곡(제목이 같음)이나 이전 실행에서 이미 처리한 곡(연도+순위 기준)은
//   건너뛴다.
// - 유튜브 Data API 무료 할당량(하루 10,000유니트, 검색 1회=100유니트 → 하루 약
//   100곡)을 다 쓰면 자동으로 멈추고 진행 상황을 저장해둔다. 다음날 같은 명령을
//   다시 실행하면 이어서 처리된다 (몇 번을 나눠 돌려도 안전).
// - .env의 YOUTUBE_API_KEY와, 이 서버(SERVER 환경변수, 기본 http://localhost:3000)를 사용한다.

require('dotenv').config();
const fs = require('fs');

const SERVER = process.env.QUIZ_SERVER || 'http://localhost:3000';
const API_KEY = process.env.YOUTUBE_API_KEY;

async function main() {
  const listFile = process.argv[2];
  if (!listFile) {
    console.error('사용법: node termux/resolve-and-import.js <곡목록.json>');
    process.exit(1);
  }
  if (!API_KEY) {
    console.error('.env에 YOUTUBE_API_KEY가 설정되어 있지 않습니다. README 2번을 참고해 키를 먼저 넣어주세요.');
    process.exit(1);
  }
  if (!fs.existsSync(listFile)) {
    console.error('파일을 찾을 수 없습니다: ' + listFile);
    process.exit(1);
  }

  const songs = JSON.parse(fs.readFileSync(listFile, 'utf-8'));
  const progressFile = listFile.replace(/\.json$/, '') + '.progress.json';
  let done = new Set();
  if (fs.existsSync(progressFile)) {
    done = new Set(JSON.parse(fs.readFileSync(progressFile, 'utf-8')));
  }

  let existingTitles = new Set();
  try {
    const existingRes = await fetch(SERVER + '/api/questions');
    const existing = await existingRes.json();
    existingTitles = new Set(existing.map((q) => q.title));
  } catch (err) {
    console.error(`서버(${SERVER})에 연결할 수 없습니다. 먼저 다른 창에서 서버를 실행해주세요. (${err.message})`);
    process.exit(1);
  }

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let quotaStopped = false;

  for (const s of songs) {
    const key = `${s.year}-${s.rank}`;
    const title = `${s.artist} - ${s.song}`;

    if (done.has(key) || existingTitles.has(title)) {
      skipCount++;
      continue;
    }

    try {
      const q = encodeURIComponent(`${s.artist} ${s.song}`);
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${q}&key=${API_KEY}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();

      if (!searchRes.ok) {
        const err = searchData.error || {};
        const reason = err.errors && err.errors[0] ? err.errors[0].reason : '';
        const isQuotaError = reason === 'quotaExceeded'
          || err.status === 'RESOURCE_EXHAUSTED'
          || (err.message && err.message.includes('Quota exceeded'));
        if (isQuotaError) {
          quotaStopped = true;
          break;
        }
        console.log(`❌ 검색 실패: ${title} - ${searchData.error ? searchData.error.message : searchRes.status}`);
        failCount++;
        continue;
      }

      const item = searchData.items && searchData.items[0];
      if (!item) {
        console.log(`❌ 검색 결과 없음: ${title}`);
        failCount++;
        done.add(key); // 결과가 없는 건 재시도해도 똑같을 가능성이 높으므로 넘어감으로 처리
        fs.writeFileSync(progressFile, JSON.stringify([...done]));
        continue;
      }

      const videoId = item.id.videoId;
      const createRes = await fetch(SERVER + '/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category: '가요',
          year: s.year,
          videoId,
          start: 0,
          end: '',
          note: s.note || `${s.year}년 ${s.rank}위`
        })
      });

      if (createRes.ok) {
        successCount++;
        console.log(`✅ [${s.year}] ${s.rank}위  ${title}  → ${videoId}`);
      } else {
        failCount++;
        const errData = await createRes.json().catch(() => ({}));
        console.log(`❌ 등록 실패: ${title} - ${errData.error || createRes.status}`);
      }

      done.add(key);
      fs.writeFileSync(progressFile, JSON.stringify([...done]));
    } catch (err) {
      failCount++;
      console.log(`❌ 오류: ${title} - ${err.message}`);
    }
  }

  console.log('');
  console.log(`완료 — 등록 ${successCount}곡, 건너뜀(이미 있음/결과없음) ${skipCount}곡, 실패 ${failCount}곡`);
  if (quotaStopped) {
    const remaining = songs.length - done.size;
    console.log(`⏸ 오늘 유튜브 API 할당량을 다 썼습니다. 남은 ${remaining}곡은 내일 같은 명령을 다시 실행하면 이어서 처리됩니다.`);
  }
}

main();
