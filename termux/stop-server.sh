#!/data/data/com.termux/files/usr/bin/bash
# 보드게임 사운드 퀴즈쇼 서버 중지 (Termux:Widget용)
# 이 파일을 ~/.shortcuts/ 안에 복사해두면 위젯에서 한 번의 터치로 실행됩니다.

PROJECT_DIR="$HOME/Quiz"
PID_FILE="$PROJECT_DIR/.server.pid"

notify() {
  if command -v termux-toast >/dev/null 2>&1; then
    termux-toast "$1"
  else
    echo "$1"
  fi
}

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
  notify "퀴즈 서버를 중지했습니다."
else
  rm -f "$PID_FILE"
  notify "실행 중인 서버가 없습니다."
fi
