(() => {
  'use strict';

  /* ───────────── 상수 ───────────── */
  const LS_KEY = 'babyFeeding.v1';
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

  /* ───────────── 상태 ───────────── */
  const state = { base: BASE_START, records: [] };
  let savedMin = 0;            // ② 저장된 시각 (자정 기준 분)
  let amount = BASE_START;     // ⑦ 당시 수유량
  let weekOffset = 0;
  let toastTimer = null;

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
          .map((r) => ({ id: typeof r.id === 'string' ? r.id : uid(), at: new Date(r.at).toISOString(), ml: Math.round(r.ml) }));
      }
    } catch (err) {
      console.warn('저장된 기록을 읽지 못했어요', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ base: state.base, records: state.records }));
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
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', `${d.getMonth() + 1}월 ${d.getDate()}일 ${clock24(d.getHours() * 60 + d.getMinutes())} ${r.ml}ml 기록 수정`);

      const date = document.createElement('span');
      date.className = 'c-date';
      date.textContent = key === todayKey ? '오늘' : `${d.getMonth() + 1}/${d.getDate()}`;

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

    state.records.push({ id: uid(), at: at.toISOString(), ml: value });
    save();
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

    toast(`${value}ml 기록했어요 · ${clock24(savedMin)}`);
  }

  function deleteRecord(id) {
    const idx = state.records.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const removed = state.records.splice(idx, 1)[0];
    save();
    renderAll();
    toast(`${removed.ml}ml 기록을 지웠어요`, () => {
      state.records.splice(Math.min(idx, state.records.length), 0, removed);
      save();
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

  /* ───────────── 이벤트 ───────────── */
  function bind() {
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
    save();
    renderAll();
    closeSheet();
    toast('기록을 고쳤어요');
  }

  /* ───────────── 백업 / 복원 / 초기화 ───────────── */
  function backup() {
    const data = {
      app: 'baby-feeding',
      version: 1,
      exportedAt: new Date().toISOString(),
      base: state.base,
      records: state.records,
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
        const records = rows
          .filter((r) => r && r.at && isFinite(new Date(r.at).getTime()) && isFinite(Number(r.ml)) && Number(r.ml) > 0)
          .map((r) => ({ id: uid(), at: new Date(r.at).toISOString(), ml: Math.round(Number(r.ml)) }));
        if (records.length === 0) throw new Error('기록 없음');
        const ok = window.confirm(`백업 파일의 기록 ${records.length}개로 바꿀까요?\n지금 기록 ${state.records.length}개는 사라져요.`);
        if (!ok) return;
        state.records = records;
        if (typeof data.base === 'number') {
          state.base = clamp(Math.round(data.base / 10) * 10, BASE_MIN, BASE_MAX);
        }
        amount = state.base;
        save();
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
    state.records = [];
    state.base = BASE_START;
    amount = BASE_START;
    save();
    weekOffset = 0;
    renderAll();
    toast('모두 지웠어요');
  }

  /* ───────────── 시작 ───────────── */
  function init() {
    buildTicks();
    load();
    amount = state.base;
    savedMin = round10();
    renderAll();
    bind();
    requestAnimationFrame(tick);

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
