#!/data/data/com.termux/files/usr/bin/bash
# 보드게임 사운드 퀴즈쇼 서버 시작 (Termux:Widget용)
# 이 파일을 ~/.shortcuts/ 안에 복사해두면 위젯에서 한 번의 터치로 실행됩니다.
#
# 안드로이드는 백그라운드로 돌린 프로세스를 강제 종료하는 경우가 많아서,
# 이 스크립트는 서버를 포그라운드로 실행합니다. 즉 이 창(Termux 세션)을
# 진행 중에 닫지 않고 그대로 켜두어야 서버가 계속 돌아갑니다.
# (화면을 잠그는 건 괜찮지만, Termux 앱을 완전히 종료하면 서버도 꺼집니다.)

PROJECT_DIR="$HOME/Quiz"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "프로젝트 폴더를 찾을 수 없습니다: $PROJECT_DIR"
  exit 1
fi

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

cd "$PROJECT_DIR" || exit 1

IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d/ -f1)
echo "퀴즈 서버를 시작합니다. 진행 중에는 이 창을 닫지 마세요."
[ -n "$IP" ] && echo "접속 주소: http://$IP:3000"
echo

exec node server/index.js
