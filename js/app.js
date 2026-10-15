(() => {
  'use strict';

  const STORAGE_KEY = 'bot100log:v1';

  // better: 'low' = 小さいほど良い（タイム）, 'high' = 大きいほど良い（撃破数）
  const MODES = {
    b100_static: { label: '100体 移動なし', unit: '秒', better: 'low', initial: 60, hint: '100体倒すまでのタイム' },
    b100_strafe: { label: '100体 移動あり', unit: '秒', better: 'low', initial: 70, hint: '100体倒すまでのタイム' },
    k30_easy: { label: '30秒 Easy', unit: '体', better: 'high', initial: 25, hint: '30秒間の撃破数' },
    k30_medium: { label: '30秒 Medium', unit: '体', better: 'high', initial: 20, hint: '30秒間の撃破数' },
    k30_hard: { label: '30秒 Hard', unit: '体', better: 'high', initial: 15, hint: '30秒間の撃破数' },
  };

  // ---------- State ----------
  let state = load();
  let trendChart = null;
  let distChart = null;

  function defaultState() {
    return {
      version: 2,
      records: [],
      settings: { mode: 'b100_static', goals: {}, lastWeaponId: '', lastSkinId: '' },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalize(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast('保存に失敗しました（ストレージ容量またはプライベートモード）');
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
      }))
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value));
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

  function updateDial() {
    const v = parseInt($('#input-value').value, 10);
    $('#dial-ticks').style.transform = `rotate(${-(Number.isFinite(v) ? v : 0) * 6}deg)`;
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
    });
    save();

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
    save();
    renderAll();
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
    download(`bot100log-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
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
      const added = incoming.records.filter(r => !ids.has(r.id));
      state.records.push(...added);
      state.settings.goals = { ...incoming.settings.goals, ...state.settings.goals };
      save();
      applyModeUi();
      renderAll();
      toast(`${added.length} 件を追加しました`);
    });
  }

  function clearAll() {
    if (!state.records.length) return;
    if (!confirm('全モードの記録を削除します。元に戻せません。\n（事前に JSON 書き出しを推奨）')) return;
    if (!confirm('本当に削除しますか？')) return;
    state = defaultState();
    save();
    applyModeUi();
    renderAll();
    toast('全データを削除しました');
  }

  // ---------- Wiring ----------
  let activeTab = 'record';

  function switchTab(name) {
    activeTab = name;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    try { sessionStorage.setItem('bot100log:tab', name); } catch { /* ignore */ }
    if (name === 'stats') renderStats(); // canvas は表示状態で描画する必要がある
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
    $('#input-value').addEventListener('input', updateDial);
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

    // 日付が変わったときに「今日」を更新
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      $('#input-date').value = today();
      renderAll();
    });

    applyModeUi();
    renderLoadoutButton();
    renderAll();
    loadCatalog()
      .then(() => { renderLoadoutButton(); renderAll(); })
      .catch(() => toast('武器データを取得できませんでした'));
    let saved = null;
    try { saved = sessionStorage.getItem('bot100log:tab'); } catch { /* ignore */ }
    if (saved && document.getElementById(`tab-${saved}`)) switchTab(saved);
  }

  init();
})();
