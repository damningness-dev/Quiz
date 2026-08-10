// exe로 실행 중일 때, 진행자가 쓰는 화면(index.html/host.html/admin.html)이 전부 닫히면
// 서버(콘솔 창)도 같이 꺼지도록 주기적으로 "아직 열려있다"는 신호를 보낸다.
// (참가자용 player.html에는 일부러 넣지 않는다 — 참가자가 자기 폰 브라우저를 닫는다고
// 서버 전체가 꺼져버리면 안 되기 때문)
(function () {
  function ping() {
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  }
  ping();
  setInterval(ping, 5000);
})();
