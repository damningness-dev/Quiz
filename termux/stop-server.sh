#!/data/data/com.termux/files/usr/bin/bash
# 보드게임 사운드 퀴즈쇼 서버 중지 (Termux:Widget용)
# 이 파일을 ~/.shortcuts/ 안에 복사해두면 위젯에서 한 번의 터치로 실행됩니다.
# start-server.sh를 실행 중인 세션을 직접 못 찾더라도, 프로세스 이름으로 찾아 종료합니다.

notify() {
  if command -v termux-toast >/dev/null 2>&1; then
    termux-toast "$1"
  else
    echo "$1"
  fi
}

if pkill -f "node server/index.js"; then
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
  notify "퀴즈 서버를 중지했습니다."
else
  notify "실행 중인 서버가 없습니다."
fi
