const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ==========================================
// 1. 설정 및 파일 경로 정의
// ==========================================
const CONFIG = {
  API_KEY: process.env.YOUTUBE_API_KEY || 'YOUR_YOUTUBE_API_KEY', // 환경변수 또는 직접 입력
  SERVER_URL: process.env.SERVER_URL || 'http://localhost:3000/api/songs', // 서버 API 주소
  INPUT_FILE: path.join(__dirname, 'songs.json'),       // 등록할 노래 목록
  PROGRESS_FILE: path.join(__dirname, 'progress.json'), // 성공한 항목 저장
  FAILED_FILE: path.join(__dirname, 'failed.json'),     // 실패한 항목 저장
  DEBUG: process.argv.includes('--debug'),              // --debug 옵션 플래그
};

// ==========================================
// 2. 검색 결과 점수 계산 함수 (핵심 로직)
// ==========================================
function calculateScore(item, artist, song, categoryId = null) {
  let score = 0;
  const title = (item.snippet.title || '').toLowerCase();
  const channelTitle = (item.snippet.channelTitle || '').toLowerCase();
  const description = (item.snippet.description || '').toLowerCase();

  const cleanArtist = artist.toLowerCase().trim();
  const cleanSong = song.toLowerCase().trim();

  // 1) 아티스트 및 곡명 일치 가산점
  if (title.includes(cleanArtist)) score += 50;
  if (title.includes(cleanSong)) score += 50;

  // 2) Official / MV / Topic 키워드 가산점
  if (/official|m\/v|official video|mv/i.test(title)) score += 30;
  if (/topic/i.test(channelTitle) || /topic/i.test(title)) score += 20;

  // 3) 제외 대상 감점 (노래방, 커버, 라이브, 1시간 반복 등)
  if (/cover|karaoke|tj|금영|ky|1시간|hour|live|직캠|fancam|mr|inst/i.test(title)) {
    score -= 100;
  }

  // 4) 음악 카테고리(10) 가산점 (Video API 재조회 데이터가 있을 경우)
  if (categoryId === '10') {
    score += 40;
  }

  return score;
}

// ==========================================
// 3. 유틸리티 함수 (유효성, 파일 저장/읽기)
// ==========================================
function loadJson(filePath, defaultValue = []) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`[경고] ${filePath} 읽기 실패. 기본값으로 진행합니다.`);
    }
  }
  return defaultValue;
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Delay 함수 (API 호출 간격 조절용)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// 4. YouTube API 검색 및 검증 로직
// ==========================================

// 1단계: 검색 API (maxResults=10, KR, ko)
async function searchYouTube(artist, song) {
  const q = encodeURIComponent(`${artist} ${song} official`);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&regionCode=KR&relevanceLanguage=ko&q=${q}&key=${CONFIG.API_KEY}`;

  try {
    const res = await axios.get(url);
    return res.data.items || [];
  } catch (error) {
    if (error.response && error.response.status === 403) {
      const isQuota = error.response.data?.error?.errors?.some(e => e.reason === 'quotaExceeded');
      if (isQuota) {
        throw new Error('QUOTA_EXCEEDED');
      }
    }
    console.error(`[검색 실패] ${artist} - ${song}:`, error.message);
    return [];
  }
}

// 2단계: Video API를 이용한 카테고리(videoCategoryId) 확인
async function getVideoDetails(videoIds) {
  if (!videoIds || videoIds.length === 0) return {};
  const idsParam = videoIds.join(',');
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${idsParam}&key=${CONFIG.API_KEY}`;

  try {
    const res = await axios.get(url);
    const categoryMap = {};
    (res.data.items || []).forEach((item) => {
      categoryMap[item.id] = item.snippet.categoryId;
    });
    return categoryMap;
  } catch (error) {
    if (error.response && error.response.status === 403) {
      const isQuota = error.response.data?.error?.errors?.some(e => e.reason === 'quotaExceeded');
      if (isQuota) throw new Error('QUOTA_EXCEEDED');
    }
    console.error(`[상세조회 실패] Video IDs details fetch failed:`, error.message);
    return {};
  }
}

// 가장 적절한 영상 1개 채택
async function findBestVideo(artist, song) {
  const items = await searchYouTube(artist, song);
  if (items.length === 0) return null;

  // Video ID 목록 추출 후 카테고리 정보 가져오기
  const videoIds = items.map((it) => it.id.videoId).filter(Boolean);
  let categoryMap = {};
  try {
    categoryMap = await getVideoDetails(videoIds);
  } catch (e) {
    if (e.message === 'QUOTA_EXCEEDED') throw e;
  }

  // 각 검색 결과별 점수 계산
  const scoredItems = items.map((item, index) => {
    const videoId = item.id.videoId;
    const categoryId = categoryMap[videoId] || null;
    const score = calculateScore(item, artist, song, categoryId);
    return { item, videoId, score, index: index + 1 };
  });

  // 디버그 모드일 때 전체 후보군 출력
  if (CONFIG.DEBUG) {
    console.log(`\n--- [DEBUG] ${artist} - ${song} 후보군 목록 ---`);
    scoredItems.forEach((cand) => {
      console.log(
        ` [${cand.index}] 점수: ${cand.score} | ID: ${cand.videoId} | 제목: ${cand.item.snippet.title}`
      );
    });
  }

  // 점수 내림차순 정렬
  scoredItems.sort((a, b) => b.score - a.score);

  // 최고 점수 항목 선택 (단, 최하점 기준 이하 제외 설정 가능)
  const best = scoredItems[0];
  if (best && best.score > -50) {
    return {
      videoId: best.videoId,
      title: best.item.snippet.title,
      score: best.score,
    };
  }

  return null;
}

// ==========================================
// 5. 서버 등록 API 호출
// ==========================================
async function registerToServer(songData, videoInfo) {
  const payload = {
    artist: songData.artist,
    song: songData.song,
    videoId: videoInfo.videoId,
    videoTitle: videoInfo.title,
  };

  try {
    const res = await axios.post(CONFIG.SERVER_URL, payload);
    return res.status === 200 || res.status === 201;
  } catch (error) {
    console.error(`[서버 등록 실패] ${songData.artist} - ${songData.song}:`, error.message);
    return false;
  }
}

// ==========================================
// 6. 메인 실행 함수
// ==========================================
async function main() {
  console.log('🚀 곡 자동 검색 및 등록 프로세스를 시작합니다.');
  if (CONFIG.DEBUG) console.log('🔧 [DEBUG 모드 활성화됨]');

  const songs = loadJson(CONFIG.INPUT_FILE);
  const progress = loadJson(CONFIG.PROGRESS_FILE);
  const failed = loadJson(CONFIG.FAILED_FILE);

  // 이미 성공했거나 실패 처리된 ID/식별자 집합
  const processedKeys = new Set(progress.map((p) => `${p.artist}_${p.song}`));

  console.log(`총 ${songs.length}곡 중 기존 완료된 ${processedKeys.size}곡을 제외하고 진행합니다.\n`);

  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    const key = `${s.artist}_${s.song}`;

    // 이미 처리된 곡 건너뛰기
    if (processedKeys.has(key)) {
      skipCount++;
      continue;
    }

    console.log(`[${i + 1}/${songs.length}] Processing: ${s.artist} - ${s.song}`);

    try {
      // 1. 유튜브 매칭 영상 찾기
      const bestVideo = await findBestVideo(s.artist, s.song);

      if (!bestVideo) {
        console.log(`  ❌ 적절한 영상을 찾지 못했습니다.`);
        failed.push({ ...s, reason: 'NOT_FOUND', date: new Date().toISOString() });
        saveJson(CONFIG.FAILED_FILE, failed);
        processedKeys.add(key);
        continue;
      }

      console.log(`  🎯 채택된 영상: [${bestVideo.videoId}] ${bestVideo.title} (점수: ${bestVideo.score})`);

      // 2. 서버로 등록 요청
      const registered = await registerToServer(s, bestVideo);

      if (registered) {
        console.log(`  ✅ 서버 등록 성공!`);
        progress.push({
          ...s,
          videoId: bestVideo.videoId,
          videoTitle: bestVideo.title,
          registeredAt: new Date().toISOString(),
        });
        saveJson(CONFIG.PROGRESS_FILE, progress);
        processedKeys.add(key);
        successCount++;
      } else {
        console.log(`  ❌ 서버 등록 실패`);
        failed.push({ ...s, reason: 'SERVER_ERROR', date: new Date().toISOString() });
        saveJson(CONFIG.FAILED_FILE, failed);
        processedKeys.add(key);
      }

      // API 호출 간격 준수 (0.5초 대기)
      await sleep(500);

    } catch (error) {
      if (error.message === 'QUOTA_EXCEEDED') {
        console.error('\n🛑 [STOP] YouTube API 일일 할당량(Quota)을 초과했습니다.');
        console.error('현재 진행 상황까지 저장되었으며, 할당량이 초기화된 후 다시 실행하면 이어서 진행됩니다.');
        break;
      }

      console.error(`  ⚠️ 예상치 못한 에러 발생:`, error.message);
      failed.push({ ...s, reason: error.message, date: new Date().toISOString() });
      saveJson(CONFIG.FAILED_FILE, failed);
      processedKeys.add(key);
    }
  }

  console.log('\n==========================================');
  console.log(`🎉 작업 종료! 신규 등록: ${successCount}건 / 건너뜀: ${skipCount}건`);
  console.log('==========================================');
}

// 스크립트 실행
main();
