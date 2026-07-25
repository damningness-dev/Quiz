function extractVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  // 이미 11자리 videoId만 붙여넣은 경우
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const searchHint = document.getElementById('search-hint');

const formTitle = document.getElementById('form-title');
const qTitle = document.getElementById('q-title');
const qCategory = document.getElementById('q-category');
const qYear = document.getElementById('q-year');
const categoryOptions = document.getElementById('category-options');
const qUrl = document.getElementById('q-url');
const qStart = document.getElementById('q-start');
const qEnd = document.getElementById('q-end');
const qNote = document.getElementById('q-note');
const previewBtn = document.getElementById('preview-btn');
const previewContainer = document.getElementById('preview-container');
const saveBtn = document.getElementById('save-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const saveMsg = document.getElementById('save-msg');
const qList = document.getElementById('q-list');
const qCount = document.getElementById('q-count');
const filterYear = document.getElementById('filter-year');
const filterCategory = document.getElementById('filter-category');

let allQuestions = [];
let editingId = null; // null이면 새 문제 등록 모드, 아니면 해당 id를 수정 중

async function doSearch() {
  const q = searchInput.value.trim();
  if (!q) return;
  searchResults.innerHTML = '<p class="muted">검색 중...</p>';
  try {
    const res = await fetch('/api/youtube/search?q=' + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) {
      searchResults.innerHTML = '';
      searchHint.textContent = data.error;
      return;
    }
    searchHint.textContent = '';
    if (!data.length) {
      searchResults.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>';
      return;
    }
    searchResults.innerHTML = '';
    data.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'panel';
      div.style.cssText = 'display:flex; gap:12px; align-items:center; padding:10px;';
      div.innerHTML = `
        <img src="${item.thumbnail}" width="90" style="border-radius:8px; flex-shrink:0;" />
        <div style="flex:1; min-width:0; overflow-wrap:anywhere;">${item.title}</div>
        <button data-id="${item.videoId}" data-title="${item.title.replace(/"/g, '&quot;')}">선택</button>
      `;
      div.querySelector('button').addEventListener('click', () => {
        qUrl.value = `https://www.youtube.com/watch?v=${item.videoId}`;
      });
      searchResults.appendChild(div);
    });
  } catch (err) {
    searchResults.innerHTML = '<p class="muted">검색 중 오류: ' + err.message + '</p>';
  }
}

searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

let ytPlayer = null;
let ytReady = false;
window.onYouTubeIframeAPIReady = () => { ytReady = true; };

previewBtn.addEventListener('click', () => {
  const videoId = extractVideoId(qUrl.value);
  if (!videoId) {
    alert('유효한 유튜브 URL 또는 영상 ID를 입력하세요.');
    return;
  }
  const start = Number(qStart.value) || 0;
  const end = qEnd.value ? Number(qEnd.value) : undefined;

  previewContainer.innerHTML = '<div class="yt-embed"><div id="yt-preview"></div></div>';

  const create = () => {
    if (ytPlayer) { ytPlayer.destroy(); }
    ytPlayer = new YT.Player('yt-preview', {
      height: '270',
      width: '480',
      videoId,
      playerVars: { start, end, autoplay: 1 },
      events: {}
    });
  };

  if (ytReady && window.YT && window.YT.Player) create();
  else {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { ytReady = true; create(); if (prevReady) prevReady(); };
  }
});

function resetForm() {
  editingId = null;
  formTitle.textContent = '2. 문제 등록';
  saveBtn.textContent = '문제 저장';
  cancelEditBtn.style.display = 'none';
  qTitle.value = '';
  qCategory.value = '';
  qYear.value = '';
  qUrl.value = '';
  qStart.value = '0';
  qEnd.value = '';
  qNote.value = '';
  previewContainer.innerHTML = '';
  saveMsg.textContent = '';
}

function startEdit(q) {
  editingId = q.id;
  formTitle.textContent = `문제 수정 중: ${q.title}`;
  saveBtn.textContent = '수정 저장';
  cancelEditBtn.style.display = '';
  qTitle.value = q.title;
  qCategory.value = q.category || '';
  qYear.value = q.year !== null && q.year !== undefined ? q.year : '';
  qUrl.value = `https://www.youtube.com/watch?v=${q.videoId}`;
  qStart.value = q.start || 0;
  qEnd.value = q.end !== null && q.end !== undefined ? q.end : '';
  qNote.value = q.note || '';
  previewContainer.innerHTML = '';
  saveMsg.textContent = '';
  qTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

cancelEditBtn.addEventListener('click', resetForm);

saveBtn.addEventListener('click', async () => {
  const videoId = extractVideoId(qUrl.value);
  const title = qTitle.value.trim();
  if (!title) { saveMsg.textContent = '이름(정답)을 입력하세요.'; return; }
  if (!videoId) { saveMsg.textContent = '유효한 유튜브 URL을 입력하세요.'; return; }
  const body = {
    title,
    category: qCategory.value.trim(),
    year: qYear.value !== '' ? Number(qYear.value) : '',
    videoId,
    start: Number(qStart.value) || 0,
    end: qEnd.value ? Number(qEnd.value) : '',
    note: qNote.value.trim()
  };
  const url = editingId ? '/api/questions/' + editingId : '/api/questions';
  const method = editingId ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    saveMsg.textContent = editingId ? '수정되었습니다!' : '저장되었습니다!';
    resetForm();
    loadQuestions();
  } else {
    const data = await res.json();
    saveMsg.textContent = '저장 실패: ' + data.error;
  }
});

function populateFilters() {
  const years = [...new Set(allQuestions.map((q) => q.year).filter((y) => y !== null && y !== undefined))].sort((a, b) => a - b);
  const categories = [...new Set(allQuestions.map((q) => q.category).filter((c) => c))].sort();

  const prevYear = filterYear.value;
  filterYear.innerHTML = '<option value="">전체</option>' + years.map((y) => `<option value="${y}">${y}년</option>`).join('');
  filterYear.value = years.includes(Number(prevYear)) ? prevYear : '';

  const prevCat = filterCategory.value;
  filterCategory.innerHTML = '<option value="">전체</option>' + categories.map((c) => `<option value="${c}">${c}</option>`).join('');
  filterCategory.value = categories.includes(prevCat) ? prevCat : '';

  categoryOptions.innerHTML = categories.map((c) => `<option value="${c}"></option>`).join('');
}

function renderTable() {
  const yearFilter = filterYear.value;
  const categoryFilter = filterCategory.value;
  const filtered = allQuestions.filter((q) => {
    if (yearFilter && String(q.year) !== yearFilter) return false;
    if (categoryFilter && q.category !== categoryFilter) return false;
    return true;
  });

  qCount.textContent = filtered.length;
  qList.innerHTML = '';
  filtered.forEach((q, i) => {
    const tr = document.createElement('tr');
    const range = `${q.start}s ~ ${q.end !== null && q.end !== undefined ? q.end + 's' : '끝'}`;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${q.category || '-'}</td>
      <td>${q.year || '-'}</td>
      <td>${q.title}</td>
      <td>${range}</td>
      <td class="muted">${q.note || ''}</td>
      <td style="white-space:nowrap;">
        <button data-id="${q.id}" class="edit">수정</button>
        <button data-id="${q.id}" class="del btn-bad">삭제</button>
      </td>
    `;
    tr.querySelector('.edit').addEventListener('click', () => startEdit(q));
    tr.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`"${q.title}" 문제를 삭제할까요?`)) return;
      await fetch('/api/questions/' + q.id, { method: 'DELETE' });
      loadQuestions();
    });
    qList.appendChild(tr);
  });
}

filterYear.addEventListener('change', renderTable);
filterCategory.addEventListener('change', renderTable);

async function loadQuestions() {
  const res = await fetch('/api/questions');
  allQuestions = await res.json();
  populateFilters();
  renderTable();
}

loadQuestions();
