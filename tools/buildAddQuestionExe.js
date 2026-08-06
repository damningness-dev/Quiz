// 서버(QuizServer.exe)를 켜지 않고, 문제 등록 CLI(tools/addQuestion.js)만 담은
// 가벼운 윈도우 exe를 만든다. 포트를 열거나 네트워크를 쓰지 않으므로 방화벽/포트
// 충돌과 무관하게 동작한다.
//
// 사용법: npm run build:win:add-question
// 결과물: dist/AddQuestion.exe (+ 옆에 data/ 폴더)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const EXE_PATH = path.join(DIST_DIR, 'AddQuestion.exe');
const PKG_BIN = path.join(ROOT, 'node_modules', '.bin', 'pkg');
const ENTRY = path.join(ROOT, 'tools', 'addQuestion.js');

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
  console.log('🏗️  문제 등록용 Windows exe 빌드를 시작합니다 (node22-win-x64)...\n');

  fs.mkdirSync(DIST_DIR, { recursive: true });

  execFileSync(
    PKG_BIN,
    // --no-bytecode: 리눅스 호스트에서 윈도우 타겟으로 크로스 컴파일하면 V8 바이트코드
    // 캐시가 호스트/타겟 간에 맞지 않아 실행 즉시 "V8 rejected the bytecode cache" 오류로
    // 죽는 문제가 있다. 바이트코드 캐싱을 아예 끄고 순수 JS 소스로 담아 이 문제를 피한다.
    [ENTRY, '--targets', 'node22-win-x64', '--output', EXE_PATH, '--no-bytecode', '--public'],
    { cwd: ROOT, stdio: 'inherit' }
  );

  console.log('\n📦 문제 데이터를 dist/ 옆에 준비합니다.');
  copyIfMissing(path.join(ROOT, 'data', 'questions.json'), path.join(DIST_DIR, 'data', 'questions.json'), '문제 데이터');

  console.log(`\n✅ 완료! ${path.relative(ROOT, EXE_PATH)} 를 윈도우 PC로 옮겨서 더블클릭하면 바로 문제 등록을 시작합니다.`);
  console.log('   (data 폴더를 exe와 같은 위치에 함께 옮겨야 기존 문제들이 유지/반영됩니다.)');
  console.log('   서버(QuizServer.exe)와 같은 폴더에 두면 같은 data 폴더를 공유해서 등록한 문제가 바로 반영됩니다.');
}

main();
