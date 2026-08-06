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
const importJson = document.getElementById('import-json');
const importBtn = document.getElementById('import-btn');
const importResult = document.getElementById('import-result');

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

importBtn.addEventListener('click', async () => {
  let items;
  try {
    items = JSON.parse(importJson.value);
    if (!Array.isArray(items)) throw new Error('최상위가 배열([...]) 형태여야 합니다.');
  } catch (err) {
    importResult.innerHTML = '<span style="color:var(--bad);">JSON 형식 오류: ' + err.message + '</span>';
    return;
  }
  if (!items.length) {
    importResult.textContent = '가져올 항목이 없습니다.';
    return;
  }

  importBtn.disabled = true;
  importResult.textContent = `가져오는 중... (0/${items.length})`;

  let success = 0;
  const failMessages = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const videoId = item.videoId || extractVideoId(item.url || '');
    const title = (item.title || '').trim();
    if (!title || !videoId) {
      failMessages.push(`"${title || '(제목 없음)'}" - title 또는 videoId(혹은 url)가 없습니다.`);
      importResult.textContent = `가져오는 중... (${i + 1}/${items.length})`;
      continue;
    }
    const body = {
      title,
      category: item.category || '',
      year: item.year !== undefined && item.year !== null ? item.year : '',
      videoId,
      start: item.start !== undefined ? item.start : 0,
      end: item.end !== undefined && item.end !== null ? item.end : '',
      note: item.note || ''
    };
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        success++;
      } else {
        const data = await res.json();
        failMessages.push(`"${title}" - ${data.error}`);
      }
    } catch (err) {
      failMessages.push(`"${title}" - ${err.message}`);
    }
    importResult.textContent = `가져오는 중... (${i + 1}/${items.length})`;
  }

  importBtn.disabled = false;
  let summary = `✅ ${success}개 등록 완료`;
  if (failMessages.length) {
    summary += `, ❌ ${failMessages.length}개 실패<br>` + failMessages.map((m) => '- ' + m).join('<br>');
  }
  importResult.innerHTML = summary;
  if (success > 0) {
    importJson.value = '';
    loadQuestions();
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

// ---------- 표(엑셀처럼) 인라인 수정 ----------
// id -> 원본과 달라진 필드만 { category, year, title, start, end, note } (문자열/숫자 raw 값)
const pendingEdits = new Map();
const saveChangesBtn = document.getElementById('save-changes-btn');
const dirtyCountEl = document.getElementById('dirty-count');
const saveStatusMsg = document.getElementById('save-status-msg');

function fieldsEqual(a, b) {
  // 입력칸 값(문자열)과 원본 값(숫자/문자열/null)을 같은 표현으로 맞춰서 비교
  const norm = (v) => (v === null || v === undefined ? '' : String(v));
  return norm(a) === norm(b);
}

function updatePendingField(q, field, rawValue) {
  const original = q[field];
  let edits = pendingEdits.get(q.id);
  if (fieldsEqual(rawValue, original)) {
    if (edits) {
      delete edits[field];
      if (Object.keys(edits).length === 0) pendingEdits.delete(q.id);
    }
  } else {
    if (!edits) { edits = {}; pendingEdits.set(q.id, edits); }
    edits[field] = rawValue;
  }
  refreshDirtyUi();
}

function refreshDirtyUi() {
  const n = pendingEdits.size;
  saveChangesBtn.disabled = n === 0;
  dirtyCountEl.textContent = n > 0 ? `미저장 변경 ${n}건` : '';
  qList.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.classList.toggle('row-dirty', pendingEdits.has(tr.dataset.id));
  });
}

function makeInlineInput({ type, value, width, field, q }) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value === null || value === undefined ? '' : value;
  if (width) input.style.width = width;
  if (field === 'category') input.setAttribute('list', 'category-options');
  input.addEventListener('input', () => updatePendingField(q, field, input.value));
  return input;
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
    const edits = pendingEdits.get(q.id) || {};
    const tr = document.createElement('tr');
    tr.dataset.id = q.id;
    tr.classList.toggle('row-dirty', pendingEdits.has(q.id));

    const idxTd = document.createElement('td');
    idxTd.textContent = i + 1;

    const categoryTd = document.createElement('td');
    categoryTd.appendChild(makeInlineInput({ type: 'text', value: 'category' in edits ? edits.category : (q.category || ''), width: '110px', field: 'category', q }));

    const yearTd = document.createElement('td');
    yearTd.appendChild(makeInlineInput({ type: 'number', value: 'year' in edits ? edits.year : (q.year ?? ''), width: '80px', field: 'year', q }));

    const titleTd = document.createElement('td');
    titleTd.appendChild(makeInlineInput({ type: 'text', value: 'title' in edits ? edits.title : q.title, width: '220px', field: 'title', q }));

    const startTd = document.createElement('td');
    startTd.appendChild(makeInlineInput({ type: 'number', value: 'start' in edits ? edits.start : q.start, width: '70px', field: 'start', q }));

    const endTd = document.createElement('td');
    endTd.appendChild(makeInlineInput({ type: 'number', value: 'end' in edits ? edits.end : (q.end ?? ''), width: '70px', field: 'end', q }));

    const noteTd = document.createElement('td');
    noteTd.appendChild(makeInlineInput({ type: 'text', value: 'note' in edits ? edits.note : (q.note || ''), width: '150px', field: 'note', q }));

    const actionsTd = document.createElement('td');
    actionsTd.style.whiteSpace = 'nowrap';
    const editBtn = document.createElement('button');
    editBtn.textContent = '영상변경';
    editBtn.title = '유튜브 영상(URL)을 바꾸려면 위 등록 폼을 사용합니다';
    editBtn.addEventListener('click', () => startEdit(q));
    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.className = 'btn-bad';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`"${q.title}" 문제를 삭제할까요?`)) return;
      pendingEdits.delete(q.id);
      await fetch('/api/questions/' + q.id, { method: 'DELETE' });
      loadQuestions();
    });
    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(delBtn);

    tr.appendChild(idxTd);
    tr.appendChild(categoryTd);
    tr.appendChild(yearTd);
    tr.appendChild(titleTd);
    tr.appendChild(startTd);
    tr.appendChild(endTd);
    tr.appendChild(noteTd);
    tr.appendChild(actionsTd);
    qList.appendChild(tr);
  });

  refreshDirtyUi();
}

filterYear.addEventListener('change', renderTable);
filterCategory.addEventListener('change', renderTable);

saveChangesBtn.addEventListener('click', async () => {
  if (!pendingEdits.size) return;
  saveChangesBtn.disabled = true;
  const total = pendingEdits.size;
  saveStatusMsg.textContent = `저장 중... (0/${total})`;

  const entries = [...pendingEdits.entries()];
  let success = 0;
  const failMessages = [];
  let done = 0;

  await Promise.all(entries.map(async ([id, edits]) => {
    const q = allQuestions.find((item) => item.id === id);
    const title = ('title' in edits ? edits.title : q?.title || '').trim();
    if (!title) {
      failMessages.push(`"${q ? q.title : id}" - 이름(정답)은 비워둘 수 없습니다.`);
      done++;
      saveStatusMsg.textContent = `저장 중... (${done}/${total})`;
      return;
    }
    const body = {};
    if ('category' in edits) body.category = edits.category.trim();
    if ('year' in edits) body.year = edits.year !== '' ? Number(edits.year) : '';
    if ('title' in edits) body.title = title;
    if ('start' in edits) body.start = Number(edits.start) || 0;
    if ('end' in edits) body.end = edits.end !== '' ? Number(edits.end) : '';
    if ('note' in edits) body.note = edits.note.trim();

    try {
      const res = await fetch('/api/questions/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        success++;
        pendingEdits.delete(id);
      } else {
        const data = await res.json();
        failMessages.push(`"${q ? q.title : id}" - ${data.error}`);
      }
    } catch (err) {
      failMessages.push(`"${q ? q.title : id}" - ${err.message}`);
    }
    done++;
    saveStatusMsg.textContent = `저장 중... (${done}/${total})`;
  }));

  let summary = `✅ ${success}건 저장 완료`;
  if (failMessages.length) {
    summary += `, ❌ ${failMessages.length}건 실패(수정칸에 남아있어요)<br>` + failMessages.map((m) => '- ' + m).join('<br>');
  }
  saveStatusMsg.innerHTML = summary;
  await loadQuestions();
});

// 저장 안 한 인라인 수정이 있는 채로 화면을 벗어나면 잃어버릴 수 있어 확인창을 띄운다.
window.addEventListener('beforeunload', (e) => {
  if (pendingEdits.size > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

async function loadQuestions() {
  const res = await fetch('/api/questions');
  allQuestions = await res.json();
  populateFilters();
  renderTable();
}

loadQuestions();
