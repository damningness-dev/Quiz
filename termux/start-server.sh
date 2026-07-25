#!/data/data/com.termux/files/usr/bin/bash
# 보드게임 사운드 퀴즈쇼 서버 시작 (Termux:Widget용)
# 이 파일을 ~/.shortcuts/ 안에 복사해두면 위젯에서 한 번의 터치로 실행됩니다.

# 프로젝트를 다른 경로에 clone했다면 아래 경로를 수정하세요.
PROJECT_DIR="$HOME/Quiz"
PID_FILE="$PROJECT_DIR/.server.pid"
LOG_FILE="$PROJECT_DIR/.server.log"

notify() {
  if command -v termux-toast >/dev/null 2>&1; then
    termux-toast "$1"
  else
    echo "$1"
  fi
}

if [ ! -d "$PROJECT_DIR" ]; then
  notify "프로젝트 폴더를 찾을 수 없습니다: $PROJECT_DIR"
  exit 1
fi

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  notify "이미 서버가 실행 중입니다."
  exit 0
fi

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

cd "$PROJECT_DIR" || exit 1
nohup node server/index.js > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
disown

sleep 1
if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d/ -f1)
  notify "퀴즈 서버 시작됨${IP:+ (http://$IP:3000)}"
else
  notify "서버 시작 실패. $LOG_FILE 를 확인하세요."
fi
