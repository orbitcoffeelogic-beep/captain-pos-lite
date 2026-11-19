/* CAPTAIN POS LITE (v1.0-lite) — Ultra-Fast Cashier, Radar & KDS Engine for Older Android Tablets */
'use strict';

const APP_VERSION = 'v1.0-lite';
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzLa2QzC2FMgCYWOeroreDWTaXFY8UR9dTikqaohMEFKD8KZMfjiFhNy_ywnxZaV_A6/exec';
const STORAGE_KEY = 'CAPTAIN_COFFEE_OPS_STATE_V1';

let SCRIPT_URL = localStorage.getItem('CAPTAIN_GAS_URL') || DEFAULT_SCRIPT_URL;
let POLL_INTERVAL_SEC = Number(localStorage.getItem('CAPTAIN_POLL_SEC')) || 5;
let lastServerApiVersion = '-';
let lastDataVersion = 0;
let currentView = 'kasir';
let kdsFilter = 'ALL';
let isFetching = false;
let pollTimerId = null;
let saveDebounceTimer = null;
let memoIndex = 0;

const DEFAULT_KRU = [
  { id: 'CRW-001', nama: 'Supervisor / Owner', peran: 'Supervisor', pin: '8899', status: 'AKTIF' },
  { id: 'CRW-002', nama: 'Dimas', peran: 'Kasir', pin: '1234', status: 'AKTIF' },
  { id: 'CRW-003', nama: 'Aga', peran: 'Barista', pin: '5678', status: 'AKTIF' }
];

const DEFAULT_TABLES = [
  { name: 'Meja 01', zone: '🛋️ Zona Indoor & Main Hall', zoneDesc: 'Area ber-AC dekat bar utama & kasir', type: 'MEJA' },
  { name: 'Meja 02', zone: '🛋️ Zona Indoor & Main Hall', zoneDesc: 'Area ber-AC dekat bar utama & kasir', type: 'MEJA' },
  { name: 'Meja 03', zone: '🛋️ Zona Indoor & Main Hall', zoneDesc: 'Area ber-AC dekat bar utama & kasir', type: 'MEJA' },
  { name: 'Meja 04', zone: '🛋️ Zona Indoor & Main Hall', zoneDesc: 'Area ber-AC dekat bar utama & kasir', type: 'MEJA' },
  { name: 'Meja 05', zone: '🛋️ Zona Indoor & Main Hall', zoneDesc: 'Area ber-AC dekat bar utama & kasir', type: 'MEJA' },
  { name: 'Meja 06', zone: '🛋️ Zona Indoor & Main Hall', zoneDesc: 'Area ber-AC dekat bar utama & kasir', type: 'MEJA' },
  { name: 'Meja 07', zone: '🌿 Zona Outdoor, Chill & Bar', zoneDesc: 'Area terbuka, bar & takeaway', type: 'MEJA' },
  { name: 'Meja 08', zone: '🌿 Zona Outdoor, Chill & Bar', zoneDesc: 'Area terbuka, bar & takeaway', type: 'MEJA' },
  { name: 'Meja 09', zone: '🌿 Zona Outdoor, Chill & Bar', zoneDesc: 'Area terbuka, bar & takeaway', type: 'MEJA' },
  { name: 'Meja 10', zone: '🌿 Zona Outdoor, Chill & Bar', zoneDesc: 'Area terbuka, bar & takeaway', type: 'MEJA' },
  { name: 'Meja 11', zone: '🌿 Zona Outdoor, Chill & Bar', zoneDesc: 'Area terbuka, bar & takeaway', type: 'MEJA' },
  { name: 'Area Bar', zone: '🌿 Zona Outdoor, Chill & Bar', zoneDesc: 'Area terbuka, bar & takeaway', type: 'BAR' },
  { name: 'Takeaway', zone: '🌿 Zona Outdoor, Chill & Bar', zoneDesc: 'Area terbuka, bar & takeaway', type: 'TAKEAWAY' }
];

let MENU_CATALOG = safeJson(localStorage.getItem('CAPTAIN_CACHED_MENU'), []);
let TABLE_CONFIG = safeJson(localStorage.getItem('CAPTAIN_CACHED_TABLES'), DEFAULT_TABLES);
if (!Array.isArray(TABLE_CONFIG) || TABLE_CONFIG.length === 0) TABLE_CONFIG = DEFAULT_TABLES.slice();

let appState = loadInitialState();

function safeJson(str, fallback) {
  try { const v = JSON.parse(str); return v !== null && v !== undefined ? v : fallback; } catch (_) { return fallback; }
}
function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function formatRupiah(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
function pad2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function nowTimestampStr() {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function parseTsMs(tsStr, fallbackMs) {
  if (fallbackMs && Number(fallbackMs) > 0) return Number(fallbackMs);
  const s = String(tsStr || '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}
function elapsedMins(ms) { return Math.max(0, Math.floor((Date.now() - (Number(ms) || Date.now())) / 60000)); }
function formatDwell(mins) { return mins >= 60 ? `${Math.floor(mins / 60)}j ${mins % 60}m` : `${mins}m`; }
function genOrderId(loc) {
  const d = new Date();
  const tPart = String(loc || '01').replace(/[^0-9]/g, '').slice(0, 2).padStart(2, '0') || '01';
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CAP-${String(d.getFullYear()).slice(-2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-${tPart}${rand}`;
}
function isTakeawayLoc(loc) {
  const s = String(loc || '').trim();
  const found = TABLE_CONFIG.find(t => t.name === s);
  return found ? found.type === 'TAKEAWAY' : s.toLowerCase() === 'takeaway';
}
function isPhysicalTable(loc) {
  const s = String(loc || '').trim();
  const found = TABLE_CONFIG.find(t => t.name === s);
  return found ? found.type === 'MEJA' : s.startsWith('Meja ');
}
function isExpenseDrawer(sumber) {
  const s = String(sumber || 'Kas Tunai').toLowerCase();
  if (s.includes('non') || s.includes('rekening') || s.includes('transfer') || s.includes('qris')) return false;
  return true;
}

function showToast(msg, tone = 'info') {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast ' + tone;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

function loadInitialState() {
  const parsed = safeJson(localStorage.getItem(STORAGE_KEY), {});
  const kru = safeJson(localStorage.getItem('CAPTAIN_CACHED_KRU'), DEFAULT_KRU);
  let active = safeJson(localStorage.getItem('CAPTAIN_ACTIVE_CREW'), null);
  if (!active) active = (Array.isArray(kru) && kru.find(k => String(k.peran || '').toLowerCase().includes('kasir'))) || DEFAULT_KRU[1];
  return {
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    piutangAktif: Array.isArray(parsed.piutangAktif) ? parsed.piutangAktif : [],
    piutangArsip: Array.isArray(parsed.piutangArsip) ? parsed.piutangArsip : [],
    pengeluaran: Array.isArray(parsed.pengeluaran) ? parsed.pengeluaran : [],
    pengumumanList: safeJson(localStorage.getItem('CAPTAIN_CACHED_PENGUMUMAN'), []),
    kruList: Array.isArray(kru) && kru.length ? kru : DEFAULT_KRU.slice(),
    activeCrew: active,
    clearedTables: parsed.clearedTables || {}
  };
}

// Debounced saveState so main thread never stutters on older tablets
function saveState(immediate = false) {
  const exec = () => {
    const nonArchOrders = (appState.orders || []).filter(o => o && o.source !== 'ARCHIVE');
    if (PosIDB.db && nonArchOrders.length) PosIDB.putBulk('orders', nonArchOrders);
    try {
      const cut35 = Date.now() - 35 * 86400000;
      const trimO = nonArchOrders.length > 150
        ? nonArchOrders.filter(o => o.syncStatus === 'pending' || (o.status !== 'SELESAI' && o.status !== 'BATAL' && o.status !== 'KADALUARSA') || o.paymentStatus === 'OPEN TAB' || o.paymentStatus === 'KASBON' || parseTsMs(o.timestamp, o.createdAtMs) >= cut35)
        : nonArchOrders;
      const nonArchExp = (appState.pengeluaran || []).filter(e => e && e.source !== 'ARCHIVE');
      const trimE = nonArchExp.length > 100 ? nonArchExp.filter(e => e.syncStatus === 'pending' || (Number(e.createdAtMs) || 0) >= cut35) : nonArchExp;
      const rawA = appState.piutangArsip || [];
      const trimA = rawA.length > 100 ? rawA.filter(a => (Number(a.settledAtMs) || 0) >= cut35) : rawA;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        orders: trimO, piutangAktif: appState.piutangAktif, piutangArsip: trimA,
        pengeluaran: trimE, clearedTables: appState.clearedTables, activeCrew: appState.activeCrew
      }));
    } catch (_) {}
  };
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  if (immediate) { exec(); return; }
  saveDebounceTimer = setTimeout(exec, 450);
}

// ============================================================================
// 1. INDEXEDDB & SYNC QUEUE (BATCH_SYNC + Coalescing + Non-Blocking)
// ============================================================================
const PosIDB = {
  db: null,
  init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open('captain_pos_db', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('orders')) db.createObjectStore('orders', { keyPath: 'orderId' });
        if (!db.objectStoreNames.contains('outbox')) {
          const ob = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
          ob.createIndex('status', 'status', { unique: false });
          ob.createIndex('orderId', 'orderId', { unique: false });
        }
        if (!db.objectStoreNames.contains('menu')) db.createObjectStore('menu', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('piutang_aktif')) db.createObjectStore('piutang_aktif', { keyPath: 'order_id' });
        if (!db.objectStoreNames.contains('piutang_arsip')) db.createObjectStore('piutang_arsip', { keyPath: 'order_id' });
        if (!db.objectStoreNames.contains('app_meta')) db.createObjectStore('app_meta', { keyPath: 'key' });
      };
      req.onsuccess = (e) => { PosIDB.db = e.target.result; resolve(PosIDB.db); };
      req.onerror = () => resolve(null);
    });
  },
  getAll(store) {
    if (!PosIDB.db) return Promise.resolve([]);
    return new Promise((resolve) => {
      try {
        const r = PosIDB.db.transaction(store, 'readonly').objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      } catch (_) { resolve([]); }
    });
  },
  put(store, val) {
    if (!PosIDB.db) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const r = PosIDB.db.transaction(store, 'readwrite').objectStore(store).put(val);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  },
  putBulk(store, list) {
    if (!PosIDB.db || !Array.isArray(list)) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const tx = PosIDB.db.transaction(store, 'readwrite');
        const st = tx.objectStore(store);
        list.forEach(it => st.put(it));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  },
  delete(store, key) {
    if (!PosIDB.db) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const r = PosIDB.db.transaction(store, 'readwrite').objectStore(store).delete(key);
        r.onsuccess = () => resolve(true);
        r.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  },
  clear(store) {
    if (!PosIDB.db) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const r = PosIDB.db.transaction(store, 'readwrite').objectStore(store).clear();
        r.onsuccess = () => resolve(true);
        r.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }
};

async function postGasDirect(payload, timeoutMs = 20000) {
  if (!SCRIPT_URL || SCRIPT_URL.includes('TEMPEL_URL')) return null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const tid = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const body = Object.assign({ requestId: `r-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` }, payload);
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) return { status: 'error', transient: res.status === 429 || res.status >= 500, message: `HTTP ${res.status}` };
    const data = await res.json().catch(() => null);
    if (!data) return { status: 'error', transient: true, message: 'Respons bukan JSON valid' };
    if (Number(data.dataVersion) > lastDataVersion) lastDataVersion = Number(data.dataVersion);
    return data;
  } catch (err) {
    if (err && err.name === 'AbortError') return { status: 'network_error', transient: true, message: `Timeout (${Math.round(timeoutMs / 1000)}d)` };
    return null;
  } finally {
    if (tid) clearTimeout(tid);
  }
}

const SyncQueue = {
  isFlushing: false,
  _activePromise: null,
  _batchUnsupported: false,
  outboxCache: [],
  BATCH_SIZE: 5,
  MAX_ATTEMPTS: 8,
  PIN_ACTIONS: ['CREATE_ORDER', 'UPDATE_STATUS', 'TOGGLE_ITEM_STATUS', 'UPDATE_PAYMENT_METHOD', 'SETTLE_KASBON', 'PARTIAL_SETTLE_KASBON', 'ADD_EXPENSE', 'SETTLEMENT_SHIFT', 'CLEAR_TABLE'],

  backoffMs(att) { return Math.min(5000 * Math.pow(2, Math.max(0, att - 1)), 300000); },
  _attachAuth(item, overwritePin = false) {
    if (!item || !item.payload) return;
    const act = String(item.action || '').toUpperCase();
    if (act === 'UPDATE_STATUS') item.payload.staleSafe = true;
    const crew = appState.activeCrew || DEFAULT_KRU[1];
    item.payload.staff = item.payload.staff || crew.nama;
    item.payload.actor = item.payload.actor || crew.nama;
    if (SyncQueue.PIN_ACTIONS.includes(act)) {
      if (crew.pin && (overwritePin || !item.payload.staff_pin)) item.payload.staff_pin = crew.pin;
    }
  },
  async getPending() {
    const all = await PosIDB.getAll('outbox');
    return all.filter(it => it.status === 'pending' || it.status === 'failed' || (it.status === 'syncing' && !SyncQueue.isFlushing));
  },
  async getRetryable() {
    return (await SyncQueue.getPending()).filter(it => !it.permanent).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },
  async resetRetry(refreshPin = false) {
    const all = await PosIDB.getAll('outbox');
    for (const it of all) {
      if (it.status === 'failed' || it.status === 'syncing' || it.permanent || it.nextRetryAt) {
        it.permanent = false; it.nextRetryAt = 0; it.attempts = 0; it.status = 'pending';
        SyncQueue._attachAuth(it, refreshPin && /pin/i.test(String(it.lastError || '')));
        await PosIDB.put('outbox', it);
      }
    }
  },
  async enqueue(payload) {
    const act = String(payload.action || '').toUpperCase();
    const orderId = payload.orderId || payload.order_id || '';
    const itemPayload = Object.assign({}, payload);
    const crew = appState.activeCrew || DEFAULT_KRU[1];
    itemPayload.staff = itemPayload.staff || crew.nama;
    itemPayload.actor = itemPayload.actor || crew.nama;
    itemPayload.staff_pin = itemPayload.staff_pin || crew.pin;
    if (act === 'UPDATE_STATUS') itemPayload.staleSafe = true;

    let merged = false;
    if (act === 'UPDATE_STATUS' && orderId) {
      const same = (await PosIDB.getAll('outbox'))
        .filter(x => x.orderId === orderId && x.status === 'pending' && !x.permanent)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const top = same[0];
      if (top && String(top.action).toUpperCase() === 'UPDATE_STATUS') {
        top.payload = Object.assign({}, top.payload, itemPayload, { staleSafe: true });
        top.lastError = null;
        await PosIDB.put('outbox', top);
        merged = true;
      } else if (top && String(top.action).toUpperCase() === 'CREATE_ORDER') {
        if (itemPayload.newStatus) top.payload.status = itemPayload.newStatus;
        if (itemPayload.items_json !== undefined) top.payload.items_json = itemPayload.items_json;
        if (itemPayload.metodeBayar) top.payload.metodeBayar = itemPayload.metodeBayar;
        if (itemPayload.settledAtMs) top.payload.settledAtMs = itemPayload.settledAtMs;
        await PosIDB.put('outbox', top);
        merged = true;
      }
    }
    if (!merged) {
      await PosIDB.put('outbox', { action: act, payload: itemPayload, orderId, status: 'pending', attempts: 0, createdAt: Date.now(), lastError: null });
    }
    await SyncQueue.updateBadge();
    if (navigator.onLine) SyncQueue.flush();
  },
  async _onSuccess(item) {
    await PosIDB.delete('outbox', item.id);
    if (item.orderId) {
      const ord = appState.orders.find(o => o.orderId === item.orderId);
      if (ord) { ord.syncStatus = 'synced'; await PosIDB.put('orders', ord); }
    }
    const act = String(item.action || '').toUpperCase();
    if (act === 'ADD_EXPENSE') {
      const ex = appState.pengeluaran.find(x => x.id === item.payload?.id);
      if (ex) ex.syncStatus = 'synced';
    }
  },
  async _onFailure(item, res, fallback = '') {
    if (res && (res.status === 'wrong_pin' || res.status === 'error' || res.status === 'not_found')) {
      const msg = String(res.message || '');
      const transient = Boolean(res.transient) || /lock|timeout|too many|server error|service invoked|sibuk|http 5|http 429/i.test(msg);
      item.status = 'failed'; item.attempts = (item.attempts || 0) + 1;
      item.lastError = msg || (res.status === 'not_found' ? 'Data tidak ditemukan' : (res.status === 'wrong_pin' ? 'PIN ditolak' : 'Ditolak server'));
      if (transient && item.attempts < SyncQueue.MAX_ATTEMPTS) {
        item.nextRetryAt = Date.now() + SyncQueue.backoffMs(item.attempts);
        await PosIDB.put('outbox', item);
        return { transient: true, netDown: false };
      }
      item.permanent = true;
      await PosIDB.put('outbox', item);
      return { transient: false, netDown: false };
    }
    item.status = 'failed'; item.attempts = (item.attempts || 0) + 1;
    item.lastError = (res && res.message) || fallback || 'Jaringan tidak merespons';
    item.nextRetryAt = Date.now() + SyncQueue.backoffMs(item.attempts);
    await PosIDB.put('outbox', item);
    return { transient: true, netDown: true };
  },
  async flush(opts = {}) {
    if (!navigator.onLine) { await SyncQueue.updateBadge(); return; }
    while (SyncQueue.isFlushing) {
      if (!opts.force) return;
      if (SyncQueue._activePromise) { try { await SyncQueue._activePromise; } catch (_) {} } else break;
    }
    if (opts.force) await SyncQueue.resetRetry(true);
    SyncQueue._activePromise = SyncQueue._run(opts);
    try { await SyncQueue._activePromise; } finally { SyncQueue._activePromise = null; }
  },
  async _run(opts = {}) {
    SyncQueue.isFlushing = true;
    await SyncQueue.updateBadge(true);
    try {
      for (let pass = 0; pass < 100; pass++) {
        if (!navigator.onLine) break;
        const pending = await SyncQueue.getRetryable();
        if (!pending.length) break;

        const nowMs = Date.now();
        const blockedIds = new Set();
        const runnable = [];
        for (const it of pending) {
          if (!opts.force && it.nextRetryAt && it.nextRetryAt > nowMs) { if (it.orderId) blockedIds.add(it.orderId); continue; }
          if (it.orderId && blockedIds.has(it.orderId)) continue;
          runnable.push(it);
        }
        if (!runnable.length) break;
        runnable.forEach(it => SyncQueue._attachAuth(it, false));

        if (!SyncQueue._batchUnsupported && runnable.length > 1) {
          const batch = runnable.slice(0, SyncQueue.BATCH_SIZE);
          for (const b of batch) { b.status = 'syncing'; await PosIDB.put('outbox', b); }
          const res = await postGasDirect({ action: 'BATCH_SYNC', items: batch.map(b => ({ queueId: b.id, payload: b.payload })) }, 40000);
          if (res && res.status === 'error' && /batch_sync|tidak dikenali/i.test(String(res.message || ''))) {
            SyncQueue._batchUnsupported = true;
            for (const b of batch) { b.status = 'pending'; await PosIDB.put('outbox', b); }
          } else if (res && res.status === 'success' && Array.isArray(res.results)) {
            const map = new Map(batch.map(b => [String(b.id), b]));
            for (const r of res.results) {
              const target = map.get(String(r.queueId));
              if (!target) continue;
              map.delete(String(r.queueId));
              if (r.status === 'success' || r.duplicate) await SyncQueue._onSuccess(target);
              else await SyncQueue._onFailure(target, r);
            }
            for (const left of map.values()) { left.status = 'pending'; await PosIDB.put('outbox', left); }
            await SyncQueue.updateBadge(true);
            continue;
          } else {
            await SyncQueue._onFailure(batch[0], res);
            for (let k = 1; k < batch.length; k++) { batch[k].status = 'pending'; await PosIDB.put('outbox', batch[k]); }
            break;
          }
        }

        let netStop = false;
        const localBlocked = new Set();
        for (const it of runnable) {
          if (!navigator.onLine) { netStop = true; break; }
          if (it.orderId && localBlocked.has(it.orderId)) continue;
          it.status = 'syncing'; await PosIDB.put('outbox', it);
          const res = await postGasDirect(it.payload, 20000);
          if (res && (res.status === 'success' || res.duplicate)) await SyncQueue._onSuccess(it);
          else {
            const fi = await SyncQueue._onFailure(it, res);
            if (fi.netDown) { netStop = true; break; }
            if (fi.transient && it.orderId) localBlocked.add(it.orderId);
          }
        }
        if (netStop || SyncQueue._batchUnsupported || runnable.length <= 1) break;
      }
    } finally {
      SyncQueue.isFlushing = false;
      saveState();
      await SyncQueue.updateBadge();
      renderAllActive();
    }
  },
  async clearFailed() {
    const all = await PosIDB.getAll('outbox');
    const failed = all.filter(x => x.status === 'failed');
    for (const f of failed) await PosIDB.delete('outbox', f.id);
    await SyncQueue.updateBadge();
    await openOutboxModal();
    showToast(`${failed.length} antrean gagal dihapus.`, 'ok');
  },
  async discard(id) {
    if (!confirm('Hapus item ini dari antrean lokal?')) return;
    await PosIDB.delete('outbox', id);
    await SyncQueue.updateBadge();
    await openOutboxModal();
  },
  async updateBadge(syncing = false) {
    const pending = await SyncQueue.getPending();
    SyncQueue.outboxCache = pending;
    const pill = document.getElementById('btnSyncPill');
    const txt = document.getElementById('syncPillText');
    if (!pill || !txt) return;
    if (!navigator.onLine) { pill.className = 'pill-btn warn'; txt.textContent = pending.length ? `Offline (${pending.length})` : 'Offline'; return; }
    if (syncing || SyncQueue.isFlushing) { pill.className = 'pill-btn info'; txt.textContent = `Sync (${pending.length})...`; return; }
    if (pending.length > 0) {
      const hasFail = pending.some(p => p.status === 'failed');
      pill.className = hasFail ? 'pill-btn err' : 'pill-btn warn';
      txt.textContent = hasFail ? `Tertunda (${pending.length})` : `Antre (${pending.length})`;
      return;
    }
    pill.className = 'pill-btn ok';
    txt.textContent = 'Online';
  }
};

// ============================================================================
// 2. DATA FETCH WITH sinceVer SHORT-CIRCUIT & FINGERPRINT ANTI-IDB-CHURN
// ============================================================================
function mapServerOrder(o, sourceTag = 'SHEETS') {
  const rawNote = (o.catatan && o.catatan !== '-') ? String(o.catatan) : '';
  const isTabTag = rawNote.includes('[OPEN TAB]');
  const cleanNote = rawNote.replace('[OPEN TAB]', '').trim();
  let items = Array.isArray(o.items) && o.items.length ? o.items.map(it => ({
    id: it.id || '', name: String(it.name || 'Menu'), qty: Math.max(1, Number(it.qty) || 1),
    price: Number(it.price) || 0, note: [it.options, it.note].filter(Boolean).join(' • ') || cleanNote,
    done: !!it.done || o.status === 'SIAP SAJI' || o.status === 'SELESAI'
  })) : [];
  if (!items.length && typeof o.rincian === 'string' && o.rincian.trim()) {
    items = o.rincian.split(',').map(p => {
      const t = p.trim();
      const m = t.match(/^(\d+)x\s+(.+)$/i);
      const qty = m ? parseInt(m[1], 10) : 1;
      const nm = m ? m[2].trim() : t;
      const base = nm.replace(/\s*\(.*\)$/, '').trim().toLowerCase();
      const found = MENU_CATALOG.find(x => String(x.name).toLowerCase() === base);
      return { name: nm, qty, price: found ? Number(found.price) : 0, note: cleanNote, done: o.status === 'SIAP SAJI' || o.status === 'SELESAI' };
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

  return {
    orderId: String(o.orderId || '').trim(),
    timestamp: o.timestamp || nowTimestampStr(),
    createdAtMs: parseTsMs(o.timestamp, o.createdAtMs) || Date.now(),
    location: o.meja || 'Meja 01',
    customerName: o.nama || 'Pelanggan',
    items: items.length ? items : [{ name: o.rincian || 'Menu', qty: 1, price: Number(o.total) || 0, note: cleanNote, done: false }],
    totalPrice: Number(o.total) || 0,
    paymentMethod: method,
    selectedAuth: method,
    paymentStatus: paySt,
    status: st,
    settledAtMs: Number(o.settledAtMs) || 0,
    syncStatus: 'synced',
    round: 1,
    source: sourceTag
  };
}

let lastOrdersFp = '';
let lastKasbonFp = '';
let lastFullFetchMs = 0;

function ordersFp(list) {
  let s = list.length + '|';
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const doneC = Array.isArray(o.items) ? o.items.reduce((a, it) => a + (it.done ? 1 : 0), 0) : 0;
    s += `${o.orderId}:${o.status}:${o.paymentStatus}:${o.paymentMethod}:${o.settledAtMs || 0}:${o.isTableCleared ? 1 : 0}:${o.syncStatus}:${doneC};`;
  }
  return s;
}

async function fetchFromServer(showNotify = false, forceFull = false) {
  if (!SCRIPT_URL || SCRIPT_URL.includes('TEMPEL_URL') || isFetching || !navigator.onLine) return;
  isFetching = true;
  try {
    const now = Date.now();
    const needFull = forceFull || !MENU_CATALOG.length || (now - lastFullFetchMs) > 60000;
    if (needFull) lastFullFetchMs = now;
    const sep = SCRIPT_URL.includes('?') ? '&' : '?';
    let url = needFull
      ? `${SCRIPT_URL}${sep}full=1&t=${now}`
      : `${SCRIPT_URL}${sep}fast=1${lastDataVersion > 0 ? '&sinceVer=' + lastDataVersion : ''}`;

    const res = await fetch(url, { redirect: 'follow', cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'Gagal');
    if (data.version) lastServerApiVersion = String(data.version);
    if (Number(data.dataVersion) > 0) lastDataVersion = Number(data.dataVersion);

    // ULTRA-FAST SHORT-CIRCUIT: nol kerja CPU / nol tulis IndexedDB / nol render!
    if (data.unchanged === true) {
      if (showNotify) showToast('✓ Data sudah paling baru.', 'ok');
      return;
    }

    let changed = Boolean(forceFull || showNotify);
    if (Number(data.lastSettlementMs) > 0) {
      const curCut = Number(localStorage.getItem('CAPTAIN_SHIFT_CUTOFF_MS')) || 0;
      if (Number(data.lastSettlementMs) > curCut) {
        ShiftEngine.setCutoff(Number(data.lastSettlementMs));
        changed = true;
      }
    }
    if (Array.isArray(data.menu) && data.menu.length) {
      MENU_CATALOG = data.menu.filter(m => m.is_available !== false);
      try { localStorage.setItem('CAPTAIN_CACHED_MENU', JSON.stringify(MENU_CATALOG)); } catch (_) {}
      PosIDB.putBulk('menu', MENU_CATALOG);
      changed = true;
    }
    if (Array.isArray(data.tables) && data.tables.length) {
      const nextT = data.tables.filter(t => t && t.name).map(t => ({
        name: String(t.name).trim(), zone: String(t.zone || 'Area Utama').trim(),
        zoneDesc: String(t.zoneDesc || '').trim(), type: String(t.type || 'MEJA').trim().toUpperCase()
      }));
      if (nextT.length && JSON.stringify(nextT) !== JSON.stringify(TABLE_CONFIG)) {
        TABLE_CONFIG = nextT;
        try { localStorage.setItem('CAPTAIN_CACHED_TABLES', JSON.stringify(TABLE_CONFIG)); } catch (_) {}
        changed = true;
      }
    }
    if (data.clearedTables && typeof data.clearedTables === 'object') {
      appState.clearedTables = appState.clearedTables || {};
      Object.keys(data.clearedTables).forEach(k => {
        const ms = Number(data.clearedTables[k]) || 0;
        if (ms > (Number(appState.clearedTables[k]) || 0)) { appState.clearedTables[k] = ms; changed = true; }
      });
    }
    if (Array.isArray(data.orders)) {
      const localMap = new Map(appState.orders.map(o => [o.orderId, o]));
      const nextMap = new Map();
      const srvOrders = data.orders.map(o => mapServerOrder(o, 'SHEETS'));
      const newWeb = srvOrders.filter(so => !localMap.has(so.orderId) && so.status === 'MENUNGGU KONFIRMASI');
      srvOrders.forEach(so => {
        const prev = localMap.get(so.orderId);
        if (prev) {
          so.settledAtMs = Number(so.settledAtMs) || Number(prev.settledAtMs) || 0;
          if (prev.isTableCleared) { so.isTableCleared = true; so.tableClearedAtMs = prev.tableClearedAtMs; }
          if (so.status === 'MENUNGGU KONFIRMASI' && prev.selectedAuth) so.selectedAuth = prev.selectedAuth;
        }
        const cMs = Number(appState.clearedTables[so.location]) || 0;
        if (cMs > 0 && so.createdAtMs <= cMs && so.status === 'SELESAI' && so.paymentStatus !== 'OPEN TAB' && so.paymentStatus !== 'BELUM LUNAS') {
          so.isTableCleared = true; so.tableClearedAtMs = cMs;
        }
        nextMap.set(so.orderId, so);
      });
      const nowM = Date.now();
      appState.orders.forEach(lo => {
        const recent = lo.lastModifiedAtMs && (nowM - lo.lastModifiedAtMs) < 10000;
        if (lo.syncStatus === 'pending' || recent || (lo.source === 'ARCHIVE' && !nextMap.has(lo.orderId))) nextMap.set(lo.orderId, lo);
      });
      appState.orders = Array.from(nextMap.values());
      const nonArch = appState.orders.filter(o => o.source !== 'ARCHIVE');
      const fp = ordersFp(nonArch);
      if (fp !== lastOrdersFp) {
        lastOrdersFp = fp; changed = true;
        if (PosIDB.db) { await PosIDB.clear('orders'); await PosIDB.putBulk('orders', nonArch); }
      }
      if (newWeb.length) showToast(`🔔 ${newWeb.length} Pesanan Web baru masuk!`, 'warn');
    }
    if (Array.isArray(data.kasbon)) {
      const settledIds = new Set(appState.piutangArsip.map(a => a.order_id));
      const km = new Map();
      data.kasbon.forEach(k => {
        const oid = String(k.orderId || '').trim();
        if (!settledIds.has(oid)) km.set(oid, {
          order_id: oid, tanggal: k.tanggal || '-', nama_pelanggan: k.nama || '-', rincian_pesanan: k.rincian || '-',
          total_tagihan: Number(k.total) || 0, jatuh_tempo: k.jatuhTempo || '-', status_bayar: k.statusBayar || 'BELUM LUNAS',
          tgl_lunas: k.tglLunas || '-', metode_pelunasan: k.metodePelunasan || 'QRIS'
        });
      });
      appState.piutangAktif.forEach(lp => { if (lp.syncStatus === 'pending' && !settledIds.has(lp.order_id)) km.set(lp.order_id, lp); });
      appState.piutangAktif = Array.from(km.values());
      const kfp = appState.piutangAktif.map(x => `${x.order_id}:${x.total_tagihan}`).join(';');
      if (kfp !== lastKasbonFp) {
        lastKasbonFp = kfp; changed = true;
        if (PosIDB.db) { await PosIDB.clear('piutang_aktif'); await PosIDB.putBulk('piutang_aktif', appState.piutangAktif); }
      }
    }
    if (Array.isArray(data.arsip)) {
      const prevA = new Map(appState.piutangArsip.map(a => [a.order_id, a]));
      const am = new Map();
      data.arsip.forEach(a => {
        const oid = String(a.orderId || '').trim();
        am.set(oid, {
          order_id: oid, tanggal: a.tanggal || '-', nama_pelanggan: a.nama || '-', rincian_pesanan: a.rincian || '-',
          total_tagihan: Number(a.total) || 0, jatuh_tempo: a.jatuhTempo || '-', status_bayar: a.statusBayar || 'LUNAS',
          tgl_lunas: a.tglLunas || '-', metode_pelunasan: a.metodePelunasan || '-', settledAtMs: Number(a.tglLunasMs) || prevA.get(oid)?.settledAtMs || 0
        });
      });
      appState.piutangArsip.forEach(la => { if (!am.has(la.order_id)) am.set(la.order_id, la); });
      if (am.size !== appState.piutangArsip.length) changed = true;
      appState.piutangArsip = Array.from(am.values());
    }
    if (Array.isArray(data.pengeluaran)) {
      const delIds = new Set((await PosIDB.getAll('outbox')).filter(x => x.action === 'DELETE_EXPENSE' && x.payload?.id).map(x => x.payload.id));
      const em = new Map();
      data.pengeluaran.forEach(e => { if (!delIds.has(e.id)) em.set(e.id, e); });
      appState.pengeluaran.forEach(le => {
        const recent = le.createdAtMs && (Date.now() - le.createdAtMs) < 15000;
        if (le.syncStatus === 'pending' || recent || (le.source === 'ARCHIVE' && !em.has(le.id))) em.set(le.id, le);
      });
      if (em.size !== appState.pengeluaran.length) changed = true;
      appState.pengeluaran = Array.from(em.values());
    }
    if (Array.isArray(data.pengumuman)) {
      appState.pengumumanList = data.pengumuman;
      try { localStorage.setItem('CAPTAIN_CACHED_PENGUMUMAN', JSON.stringify(data.pengumuman)); } catch (_) {}
      renderMemoBar();
    }
    if (Array.isArray(data.kru) && data.kru.length) {
      appState.kruList = data.kru;
      try { localStorage.setItem('CAPTAIN_CACHED_KRU', JSON.stringify(data.kru)); } catch (_) {}
      const m = data.kru.find(k => k.id === appState.activeCrew?.id);
      if (m) { appState.activeCrew = m; localStorage.setItem('CAPTAIN_ACTIVE_CREW', JSON.stringify(m)); }
      updateCrewUI();
    }
    if (Array.isArray(data.settlements)) {
      const locList = safeJson(localStorage.getItem('CAPTAIN_SETTLEMENT_HISTORY'), []);
      const sm = new Map();
      data.settlements.forEach(s => { if (s && s.settlementId) sm.set(s.settlementId, s); });
      locList.forEach(ls => { if (ls && ls.settlementId && !sm.has(ls.settlementId) && (Date.now() - (Date.parse(ls.timestamp || '') || 0)) < 120000) sm.set(ls.settlementId, ls); });
      const mergedS = Array.from(sm.values()).sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0)).slice(0, 50);
      try { localStorage.setItem('CAPTAIN_SETTLEMENT_HISTORY', JSON.stringify(mergedS)); } catch (_) {}
    }

    if (changed) { saveState(); renderAllActive(); }
    SyncQueue.updateBadge();
    if (showNotify) showToast(`✓ Sinkronisasi berhasil (${MENU_CATALOG.length} menu aktif)`, 'ok');
  } catch (err) {
    lastFullFetchMs = 0;
    if (showNotify) showToast('⚠️ Gagal tarik data: ' + (err.message || err), 'err');
  } finally {
    isFetching = false;
  }
}

async function loadArchiveFromServer(btn) {
  if (!SCRIPT_URL || SCRIPT_URL.includes('TEMPEL_URL')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Memuat...'; }
  try {
    const sep = SCRIPT_URL.includes('?') ? '&' : '?';
    const res = await fetch(`${SCRIPT_URL}${sep}action=GET_ARCHIVE_HISTORY&t=${Date.now()}`, { redirect: 'follow', cache: 'no-cache' });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'Gagal');
    let addO = 0, addE = 0;
    const oMap = new Map(appState.orders.map(o => [o.orderId, o]));
    (data.orders || []).forEach(so => { const id = String(so.orderId || '').trim(); if (id && !oMap.has(id)) { oMap.set(id, mapServerOrder(so, 'ARCHIVE')); addO++; } });
    appState.orders = Array.from(oMap.values());
    const eMap = new Map(appState.pengeluaran.map(e => [e.id, e]));
    (data.pengeluaran || []).forEach(se => { if (se.id && !eMap.has(se.id)) { eMap.set(se.id, Object.assign({ source: 'ARCHIVE' }, se)); addE++; } });
    appState.pengeluaran = Array.from(eMap.values());
    renderHistory(); renderExpenseHistory();
    if (btn) btn.textContent = '✓ Arsip Termuat';
    showToast(`Arsip dimuat: +${addO} pesanan, +${addE} pengeluaran`, 'ok');
  } catch (err) {
    showToast('Gagal muat arsip: ' + (err.message || err), 'err');
    if (btn) btn.textContent = '📦 Arsip (>35h)';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// 3. SHIFT ENGINE (05:00 WIB Cut-off + Anti-Double-Count Cicilan + Transfer)
// ============================================================================
const ShiftEngine = {
  getCutoff() {
    const stored = Number(localStorage.getItem('CAPTAIN_SHIFT_CUTOFF_MS')) || 0;
    const now = new Date();
    const op = new Date(now);
    if (now.getHours() < 5) op.setDate(op.getDate() - 1);
    op.setHours(5, 0, 0, 0);
    if (stored >= op.getTime()) return stored;
    this.setCutoff(op.getTime());
    return op.getTime();
  },
  setCutoff(ms) { localStorage.setItem('CAPTAIN_SHIFT_CUTOFF_MS', String(ms)); },
  inShift(rec) {
    const cut = this.getCutoff();
    if (rec.settledAtMs && Number(rec.settledAtMs) >= cut) return true;
    return parseTsMs(rec.timestamp, rec.createdAtMs) >= cut;
  },
  metrics() {
    const cut = this.getCutoff();
    let cashSales = 0, nonCashSales = 0, shiftKasbon = 0;
    const arsipInShift = (appState.piutangArsip || []).filter(a => (Number(a.settledAtMs) || parseTsMs(a.tgl_lunas, 0)) >= cut);
    const arsipBaseIds = new Set();
    arsipInShift.forEach(a => {
      const id = String(a.order_id || '');
      arsipBaseIds.add(id.replace(/-C[A-Z0-9]+$/i, ''));
      const amt = Number(a.total_tagihan) || 0;
      const m = String(a.metode_pelunasan || 'TUNAI').toUpperCase();
      if (m === 'QRIS' || m === 'TRANSFER') nonCashSales += amt; else cashSales += amt;
    });
    (appState.orders || []).forEach(o => {
      if (!o || o.status === 'BATAL' || o.status === 'KADALUARSA') return;
      if (o.paymentStatus === 'KASBON') {
        if (parseTsMs(o.timestamp, o.createdAtMs) >= cut) shiftKasbon += Number(o.totalPrice) || 0;
        return;
      }
      if (o.paymentStatus !== 'LUNAS') return;
      if (arsipBaseIds.has(o.orderId)) return; // sudah dihitung dari Arsip_Piutang (anti dobel cicilan)
      if (!this.inShift(o)) return;
      const amt = Number(o.totalPrice) || 0;
      const m = String(o.paymentMethod || 'Tunai').toUpperCase();
      if (m === 'QRIS' || m === 'TRANSFER') nonCashSales += amt; else cashSales += amt;
    });
    let cashExp = 0, nonCashExp = 0;
    (appState.pengeluaran || []).forEach(e => {
      if (parseTsMs(e.timestamp, e.createdAtMs) >= cut) {
        if (isExpenseDrawer(e.sumberDana)) cashExp += Number(e.nominal) || 0;
        else nonCashExp += Number(e.nominal) || 0;
      }
    });
    return {
      cutoff: cut, cashSales, nonCashSales, totalRevenue: cashSales + nonCashSales,
      cashExp, nonCashExp, totalExp: cashExp + nonCashExp, shiftKasbon,
      targetCash: cashSales - cashExp
    };
  }
};

// ============================================================================
// 4. TABLE OCCUPANCY & VIEW RENDERING (ACTIVE VIEW ONLY!)
// ============================================================================
function isOrderTableActive(o, loc) {
  if (!o || o.status === 'BATAL' || o.status === 'KADALUARSA' || o.location !== loc) return false;
  if (isTakeawayLoc(loc)) return o.status === 'MENUNGGU KONFIRMASI' || o.status === 'DIPROSES' || o.status === 'SIAP SAJI';
  if (o.status === 'MENUNGGU KONFIRMASI' || o.status === 'DIPROSES' || o.status === 'SIAP SAJI') return true;
  if (o.paymentStatus === 'OPEN TAB' || o.paymentStatus === 'BELUM LUNAS') return true;
  if (o.isTableCleared !== true) {
    const ms = Number(o.createdAtMs) || 0;
    const cMs = Number((appState.clearedTables || {})[loc]) || 0;
    if (cMs > 0 && ms > 0 && ms <= cMs) return false;
    if (ms > 0 && (Date.now() - ms) < 16 * 3600000) return true;
  }
  return false;
}

function clearTableByLocation(loc) {
  if (!loc) return;
  const nowMs = Date.now();
  appState.clearedTables = appState.clearedTables || {};
  appState.clearedTables[loc] = Math.max(Number(appState.clearedTables[loc]) || 0, nowMs);
  appState.orders.forEach(o => {
    if (o.location === loc && o.status === 'SELESAI' && o.paymentStatus !== 'OPEN TAB' && o.paymentStatus !== 'BELUM LUNAS') {
      o.isTableCleared = true; o.tableClearedAtMs = nowMs; o.lastModifiedAtMs = nowMs;
    }
  });
  saveState();
  renderAllActive();
  showToast(`✓ ${loc} dikosongkan`, 'ok');
  SyncQueue.enqueue({ action: 'CLEAR_TABLE', location: loc, clearedAtMs: nowMs });
}

function switchView(v) {
  currentView = v;
  ['kasir', 'radar', 'kds'].forEach(k => {
    document.getElementById('view' + k[0].toUpperCase() + k.slice(1)).classList.toggle('hidden', k !== v);
    document.getElementById('nav' + k[0].toUpperCase() + k.slice(1)).classList.toggle('active', k === v);
  });
  renderActiveView();
}

function renderAllActive() {
  renderKpis();
  renderActiveView();
  if (!document.getElementById('modalHistory').classList.contains('hidden')) renderHistory();
  if (!document.getElementById('modalKasbon').classList.contains('hidden')) renderKasbonModal();
  if (!document.getElementById('modalExpense').classList.contains('hidden')) renderExpenseHistory();
  if (!document.getElementById('modalTableDetail').classList.contains('hidden') && currentTableDetailLoc) renderTableDetail();
}

function renderKpis() {
  const m = ShiftEngine.metrics();
  const openTabSum = appState.orders.filter(o => o.paymentStatus === 'OPEN TAB' && o.status !== 'BATAL').reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const kasbonSum = appState.piutangAktif.reduce((s, k) => s + (Number(k.total_tagihan) || 0), 0);
  const occSet = new Set();
  appState.orders.forEach(o => { if (isPhysicalTable(o.location) && isOrderTableActive(o, o.location)) occSet.add(o.location); });
  const webCnt = appState.orders.filter(o => o.status === 'MENUNGGU KONFIRMASI').length;
  const kdsCnt = appState.orders.filter(o => o.status === 'DIPROSES' || o.status === 'SIAP SAJI').length;

  setText('kpiIncome', formatRupiah(m.totalRevenue));
  setText('kpiCash', formatRupiah(m.cashSales));
  setText('kpiNonCash', formatRupiah(m.nonCashSales));
  setText('kpiDrawer', formatRupiah(m.targetCash));
  setText('kpiOpenTab', formatRupiah(openTabSum));
  setText('kpiKasbon', formatRupiah(kasbonSum));
  setText('btnCountKasbon', String(appState.piutangAktif.length));
  setText('btnValExpense', formatRupiah(m.totalExp));
  setText('navBadgeRadar', String(occSet.size));

  const bk = document.getElementById('navBadgeKasir');
  if (bk) { bk.textContent = webCnt; bk.classList.toggle('hidden', webCnt === 0); }
  const bd = document.getElementById('navBadgeKds');
  if (bd) { bd.textContent = kdsCnt; bd.classList.toggle('hidden', kdsCnt === 0); }
}

function setText(id, val) { const el = document.getElementById(id); if (el && el.textContent !== val) el.textContent = val; }

function renderMemoBar() {
  const list = appState.pengumumanList || [];
  const bar = document.getElementById('memoBar');
  if (!bar) return;
  if (!list.length) { bar.classList.add('hidden'); return; }
  const item = list[memoIndex % list.length];
  setText('memoText', `📢 ${item.judul ? item.judul + ': ' : ''}${item.pesan || ''}`);
  bar.classList.remove('hidden');
}
function nextMemo() { memoIndex++; renderMemoBar(); }

function renderActiveView() {
  if (currentView === 'kasir') renderKanban();
  else if (currentView === 'radar') renderRadar();
  else renderKds();
}

function renderKanban() {
  const q = (document.getElementById('searchMainOrder')?.value || '').trim().toLowerCase();
  const match = (o) => !q || String(o.orderId).toLowerCase().includes(q) || String(o.customerName).toLowerCase().includes(q) || String(o.location).toLowerCase().includes(q);

  const pending = appState.orders.filter(o => o.status === 'MENUNGGU KONFIRMASI' && match(o));
  const proc = appState.orders.filter(o => o.status === 'DIPROSES' && match(o));
  const ready = appState.orders.filter(o => o.status === 'SIAP SAJI' && match(o));
  const tabs = appState.orders.filter(o => o.paymentStatus === 'OPEN TAB' && o.status !== 'BATAL' && o.status !== 'KADALUARSA' && match(o));

  setText('cntPending', String(pending.length));
  setText('cntProcess', String(proc.length));
  setText('cntReady', String(ready.length));

  document.getElementById('listPending').innerHTML = pending.length ? pending.map(o => {
    const mins = elapsedMins(o.createdAtMs);
    const auth = o.selectedAuth || 'QRIS';
    return `<div class="order-card ${mins >= 10 ? 'late' : ''}">
      <div class="order-head">
        <div><span class="badge b-blue">${escapeHtml(o.location)}</span> <span class="mono muted" style="font-size:11px">#${escapeHtml(o.orderId.slice(-8))}</span><div class="fw-800" style="margin-top:3px">${escapeHtml(o.customerName)}</div></div>
        <span class="badge ${mins >= 10 ? 'b-rose' : 'b-slate'} mono" data-elapsed-ms="${o.createdAtMs}">${mins}m</span>
      </div>
      <ul class="item-list">${(o.items || []).map(it => `<li class="item-row"><span><strong>${it.qty}x</strong> ${escapeHtml(it.name)}</span><span class="mono">${formatRupiah((it.price || 0) * it.qty)}</span></li>${it.note ? `<div class="item-note">* ${escapeHtml(it.note)}</div>` : ''}`).join('')}</ul>
      <div class="card-foot">
        <select class="select" style="min-height:30px;padding:3px 6px;font-size:11px" onchange="setWebAuth('${escapeAttr(o.orderId)}',this.value)">
          ${['Tunai', 'QRIS', 'Transfer', 'Open Tab', 'Kasbon'].map(m => `<option value="${m}" ${auth === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <strong class="mono">${formatRupiah(o.totalPrice)}</strong>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm btn-success" onclick="acceptWebOrder('${escapeAttr(o.orderId)}')">✓ Terima</button>
        <button class="btn btn-sm btn-danger-soft" onclick="rejectWebOrder('${escapeAttr(o.orderId)}')">✕ Tolak</button>
      </div>
    </div>`;
  }).join('') : `<div class="muted text-center" style="padding:18px;font-size:12px">Tidak ada antrean web</div>`;

  document.getElementById('listProcess').innerHTML = proc.length ? proc.map(o => {
    const mins = elapsedMins(o.createdAtMs);
    return `<div class="order-card ${mins >= 10 ? 'late' : ''}">
      <div class="order-head">
        <div><span class="badge b-blue">${escapeHtml(o.location)}</span> <span class="badge ${o.paymentStatus === 'LUNAS' ? 'b-green' : 'b-amber'}">${escapeHtml(o.paymentStatus)}</span><div class="fw-800" style="margin-top:3px">${escapeHtml(o.customerName)}</div></div>
        <span class="badge ${mins >= 10 ? 'b-rose' : 'b-slate'} mono" data-elapsed-ms="${o.createdAtMs}">${mins}m</span>
      </div>
      <ul class="item-list">${(o.items || []).map(it => `<li class="item-row"><span>${it.done ? '✓ ' : ''}<strong>${it.qty}x</strong> ${escapeHtml(it.name)}</span></li>`).join('')}</ul>
      <div class="card-foot"><span class="mono muted" style="font-size:11px">${escapeHtml(o.paymentMethod)}</span><strong class="mono">${formatRupiah(o.totalPrice)}</strong></div>
      <div class="card-actions">
        <button class="btn btn-sm btn-primary" onclick="setOrderStatus('${escapeAttr(o.orderId)}','SIAP SAJI')">🔔 Siap Saji</button>
        <button class="btn btn-sm" onclick="Printer.printReceipt(findOrder('${escapeAttr(o.orderId)}'))">🖨️</button>
      </div>
    </div>`;
  }).join('') : `<div class="muted text-center" style="padding:18px;font-size:12px">Kosong</div>`;

  document.getElementById('listReady').innerHTML = ready.length ? ready.map(o => {
    const mins = elapsedMins(o.createdAtMs);
    return `<div class="order-card">
      <div class="order-head">
        <div><span class="badge b-green">${escapeHtml(o.location)}</span> <span class="badge ${o.paymentStatus === 'LUNAS' ? 'b-green' : 'b-amber'}">${escapeHtml(o.paymentStatus)}</span><div class="fw-800" style="margin-top:3px">${escapeHtml(o.customerName)}</div></div>
        <span class="badge b-slate mono" data-elapsed-ms="${o.createdAtMs}">${mins}m</span>
      </div>
      <ul class="item-list">${(o.items || []).map(it => `<li class="item-row"><span><strong>${it.qty}x</strong> ${escapeHtml(it.name)}</span></li>`).join('')}</ul>
      <div class="card-actions">
        <button class="btn btn-sm btn-success" onclick="setOrderStatus('${escapeAttr(o.orderId)}','SELESAI')">🏃 Sudah Diantar</button>
      </div>
    </div>`;
  }).join('') : `<div class="muted text-center" style="padding:18px;font-size:12px">Kosong</div>`;

  // Group Open Tab by table location
  const tabGroups = new Map();
  tabs.forEach(o => {
    if (!tabGroups.has(o.location)) tabGroups.set(o.location, []);
    tabGroups.get(o.location).push(o);
  });
  setText('cntOpenTab', String(tabGroups.size));
  document.getElementById('listOpenTab').innerHTML = tabGroups.size ? Array.from(tabGroups.entries()).map(([loc, list]) => {
    const names = [...new Set(list.map(x => x.customerName).filter(Boolean))].join(', ');
    const sum = list.reduce((s, x) => s + (Number(x.totalPrice) || 0), 0);
    return `<div class="order-card" style="border-left:3px solid var(--amber)">
      <div class="order-head">
        <div><span class="badge b-amber">${escapeHtml(loc)}</span> <span class="badge b-slate">${list.length} tiket</span><div class="fw-800" style="margin-top:3px">${escapeHtml(names)}</div></div>
        <strong class="mono">${formatRupiah(sum)}</strong>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm btn-primary" onclick="openCheckoutModal('${escapeAttr(loc)}')">💳 Bayar</button>
        <button class="btn btn-sm" onclick="openPosModal('${escapeAttr(loc)}','${escapeAttr(list[0].customerName || '')}')">+ Ronde</button>
      </div>
    </div>`;
  }).join('') : `<div class="muted text-center" style="padding:18px;font-size:12px">Tidak ada Open Tab</div>`;
}

function renderRadar() {
  const cont = document.getElementById('radarContainer');
  if (!cont) return;
  const zones = new Map();
  TABLE_CONFIG.forEach(t => {
    const z = t.zone || 'Area Utama';
    if (!zones.has(z)) zones.set(z, { title: z, sub: t.zoneDesc || '', items: [] });
    zones.get(z).items.push(t);
  });

  cont.innerHTML = Array.from(zones.values()).map(z => `
    <div class="zone-block">
      <h3 class="zone-title">${escapeHtml(z.title)}</h3>
      <p class="zone-sub">${escapeHtml(z.sub)}</p>
      <div class="radar-grid">
        ${z.items.map(t => {
          const loc = t.name;
          const active = appState.orders.filter(o => isOrderTableActive(o, loc));
          const safe = escapeAttr(loc);
          if (!active.length) {
            const ic = t.type === 'TAKEAWAY' ? '🛍️' : (t.type === 'BAR' ? '🍸' : '🪑');
            return `<div class="table-node free" onclick="openPosModal('${safe}','')">
              <div class="table-node-head"><strong class="mono">${escapeHtml(loc)}</strong><span>${ic}</span></div>
              <div class="text-center muted" style="font-size:11px;margin:8px 0">Tersedia • +Order</div>
              <div class="text-right muted mono" style="font-size:10px">0 tiket</div>
            </div>`;
          }
          const openTabs = active.filter(o => o.paymentStatus === 'OPEN TAB');
          const hasTab = openTabs.length > 0;
          const hasReady = active.some(o => o.status === 'SIAP SAJI');
          const hasWeb = active.some(o => o.status === 'MENUNGGU KONFIRMASI');
          const hasProc = active.some(o => o.status === 'DIPROSES');
          const hasKasbon = active.some(o => o.paymentStatus === 'KASBON');
          const enjoying = !hasWeb && !hasProc && !hasReady && !hasTab && active.every(o => o.status === 'SELESAI' && (o.paymentStatus === 'LUNAS' || o.paymentStatus === 'KASBON'));
          const pool = hasTab ? openTabs : active;
          const oldest = Math.min(...pool.map(o => Number(o.createdAtMs) || Date.now()));
          const mins = elapsedMins(oldest);
          const late = hasProc && mins >= 10;
          const bill = pool.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
          const names = [...new Set(pool.map(o => o.customerName).filter(Boolean))].join(', ') || 'Tamu';

          let cls = 'st-tab', bdg = `<span class="badge b-amber">TAB (${openTabs.length})</span>`;
          if (late) { cls = 'st-late'; bdg = `<span class="badge b-rose">LATE ${mins}m</span>`; }
          else if (hasReady) { cls = 'st-ready'; bdg = `<span class="badge b-green">SIAP ANTAR</span>`; }
          else if (hasWeb) { cls = 'st-web'; bdg = `<span class="badge b-rose">WEB</span>`; }
          else if (hasProc) { cls = 'st-proc'; bdg = `<span class="badge b-blue">DIRACIK</span>`; }
          else if (enjoying) { cls = hasKasbon ? 'st-kasbon' : 'st-sit'; bdg = hasKasbon ? `<span class="badge b-purple">KASBON</span>` : `<span class="badge b-blue">DUDUK</span>`; }
          const readyOrd = active.find(o => o.status === 'SIAP SAJI');

          return `<div class="table-node ${cls}">
            <div onclick="openTableDetail('${safe}')" style="cursor:pointer">
              <div class="table-node-head"><strong class="mono" style="font-size:12px">${escapeHtml(loc)}</strong>${bdg}</div>
              <div class="fw-700 truncate" style="font-size:12px;margin-top:4px">${escapeHtml(names)}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
                <strong class="mono" style="font-size:12px">${formatRupiah(bill)}</strong>
                <span class="mono muted" style="font-size:10px" data-elapsed-ms="${oldest}">${formatDwell(mins)}</span>
              </div>
            </div>
            <div class="table-node-actions">
              <button class="btn" onclick="openTableDetail('${safe}')">Detail</button>
              ${hasTab ? `<button class="btn btn-primary" onclick="openCheckoutModal('${safe}')">Bayar</button>`
                : readyOrd ? `<button class="btn btn-success" onclick="setOrderStatus('${escapeAttr(readyOrd.orderId)}','SELESAI')">Antar</button>`
                : enjoying ? `<button class="btn btn-navy" onclick="clearTableByLocation('${safe}')">Kosong</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function setKdsFilter(f) {
  kdsFilter = f;
  document.getElementById('kdsFAll').classList.toggle('active', f === 'ALL');
  document.getElementById('kdsFProc').classList.toggle('active', f === 'DIPROSES');
  document.getElementById('kdsFReady').classList.toggle('active', f === 'SIAP SAJI');
  renderKds();
}

function renderKds() {
  const grid = document.getElementById('kdsGrid');
  if (!grid) return;
  const list = appState.orders.filter(o => {
    if (kdsFilter === 'ALL') return o.status === 'DIPROSES' || o.status === 'SIAP SAJI';
    return o.status === kdsFilter;
  }).sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

  grid.innerHTML = list.length ? list.map(o => {
    const mins = elapsedMins(o.createdAtMs);
    const late = o.status === 'DIPROSES' && mins >= 10;
    return `<div class="order-card ${late ? 'late' : ''}">
      <div class="order-head">
        <div>
          <span class="badge ${o.status === 'SIAP SAJI' ? 'b-green' : 'b-blue'}">${escapeHtml(o.location)}</span>
          <span class="mono muted" style="font-size:11px">#${escapeHtml(o.orderId.slice(-8))}</span>
          <div class="fw-800" style="margin-top:3px">${escapeHtml(o.customerName)}</div>
        </div>
        <span class="badge ${late ? 'b-rose' : 'b-slate'} mono" data-elapsed-ms="${o.createdAtMs}">${mins}m</span>
      </div>
      <div style="margin:8px 0">
        ${(o.items || []).map((it, idx) => `
          <label class="kds-check ${it.done ? 'done' : ''}">
            <input type="checkbox" ${it.done ? 'checked' : ''} onchange="toggleKdsItem('${escapeAttr(o.orderId)}',${idx})" />
            <div><strong>${it.qty}x ${escapeHtml(it.name)}</strong>${it.note ? `<div class="item-note">* ${escapeHtml(it.note)}</div>` : ''}</div>
          </label>
        `).join('')}
      </div>
      <div class="card-actions">
        ${o.status === 'DIPROSES'
          ? `<button class="btn btn-primary" onclick="setOrderStatus('${escapeAttr(o.orderId)}','SIAP SAJI')">🔔 Tandai Siap Saji</button>`
          : `<button class="btn btn-success" onclick="setOrderStatus('${escapeAttr(o.orderId)}','SELESAI')">✓ Sudah Diantar</button>`}
      </div>
    </div>`;
  }).join('') : `<div class="muted text-center" style="grid-column:1/-1;padding:30px">Tidak ada tiket racikan aktif</div>`;
}

function findOrder(oid) { return appState.orders.find(o => o.orderId === oid); }
function setWebAuth(oid, val) { const o = findOrder(oid); if (o) o.selectedAuth = val; }
function acceptWebOrder(oid) {
  const o = findOrder(oid); if (!o) return;
  const auth = o.selectedAuth || 'QRIS';
  o.status = 'DIPROSES'; o.paymentMethod = auth;
  o.paymentStatus = auth === 'Open Tab' ? 'OPEN TAB' : (auth === 'Kasbon' ? 'KASBON' : 'LUNAS');
  o.lastModifiedAtMs = Date.now(); o.syncStatus = 'pending';
  if (o.paymentStatus === 'LUNAS') o.settledAtMs = Date.now();
  if (o.paymentStatus === 'KASBON') upsertLocalKasbon(o);
  saveState(); renderAllActive();
  Printer.autoPrintOrder(o);
  SyncQueue.enqueue({ action: 'UPDATE_STATUS', orderId: o.orderId, newStatus: 'DIPROSES', metodeBayar: auth, settledAtMs: o.settledAtMs || 0 });
  showToast(`Pesanan ${o.location} diterima (${auth})`, 'ok');
}
function rejectWebOrder(oid) {
  if (!confirm('Tolak / batalkan pesanan web ini?')) return;
  const o = findOrder(oid); if (!o) return;
  o.status = 'BATAL'; o.paymentStatus = 'BATAL'; o.lastModifiedAtMs = Date.now(); o.syncStatus = 'pending';
  saveState(); renderAllActive();
  SyncQueue.enqueue({ action: 'UPDATE_STATUS', orderId: o.orderId, newStatus: 'BATAL' });
  showToast('Pesanan web dibatalkan', 'warn');
}
function setOrderStatus(oid, st) {
  const o = findOrder(oid); if (!o) return;
  o.status = st; o.lastModifiedAtMs = Date.now(); o.syncStatus = 'pending';
  if (st === 'SIAP SAJI') (o.items || []).forEach(it => { it.done = true; });
  saveState(); renderAllActive();
  SyncQueue.enqueue({ action: 'UPDATE_STATUS', orderId: o.orderId, newStatus: st, items_json: JSON.stringify(o.items || []) });
  showToast(`#${o.orderId.slice(-6)} -> ${st}`, 'ok');
}
function toggleKdsItem(oid, idx) {
  const o = findOrder(oid); if (!o || !o.items || !o.items[idx]) return;
  o.items[idx].done = !o.items[idx].done;
  o.lastModifiedAtMs = Date.now(); o.syncStatus = 'pending';
  saveState(); renderActiveView();
  SyncQueue.enqueue({ action: 'UPDATE_STATUS', orderId: o.orderId, newStatus: o.status, items_json: JSON.stringify(o.items) });
}

// ============================================================================
// 5. POS MODAL (Dynamic Tables + Occupied 1-Tap Banner + Billyard Discount)
// ============================================================================
const pos = { cat: 'Semua', query: '', loc: null, cust: '', pay: null, cart: [], billyardOn: true, dismissedOcc: null };

function openPosModal(prefillLoc = null, prefillCust = '') {
  pos.cat = 'Semua'; pos.query = ''; pos.cart = []; pos.billyardOn = true; pos.dismissedOcc = null;
  pos.loc = prefillLoc || null;
  pos.cust = prefillCust || '';
  pos.pay = prefillLoc ? 'Open Tab' : null;
  document.getElementById('posSearch').value = '';
  document.getElementById('posCustName').value = pos.cust;
  document.getElementById('posCashInput').value = '';
  renderPosModal();
  openModal('modalPos');
}
function onPosSearch(v) { pos.query = v; renderPosMenus(); }
function onPosCustInput(v) { pos.cust = v; renderPosCart(); }
function setPosCustomer(name) { pos.cust = name; document.getElementById('posCustName').value = name; pos.billyardOn = true; renderPosCart(); }
function toggleBillyard() { pos.billyardOn = !pos.billyardOn; renderPosCart(); }

function renderPosModal() {
  const cats = ['Semua', ...new Set(MENU_CATALOG.map(m => m.category || 'Lainnya'))];
  document.getElementById('posCats').innerHTML = cats.map(c =>
    `<button class="chip ${pos.cat === c ? 'active' : ''}" onclick="pos.cat='${escapeAttr(c)}';renderPosModal()">${escapeHtml(c)}</button>`
  ).join('');
  renderPosMenus();
  renderPosTables();
  renderPosCart();
  renderPosPayBtns();
}
function renderPosMenus() {
  const q = pos.query.trim().toLowerCase();
  const list = MENU_CATALOG.filter(m => (pos.cat === 'Semua' || (m.category || 'Lainnya') === pos.cat) && (!q || String(m.name).toLowerCase().includes(q)));
  document.getElementById('posMenuGrid').innerHTML = list.length ? list.map(m => {
    const qty = pos.cart.filter(c => String(c.id) === String(m.id)).reduce((s, c) => s + c.qty, 0);
    return `<button class="menu-btn ${qty ? 'in-cart' : ''}" onclick="addPosItem('${escapeAttr(m.id)}')">
      <div class="menu-name">${escapeHtml(m.name)}${qty ? ` <span class="badge b-blue">${qty}x</span>` : ''}</div>
      <div class="menu-price mono">${formatRupiah(m.price)}</div>
    </button>`;
  }).join('') : `<div class="muted text-center" style="grid-column:1/-1;padding:24px">Menu tidak ditemukan. Klik <strong>+ Custom</strong> untuk input manual.</div>`;
}
function addPosItem(id) {
  const m = MENU_CATALOG.find(x => String(x.id) === String(id)); if (!m) return;
  const ex = pos.cart.find(c => String(c.id) === String(id) && !c.note);
  if (ex) ex.qty++; else pos.cart.push({ id: m.id, name: m.name, price: Number(m.price) || 0, qty: 1, note: '' });
  renderPosMenus(); renderPosCart();
}
function openCustomItemPrompt() {
  const name = prompt('Nama item custom:', pos.query.trim()); if (!name || !name.trim()) return;
  const price = Number(prompt('Harga satuan (Rp):', '15000')); if (!Number.isFinite(price) || price <= 0) return;
  pos.cart.push({ id: 'CUSTOM-' + Date.now(), name: name.trim(), price, qty: 1, note: '' });
  renderPosCart();
}
function changeCartQty(idx, delta) {
  if (!pos.cart[idx]) return;
  pos.cart[idx].qty += delta;
  if (pos.cart[idx].qty <= 0) pos.cart.splice(idx, 1);
  renderPosMenus(); renderPosCart();
}
function editCartNote(idx) {
  if (!pos.cart[idx]) return;
  const n = prompt(`Catatan untuk ${pos.cart[idx].name}:`, pos.cart[idx].note || '');
  if (n !== null) { pos.cart[idx].note = n.trim(); renderPosCart(); }
}

function renderPosTables() {
  const tabSet = new Set(appState.orders.filter(o => o.paymentStatus === 'OPEN TAB' && o.status !== 'BATAL').map(o => o.location));
  const occSet = new Set(appState.orders.filter(o => !isTakeawayLoc(o.location) && isOrderTableActive(o, o.location)).map(o => o.location));
  document.getElementById('posTableGrid').innerHTML = TABLE_CONFIG.map(t => {
    const loc = t.name;
    const isSel = pos.loc === loc;
    const dot = tabSet.has(loc) ? '<span class="tbl-dot tab"></span>' : (occSet.has(loc) ? '<span class="tbl-dot occ"></span>' : '');
    return `<button class="pos-tbl-btn mono ${isSel ? 'active' : ''}" onclick="selectPosTable('${escapeAttr(loc)}')">${escapeHtml(loc.replace('Meja ', 'M-'))}${dot}</button>`;
  }).join('');
  updatePosOccBanner();
}
function selectPosTable(loc) {
  pos.loc = loc;
  if (pos.dismissedOcc && pos.dismissedOcc !== loc) pos.dismissedOcc = null;
  const tabs = appState.orders.filter(o => o.location === loc && o.paymentStatus === 'OPEN TAB' && o.status !== 'BATAL');
  if (tabs.length && !pos.cust) {
    pos.cust = tabs[0].customerName || '';
    document.getElementById('posCustName').value = pos.cust;
    pos.pay = 'Open Tab';
    renderPosPayBtns();
  }
  renderPosTables(); renderPosCart();
}
function updatePosOccBanner() {
  const b = document.getElementById('posOccBanner');
  if (!pos.loc || pos.dismissedOcc === pos.loc || isTakeawayLoc(pos.loc)) { b.classList.add('hidden'); return; }
  const act = appState.orders.filter(o => isOrderTableActive(o, pos.loc));
  const fin = act.filter(o => o.status === 'SELESAI' && (o.paymentStatus === 'LUNAS' || o.paymentStatus === 'KASBON'));
  if (fin.length && !act.some(o => o.paymentStatus === 'OPEN TAB')) {
    const names = [...new Set(fin.map(x => x.customerName).filter(Boolean))].join(', ');
    document.getElementById('posOccText').innerHTML = `Terisi: <strong>${escapeHtml(names)}</strong> (Lunas)`;
    b.classList.remove('hidden');
  } else b.classList.add('hidden');
}
function clearFromPosBanner() { if (pos.loc) { clearTableByLocation(pos.loc); renderPosTables(); } }
function dismissPosBanner() { pos.dismissedOcc = pos.loc; document.getElementById('posOccBanner').classList.add('hidden'); }

function getPosTotals() {
  const raw = pos.cart.reduce((s, c) => s + c.price * c.qty, 0);
  const qty = pos.cart.reduce((s, c) => s + c.qty, 0);
  const isBil = String(pos.cust || '').toLowerCase().includes('billyard');
  const disc = (isBil && pos.billyardOn && qty > 0) ? Math.min(raw, qty * 1000) : 0;
  return { raw, disc, total: Math.max(0, raw - disc), qty, isBil };
}
function renderPosCart() {
  const t = getPosTotals();
  setText('posCartCount', String(t.qty));
  setText('posTotalOut', formatRupiah(t.total));
  const bilRow = document.getElementById('posBillyardRow');
  if (t.isBil && t.qty > 0) {
    bilRow.classList.remove('hidden');
    setText('posBillyardText', pos.billyardOn ? `Diskon Billyard (-${formatRupiah(t.disc)})` : 'Diskon Billyard (Nonaktif)');
    setText('posBillyardBtn', pos.billyardOn ? 'Nonaktifkan' : 'Aktifkan');
  } else bilRow.classList.add('hidden');

  document.getElementById('posCartBox').innerHTML = pos.cart.length ? pos.cart.map((c, i) => `
    <div class="cart-line">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <div class="truncate"><strong>${escapeHtml(c.name)}</strong> <span class="mono muted">${formatRupiah(c.price * c.qty)}</span></div>
        <div style="display:flex;gap:3px;flex-shrink:0">
          <button class="btn btn-xs" onclick="editCartNote(${i})" title="Catatan">📝</button>
          <button class="btn btn-xs" onclick="changeCartQty(${i},-1)">-</button>
          <span class="mono fw-800" style="padding:2px 4px">${c.qty}</span>
          <button class="btn btn-xs" onclick="changeCartQty(${i},1)">+</button>
        </div>
      </div>
      ${c.note ? `<div class="item-note">* ${escapeHtml(c.note)}</div>` : ''}
    </div>
  `).join('') : `<div class="muted text-center" style="padding:10px;font-size:12px">Tap menu di kiri untuk menambah</div>`;
  calcPosChange();
}
function selectPosPay(m) { pos.pay = m; renderPosPayBtns(); }
function renderPosPayBtns() {
  document.querySelectorAll('.pay-btn').forEach(b => b.classList.toggle('active', b.dataset.pay === pos.pay));
  document.getElementById('posCashBox').classList.toggle('hidden', pos.pay !== 'Tunai');
  calcPosChange();
}
function setPosCash(v) {
  const t = getPosTotals();
  document.getElementById('posCashInput').value = v === 'exact' ? t.total : v;
  calcPosChange();
}
function calcPosChange() {
  const t = getPosTotals();
  const rec = Number(document.getElementById('posCashInput').value) || 0;
  const ch = rec - t.total;
  const el = document.getElementById('posChangeOut');
  el.textContent = ch >= 0 ? formatRupiah(ch) : 'Kurang ' + formatRupiah(Math.abs(ch));
  el.style.color = ch >= 0 ? 'var(--green)' : 'var(--rose)';
}

function submitPosOrder() {
  if (!pos.loc) return showToast('Pilih meja terlebih dahulu', 'err');
  const cust = (document.getElementById('posCustName').value || '').trim();
  if (!cust) return showToast('Isi nama pelanggan terlebih dahulu', 'err');
  if (!pos.cart.length) return showToast('Keranjang masih kosong', 'err');
  if (!pos.pay) return showToast('Pilih metode pembayaran', 'err');

  const t = getPosTotals();
  const oid = genOrderId(pos.loc);
  const nowMs = Date.now();
  const items = pos.cart.map(c => ({ id: c.id, name: c.name, qty: c.qty, price: c.price, options: '', note: c.note || '', done: false }));
  const summary = items.map(it => `${it.qty}x ${it.name}${it.note ? ' (' + it.note + ')' : ''}`).join(', ');
  const notes = [pos.pay === 'Open Tab' ? '[OPEN TAB]' : '', t.disc > 0 ? `Diskon Billyard -${t.disc}` : ''].filter(Boolean).join(' ') || '-';
  const paySt = pos.pay === 'Open Tab' ? 'OPEN TAB' : (pos.pay === 'Kasbon' ? 'KASBON' : 'LUNAS');

  const ord = {
    orderId: oid, timestamp: nowTimestampStr(), createdAtMs: nowMs,
    location: pos.loc, customerName: cust, items, totalPrice: t.total,
    paymentMethod: pos.pay, selectedAuth: pos.pay, paymentStatus: paySt,
    status: 'DIPROSES', settledAtMs: paySt === 'LUNAS' ? nowMs : 0,
    syncStatus: 'pending', lastModifiedAtMs: nowMs, round: 1, source: 'LOCAL', isTableCleared: false
  };
  appState.orders.unshift(ord);
  if (paySt === 'KASBON') upsertLocalKasbon(ord);
  saveState(true);
  closeModal('modalPos');
  renderAllActive();
  showToast(`✓ Pesanan #${oid.slice(-6)} (${formatRupiah(t.total)}) tersimpan`, 'ok');

  Printer.autoPrintOrder(ord);
  SyncQueue.enqueue({
    action: 'CREATE_ORDER', orderId: oid, meja: ord.location, nama: ord.customerName,
    rincian: summary, catatan: notes, subtotal: t.raw, diskon: t.disc,
    total: ord.totalPrice, metodeBayar: ord.paymentMethod, status: 'DIPROSES',
    settledAtMs: ord.settledAtMs, items_json: JSON.stringify(items)
  });
}

// ============================================================================
// 6. SPLIT BILL CHECKOUT & TABLE DETAIL
// ============================================================================
let chkLoc = null;
let chkSelected = new Set();

function openCheckoutModal(loc) {
  chkLoc = loc;
  const tabs = getOpenTabsAt(loc);
  if (!tabs.length) return;
  chkSelected = new Set(tabs.map(o => o.orderId));
  setText('chkTableTitle', loc);
  renderCheckoutList(true);
  openModal('modalCheckout');
}
function getOpenTabsAt(loc) { return appState.orders.filter(o => o.location === loc && o.paymentStatus === 'OPEN TAB' && o.status !== 'BATAL'); }
function renderCheckoutList(resetCash = false) {
  const tabs = getOpenTabsAt(chkLoc);
  const sel = tabs.filter(o => chkSelected.has(o.orderId));
  const sum = sel.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const guests = [...new Set(tabs.map(o => String(o.customerName || 'Tamu').trim()))];
  const chips = document.getElementById('chkGuestChips');
  chips.innerHTML = guests.length > 1
    ? [`<button class="chip ${sel.length === tabs.length ? 'active' : ''}" onclick="filterChkGuest('ALL')">Semua (${tabs.length})</button>`,
       ...guests.map(g => {
         const go = tabs.filter(x => String(x.customerName || 'Tamu').trim() === g);
         const active = sel.length === go.length && go.every(x => chkSelected.has(x.orderId));
         return `<button class="chip ${active ? 'active' : ''}" onclick="filterChkGuest('${escapeAttr(g)}')">👤 ${escapeHtml(g)} (${go.length})</button>`;
       })].join('')
    : '';
  document.getElementById('chkTicketList').innerHTML = tabs.map((o, i) => `
    <label class="kds-check" style="margin:0;text-decoration:none;background:${chkSelected.has(o.orderId) ? '#fff' : '#f1f5f9'}">
      <input type="checkbox" ${chkSelected.has(o.orderId) ? 'checked' : ''} onchange="toggleChk('${escapeAttr(o.orderId)}')" />
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;font-size:12px"><strong>👤 ${escapeHtml(o.customerName)} • R${i + 1}</strong><strong class="mono">${formatRupiah(o.totalPrice)}</strong></div>
        <div class="muted" style="font-size:11px">${(o.items || []).map(it => `${it.qty}x ${escapeHtml(it.name)}`).join(', ')}</div>
      </div>
    </label>
  `).join('');
  setText('chkTotalOut', formatRupiah(sum));
  setText('chkCountText', `${sel.length}/${tabs.length} tiket dipilih`);
  if (resetCash) document.getElementById('chkCashInput').value = sum;
  calcChkChange();
}
function toggleChk(oid) { if (chkSelected.has(oid)) chkSelected.delete(oid); else chkSelected.add(oid); renderCheckoutList(true); }
function filterChkGuest(g) {
  const tabs = getOpenTabsAt(chkLoc);
  chkSelected = new Set((g === 'ALL' ? tabs : tabs.filter(o => String(o.customerName || 'Tamu').trim() === g)).map(o => o.orderId));
  renderCheckoutList(true);
}
function setChkCash(v) {
  const sum = getOpenTabsAt(chkLoc).filter(o => chkSelected.has(o.orderId)).reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  document.getElementById('chkCashInput').value = v === 'exact' ? sum : v;
  calcChkChange();
}
function calcChkChange() {
  const sum = getOpenTabsAt(chkLoc).filter(o => chkSelected.has(o.orderId)).reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const ch = (Number(document.getElementById('chkCashInput').value) || 0) - sum;
  const el = document.getElementById('chkChangeOut');
  el.textContent = ch >= 0 ? formatRupiah(ch) : 'Kurang ' + formatRupiah(Math.abs(ch));
  el.style.color = ch >= 0 ? 'var(--green)' : 'var(--rose)';
}
function finalizeCheckout(method) {
  const sel = getOpenTabsAt(chkLoc).filter(o => chkSelected.has(o.orderId));
  if (!sel.length) return showToast('Pilih minimal 1 tiket', 'err');
  const nowMs = Date.now();
  const total = sel.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  sel.forEach(o => {
    o.paymentStatus = method === 'Kasbon' ? 'KASBON' : 'LUNAS';
    o.paymentMethod = method; o.syncStatus = 'pending'; o.lastModifiedAtMs = nowMs;
    if (method !== 'Kasbon') o.settledAtMs = nowMs; else upsertLocalKasbon(o);
    if (o.status === 'SIAP SAJI') o.status = 'SELESAI';
    SyncQueue.enqueue({ action: 'UPDATE_STATUS', orderId: o.orderId, newStatus: o.status, metodeBayar: method, settledAtMs: o.settledAtMs || 0 });
  });
  saveState(true); closeModal('modalCheckout'); renderAllActive();
  showToast(`${chkLoc}: ${sel.length} tiket (${formatRupiah(total)}) • ${method}`, 'ok');
  if (method !== 'Kasbon') {
    const items = sel.flatMap((o, idx) => (o.items || []).map(it => ({ name: `[R${idx + 1}] ${it.name}`, qty: it.qty, price: it.price, note: it.note })));
    const guests = [...new Set(sel.map(o => o.customerName).filter(Boolean))].join(', ');
    Printer.printReceipt({ orderId: 'TAB-' + chkLoc.replace(/\s+/g, ''), timestamp: nowTimestampStr(), location: chkLoc, customerName: guests, items, totalPrice: total, paymentMethod: method, paymentStatus: 'LUNAS' });
    if (method === 'Tunai' && Printer.getCfg().autoDrawer) Printer.openDrawer(true);
  }
}

let currentTableDetailLoc = null;
function openTableDetail(loc) { currentTableDetailLoc = loc; renderTableDetail(); openModal('modalTableDetail'); }
function renderTableDetail() {
  const loc = currentTableDetailLoc;
  const list = appState.orders.filter(o => isOrderTableActive(o, loc)).sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  if (!list.length) { closeModal('modalTableDetail'); currentTableDetailLoc = null; return; }
  const total = list.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const names = [...new Set(list.map(o => o.customerName).filter(Boolean))].join(', ');
  setText('tdTitle', loc);
  setText('tdMeta', `👤 ${names} • ${list.length} tiket`);
  setText('tdTotal', formatRupiah(total));
  document.getElementById('tdBody').innerHTML = list.map((o, i) => `
    <div class="order-card">
      <div class="order-head">
        <span class="mono fw-700">#${escapeHtml(o.orderId.slice(-8))} • R${i + 1} (${escapeHtml(o.customerName)})</span>
        <span><span class="badge b-slate">${escapeHtml(o.status)}</span> <span class="badge ${o.paymentStatus === 'LUNAS' ? 'b-green' : 'b-amber'}">${escapeHtml(o.paymentStatus)}</span></span>
      </div>
      <ul class="item-list">${(o.items || []).map(it => `<li class="item-row"><span>${it.qty}x ${escapeHtml(it.name)}</span><span class="mono">${formatRupiah((it.price || 0) * it.qty)}</span></li>`).join('')}</ul>
      <div class="text-right mono fw-800">${formatRupiah(o.totalPrice)}</div>
    </div>
  `).join('');
  const hasTab = list.some(o => o.paymentStatus === 'OPEN TAB');
  const enjoying = list.every(o => o.status === 'SELESAI' && (o.paymentStatus === 'LUNAS' || o.paymentStatus === 'KASBON'));
  document.getElementById('tdBtnAdd').onclick = () => { closeModal('modalTableDetail'); openPosModal(loc, list[0].customerName || ''); };
  const btnC = document.getElementById('tdBtnClear');
  btnC.classList.toggle('hidden', !enjoying);
  btnC.onclick = () => { closeModal('modalTableDetail'); clearTableByLocation(loc); };
  const btnP = document.getElementById('tdBtnPay');
  btnP.classList.toggle('hidden', !hasTab);
  btnP.onclick = () => { closeModal('modalTableDetail'); openCheckoutModal(loc); };
}

// ============================================================================
// 7. KASBON, PENGELUARAN, SETTLEMENT, RIWAYAT, OUTBOX, CREW, SETTINGS
// ============================================================================
function upsertLocalKasbon(ord) {
  if (appState.piutangAktif.some(k => k.order_id === ord.orderId)) return;
  const due = new Date(Date.now() + 3 * 86400000);
  const item = {
    order_id: ord.orderId, tanggal: ord.timestamp, nama_pelanggan: ord.customerName,
    rincian_pesanan: (ord.items || []).map(it => `${it.qty}x ${it.name}`).join(', '),
    total_tagihan: Number(ord.totalPrice) || 0, jatuh_tempo: `${pad2(due.getDate())}/${pad2(due.getMonth() + 1)}/${due.getFullYear()}`,
    status_bayar: 'BELUM LUNAS', tgl_lunas: '-', metode_pelunasan: '-', syncStatus: 'pending'
  };
  appState.piutangAktif.unshift(item);
  PosIDB.put('piutang_aktif', item);
}

function openKasbonModal() { switchKasbonTab('aktif'); renderKasbonModal(); openModal('modalKasbon'); }
function switchKasbonTab(t) {
  document.getElementById('kbTabAktif').classList.toggle('active', t === 'aktif');
  document.getElementById('kbTabArsip').classList.toggle('active', t === 'arsip');
  document.getElementById('kbAktifView').classList.toggle('hidden', t !== 'aktif');
  document.getElementById('kbArsipView').classList.toggle('hidden', t !== 'arsip');
}
function renderKasbonModal() {
  const groups = new Map();
  appState.piutangAktif.forEach(p => {
    const k = String(p.nama_pelanggan || 'Pelanggan').trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });
  document.getElementById('kbAktifView').innerHTML = groups.size ? Array.from(groups.entries()).map(([name, notes]) => {
    const tot = notes.reduce((s, n) => s + (Number(n.total_tagihan) || 0), 0);
    return `<div class="order-card" style="margin-bottom:8px">
      <div class="order-head">
        <div><strong>👤 ${escapeHtml(name)}</strong> <span class="badge b-rose">${notes.length} nota</span></div>
        <strong class="mono" style="color:var(--rose)">${formatRupiah(tot)}</strong>
      </div>
      <div class="muted" style="font-size:11px;margin-bottom:6px">${notes.map(n => `• ${escapeHtml(n.tanggal)} — ${escapeHtml(n.rincian_pesanan)} (${formatRupiah(n.total_tagihan)})`).join('<br/>')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-success" onclick="settleCustomerKasbon('${escapeAttr(name)}',false)">✓ Lunasi Penuh</button>
        <button class="btn btn-sm btn-primary" onclick="settleCustomerKasbon('${escapeAttr(name)}',true)">💵 Bayar Cicilan</button>
      </div>
    </div>`;
  }).join('') : `<div class="muted text-center" style="padding:24px">Tidak ada piutang aktif ✨</div>`;

  document.getElementById('kbArsipView').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Tgl Lunas</th><th>Pelanggan</th><th>Rincian</th><th>Metode</th><th class="text-right">Nominal</th></tr></thead>
    <tbody>${appState.piutangArsip.slice(0, 100).map(a => `<tr><td class="mono">${escapeHtml(a.tgl_lunas)}</td><td>${escapeHtml(a.nama_pelanggan)}</td><td>${escapeHtml(a.rincian_pesanan)}</td><td><span class="badge b-green">${escapeHtml(a.metode_pelunasan)}</span></td><td class="text-right mono fw-700">${formatRupiah(a.total_tagihan)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center muted">Kosong</td></tr>'}</tbody>
  </table></div>`;
}

function settleCustomerKasbon(name, isPartial) {
  const notes = appState.piutangAktif.filter(p => String(p.nama_pelanggan || '').trim() === name);
  if (!notes.length) return;
  const totalDebt = notes.reduce((s, n) => s + (Number(n.total_tagihan) || 0), 0);
  let payAmt = totalDebt;
  if (isPartial) {
    payAmt = Number(prompt(`Nominal cicilan ${name} (Total hutang ${formatRupiah(totalDebt)}):`, String(Math.min(50000, totalDebt))));
    if (!Number.isFinite(payAmt) || payAmt <= 0 || payAmt > totalDebt) return showToast('Nominal cicilan tidak valid', 'err');
  }
  const methodRaw = prompt('Metode pelunasan: ketik TUNAI, QRIS, atau TRANSFER', 'TUNAI');
  if (!methodRaw) return;
  const method = /qris/i.test(methodRaw) ? 'QRIS' : (/transfer/i.test(methodRaw) ? 'Transfer' : 'TUNAI');
  const nowMs = Date.now(), nowStr = nowTimestampStr();

  let pool = payAmt;
  for (const nota of notes) {
    if (pool <= 0) break;
    const debt = Number(nota.total_tagihan) || 0;
    if (pool >= debt) {
      pool -= debt;
      appState.piutangAktif = appState.piutangAktif.filter(x => x.order_id !== nota.order_id);
      PosIDB.delete('piutang_aktif', nota.order_id);
      const arc = Object.assign({}, nota, { status_bayar: 'LUNAS', tgl_lunas: nowStr, metode_pelunasan: method, settledAtMs: nowMs });
      appState.piutangArsip.unshift(arc);
      const ord = findOrder(nota.order_id);
      if (ord) { ord.paymentStatus = 'LUNAS'; ord.paymentMethod = method; ord.settledAtMs = nowMs; ord.status = 'SELESAI'; }
      SyncQueue.enqueue({ action: 'SETTLE_KASBON', orderId: nota.order_id, metodePelunasan: method });
    } else {
      const rem = debt - pool;
      const cid = `${nota.order_id}-C${Date.now().toString(36).slice(-4).toUpperCase()}`;
      nota.total_tagihan = rem;
      nota.rincian_pesanan = '[Sisa Cicilan] ' + String(nota.rincian_pesanan || '').replace(/^(\[Sisa Cicilan\]\s*)+/, '');
      nota.syncStatus = 'pending';
      PosIDB.put('piutang_aktif', nota);
      appState.piutangArsip.unshift({
        order_id: cid, tanggal: nota.tanggal, nama_pelanggan: nota.nama_pelanggan,
        rincian_pesanan: 'Cicilan: ' + nota.rincian_pesanan, total_tagihan: pool,
        jatuh_tempo: nota.jatuh_tempo, status_bayar: 'LUNAS (CICILAN)', tgl_lunas: nowStr,
        metode_pelunasan: method, settledAtMs: nowMs
      });
      SyncQueue.enqueue({ action: 'PARTIAL_SETTLE_KASBON', orderId: nota.order_id, paidChunk: pool, cicilanId: cid, remainingDebt: rem, metodePelunasan: method });
      pool = 0;
    }
  }
  saveState(true); renderKasbonModal(); renderAllActive();
  showToast(`Pelunasan ${name} (${formatRupiah(payAmt)} • ${method}) dicatat`, 'ok');
}

// PENGELUARAN
let expQuick = 'today';
function openExpenseModal() { switchExpenseTab('add'); setExpQuick('today'); openModal('modalExpense'); }
function switchExpenseTab(t) {
  document.getElementById('expTabAdd').classList.toggle('active', t === 'add');
  document.getElementById('expTabList').classList.toggle('active', t === 'list');
  document.getElementById('expAddView').classList.toggle('hidden', t !== 'add');
  document.getElementById('expListView').classList.toggle('hidden', t !== 'list');
  if (t === 'list') renderExpenseHistory();
}
function fillExpReason(desc, cat) { document.getElementById('expDesc').value = desc; document.getElementById('expCat').value = cat; }
function submitExpense() {
  const kat = document.getElementById('expCat').value;
  const src = document.getElementById('expSource').value;
  const desc = document.getElementById('expDesc').value.trim();
  const nom = Number(document.getElementById('expAmount').value);
  if (!desc || !Number.isFinite(nom) || nom <= 0) return showToast('Lengkapi keperluan & nominal valid', 'err');
  const id = 'EXP-' + Date.now();
  const staff = appState.activeCrew?.nama || 'Kasir';
  const item = { id, timestamp: nowTimestampStr(), createdAtMs: Date.now(), kategori: kat, keterangan: desc, nominal: nom, sumberDana: src, staff, catatan: '-', syncStatus: 'pending' };
  appState.pengeluaran.unshift(item);
  document.getElementById('expDesc').value = '';
  document.getElementById('expAmount').value = '';
  saveState(true); renderAllActive();
  SyncQueue.enqueue({ action: 'ADD_EXPENSE', id, kategori: kat, keterangan: desc, nominal: nom, sumberDana: src, staff, catatan: '-' });
  showToast(`Pengeluaran ${formatRupiah(nom)} dicatat`, 'ok');
}
function setExpQuick(mode) {
  expQuick = mode;
  document.querySelectorAll('[data-expq]').forEach(b => b.classList.toggle('active', b.dataset.expq === mode));
  const today = new Date(), sEl = document.getElementById('expStart'), eEl = document.getElementById('expEnd');
  if (mode === 'today') { sEl.value = localDateStr(today); eEl.value = localDateStr(today); }
  else if (mode === 'yesterday') { const y = new Date(today - 86400000); sEl.value = localDateStr(y); eEl.value = localDateStr(y); }
  else if (mode === '7days') { sEl.value = localDateStr(new Date(today - 6 * 86400000)); eEl.value = localDateStr(today); }
  else if (mode === 'thisMonth') { sEl.value = localDateStr(new Date(today.getFullYear(), today.getMonth(), 1)); eEl.value = localDateStr(today); }
  else { sEl.value = ''; eEl.value = ''; }
  renderExpenseHistory();
}
function renderExpenseHistory() {
  const sVal = document.getElementById('expStart')?.value, eVal = document.getElementById('expEnd')?.value;
  const q = (document.getElementById('expQuery')?.value || '').trim().toLowerCase();
  const sMs = sVal ? new Date(sVal + 'T00:00:00').getTime() : 0;
  const eMs = eVal ? new Date(eVal + 'T23:59:59.999').getTime() : 0;
  const list = (appState.pengeluaran || []).filter(e => {
    const ms = parseTsMs(e.timestamp, e.createdAtMs);
    if (sMs && ms < sMs) return false;
    if (eMs && ms > eMs) return false;
    if (q && !`${e.keterangan} ${e.kategori} ${e.staff}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => parseTsMs(b.timestamp, b.createdAtMs) - parseTsMs(a.timestamp, a.createdAtMs));
  const sumAll = list.reduce((s, e) => s + (Number(e.nominal) || 0), 0);
  const sumCash = list.filter(e => isExpenseDrawer(e.sumberDana)).reduce((s, e) => s + (Number(e.nominal) || 0), 0);
  setText('expSumTotal', formatRupiah(sumAll));
  setText('expSumCash', formatRupiah(sumCash));
  setText('expSumNonCash', formatRupiah(sumAll - sumCash));
  document.getElementById('expTbody').innerHTML = list.length ? list.map(e => `<tr>
    <td class="mono">${escapeHtml(e.timestamp)}</td><td>${escapeHtml(e.kategori)}</td><td>${escapeHtml(e.keterangan)}</td>
    <td>${escapeHtml(e.sumberDana)}</td><td class="text-right mono fw-700">${formatRupiah(e.nominal)}</td>
    <td><button class="btn btn-xs btn-danger-soft" onclick="deleteExpense('${escapeAttr(e.id)}')">Hapus</button></td>
  </tr>`).join('') : '<tr><td colspan="6" class="text-center muted">Tidak ada data</td></tr>';
}
function deleteExpense(id) {
  const pin = prompt('Masukkan PIN Supervisor untuk hapus pengeluaran:');
  if (!pin || !pin.trim()) return;
  appState.pengeluaran = appState.pengeluaran.filter(x => x.id !== id);
  saveState(true); renderExpenseHistory(); renderAllActive();
  SyncQueue.enqueue({ action: 'DELETE_EXPENSE', id, staff_pin: pin.trim(), reason: 'Hapus via Kasir Lite' });
  showToast('Permintaan hapus pengeluaran dikirim', 'warn');
}

// SETTLEMENT SHIFT
function openSettlementModal() {
  switchSettleTab('form');
  const m = ShiftEngine.metrics();
  setText('stOmzet', formatRupiah(m.totalRevenue));
  setText('stSplit', `${formatRupiah(m.cashSales)} / ${formatRupiah(m.nonCashSales)}`);
  setText('stTarget', formatRupiah(m.targetCash));
  document.getElementById('stActual').value = m.targetCash;
  document.getElementById('stNote').value = '';
  calcSettleDiff();
  renderSettlementHistory();
  openModal('modalSettlement');
}
function switchSettleTab(t) {
  document.getElementById('stTabForm').classList.toggle('active', t === 'form');
  document.getElementById('stTabHist').classList.toggle('active', t === 'hist');
  document.getElementById('stFormView').classList.toggle('hidden', t !== 'form');
  document.getElementById('stHistView').classList.toggle('hidden', t !== 'hist');
  if (t === 'hist') renderSettlementHistory();
}
function calcSettleDiff() {
  const m = ShiftEngine.metrics();
  const act = Number(document.getElementById('stActual').value) || 0;
  const diff = act - m.targetCash;
  const el = document.getElementById('stDiff');
  el.textContent = (diff >= 0 ? '+' : '-') + formatRupiah(Math.abs(diff));
  el.style.color = diff === 0 ? 'var(--green)' : (diff > 0 ? 'var(--blue)' : 'var(--rose)');
}
function confirmSettlement() {
  const m = ShiftEngine.metrics();
  const actual = Number(document.getElementById('stActual').value);
  if (!Number.isFinite(actual) || actual < 0) return showToast('Masukkan kas fisik aktual', 'err');
  if (!confirm(`Konfirmasi Settlement shift?\nTarget Laci: ${formatRupiah(m.targetCash)}\nFisik Aktual: ${formatRupiah(actual)}`)) return;
  const now = new Date();
  const startD = new Date(m.cutoff);
  const rec = {
    settlementId: 'SETTLE-' + Date.now(),
    timestamp: now.toISOString(),
    shiftDateStr: nowTimestampStr() + ' WIB',
    staffName: appState.activeCrew?.nama || 'Kasir',
    shiftStartStr: `${pad2(startD.getHours())}:${pad2(startD.getMinutes())}`,
    shiftEndStr: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    totalRevenue: m.totalRevenue, cashSales: m.cashSales, qrisSales: m.nonCashSales,
    cashExpense: m.cashExp, qrisExpense: m.nonCashExp, totalExpense: m.totalExp,
    shiftKasbon: m.shiftKasbon, targetCash: m.targetCash, actualCash: actual,
    diff: actual - m.targetCash, note: (document.getElementById('stNote').value || '').trim() || '-'
  };
  const hist = safeJson(localStorage.getItem('CAPTAIN_SETTLEMENT_HISTORY'), []);
  hist.unshift(rec);
  localStorage.setItem('CAPTAIN_SETTLEMENT_HISTORY', JSON.stringify(hist.slice(0, 50)));
  ShiftEngine.setCutoff(Date.now());
  SyncQueue.enqueue(Object.assign({ action: 'SETTLEMENT_SHIFT' }, rec));
  Printer.printSettlement(rec);
  closeModal('modalSettlement');
  renderAllActive();
  showToast('✓ Settlement berhasil & shift di-reset', 'ok');
}
function renderSettlementHistory() {
  const hist = safeJson(localStorage.getItem('CAPTAIN_SETTLEMENT_HISTORY'), []);
  document.getElementById('stHistTbody').innerHTML = hist.length ? hist.map((r, i) => `<tr>
    <td class="mono">${escapeHtml(r.shiftDateStr || r.timestamp)}</td><td>${escapeHtml(r.staffName)}</td>
    <td class="text-right mono">${formatRupiah(r.totalRevenue)}</td><td class="text-right mono">${formatRupiah(r.targetCash)}</td>
    <td class="text-right mono fw-700">${formatRupiah(r.actualCash)}</td>
    <td class="text-right mono" style="color:${r.diff < 0 ? 'var(--rose)' : 'var(--green)'}">${formatRupiah(r.diff)}</td>
    <td><button class="btn btn-xs" onclick="reprintSettlement(${i})">🖨️</button></td>
  </tr>`).join('') : '<tr><td colspan="7" class="text-center muted">Belum ada riwayat</td></tr>';
}
function reprintSettlement(idx) {
  const hist = safeJson(localStorage.getItem('CAPTAIN_SETTLEMENT_HISTORY'), []);
  if (hist[idx]) Printer.printSettlement(hist[idx]);
}

// RIWAYAT TRANSAKSI
function openHistoryModal() { setHistQuick('today'); openModal('modalHistory'); }
function setHistQuick(mode) {
  document.querySelectorAll('[data-hq]').forEach(b => b.classList.toggle('active', b.dataset.hq === mode));
  const today = new Date(), sEl = document.getElementById('histStart'), eEl = document.getElementById('histEnd');
  if (mode === 'today') { sEl.value = localDateStr(today); eEl.value = localDateStr(today); }
  else if (mode === 'yesterday') { const y = new Date(today - 86400000); sEl.value = localDateStr(y); eEl.value = localDateStr(y); }
  else if (mode === '7days') { sEl.value = localDateStr(new Date(today - 6 * 86400000)); eEl.value = localDateStr(today); }
  else if (mode === 'thisMonth') { sEl.value = localDateStr(new Date(today.getFullYear(), today.getMonth(), 1)); eEl.value = localDateStr(today); }
  else { sEl.value = ''; eEl.value = ''; }
  renderHistory();
}
function renderHistory() {
  const sVal = document.getElementById('histStart')?.value, eVal = document.getElementById('histEnd')?.value;
  const stF = document.getElementById('histStatus')?.value || 'ALL';
  const q = (document.getElementById('histQuery')?.value || '').trim().toLowerCase();
  const sMs = sVal ? new Date(sVal + 'T00:00:00').getTime() : 0;
  const eMs = eVal ? new Date(eVal + 'T23:59:59.999').getTime() : 0;
  const list = appState.orders.filter(o => {
    const ms = parseTsMs(o.timestamp, o.createdAtMs);
    if (sMs && ms < sMs) return false;
    if (eMs && ms > eMs) return false;
    if (stF !== 'ALL') {
      if (stF === 'OPEN TAB' && o.paymentStatus !== 'OPEN TAB') return false;
      else if (stF === 'KASBON' && o.paymentStatus !== 'KASBON') return false;
      else if (stF === 'SELESAI' && o.status !== 'SELESAI' && o.paymentStatus !== 'LUNAS') return false;
      else if (stF === 'BATAL' && o.status !== 'BATAL' && o.status !== 'KADALUARSA') return false;
    }
    if (q && !`${o.orderId} ${o.location} ${o.customerName} ${o.paymentMethod}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => parseTsMs(b.timestamp, b.createdAtMs) - parseTsMs(a.timestamp, a.createdAtMs));

  const paid = list.filter(o => o.status !== 'BATAL' && o.status !== 'KADALUARSA' && o.paymentStatus === 'LUNAS');
  const cashSum = paid.filter(o => String(o.paymentMethod).toUpperCase() === 'TUNAI').reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const nonCashSum = paid.filter(o => String(o.paymentMethod).toUpperCase() !== 'TUNAI').reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  setText('histSumAll', formatRupiah(cashSum + nonCashSum));
  setText('histSumCash', formatRupiah(cashSum));
  setText('histSumNonCash', formatRupiah(nonCashSum));

  document.getElementById('histTbody').innerHTML = list.slice(0, 150).map(o => `<tr>
    <td class="mono">${escapeHtml(o.timestamp)}<br/><span class="muted">#${escapeHtml(o.orderId.slice(-8))}</span></td>
    <td><strong>${escapeHtml(o.location)}</strong><br/>${escapeHtml(o.customerName)}</td>
    <td>${(o.items || []).map(it => `${it.qty}x ${escapeHtml(it.name)}`).join(', ')}</td>
    <td>${escapeHtml(o.paymentMethod)}</td>
    <td><span class="badge ${o.status === 'BATAL' ? 'b-rose' : (o.paymentStatus === 'LUNAS' ? 'b-green' : 'b-amber')}">${escapeHtml(o.status === 'BATAL' ? 'BATAL' : o.paymentStatus)}</span></td>
    <td class="text-right mono fw-700">${formatRupiah(o.totalPrice)}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-xs" onclick="Printer.printReceipt(findOrder('${escapeAttr(o.orderId)}'))">🖨️</button>
      ${o.status !== 'BATAL' ? `<button class="btn btn-xs" onclick="switchPayMethod('${escapeAttr(o.orderId)}')">💳</button>
      <button class="btn btn-xs btn-danger-soft" onclick="voidOrderPrompt('${escapeAttr(o.orderId)}')">Void</button>` : ''}
    </td>
  </tr>`).join('') || '<tr><td colspan="7" class="text-center muted">Tidak ada transaksi</td></tr>';
}
function switchPayMethod(oid) {
  const o = findOrder(oid); if (!o) return;
  const m = prompt(`Ubah metode bayar #${oid.slice(-6)} (Tunai / QRIS / Transfer):`, o.paymentMethod);
  if (!m) return;
  const norm = /qris/i.test(m) ? 'QRIS' : (/transfer/i.test(m) ? 'Transfer' : 'Tunai');
  o.paymentMethod = norm; o.paymentStatus = 'LUNAS'; o.settledAtMs = o.settledAtMs || Date.now(); o.lastModifiedAtMs = Date.now();
  saveState(true); renderAllActive();
  SyncQueue.enqueue({ action: 'UPDATE_PAYMENT_METHOD', orderId: o.orderId, metodeBayar: norm, settledAtMs: o.settledAtMs });
  showToast(`Metode bayar diubah ke ${norm}`, 'ok');
}
function voidOrderPrompt(oid) {
  const o = findOrder(oid); if (!o) return;
  const pin = prompt(`VOID #${oid.slice(-6)} (${formatRupiah(o.totalPrice)}).\nMasukkan PIN Supervisor:`);
  if (!pin || !pin.trim()) return;
  const reason = prompt('Alasan Void:', 'Salah input kasir') || 'Void Supervisor';
  o.status = 'BATAL'; o.paymentStatus = 'BATAL'; o.lastModifiedAtMs = Date.now(); o.syncStatus = 'pending';
  appState.piutangAktif = appState.piutangAktif.filter(p => p.order_id !== oid);
  saveState(true); renderAllActive();
  SyncQueue.enqueue({ action: 'VOID_ORDER', orderId: oid, void_pin: pin.trim(), reason });
  showToast('Tiket di-void & dikirim ke server', 'warn');
}

// OUTBOX MODAL
async function openOutboxModal() {
  const list = await SyncQueue.getPending();
  setText('obCount', `${list.length} Transaksi`);
  setText('obDiag', `${APP_VERSION} (${SyncQueue._batchUnsupported ? 'Single' : 'Batch'}) • GAS v${lastServerApiVersion} • ...${String(SCRIPT_URL).slice(-10)}`);
  document.getElementById('obList').innerHTML = list.length ? list.map(it => `
    <div class="order-card" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div style="min-width:0;flex:1">
        <div class="mono fw-700" style="font-size:12px">#${escapeHtml(it.orderId || '-')} <span class="badge b-slate">${escapeHtml(it.action)}</span></div>
        <div class="mono" style="font-size:11px;color:${it.lastError ? 'var(--rose)' : 'var(--muted)'}">Percobaan ${it.attempts || 0} • ${escapeHtml(it.lastError || 'Menunggu kirim')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <span class="badge ${it.status === 'failed' ? 'b-rose' : 'b-amber'}">${it.permanent ? 'DITOLAK' : it.status.toUpperCase()}</span>
        <button class="btn btn-xs btn-danger-soft" onclick="SyncQueue.discard(${it.id})">🗑️</button>
      </div>
    </div>
  `).join('') : `<div class="muted text-center" style="padding:18px">Antrean kosong. Semua tersinkron ✨</div>`;
  openModal('modalOutbox');
}
async function forceSyncNow() {
  if (!navigator.onLine) return showToast('Tablet sedang offline', 'err');
  const btn = document.getElementById('btnForceSync');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Menyinkronkan...'; }
  try {
    await SyncQueue.flush({ force: true });
    lastDataVersion = 0; // paksa refresh penuh pasca flush
    await fetchFromServer(false, false);
    const rem = await SyncQueue.getPending();
    await openOutboxModal();
    showToast(rem.length ? `Tersisa ${rem.length} antrean` : '✅ Semua antrean tersinkron!', rem.length ? 'warn' : 'ok');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Sinkronkan Sekarang'; }
  }
}
function manualRefresh() { lastDataVersion = 0; fetchFromServer(true, true); }

// CREW SWITCHER
function updateCrewUI() {
  const c = appState.activeCrew || DEFAULT_KRU[1];
  setText('crewPillName', `${c.nama} (${c.peran})`);
}
function openCrewModal() {
  document.getElementById('crewListBody').innerHTML = (appState.kruList || DEFAULT_KRU).map(k => `
    <button class="btn ${appState.activeCrew?.id === k.id ? 'btn-primary' : ''}" style="justify-content:space-between" onclick="selectCrew('${escapeAttr(k.id)}')">
      <span>👤 ${escapeHtml(k.nama)} (${escapeHtml(k.peran)})</span>
      <span>${appState.activeCrew?.id === k.id ? 'Aktif' : 'Pilih'}</span>
    </button>
  `).join('');
  openModal('modalCrew');
}
function selectCrew(id) {
  const target = (appState.kruList || DEFAULT_KRU).find(k => k.id === id); if (!target) return;
  const pin = prompt(`Masukkan PIN untuk ${target.nama}:`);
  if (!pin || pin.trim() !== String(target.pin).trim()) return showToast('PIN salah', 'err');
  appState.activeCrew = target;
  localStorage.setItem('CAPTAIN_ACTIVE_CREW', JSON.stringify(target));
  localStorage.setItem('CAPTAIN_STAFF_PIN', target.pin);
  updateCrewUI(); closeModal('modalCrew');
  showToast(`Kru aktif: ${target.nama}`, 'ok');
}

// SETTINGS
function openSettingsModal() {
  const pc = Printer.getCfg();
  document.getElementById('setGasUrl').value = SCRIPT_URL;
  document.getElementById('setPollSec').value = POLL_INTERVAL_SEC;
  document.getElementById('setPaperWidth').value = pc.paperWidth;
  document.getElementById('setStoreName').value = pc.storeName;
  document.getElementById('setStoreAddr').value = pc.storeAddr;
  document.getElementById('setAutoPrintCashier').checked = pc.autoCashier;
  document.getElementById('setAutoPrintBarista').checked = pc.autoBarista;
  document.getElementById('setAutoDrawer').checked = pc.autoDrawer;
  document.getElementById('setShowLogo').checked = pc.showLogo;
  openModal('modalSettings');
}
function saveSettingsModal() {
  SCRIPT_URL = document.getElementById('setGasUrl').value.trim() || DEFAULT_SCRIPT_URL;
  POLL_INTERVAL_SEC = Math.max(3, Math.min(60, Number(document.getElementById('setPollSec').value) || 5));
  localStorage.setItem('CAPTAIN_GAS_URL', SCRIPT_URL);
  localStorage.setItem('CAPTAIN_POLL_SEC', String(POLL_INTERVAL_SEC));
  Printer.saveCfg({
    paperWidth: document.getElementById('setPaperWidth').value,
    storeName: document.getElementById('setStoreName').value.trim() || 'CAPTAIN COFFEE',
    storeAddr: document.getElementById('setStoreAddr').value.trim(),
    autoCashier: document.getElementById('setAutoPrintCashier').checked,
    autoBarista: document.getElementById('setAutoPrintBarista').checked,
    autoDrawer: document.getElementById('setAutoDrawer').checked,
    showLogo: document.getElementById('setShowLogo').checked
  });
  startPollLoop();
  closeModal('modalSettings');
  showToast('Pengaturan disimpan', 'ok');
  manualRefresh();
}

// ============================================================================
// 8. WEB BLUETOOTH THERMAL PRINTER ENGINE (MTU-Safe 20/40b + Logo Cap)
// ============================================================================
const Printer = {
  device: null, char: null, safeChunk: null, chain: Promise.resolve(),
  getCfg() {
    return Object.assign({
      paperWidth: '58', storeName: 'CAPTAIN COFFEE', storeAddr: '',
      autoCashier: false, autoBarista: false, autoDrawer: false, showLogo: true
    }, safeJson(localStorage.getItem('CAPTAIN_LITE_PRINTER_CFG'), {}), {
      logoBase64: localStorage.getItem('CAPTAIN_PRINTER_LOGO') || ''
    });
  },
  saveCfg(c) { localStorage.setItem('CAPTAIN_LITE_PRINTER_CFG', JSON.stringify(c)); },
  uploadLogo(ev) {
    const f = ev?.target?.files?.[0]; if (!f) return;
    if (f.size > 1024 * 1024) return showToast('Logo maks 1MB', 'err');
    const r = new FileReader();
    r.onload = (e) => { localStorage.setItem('CAPTAIN_PRINTER_LOGO', e.target.result); showToast('Logo tersimpan', 'ok'); };
    r.readAsDataURL(f);
  },
  removeLogo() { localStorage.removeItem('CAPTAIN_PRINTER_LOGO'); showToast('Logo dihapus', 'ok'); },
  handlePillClick() { if (this.char) openSettingsModal(); else this.connect(); },
  updatePill() {
    const p = document.getElementById('btnBtPill'), t = document.getElementById('btPillText');
    if (!p || !t) return;
    if (this.char) { p.className = 'pill-btn ok'; t.textContent = (this.device?.name || 'BT Aktif').slice(0, 12); }
    else { p.className = 'pill-btn err'; t.textContent = 'Printer'; }
  },
  async connect() {
    if (!navigator.bluetooth) return showToast('Browser tidak mendukung Web Bluetooth', 'err');
    try {
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000fff0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb']
      });
      dev.addEventListener('gattserverdisconnected', () => { this.char = null; this.updatePill(); });
      const srv = await dev.gatt.connect();
      const pref = ['000018f0', 'e7810a71', '49535343', '0000fff0', '0000ff00', '0000ffe0'];
      const cands = [];
      for (const s of (await srv.getPrimaryServices().catch(() => []))) {
        const bonus = pref.some(x => String(s.uuid).toLowerCase().startsWith(x)) ? 10 : 0;
        for (const c of (await s.getCharacteristics().catch(() => []))) {
          if (c.properties && (c.properties.write || c.properties.writeWithoutResponse)) {
            cands.push({ c, score: bonus + (c.properties.write ? 5 : 1) });
          }
        }
      }
      cands.sort((a, b) => b.score - a.score);
      if (!cands.length) throw new Error('Characteristic tulis tidak ditemukan');
      this.device = dev; this.char = cands[0].c; this.safeChunk = null;
      this.updatePill();
      showToast(`Printer terhubung: ${dev.name || 'Thermal'}`, 'ok');
    } catch (e) { if (e.name !== 'NotFoundError') showToast('Gagal koneksi BT: ' + e.message, 'err'); }
  },
  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null; this.char = null; this.updatePill(); showToast('Printer diputus', 'info');
  },
  sendBytes(arr) {
    const run = () => this._sendNow(arr);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  },
  async _sendNow(arr) {
    const c = this.char; if (!c) throw new Error('Printer belum terhubung');
    const props = c.properties || {};
    const withResp = Boolean(props.write && (typeof c.writeValueWithResponse === 'function' || typeof c.writeValue === 'function'));
    let size = withResp ? (this.safeChunk || 40) : 20;
    let sincePause = 0;
    for (let i = 0; i < arr.length;) {
      const len = Math.min(size, arr.length - i);
      const chunk = arr.slice(i, i + len);
      try {
        if (withResp && typeof c.writeValueWithResponse === 'function') await c.writeValueWithResponse(chunk);
        else if (!withResp && typeof c.writeValueWithoutResponse === 'function') await c.writeValueWithoutResponse(chunk);
        else await c.writeValue(chunk);
      } catch (err) {
        if (size > 20) {
          size = 20; this.safeChunk = 20;
          await new Promise(r => setTimeout(r, 80));
          const retry = arr.slice(i, i + Math.min(20, arr.length - i));
          if (withResp && typeof c.writeValueWithResponse === 'function') await c.writeValueWithResponse(retry);
          else await c.writeValueWithoutResponse(retry);
          i += retry.length; sincePause += retry.length;
          await new Promise(r => setTimeout(r, 30));
          continue;
        }
        throw err;
      }
      i += len; sincePause += len;
      if (i < arr.length) {
        if (sincePause >= 800) { sincePause = 0; await new Promise(r => setTimeout(r, 70)); }
        else await new Promise(r => setTimeout(r, withResp ? 18 : 26));
      }
    }
  },
  buildLogoBytes(base64, is80) {
    if (!base64) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) return resolve(null);
          const scale = Math.min((is80 ? 480 : 260) / w, (is80 ? 180 : 130) / h, 1);
          w = Math.max(8, Math.round(w * scale)); h = Math.max(8, Math.round(h * scale));
          const wb = Math.ceil(w / 8), aw = wb * 8, padB = is80 ? 8 : 6;
          const cv = document.createElement('canvas'); cv.width = aw; cv.height = h;
          const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, aw, h); ctx.drawImage(img, 0, 0, w, h);
          const px = ctx.getImageData(0, 0, aw, h).data;
          const rowB = padB + wb;
          const out = [0x1D, 0x76, 0x30, 0x00, rowB & 0xff, (rowB >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff];
          for (let y = 0; y < h; y++) {
            for (let p = 0; p < padB; p++) out.push(0);
            for (let xb = 0; xb < wb; xb++) {
              let b = 0;
              for (let bit = 0; bit < 8; bit++) {
                const x = xb * 8 + bit;
                if (x < w) {
                  const idx = (y * aw + x) * 4;
                  if (px[idx] * 0.299 + px[idx + 1] * 0.587 + px[idx + 2] * 0.114 < 165) b |= (1 << (7 - bit));
                }
              }
              out.push(b);
            }
          }
          resolve(new Uint8Array(out));
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = base64;
    });
  },
  async printReceipt(o) {
    if (!o) return;
    const c = this.getCfg();
    const is80 = c.paperWidth === '80';
    const w = is80 ? 48 : 36, pad = '     ';
    const div = pad + '-'.repeat(w) + '\n';
    const lines = [
      '\n', pad + c.storeName + '\n', c.storeAddr ? pad + c.storeAddr + '\n' : '', div,
      `${pad}No   : #${String(o.orderId || '').slice(-10)}\n`,
      `${pad}Wkt  : ${o.timestamp || nowTimestampStr()}\n`,
      `${pad}Meja : ${o.location} • ${o.customerName}\n`, div,
      ...(o.items || []).map(it => `${pad}${it.qty}x ${it.name}\n${pad}   ${formatRupiah((it.price || 0) * it.qty)}\n`),
      div, `${pad}TOTAL: ${formatRupiah(o.totalPrice)}\n`, `${pad}Bayar: ${o.paymentMethod} (${o.paymentStatus})\n`, div, `${pad}Terima kasih!\n\n\n\n`
    ].join('');
    if (this.char) {
      try {
        const enc = new TextEncoder();
        const logo = (c.showLogo && c.logoBase64) ? await this.buildLogoBytes(c.logoBase64, is80) : null;
        const buf = [0x1B, 0x40, 0x1B, 0x4D, 0x01, 0x1B, 0x61, 0x00];
        if (logo) { buf.push(...logo, 0x0A); }
        buf.push(...enc.encode(lines), 0x1D, 0x56, 0x42, 0x00);
        await this.sendBytes(new Uint8Array(buf));
        return showToast('Struk tercetak via BT', 'ok');
      } catch (e) { showToast('BT gagal, buka dialog cetak', 'warn'); }
    }
    const el = document.getElementById('thermalPrintContainer');
    el.className = is80 ? 'w80' : '';
    el.innerHTML = `<pre style="margin:0;white-space:pre-wrap">${escapeHtml(lines)}</pre>`;
    window.print();
  },
  async printBarista(o) {
    if (!o || !this.char) return;
    const enc = new TextEncoder(), pad = '     ';
    const txt = `\n${pad}=== CHECKER BARISTA ===\n${pad}${o.location} • ${o.customerName}\n${pad}#${String(o.orderId).slice(-8)} • ${o.timestamp}\n${pad}------------------------\n`
      + (o.items || []).map(it => `${pad}[ ] ${it.qty}x ${it.name}${it.note ? '\n' + pad + '    * ' + it.note : ''}\n`).join('') + '\n\n\n';
    try { await this.sendBytes(new Uint8Array([0x1B, 0x40, 0x1B, 0x4D, 0x01, ...enc.encode(txt), 0x1D, 0x56, 0x42, 0x00])); } catch (_) {}
  },
  async printSettlement(r) {
    const pad = '     ';
    const txt = `\n${pad}=== SETTLEMENT SHIFT ===\n${pad}${r.shiftDateStr}\n${pad}Petugas: ${r.staffName}\n${pad}------------------------\n`
      + `${pad}Omzet   : ${formatRupiah(r.totalRevenue)}\n${pad}Tunai   : ${formatRupiah(r.cashSales)}\n${pad}NonTunai: ${formatRupiah(r.qrisSales)}\n`
      + `${pad}Keluar  : ${formatRupiah(r.cashExpense)}\n${pad}Target  : ${formatRupiah(r.targetCash)}\n${pad}Fisik   : ${formatRupiah(r.actualCash)}\n`
      + `${pad}Selisih : ${formatRupiah(r.diff)}\n${pad}Cat     : ${r.note || '-'}\n\n\n\n`;
    if (this.char) {
      try { await this.sendBytes(new Uint8Array([0x1B, 0x40, 0x1B, 0x4D, 0x01, ...new TextEncoder().encode(txt), 0x1D, 0x56, 0x42, 0x00])); return; } catch (_) {}
    }
    const el = document.getElementById('thermalPrintContainer');
    el.innerHTML = `<pre style="margin:0;white-space:pre-wrap">${escapeHtml(txt)}</pre>`;
    window.print();
  },
  autoPrintOrder(o) {
    const c = this.getCfg();
    if (c.autoCashier && o.paymentStatus === 'LUNAS') this.printReceipt(o);
    if (c.autoDrawer && o.paymentStatus === 'LUNAS' && o.paymentMethod === 'Tunai') this.openDrawer(true);
    if (c.autoBarista) this.printBarista(o);
  },
  async openDrawer(silent = false) {
    if (!this.char) { if (!silent) showToast('Hubungkan printer BT dulu untuk laci RJ11', 'warn'); return; }
    try {
      await this.sendBytes(new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA, 0x1B, 0x70, 0x01, 0x19, 0xFA, 0x10, 0x14, 0x01, 0x00, 0x05]));
      if (!silent) showToast('Laci kasir dibuka', 'ok');
    } catch (_) { if (!silent) showToast('Gagal memicu laci', 'err'); }
  },
  testReceipt() {
    this.printReceipt({
      orderId: 'TES-001', timestamp: nowTimestampStr(), location: 'Meja 01', customerName: 'Tes Printer',
      items: [{ name: 'Es Kopi Susu', qty: 1, price: 18000 }], totalPrice: 18000, paymentMethod: 'Tunai', paymentStatus: 'LUNAS'
    });
  }
};

// ============================================================================
// 9. LIGHTWEIGHT TIMERS (ZERO 1s LOOP, ZERO 5s DOM REBUILD!) & BOOTSTRAP
// ============================================================================
let lastActivityMs = Date.now();
function startPollLoop() {
  if (pollTimerId) clearInterval(pollTimerId);
  let idleTicks = 0;
  pollTimerId = setInterval(async () => {
    if (!navigator.onLine) { SyncQueue.updateBadge(); return; }
    if (!SyncQueue.isFlushing) await SyncQueue.flush();
    if (SyncQueue.isFlushing || isFetching) return;
    const hasLive = appState.orders.some(o => o.status === 'MENUNGGU KONFIRMASI' || o.status === 'DIPROSES' || o.status === 'SIAP SAJI' || o.paymentStatus === 'OPEN TAB');
    const recentAct = (Date.now() - lastActivityMs) < 300000;
    if (!hasLive && !recentAct && !SyncQueue.outboxCache.length) {
      idleTicks = (idleTicks + 1) % 3;
      if (idleTicks !== 0) return;
    } else idleTicks = 0;
    fetchFromServer(false, false);
  }, POLL_INTERVAL_SEC * 1000);
}

// Ringan: hanya update textContent angka menit setiap 30 detik (tanpa hancurkan DOM!)
setInterval(() => {
  document.querySelectorAll('[data-elapsed-ms]').forEach(el => {
    const mins = elapsedMins(Number(el.getAttribute('data-elapsed-ms')));
    el.textContent = currentView === 'radar' ? formatDwell(mins) : `${mins}m`;
  });
}, 30000);

window.addEventListener('DOMContentLoaded', async () => {
  const mark = () => { lastActivityMs = Date.now(); };
  document.addEventListener('pointerdown', mark, { passive: true });
  document.addEventListener('keydown', mark, { passive: true });
  window.addEventListener('online', () => { SyncQueue.updateBadge(); SyncQueue.flush(); fetchFromServer(false, false); });
  window.addEventListener('offline', () => SyncQueue.updateBadge());

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(r => { if (navigator.onLine && r.update) r.update().catch(() => {}); }).catch(() => {});
  }

  await PosIDB.init();
  const idbMenu = await PosIDB.getAll('menu'); if (idbMenu.length) MENU_CATALOG = idbMenu.filter(m => m.is_available !== false);
  const idbOrd = await PosIDB.getAll('orders'); if (idbOrd.length) appState.orders = idbOrd;
  const idbKb = await PosIDB.getAll('piutang_aktif'); if (idbKb.length) appState.piutangAktif = idbKb;

  const mode = new URLSearchParams(location.search).get('mode');
  if (mode === 'kds' || mode === 'barista') switchView('kds');
  else if (mode === 'radar') switchView('radar');
  else renderAllActive();

  updateCrewUI();
  renderMemoBar();
  Printer.updatePill();
  await SyncQueue.updateBadge();
  if (navigator.onLine) {
    await SyncQueue.flush();
    fetchFromServer(false, true);
  }
  startPollLoop();
});
