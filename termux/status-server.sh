#!/data/data/com.termux/files/usr/bin/bash
# 보드게임 사운드 퀴즈쇼 서버 상태 확인 (Termux:Widget용)
# 이 파일을 ~/.shortcuts/ 안에 복사해두면 위젯에서 한 번의 터치로 실행됩니다.

notify() {
  if command -v termux-toast >/dev/null 2>&1; then
    termux-toast "$1"
  else
    echo "$1"
  fi
}

if pgrep -f "node server/index.js" >/dev/null 2>&1; then
  IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d/ -f1)
  notify "실행 중${IP:+ - http://$IP:3000}"
else
  notify "서버가 꺼져 있습니다."
fi
