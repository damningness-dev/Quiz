// 문제 관리(admin.html) 화면만 브라우저로 띄우는 가벼운 윈도우 exe를 만든다.
// 게임 서버(socket.io, 부저 로직) 없이 문제 등록/검색/수정/삭제 화면만 필요할 때 쓴다.
//
// 사용법: npm run build:win:admin
// 결과물: dist/QuizAdmin.exe (+ 옆에 data/ 폴더)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const EXE_PATH = path.join(DIST_DIR, 'QuizAdmin.exe');
const PKG_BIN = path.join(ROOT, 'node_modules', '.bin', 'pkg');
const ENTRY = path.join(ROOT, 'server', 'adminServer.js');

function copyIfMissing(srcPath, destPath, label) {
  if (fs.existsSync(destPath)) {
    console.log(`  ⏭️  ${label} 이미 있어 건너뜀 (기존 파일을 덮어쓰지 않음): ${path.relative(ROOT, destPath)}`);
    return;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.cpSync(srcPath, destPath, { recursive: true });
  console.log(`  ✔ ${label} 복사: ${path.relative(ROOT, destPath)}`);
}

function main() {
  console.log('🏗️  문제 관리 화면용 Windows exe 빌드를 시작합니다 (node22-win-x64)...\n');

  fs.mkdirSync(DIST_DIR, { recursive: true });

  execFileSync(
    PKG_BIN,
    // --no-bytecode: 리눅스 호스트에서 윈도우 타겟으로 크로스 컴파일하면 V8 바이트코드
    // 캐시가 호스트/타겟 간에 맞지 않아 실행 즉시 죽는 문제가 있어(pkg 알려진 제약)
    // 바이트코드 캐싱을 아예 끄고 순수 JS 소스로 담는다.
    [
      ENTRY, '--targets', 'node22-win-x64', '--output', EXE_PATH,
      '--no-bytecode', '--public',
      '--config', path.join(ROOT, 'package.json') // public/**/* 등 assets 설정을 그대로 사용
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );

  console.log('\n📦 실행에 필요한 파일들을 dist/ 옆에 준비합니다.');
  copyIfMissing(path.join(ROOT, 'data', 'questions.json'), path.join(DIST_DIR, 'data', 'questions.json'), '문제 데이터');
  if (fs.existsSync(path.join(ROOT, '.env.example'))) {
    copyIfMissing(path.join(ROOT, '.env.example'), path.join(DIST_DIR, '.env.example'), '.env 예시');
  }

  console.log(`\n✅ 완료! ${path.relative(ROOT, EXE_PATH)} 를 윈도우 PC로 옮겨서 더블클릭하면`);
  console.log('   콘솔 창이 뜨고 잠시 후 브라우저에 문제 관리 화면이 자동으로 열립니다.');
  console.log('   (data 폴더를 exe와 같은 위치에 함께 옮겨야 기존 문제들이 유지/반영됩니다.)');
  console.log('   유튜브 자동 검색을 쓰려면 dist/.env.example을 참고해 .env로 이름을 바꿔 같은 위치에 두세요.');
}

main();
