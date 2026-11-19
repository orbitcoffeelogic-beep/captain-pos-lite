/* CAPTAIN COFFEE — OWNER DASHBOARD & AUDIT ENGINE (v1.0-owner) */
'use strict';

const OWNER_VERSION = 'v1.0-owner';
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzLa2QzC2FMgCYWOeroreDWTaXFY8UR9dTikqaohMEFKD8KZMfjiFhNy_ywnxZaV_A6/exec';

let SCRIPT_URL = localStorage.getItem('CAPTAIN_GAS_URL') || DEFAULT_SCRIPT_URL;
let currentTab = 'overview';
let lastDataVersion = 0;
let lastServerApiVersion = '-';
let lastSyncText = '-';
let isFetching = false;
let pollTimerId = null;

const ownerState = {
  orders: [],
  pengeluaran: [],
  kasbon: [],
  arsip: [],
  settlements: [],
  menu: [],
  auditLog: [],
  lastSettlementMs: 0,
  archiveLoaded: false
};

// Filtered views cache for CSV export
let lastFilteredSales = [];
let lastFilteredExpenses = [];

// ============================================================================
// UTILITIES
// ============================================================================
function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatRupiah(n) {
  return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}
function pad2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function parseTsMs(tsStr, fallbackMs) {
  if (fallbackMs && Number(fallbackMs) > 0) return Number(fallbackMs);
  const s = String(tsStr || '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}
function opDayKeyFromMs(ms) {
  const d = new Date((Number(ms) || Date.now()) - 5 * 3600000);
  return localDateStr(d);
}
function isExpenseDrawer(sumber) {
  const s = String(sumber || 'Kas Tunai').toLowerCase();
  if (s.includes('non') || s.includes('rekening') || s.includes('transfer') || s.includes('qris')) return false;
  return true;
}
function isNonCashMethod(method) {
  const m = String(method || '').trim().toUpperCase();
  return m === 'QRIS' || m === 'TRANSFER' || m.includes('NON');
}
function showToast(msg, tone = 'info') {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast ' + tone;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
function setSyncStatus(text, color = '#94a3b8') {
  const el = document.getElementById('ownerSyncStatus');
  if (el) { el.textContent = text; el.style.color = color; }
}

// ============================================================================
// DATA NORMALIZATION
// ============================================================================
function mapServerOrder(o, sourceTag = 'SHEETS') {
  const rawNote = (o.catatan && o.catatan !== '-') ? String(o.catatan) : '';
  const isTabTag = rawNote.includes('[OPEN TAB]');
  const cleanNote = rawNote.replace('[OPEN TAB]', '').trim();
  let items = Array.isArray(o.items) && o.items.length ? o.items.map(it => ({
    id: it.id || '',
    name: String(it.name || 'Menu').trim(),
    qty: Math.max(1, Number(it.qty) || 1),
    price: Number(it.price) || 0,
    note: [it.options, it.note].filter(Boolean).join(' • ') || cleanNote
  })) : [];

  if (!items.length && typeof o.rincian === 'string' && o.rincian.trim() && o.rincian.trim() !== '-') {
    items = o.rincian.split(',').map(p => {
      const t = p.trim();
      const m = t.match(/^(\d+)x\s+(.+)$/i);
      return {
        name: m ? m[2].trim() : t,
        qty: m ? Math.max(1, parseInt(m[1], 10)) : 1,
        price: 0,
        note: cleanNote
      };
    });
  }

  let st = String(o.status || 'MENUNGGU KONFIRMASI').trim().toUpperCase();
  if (st === 'MENUNGGU') st = 'MENUNGGU KONFIRMASI';
  const rawPay = String(o.metodeBayar || 'TUNAI').trim().toUpperCase();
  let method = 'Tunai';
  if (rawPay === 'QRIS') method = 'QRIS';
  else if (rawPay === 'TRANSFER') method = 'Transfer';
  else if (rawPay === 'KASBON') method = 'Kasbon';
  else if (isTabTag || rawPay === 'OPEN TAB') method = 'Open Tab';

  let paySt = 'LUNAS';
  if (method === 'Open Tab') paySt = 'OPEN TAB';
  if (method === 'Kasbon') paySt = 'KASBON';
  if (st === 'MENUNGGU KONFIRMASI') paySt = 'BELUM LUNAS';
  if (st === 'BATAL' || st === 'KADALUARSA') paySt = 'BATAL';

  const createdAtMs = parseTsMs(o.timestamp, o.createdAtMs);
  const settledAtMs = Number(o.settledAtMs) || 0;

  return {
    orderId: String(o.orderId || '').trim(),
    timestamp: o.timestamp || '-',
    createdAtMs,
    settledAtMs,
    location: o.meja || '-',
    customerName: o.nama || 'Pelanggan',
    rincian: o.rincian || items.map(it => `${it.qty}x ${it.name}`).join(', ') || '-',
    catatan: cleanNote,
    items,
    totalPrice: Number(o.total) || 0,
    paymentMethod: method,
    paymentStatus: paySt,
    status: st,
    source: sourceTag
  };
}

function getShiftCutoffMs() {
  const now = new Date();
  const op = new Date(now);
  if (now.getHours() < 5) op.setDate(op.getDate() - 1);
  op.setHours(5, 0, 0, 0);
  return Math.max(op.getTime(), Number(ownerState.lastSettlementMs) || 0);
}

function computeActiveShiftMetrics() {
  const cut = getShiftCutoffMs();
  let cashSales = 0, nonCashSales = 0;

  const arsipInShift = ownerState.arsip.filter(a => (Number(a.tglLunasMs) || parseTsMs(a.tglLunas, 0)) >= cut);
  const arsipBaseIds = new Set();
  arsipInShift.forEach(a => {
    const id = String(a.orderId || '').trim();
    arsipBaseIds.add(id.replace(/-C[A-Z0-9]+$/i, ''));
    const amt = Number(a.total) || 0;
    if (isNonCashMethod(a.metodePelunasan)) nonCashSales += amt;
    else cashSales += amt;
  });

  ownerState.orders.forEach(o => {
    if (!o || o.status === 'BATAL' || o.status === 'KADALUARSA') return;
    if (o.paymentStatus !== 'LUNAS') return;
    if (arsipBaseIds.has(o.orderId)) return; // anti-double-count pelunasan/cicilan
    const effectiveMs = o.settledAtMs >= cut ? o.settledAtMs : o.createdAtMs;
    if (effectiveMs < cut) return;
    if (isNonCashMethod(o.paymentMethod)) nonCashSales += o.totalPrice;
    else cashSales += o.totalPrice;
  });

  return { cutoff: cut, cashSales, nonCashSales, totalRevenue: cashSales + nonCashSales };
}

// ============================================================================
// CLOUD FETCH (FULL + sinceVer FAST POLL)
// ============================================================================
async function fetchCloud(isFull = false, showNotify = false) {
  if (isFetching || !SCRIPT_URL || SCRIPT_URL.includes('TEMPEL_URL')) return;
  if (!navigator.onLine) {
    setSyncStatus('Offline', '#f59e0b');
    return;
  }
  isFetching = true;
  if (showNotify) setSyncStatus('Menyinkronkan...', '#38bdf8');
  try {
    const sep = SCRIPT_URL.includes('?') ? '&' : '?';
    let url = isFull
      ? `${SCRIPT_URL}${sep}full=1&t=${Date.now()}`
      : `${SCRIPT_URL}${sep}fast=1&t=${Date.now()}`;
    if (!isFull && lastDataVersion > 0) url += `&sinceVer=${lastDataVersion}`;

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), isFull ? 25000 : 14000);
    const res = await fetch(url, { redirect: 'follow', cache: 'no-cache', signal: ctrl.signal });
    clearTimeout(tid);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'Gagal memuat data');

    if (data.version) lastServerApiVersion = String(data.version);
    if (Number(data.dataVersion) > 0) lastDataVersion = Number(data.dataVersion);

    // Ultra-fast unchanged response (server tidak perlu buka Spreadsheet!)
    if (data.unchanged === true) {
      const nowStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setSyncStatus(`v${lastServerApiVersion} • Ver ${lastDataVersion} • ${nowStr}`, '#34d399');
      updateConfigDiag();
      return;
    }

    if (Number(data.lastSettlementMs) > 0) ownerState.lastSettlementMs = Number(data.lastSettlementMs);
    if (Array.isArray(data.menu) && data.menu.length) ownerState.menu = data.menu;

    if (Array.isArray(data.orders)) {
      const map = new Map();
      // Pertahankan data arsip yang sudah dimuat secara manual
      ownerState.orders.forEach(o => { if (o.source === 'ARCHIVE') map.set(o.orderId, o); });
      data.orders.forEach(so => {
        const mapped = mapServerOrder(so, 'SHEETS');
        if (mapped.orderId) map.set(mapped.orderId, mapped);
      });
      ownerState.orders = Array.from(map.values()).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    }

    if (Array.isArray(data.pengeluaran)) {
      const emap = new Map();
      ownerState.pengeluaran.forEach(e => { if (e.source === 'ARCHIVE') emap.set(e.id, e); });
      data.pengeluaran.forEach(e => { if (e && e.id) emap.set(e.id, Object.assign({ source: 'SHEETS' }, e)); });
      ownerState.pengeluaran = Array.from(emap.values()).sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));
    }

    if (Array.isArray(data.kasbon)) ownerState.kasbon = data.kasbon;
    if (Array.isArray(data.arsip)) ownerState.arsip = data.arsip;
    if (Array.isArray(data.settlements)) ownerState.settlements = data.settlements;

    lastSyncText = data.lastSync || new Date().toLocaleTimeString('id-ID');
    setSyncStatus(`v${lastServerApiVersion} • Ver ${lastDataVersion || '-'} • ${lastSyncText}`, '#34d399');

    renderCurrentTab();
    updateConfigDiag();
    if (showNotify) showToast(`✓ Data diperbarui (${ownerState.orders.length} order, ${ownerState.pengeluaran.length} pengeluaran)`, 'ok');
  } catch (err) {
    setSyncStatus('Gagal Sync', '#fb7185');
    if (showNotify) showToast('⚠️ Gagal tarik data: ' + (err.message || err), 'err');
  } finally {
    isFetching = false;
  }
}

function refreshAll(showNotify = false) {
  lastDataVersion = 0; // paksa ambil data lengkap
  fetchCloud(true, showNotify);
}

async function loadArchive(btn) {
  if (!SCRIPT_URL || SCRIPT_URL.includes('TEMPEL_URL')) return;
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Memuat Arsip...'; }
  try {
    const sep = SCRIPT_URL.includes('?') ? '&' : '?';
    const res = await fetch(`${SCRIPT_URL}${sep}action=GET_ARCHIVE_HISTORY&t=${Date.now()}`, { redirect: 'follow', cache: 'no-cache' });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'Gagal memuat arsip');

    let addedOrders = 0, addedExp = 0;
    const oMap = new Map(ownerState.orders.map(o => [o.orderId, o]));
    (data.orders || []).forEach(so => {
      const id = String(so.orderId || '').trim();
      if (id && !oMap.has(id)) {
        oMap.set(id, mapServerOrder(so, 'ARCHIVE'));
        addedOrders++;
      }
    });
    ownerState.orders = Array.from(oMap.values()).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

    const eMap = new Map(ownerState.pengeluaran.map(e => [e.id, e]));
    (data.pengeluaran || []).forEach(se => {
      if (se && se.id && !eMap.has(se.id)) {
        eMap.set(se.id, Object.assign({ source: 'ARCHIVE' }, se));
        addedExp++;
      }
    });
    ownerState.pengeluaran = Array.from(eMap.values()).sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));

    if (Array.isArray(data.arsip) && data.arsip.length) {
      const aMap = new Map(ownerState.arsip.map(a => [a.orderId, a]));
      data.arsip.forEach(a => { if (a && a.orderId && !aMap.has(a.orderId)) aMap.set(a.orderId, a); });
      ownerState.arsip = Array.from(aMap.values());
    }

    ownerState.archiveLoaded = true;
    renderCurrentTab();
    updateConfigDiag();
    if (btn) btn.textContent = '✓ Arsip Termuat';
    showToast(`📦 Arsip dimuat: +${addedOrders} pesanan, +${addedExp} pengeluaran`, 'ok');
  } catch (err) {
    if (btn) btn.textContent = origText || '📦 Muat Arsip (>35h)';
    showToast('⚠️ Gagal memuat arsip: ' + (err.message || err), 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// NAVIGATION
// ============================================================================
function switchTab(tab) {
  currentTab = tab;
  const tabs = ['overview', 'sales', 'expenses', 'kasbon', 'settlement', 'audit', 'config'];
  tabs.forEach(t => {
    const sec = document.getElementById('tab-' + t);
    if (sec) sec.classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderCurrentTab();
}

function renderCurrentTab() {
  if (currentTab === 'overview') renderOverview();
  else if (currentTab === 'sales') renderSales();
  else if (currentTab === 'expenses') renderExpenses();
  else if (currentTab === 'kasbon') renderKasbon();
  else if (currentTab === 'settlement') renderSettlement();
  else if (currentTab === 'config') updateConfigDiag();
}

// ============================================================================
// TAB 1: OVERVIEW & 30-DAY ANALYTICS
// ============================================================================
function renderOverview() {
  // 1. Shift Aktif
  const shift = computeActiveShiftMetrics();
  setText('ovShiftRev', formatRupiah(shift.totalRevenue));
  setText('ovShiftSplit', `Tunai ${formatRupiah(shift.cashSales)} • Non-Tunai ${formatRupiah(shift.nonCashSales)}`);

  // 2. 30-Day Window (berbasis hari operasional 05:00 WIB)
  const dayKeys = [];
  const dayRevenue = new Map();
  const nowOpBase = new Date(Date.now() - 5 * 3600000);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(nowOpBase);
    d.setDate(d.getDate() - i);
    const k = localDateStr(d);
    dayKeys.push(k);
    dayRevenue.set(k, 0);
  }
  const dayKeySet = new Set(dayKeys);
  const cut30Ms = Date.now() - 30 * 86400000;

  let rev30 = 0, count30 = 0, exp30 = 0;
  let openTabSum = 0, kasbonSum = 0;

  // Hitung Open Tab aktif & penjualan 30 hari
  const activeKasbonBaseIds = new Set();
  ownerState.orders.forEach(o => {
    if (!o || o.status === 'BATAL' || o.status === 'KADALUARSA') return;
    if (o.paymentStatus === 'OPEN TAB' || o.paymentStatus === 'BELUM LUNAS') {
      openTabSum += o.totalPrice;
    }
    if (o.paymentStatus === 'KASBON') {
      activeKasbonBaseIds.add(o.orderId);
      return;
    }
    if (o.paymentStatus === 'LUNAS') {
      const effMs = o.settledAtMs > 0 ? o.settledAtMs : o.createdAtMs;
      const dKey = opDayKeyFromMs(effMs);
      if (dayKeySet.has(dKey)) {
        rev30 += o.totalPrice;
        count30++;
        dayRevenue.set(dKey, (dayRevenue.get(dKey) || 0) + o.totalPrice);
      }
    }
  });

  // Tambahkan cicilan kasbon 30 hari yang induknya masih KASBON (belum lunas penuh)
  ownerState.arsip.forEach(a => {
    const baseId = String(a.orderId || '').replace(/-C[A-Z0-9]+$/i, '');
    if (!activeKasbonBaseIds.has(baseId)) return;
    const ms = Number(a.tglLunasMs) || parseTsMs(a.tglLunas, 0);
    const dKey = opDayKeyFromMs(ms);
    if (dayKeySet.has(dKey)) {
      const amt = Number(a.total) || 0;
      rev30 += amt;
      dayRevenue.set(dKey, (dayRevenue.get(dKey) || 0) + amt);
    }
  });

  // Pengeluaran 30 hari
  ownerState.pengeluaran.forEach(e => {
    const ms = parseTsMs(e.timestamp, e.createdAtMs);
    if (ms >= cut30Ms) exp30 += Number(e.nominal) || 0;
  });

  // Piutang kasbon aktif
  ownerState.kasbon.forEach(k => { kasbonSum += Number(k.total) || 0; });

  setText('ov30Rev', formatRupiah(rev30));
  setText('ov30Count', `${count30} transaksi lunas`);
  setText('ov30Exp', formatRupiah(exp30));
  setText('ov30Net', `Net: ${formatRupiah(rev30 - exp30)}`);
  setText('ovUnpaid', formatRupiah(openTabSum + kasbonSum));
  setText('ovUnpaidSub', `Tab ${formatRupiah(openTabSum)} • Kasbon ${formatRupiah(kasbonSum)}`);

  // 3. Trend Delta (15 hari terakhir vs 15 hari sebelumnya)
  const prev15 = dayKeys.slice(0, 15).reduce((s, k) => s + (dayRevenue.get(k) || 0), 0);
  const last15 = dayKeys.slice(15).reduce((s, k) => s + (dayRevenue.get(k) || 0), 0);
  const deltaEl = document.getElementById('ovTrendDelta');
  if (deltaEl) {
    if (prev15 > 0) {
      const pct = ((last15 - prev15) / prev15) * 100;
      deltaEl.textContent = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% (15h vs 15h lalu)`;
      deltaEl.className = 'badge mono ' + (pct >= 0 ? 'b-green' : 'b-rose');
    } else {
      deltaEl.textContent = `Total 30h: ${formatRupiah(rev30)}`;
      deltaEl.className = 'badge mono b-slate';
    }
  }

  renderTrendChart(dayKeys, dayRevenue);
  renderMenuRankings(dayKeySet);
}

function renderTrendChart(dayKeys, dayRevenue) {
  const host = document.getElementById('trendChartHost');
  if (!host) return;
  const vals = dayKeys.map(k => dayRevenue.get(k) || 0);
  const maxVal = Math.max(...vals, 10000);

  const w = 780, h = 190, padL = 12, padR = 12, padT = 22, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const step = innerW / dayKeys.length;
  const barW = Math.max(8, step - 5);

  const bars = dayKeys.map((k, idx) => {
    const v = vals[idx];
    const bh = Math.max(2, Math.round((v / maxVal) * innerH));
    const x = padL + idx * step + (step - barW) / 2;
    const y = padT + innerH - bh;
    const isLast = idx === dayKeys.length - 1;
    const fill = isLast ? '#059669' : (v > 0 ? '#2563eb' : '#e2e8f0');
    const lbl = k.slice(8, 10) + '/' + k.slice(5, 7);
    const showLbl = idx === 0 || idx === dayKeys.length - 1 || idx % 5 === 0;
    return `
      <g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh}" rx="3" fill="${fill}">
          <title>${k}: ${formatRupiah(v)}</title>
        </rect>
        ${showLbl ? `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#64748b">${lbl}</text>` : ''}
      </g>`;
  }).join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="min-width:540px;display:block">
      <line x1="${padL}" y1="${padT + innerH}" x2="${w - padR}" y2="${padT + innerH}" stroke="#cbd5e1" stroke-width="1" />
      <text x="${padL}" y="13" font-size="10" fill="#64748b">Puncak harian: ${formatRupiah(maxVal)}</text>
      ${bars}
    </svg>`;
}

function renderMenuRankings(dayKeySet) {
  const counts = new Map();
  // Seed semua menu aktif dari katalog agar menu 0 penjualan ikut terdeteksi di "Jarang Keluar"
  ownerState.menu.forEach(m => {
    if (m && m.name && m.is_available !== false) {
      const key = String(m.name).trim().toLowerCase();
      counts.set(key, { name: String(m.name).trim(), qty: 0, rev: 0 });
    }
  });

  ownerState.orders.forEach(o => {
    if (!o || o.status === 'BATAL' || o.status === 'KADALUARSA') return;
    if (!dayKeySet.has(opDayKeyFromMs(o.createdAtMs))) return;
    (o.items || []).forEach(it => {
      const baseName = String(it.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!baseName) return;
      const key = baseName.toLowerCase();
      const cur = counts.get(key) || { name: baseName, qty: 0, rev: 0 };
      cur.qty += Math.max(1, Number(it.qty) || 1);
      cur.rev += (Number(it.price) || 0) * Math.max(1, Number(it.qty) || 1);
      counts.set(key, cur);
    });
  });

  const allItems = Array.from(counts.values());
  const topList = allItems.filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty || b.rev - a.rev).slice(0, 8);
  const slowList = allItems.slice().sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name)).slice(0, 8);

  const topEl = document.getElementById('topMenusList');
  if (topEl) {
    topEl.innerHTML = topList.length
      ? topList.map((it, i) => `<div class="rank-row"><div><strong>#${i + 1}</strong> ${escapeHtml(it.name)}</div><div class="mono"><span class="badge b-green">${it.qty}x</span></div></div>`).join('')
      : '<div class="muted text-center" style="padding:14px">Belum ada data penjualan 30 hari.</div>';
  }

  const slowEl = document.getElementById('slowMenusList');
  if (slowEl) {
    slowEl.innerHTML = slowList.length
      ? slowList.map(it => `<div class="rank-row"><div>${escapeHtml(it.name)}</div><div class="mono"><span class="badge ${it.qty === 0 ? 'b-rose' : 'b-amber'}">${it.qty}x</span></div></div>`).join('')
      : '<div class="muted text-center" style="padding:14px">Belum ada katalog menu.</div>';
  }
}

// ============================================================================
// TAB 2: PENJUALAN (FILTER + QUICK CHIPS + CSV EXPORT)
// ============================================================================
function applyQuickRange(mode, startId, endId, chipAttr) {
  document.querySelectorAll(`[data-${chipAttr}]`).forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-' + chipAttr) === mode);
  });
  const sEl = document.getElementById(startId);
  const eEl = document.getElementById(endId);
  if (!sEl || !eEl) return;

  const now = new Date();
  const today = new Date(now);
  if (now.getHours() < 5) today.setDate(today.getDate() - 1);

  if (mode === 'all') {
    sEl.value = ''; eEl.value = '';
    return;
  }
  const end = new Date(today);
  const start = new Date(today);
  if (mode === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (mode === '7days') {
    start.setDate(start.getDate() - 6);
  } else if (mode === 'thisMonth') {
    start.setDate(1);
  }
  sEl.value = localDateStr(start);
  eEl.value = localDateStr(end);
}

function setSalesQuick(mode) {
  applyQuickRange(mode, 'sStart', 'sEnd', 'sq');
  renderSales();
}

function renderSales() {
  const sDate = document.getElementById('sStart')?.value || '';
  const eDate = document.getElementById('sEnd')?.value || '';
  const stFilter = document.getElementById('sStatus')?.value || 'ALL';
  const q = (document.getElementById('sQuery')?.value || '').trim().toLowerCase();

  const list = ownerState.orders.filter(o => {
    const dKey = opDayKeyFromMs(o.createdAtMs);
    if (sDate && dKey < sDate) return false;
    if (eDate && dKey > eDate) return false;
    if (stFilter !== 'ALL') {
      if (stFilter === 'BATAL') {
        if (o.status !== 'BATAL' && o.status !== 'KADALUARSA') return false;
      } else if (o.paymentStatus !== stFilter) return false;
    }
    if (q) {
      const hay = `${o.orderId} ${o.customerName} ${o.location} ${o.rincian} ${o.paymentMethod}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  lastFilteredSales = list;

  let sumAll = 0, sumCash = 0, sumNonCash = 0;
  list.forEach(o => {
    if (o.status === 'BATAL' || o.status === 'KADALUARSA') return;
    if (o.paymentStatus !== 'LUNAS') return;
    sumAll += o.totalPrice;
    if (isNonCashMethod(o.paymentMethod)) sumNonCash += o.totalPrice;
    else sumCash += o.totalPrice;
  });

  setText('sSumAll', formatRupiah(sumAll));
  setText('sSumCash', formatRupiah(sumCash));
  setText('sSumNonCash', formatRupiah(sumNonCash));

  const tbody = document.getElementById('salesTbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center muted">Tidak ada transaksi sesuai filter.</td></tr>';
    return;
  }

  tbody.innerHTML = list.slice(0, 500).map(o => {
    const badgeCls = o.paymentStatus === 'LUNAS' ? 'b-green'
      : (o.paymentStatus === 'BATAL' ? 'b-rose'
      : (o.paymentStatus === 'KASBON' ? 'b-amber' : 'b-slate'));
    return `
      <tr>
        <td class="mono">${escapeHtml(o.timestamp)}</td>
        <td class="mono">${escapeHtml(o.orderId)}</td>
        <td>${escapeHtml(o.location)}</td>
        <td>${escapeHtml(o.customerName)}</td>
        <td>${escapeHtml(o.rincian)}</td>
        <td>${escapeHtml(o.paymentMethod)}</td>
        <td><span class="badge ${badgeCls}">${escapeHtml(o.paymentStatus)}</span></td>
        <td class="text-right mono"><strong>${formatRupiah(o.totalPrice)}</strong></td>
      </tr>`;
  }).join('');
}

// ============================================================================
// TAB 3: PENGELUARAN
// ============================================================================
function setExpQuick(mode) {
  applyQuickRange(mode, 'eStart', 'eEnd', 'eq');
  renderExpenses();
}

function renderExpenses() {
  const sDate = document.getElementById('eStart')?.value || '';
  const eDate = document.getElementById('eEnd')?.value || '';
  const cat = document.getElementById('eCat')?.value || 'ALL';
  const q = (document.getElementById('eQuery')?.value || '').trim().toLowerCase();

  const list = ownerState.pengeluaran.filter(e => {
    const ms = parseTsMs(e.timestamp, e.createdAtMs);
    const dKey = opDayKeyFromMs(ms);
    if (sDate && dKey < sDate) return false;
    if (eDate && dKey > eDate) return false;
    if (cat !== 'ALL' && String(e.kategori || '') !== cat) return false;
    if (q) {
      const hay = `${e.keterangan} ${e.kategori} ${e.staff} ${e.sumberDana} ${e.catatan}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  lastFilteredExpenses = list;

  let sumAll = 0, sumCash = 0, sumNonCash = 0;
  list.forEach(e => {
    const amt = Number(e.nominal) || 0;
    sumAll += amt;
    if (isExpenseDrawer(e.sumberDana)) sumCash += amt;
    else sumNonCash += amt;
  });

  setText('eSumAll', formatRupiah(sumAll));
  setText('eSumCash', formatRupiah(sumCash));
  setText('eSumNonCash', formatRupiah(sumNonCash));

  const tbody = document.getElementById('expTbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center muted">Tidak ada pengeluaran sesuai filter.</td></tr>';
    return;
  }

  tbody.innerHTML = list.slice(0, 500).map(e => {
    const drawer = isExpenseDrawer(e.sumberDana);
    return `
      <tr>
        <td class="mono">${escapeHtml(e.timestamp || '-')}</td>
        <td><span class="badge ${e.kategori === 'Operasional' ? 'b-amber' : 'b-slate'}">${escapeHtml(e.kategori || '-')}</span></td>
        <td>${escapeHtml(e.keterangan || '-')}${e.catatan && e.catatan !== '-' ? `<div class="muted" style="font-size:11px">${escapeHtml(e.catatan)}</div>` : ''}</td>
        <td><span class="badge ${drawer ? 'b-rose' : 'b-green'}">${escapeHtml(e.sumberDana || 'Kas Tunai')}</span></td>
        <td>${escapeHtml(e.staff || '-')}</td>
        <td class="text-right mono"><strong>${formatRupiah(e.nominal)}</strong></td>
      </tr>`;
  }).join('');
}

// ============================================================================
// TAB 4: KASBON (AKTIF & ARSIP)
// ============================================================================
function renderKasbon() {
  const activeSum = ownerState.kasbon.reduce((s, k) => s + (Number(k.total) || 0), 0);
  setText('kbActiveSum', formatRupiah(activeSum));

  const actBody = document.getElementById('kbActiveTbody');
  if (actBody) {
    actBody.innerHTML = ownerState.kasbon.length
      ? ownerState.kasbon.map(k => `
          <tr>
            <td class="mono">${escapeHtml(k.tanggal || '-')}</td>
            <td><strong>${escapeHtml(k.nama || '-')}</strong><div class="muted mono" style="font-size:10px">${escapeHtml(k.orderId || '')}</div></td>
            <td>${escapeHtml(k.rincian || '-')}</td>
            <td class="text-right mono" style="color:var(--rose)"><strong>${formatRupiah(k.total)}</strong></td>
          </tr>`).join('')
      : '<tr><td colspan="4" class="text-center muted">Tidak ada piutang aktif.</td></tr>';
  }

  const arsBody = document.getElementById('kbArsipTbody');
  if (arsBody) {
    const sorted = ownerState.arsip.slice().sort((a, b) => (Number(b.tglLunasMs) || 0) - (Number(a.tglLunasMs) || 0));
    arsBody.innerHTML = sorted.length
      ? sorted.slice(0, 200).map(a => `
          <tr>
            <td class="mono">${escapeHtml(a.tglLunas || '-')}</td>
            <td><strong>${escapeHtml(a.nama || '-')}</strong><div class="muted" style="font-size:10px">${escapeHtml(a.statusBayar || 'LUNAS')}</div></td>
            <td><span class="badge b-green">${escapeHtml(a.metodePelunasan || '-')}</span></td>
            <td class="text-right mono"><strong>${formatRupiah(a.total)}</strong></td>
          </tr>`).join('')
      : '<tr><td colspan="4" class="text-center muted">Belum ada riwayat pelunasan.</td></tr>';
  }
}

// ============================================================================
// TAB 5: SETTLEMENT SHIFT
// ============================================================================
function renderSettlement() {
  const tbody = document.getElementById('settleTbody');
  if (!tbody) return;
  if (!ownerState.settlements.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center muted">Belum ada data settlement shift.</td></tr>';
    return;
  }
  tbody.innerHTML = ownerState.settlements.map(s => {
    const diff = Number(s.diff) || 0;
    const diffCls = diff === 0 ? 'b-green' : (diff < 0 ? 'b-rose' : 'b-amber');
    const diffSign = diff > 0 ? '+' : '';
    return `
      <tr>
        <td class="mono">${escapeHtml(s.shiftDateStr || s.timestamp || '-')}</td>
        <td><strong>${escapeHtml(s.staffName || '-')}</strong></td>
        <td class="text-right mono">${formatRupiah(s.totalRevenue)}</td>
        <td class="text-right mono">${formatRupiah(s.cashSales)}</td>
        <td class="text-right mono">${formatRupiah(s.qrisSales)}</td>
        <td class="text-right mono">${formatRupiah(s.cashExpense)}</td>
        <td class="text-right mono">${formatRupiah(s.targetCash)}</td>
        <td class="text-right mono"><strong>${formatRupiah(s.actualCash)}</strong></td>
        <td class="text-right mono"><span class="badge ${diffCls}">${diffSign}${formatRupiah(diff)}</span></td>
        <td>${escapeHtml(s.note || '-')}</td>
      </tr>`;
  }).join('');
}

// ============================================================================
// TAB 6: AUDIT LOG (PIN SUPERVISOR)
// ============================================================================
async function loadAuditData() {
  const pin = (document.getElementById('auditPin')?.value || '').trim();
  const includeArchive = !!document.getElementById('auditIncludeArchive')?.checked;
  if (!pin) {
    showToast('Masukkan PIN Supervisor terlebih dahulu.', 'err');
    return;
  }
  const tbody = document.getElementById('auditTbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center muted">⏳ Memverifikasi PIN & memuat Audit Log...</td></tr>';

  try {
    const sep = SCRIPT_URL.includes('?') ? '&' : '?';
    const url = `${SCRIPT_URL}${sep}action=AUDIT_DATA&staff_pin=${encodeURIComponent(pin)}&includeArchive=${includeArchive ? '1' : '0'}&limit=500&t=${Date.now()}`;
    const res = await fetch(url, { redirect: 'follow', cache: 'no-cache' });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'PIN ditolak atau gagal memuat audit');

    ownerState.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
    if (Array.isArray(data.settlements)) ownerState.settlements = data.settlements;
    if (includeArchive && Array.isArray(data.orders)) {
      ownerState.orders = data.orders.map(o => mapServerOrder(o, 'SHEETS')).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      ownerState.archiveLoaded = true;
    }

    renderAuditTable();
    showToast(`🔓 Audit Log dimuat (${ownerState.auditLog.length} entri) — Auditor: ${data.auditor || 'Supervisor'}`, 'ok');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--rose)">❌ ${escapeHtml(err.message || err)}</td></tr>`;
    showToast('❌ ' + (err.message || err), 'err');
  }
}

function renderAuditTable() {
  const tbody = document.getElementById('auditTbody');
  if (!tbody) return;
  if (!ownerState.auditLog.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center muted">Tidak ada catatan audit.</td></tr>';
    return;
  }
  tbody.innerHTML = ownerState.auditLog.map(a => {
    const act = String(a.action || '-').toUpperCase();
    const badgeCls = act.includes('VOID') || act.includes('HAPUS') ? 'b-rose'
      : (act.includes('SETTLEMENT') ? 'b-green'
      : (act.includes('PENGELUARAN') ? 'b-amber' : 'b-slate'));
    const nomText = act === 'KOSONGKAN_MEJA' ? '-' : formatRupiah(a.total);
    return `
      <tr>
        <td class="mono">${escapeHtml(a.dateStr || a.timestamp || '-')}</td>
        <td><strong>${escapeHtml(a.actor || '-')}</strong></td>
        <td><span class="badge ${badgeCls}">${escapeHtml(act)}</span></td>
        <td class="mono">${escapeHtml(a.orderId || '-')}</td>
        <td>${escapeHtml(a.reason || '-')}</td>
        <td class="text-right mono">${nomText}</td>
        <td>${escapeHtml(a.detail || '-')}</td>
      </tr>`;
  }).join('');
}

// ============================================================================
// CSV EXPORTERS
// ============================================================================
function downloadCsv(filename, headers, rows) {
  const esc = v => {
    const s = String(v === null || v === undefined ? '' : v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lines = [headers.map(esc).join(',')].concat(rows.map(r => r.map(esc).join(',')));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSalesCsv() {
  if (!lastFilteredSales.length) { showToast('Tidak ada data penjualan untuk diekspor.', 'err'); return; }
  const headers = ['Waktu', 'Order ID', 'Meja', 'Pelanggan', 'Rincian', 'Metode Bayar', 'Status Bayar', 'Status Order', 'Total'];
  const rows = lastFilteredSales.map(o => [o.timestamp, o.orderId, o.location, o.customerName, o.rincian, o.paymentMethod, o.paymentStatus, o.status, o.totalPrice]);
  downloadCsv(`captain_penjualan_${localDateStr(new Date())}.csv`, headers, rows);
  showToast(`✓ ${rows.length} baris penjualan diekspor ke CSV`, 'ok');
}

function exportExpensesCsv() {
  if (!lastFilteredExpenses.length) { showToast('Tidak ada data pengeluaran untuk diekspor.', 'err'); return; }
  const headers = ['ID', 'Waktu', 'Kategori', 'Keperluan', 'Sumber Dana', 'Petugas', 'Catatan', 'Nominal'];
  const rows = lastFilteredExpenses.map(e => [e.id, e.timestamp, e.kategori, e.keterangan, e.sumberDana, e.staff, e.catatan, Number(e.nominal) || 0]);
  downloadCsv(`captain_pengeluaran_${localDateStr(new Date())}.csv`, headers, rows);
  showToast(`✓ ${rows.length} baris pengeluaran diekspor ke CSV`, 'ok');
}

function exportSettlementCsv() {
  if (!ownerState.settlements.length) { showToast('Belum ada data settlement untuk diekspor.', 'err'); return; }
  const headers = ['ID Settlement', 'Waktu', 'Petugas', 'Omzet', 'Tunai', 'Non-Tunai', 'Keluar Laci', 'Keluar Non-Tunai', 'Kasbon Shift', 'Target Kas', 'Fisik Kas', 'Selisih', 'Catatan'];
  const rows = ownerState.settlements.map(s => [
    s.settlementId, s.shiftDateStr || s.timestamp, s.staffName, s.totalRevenue,
    s.cashSales, s.qrisSales, s.cashExpense, s.qrisExpense, s.shiftKasbon,
    s.targetCash, s.actualCash, s.diff, s.note || '-'
  ]);
  downloadCsv(`captain_settlement_${localDateStr(new Date())}.csv`, headers, rows);
  showToast(`✓ ${rows.length} baris settlement diekspor ke CSV`, 'ok');
}

// ============================================================================
// TAB 7: CONFIG & DIAGNOSTICS
// ============================================================================
function updateConfigDiag() {
  const input = document.getElementById('cfgGasUrl');
  if (input && document.activeElement !== input) input.value = SCRIPT_URL;
  const diag = document.getElementById('cfgDiag');
  if (diag) {
    diag.textContent = `App ${OWNER_VERSION} | API v${lastServerApiVersion} | DataVer ${lastDataVersion || '-'} | Order: ${ownerState.orders.length} | Pengeluaran: ${ownerState.pengeluaran.length} | Kasbon: ${ownerState.kasbon.length} | Arsip: ${ownerState.archiveLoaded ? 'Termuat' : '35h aktif'} | Sync: ${lastSyncText}`;
  }
}

function saveOwnerConfig() {
  const url = (document.getElementById('cfgGasUrl')?.value || '').trim();
  if (!url || !url.startsWith('https://')) {
    showToast('URL Web App harus diawali https://', 'err');
    return;
  }
  SCRIPT_URL = url;
  localStorage.setItem('CAPTAIN_GAS_URL', url);
  lastDataVersion = 0;
  showToast('✓ URL disimpan, memuat ulang data...', 'ok');
  fetchCloud(true, true);
}

function resetOwnerUrl() {
  SCRIPT_URL = DEFAULT_SCRIPT_URL;
  localStorage.removeItem('CAPTAIN_GAS_URL');
  const input = document.getElementById('cfgGasUrl');
  if (input) input.value = DEFAULT_SCRIPT_URL;
  lastDataVersion = 0;
  showToast('✓ URL dikembalikan ke default.', 'ok');
  fetchCloud(true, true);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ============================================================================
// BOOTSTRAP
// ============================================================================
function startPolling() {
  if (pollTimerId) clearInterval(pollTimerId);
  pollTimerId = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      fetchCloud(false, false);
    }
  }, 15000);
}

document.addEventListener('DOMContentLoaded', () => {
  applyQuickRange('today', 'sStart', 'sEnd', 'sq');
  applyQuickRange('today', 'eStart', 'eEnd', 'eq');
  updateConfigDiag();
  fetchCloud(true, false);
  startPolling();

  window.addEventListener('online', () => {
    setSyncStatus('Online — Menyinkronkan...', '#38bdf8');
    fetchCloud(false, false);
  });
  window.addEventListener('offline', () => setSyncStatus('Offline', '#f59e0b'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) fetchCloud(false, false);
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
