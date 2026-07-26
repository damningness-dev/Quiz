#!/data/data/com.termux/files/usr/bin/bash
# git post-merge 훅: `git pull`이 실제로 새 커밋을 받아왔을 때(merge/fast-forward
# 발생 시) git이 자동으로 실행해준다. (변경 사항이 없어서 "Already up to date"였다면
# 이 스크립트는 아예 실행되지 않는다.)
#
# 설치 방법(최초 1회, ~/Quiz 안에서):
#   ln -sf ../../termux/post-merge-hook.sh .git/hooks/post-merge
#   chmod +x termux/post-merge-hook.sh .git/hooks/post-merge
#
# 설치해두면 이후로는 그냥 `git pull`만 치면, 새 코드를 받자마자 서버가
# 자동으로 (재)시작된다. 이 훅은 pull을 실행한 그 터미널 세션 자체를
# 서버로 전환시키므로(exec), 그 창을 진행 중에 닫지 않아야 하는 건
# 수동으로 서버를 켤 때와 동일하다.

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$PROJECT_DIR" ] && exit 0
cd "$PROJECT_DIR" || exit 0

pkill -f "node server/index.js" 2>/dev/null
sleep 1

echo ""
echo "🔄 새 코드를 받아서 서버를 (재)시작합니다. 진행 중에는 이 창을 닫지 마세요."
echo "   (그만하려면 Ctrl+C)"
echo ""

exec node server/index.js
