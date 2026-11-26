/**
 * CAPTAIN COFFEE — BACKEND API v2.5 (Audit Fix: Settlement, Kasbon Cicilan, Otorisasi Pengeluaran)
 * Kompatibel dengan dashboard_operasional_kds_captain_coffee_v3.html dan pesan digital_v2.html.
 * Spreadsheet columns Pesanan_Masuk A:I tetap dipertahankan; kolom J untuk items_json.
 * Tab Audit_Log ditambahkan otomatis untuk jejak audit Void & perubahan kritis.
 * Jalankan setupBackend() sekali setelah memperbarui kode ini.
 */
const CFG = {
  TZ: 'Asia/Jakarta',
  ORDER_SHEET: 'Pesanan_Masuk',
  DEBT_SHEET: 'Buku_Piutang',
  DEBT_ARCHIVE_SHEET: 'Arsip_Piutang',
  MENU_SHEET: 'Menu',
  SETTINGS_SHEET: 'Pengaturan',
  AUDIT_SHEET: 'Audit_Log',
  ANNOUNCEMENT_SHEET: 'Pengumuman',
  EXPENSE_SHEET: 'Pengeluaran',
  CREW_SHEET: 'Kru',
  CREW_HEADERS: ['NO', 'ID_KRU', 'NAMA_KRU', 'PERAN', 'PIN', 'STATUS'],
  TABLE_SHEET: 'Meja',
  TABLE_HEADERS: ['NO', 'NAMA_MEJA', 'ZONA', 'DESKRIPSI_ZONA', 'TIPE', 'STATUS'],
  ORDER_ARCHIVE_SHEET: 'Arsip_Pesanan',
  EXPENSE_ARCHIVE_SHEET: 'Arsip_Pengeluaran',
  ACTIVE_WINDOW_DAYS: 35,
  ARCHIVE_AFTER_DAYS: 60,
  BACKUP_FOLDER_NAME: 'Backup Captain Coffee POS',
  EXPIRE_MINUTES: 15,
  DEBT_DUE_DAYS: 3,
  ORDER_HEADERS: ['timestamp','order_id','meja','nama','rincian','catatan','total','metode_bayar','status','items_json'],
  AUDIT_HEADERS: ['timestamp','order_id','actor','action','reason','total','detail'],
  EXPENSE_HEADERS: ['id_pengeluaran','timestamp','kategori','keterangan','nominal','sumber_dana','staff','catatan'],
  SETTLEMENT_SHEET: 'Settlement_Shift',
  SETTLEMENT_HEADERS: ['settlement_id','timestamp','staff','shift_mulai','shift_selesai','total_pemasukan','kas_tunai','qris','keluar_laci','keluar_nontunai','kasbon_shift','target_kas','kas_fisik','selisih','catatan','detail_json'],
  MAX_WEB_ITEMS: 40,
  MAX_ITEM_QTY: 99,
  WEB_ORDER_LIMIT_PER_TABLE: 8,   // maks pesanan web per meja ...
  WEB_ORDER_WINDOW_SEC: 120       // ... dalam jendela waktu ini
};

// Satu sumber versi API (ikut dikirim ke klien pada setiap respons GET)
const API_VERSION = '2.7';

/** Baca nomor versi data global (untuk fast-poll sinceVer nol-baca Spreadsheet saat data belum berubah). */
function getDataVersion_() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      return Number(PropertiesService.getScriptProperties().getProperty('CAPTAIN_DATA_VER')) || 1;
    }
  } catch (_) {}
  return 0;
}

/** Naikkan nomor versi data global setiap kali ada penulisan ke Spreadsheet. */
function bumpDataVersion_() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      const next = (Number(props.getProperty('CAPTAIN_DATA_VER')) || 1) + 1;
      props.setProperty('CAPTAIN_DATA_VER', String(next));
      return next;
    }
  } catch (_) {}
  return 0;
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action).toUpperCase() : '';
    const isFast = e && e.parameter && (e.parameter.fast === '1' || e.parameter.fast === 'true' || action === 'POLL' || action === 'GET_ORDERS_FAST');
    const curDataVer = getDataVersion_();

    // ULTRA-FAST POLL: bila sinceVer sama dengan versi data terakhir, balas <100 byte tanpa membuka Spreadsheet!
    if (isFast) {
      const sinceVer = Number(e && e.parameter && e.parameter.sinceVer) || 0;
      if (sinceVer > 0 && curDataVer > 0 && sinceVer === curDataVer) {
        return json_({
          status: 'success',
          fast: true,
          unchanged: true,
          dataVersion: curDataVer,
          serverTime: new Date().toISOString(),
          version: API_VERSION
        });
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // AUDIT DATA: Endpoint khusus aplikasi audit arus kas (wajib PIN Supervisor/Owner)
    if (action === 'AUDIT_DATA') {
      const params = (e && e.parameter) ? e.parameter : {};
      const auditor = requireSupervisorPin_(ss, params);
      const includeArchive = params.includeArchive === '1' || params.includeArchive === 'true';
      const auditLimit = Math.min(1000, Math.max(1, Number(params.limit) || 300));
      const settlementLimit = Math.min(500, Math.max(1, Number(params.settlementLimit) || 100));
      const activeOrders = readOrders_(ss, 0);
      const activeExpenses = readPengeluaran_(ss, 0);
      const orders = includeArchive
        ? mergeUniqueByKey_(readOrdersFromSheet_(ss.getSheetByName(CFG.ORDER_ARCHIVE_SHEET), 0), activeOrders, 'orderId')
        : activeOrders;
      const pengeluaran = includeArchive
        ? mergeUniqueByKey_(readPengeluaranFromSheet_(ss.getSheetByName(CFG.EXPENSE_ARCHIVE_SHEET), 0), activeExpenses, 'id')
        : activeExpenses;
      return json_({
        status: 'success',
        auditor: auditor.name,
        archiveIncluded: includeArchive,
        orders,
        pengeluaran,
        settlements: readSettlementHistory_(ss, settlementLimit),
        auditLog: readAuditLog_(ss, auditLimit),
        kasbon: readDebt_(ss, CFG.DEBT_SHEET, 'BELUM LUNAS', 0),
        arsip: readDebt_(ss, CFG.DEBT_ARCHIVE_SHEET, 'LUNAS', 0),
        lastSettlementMs: readLastSettlementMs_(ss),
        lastSync: Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy HH:mm:ss'),
        serverTime: new Date().toISOString(),
        version: API_VERSION
      });
    }

    // AMBIL SNAPSHOT DETAIL SETTLEMENT ON-DEMAND (1 baris saja, agar fast-poll tetap ultra-ringan)
    if (action === 'SETTLEMENT_DETAIL') {
      const sid = clean_(e && e.parameter && e.parameter.settlementId);
      if (!sid) throw new Error('settlementId wajib diisi');
      const detail = readSettlementDetailById_(ss, sid);
      return json_({
        status: 'success',
        settlementId: sid,
        detail: detail,
        version: API_VERSION
      });
    }

    // MUAT ARSIP LAMA: Dipanggil manual dari tab Riwayat saat mencari data >35 hari (termasuk Arsip_Pesanan & Arsip_Pengeluaran)
    if (action === 'GET_ARCHIVE_HISTORY') {
      const activeOrders = readOrders_(ss, 0);
      const archivedOrders = readOrdersFromSheet_(ss.getSheetByName(CFG.ORDER_ARCHIVE_SHEET), 0);
      const activeExpenses = readPengeluaran_(ss, 0);
      const archivedExpenses = readPengeluaranFromSheet_(ss.getSheetByName(CFG.EXPENSE_ARCHIVE_SHEET), 0);
      const arsipPiutang = readDebt_(ss, CFG.DEBT_ARCHIVE_SHEET, 'LUNAS', 0);
      return json_({
        status: 'success',
        archiveLoaded: true,
        orders: mergeUniqueByKey_(archivedOrders, activeOrders, 'orderId'),
        pengeluaran: mergeUniqueByKey_(archivedExpenses, activeExpenses, 'id'),
        arsip: arsipPiutang,
        lastSync: Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy HH:mm:ss'),
        serverTime: new Date().toISOString(),
        version: API_VERSION
      });
    }

    const loadAll = e && e.parameter && (e.parameter.all === '1' || e.parameter.all === 'true');
    const winDays = loadAll ? 0 : (Number(e && e.parameter && e.parameter.days) || CFG.ACTIVE_WINDOW_DAYS);
    const arsipDays = loadAll ? 0 : Math.max(winDays, 45);

    // OPTIMASI: FAST FETCH (Window 35 hari terakhir + seluruh tiket aktif/open tab/kasbon)
    if (isFast) {
      const orders = readOrders_(ss, winDays);
      const pengumuman = readPengumuman_(ss);
      const pengeluaran = readPengeluaran_(ss, winDays);
      const kru = readKru_(ss);
      return json_({
        status: 'success',
        fast: true,
        unchanged: false,
        dataVersion: curDataVer,
        windowDays: winDays,
        orders,
        kasbon: readDebt_(ss, CFG.DEBT_SHEET, 'BELUM LUNAS', 0),
        arsip: readDebt_(ss, CFG.DEBT_ARCHIVE_SHEET, 'LUNAS', arsipDays),
        pengumuman,
        pengeluaran,
        kru,
        tables: readTables_(ss),
        settlements: readSettlementHistory_(ss, 50),
        clearedTables: readClearedTables_(ss),
        lastSettlementMs: readLastSettlementMs_(ss),
        lastSync: Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy HH:mm:ss'),
        serverTime: new Date().toISOString(),
        version: API_VERSION
      });
    }

    // FULL FETCH: Startup & Refresh manual (tetap ter-optimasi dengan window 35 hari kecuali ?all=1)
    const settings = readSettings_(ss);
    // Jangan pernah mengirim PIN staf/void ke browser publik.
    delete settings.pin_void;
    delete settings.pin_staff;
    const orders = readOrders_(ss, winDays);
    const kasbon = readDebt_(ss, CFG.DEBT_SHEET, 'BELUM LUNAS', 0);
    const arsip = readDebt_(ss, CFG.DEBT_ARCHIVE_SHEET, 'LUNAS', arsipDays);
    const menu = readMenu_(ss);
    const pengumuman = readPengumuman_(ss);
    const pengeluaran = readPengeluaran_(ss, winDays);
    const kru = readKru_(ss);
    return json_({
      status: 'success',
      dataVersion: curDataVer,
      settings,
      orders,
      kasbon,
      arsip,
      menu,
      pengumuman,
      pengeluaran,
      kru,
      tables: readTables_(ss),
      settlements: readSettlementHistory_(ss, 50),
      clearedTables: readClearedTables_(ss),
      lastSettlementMs: readLastSettlementMs_(ss),
      lastSync: Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy HH:mm:ss'),
      serverTime: new Date().toISOString(),
      version: API_VERSION
    });
  } catch (err) {
    return json_({status:'error', message:String(err)});
  }
}

function dispatchAction_(ss, payload, reqCache) {
  const action = String(payload.action || (payload.order_id ? 'WEB_CUSTOMER_ORDER' : '')).toUpperCase();
  let result;
  switch (action) {
    case 'WEB_CUSTOMER_ORDER':
      result = handleWebCustomerOrder_(ss, payload);
      break;
    case 'CREATE_ORDER':
      requireStaffPin_(ss, payload, reqCache);
      result = createOrder_(ss, payload, action);
      break;
    case 'UPDATE_STATUS':
    case 'TOGGLE_ITEM_STATUS':
    case 'UPDATE_PAYMENT_METHOD':
      requireStaffPin_(ss, payload, reqCache);
      result = updateOrder_(ss, payload);
      break;
    case 'SETTLE_KASBON':
      requireStaffPin_(ss, payload, reqCache);
      result = settleDebt_(ss, payload);
      break;
    case 'VOID_ORDER':
    case 'DELETE_ORDER':
      result = voidOrder_(ss, payload, reqCache);
      break;
    case 'ADD_EXPENSE':
    case 'TAMBAH_PENGELUARAN':
      requireStaffPin_(ss, payload, reqCache);
      result = addExpense_(ss, payload);
      break;
    case 'DELETE_EXPENSE':
    case 'HAPUS_PENGELUARAN': {
      const sup = requireSupervisorPin_(ss, payload, reqCache);
      payload.staff = payload.staff || sup.name;
      result = deleteExpense_(ss, payload);
      break;
    }
    case 'SETTLEMENT_SHIFT':
      requireStaffPin_(ss, payload, reqCache);
      result = saveSettlement_(ss, payload);
      break;
    case 'PARTIAL_SETTLE_KASBON':
      requireStaffPin_(ss, payload, reqCache);
      result = partialSettleDebt_(ss, payload);
      break;
    case 'CLEAR_TABLE':
      requireStaffPin_(ss, payload, reqCache);
      result = logClearTable_(ss, payload);
      break;
    case 'SETUP_BACKEND':
      result = { message: setupBackend() };
      break;
    default:
      throw new Error('Aksi tidak dikenali: ' + action);
  }
  return { action, result };
}

function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Payload kosong');
    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || (payload.order_id ? 'WEB_CUSTOMER_ORDER' : '')).toUpperCase();
    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reqCache = {};

    if (action === 'BATCH_SYNC') {
      const batchItems = Array.isArray(payload.items) ? payload.items.slice(0, 25) : [];
      const results = [];
      for (let i = 0; i < batchItems.length; i++) {
        const entry = batchItems[i] || {};
        const subPayload = entry.payload || entry;
        const queueId = entry.queueId !== undefined ? entry.queueId : i;
        try {
          const out = dispatchAction_(ss, subPayload, reqCache);
          const itemRes = out.result || {};
          // Handler seperti voidOrder_/updateOrder_ bisa mengembalikan status logis ('wrong_pin' / 'not_found')
          const resStatus = itemRes.status || 'success';
          results.push(Object.assign({ queueId, action: out.action, status: resStatus }, itemRes));
        } catch (itemErr) {
          const msg = String(itemErr && itemErr.message ? itemErr.message : itemErr);
          const isPinErr = /pin staf salah|otorisasi gagal|pin supervisor/i.test(msg);
          results.push({
            queueId,
            action: String(subPayload.action || '').toUpperCase(),
            status: isPinErr ? 'wrong_pin' : 'error',
            message: msg
          });
        }
      }
      if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
      const nextVer = bumpDataVersion_();
      return json_({ status: 'success', action: 'BATCH_SYNC', requestId: payload.requestId || '', dataVersion: nextVer, results });
    }

    const single = dispatchAction_(ss, payload, reqCache);
    if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
    const nextVer = bumpDataVersion_();
    return json_(Object.assign({ status: 'success', action: single.action, requestId: payload.requestId || '', dataVersion: nextVer }, single.result || {}));
  } catch (err) {
    return json_({status:'error', message:String(err), requestId:(e && e.postData && e.postData.contents) ? safeRequestId_(e.postData.contents) : ''});
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

/**
 * P1: Handler khusus pesanan web pelanggan dengan validasi ketat
 */
function handleWebCustomerOrder_(ss, p) {
  const settings = readSettings_(ss);
  if (settings.is_open === false) {
    throw new Error('Kedai saat ini sedang tutup. Pemesanan tidak dapat diproses.');
  }
  // Validasi server-side: batasi spam & pastikan total tidak di bawah harga menu
  rateLimitWebOrder_(p);
  validateWebOrder_(ss, p);
  // Paksa status awal web order selalu MENUNGGU KONFIRMASI
  p.status = 'MENUNGGU KONFIRMASI';
  // Metode bayar hanya boleh TUNAI atau QRIS dari web order
  const rawMethod = clean_(p.payment_method || p.metodeBayar || 'TUNAI').toUpperCase();
  p.metodeBayar = (rawMethod === 'QRIS') ? 'QRIS' : 'TUNAI';

  return createOrder_(ss, p, 'WEB_CUSTOMER_ORDER');
}

/**
 * P1, P2, P5: Pembuatan pesanan dengan verifikasi konflik ID & data
 */
function createOrder_(ss, p, action) {
  const sh = requiredSheet_(ss, CFG.ORDER_SHEET);
  ensureItemsColumn_(sh);
  const orderId = clean_(p.orderId || p.order_id || makeOrderId_());
  if (!orderId) throw new Error('orderId wajib diisi');

  const meja = clean_(p.meja || p.table || 'Meja 01');
  const nama = clean_(p.nama || p.customer_name || 'Pelanggan');
  const rincian = clean_(p.rincian || p.items_summary || '-');
  let catatan = clean_(p.catatan || p.notes || '-');
  const totalRaw = p.total !== undefined ? p.total : p.total_price;
  const total = Number(totalRaw);
  if (!Number.isFinite(total) || total < 0) throw new Error('Total pesanan tidak valid');

  // P5: Periksa idempotensi & konflik Order ID
  const existingRow = findRowById_(sh, 2, orderId);
  if (existingRow) {
    const rowVals = sh.getRange(existingRow, 1, 1, 10).getValues()[0];
    const existingTotal = Number(rowVals[6]) || 0;
    const existingMeja = String(rowVals[2] || '');
    // Bila Order ID sama dan data total/meja sama -> anggap retry sukses idempoten
    if (Math.abs(existingTotal - total) < 1 && existingMeja.toLowerCase() === meja.toLowerCase()) {
      return {orderId, duplicate:true, rowIndex:existingRow};
    } else {
      // Konflik acak -> tolak agar tidak menimpa transaksi orang lain
      throw new Error('Konflik Order ID (' + orderId + '): ID ini sudah digunakan oleh transaksi lain (' + existingMeja + ', Rp ' + existingTotal + ').');
    }
  }

  const rawMethod = clean_(p.metodeBayar || p.payment_method || 'TUNAI');
  const isOpenTab = rawMethod.toUpperCase() === 'OPEN TAB';
  if (isOpenTab && !catatan.includes('[OPEN TAB]')) {
    catatan = catatan === '-' ? '[OPEN TAB]' : '[OPEN TAB] ' + catatan;
  }
  const method = normalizeMethod_(rawMethod);
  const status = normalizeStatus_(p.status || (action === 'WEB_CUSTOMER_ORDER' ? 'MENUNGGU KONFIRMASI' : 'DIPROSES'));
  const items = parseItems_(p.items_json || p.items || null);
  const now = new Date();
  const settledMs = (p.settledAtMs && Number(p.settledAtMs) > 0) ? Number(p.settledAtMs) : ((!isOpenTab && method !== 'Kasbon' && status !== 'MENUNGGU KONFIRMASI' && status !== 'BATAL' && status !== 'KADALUARSA') ? now.getTime() : 0);
  const row = [now, orderId, meja, nama, rincian, catatan || '-', total, method, status, JSON.stringify(items), settledMs];
  const rowIndex = insertFirstEmpty_(sh, 2, row);

  if (method === 'Kasbon' && status !== 'BATAL' && status !== 'KADALUARSA') {
    upsertDebt_(ss, orderId, now, nama, rincian, total);
  }
  return {orderId, rowIndex, duplicate:false};
}

/**
 * P2: Validasi transisi status produksi & pembayaran
 */
function updateOrder_(ss, p) {
  const sh = requiredSheet_(ss, CFG.ORDER_SHEET);
  const id = clean_(p.orderId || p.order_id);
  if (!id) throw new Error('orderId wajib diisi');
  const row = findRowById_(sh, 2, id);
  if (!row) return {status:'not_found', orderId:id};

  const values = sh.getRange(row, 1, 1, Math.max(11, sh.getLastColumn())).getValues()[0];
  const currentStatus = String(values[8] || '').trim().toUpperCase();

  // Validasi newStatus harus ada jika dikirim
  const statusProvided = (p.newStatus !== undefined && p.newStatus !== null && String(p.newStatus).trim() !== '') ||
                         (p.status !== undefined && p.status !== null && String(p.status).trim() !== '');
  let status = currentStatus;

  if (statusProvided) {
    status = normalizeStatus_(p.newStatus || p.status);

    // State machine guard:
    let skipStatusWrite = false;
    if (currentStatus === 'BATAL' || currentStatus === 'KADALUARSA') {
      if (status !== currentStatus) {
        if (p.staleSafe) {
          status = currentStatus;
          skipStatusWrite = true;
        } else {
          throw new Error('Pesanan #' + id + ' sudah berstatus ' + currentStatus + ' dan tidak dapat diubah kembali.');
        }
      }
    }
    if (currentStatus === 'SELESAI' && status !== 'SELESAI') {
      if (status === 'BATAL') {
        throw new Error('Pesanan #' + id + ' sudah SELESAI. Pembatalan wajib lewat fitur Void (PIN Supervisor).');
      }
      if (p.staleSafe) {
        status = currentStatus;
        skipStatusWrite = true;
      } else {
        throw new Error('Pesanan #' + id + ' sudah SELESAI dan tidak dapat dikembalikan ke ' + status + '.');
      }
    }
    if (!skipStatusWrite) {
      sh.getRange(row, 9).setValue(status);
    }
    if (status === 'BATAL' && currentStatus !== 'BATAL') {
      logAudit_(ss, {
        timestamp: new Date(),
        order_id: id,
        actor: clean_(p.actor || p.staff || 'Staf'),
        action: 'BATAL_STATUS',
        reason: clean_(p.catatan || p.reason || 'Dibatalkan via UPDATE_STATUS'),
        total: Number(values[6]) || 0,
        detail: 'Status diubah dari ' + currentStatus + ' menjadi BATAL'
      });
    }
  }

  const currentNote = String(values[5] || '-');
  const methodProvided = p.metodeBayar !== undefined && p.metodeBayar !== null && String(p.metodeBayar).trim() !== '';
  let method = normalizeMethod_(values[7]);
  let note = currentNote;

  if (methodProvided) {
    const raw = clean_(p.metodeBayar);
    const openTab = raw.toUpperCase() === 'OPEN TAB';
    method = normalizeMethod_(raw);
    if (openTab) note = note.includes('[OPEN TAB]') ? note : (note === '-' ? '[OPEN TAB]' : '[OPEN TAB] ' + note);
    else note = note.replace(/\[OPEN TAB\]/g, '').trim() || '-';
    sh.getRange(row, 8).setValue(method);
    sh.getRange(row, 6).setValue(note);
    if (!openTab && method !== 'Kasbon') {
      ensureItemsColumn_(sh);
      const curSettled = Number(values[10]) || 0;
      const newSettled = Number(p.settledAtMs) || curSettled || Date.now();
      sh.getRange(row, 11).setValue(newSettled);
    }
  } else if (p.settledAtMs && Number(p.settledAtMs) > 0) {
    ensureItemsColumn_(sh);
    sh.getRange(row, 11).setValue(Number(p.settledAtMs));
  }

  if (status === 'BATAL' || status === 'KADALUARSA') {
    removeDebtById_(ss, id);
  } else if (method === 'Kasbon') {
    upsertDebt_(ss, id, values[0] || new Date(), values[3], values[4], Number(values[6]) || 0);
  } else if (methodProvided && method !== 'Kasbon') {
    removeDebtById_(ss, id);
  }

  // FASE 3: Simpan progres status per item ke kolom 10 jika disertakan
  if (p.items_json !== undefined && p.items_json !== null) {
    ensureItemsColumn_(sh);
    sh.getRange(row, 10).setValue(String(p.items_json));
  }

  return {orderId:id, newStatus:status, metodeBayar:method};
}

/**
 * P4: Otorisasi Void dengan pin_void khusus manajer + jejak Audit_Log
 */
function voidOrder_(ss, p, reqCache) {
  const id = clean_(p.orderId || p.order_id);
  const inputPin = clean_(p.pin || p.void_pin);
  const reason = clean_(p.reason || p.catatan || 'Void otorisasi manajer');
  const settings = (reqCache && reqCache.settings) ? reqCache.settings : readSettings_(ss);
  if (reqCache && !reqCache.settings) reqCache.settings = settings;
  const pin = String(settings.pin_void || '').trim();

  let isAuthorized = false;
  let supervisorName = clean_(p.actor || 'Supervisor');
  if (pin && inputPin === pin) {
    isAuthorized = true;
  } else {
    // Periksa apakah PIN cocok dengan Supervisor mana pun di tab Kru
    const kruList = (reqCache && reqCache.kruList) ? reqCache.kruList : readKru_(ss);
    if (reqCache && !reqCache.kruList) reqCache.kruList = kruList;
    const supervisor = kruList.find(k => k.peran && k.peran.toLowerCase().includes('supervisor') && String(k.pin).trim() === inputPin);
    if (supervisor) {
      isAuthorized = true;
      supervisorName = supervisor.nama + ' (Supervisor)';
    }
  }

  if (!isAuthorized) return {status:'wrong_pin', message:'PIN Otorisasi Void Salah atau bukan Supervisor'};

  const orderSheet = requiredSheet_(ss, CFG.ORDER_SHEET);
  const row = findRowById_(orderSheet, 2, id);
  if (!row) return {status:'not_found', orderId:id};

  const vals = orderSheet.getRange(row, 1, 1, 10).getValues()[0];
  const oldStatus = vals[8];
  orderSheet.getRange(row, 9).setValue('BATAL');

  // Hapus dari tagihan aktif piutang jika ada
  removeDebtById_(ss, id);

  // Catat ke tab Audit_Log
  logAudit_(ss, {
    timestamp: new Date(),
    order_id: id,
    actor: supervisorName || clean_(p.actor || 'Supervisor'),
    action: 'VOID_ORDER',
    reason: reason,
    total: Number(vals[6]) || 0,
    detail: 'Status diubah dari ' + oldStatus + ' menjadi BATAL'
  });

  return {orderId:id, voided:true, oldStatus:oldStatus, newStatus:'BATAL'};
}

function settleDebt_(ss, p) {
  const active = requiredSheet_(ss, CFG.DEBT_SHEET);
  const archive = requiredSheet_(ss, CFG.DEBT_ARCHIVE_SHEET);
  const id = clean_(p.orderId || p.order_id);
  if (!id) throw new Error('orderId wajib diisi');
  const row = findRowById_(active, 1, id);
  if (!row) {
    const archivedRow = findRowById_(archive, 1, id);
    return archivedRow ? {orderId:id, alreadySettled:true} : {status:'not_found', orderId:id};
  }
  const vals = active.getRange(row, 1, 1, Math.max(9, active.getLastColumn())).getValues()[0].slice(0,9);
  vals[6] = 'LUNAS'; vals[7] = new Date(); vals[8] = normalizeMethod_(p.metodePelunasan || 'TUNAI');
  if (!findRowById_(archive, 1, id)) insertFirstEmpty_(archive, 1, vals);
  active.getRange(row, 1, 1, 9).clearContent();
  const orderRow = findRowById_(requiredSheet_(ss, CFG.ORDER_SHEET), 2, id);
  if (orderRow) {
    const orderSheet = requiredSheet_(ss, CFG.ORDER_SHEET);
    orderSheet.getRange(orderRow, 8).setValue(vals[8]);
    orderSheet.getRange(orderRow, 6).setValue(String(orderSheet.getRange(orderRow,6).getValue() || '-').replace(/\[OPEN TAB\]/g,'').trim() || '-');
    ensureItemsColumn_(orderSheet);
    orderSheet.getRange(orderRow, 11).setValue(vals[7].getTime());
    if (String(orderSheet.getRange(orderRow,9).getValue()).toUpperCase() !== 'BATAL') orderSheet.getRange(orderRow,9).setValue('SELESAI');
  }
  return {orderId:id, settled:true};
}

function requireStaffPin_(ss, p, reqCache) {
  const inputPin = clean_(p.staff_pin || p.pin);
  const settings = (reqCache && reqCache.settings) ? reqCache.settings : readSettings_(ss);
  if (reqCache && !reqCache.settings) reqCache.settings = settings;
  const expected = String(settings.pin_staff || '').trim();
  if (expected && inputPin === expected) return true;

  // Cek apakah pin cocok dengan kru mana pun yang aktif
  const kruList = (reqCache && reqCache.kruList) ? reqCache.kruList : readKru_(ss);
  if (reqCache && !reqCache.kruList) reqCache.kruList = kruList;
  const staff = kruList.find(k => String(k.pin).trim() === inputPin);
  if (staff) return true;

  if (!expected && kruList.length === 0) return true;
  throw new Error('PIN staf salah atau otorisasi gagal');
}

// ---------- GET/read helpers ----------
function readSettings_(ss) {
  const sh=ss.getSheetByName(CFG.SETTINGS_SHEET), data=sh?sh.getDataRange().getValues():[];
  const out={is_open:true,whatsapp_number:'628983610492',announcement:'',total_tables:11};
  data.slice(1).forEach(r=>{ const k=String(r[0]||'').trim().toLowerCase(),v=r[1]; if(!k)return;
    if(k==='is_open') out.is_open=(v===true||String(v).toLowerCase()==='true'||String(v)==='1');
    if(k==='whatsapp_number') out.whatsapp_number=String(v||out.whatsapp_number).trim();
    if(k==='announcement') out.announcement=String(v||'').trim();
    if(k==='total_tables') out.total_tables=Number(v)||11;
    if(k==='pin_void') out.pin_void=String(v||'').trim();
    if(k==='pin_staff') out.pin_staff=String(v||'').trim();
  }); return out;
}

function readOrders_(ss, maxDays) {
  return readOrdersFromSheet_(ss.getSheetByName(CFG.ORDER_SHEET), maxDays);
}

function readOrdersFromSheet_(sh, maxDays) {
  if (!sh) return [];
  const d = sh.getDataRange().getValues(), out = [];
  const cutoffMs = (maxDays && Number(maxDays) > 0) ? (Date.now() - Number(maxDays) * 86400000) : 0;
  for (let i = 1; i < d.length; i++) {
    const r = d[i];
    if (!r[1]) continue;
    const createdAtMs = dateMillis_(r[0]);
    const settledAtMs = Number(r[10]) || 0;
    const catatan = String(r[5] || '-');
    const metode = String(r[7] || 'TUNAI').trim();
    const st = normalizeStatus_(r[8]);

    if (cutoffMs > 0) {
      const isStillOpen = st === 'MENUNGGU KONFIRMASI' || st === 'DIPROSES' || st === 'SIAP SAJI' ||
        metode.toUpperCase() === 'OPEN TAB' || catatan.includes('[OPEN TAB]') || metode.toUpperCase() === 'KASBON';
      const recentEnough = Math.max(createdAtMs || 0, settledAtMs || 0) >= cutoffMs;
      if (!isStillOpen && !recentEnough) continue;
    }

    let items = [];
    try { items = JSON.parse(String(r[9] || '[]')); } catch (_) { items = []; }
    out.push({
      rowIndex: i + 1,
      timestamp: formatDate_(r[0], 'dd/MM/yyyy HH:mm'),
      createdAtMs,
      orderId: String(r[1]).trim(),
      meja: String(r[2] || '-'),
      nama: String(r[3] || 'Pelanggan'),
      rincian: String(r[4] || '-'),
      catatan,
      total: Number(r[6]) || 0,
      metodeBayar: metode,
      status: st,
      settledAtMs,
      items
    });
  }
  return out;
}

function readDebt_(ss, name, fallback, maxDays) {
  const sh = ss.getSheetByName(name); if (!sh) return [];
  const d = sh.getDataRange().getValues(), out = [];
  const cutoffMs = (maxDays && Number(maxDays) > 0) ? (Date.now() - Number(maxDays) * 86400000) : 0;
  for (let i = 1; i < d.length; i++) {
    const r = d[i]; if (!r[0]) continue;
    const tglLunasMs = dateMillis_(r[7]);
    const createdMs = dateMillis_(r[1]);
    if (cutoffMs > 0 && Math.max(tglLunasMs || 0, createdMs || 0) < cutoffMs) continue;
    out.push({rowIndex:i+1,orderId:String(r[0]).trim(),tanggal:formatDate_(r[1],'dd/MM/yyyy HH:mm'),nama:String(r[2]||'-'),rincian:String(r[3]||'-'),total:Number(r[4])||0,jatuhTempo:formatDate_(r[5],'dd/MM/yyyy'),statusBayar:String(r[6]||fallback).toUpperCase(),tglLunas:formatDate_(r[7],'dd/MM/yyyy HH:mm'),tglLunasMs,metodePelunasan:String(r[8]||'-')});
  }
  return out;
}

function mergeUniqueByKey_(olderList, newerList, key) {
  const map = {};
  (olderList || []).forEach(it => { if (it && it[key]) map[String(it[key])] = it; });
  (newerList || []).forEach(it => { if (it && it[key]) map[String(it[key])] = it; });
  return Object.keys(map).map(k => map[k]);
}

function readMenu_(ss) {
  const sh=ss.getSheetByName(CFG.MENU_SHEET); if(!sh)return[]; const d=sh.getDataRange().getValues(),out=[];
  for(let i=1;i<d.length;i++){const r=d[i];if(!r[0]||!r[1])continue;let opts={};try{opts=r[9]?JSON.parse(String(r[9])):{};}catch(_){opts={};}
    out.push({id:String(r[0]).trim(),name:String(r[1]).trim(),price:Number(r[2])||0,category:String(r[3]||'Lainnya'),mainTab:String(r[4]||'minuman').toLowerCase(),badge:String(r[5]||''),is_available:r[6]===true||String(r[6]).toLowerCase()==='true',image:String(r[7]||''),description:String(r[8]||''),options:opts,defaultMod:'Regular'});
  }return out;
}

function readPengumuman_(ss) {
  const sh = ss.getSheetByName(CFG.ANNOUNCEMENT_SHEET || 'Pengumuman');
  if (!sh) return [];
  const d = sh.getDataRange().getValues(), out = [];
  if (d.length <= 1) return [];

  const headers = d[0].map(function(h) { return String(h).trim().toUpperCase(); });
  const idxJudul = headers.indexOf('JUDUL');
  let idxPesan = headers.indexOf('ISI_PESAN');
  if (idxPesan === -1) idxPesan = headers.indexOf('PESAN');
  const idxWaktu = headers.indexOf('WAKTU');
  const idxStatus = headers.indexOf('STATUS');

  for (let i = 1; i < d.length; i++) {
    const r = d[i];
    const rawStatus = idxStatus !== -1 ? r[idxStatus] : true;
    const isChecked = rawStatus === true || String(rawStatus).trim().toUpperCase() === 'TRUE' || String(rawStatus).trim().toUpperCase() === 'AKTIF' || String(rawStatus).trim().toUpperCase() === 'YA' || String(rawStatus).trim() === '1';
    const judulVal = idxJudul !== -1 ? String(r[idxJudul]).trim() : '';
    const pesanVal = idxPesan !== -1 ? String(r[idxPesan]).trim() : '';
    const waktuVal = idxWaktu !== -1 ? String(r[idxWaktu]).trim() : 'Semua';

    if (isChecked && (judulVal || pesanVal)) {
      out.push({
        judul: judulVal,
        pesan: pesanVal,
        waktu: waktuVal,
        status: 'AKTIF'
      });
    }
  }
  return out;
}

// ---------- Sheet safety / normalization ----------
function setupBackend() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const order=requiredSheet_(ss,CFG.ORDER_SHEET);
  if(order.getLastColumn()<10) order.getRange(1,10).setValue('items_json');
  [CFG.DEBT_SHEET,CFG.DEBT_ARCHIVE_SHEET].forEach(n=>requiredSheet_(ss,n));

  // Buat tab Pengumuman jika belum ada
  let annSh = ss.getSheetByName(CFG.ANNOUNCEMENT_SHEET || 'Pengumuman');
  if (!annSh) {
    annSh = ss.insertSheet(CFG.ANNOUNCEMENT_SHEET || 'Pengumuman');
    annSh.getRange(1, 1, 1, 5).setValues([['NO', 'JUDUL', 'ISI_PESAN', 'WAKTU', 'STATUS']]);
    annSh.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  // Buat tab Audit_Log jika belum ada
  let auditSh = ss.getSheetByName(CFG.AUDIT_SHEET);
  if (!auditSh) {
    auditSh = ss.insertSheet(CFG.AUDIT_SHEET);
    auditSh.getRange(1, 1, 1, CFG.AUDIT_HEADERS.length).setValues([CFG.AUDIT_HEADERS]);
    auditSh.getRange(1, 1, 1, CFG.AUDIT_HEADERS.length).setFontWeight('bold');
  }

  // Buat tab Pengeluaran jika belum ada
  let expSh = ss.getSheetByName(CFG.EXPENSE_SHEET || 'Pengeluaran');
  if (!expSh) {
    expSh = ss.insertSheet(CFG.EXPENSE_SHEET || 'Pengeluaran');
    expSh.getRange(1, 1, 1, CFG.EXPENSE_HEADERS.length).setValues([CFG.EXPENSE_HEADERS]);
    expSh.getRange(1, 1, 1, CFG.EXPENSE_HEADERS.length).setFontWeight('bold');
  }

  // Buat tab Settlement_Shift jika belum ada
  ensureSettlementSheet_(ss);

  // Buat tab Kru jika belum ada
  let crewSh = ss.getSheetByName(CFG.CREW_SHEET || 'Kru') || ss.getSheetByName('Crew') || ss.getSheetByName('Pembagian Crew') || ss.getSheetByName('Data_Kru');
  if (!crewSh) {
    crewSh = ss.insertSheet(CFG.CREW_SHEET || 'Kru');
    crewSh.getRange(1, 1, 1, CFG.CREW_HEADERS.length).setValues([CFG.CREW_HEADERS]);
    crewSh.getRange(1, 1, 1, CFG.CREW_HEADERS.length).setFontWeight('bold');
    crewSh.getRange(2, 1, 3, CFG.CREW_HEADERS.length).setValues([
      [1, 'CRW-001', 'Supervisor / Owner', 'Supervisor', '8899', 'AKTIF'],
      [2, 'CRW-002', 'Dimas', 'Kasir', '1234', 'AKTIF'],
      [3, 'CRW-003', 'Aga', 'Barista', '5678', 'AKTIF']
    ]);
  }

  // Buat tab Meja jika belum ada (konfigurasi nama meja & zona untuk POS/Radar)
  let tableSh = ss.getSheetByName(CFG.TABLE_SHEET || 'Meja');
  if (!tableSh) {
    tableSh = ss.insertSheet(CFG.TABLE_SHEET || 'Meja');
    tableSh.getRange(1, 1, 1, CFG.TABLE_HEADERS.length).setValues([CFG.TABLE_HEADERS]);
    tableSh.getRange(1, 1, 1, CFG.TABLE_HEADERS.length).setFontWeight('bold');
    const z1 = '🛋️ Zona Indoor & Main Hall';
    const d1 = 'Area ber-AC dekat bar utama & kasir';
    const z2 = '🌿 Zona Outdoor, Chill & Bar';
    const d2 = 'Area terbuka, smoking lounge, kursi bar & pesanan bungkus';
    const defaultTables = [
      [1, 'Meja 01', z1, d1, 'MEJA', 'AKTIF'],
      [2, 'Meja 02', z1, d1, 'MEJA', 'AKTIF'],
      [3, 'Meja 03', z1, d1, 'MEJA', 'AKTIF'],
      [4, 'Meja 04', z1, d1, 'MEJA', 'AKTIF'],
      [5, 'Meja 05', z1, d1, 'MEJA', 'AKTIF'],
      [6, 'Meja 06', z1, d1, 'MEJA', 'AKTIF'],
      [7, 'Meja 07', z2, d2, 'MEJA', 'AKTIF'],
      [8, 'Meja 08', z2, d2, 'MEJA', 'AKTIF'],
      [9, 'Meja 09', z2, d2, 'MEJA', 'AKTIF'],
      [10, 'Meja 10', z2, d2, 'MEJA', 'AKTIF'],
      [11, 'Meja 11', z2, d2, 'MEJA', 'AKTIF'],
      [12, 'Area Bar', z2, d2, 'BAR', 'AKTIF'],
      [13, 'Takeaway', z2, d2, 'TAKEAWAY', 'AKTIF']
    ];
    tableSh.getRange(2, 1, defaultTables.length, CFG.TABLE_HEADERS.length).setValues(defaultTables);
  }

  // Pastikan tab Arsip_Pesanan & Arsip_Pengeluaran siap (untuk pengarsipan otomatis >60 hari)
  ensureOrderArchiveSheet_(ss);
  ensureExpenseArchiveSheet_(ss);

  // Pasang trigger berkala satu kali; aman dijalankan ulang.
  if (typeof ScriptApp !== 'undefined' && typeof ScriptApp.getProjectTriggers === 'function') {
    ScriptApp.getProjectTriggers()
      .filter(t => ['autoExpireOrders', 'archiveOldRecords_', 'monthlyBackupToDrive_'].includes(t.getHandlerFunction()))
      .forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('autoExpireOrders').timeBased().everyMinutes(5).create();
    ScriptApp.newTrigger('archiveOldRecords_').timeBased().atHour(5).nearMinute(15).everyDays(1).create();
    ScriptApp.newTrigger('monthlyBackupToDrive_').timeBased().onMonthDay(1).atHour(5).nearMinute(30).create();
  }
  return 'Setup v' + API_VERSION + ' selesai. Tab arsip >60 hari siap; trigger autoExpireOrders, archiveOldRecords_ (05:15 WIB) & monthlyBackupToDrive_ (tgl 1 05:30 WIB) aktif.';
}

function autoExpireOrders() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return;
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.ORDER_SHEET); if (!sh) return;
    const last = sh.getLastRow(); if (last < 2) return;
    // Optimasi bottom-up: cukup periksa maksimal 500 baris terbaru
    const startRow = Math.max(2, last - 499);
    const d = sh.getRange(startRow, 1, last - startRow + 1, 9).getValues(), now = Date.now();
    for (let i = 0; i < d.length; i++) {
      if (!d[i][1]) continue;
      const s = String(d[i][8] || '').trim().toUpperCase();
      if (s !== 'MENUNGGU KONFIRMASI' && s !== 'MENUNGGU') continue;
      const ms = dateMillis_(d[i][0]);
      if (ms && now - ms >= CFG.EXPIRE_MINUTES * 60000) { sh.getRange(startRow + i, 9).setValue('KADALUARSA'); bumpDataVersion_(); }
    }
  } finally { lock.releaseLock(); }
}

function onEdit(e) {
  if(!e||!e.range||e.range.getNumRows()!==1||e.range.getNumColumns()!==1||e.range.getRow()<=1)return;
  const sh=e.range.getSheet(), name=sh.getName(), row=e.range.getRow(), col=e.range.getColumn();
  const lock=LockService.getScriptLock(); if(!lock.tryLock(15000))return;
  try { bumpDataVersion_(); const ss=SpreadsheetApp.getActiveSpreadsheet(), value=String(e.range.getValue()||'').trim().toUpperCase();
    if(name===CFG.ORDER_SHEET && col===8 && value==='KASBON'){
      const r=sh.getRange(row,1,1,10).getValues()[0]; if(r[1])upsertDebt_(ss,String(r[1]),r[0]||new Date(),r[3],r[4],Number(r[6])||0);
    }
    if(name===CFG.DEBT_SHEET && col===7 && value==='LUNAS'){
      const active=requiredSheet_(ss,CFG.DEBT_SHEET),archive=requiredSheet_(ss,CFG.DEBT_ARCHIVE_SHEET);
      const r=active.getRange(row,1,1,9).getValues()[0]; if(!r[0])return;
      r[7]=new Date(); if(!r[8]||r[8]==='-')r[8]='TUNAI';
      if(!findRowById_(archive,1,String(r[0])))insertFirstEmpty_(archive,1,r);
      active.getRange(row,1,1,9).clearContent();
    }
  } finally {lock.releaseLock();}
}

/**
 * P3: Tidak menimpa jatuh tempo / metode asli saat baris kasbon sudah ada
 */
function upsertDebt_(ss,id,date,name,detail,total) {
  const sh=requiredSheet_(ss,CFG.DEBT_SHEET), row=findRowById_(sh,1,id);
  if (row) {
    const existing = sh.getRange(row, 1, 1, 9).getValues()[0];
    const origDate = existing[1] || date || new Date();
    const origDue = existing[5] || new Date(Date.now() + CFG.DEBT_DUE_DAYS * 86400000);
    const origMethod = existing[8] || 'QRIS';
    sh.getRange(row, 1, 1, 9).setValues([[id, origDate, name || existing[2], detail || existing[3], Number(total) || existing[4], origDue, 'BELUM LUNAS', '-', origMethod]]);
  } else {
    const due=new Date(Date.now()+CFG.DEBT_DUE_DAYS*86400000);
    const values=[id,date||new Date(),name||'Pelanggan',detail||'-',Number(total)||0,due,'BELUM LUNAS','-','QRIS'];
    insertFirstEmpty_(sh,1,values);
  }
}

function removeDebtById_(ss,id) {
  const sh=ss.getSheetByName(CFG.DEBT_SHEET);
  if(!sh)return;
  const r=findRowById_(sh,1,id);
  if(r)sh.getRange(r,1,1,9).clearContent();
}

function logAudit_(ss, entry) {
  try {
    let auditSh = ss.getSheetByName(CFG.AUDIT_SHEET);
    if (!auditSh) {
      auditSh = ss.insertSheet(CFG.AUDIT_SHEET);
      auditSh.getRange(1, 1, 1, CFG.AUDIT_HEADERS.length).setValues([CFG.AUDIT_HEADERS]);
    }
    const row = [
      entry.timestamp || new Date(),
      entry.order_id || '-',
      entry.actor || 'Staf',
      entry.action || '-',
      entry.reason || '-',
      Number(entry.total) || 0,
      entry.detail || '-'
    ];
    insertFirstEmpty_(auditSh, 1, row);
  } catch (err) {
    console.warn('Gagal mencatat audit log:', err);
  }
}

function insertFirstEmpty_(sh,idCol,values) {
  const last=Math.max(sh.getLastRow(),1); const ids=last>1?sh.getRange(2,idCol,last-1,1).getDisplayValues():[]; let target=last+1;
  for(let i=0;i<ids.length;i++)if(!String(ids[i][0]).trim()){target=i+2;break;}
  sh.getRange(target,1,1,values.length).setValues([values]); return target;
}

function findRowById_(sh, col, id) {
  if (!sh || !id) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const target = String(id).trim();
  const tailSize = 500;
  const tailStart = Math.max(2, last - tailSize + 1);
  const tailVals = sh.getRange(tailStart, col, last - tailStart + 1, 1).getDisplayValues();
  for (let i = tailVals.length - 1; i >= 0; i--) {
    if (String(tailVals[i][0]).trim() === target) return tailStart + i;
  }
  if (tailStart > 2) {
    const headVals = sh.getRange(2, col, tailStart - 2, 1).getDisplayValues();
    for (let i = headVals.length - 1; i >= 0; i--) {
      if (String(headVals[i][0]).trim() === target) return 2 + i;
    }
  }
  return 0;
}

function requiredSheet_(ss,name){
  const sh=ss.getSheetByName(name);
  if(!sh)throw new Error('Tab '+name+' tidak ditemukan');
  return sh;
}

function ensureItemsColumn_(sh){
  if(sh.getMaxColumns()<11)sh.insertColumnsAfter(sh.getMaxColumns(),11-sh.getMaxColumns());
  if(!sh.getRange(1,10).getValue())sh.getRange(1,10).setValue('items_json');
  if(!sh.getRange(1,11).getValue())sh.getRange(1,11).setValue('settled_at_ms');
}

function normalizeMethod_(v){
  const m=String(v||'').trim().toUpperCase();
  if(m==='QRIS')return'QRIS';
  if(m==='TRANSFER')return'Transfer';
  if(m==='KASBON')return'Kasbon';
  return'TUNAI';
}

function normalizeStatus_(v){
  const s=String(v||'').trim().toUpperCase();
  if (['MENUNGGU','MENUNGGU KONFIRMASI'].includes(s)) return 'MENUNGGU KONFIRMASI';
  if (['DIPROSES','SIAP SAJI','SELESAI','BATAL','KADALUARSA'].includes(s)) return s;
  throw new Error('Status pesanan tidak valid: ' + v);
}

function parseItems_(raw){
  if(!raw)return[];
  try{
    const v=typeof raw==='string'?JSON.parse(raw):raw;
    return Array.isArray(v)?v.map(x=>({
      id:String(x.id||''),
      name:String(x.name||'Menu'),
      qty:Math.max(1,Number(x.qty)||1),
      price:Math.max(0,Number(x.price)||0),
      note:String(x.note||''),
      options:String(x.options||''),
      done:!!x.done
    })):[];
  }catch(_){return[];}
}

function makeOrderId_(){
  return 'CAP-'+Utilities.formatDate(new Date(),CFG.TZ,'yyMMdd-HHmmss')+'-'+Utilities.getUuid().slice(0,6).toUpperCase();
}

function clean_(v){
  return String(v===undefined||v===null?'':v).trim().slice(0,2000);
}

function dateMillis_(v){
  if(v instanceof Date)return v.getTime();
  if(typeof v==='number')return v;
  const s=String(v||'').trim();
  let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1],+m[4],+m[5]).getTime();
  const d=new Date(s);
  return isNaN(d.getTime())?0:d.getTime();
}

function formatDate_(v,fmt){
  const ms=dateMillis_(v);
  return ms?Utilities.formatDate(new Date(ms),CFG.TZ,fmt):String(v||'-');
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeRequestId_(s){
  try{return JSON.parse(s).requestId||'';}catch(_){return'';}
}

// =========================================================================
// FITUR: TAB PENGELUARAN (EXPENSE TRACKING & REKONSILIASI KASIR)
// =========================================================================

function readPengeluaran_(ss, maxDays) {
  return readPengeluaranFromSheet_(ss.getSheetByName(CFG.EXPENSE_SHEET || 'Pengeluaran'), maxDays);
}

function readPengeluaranFromSheet_(sh, maxDays) {
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cutoffMs = (maxDays && Number(maxDays) > 0) ? (Date.now() - Number(maxDays) * 86400000) : 0;
  const numCols = Math.min(sh.getLastColumn(), CFG.EXPENSE_HEADERS.length);
  const values = sh.getRange(2, 1, last - 1, numCols).getValues();
  const result = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!row[0] && !row[1]) continue;
    const createdAtMs = dateMillis_(row[1]);
    if (cutoffMs > 0 && createdAtMs && createdAtMs < cutoffMs) continue;
    result.push({
      rowIndex: i + 2,
      id: String(row[0] || ''),
      timestamp: formatDate_(row[1], 'dd/MM/yyyy HH:mm'),
      createdAtMs,
      kategori: String(row[2] || 'Bahan Baku'),
      keterangan: String(row[3] || '-'),
      nominal: Number(row[4]) || 0,
      sumberDana: String(row[5] || 'Kas Tunai (Laci)'),
      staff: String(row[6] || 'Kasir'),
      catatan: String(row[7] || '-')
    });
  }
  return result;
}

function addExpense_(ss, p) {
  let sh = ss.getSheetByName(CFG.EXPENSE_SHEET || 'Pengeluaran');
  if (!sh) {
    sh = ss.insertSheet(CFG.EXPENSE_SHEET || 'Pengeluaran');
    sh.getRange(1, 1, 1, CFG.EXPENSE_HEADERS.length).setValues([CFG.EXPENSE_HEADERS]);
    sh.getRange(1, 1, 1, CFG.EXPENSE_HEADERS.length).setFontWeight('bold');
  }
  const id = clean_(p.id || p.expenseId || p.id_pengeluaran || makeExpenseId_());
  // Idempoten: retry dari outbox klien tidak boleh menggandakan baris
  if (findRowById_(sh, 1, id)) return { id, duplicate: true };
  const now = new Date();
  let kategori = clean_(p.kategori || 'Bahan Baku');
  if (kategori !== 'Operasional' && kategori !== 'Bahan Baku') {
    kategori = (kategori.toLowerCase().includes('operasional')) ? 'Operasional' : 'Bahan Baku';
  }
  const keterangan = clean_(p.keterangan || p.deskripsi || '-');
  const nominal = Number(p.nominal || p.amount || 0);
  if (!Number.isFinite(nominal) || nominal <= 0) {
    throw new Error('Nominal pengeluaran harus lebih besar dari 0');
  }
  const sumberDana = clean_(p.sumberDana || p.sumber_dana || 'Kas Tunai (Laci)');
  const staff = clean_(p.staff || p.kasir || 'Kasir');
  const catatan = clean_(p.catatan || '-');

  const row = [id, now, kategori, keterangan, nominal, sumberDana, staff, catatan];
  insertFirstEmpty_(sh, 1, row);

  logAudit_(ss, {
    timestamp: now,
    order_id: id,
    actor: staff,
    action: 'PENGELUARAN',
    reason: kategori + ': ' + keterangan,
    total: nominal,
    detail: 'Sumber dana: ' + sumberDana
  });

  return { id, nominal, kategori, keterangan, sumberDana, staff };
}

function deleteExpense_(ss, p) {
  const sh = ss.getSheetByName(CFG.EXPENSE_SHEET || 'Pengeluaran');
  if (!sh) throw new Error('Tab Pengeluaran tidak ditemukan');
  const id = clean_(p.id || p.expenseId || p.id_pengeluaran);
  if (!id) throw new Error('ID Pengeluaran wajib disertakan');
  const row = findRowById_(sh, 1, id);
  if (!row) return { id, deleted: true, alreadyDeleted: true }; // idempoten: sudah terhapus sebelumnya
  
  const rowVals = sh.getRange(row, 1, 1, CFG.EXPENSE_HEADERS.length).getValues()[0];
  sh.getRange(row, 1, 1, CFG.EXPENSE_HEADERS.length).clearContent();

  logAudit_(ss, {
    timestamp: new Date(),
    order_id: id,
    actor: clean_(p.staff || 'Kasir'),
    action: 'HAPUS_PENGELUARAN',
    reason: clean_(p.reason || 'Dibatalkan oleh kasir'),
    total: Number(rowVals[4]) || 0,
    detail: 'Hapus pengeluaran ' + (rowVals[2] || '') + ' - ' + (rowVals[3] || '')
  });

  return { id, deleted: true };
}

function makeExpenseId_() {
  return 'EXP-' + Utilities.formatDate(new Date(), CFG.TZ, 'yyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
}


/**
 * Membaca data Kru dari tab Kru / Pembagian Crew / Crew
 * Otomatis inisialisasi sheet dengan template default jika belum ada
 */
function readKru_(ss) {
  // Pembuatan tab Kru hanya dilakukan oleh setupBackend() (GET tidak boleh punya efek samping)
  const sh = ss.getSheetByName(CFG.CREW_SHEET || 'Kru') || ss.getSheetByName('Crew') || ss.getSheetByName('Pembagian Crew') || ss.getSheetByName('Data_Kru');
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim().toLowerCase());

  // Cocokkan header tepat lebih dulu (mencegah 'id_kru' terbaca sebagai kolom nama)
  let colId = headers.indexOf('id_kru');
  if (colId === -1) colId = headers.findIndex(h => h === 'id' || h.startsWith('id_') || h.startsWith('id '));
  let colName = headers.indexOf('nama_kru');
  if (colName === -1) colName = headers.indexOf('nama');
  if (colName === -1) colName = headers.findIndex(h => h.includes('nama'));
  if (colName === -1) colName = headers.findIndex((h, i) => i !== colId && (h.includes('crew') || h.includes('kru')));
  let colRole = headers.findIndex(h => h.includes('peran') || h.includes('role') || h.includes('jabatan'));
  let colPin = headers.findIndex(h => h.includes('pin'));
  let colStatus = headers.findIndex(h => h.includes('status'));

  if (colName === -1) colName = 2;
  if (colRole === -1) colRole = 3;
  if (colPin === -1) colPin = 4;
  if (colStatus === -1) colStatus = 5;
  if (colId === -1) colId = 1;

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const nama = String(row[colName] || '').trim();
    if (!nama) continue;
    const status = String(row[colStatus] || 'AKTIF').trim().toUpperCase();
    if (status !== 'AKTIF' && status !== 'ACTIVE') continue;
    result.push({
      id: String(row[colId] || ('CRW-' + String(i).padStart(3, '0'))).trim(),
      nama: nama,
      peran: String(row[colRole] || 'Kasir').trim(),
      pin: String(row[colPin] || '1234').trim(),
      status: status
    });
  }
  return result;
}


// =========================================================================
// v2.5 — OTORISASI SUPERVISOR, SETTLEMENT SHIFT, CICILAN KASBON, VALIDASI WEB ORDER
// =========================================================================

/**
 * Otorisasi Supervisor/Owner/Manager (PIN pin_void atau PIN kru berperan supervisor).
 * Dipakai untuk aksi sensitif yang sebelumnya hanya dicek di browser (hapus pengeluaran).
 */
function requireSupervisorPin_(ss, p, reqCache) {
  const inputPin = clean_(p.staff_pin || p.pin || p.void_pin);
  if (!inputPin) throw new Error('PIN Supervisor diperlukan untuk aksi ini');
  const settings = (reqCache && reqCache.settings) ? reqCache.settings : readSettings_(ss);
  if (reqCache && !reqCache.settings) reqCache.settings = settings;
  const voidPin = String(settings.pin_void || '').trim();
  if (voidPin && inputPin === voidPin) return { name: 'Supervisor' };
  const kruList = (reqCache && reqCache.kruList) ? reqCache.kruList : readKru_(ss);
  if (reqCache && !reqCache.kruList) reqCache.kruList = kruList;
  const sup = kruList.find(k => {
    const r = String(k.peran || '').toLowerCase();
    return (r.includes('supervisor') || r.includes('owner') || r.includes('manager')) && String(k.pin).trim() === inputPin;
  });
  if (sup) return { name: sup.nama };
  throw new Error('PIN Supervisor salah atau akun bukan Supervisor');
}

function ensureSettlementSheet_(ss) {
  let sh = ss.getSheetByName(CFG.SETTLEMENT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.SETTLEMENT_SHEET);
    sh.getRange(1, 1, 1, CFG.SETTLEMENT_HEADERS.length).setValues([CFG.SETTLEMENT_HEADERS]);
    sh.getRange(1, 1, 1, CFG.SETTLEMENT_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < CFG.SETTLEMENT_HEADERS.length) {
    // Auto-tambah header kolom baru (mis. detail_json) pada sheet lama secara aman
    const startCol = sh.getLastColumn() + 1;
    const missing = CFG.SETTLEMENT_HEADERS.slice(startCol - 1);
    if (missing.length) {
      const hdrRange = sh.getRange(1, startCol, 1, missing.length);
      hdrRange.setValues([missing]);
      hdrRange.setFontWeight('bold');
    }
  }
  return sh;
}

/** Simpan rekap settlement shift (idempoten berdasarkan settlementId). */
function saveSettlement_(ss, p) {
  const id = clean_(p.settlementId);
  if (!id) throw new Error('settlementId wajib diisi');
  const sh = ensureSettlementSheet_(ss);
  if (findRowById_(sh, 1, id)) return { settlementId: id, duplicate: true };

  // Pakai waktu settlement dari perangkat kasir (bukan waktu server) agar cut-off tetap akurat
  // walau transaksi baru tersinkron belakangan karena offline.
  let ts = new Date(p.timestamp);
  if (isNaN(ts.getTime()) || ts.getTime() > Date.now() + 60000) ts = new Date();

  let detailStr = '';
  if (typeof p.detailJson === 'string' && p.detailJson.trim()) {
    detailStr = p.detailJson.trim();
  } else if (p.detail && typeof p.detail === 'object') {
    try { detailStr = JSON.stringify(p.detail); } catch (_) { detailStr = ''; }
  }
  // Jaga agar tidak melebihi batas 50.000 karakter per sel Google Sheets
  if (detailStr.length > 48000) detailStr = '';

  const num = v => Number(v) || 0;
  sh.appendRow([
    id, ts, clean_(p.staffName || p.staff || 'Kasir'),
    clean_(p.shiftStartStr), clean_(p.shiftEndStr),
    num(p.totalRevenue), num(p.cashSales), num(p.qrisSales),
    num(p.cashExpense), num(p.qrisExpense), num(p.shiftKasbon),
    num(p.targetCash), num(p.actualCash), num(p.diff), clean_(p.note || '-'),
    detailStr
  ]);

  logAudit_(ss, {
    timestamp: ts, order_id: id, actor: clean_(p.staffName || p.staff || 'Kasir'),
    action: 'SETTLEMENT_SHIFT', reason: clean_(p.note || '-'),
    total: num(p.actualCash),
    detail: 'Target ' + num(p.targetCash) + ' | Fisik ' + num(p.actualCash) + ' | Selisih ' + num(p.diff)
  });
  return { settlementId: id, saved: true };
}

/** Baca riwayat settlement terbaru dari tab Settlement_Shift untuk sinkronisasi lintas perangkat. */
function readSettlementHistory_(ss, limit) {
  const sh = ss.getSheetByName(CFG.SETTLEMENT_SHEET);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const maxRows = Math.max(1, Number(limit) || 50);
  const startRow = Math.max(2, last - maxRows + 1);
  const readCols = Math.min(CFG.SETTLEMENT_HEADERS.length, Math.max(15, sh.getLastColumn()));
  const vals = sh.getRange(startRow, 1, last - startRow + 1, readCols).getValues();
  const out = [];
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i];
    if (!r[0]) continue;
    const ms = dateMillis_(r[1]);
    const rawDetail = readCols >= 16 ? String(r[15] || '').trim() : '';
    const mFrom = rawDetail ? rawDetail.match(/"fromMs":(\d+)/) : null;
    const mTo = rawDetail ? rawDetail.match(/"toMs":(\d+)/) : null;
    out.push({
      settlementId: String(r[0]).trim(),
      timestamp: ms ? new Date(ms).toISOString() : '',
      shiftDateStr: formatDate_(r[1], 'dd MMM yyyy, HH:mm') + ' WIB',
      staffName: String(r[2] || 'Kasir'),
      shiftStartStr: String(r[3] || ''),
      shiftEndStr: String(r[4] || ''),
      shiftStartMs: mFrom ? Number(mFrom[1]) : 0,
      shiftEndMs: mTo ? Number(mTo[1]) : ms,
      totalRevenue: Number(r[5]) || 0,
      cashSales: Number(r[6]) || 0,
      qrisSales: Number(r[7]) || 0,
      cashExpense: Number(r[8]) || 0,
      qrisExpense: Number(r[9]) || 0,
      totalExpense: (Number(r[8]) || 0) + (Number(r[9]) || 0),
      shiftKasbon: Number(r[10]) || 0,
      targetCash: Number(r[11]) || 0,
      actualCash: Number(r[12]) || 0,
      diff: Number(r[13]) || 0,
      note: (r[14] && r[14] !== '-') ? String(r[14]) : '',
      hasDetail: rawDetail.length > 2
    });
  }
  return out;
}

/** Baca snapshot detail_json untuk 1 settlementId secara on-demand (ringan untuk multi-device). */
function readSettlementDetailById_(ss, settlementId) {
  const sh = ss.getSheetByName(CFG.SETTLEMENT_SHEET);
  if (!sh || sh.getLastColumn() < 16) return null;
  const rowNum = findRowById_(sh, 1, settlementId);
  if (!rowNum) return null;
  const raw = String(sh.getRange(rowNum, 16).getValue() || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

/** Waktu settlement terakhir (ms) agar cut-off shift sama di semua perangkat. */
function readLastSettlementMs_(ss) {
  const sh = ss.getSheetByName(CFG.SETTLEMENT_SHEET);
  if (!sh) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  return dateMillis_(sh.getRange(last, 2).getValue());
}

/** Cicilan kasbon: kurangi sisa hutang, catat potongan ke Arsip_Piutang. Idempoten via cicilanId. */
function partialSettleDebt_(ss, p) {
  const active = requiredSheet_(ss, CFG.DEBT_SHEET);
  const archive = requiredSheet_(ss, CFG.DEBT_ARCHIVE_SHEET);
  const id = clean_(p.orderId || p.order_id);
  if (!id) throw new Error('orderId wajib diisi');
  const paid = Number(p.paidChunk);
  if (!Number.isFinite(paid) || paid <= 0) throw new Error('Nominal cicilan tidak valid');
  const cicilanId = clean_(p.cicilanId) || (id + '-C' + Utilities.getUuid().slice(0, 4).toUpperCase());

  if (findRowById_(archive, 1, cicilanId)) return { orderId: id, cicilanId, duplicate: true };

  const row = findRowById_(active, 1, id);
  if (!row) return { status: 'not_found', orderId: id };

  const vals = active.getRange(row, 1, 1, 9).getValues()[0];
  const current = Number(vals[4]) || 0;
  const remaining = Math.max(0, current - paid);
  const method = normalizeMethod_(p.metodePelunasan || 'TUNAI');
  const baseDetail = String(vals[3] || '-').replace(/^(\[Sisa Cicilan\]\s*)+/, '');

  insertFirstEmpty_(archive, 1, [cicilanId, vals[1], vals[2], 'Cicilan: ' + baseDetail, paid, vals[5], 'LUNAS (CICILAN)', new Date(), method]);

  if (remaining <= 0) {
    active.getRange(row, 5).setValue(0);
    const settled = settleDebt_(ss, { orderId: id, metodePelunasan: method });
    return Object.assign({ cicilanId, remaining: 0 }, settled);
  }
  active.getRange(row, 4).setValue('[Sisa Cicilan] ' + baseDetail);
  active.getRange(row, 5).setValue(remaining);
  return { orderId: id, cicilanId, remaining };
}

/** Catat pengosongan meja ke Audit_Log (jejak operasional). */
function logClearTable_(ss, p) {
  const loc = clean_(p.location || p.meja || '-');
  const clearedAtMs = Number(p.clearedAtMs) || Date.now();
  logAudit_(ss, {
    timestamp: new Date(clearedAtMs), order_id: '-', actor: clean_(p.actor || p.staff || 'Kasir'),
    action: 'KOSONGKAN_MEJA', reason: loc, total: clearedAtMs,
    detail: 'Meja dikosongkan: ' + loc
  });
  return { location: loc, clearedAtMs: clearedAtMs, logged: true };
}

/** Kembalikan peta { [location]: clearedAtMs } dari Audit_Log aksi KOSONGKAN_MEJA (200 baris terakhir). */
function readClearedTables_(ss) {
  const out = {};
  const sh = ss.getSheetByName(CFG.AUDIT_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  const lastRow = sh.getLastRow();
  const startRow = Math.max(2, lastRow - 199);
  const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 6).getValues();
  rows.forEach(r => {
    if (String(r[3] || '').trim() !== 'KOSONGKAN_MEJA') return;
    const loc = String(r[4] || '').trim();
    if (!loc) return;
    let ms = Number(r[5]) || 0;
    if (!ms && r[0] instanceof Date) ms = r[0].getTime();
    if (!ms && r[0]) {
      const parsed = Date.parse(String(r[0]));
      if (!isNaN(parsed)) ms = parsed;
    }
    if (ms > (out[loc] || 0)) out[loc] = ms;
  });
  return out;
}

/** Baca riwayat log audit terbaru dari tab Audit_Log (urutan terbaru di atas). */
function readAuditLog_(ss, limit) {
  const sh = ss.getSheetByName(CFG.AUDIT_SHEET);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const maxRows = Math.max(1, Number(limit) || 200);
  const startRow = Math.max(2, last - maxRows + 1);
  const vals = sh.getRange(startRow, 1, last - startRow + 1, CFG.AUDIT_HEADERS.length).getValues();
  const out = [];
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i];
    if (!r[0] && !r[1] && !r[3]) continue;
    const ms = dateMillis_(r[0]);
    out.push({
      timestamp: ms ? new Date(ms).toISOString() : '',
      timeMs: ms,
      dateStr: formatDate_(r[0], 'dd MMM yyyy, HH:mm:ss') + ' WIB',
      orderId: String(r[1] || '').trim(),
      actor: String(r[2] || '').trim(),
      action: String(r[3] || '').trim(),
      reason: String(r[4] || '').trim(),
      total: Number(r[5]) || 0,
      detail: String(r[6] || '').trim()
    });
  }
  return out;
}

/** Pesanan web: batasi spam per meja (CacheService). */
function rateLimitWebOrder_(p) {
  const meja = clean_(p.meja || p.table || 'x').toLowerCase().replace(/\s+/g, '');
  const cache = CacheService.getScriptCache();
  const key = 'wo_' + meja;
  const n = Number(cache.get(key)) || 0;
  if (n >= CFG.WEB_ORDER_LIMIT_PER_TABLE) {
    throw new Error('Terlalu banyak pesanan dari meja ini dalam waktu singkat. Mohon tunggu sebentar.');
  }
  cache.put(key, String(n + 1), CFG.WEB_ORDER_WINDOW_SEC);
}

/** Pesanan web: total tidak boleh di bawah jumlah harga dasar menu (opsi/topping boleh menambah). */
function validateWebOrder_(ss, p) {
  const items = parseItems_(p.items_json || p.items || null);
  if (items.length > CFG.MAX_WEB_ITEMS) throw new Error('Jumlah item pesanan terlalu banyak');
  items.forEach(i => {
    if (i.qty > CFG.MAX_ITEM_QTY) throw new Error('Jumlah porsi tidak wajar untuk "' + i.name + '"');
  });
  if (items.length === 0) return;

  const total = Number(p.total !== undefined ? p.total : p.total_price);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Total pesanan tidak valid');

  const byId = {};
  readMenu_(ss).forEach(m => { byId[m.id] = m; });
  let floor = 0;
  items.forEach(i => {
    const m = byId[i.id];
    if (!m) return;
    if (!m.is_available) throw new Error('Menu "' + m.name + '" sedang tidak tersedia.');
    floor += m.price * i.qty;
  });
  if (total + 1 < floor) {
    throw new Error('Total pesanan tidak sesuai harga menu terbaru. Muat ulang halaman menu lalu coba lagi.');
  }
}


/** Baca daftar meja & zona aktif dari tab Meja. */
function readTables_(ss) {
  const sh = ss.getSheetByName(CFG.TABLE_SHEET || 'Meja');
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[1] || '').trim();
    if (!name) continue;
    const status = String(r[5] || 'AKTIF').trim().toUpperCase();
    if (status === 'NONAKTIF' || status === 'TIDAK AKTIF' || status === 'OFF') continue;
    list.push({
      no: Number(r[0]) || i,
      name: name,
      zone: String(r[2] || 'Area Utama').trim(),
      zoneDesc: String(r[3] || '').trim(),
      type: String(r[4] || (name.toLowerCase() === 'takeaway' ? 'TAKEAWAY' : (name.toLowerCase().includes('bar') ? 'BAR' : 'MEJA'))).trim().toUpperCase()
    });
  }
  list.sort((a, b) => a.no - b.no);
  return list;
}


function ensureOrderArchiveSheet_(ss) {
  const name = CFG.ORDER_ARCHIVE_SHEET || 'Arsip_Pesanan';
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const hdr = CFG.ORDER_HEADERS.concat(['settled_at_ms']);
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
    sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureExpenseArchiveSheet_(ss) {
  const name = CFG.EXPENSE_ARCHIVE_SHEET || 'Arsip_Pengeluaran';
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, CFG.EXPENSE_HEADERS.length).setValues([CFG.EXPENSE_HEADERS]);
    sh.getRange(1, 1, 1, CFG.EXPENSE_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Arsip Otomatis Harian (05:15 WIB): Pindahkan transaksi SELESAI/BATAL/KADALUARSA & pengeluaran >60 hari ke tab Arsip.
 * Pesanan OPEN TAB, dalam proses, atau yang masih tercatat di Buku_Piutang aktif TIDAK pernah dipindahkan.
 */
function archiveOldRecords_(customSs, customDays) {
  let lock = null;
  if (!customSs && typeof LockService !== 'undefined' && typeof LockService.getScriptLock === 'function') {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return { skipped: 'lock_busy' };
  }
  try {
    const ss = customSs || SpreadsheetApp.getActiveSpreadsheet();
    const days = Number(customDays) || CFG.ARCHIVE_AFTER_DAYS || 60;
    const cutoffMs = Date.now() - days * 86400000;

    // Kumpulkan ID kasbon yang masih belum lunas agar tetap bertahan di sheet aktif
    const activeDebtIds = {};
    readDebt_(ss, CFG.DEBT_SHEET, 'BELUM LUNAS', 0).forEach(d => {
      if (d.orderId) activeDebtIds[d.orderId] = true;
    });

    let movedOrders = 0;
    const orderSh = ss.getSheetByName(CFG.ORDER_SHEET);
    if (orderSh && orderSh.getLastRow() > 1) {
      const cols = Math.max(11, orderSh.getLastColumn());
      const vals = orderSh.getRange(2, 1, orderSh.getLastRow() - 1, cols).getValues();
      const rowsToMove = [];
      const rowNumsToDelete = [];
      for (let i = 0; i < vals.length; i++) {
        const r = vals[i];
        const oid = String(r[1] || '').trim();
        if (!oid) {
          // Bersihkan baris kosong lama di tengah sheet jika ada
          if (!r[0] && !r[2]) rowNumsToDelete.push(i + 2);
          continue;
        }
        const st = String(r[8] || '').trim().toUpperCase();
        const isTerminal = st === 'SELESAI' || st === 'BATAL' || st === 'KADALUARSA';
        if (!isTerminal) continue;
        const metode = String(r[7] || '').trim().toUpperCase();
        const cat = String(r[5] || '');
        if (metode === 'OPEN TAB' || cat.includes('[OPEN TAB]') || activeDebtIds[oid]) continue;
        const latestMs = Math.max(dateMillis_(r[0]) || 0, Number(r[10]) || 0);
        if (latestMs > 0 && latestMs < cutoffMs) {
          rowsToMove.push(r.slice(0, 11));
          rowNumsToDelete.push(i + 2);
        }
      }
      if (rowsToMove.length > 0) {
        const arcOrderSh = ensureOrderArchiveSheet_(ss);
        const startDst = Math.max(2, arcOrderSh.getLastRow() + 1);
        arcOrderSh.getRange(startDst, 1, rowsToMove.length, 11).setValues(rowsToMove);
        movedOrders = rowsToMove.length;
      }
      for (let j = rowNumsToDelete.length - 1; j >= 0; j--) {
        if (typeof orderSh.deleteRow === 'function') orderSh.deleteRow(rowNumsToDelete[j]);
        else orderSh.getRange(rowNumsToDelete[j], 1, 1, cols).clearContent();
      }
    }

    let movedExpenses = 0;
    const expSh = ss.getSheetByName(CFG.EXPENSE_SHEET || 'Pengeluaran');
    if (expSh && expSh.getLastRow() > 1) {
      const cols = Math.min(CFG.EXPENSE_HEADERS.length, expSh.getLastColumn());
      const vals = expSh.getRange(2, 1, expSh.getLastRow() - 1, cols).getValues();
      const expToMove = [];
      const expDelRows = [];
      for (let i = 0; i < vals.length; i++) {
        const r = vals[i];
        if (!r[0] && !r[1]) {
          expDelRows.push(i + 2);
          continue;
        }
        const ms = dateMillis_(r[1]);
        if (ms > 0 && ms < cutoffMs) {
          expToMove.push(r.slice(0, CFG.EXPENSE_HEADERS.length));
          expDelRows.push(i + 2);
        }
      }
      if (expToMove.length > 0) {
        const arcExpSh = ensureExpenseArchiveSheet_(ss);
        const startDst = Math.max(2, arcExpSh.getLastRow() + 1);
        arcExpSh.getRange(startDst, 1, expToMove.length, CFG.EXPENSE_HEADERS.length).setValues(expToMove);
        movedExpenses = expToMove.length;
      }
      for (let j = expDelRows.length - 1; j >= 0; j--) {
        if (typeof expSh.deleteRow === 'function') expSh.deleteRow(expDelRows[j]);
        else expSh.getRange(expDelRows[j], 1, 1, cols).clearContent();
      }
    }

    if (movedOrders > 0 || movedExpenses > 0) {
      bumpDataVersion_();
      logAudit_(ss, {
        timestamp: new Date(),
        order_id: 'AUTO-ARCHIVE',
        actor: 'System',
        action: 'ARCHIVE_AUTO',
        reason: 'Retensi > ' + days + ' hari',
        total: movedOrders + movedExpenses,
        detail: 'Arsip otomatis: ' + movedOrders + ' pesanan, ' + movedExpenses + ' pengeluaran'
      });
    }
    return { movedOrders, movedExpenses, days };
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}


/**
 * Backup Otomatis Bulanan ke Google Drive (setiap tanggal 1 pukul ~05:30 WIB).
 * Menggandakan Spreadsheet aktif ke folder "Backup Captain Coffee POS" tanpa mengubah ID sheet utama.
 * Idempoten: bila file backup untuk periode tersebut sudah ada di folder, tidak membuat ganda.
 */
function monthlyBackupToDrive_(customNow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = (customNow instanceof Date) ? customNow : new Date();
  const folderName = CFG.BACKUP_FOLDER_NAME || 'Backup Captain Coffee POS';

  const folders = DriveApp.getFoldersByName(folderName);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  const dayStr = Utilities.formatDate(now, CFG.TZ, 'dd');
  let backupName;
  if (dayStr === '01') {
    // Saat jalan otomatis tanggal 1 pagi, namai sesuai bulan yang baru saja ditutup (bulan lalu)
    const curYear = Number(Utilities.formatDate(now, CFG.TZ, 'yyyy'));
    const curMonth = Number(Utilities.formatDate(now, CFG.TZ, 'MM')); // 1..12
    const prevMonthDate = new Date(curYear, curMonth - 2, 15);
    const periodLabel = Utilities.formatDate(prevMonthDate, CFG.TZ, 'yyyy-MM');
    backupName = 'Backup_Captain_POS_' + periodLabel;
    if (folder.getFilesByName(backupName).hasNext()) {
      return { skipped: true, reason: 'already_backed_up', backupName: backupName, folderName: folderName };
    }
  } else {
    // Eksekusi manual di luar tanggal 1 (mis. saat uji coba)
    backupName = 'Backup_Captain_POS_' + Utilities.formatDate(now, CFG.TZ, 'yyyy-MM-dd');
    if (folder.getFilesByName(backupName).hasNext()) {
      backupName += '_' + Utilities.formatDate(now, CFG.TZ, 'HHmm');
    }
  }

  const srcFile = DriveApp.getFileById(ss.getId());
  const copyFile = srcFile.makeCopy(backupName, folder);

  logAudit_(ss, {
    timestamp: now,
    order_id: copyFile.getId ? String(copyFile.getId()) : '-',
    actor: 'System',
    action: 'BACKUP_DRIVE',
    reason: backupName,
    total: 0,
    detail: 'Folder: ' + folderName
  });

  return { backedUp: true, backupName: backupName, folderName: folderName, fileId: copyFile.getId ? copyFile.getId() : '' };
}
