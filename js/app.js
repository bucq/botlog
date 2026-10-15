(() => {
  'use strict';

  const GUEST_KEY = 'bot100log:v1';
  const userKey = id => `bot100log:user:${id}`;
  const cloud = window.BotlogCloud;

  // better: 'low' = 小さいほど良い（タイム）, 'high' = 大きいほど良い（撃破数）
  const MODES = {
    b100_static: { label: '100体 移動なし', unit: '秒', better: 'low', initial: 60, hint: '100体倒すまでのタイム' },
    b100_strafe: { label: '100体 移動あり', unit: '秒', better: 'low', initial: 70, hint: '100体倒すまでのタイム' },
    k30_easy: { label: '30秒 Easy', unit: '体', better: 'high', initial: 25, hint: '30秒間の撃破数' },
    k30_medium: { label: '30秒 Medium', unit: '体', better: 'high', initial: 20, hint: '30秒間の撃破数' },
    k30_hard: { label: '30秒 Hard', unit: '体', better: 'high', initial: 15, hint: '30秒間の撃破数' },
  };

  // ---------- State ----------
  // ゲストは GUEST_KEY、ログイン中はユーザーごとのキーに保存する（オフライン時のキャッシュ兼、未送信分の置き場）
  let storageKey = GUEST_KEY;
  let state = load();
  let trendChart = null;
  let distChart = null;
  let rankChart = null;

  // account: ログイン中なら { id, profile }
  let account = null;
  const sync = { running: false, again: false, error: '', lastAt: 0 };

  function defaultState() {
    return {
      version: 3,
      records: [],
      deleted: [], // ログイン中に削除し、まだサーバーへ反映していない id
      settings: { mode: 'b100_static', goals: {}, lastWeaponId: '', lastSkinId: '' },
    };
  }

  function load(key = storageKey) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultState();
      return normalize(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch {
      toast('保存に失敗しました（ストレージ容量またはプライベートモード）');
      return false;
    }
  }

  function normalize(data) {
    const base = defaultState();
    if (!data || !Array.isArray(data.records)) throw new Error('invalid data');
    base.records = data.records
      .map(r => ({
        id: String(r.id || uid()),
        date: r.date,
        // v1 は time / difficulty 形式だったので 100体 移動なし として取り込む
        mode: MODES[r.mode] ? r.mode : 'b100_static',
        value: Math.round(Number(r.value ?? r.time)),
        // 名前も保存しておき、API が使えないときや画像のない旧記録でも表示できるようにする
        weaponId: typeof r.weaponId === 'string' ? r.weaponId : '',
        weapon: typeof r.weapon === 'string' ? r.weapon : '',
        skinId: typeof r.skinId === 'string' ? r.skinId : '',
        skin: typeof r.skin === 'string' ? r.skin : '',
        createdAt: r.createdAt || new Date().toISOString(),
        synced: r.synced === true, // サーバーに保存済みか
      }))
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value));
    if (Array.isArray(data.deleted)) base.deleted = data.deleted.map(String);
    const s = data.settings || {};
    if (MODES[s.mode]) base.settings.mode = s.mode;
    if (s.goals && typeof s.goals === 'object') base.settings.goals = { ...s.goals };
    if (typeof s.lastWeaponId === 'string') base.settings.lastWeaponId = s.lastWeaponId;
    if (typeof s.lastSkinId === 'string') base.settings.lastSkinId = s.lastSkinId;
    return base;
  }

  // ---------- Utils ----------
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function ymd(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(s, n) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  const today = () => ymd(new Date());
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const fmtVal = v => (v == null || !Number.isFinite(v) ? '-' : String(Math.round(v)));
  const fmtAvg = v => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(1));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Mode helpers ----------
  const mode = () => MODES[state.settings.mode];
  const modeRecords = () => state.records.filter(r => r.mode === state.settings.mode);
  const bestOf = values => (values.length ? (mode().better === 'low' ? Math.min(...values) : Math.max(...values)) : null);
  const worstOf = values => (values.length ? (mode().better === 'low' ? Math.max(...values) : Math.min(...values)) : null);
  const isBetter = (a, b) => (mode().better === 'low' ? a < b : a > b);

  function diffOf(cur, prev) {
    if (cur == null || prev == null) return { text: '-', cls: '' };
    const d = cur - prev;
    const sign = d > 0 ? '+' : '';
    const improved = mode().better === 'low' ? d < 0 : d > 0;
    return { text: `${sign}${d.toFixed(1)}`, cls: d === 0 ? '' : improved ? 'good' : 'bad' };
  }

  function setKpi(sel, d) {
    const el = $(sel);
    el.textContent = d.text;
    el.className = `kpi-value ${d.cls}`;
  }

  // ---------- Weapon catalog (valorant-api.com) ----------
  const CATALOG_URL = 'https://valorant-api.com/v1/weapons?language=ja-JP';
  const CATALOG_KEY = 'bot100log:catalog';
  const CATALOG_TTL = 7 * 24 * 60 * 60 * 1000;
  const CATEGORY_ORDER = ['Sidearm', 'SMG', 'Shotgun', 'Rifle', 'Sniper', 'Heavy'];
  const CATEGORY_LABEL = { Sidearm: 'サイドアーム', SMG: 'SMG', Shotgun: 'ショットガン', Rifle: 'ライフル', Sniper: 'スナイパー', Heavy: 'マシンガン' };
  const DEFAULT_SKIN_LABEL = 'ノーマル';

  let catalog = null; // { weapons: [...], fetchedAt }
  const weaponById = new Map();
  const skinById = new Map();
  // ピッカーで編集中の選択
  const loadout = { weaponId: '', skinId: '' };

  // API レスポンスは約4MBあるため、必要な項目だけに絞ってキャッシュする
  function slimCatalog(json) {
    const weapons = json.data
      .map(w => {
        const category = (w.category || '').split('::').pop();
        if (!CATEGORY_ORDER.includes(category)) return null; // 近接武器は除外
        const skins = w.skins
          .filter(s => s.uuid !== w.defaultSkinUuid && !/ランダム|Random/.test(s.displayName))
          .map(s => ({
            id: s.uuid,
            name: s.displayName.replace(w.displayName, '').trim() || s.displayName,
            icon: s.displayIcon || s.chromas?.[0]?.displayIcon || s.chromas?.[0]?.fullRender || s.levels?.[0]?.displayIcon || w.displayIcon,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        skins.unshift({ id: w.defaultSkinUuid, name: DEFAULT_SKIN_LABEL, icon: w.displayIcon, isDefault: true });
        return { id: w.uuid, name: w.displayName, category, icon: w.displayIcon, defaultSkinId: w.defaultSkinUuid, skins };
      })
      .filter(Boolean)
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
    return { weapons, fetchedAt: Date.now() };
  }

  function indexCatalog() {
    weaponById.clear();
    skinById.clear();
    for (const w of catalog.weapons) {
      weaponById.set(w.id, w);
      for (const s of w.skins) skinById.set(s.id, { ...s, weaponId: w.id });
    }
  }

  async function loadCatalog() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CATALOG_KEY)); } catch { /* ignore */ }
    if (cached?.weapons) {
      catalog = cached;
      indexCatalog();
      if (Date.now() - cached.fetchedAt < CATALOG_TTL) return;
    }
    try {
      const res = await fetch(CATALOG_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      catalog = slimCatalog(await res.json());
      indexCatalog();
      try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)); } catch { /* 容量不足時はキャッシュしない */ }
    } catch {
      // 期限切れでもキャッシュがあればそれを使い続ける
      if (!catalog) throw new Error('catalog unavailable');
    }
  }

  function skinIcon(r) {
    return skinById.get(r.skinId)?.icon || weaponById.get(r.weaponId)?.icon || '';
  }

  function loadoutLabel(r) {
    if (!r.weapon) return '';
    return r.skin && r.skin !== DEFAULT_SKIN_LABEL ? `${r.weapon} / ${r.skin}` : `${r.weapon}（${DEFAULT_SKIN_LABEL}）`;
  }

  function currentLoadout() {
    const w = weaponById.get(loadout.weaponId);
    if (!w) return { weaponId: '', weapon: '', skinId: '', skin: '' };
    const s = skinById.get(loadout.skinId) || skinById.get(w.defaultSkinId);
    return { weaponId: w.id, weapon: w.name, skinId: s.id, skin: s.name };
  }

  function renderLoadoutButton() {
    const l = currentLoadout();
    const img = $('#loadout-img');
    const icon = skinIcon(l);
    img.hidden = !icon;
    if (icon) img.src = icon;
    $('#loadout-text').textContent = l.weapon ? loadoutLabel(l) : '未選択';
  }

  function openPicker() {
    const status = $('#picker-status');
    $('#picker').showModal();
    if (!catalog) {
      status.hidden = false;
      status.textContent = '武器データを読み込み中…';
      loadCatalog()
        .then(() => { status.hidden = true; renderWeaponGrid(); renderSkinGrid(); })
        .catch(() => { status.textContent = '武器データを取得できませんでした。通信環境を確認してください。'; });
      return;
    }
    status.hidden = true;
    renderWeaponGrid();
    renderSkinGrid();
  }

  function renderWeaponGrid() {
    const groups = CATEGORY_ORDER.map(cat => ({ cat, weapons: catalog.weapons.filter(w => w.category === cat) }));
    $('#weapon-grid').innerHTML = groups
      .filter(g => g.weapons.length)
      .map(g => `<div class="weapon-cat">
        <span class="weapon-cat-label">${CATEGORY_LABEL[g.cat]}</span>
        ${g.weapons.map(w => `<button type="button" class="pick ${w.id === loadout.weaponId ? 'active' : ''}" data-weapon="${w.id}">
          <img src="${w.icon}" alt="" loading="lazy"><span>${escapeHtml(w.name)}</span></button>`).join('')}
      </div>`)
      .join('');
  }

  function renderSkinGrid() {
    const w = weaponById.get(loadout.weaponId);
    $('#skin-section').hidden = !w;
    if (!w) return;
    const q = $('#skin-search').value.trim().toLowerCase();
    const skins = w.skins.filter(s => !q || s.name.toLowerCase().includes(q));
    const selected = loadout.skinId || w.defaultSkinId;
    $('#skin-grid').innerHTML = skins
      .map(s => `<button type="button" class="pick ${s.id === selected ? 'active' : ''}" data-skin="${s.id}">
        <img src="${s.icon}" alt="" loading="lazy"><span>${escapeHtml(s.name)}</span></button>`)
      .join('') || '<p class="hint">該当するスキンがありません</p>';
  }

  function pickWeapon(id) {
    if (loadout.weaponId !== id) {
      loadout.weaponId = id;
      loadout.skinId = weaponById.get(id).defaultSkinId;
      $('#skin-search').value = '';
    }
    renderWeaponGrid();
    renderSkinGrid();
    $('#skin-grid').scrollTop = 0;
    // スマホでは武器一覧が画面を占めるので、スキン一覧までスクロールする
    if (window.matchMedia('(max-width: 480px)').matches) $('#skin-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pickSkin(id) {
    loadout.skinId = id;
    closePicker();
  }

  function closePicker() {
    $('#picker').close();
    state.settings.lastWeaponId = loadout.weaponId;
    state.settings.lastSkinId = loadout.skinId;
    save();
    renderLoadoutButton();
  }

  // ---------- Aggregation ----------
  function groupByDate(records) {
    const map = new Map();
    for (const r of records) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date).push(r);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, recs]) => {
        const values = recs.map(r => r.value);
        return {
          date,
          records: recs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          count: values.length,
          avg: mean(values),
          best: bestOf(values),
          worst: worstOf(values),
        };
      });
  }

  function streak(dates) {
    const set = new Set(dates);
    let cur = today();
    if (!set.has(cur)) cur = addDays(cur, -1);
    let n = 0;
    while (set.has(cur)) {
      n++;
      cur = addDays(cur, -1);
    }
    return n;
  }

  function avgInRange(records, from, to) {
    const v = records.filter(r => r.date >= from && r.date <= to).map(r => r.value);
    return v.length ? mean(v) : null;
  }

  // ---------- Mode UI ----------
  function applyModeUi() {
    const m = mode();
    $$('.mode-btn').forEach(b => {
      const active = b.dataset.mode === state.settings.mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    $$('.js-mode-label').forEach(el => (el.textContent = m.label));
    $$('.js-unit').forEach(el => (el.textContent = m.unit));
    $('.js-value-hint').textContent = `${m.hint}（${m.better === 'low' ? '少ないほど良い' : '多いほど良い'}）`;
    // 直前の記録値を初期値にして ±1 で調整しやすくする
    const recs = modeRecords().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    $('#input-value').value = recs.length ? recs[recs.length - 1].value : m.initial;
    updateDial();
  }

  function setMode(key) {
    if (!MODES[key] || key === state.settings.mode) return;
    state.settings.mode = key;
    save();
    $('#pb-banner').hidden = true;
    applyModeUi();
    renderAll();
    if (activeTab === 'ranking') renderRanking();
  }

  // ---------- Record tab ----------
  function renderToday() {
    const t = today();
    const recs = modeRecords().filter(r => r.date === t).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const values = recs.map(r => r.value);
    const prevDay = groupByDate(modeRecords()).reverse().find(d => d.date < t);
    const unit = mode().unit;

    $('#today-label').textContent = t;
    $('#today-count').textContent = recs.length;
    $('#today-avg').textContent = values.length ? `${fmtAvg(mean(values))}${unit}` : '-';
    $('#today-best').textContent = values.length ? `${fmtVal(bestOf(values))}${unit}` : '-';
    setKpi('#today-diff', diffOf(values.length ? mean(values) : null, prevDay ? prevDay.avg : null));

    const best = bestOf(values);
    $('#today-list').innerHTML = recs
      .map((r, i) => attemptItem(r, i + 1, r.value === best))
      .reverse()
      .join('');
  }

  function attemptItem(r, idx, isBest) {
    const time = new Date(r.createdAt);
    const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
    const label = loadoutLabel(r);
    const icon = skinIcon(r);
    return `<li>
      <span class="idx">#${idx}</span>
      <span class="time">${fmtVal(r.value)}${MODES[r.mode].unit}</span>
      ${isBest ? '<span class="best-tag">BEST</span>' : ''}
      ${icon ? `<img class="thumb" src="${icon}" alt="" loading="lazy">` : ''}
      <span class="meta">${hhmm}${label ? ' · ' + escapeHtml(label) : ''}</span>
      <button class="del" data-id="${r.id}" title="削除" aria-label="削除">✕</button>
    </li>`;
  }

  function stepValue(delta) {
    const input = $('#input-value');
    const cur = parseInt(input.value, 10);
    const base = Number.isFinite(cur) ? cur : mode().initial;
    input.value = Math.max(0, base + delta);
    updateDial();
  }

  // ダイヤル：60目盛り。値が1変わるごとに1目盛り（6°）回る。秒ならストップウォッチの文字盤と一致
  function buildDial() {
    const lines = [];
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const a = (i * 6 * Math.PI) / 180;
      const r1 = 96;
      const r2 = major ? 82 : 88;
      const p = r => `${(100 + r * Math.sin(a)).toFixed(2)},${(100 - r * Math.cos(a)).toFixed(2)}`;
      const [x1, y1] = p(r1).split(',');
      const [x2, y2] = p(r2).split(',');
      lines.push(`<line class="${major ? 'major' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    }
    $('#dial-ticks').innerHTML = lines.join('');
  }

  // 値が増えると時計回り。extra はドラッグ中に指へ追従させる端数の角度
  function updateDial(extra = 0) {
    const v = parseInt($('#input-value').value, 10);
    $('#dial-ticks').style.transform = `rotate(${(Number.isFinite(v) ? v : 0) * 6 + extra}deg)`;
  }

  // ダイヤルのドラッグ操作
  //  - 外側のリングから始めた場合: 円に沿ってなぞると回る（6°で ±1、時計回りで増加）
  //  - 中央の数字から始めた場合: ドラッグしても何もしない（タップのみ）
  //  - 動かさずに離した場合: 数字を直接入力
  function setupDialDrag() {
    const dial = $('.dial');
    const input = $('#input-value');
    const DEG = 6;
    let drag = null;
    let suppressClick = false;

    const angleAt = (e, c) => (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI;
    const step = delta => {
      const before = input.value;
      stepValue(delta);
      if (input.value !== before && navigator.vibrate) navigator.vibrate(4);
    };

    dial.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rect = dial.getBoundingClientRect();
      const c = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const dist = Math.hypot(e.clientX - c.x, e.clientY - c.y);
      drag = {
        id: e.pointerId,
        c,
        rotate: dist > (rect.width / 2) * 0.6,
        startX: e.clientX,
        startY: e.clientY,
        lastAngle: angleAt(e, c),
        acc: 0,
        moved: false,
      };
      // タッチでは入力欄のフォーカス（キーボード表示）を止め、タップ判定は pointerup で行う
      if (e.pointerType !== 'mouse') e.preventDefault();
      try { dial.setPointerCapture(e.pointerId); } catch { /* 合成イベントなどでは捕捉できない */ }
    });

    dial.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
        drag.moved = true; // 中央でも動かしたらタップ扱いにしない
        if (!drag.rotate) return;
        dial.classList.add('dragging');
        input.blur();
      }
      if (drag.rotate) {
        const a = angleAt(e, drag.c);
        let d = a - drag.lastAngle;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        drag.lastAngle = a;
        drag.acc += d; // 画面座標では角度の増加 = 時計回り
        // ポインター座標は float32 のため、ちょうど境界の回転が取りこぼされないよう 0.01° の余裕を持たせる
        while (drag.acc >= DEG - 0.01) { step(1); drag.acc -= DEG; }
        while (drag.acc <= -DEG + 0.01) { step(-1); drag.acc += DEG; }
        updateDial(drag.acc);
      }
    });

    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const tapped = !drag.moved && e.type === 'pointerup';
      suppressClick = drag.moved;
      drag = null;
      dial.classList.remove('dragging');
      updateDial();
      if (tapped && e.pointerType !== 'mouse') {
        input.focus();
        input.select();
      }
    };
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);
    // ドラッグ直後のクリックで入力欄にフォーカスが移らないようにする
    dial.addEventListener('click', e => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  function addRecord(e) {
    e.preventDefault();
    const value = Math.round(Number($('#input-value').value));
    if (!Number.isFinite(value) || value < 0 || $('#input-value').value === '') {
      toast('値を正しく入力してください');
      return;
    }
    const m = mode();
    const prevBest = bestOf(modeRecords().map(r => r.value));
    state.records.push({
      id: uid(),
      date: $('#input-date').value || today(),
      mode: state.settings.mode,
      value,
      ...currentLoadout(),
      createdAt: new Date().toISOString(),
      synced: false,
    });
    save();
    requestSync();

    const banner = $('#pb-banner');
    if (prevBest !== null && isBetter(value, prevBest)) {
      banner.textContent = `自己ベスト更新　${prevBest}${m.unit} → ${value}${m.unit}`;
      banner.hidden = false;
      clearTimeout(addRecord.timer);
      addRecord.timer = setTimeout(() => (banner.hidden = true), 6000);
    } else {
      toast(`${value} ${m.unit} を記録しました`);
    }
    renderAll();
  }

  function deleteRecord(id) {
    const r = state.records.find(x => x.id === id);
    if (!r) return;
    const m = MODES[r.mode];
    if (!confirm(`${r.date} の ${m.label} ${r.value}${m.unit} を削除しますか？`)) return;
    state.records = state.records.filter(x => x.id !== id);
    // 送信中の記録を消した場合もサーバー側を確実に消すため、ログイン中は常に削除予定へ積む
    if (account) state.deleted.push(id);
    save();
    renderAll();
    requestSync();
  }

  // ---------- Stats tab ----------
  function renderStats() {
    const recs = modeRecords();
    const days = groupByDate(recs);
    const t = today();
    const unit = mode().unit;

    const pb = bestOf(recs.map(r => r.value));
    $('#all-pb').textContent = pb === null ? '-' : `${pb}${unit}`;
    $('#all-count').textContent = recs.length;
    $('#all-days').textContent = days.length;
    $('#all-streak').textContent = `${streak([...new Set(state.records.map(r => r.date))])}日`;

    const recent = avgInRange(recs, addDays(t, -6), t);
    const prev = avgInRange(recs, addDays(t, -13), addDays(t, -7));
    $('#recent-avg').textContent = recent === null ? '-' : `${fmtAvg(recent)}${unit}`;
    setKpi('#recent-diff', diffOf(recent, prev));

    renderTrendChart();
    renderDistChart();
    renderSetupTable(recs);
    renderHeatmap();
  }

  function filteredRecords() {
    const range = $('#filter-range').value;
    const from = range === 'all' ? '' : addDays(today(), -(Number(range) - 1));
    return modeRecords().filter(r => r.date >= from);
  }

  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = '#69735F';
    Chart.defaults.borderColor = 'rgba(188, 196, 168, 0.55)';
    Chart.defaults.font.family = '"Zen Kaku Gothic New", sans-serif';
  }

  function renderTrendChart() {
    if (!window.Chart) return;
    const m = mode();
    const days = groupByDate(filteredRecords());
    const labels = days.map(d => d.date.slice(5));
    // 練習日ベースの7日移動平均（試行回数で加重）
    const ma = days.map((_, i) => {
      const win = days.slice(Math.max(0, i - 6), i + 1);
      const total = win.reduce((s, d) => s + d.avg * d.count, 0);
      const n = win.reduce((s, d) => s + d.count, 0);
      return +(total / n).toFixed(1);
    });
    const goal = state.settings.goals[state.settings.mode];

    const datasets = [
      { type: 'line', label: '平均', data: days.map(d => +d.avg.toFixed(1)), borderColor: '#43603F', backgroundColor: '#43603F', borderWidth: 2.5, pointRadius: 3, tension: 0.25, yAxisID: 'y', order: 1 },
      { type: 'line', label: 'ベスト', data: days.map(d => d.best), borderColor: '#B5861A', backgroundColor: '#B5861A', borderWidth: 2, pointRadius: 2.5, tension: 0.25, yAxisID: 'y', order: 1 },
      { type: 'line', label: '7日移動平均', data: ma, borderColor: '#1E2A1F', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, tension: 0.3, yAxisID: 'y', order: 0 },
      { type: 'bar', label: '回数', data: days.map(d => d.count), backgroundColor: 'rgba(188, 196, 168, 0.45)', borderRadius: 3, yAxisID: 'y2', order: 2 },
    ];
    if (goal != null) {
      datasets.push({ type: 'line', label: `目標 ${goal}${m.unit}`, data: days.map(() => goal), borderColor: '#A44A32', borderDash: [2, 4], pointRadius: 0, borderWidth: 1.5, yAxisID: 'y', order: 0 });
    }

    if (trendChart) trendChart.destroy();
    trendChart = new Chart($('#trend-chart'), {
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: items => days[items[0].dataIndex].date,
              label: ctx => (ctx.dataset.yAxisID === 'y2' ? ` 回数: ${ctx.raw}` : ` ${ctx.dataset.label}: ${ctx.raw}${m.unit}`),
            },
          },
        },
        scales: {
          // タイムは小さいほど良いので軸を反転し、どのモードでも「上＝成長」に揃える
          y: { reverse: m.better === 'low', title: { display: true, text: m.unit }, grace: '5%', ticks: { precision: 0 } },
          y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { precision: 0 }, title: { display: true, text: '回数' } },
        },
      },
    });
  }

  function renderDistChart() {
    if (!window.Chart) return;
    const m = mode();
    const values = filteredRecords().map(r => r.value);
    if (distChart) distChart.destroy();
    const buckets = [];
    if (values.length) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const bin = max - min + 1 > 30 ? Math.ceil((max - min + 1) / 20) : 1;
      const start = Math.floor(min / bin) * bin;
      for (let b = start; b <= max; b += bin) buckets.push({ from: b, to: b + bin - 1, n: 0 });
      for (const v of values) buckets[Math.floor((v - start) / bin)].n++;
    }
    distChart = new Chart($('#dist-chart'), {
      type: 'bar',
      data: {
        labels: buckets.map(b => (b.from === b.to ? `${b.from}` : `${b.from}-${b.to}`)),
        datasets: [{ label: '回数', data: buckets.map(b => b.n), backgroundColor: '#43603F', borderRadius: 3 }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: m.unit } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  function renderSetupTable(recs) {
    const map = new Map();
    for (const r of recs) {
      const key = `${r.weapon}\u0000${r.skin}`;
      if (!map.has(key)) map.set(key, { rec: r, values: [] });
      map.get(key).values.push(r.value);
    }
    const rows = [...map.values()]
      .map(g => ({ ...g, avg: mean(g.values), best: bestOf(g.values) }))
      .sort((a, b) => (mode().better === 'low' ? a.avg - b.avg : b.avg - a.avg));
    $('#setup-empty').hidden = rows.length > 0;
    $('#setup-body').innerHTML = rows
      .map(g => {
        const icon = skinIcon(g.rec);
        const label = loadoutLabel(g.rec);
        return `<tr>
        <td><span class="setup-cell">${icon ? `<img class="thumb" src="${icon}" alt="" loading="lazy">` : ''}${label ? escapeHtml(label) : '<span class="muted">未設定</span>'}</span></td>
        <td>${g.values.length}</td>
        <td>${fmtAvg(g.avg)}</td>
        <td>${g.best}</td>
      </tr>`;
      })
      .join('');
  }

  function renderHeatmap() {
    const counts = new Map();
    for (const r of state.records) counts.set(r.date, (counts.get(r.date) || 0) + 1);
    const weeks = 20;
    const now = new Date();
    // 週の始まり（日曜）に揃える
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - now.getDay() - (weeks - 1) * 7);
    const t = today();
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const key = ymd(d);
      const n = counts.get(key) || 0;
      const lvl = n === 0 ? '' : n < 3 ? 'l1' : n < 6 ? 'l2' : n < 10 ? 'l3' : 'l4';
      const future = key > t ? 'future' : '';
      cells.push(`<div class="cell ${lvl} ${future}" title="${key}: ${n}回"></div>`);
    }
    $('#heatmap').innerHTML = cells.join('');
  }

  // ---------- History tab ----------
  function renderHistory() {
    const days = groupByDate(modeRecords()).reverse();
    const pb = bestOf(modeRecords().map(r => r.value));
    $('#history-empty').hidden = days.length > 0;
    $('#history-body').innerHTML = days
      .map(d => `
        <tr class="day-row" data-date="${d.date}">
          <td>${d.date}</td>
          <td>${d.count}</td>
          <td>${fmtAvg(d.avg)}</td>
          <td class="${d.best === pb ? 'accent' : ''}">${d.best}</td>
          <td>${d.worst}</td>
          <td class="toggle">▸</td>
        </tr>
        <tr class="detail-row" data-for="${d.date}" hidden>
          <td colspan="6"><ul class="attempt-list">${d.records.map((r, i) => attemptItem(r, i + 1, r.value === d.best)).join('')}</ul></td>
        </tr>`)
      .join('');
  }

  // ---------- Settings tab ----------
  function renderSettings() {
    const m = mode();
    const goal = state.settings.goals[state.settings.mode];
    $('#goal-input').value = goal ?? '';
    const el = $('#goal-progress');
    const pb = bestOf(modeRecords().map(r => r.value));
    if (goal == null) {
      el.textContent = '';
    } else if (pb === null) {
      el.textContent = `目標: ${goal}${m.unit}`;
    } else if (!isBetter(goal, pb)) {
      el.textContent = `目標 ${goal}${m.unit} を達成済み（自己ベスト ${pb}${m.unit}）`;
    } else {
      el.textContent = `目標まであと ${Math.abs(pb - goal)}${m.unit}（自己ベスト ${pb}${m.unit}）`;
    }
  }

  function saveGoal() {
    const raw = $('#goal-input').value;
    const v = Math.round(Number(raw));
    const m = mode();
    if (raw === '' || !Number.isFinite(v) || v < 0) {
      delete state.settings.goals[state.settings.mode];
      toast(`${m.label} の目標を解除しました`);
    } else {
      state.settings.goals[state.settings.mode] = v;
      toast(`${m.label} の目標を ${v}${m.unit} に設定しました`);
    }
    save();
    renderAll();
    pushGoals();
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportJson() {
    const data = {
      version: state.version,
      records: state.records.map(({ synced, ...r }) => r),
      settings: state.settings,
    };
    download(`bot100log-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function exportCsv() {
    const rows = [['date', 'mode', 'value', 'unit', 'weapon', 'skin', 'createdAt']];
    const sorted = [...state.records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const r of sorted) rows.push([r.date, MODES[r.mode].label, r.value, MODES[r.mode].unit, r.weapon, r.skin, r.createdAt]);
    const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    // Excel で文字化けしないよう BOM を付与
    download(`bot100log-${today()}.csv`, '﻿' + csv, 'text/csv');
  }

  function importJson(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(text => {
      let incoming;
      try {
        incoming = normalize(JSON.parse(text));
      } catch {
        toast('読み込みに失敗しました（形式が不正です）');
        return;
      }
      if (!confirm(`${incoming.records.length} 件の記録を既存データとマージします（重複は除外）。よろしいですか？`)) return;
      const ids = new Set(state.records.map(r => r.id));
      const added = incoming.records.filter(r => !ids.has(r.id)).map(r => ({ ...r, synced: false }));
      state.records.push(...added);
      state.settings.goals = { ...incoming.settings.goals, ...state.settings.goals };
      save();
      applyModeUi();
      renderAll();
      toast(`${added.length} 件を追加しました`);
      requestSync();
      pushGoals();
    });
  }

  function clearAll() {
    if (!state.records.length) return;
    const where = account ? 'アカウントに保存された全モードの記録' : 'このブラウザに保存された全モードの記録';
    if (!confirm(`${where}を削除します。元に戻せません。\n（事前に JSON 書き出しを推奨）`)) return;
    if (!confirm('本当に削除しますか？')) return;
    const deleted = account ? [...state.deleted, ...state.records.map(r => r.id)] : [];
    state = { ...defaultState(), deleted };
    save();
    applyModeUi();
    renderAll();
    toast('全データを削除しました');
    requestSync();
  }

  // ---------- Account / Sync ----------
  const safeUrl = u => (typeof u === 'string' && u.startsWith('https://') ? escapeHtml(u) : '');

  async function login() {
    try {
      const { error } = await cloud.signIn();
      if (error) throw error;
    } catch (e) {
      toast(`ログインを開始できませんでした: ${e.message}`);
    }
  }

  async function logout() {
    if (state.records.some(r => !r.synced) || state.deleted.length) {
      if (!confirm('まだアカウントに送信していない変更があります。ログアウトするとこの端末で同期されるまで保留になります。ログアウトしますか？')) return;
    }
    try {
      await cloud.signOut();
    } catch (e) {
      toast(`ログアウトに失敗しました: ${e.message}`);
    }
  }

  // ログイン状態の変化（ページ読み込み時の復元・ログイン・ログアウト）
  async function onAuth(user) {
    if ((user?.id || null) === (account?.id || null)) return;
    if (!user) {
      account = null;
      switchStorage(GUEST_KEY);
      toast('ログアウトしました');
      return;
    }
    account = { id: user.id, profile: null };
    switchStorage(userKey(user.id));
    try {
      account.profile = await cloud.getProfile(user.id);
    } catch (e) {
      sync.error = `プロフィールを取得できませんでした: ${e.message}`;
    }
    offerGuestImport(user.id);
    await applyRemoteGoals();
    renderAccount();
    await runSync();
  }

  function switchStorage(key) {
    storageKey = key;
    state = load();
    loadout.weaponId = state.settings.lastWeaponId;
    loadout.skinId = state.settings.lastSkinId;
    rankingCache = null;
    applyModeUi();
    renderLoadoutButton();
    renderAccount();
    renderAll();
    if (activeTab === 'ranking') renderRanking();
  }

  // ゲストで付けていた記録をアカウントへ移す（アカウントごとに一度だけ確認）
  function offerGuestImport(userId) {
    const askedKey = `bot100log:import-asked:${userId}`;
    let asked = false;
    try { asked = localStorage.getItem(askedKey) === '1'; } catch { /* ignore */ }
    const guest = load(GUEST_KEY);
    if (asked || !guest.records.length) return;
    try { localStorage.setItem(askedKey, '1'); } catch { /* ignore */ }
    if (!confirm(`この端末にログイン前の記録が ${guest.records.length} 件あります。アカウントに取り込みますか？`)) return;
    const ids = new Set(state.records.map(r => r.id));
    state.records.push(...guest.records.filter(r => !ids.has(r.id)).map(r => ({ ...r, synced: false })));
    state.settings.goals = { ...guest.settings.goals, ...state.settings.goals };
    renderAll();
    // アカウント側への保存が確認できたときだけゲスト側を空にする（二重取り込み防止）。
    // 念のため元のゲストデータは別キーに残しておく
    if (!save()) return;
    try {
      localStorage.setItem(`${GUEST_KEY}:imported-backup`, JSON.stringify(guest));
      localStorage.setItem(GUEST_KEY, JSON.stringify({ ...guest, records: [] }));
    } catch { /* 容量不足ならゲスト側をそのまま残す */ }
  }

  async function applyRemoteGoals() {
    const remote = account?.profile?.goals || {};
    if (Object.keys(remote).length) {
      state.settings.goals = { ...remote };
      save();
      renderAll();
    } else if (Object.keys(state.settings.goals).length) {
      await pushGoals();
    }
  }

  async function pushGoals() {
    if (!account) return;
    try {
      account.profile = await cloud.updateProfile(account.id, { goals: state.settings.goals });
    } catch (e) {
      toast(`目標をアカウントに保存できませんでした: ${e.message}`);
    }
  }

  function requestSync() {
    if (account) runSync();
  }

  // 未送信の追加・削除を送ってから、サーバーの記録で手元を置き換える
  async function runSync() {
    if (!account) return;
    if (sync.running) { sync.again = true; return; }
    if (!navigator.onLine) { sync.error = 'オフラインです。接続が戻ると自動で同期します'; renderSyncStatus(); return; }
    sync.running = true;
    renderSyncStatus();
    const key = storageKey;
    try {
      const deleting = [...new Set(state.deleted)];
      if (deleting.length) {
        await cloud.deleteRecords(account.id, deleting);
        state.deleted = state.deleted.filter(id => !deleting.includes(id));
      }
      const pending = state.records.filter(r => !r.synced);
      if (pending.length) {
        await cloud.upsertRecords(pending);
        pending.forEach(r => (r.synced = true));
      }
      const remote = await cloud.fetchOwnRecords(account.id);
      if (storageKey !== key) return; // 同期中にアカウントが切り替わった
      const deleted = new Set(state.deleted);
      const merged = new Map(remote.filter(r => !deleted.has(r.id)).map(r => [r.id, { ...r, synced: true }]));
      for (const r of state.records) if (!r.synced) merged.set(r.id, r); // 同期中に追加された分
      state.records = [...merged.values()];
      save();
      sync.error = '';
      sync.lastAt = Date.now();
      renderAll();
    } catch (e) {
      sync.error = `同期に失敗しました: ${e.message}`;
      save();
    } finally {
      sync.running = false;
      renderSyncStatus();
      if (sync.again) { sync.again = false; runSync(); }
    }
  }

  function pendingCount() {
    return state.records.filter(r => !r.synced).length + state.deleted.length;
  }

  function renderSyncStatus() {
    if (!account) return;
    const el = $('#sync-status');
    const pending = pendingCount();
    let text;
    let cls = '';
    if (sync.running) text = '同期中…';
    else if (sync.error) { text = pending ? `${sync.error}（未送信 ${pending} 件）` : sync.error; cls = 'bad'; }
    else if (pending) { text = `未送信 ${pending} 件`; cls = 'bad'; }
    else if (sync.lastAt) text = `同期済み ${new Date(sync.lastAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
    else text = '';
    el.textContent = text;
    el.className = `sync-status ${cls}`;
    $('#account-chip').classList.toggle('has-pending', Boolean(pending || sync.error));
  }

  function renderAccount() {
    const on = cloud.configured;
    $('#account-chip').hidden = !on;
    $('#account-card').hidden = !on;
    $('.tab[data-tab="ranking"]').hidden = !on;
    if (!on) return;

    const p = account?.profile;
    $('#account-guest').hidden = Boolean(account);
    $('#account-user').hidden = !account;
    $('#ranking-guest').hidden = Boolean(account);
    $('#ranking-body').hidden = !account;
    $('#data-hint').textContent = account
      ? '記録はアカウントに保存され、ログインした端末どうしで同期されます。書き出しはバックアップ用です。'
      : 'データはこのブラウザ（localStorage）にのみ保存されます。端末移行やバックアップには書き出しを使ってください。';

    const chip = $('#account-chip');
    if (!account) {
      chip.innerHTML = '<button type="button" class="chip-btn js-login">Discordでログイン</button>';
      return;
    }
    const name = p?.display_name || 'ログイン中';
    const avatar = safeUrl(p?.avatar_url);
    chip.innerHTML = `<button type="button" class="chip-btn user" data-goto="settings" title="アカウント設定">
      ${avatar ? `<img class="avatar" src="${avatar}" alt="" referrerpolicy="no-referrer">` : '<span class="avatar placeholder" aria-hidden="true"></span>'}
      <span class="chip-name">${escapeHtml(name)}</span><span class="chip-dot" aria-hidden="true"></span>
    </button>`;

    $('#account-name').textContent = name;
    const img = $('#account-avatar');
    img.hidden = !avatar;
    if (avatar) img.src = p.avatar_url;
    if (document.activeElement !== $('#display-name-input')) $('#display-name-input').value = p?.display_name || '';
    $('#public-toggle').checked = p ? p.is_public : true;
    $('#public-toggle').disabled = !p;
    renderSyncStatus();
  }

  async function saveDisplayName() {
    const name = $('#display-name-input').value.trim();
    if (!name || name.length > 32) {
      toast('表示名は1〜32文字で入力してください');
      return;
    }
    try {
      account.profile = await cloud.updateProfile(account.id, { display_name: name });
      rankingCache = null;
      renderAccount();
      toast('表示名を変更しました');
    } catch (e) {
      toast(`表示名を変更できませんでした: ${e.message}`);
    }
  }

  async function savePublic() {
    const toggle = $('#public-toggle');
    try {
      account.profile = await cloud.updateProfile(account.id, { is_public: toggle.checked });
      rankingCache = null;
      toast(toggle.checked ? 'ランキングに公開しました' : '非公開にしました');
    } catch (e) {
      toggle.checked = !toggle.checked;
      toast(`公開設定を変更できませんでした: ${e.message}`);
    }
  }

  // ---------- Ranking tab ----------
  let rankingCache = null; // { mode, rows }

  async function renderRanking(force = false) {
    if (!account) return;
    const m = mode();
    const key = state.settings.mode;
    const status = $('#ranking-status');
    $('#ranking-private').hidden = account.profile?.is_public !== false;
    if (force || rankingCache?.mode !== key) {
      status.hidden = false;
      status.textContent = '読み込み中…';
      $('#ranking-tbody').innerHTML = '';
      try {
        const rows = await cloud.fetchLeaderboard(key, m.better);
        if (state.settings.mode !== key) return; // 読み込み中にモードが変わった
        rankingCache = { mode: key, rows };
      } catch (e) {
        status.textContent = `ランキングを読み込めませんでした: ${e.message}`;
        return;
      }
    }
    const rows = rankingCache.rows;
    status.hidden = rows.length > 0;
    status.textContent = 'このモードの公開記録はまだありません。最初の記録を付けてみましょう。';
    let rank = 0;
    let prev = null;
    $('#ranking-tbody').innerHTML = rows
      .map((r, i) => {
        if (r.best !== prev) { rank = i + 1; prev = r.best; } // 同タイムは同順位
        const avatar = safeUrl(r.avatar_url);
        const me = r.user_id === account.id;
        return `<tr class="rank-row ${me ? 'me' : ''}" data-user="${escapeHtml(r.user_id)}" data-name="${escapeHtml(r.display_name)}">
          <td class="rank">${rank}</td>
          <td><span class="player">${avatar ? `<img class="avatar" src="${avatar}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<span class="avatar placeholder" aria-hidden="true"></span>'}${escapeHtml(r.display_name)}${me ? '<span class="me-tag">あなた</span>' : ''}</span></td>
          <td class="best">${r.best}${m.unit}</td>
          <td>${r.recent_avg == null ? '-' : `${Number(r.recent_avg).toFixed(1)}${m.unit}`}</td>
          <td>${r.attempts}</td>
          <td class="date">${r.last_date}</td>
        </tr>`;
      })
      .join('');
  }

  async function toggleRankDetail(row) {
    const next = row.nextElementSibling;
    if (next?.classList.contains('rank-detail')) {
      next.remove();
      if (rankChart) { rankChart.destroy(); rankChart = null; }
      return;
    }
    $$('.rank-detail').forEach(el => el.remove());
    if (rankChart) { rankChart.destroy(); rankChart = null; }
    const detail = document.createElement('tr');
    detail.className = 'rank-detail';
    detail.innerHTML = `<td colspan="6"><p class="hint">読み込み中…</p><div class="chart-wrap small" hidden><canvas></canvas></div></td>`;
    row.after(detail);
    const m = mode();
    try {
      const recs = await cloud.fetchUserRecords(row.dataset.user, state.settings.mode);
      if (!detail.isConnected) return;
      const days = groupByDate(recs);
      detail.querySelector('.hint').textContent = `${row.dataset.name} さんの日別記録（${days.length} 日・${recs.length} 回）`;
      const wrap = detail.querySelector('.chart-wrap');
      wrap.hidden = false;
      rankChart = new Chart(wrap.querySelector('canvas'), {
        type: 'line',
        data: {
          labels: days.map(d => d.date.slice(5)),
          datasets: [
            { label: '平均', data: days.map(d => +d.avg.toFixed(1)), borderColor: '#43603F', backgroundColor: '#43603F', borderWidth: 2.5, pointRadius: 2.5, tension: 0.25 },
            { label: 'ベスト', data: days.map(d => d.best), borderColor: '#B5861A', backgroundColor: '#B5861A', borderWidth: 2, pointRadius: 2, tension: 0.25 },
          ],
        },
        options: {
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}${m.unit}` } } },
          scales: { y: { reverse: m.better === 'low', ticks: { precision: 0 }, title: { display: true, text: m.unit } } },
        },
      });
    } catch (e) {
      detail.querySelector('.hint').textContent = `記録を読み込めませんでした: ${e.message}`;
    }
  }

  // ---------- Wiring ----------
  let activeTab = 'record';

  function switchTab(name) {
    activeTab = name;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    try { sessionStorage.setItem('bot100log:tab', name); } catch { /* ignore */ }
    if (name === 'stats') renderStats(); // canvas は表示状態で描画する必要がある
    if (name === 'ranking') renderRanking();
  }

  function renderAll() {
    renderToday();
    renderHistory();
    renderSettings();
    if (activeTab === 'stats') renderStats();
  }

  function init() {
    chartDefaults();
    $('#input-date').value = today();
    loadout.weaponId = state.settings.lastWeaponId;
    loadout.skinId = state.settings.lastSkinId;

    $$('.mode-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    buildDial();
    $('#input-value').addEventListener('input', () => updateDial());
    setupDialDrag();
    $$('.step-btn').forEach(b => b.addEventListener('click', () => stepValue(Number(b.dataset.step))));
    // ホイール上で ±1（上で増加）。トラックパッドの細かいイベントは一定量たまるごとに1ステップ
    let wheelAcc = 0;
    $('.stepper').addEventListener('wheel', e => {
      e.preventDefault();
      const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1);
      wheelAcc = Math.abs(d) >= 50 ? d : wheelAcc + d; // マウスの1ノッチは即1ステップ
      if (Math.abs(wheelAcc) >= 50) {
        stepValue(wheelAcc < 0 ? 1 : -1);
        wheelAcc = 0;
      }
    }, { passive: false });

    $('#loadout-btn').addEventListener('click', openPicker);
    $('#picker-close').addEventListener('click', closePicker);
    $('#picker-done').addEventListener('click', closePicker);
    $('#picker').addEventListener('cancel', e => { e.preventDefault(); closePicker(); });
    $('#picker-clear').addEventListener('click', () => {
      loadout.weaponId = '';
      loadout.skinId = '';
      closePicker();
    });
    $('#skin-search').addEventListener('input', renderSkinGrid);
    $('#picker').addEventListener('click', e => {
      const w = e.target.closest('[data-weapon]');
      if (w) return pickWeapon(w.dataset.weapon);
      const s = e.target.closest('[data-skin]');
      if (s) return pickSkin(s.dataset.skin);
      if (e.target === $('#picker')) closePicker(); // 背景クリックで閉じる
    });
    $('#record-form').addEventListener('submit', addRecord);
    $('#filter-range').addEventListener('change', () => { renderTrendChart(); renderDistChart(); });

    document.body.addEventListener('click', e => {
      if (e.target.closest('.js-login')) return login();
      const go = e.target.closest('[data-goto]');
      if (go) return switchTab(go.dataset.goto);
      const rankRow = e.target.closest('tr.rank-row');
      if (rankRow) return toggleRankDetail(rankRow);
      const del = e.target.closest('.del');
      if (del) {
        e.stopPropagation();
        deleteRecord(del.dataset.id);
        return;
      }
      const row = e.target.closest('tr.day-row');
      if (row) {
        const detail = document.querySelector(`tr.detail-row[data-for="${row.dataset.date}"]`);
        detail.hidden = !detail.hidden;
        row.querySelector('.toggle').textContent = detail.hidden ? '▸' : '▾';
      }
    });

    $('#goal-save').addEventListener('click', saveGoal);
    $('#export-json').addEventListener('click', exportJson);
    $('#export-csv').addEventListener('click', exportCsv);
    $('#import-json').addEventListener('change', importJson);
    $('#clear-all').addEventListener('click', clearAll);

    $('#display-name-save').addEventListener('click', saveDisplayName);
    $('#display-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveDisplayName(); });
    $('#public-toggle').addEventListener('change', savePublic);
    $('#sync-now').addEventListener('click', runSync);
    $('#logout').addEventListener('click', logout);
    $('#ranking-refresh').addEventListener('click', () => renderRanking(true));
    window.addEventListener('online', requestSync);

    // 日付が変わったときに「今日」を更新
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      $('#input-date').value = today();
      renderAll();
      requestSync(); // 別の端末で付けた記録を取り込む
    });

    applyModeUi();
    renderLoadoutButton();
    renderAccount();
    renderAll();
    cloud.onAuthChange(onAuth);
    loadCatalog()
      .then(() => { renderLoadoutButton(); renderAll(); })
      .catch(() => toast('武器データを取得できませんでした'));
    let saved = null;
    try { saved = sessionStorage.getItem('bot100log:tab'); } catch { /* ignore */ }
    if (saved && document.getElementById(`tab-${saved}`) && !$(`.tab[data-tab="${saved}"]`)?.hidden) switchTab(saved);
  }

  init();
})();
