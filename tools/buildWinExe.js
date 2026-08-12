// 윈도우용 단일 실행 파일(exe)을 만든다. Node.js를 따로 설치하지 않은 PC에서도
// exe를 더블클릭만 하면 서버가 뜨도록, @yao-pkg/pkg로 Node 런타임 자체를 exe 안에 넣는다.
//
// 사용법: npm run build:win
// 결과물: dist/QuizServer.exe (+ 옆에 data/ 폴더)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const EXE_PATH = path.join(DIST_DIR, 'QuizServer.exe');
const PKG_BIN = path.join(ROOT, 'node_modules', '.bin', 'pkg');
const LAUNCHER_BAT_PATH = path.join(DIST_DIR, 'QuizServer (최소화 실행).bat');

// QuizServer.exe는 이제 더블클릭으로 바로 실행해도 서버 자신이 스스로를 최소화
// 옵션으로 재실행해서 항상 작업표시줄로 최소화된 채 뜬다(server/index.js 참고).
// 이 런처는 그와 동일하게 동작하지만, 그래도 원하는 사람을 위해 계속 같이 제공한다.
// 콘솔 자체를 아예 없애버리면 오류 메시지도 못 보게 되므로(문제 진단이 안 됨),
// 완전히 숨기지 않고 최소화만 한다 — 필요하면 작업표시줄에서 클릭해 다시 볼 수 있다.
const LAUNCHER_BAT_CONTENT = '@echo off\r\nstart "QuizServer" /min "%~dp0QuizServer.exe"\r\n';

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
  console.log('🏗️  Windows exe 빌드를 시작합니다 (node22-win-x64)...\n');

  fs.mkdirSync(DIST_DIR, { recursive: true });

  execFileSync(
    PKG_BIN,
    // --no-bytecode: 리눅스 호스트에서 윈도우 타겟으로 크로스 컴파일하면 V8 바이트코드
    // 캐시가 호스트/타겟 간에 맞지 않아 실행 즉시 "V8 rejected the bytecode cache" 오류로
    // 죽는 문제가 있다. 바이트코드 캐싱을 아예 끄고 순수 JS 소스로 담아 이 문제를 피한다.
    ['.', '--targets', 'node22-win-x64', '--output', EXE_PATH, '--no-bytecode', '--public'],
    { cwd: ROOT, stdio: 'inherit' }
  );

  console.log('\n📦 실행에 필요한 파일들을 dist/ 옆에 준비합니다.');
  // data/questions.json은 exe 안(읽기 전용 스냅샷)이 아니라 exe 옆의 실제 파일로 둬야
  // 문제 등록/수정 시 쓰기가 가능하다. 이미 dist에 데이터가 있으면(재빌드 등) 덮어쓰지 않는다.
  copyIfMissing(path.join(ROOT, 'data', 'questions.json'), path.join(DIST_DIR, 'data', 'questions.json'), '문제 데이터');
  if (fs.existsSync(path.join(ROOT, '.env.example'))) {
    copyIfMissing(path.join(ROOT, '.env.example'), path.join(DIST_DIR, '.env.example'), '.env 예시');
  }
  fs.writeFileSync(LAUNCHER_BAT_PATH, LAUNCHER_BAT_CONTENT, 'utf-8');
  console.log(`  ✔ 최소화 실행 런처 작성: ${path.relative(ROOT, LAUNCHER_BAT_PATH)}`);

  console.log(`\n✅ 완료! ${path.relative(ROOT, EXE_PATH)} 를 윈도우 PC로 옮겨서 더블클릭하면 서버가 실행됩니다.`);
  console.log('   이제 그냥 더블클릭만 해도 항상 작업표시줄로 최소화된 채 실행됩니다 (필요하면 작업표시줄에서 클릭해 콘솔을 다시 볼 수 있어요).');
  console.log('   "QuizServer (최소화 실행).bat"도 동일하게 동작하니 원하는 쪽을 쓰면 됩니다.');
  console.log('   (data 폴더를 exe와 같은 위치에 함께 옮겨야 기존 문제들이 유지됩니다.)');
}

main();
