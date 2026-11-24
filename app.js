(() => {
  'use strict';

  /* ───────────── 상수 ───────────── */
  const LS_KEY = 'babyFeeding.v1';
  const WHO_KEY = 'babyFeeding.who.v1';
  const SHARE_KEY = 'babyFeeding.share.v1';
  const DIRTY_KEY = 'babyFeeding.dirty.v1';

  // 사용자가 만든 Firebase Realtime Database 주소.
  // 엄마·아빠 폰은 이 주소를 따로 넣지 않아도 되고, 가족 방 코드만 맞추면 된다.
  const DEFAULT_FIREBASE_URL = 'https://baby-feeding-9f820-default-rtdb.asia-southeast1.firebasedatabase.app';
  const APP_URL = 'https://bswjys.github.io/baby-feeding/';

  const BASE_START = 60;
  const BASE_MIN = 10;
  const BASE_MAX = 300;
  const ML_MIN = 10;
  const ML_MAX = 300;
  const BOTTLE_FULL = 240;     // 젖병 그림의 가득 찬 기준(ml)
  const STEP_MIN = 10;         // ③ 10분 단위
  const STEP_ML = 10;          // ④⑥ 10ml 단위
  const LONG_PRESS_MS = 650;
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const REQ_TIMEOUT = 8000;    // 네트워크 요청 제한 시간
  const POLL_MS = 4000;        // 실시간 스트림이 막혔을 때 대신 확인하는 주기
  const STREAM_IDLE_MS = 75000; // 이 시간 동안 아무 소식이 없으면 스트림을 다시 연다
  const TOMB_KEEP_MS = 90 * 24 * 3600 * 1000; // 오래된 삭제 표시 정리 기준

  /* ───────────── 상태 ───────────── */
  const state = { base: BASE_START, records: [], tomb: {} };
  let savedMin = 0;            // ② 저장된 시각 (자정 기준 분)
  let amount = BASE_START;     // ⑦ 당시 수유량
  let weekOffset = 0;
  let toastTimer = null;
  let who = 'mom';             // 기록자: 'mom' | 'dad'

  /* ───────────── DOM ───────────── */
  const $ = (id) => document.getElementById(id);
  const handHour = $('handHour');
  const handMin = $('handMin');
  const clockBtn = $('clockBtn');
  const timeBox = $('timeBox');
  const ampmEl = $('ampm');
  const timeVal = $('timeVal');
  const timeUp = $('timeUp');
  const timeDown = $('timeDown');
  const baseBox = $('baseBox');
  const baseVal = $('baseVal');
  const baseMinus = $('baseMinus');
  const bottleBtn = $('bottleBtn');
  const bottleText = $('bottleText');
  const milkLayer = $('milkLayer');
  const amtUp = $('amtUp');
  const amtDown = $('amtDown');
  const amountBox = $('amountBox');
  const amountVal = $('amountVal');
  const recordList = $('recordList');
  const todaySum = $('todaySum');
  const weekGrid = $('weekGrid');
  const weekLabel = $('weekLabel');
  const weekTotal = $('weekTotal');
  const weekTotalLabel = $('weekTotalLabel');
  const headDate = $('headDate');
  const toastEl = $('toast');
  const sheet = $('sheet');
  const editDate = $('editDate');
  const editTime = $('editTime');
  const editMl = $('editMl');
  const fileInput = $('fileInput');

  // 기록자 / 공유
  const whoMom = $('whoMom');
  const whoDad = $('whoDad');
  const sharePill = $('sharePill');
  const shareDot = $('shareDot');
  const shareLabel = $('shareLabel');
  const shareRoom = $('shareRoom');
  const shareSheet = $('shareSheet');
  const shareStatus = $('shareStatus');
  const shareStatusDot = $('shareStatusDot');
  const shareStatusText = $('shareStatusText');
  const shareNote = $('shareNote');
  const roomInput = $('roomInput');
  const dbInput = $('dbInput');
  const advBox = $('advBox');
  const advHint = $('advHint');
  const shareSend = $('shareSend');
  const shareLeave = $('shareLeave');
  const footerNote = $('footerNote');

  /* ───────────── 유틸 ───────────── */
  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const keyToDate = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmtMl = (n) => `${n}ml`;
  const byLabel = (b) => (b === 'mom' ? '엄마' : b === 'dad' ? '아빠' : '');

  /** 분 → "2:00" (12시간제) */
  function clock12(min) {
    const m = ((min % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h % 12 === 0 ? 12 : h % 12}:${pad2(mm)}`;
  }
  /** 분 → "14:00" (24시간제) */
  function clock24(min) {
    const m = ((min % 1440) + 1440) % 1440;
    return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  }
  const nowMinutes = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const round10 = () => Math.round(nowMinutes() / 10) * 10 % 1440;

  /* ───────────── 저장 ───────────── */
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.base === 'number' && isFinite(data.base)) {
        state.base = clamp(Math.round(data.base / 10) * 10, BASE_MIN, BASE_MAX);
      }
      if (Array.isArray(data.records)) {
        state.records = data.records
          .filter((r) => r && typeof r.at === 'string' && isFinite(new Date(r.at).getTime()) && typeof r.ml === 'number' && r.ml > 0)
          .map((r) => {
            const at = new Date(r.at).toISOString();
            const up = Number(r.updatedAt);
            return {
              id: typeof r.id === 'string' ? r.id : uid(),
              at,
              ml: Math.round(r.ml),
              by: r.by === 'mom' || r.by === 'dad' ? r.by : null,
              updatedAt: isFinite(up) && up > 0 ? up : (Date.parse(at) || Date.now()),
            };
          });
      }
      if (data.tomb && typeof data.tomb === 'object' && !Array.isArray(data.tomb)) {
        Object.keys(data.tomb).forEach((k) => {
          const v = Number(data.tomb[k]);
          if (isFinite(v) && v > 0) state.tomb[k] = v;
        });
      }
    } catch (err) {
      console.warn('저장된 기록을 읽지 못했어요', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ base: state.base, records: state.records, tomb: state.tomb }));
    } catch (err) {
      console.warn('기록을 저장하지 못했어요', err);
      toast('저장 공간이 부족해요');
    }
  }

  /* ───────────── 기록 계산 ───────────── */
  /** 시간 오름차순 + 각 날짜별 누적 */
  function decorated() {
    const list = state.records
      .map((r) => ({ r, d: new Date(r.at) }))
      .sort((a, b) => a.d - b.d);
    let prev = null;
    let sum = 0;
    return list.map(({ r, d }) => {
      const key = dayKey(d);
      if (key !== prev) { prev = key; sum = 0; }
      sum += r.ml;
      return { r, d, key, cum: sum };
    });
  }

  function dayTotals() {
    const map = new Map();
    decorated().forEach(({ key, cum }) => map.set(key, cum));
    return map;
  }

  /* ───────────── 렌더 ───────────── */
  function renderAll() {
    renderTime();
    renderBase();
    renderAmount();
    renderBottle();
    renderRecords();
    renderWeek();
    renderHead();
    renderShare();
  }

  function renderHead() {
    const d = new Date();
    headDate.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;
  }

  function renderTime() {
    const m = ((savedMin % 1440) + 1440) % 1440;
    ampmEl.textContent = m < 720 ? '오전' : '오후';
    timeVal.textContent = clock12(m);
  }

  function renderBase() {
    baseVal.textContent = fmtMl(state.base);
  }

  /** 기본량 변경: ⑦이 아직 손대지 않은 값(=기본량)이면 함께 따라간다 */
  function setBase(next) {
    const prev = state.base;
    state.base = clamp(next, BASE_MIN, BASE_MAX);
    if (amount === prev) amount = state.base;
    save();
    renderBase();
    renderBottle();
    renderAmount();
  }

  function renderAmount() {
    amountVal.textContent = fmtMl(amount);
  }

  function renderBottle() {
    bottleText.textContent = fmtMl(state.base);
    const ratio = clamp(state.base / BOTTLE_FULL, 0.14, 1);
    const shift = (1 - ratio) * 88;   // 92 - 4(파도 여백)
    milkLayer.style.transform = `translateY(${shift.toFixed(2)}px)`;
  }

  function renderRecords() {
    const all = decorated();
    const todayKey = dayKey(new Date());
    const today = all.filter((x) => x.key === todayKey);
    const todayMl = today.reduce((s, x) => s + x.r.ml, 0);
    todaySum.textContent = today.length === 0 ? '오늘 0ml' : `오늘 ${today.length}회 · ${todayMl}ml`;

    recordList.textContent = '';
    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<span class="big">🍼</span>아직 기록이 없어요.<br>젖병을 눌러 첫 기록을 남겨 보세요.';
      recordList.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = all.length - 1; i >= 0; i--) {
      const { r, d, key, cum } = all[i];
      const row = document.createElement('div');
      row.className = 'row' + (key === todayKey ? ' is-today' : '');
      row.dataset.id = r.id;
      row.dataset.by = r.by || '';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      const whoTxt = byLabel(r.by);
      row.setAttribute('aria-label', `${d.getMonth() + 1}월 ${d.getDate()}일 ${clock24(d.getHours() * 60 + d.getMinutes())} ${r.ml}ml${whoTxt ? ` · ${whoTxt}` : ''} 기록 수정`);

      const date = document.createElement('span');
      date.className = 'c-date';
      const dateTxt = document.createElement('span');
      dateTxt.className = 'c-date-t';
      dateTxt.textContent = key === todayKey ? '오늘' : `${d.getMonth() + 1}/${d.getDate()}`;
      date.appendChild(dateTxt);
      if (r.by === 'mom' || r.by === 'dad') {
        const by = document.createElement('span');
        by.className = `by by-${r.by}`;
        by.textContent = byLabel(r.by);
        date.appendChild(by);
      }

      const time = document.createElement('span');
      time.className = 'c-time';
      time.textContent = clock24(d.getHours() * 60 + d.getMinutes());

      const ml = document.createElement('span');
      ml.className = 'c-ml';
      ml.textContent = fmtMl(r.ml);

      const cumEl = document.createElement('span');
      cumEl.className = 'c-cum';
      cumEl.textContent = fmtMl(cum);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'c-del';
      del.textContent = '×';
      del.setAttribute('aria-label', `${r.ml}ml 기록 삭제`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRecord(r.id);
      });

      row.append(date, time, ml, cumEl, del);
      frag.appendChild(row);
    }
    recordList.appendChild(frag);
  }

  function weekStart(offset) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - d.getDay() + offset * 7);
    return d;
  }

  function renderWeek() {
    const start = weekStart(weekOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    weekLabel.textContent = `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()}`;

    const totals = dayTotals();
    const todayKey = dayKey(new Date());
    weekGrid.textContent = '';
    let weekSum = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = dayKey(d);
      const total = totals.get(key) || 0;
      weekSum += total;

      const cell = document.createElement('div');
      cell.className = 'day' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') +
        (key === todayKey ? ' today' : '') + (total === 0 ? ' zero' : '');
      cell.dataset.date = key;

      const dow = document.createElement('div');
      dow.className = 'dow';
      dow.textContent = DOW[i];

      const v = document.createElement('div');
      v.className = 'v';
      v.textContent = String(total);
      const u = document.createElement('span');
      u.className = 'u';
      u.textContent = 'ml';
      v.appendChild(u);

      cell.append(dow, v);
      weekGrid.appendChild(cell);
    }

    weekTotal.textContent = fmtMl(weekSum);
    weekTotalLabel.textContent = weekOffset === 0 ? '이번 주 합계' : '이 주 합계';
  }

  /* ───────────── 토스트 ───────────── */
  function toast(message, undo) {
    clearTimeout(toastTimer);
    toastEl.textContent = '';
    const span = document.createElement('span');
    span.textContent = message;
    toastEl.appendChild(span);

    if (typeof undo === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '되돌리기';
      btn.addEventListener('click', () => {
        undo();
        hideToast();
      });
      toastEl.appendChild(btn);
    }
    toastEl.classList.add('show');
    toastTimer = setTimeout(hideToast, undo ? 6500 : 2000);
  }
  function hideToast() {
    toastEl.classList.remove('show');
    clearTimeout(toastTimer);
  }

  /* ───────────── 기록 추가/삭제/수정 ───────────── */
  function record(ml, source) {
    const value = clamp(Math.round(ml / STEP_ML) * STEP_ML, ML_MIN, ML_MAX);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 저장된 시각이 지금보다 1시간 이상 미래면 자정을 넘긴 어제 기록으로 본다
    if (savedMin > nowMinutes() + 60) target.setDate(target.getDate() - 1);
    const at = new Date(target.getFullYear(), target.getMonth(), target.getDate(),
      Math.floor(savedMin / 60), savedMin % 60, 0, 0);

    const rec = { id: uid(), at: at.toISOString(), ml: value, by: who, updatedAt: Date.now() };
    state.records.push(rec);
    save();
    markDirty(rec.id);
    weekOffset = 0;
    renderAll();

    if (source === 'bottle') {
      amount = state.base;
      renderAmount();
      bottleBtn.classList.remove('pour');
      void bottleBtn.offsetWidth;
      bottleBtn.classList.add('pour');
    }
    amountBox.classList.remove('bump');
    void amountBox.offsetWidth;
    amountBox.classList.add('bump');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }

    toast(`${value}ml 기록했어요 · ${clock24(savedMin)}${who === 'dad' ? ' · 아빠' : ''}`);
  }

  function deleteRecord(id) {
    const idx = state.records.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const removed = state.records.splice(idx, 1)[0];
    state.tomb[id] = Date.now();
    save();
    markDirty(id);
    renderAll();
    toast(`${removed.ml}ml 기록을 지웠어요`, () => {
      delete state.tomb[id];
      removed.updatedAt = Date.now();
      state.records.splice(Math.min(idx, state.records.length), 0, removed);
      save();
      markDirty(id);
      renderAll();
    });
  }

  /* ───────────── 시계 ───────────── */
  function tick() {
    const now = new Date();
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    handMin.style.transform = `rotate(${(minutes * 6).toFixed(2)}deg)`;
    handHour.style.transform = `rotate(${(hours * 30).toFixed(2)}deg)`;
    requestAnimationFrame(tick);
  }

  function buildTicks() {
    const g = $('ticks');
    for (let i = 0; i < 12; i++) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '50');
      line.setAttribute('y1', '8');
      line.setAttribute('x2', '50');
      line.setAttribute('y2', i % 3 === 0 ? '14' : '12');
      line.setAttribute('transform', `rotate(${i * 30} 50 50)`);
      g.appendChild(line);
    }
  }

  /* ═════════════ 기록자 (엄마 / 아빠) ═════════════ */
  function setWho(next, opts) {
    who = next === 'dad' ? 'dad' : 'mom';
    try { localStorage.setItem(WHO_KEY, who); } catch (err) { /* 무시 */ }
    whoMom.setAttribute('aria-pressed', who === 'mom' ? 'true' : 'false');
    whoDad.setAttribute('aria-pressed', who === 'dad' ? 'true' : 'false');
    if (opts && opts.toast) toast(who === 'mom' ? '👩 엄마로 기록할게요' : '👨 아빠로 기록할게요');
  }

  /* ═════════════ 가족 공유 (Firebase RTDB REST + SSE) ═════════════ */
  const share = { url: '', room: '', linked: false };
  const net = {
    mode: 'local',      // local | connecting | live | polling | offline | error    es: null,
    pollTimer: null,
    watchTimer: null,
    idleTimer: null,
    lastEvent: 0,
    restarts: 0,
    fails: 0,
    mirror: null,       // 마지막으로 받은 방의 records 스냅숏
    dirty: new Set(),   // 아직 서버에 못 보낸 기록 id
    flushing: false,
    announce: false,
    joined: false,
  };
  let flushTimer = null;

  function normDb(u) {
    let s = String(u || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s.replace(/\/+$/, '');
  }
  function normRoom(u) {
    return String(u || '')
      .replace(/\s+/g, '')
      .replace(/[^0-9A-Za-z\uAC00-\uD7A3_-]/g, '')
      .replace(/[a-z]/g, (c) => c.toUpperCase())
      .slice(0, 12);
  }
  function roomValid(code) {
    return typeof code === 'string' && code.length >= 2 && code.length <= 12;
  }
  const roomReady = () => roomValid(share.room);

  function recordsUrl() {
    return `${share.url}/rooms/${encodeURIComponent(share.room)}/records.json`;
  }
  function recordUrl(id) {
    return `${share.url}/rooms/${encodeURIComponent(share.room)}/records/${encodeURIComponent(id)}.json`;
  }
  function shared() {
    return !!(share.url && roomReady());
  }

  /* ── 설정 읽기/쓰기 ── */
  function loadShare() {
    try {
      const raw = localStorage.getItem(SHARE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d.url === 'string') share.url = normDb(d.url);
        if (typeof d.room === 'string') share.room = normRoom(d.room);
      }
    } catch (err) {
      console.warn('공유 설정을 읽지 못했어요', err);
    }
    if (!share.url) share.url = normDb(DEFAULT_FIREBASE_URL);

    // 공유 링크(?room=우리집)로 열면 코드 입력 없이 바로 연결
    let linked = '';
    try {
      linked = normRoom(new URLSearchParams(location.search).get('room') || '');
    } catch (err) { /* 무시 */ }
    if (roomValid(linked)) {
      share.room = linked;
      share.linked = true;
      persistShare();
    }
    if (!share.url || !roomReady()) share.room = share.url ? share.room : '';

    try {
      const w = localStorage.getItem(WHO_KEY);
      if (w === 'mom' || w === 'dad') who = w;
    } catch (err) { /* 무시 */ }

    try {
      const arr = JSON.parse(localStorage.getItem(DIRTY_KEY) || '[]');
      if (Array.isArray(arr)) arr.forEach((id) => { if (typeof id === 'string') net.dirty.add(id); });
    } catch (err) { /* 무시 */ }
  }

  function persistShare() {
    try {
      localStorage.setItem(SHARE_KEY, JSON.stringify({ url: share.url, room: share.room }));
    } catch (err) { /* 무시 */ }
  }

  function saveDirty() {
    try { localStorage.setItem(DIRTY_KEY, JSON.stringify(Array.from(net.dirty))); } catch (err) { /* 무시 */ }
  }

  /* ── 상태 표시 ── */
  function setMode(mode) {
    if (net.mode === mode) { renderShare(); return; }
    net.mode = mode;
    renderShare();
  }

  function renderShare() {
    const m = net.mode;
    sharePill.dataset.mode = m;
    shareDot.className = `dot dot-${m}`;
    shareStatus.dataset.mode = m;
    shareStatusDot.className = `dot dot-${m}`;

    let label = '로컬 저장 모드';
    if (m === 'connecting') label = '연결 중…';
    else if (m === 'live') label = '실시간 연결됨';
    else if (m === 'polling') label = '연결됨 · 5초 갱신';
    else if (m === 'offline') label = '오프라인 · 저장 중';
    else if (m === 'error') label = '연결 확인 필요';
    shareLabel.textContent = label;

    const roomShown = m !== 'local' && m !== 'error' && !!share.room;
    shareRoom.textContent = roomShown ? share.room : '';
    shareRoom.hidden = !roomShown;

    sharePill.setAttribute('aria-label',
      m === 'local' ? '로컬 저장 모드 · 가족 공유 설정 열기' : `${label}${roomShown ? ` (방: ${share.room})` : ''} · 가족 공유 설정 열기`);

    const n = state.records.length;
    if (m === 'live') shareStatusText.textContent = `● 실시간 연결됨 (방: ${share.room})${n ? ` · 기록 ${n}개` : ''}`;
    else if (m === 'polling') shareStatusText.textContent = `● 연결됨 (방: ${share.room}) · 5초마다 확인${n ? ` · 기록 ${n}개` : ''}`;
    else if (m === 'connecting') shareStatusText.textContent = `연결 중… (방: ${share.room})`;
    else if (m === 'offline') shareStatusText.textContent = `오프라인 · 이 기기에 먼저 저장하고 있어요${share.room ? ` (방: ${share.room})` : ''}`;
    else if (m === 'error') shareStatusText.textContent = '연결하지 못했어요 · 주소와 방 코드를 확인해 주세요';
    else shareStatusText.textContent = '로컬 저장 모드 · 이 기기에만 저장돼요';

    footerNote.textContent = m === 'live' || m === 'polling'
      ? `가족 방 ${share.room} · 엄마 아빠가 함께 보고 있어요`
      : m === 'offline' && share.room
        ? '오프라인 · 다시 연결되면 자동으로 맞춰져요'
        : '기록은 이 기기에 저장돼요 · 공유를 켜면 가족과 함께';

    shareLeave.hidden = !share.room;
    shareSend.hidden = !share.room;
    if (!advBox.open) {
      advHint.textContent = share.url === normDb(DEFAULT_FIREBASE_URL) ? '(기본 주소 사용 중)' : '(직접 설정한 주소)';
    }
  }

  /* ── 네트워크 ── */
  function fbRequest(method, url, body) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), REQ_TIMEOUT) : null;
    const opts = { method, cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then((res) => {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }, (err) => {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function fbGet(url) {
    return fbRequest('GET', url).then((txt) => {
      try { return txt ? JSON.parse(txt) : null; } catch (err) { return null; }
    });
  }

  /* ── 연결 ── */
  function connectShare(opts) {
    const announce = !!(opts && opts.announce);
    closeStream();
    stopPolling();
    net.mirror = null;
    net.restarts = 0;
    net.fails = 0;
    net.announce = announce;
    net.joined = false;

    if (!shared()) {
      setMode('local');
      return;
    }
    if (navigator.onLine === false) {
      setMode('offline');
      return;
    }
    setMode('connecting');
    openStream();
  }

  function openStream() {
    closeStream();
    if (!shared()) { setMode('local'); return; }

    if (typeof EventSource !== 'function') { startPolling(); return; }

    let es;
    const url = recordsUrl();
    try {
      es = new EventSource(url);
    } catch (err) {
      console.warn('실시간 연결을 시작하지 못했어요', err);
      startPolling();
      return;
    }
    net.es = es;
    net.lastEvent = Date.now();

    es.addEventListener('open', () => {
      if (net.es !== es) return;
      net.lastEvent = Date.now();
      net.restarts = 0;
      net.fails = 0;
      if (net.mode !== 'live') setMode('live');
      startWatchdog();
      if (net.announce) {
        net.announce = false;
        toast(`가족 방 ${share.room} 연결됐어요`);
      }
    });
    es.addEventListener('put', (ev) => {
      if (net.es !== es) return;
      net.lastEvent = Date.now();
      onStream(kindOf(ev, 'put'), ev.data);
    });
    es.addEventListener('patch', (ev) => {
      if (net.es !== es) return;
      net.lastEvent = Date.now();
      onStream(kindOf(ev, 'patch'), ev.data);
    });
    es.addEventListener('keep-alive', () => {
      if (net.es !== es) return;
      net.lastEvent = Date.now();
    });

    es.onerror = () => {
      if (net.es !== es) return;
      net.lastEvent = 0;
      if (es.readyState === 2 /* CLOSED */) {
        es.close();
        net.es = null;
        net.restarts += 1;
        if (net.restarts >= 2) { startPolling(); return; }
        setMode('connecting');
        setTimeout(() => { if (shared() && navigator.onLine !== false) openStream(); }, 1500);
      } else {
        setMode('connecting');
      }
    };
  }

  function kindOf(ev, fallback) {
    return (ev && ev.type) || fallback;
  }

  function closeStream() {
    if (net.es) {
      try { net.es.close(); } catch (err) { /* 무시 */ }
      net.es = null;
    }
    if (net.watchTimer) { clearInterval(net.watchTimer); net.watchTimer = null; }
  }

  function startWatchdog() {
    if (net.watchTimer) clearInterval(net.watchTimer);
    net.watchTimer = setInterval(() => {
      if (net.mode !== 'live') return;
      if (navigator.onLine === false) { setMode('offline'); return; }
      if (!net.lastEvent) return;
      if (Date.now() - net.lastEvent > STREAM_IDLE_MS) {
        net.lastEvent = Date.now();
        openStream();
      }
    }, 15000);
  }

  function startPolling() {
    closeStream();
    if (!shared()) { setMode('local'); return; }
    if (net.pollTimer) return;
    setMode('polling');
    const tick = () => {
      fbGet(recordsUrl()).then((data) => {
        net.fails = 0;
        applyMirrorRoot(data);
        if (net.mode !== 'polling') setMode('polling');
      }).catch(() => {
        net.fails += 1;
        if (navigator.onLine === false) setMode('offline');
        else if (net.fails >= 3) setMode('error');
      });
    };
    tick();
    net.pollTimer = setInterval(tick, POLL_MS);
  }

  function stopPolling() {
    if (net.pollTimer) { clearInterval(net.pollTimer); net.pollTimer = null; }
  }

  /* ── 스트림 데이터 → 미러 갱신 ── */
  function applyMirrorRoot(data) {
    net.mirror = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    reconcile();
  }

  function onStream(kind, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (err) { return; }
    if (!msg || typeof msg.path !== 'string') return;
    const path = msg.path;

    if (path === '/' || path === '') {
      if (kind === 'put') {
        net.mirror = (msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data)) ? msg.data : {};
      } else {
        net.mirror = Object.assign({}, net.mirror || {}, msg.data || {});
      }
    } else {
      const id = path.replace(/^\//, '').split('/')[0];
      if (!id) return;
      if (!net.mirror) net.mirror = {};
      const prev = net.mirror[id];
      if (kind === 'patch' && msg.data && typeof msg.data === 'object' && prev && typeof prev === 'object') {
        net.mirror[id] = Object.assign({}, prev, msg.data);
      } else if (msg.data === null || msg.data === undefined) {
        delete net.mirror[id];
      } else if (msg.data && typeof msg.data === 'object') {
        net.mirror[id] = msg.data;
      }
    }

    if (net.mode !== 'live') setMode('live');
    if (!net.mirror) return;
    reconcile();
  }

  /* ── 병합 ── */
  function localSnapshot() {
    const m = new Map();
    state.records.forEach((r) => {
      m.set(r.id, { at: r.at, ml: r.ml, by: r.by || null, updatedAt: r.updatedAt || Date.parse(r.at) || 0 });
    });
    Object.keys(state.tomb).forEach((id) => {
      m.set(id, { deleted: true, updatedAt: state.tomb[id] });
    });
    return m;
  }

  function remoteSnapshot(obj) {
    const m = new Map();
    if (!obj || typeof obj !== 'object') return m;
    Object.keys(obj).forEach((id) => {
      const v = obj[id];
      if (!v || typeof v !== 'object') return;
      if (v.deleted) {
        m.set(id, { deleted: true, updatedAt: Number(v.updatedAt) || 0 });
        return;
      }
      if (typeof v.at !== 'string' || !isFinite(Date.parse(v.at))) return;
      const ml = Math.round(Number(v.ml));
      if (!isFinite(ml) || ml <= 0) return;
      m.set(id, {
        at: new Date(v.at).toISOString(),
        ml: clamp(ml, 1, 1000),
        by: v.by === 'mom' || v.by === 'dad' ? v.by : null,
        updatedAt: Number(v.updatedAt) || Date.parse(v.at) || 0,
      });
    });
    return m;
  }

  function sameRec(a, b) {
    if (!!a.deleted !== !!b.deleted) return false;
    if (a.deleted) return true;
    return a.at === b.at && a.ml === b.ml && (a.by || null) === (b.by || null);
  }

  function reconcile() {
    const rem = remoteSnapshot(net.mirror || {});
    const loc = localSnapshot();
    const before = state.records.length;
    const push = [];
    let changed = false;

    rem.forEach((r, id) => {
      const l = loc.get(id);
      if (!l || r.updatedAt > l.updatedAt) { applyRemote(id, r); loc.set(id, r); changed = true; }
      else if (l.updatedAt > r.updatedAt) push.push(id);
      else if (!sameRec(l, r)) { applyRemote(id, r); loc.set(id, r); changed = true; }
    });
    loc.forEach((l, id) => {
      if (!rem.has(id)) push.push(id);
    });

    if (changed) {
      save();
      renderRecords();
      renderWeek();
      renderShare();
    }
    if (push.length) {
      push.forEach((id) => { net.dirty.add(id); });
      saveDirty();
      flush();
    }

    // 가족 방에 처음 들어갈 때: 기존 기록이 사라지지 않고 합쳐졌다는 안내
    if (!net.joined) {
      net.joined = true;
      if (rem.size === 0 && push.length) toast(`내 기록 ${push.length}개를 가족 방에 올렸어요`);
      else if (push.length) toast(`가족 방 기록 ${state.records.length - before + push.length}개와 합쳤어요`);
      else if (state.records.length > before) toast(`가족 방 기록 ${state.records.length - before}개를 받았어요`);
    }
  }

  function applyRemote(id, v) {
    const i = state.records.findIndex((r) => r.id === id);
    if (v.deleted) {
      if (i >= 0) state.records.splice(i, 1);
      state.tomb[id] = Math.max(state.tomb[id] || 0, v.updatedAt || 0);
      return;
    }
    const rec = { id, at: v.at, ml: v.ml, by: v.by || null, updatedAt: v.updatedAt || Date.now() };
    if (i >= 0) state.records[i] = rec;
    else state.records.push(rec);
    if (state.tomb[id]) delete state.tomb[id];
  }

  /* ── 올리기 ── */
  function markDirty(id) {
    if (!id || !share.url) return;
    net.dirty.add(id);
    saveDirty();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 150);
  }

  function flush() {
    if (net.flushing) return;
    if (!shared()) return;
    if (navigator.onLine === false) { setMode('offline'); return; }
    if (net.dirty.size === 0) return;

    net.flushing = true;
    const ids = Array.from(net.dirty);

    const step = (k) => {
      if (k >= ids.length) {
        net.flushing = false;
        if (net.dirty.size) setTimeout(flush, 600);
        return;
      }
      const id = ids[k];
      const rec = state.records.find((r) => r.id === id);
      let body = null;
      if (rec) {
        body = { at: rec.at, ml: rec.ml, by: rec.by || null, updatedAt: rec.updatedAt || Date.now() };
      } else if (state.tomb[id]) {
        body = { deleted: true, updatedAt: state.tomb[id] };
      } else {
        net.dirty.delete(id);
        saveDirty();
        step(k + 1);
        return;
      }
      fbRequest('PUT', recordUrl(id), body).then(() => {
        net.dirty.delete(id);
        saveDirty();
        step(k + 1);
      }).catch(() => {
        net.flushing = false;
        if (navigator.onLine === false) setMode('offline');
      });
    };
    step(0);
  }

  /** 오래된 삭제 표시는 서버에서도 정리 */
  function pruneTombstones() {
    if (!shared()) return;
    const now = Date.now();
    Object.keys(state.tomb).forEach((id) => {
      if (now - state.tomb[id] < TOMB_KEEP_MS) return;
      delete state.tomb[id];
      if (net.mirror) delete net.mirror[id];
      fbRequest('DELETE', recordUrl(id)).catch(() => { /* 다음 기회에 */ });
    });
    save();
  }

  /* ── 공유 시트 ── */
  function openShareSheet() {
    roomInput.value = share.room;
    dbInput.value = share.url || normDb(DEFAULT_FIREBASE_URL);
    advBox.open = !share.url || share.url !== normDb(DEFAULT_FIREBASE_URL);
    advHint.textContent = share.url
      ? (share.url === normDb(DEFAULT_FIREBASE_URL) ? '(기본 주소 사용 중)' : '(직접 설정함)')
      : '(기본 주소 없음)';
    shareNote.textContent = share.room
      ? '방 코드를 바꾸면 다른 가족 방으로 옮겨가요. 기록은 그대로 남아요.'
      : '방 코드를 아는 가족만 기록을 함께 볼 수 있어요.';
    renderShare();
    shareSheet.hidden = false;
    setTimeout(() => { try { roomInput.focus(); } catch (err) { /* 무시 */ } }, 120);
  }

  function closeShareSheet() {
    shareSheet.hidden = true;
  }

  function randomRoom() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function saveShareFromSheet() {
    const url = normDb(dbInput.value || DEFAULT_FIREBASE_URL);
    const room = normRoom(roomInput.value);

    if (!url) {
      advBox.open = true;
      dbInput.focus();
      toast('연결 주소가 없어요');
      return;
    }
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url)) {
      advBox.open = true;
      toast('주소 형식을 확인해 주세요');
      return;
    }
    if (!roomValid(room)) {
      toast('방 코드는 2~12자로 정해 주세요');
      roomInput.value = room;
      roomInput.focus();
      return;
    }

    const changed = url !== share.url || room !== share.room;
    share.url = url;
    share.room = room;
    persistShare();
    closeShareSheet();
    connectShare({ announce: changed });
  }

  function leaveShare() {
    const ok = window.confirm('가족 공유를 끄고 이 기기에만 저장할까요?\n이 기기의 기록은 그대로 남아요.');
    if (!ok) return;
    share.room = '';
    persistShare();
    closeStream();
    stopPolling();
    net.mirror = null;
    net.dirty.clear();
    saveDirty();
    setMode('local');
    closeShareSheet();
    toast('공유를 껐어요 · 이 기기에만 저장해요');
  }

  function sendRoomCode() {
    const link = `${APP_URL}?room=${encodeURIComponent(share.room)}`;
    const text = `🍼 수유 앱 가족 방 「${share.room}」\n아래 링크를 열면 바로 연결돼요.\n${link}`;
    if (navigator.share) {
      navigator.share({ title: '수유 앱 가족 방', text }).catch(() => { /* 취소 */ });
      return;
    }
    const done = () => toast('가족 방 링크를 복사했어요');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => toast(`방 코드: ${share.room}`));
    } else {
      toast(`방 코드: ${share.room}`);
    }
  }

  /* ───────────── 이벤트 ───────────── */
  function bind() {
    // 기록자 선택
    whoMom.addEventListener('click', () => { if (who !== 'mom') setWho('mom', { toast: true }); });
    whoDad.addEventListener('click', () => { if (who !== 'dad') setWho('dad', { toast: true }); });

    // 공유 시트
    sharePill.addEventListener('click', openShareSheet);
    $('shareCancel').addEventListener('click', closeShareSheet);
    shareSheet.addEventListener('click', (e) => { if (e.target === shareSheet) closeShareSheet(); });
    $('shareSave').addEventListener('click', saveShareFromSheet);
    $('roomNew').addEventListener('click', () => {
      roomInput.value = randomRoom();
      toast('새 가족 방 코드를 만들었어요');
    });
    roomInput.addEventListener('blur', () => {
      const v = normRoom(roomInput.value);
      if (v !== roomInput.value) roomInput.value = v;
    });
    roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveShareFromSheet(); });
    shareLeave.addEventListener('click', leaveShare);
    shareSend.addEventListener('click', sendRoomCode);

    // ① 시계 → 지금 시간 저장
    clockBtn.addEventListener('click', () => {
      savedMin = round10();
      renderTime();
      timeBox.classList.remove('bump');
      void timeBox.offsetWidth;
      timeBox.classList.add('bump');
      clockBtn.classList.remove('pulse');
      void clockBtn.offsetWidth;
      clockBtn.classList.add('pulse');
      toast(`지금 시간 ${clock24(savedMin)}로 맞췄어요`);
    });

    // ③ ±10분
    timeUp.addEventListener('click', () => {
      savedMin = (savedMin + STEP_MIN) % 1440;
      renderTime();
      bumpBox(timeBox);
    });
    timeDown.addEventListener('click', () => {
      savedMin = (savedMin - STEP_MIN + 1440) % 1440;
      renderTime();
      bumpBox(timeBox);
    });

    // ④ 기본량 +10ml (길게 누르면 초기화)
    let pressTimer = null;
    let longPressed = false;
    const startPress = () => {
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longPressed = true;
        setBase(BASE_START);
        bumpBox(baseBox);
        toast('기본량을 60ml로 되돌렸어요');
      }, LONG_PRESS_MS);
    };
    const endPress = () => clearTimeout(pressTimer);
    baseBox.addEventListener('pointerdown', startPress);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => baseBox.addEventListener(ev, endPress));
    baseBox.addEventListener('contextmenu', (e) => e.preventDefault());
    baseBox.addEventListener('click', () => {
      if (longPressed) { longPressed = false; return; }
      if (state.base >= BASE_MAX) {
        toast('기본량은 300ml까지예요');
        return;
      }
      setBase(state.base + STEP_ML);
      bumpBox(baseBox);
    });

    // ④ 보조: −10ml
    baseMinus.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.base <= BASE_MIN) { toast('기본량은 10ml까지예요'); return; }
      setBase(state.base - STEP_ML);
      bumpBox(baseBox);
    });

    // ⑤ 젖병 → 기본량으로 바로 기록
    bottleBtn.addEventListener('click', () => record(state.base, 'bottle'));

    // ⑥ 수유량 ±10ml (⑦만 바꾼다)
    amtUp.addEventListener('click', () => {
      if (amount >= ML_MAX) { toast('수유량은 300ml까지예요'); return; }
      amount = clamp(amount + STEP_ML, ML_MIN, ML_MAX);
      renderAmount();
      bumpBox(amountBox);
    });
    amtDown.addEventListener('click', () => {
      if (amount <= ML_MIN) { toast('수유량은 10ml까지예요'); return; }
      amount = clamp(amount - STEP_ML, ML_MIN, ML_MAX);
      renderAmount();
      bumpBox(amountBox);
    });

    // ⑦ 수유량 박스 → 그 수유량으로 바로 기록
    amountBox.addEventListener('click', () => record(amount, 'amount'));

    // ⑧ 행 탭 → 수정
    recordList.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      openSheet(row.dataset.id);
    });
    recordList.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.row');
      if (!row) return;
      e.preventDefault();
      openSheet(row.dataset.id);
    });

    // ⑨ 주 이동
    $('weekPrev').addEventListener('click', () => { weekOffset -= 1; renderWeek(); });
    $('weekNext').addEventListener('click', () => { weekOffset += 1; renderWeek(); });
    weekLabel.addEventListener('click', () => {
      if (weekOffset === 0) return;
      weekOffset = 0;
      renderWeek();
    });

    // 수정 시트
    $('editCancel').addEventListener('click', closeSheet);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
    $('editPlus').addEventListener('click', () => {
      editMl.value = String(clamp((parseInt(editMl.value, 10) || 0) + STEP_ML, ML_MIN, 400));
    });
    $('editMinus').addEventListener('click', () => {
      editMl.value = String(clamp((parseInt(editMl.value, 10) || 0) - STEP_ML, ML_MIN, 400));
    });
    $('editSave').addEventListener('click', saveSheet);
    $('editDelete').addEventListener('click', () => {
      const id = sheet.dataset.id;
      closeSheet();
      deleteRecord(id);
    });

    // 백업 / 복원 / 초기화
    $('btnBackup').addEventListener('click', backup);
    $('btnRestore').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', restore);
    $('btnReset').addEventListener('click', resetAll);

    // 네트워크 상태
    window.addEventListener('online', () => {
      if (!shared()) return;
      setMode('connecting');
      openStream();
      flush();
    });
    window.addEventListener('offline', () => {
      if (!shared()) return;
      setMode('offline');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!shared()) return;
      const stale = !net.lastEvent || Date.now() - net.lastEvent > 60000;
      if (net.mode === 'error' || net.mode === 'offline' ||
          (net.mode === 'connecting' && !net.es && !net.pollTimer) ||
          (net.mode === 'live' && stale)) {
        connectShare({ announce: false });
      } else {
        flush();
      }
    });
  }

  function bumpBox(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /* ───────────── 수정 시트 ───────────── */
  function openSheet(id) {
    const rec = state.records.find((r) => r.id === id);
    if (!rec) return;
    const d = new Date(rec.at);
    sheet.dataset.id = id;
    editDate.value = dayKey(d);
    editTime.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    editMl.value = String(rec.ml);
    $('sheetTitle').textContent = rec.by ? `기록 수정 · ${byLabel(rec.by)}` : '기록 수정';
    sheet.hidden = false;
  }
  function closeSheet() {
    sheet.hidden = true;
    sheet.dataset.id = '';
  }
  function saveSheet() {
    const rec = state.records.find((r) => r.id === sheet.dataset.id);
    if (!rec) { closeSheet(); return; }
    const datePart = editDate.value;
    const timePart = editTime.value;
    const ml = clamp(Math.round((parseFloat(editMl.value) || 0) / STEP_ML) * STEP_ML, ML_MIN, 400);
    if (!datePart || !timePart) { toast('날짜와 시간을 확인해 주세요'); return; }
    const [y, mo, da] = datePart.split('-').map(Number);
    const [hh, mi] = timePart.split(':').map(Number);
    const at = new Date(y, mo - 1, da, hh, mi, 0, 0);
    if (isNaN(at.getTime())) { toast('날짜와 시간을 확인해 주세요'); return; }
    rec.at = at.toISOString();
    rec.ml = ml;
    rec.updatedAt = Date.now();
    save();
    markDirty(rec.id);
    renderAll();
    closeSheet();
    toast('기록을 고쳤어요');
  }

  /* ───────────── 백업 / 복원 / 초기화 ───────────── */
  function backup() {
    const data = {
      app: 'baby-feeding',
      version: 2,
      exportedAt: new Date().toISOString(),
      base: state.base,
      records: state.records,
      tomb: state.tomb,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `수유기록-${dayKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('백업 파일을 저장했어요');
  }

  function restore() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const rows = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(rows)) throw new Error('records 없음');
        const now = Date.now();
        const records = rows
          .filter((r) => r && r.at && isFinite(new Date(r.at).getTime()) && isFinite(Number(r.ml)) && Number(r.ml) > 0)
          .map((r) => ({
            id: uid(),
            at: new Date(r.at).toISOString(),
            ml: Math.round(Number(r.ml)),
            by: r.by === 'mom' || r.by === 'dad' ? r.by : null,
            updatedAt: now,
          }));
        if (records.length === 0) throw new Error('기록 없음');
        const ok = window.confirm(`백업 파일의 기록 ${records.length}개로 바꿀까요?\n지금 기록 ${state.records.length}개는 사라져요.`);
        if (!ok) return;
        const keep = new Set(records.map((r) => r.id));
        state.records.forEach((r) => { if (!keep.has(r.id)) state.tomb[r.id] = now; });
        state.records = records;
        if (typeof data.base === 'number') {
          state.base = clamp(Math.round(data.base / 10) * 10, BASE_MIN, BASE_MAX);
        }
        amount = state.base;
        save();
        records.forEach((r) => markDirty(r.id));
        renderAll();
        toast(`기록 ${records.length}개를 복원했어요`);
      } catch (err) {
        toast('백업 파일을 읽지 못했어요');
        console.warn('복원 실패', err);
      } finally {
        fileInput.value = '';
      }
    };
    reader.onerror = () => { toast('파일을 읽지 못했어요'); fileInput.value = ''; };
    reader.readAsText(file);
  }

  function resetAll() {
    const ok = window.confirm('모든 기록을 지우고 기본량을 60ml로 되돌릴까요?\n되돌릴 수 없어요.');
    if (!ok) return;
    const now = Date.now();
    const ids = state.records.map((r) => r.id);
    ids.forEach((id) => { state.tomb[id] = now; });
    state.records = [];
    state.base = BASE_START;
    amount = BASE_START;
    save();
    ids.forEach((id) => markDirty(id));
    weekOffset = 0;
    renderAll();
    toast('모두 지웠어요');
  }

  /* ───────────── 시작 ───────────── */
  function init() {
    buildTicks();
    loadShare();
    load();
    pruneTombstones();
    amount = state.base;
    savedMin = round10();
    setWho(who);
    renderAll();
    bind();
    requestAnimationFrame(tick);

    if (shared()) connectShare({ announce: share.linked });

    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('오프라인 준비 실패', err));
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
