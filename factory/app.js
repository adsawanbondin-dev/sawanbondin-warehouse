/**
 * app.js — Sawanbondin Warehouse System v2
 *
 * ═══ วิธีเพิ่มคลังใหม่ ═══
 * 1. เพิ่ม entry ใน WAREHOUSE_CONFIG ด้านล่าง
 * 2. เพิ่ม nav-item และ page div ใน index.html
 * ไม่ต้องแก้ไขโค้ดส่วนอื่นเลย
 *
 * ═══ วิธีเพิ่มสินค้า ═══
 * ใช้หน้า Master → เพิ่มรายการ (ไม่ต้องแก้โค้ด)
 */

'use strict';

/* ═══════════════════════════════════════════
   CONFIG — ตั้งค่าจริงอยู่ใน config.js (โหลดก่อนไฟล์นี้)
   ห้ามแก้ตรงนี้ — ไปแก้ที่ config.js ของแต่ละหน่วยงานแทน
═══════════════════════════════════════════ */
const _CFG = window.WMS_CONFIG || {};
const SB_URL = _CFG.SB_URL || 'https://rsmcrshvcbtcxvvhdmnk.supabase.co';
const SB_KEY = _CFG.SB_KEY || 'sb_publishable__RK27ReptMhtMdc8EdA-KQ_K4zfhMwJ';
const PREFIX  = _CFG.PREFIX || 'SWBD';
// UNIFIED_CODE: ถ้าตั้งเป็นค่า เช่น 'TH' จะสร้างรหัสแบบ {PREFIX}_{UNIFIED_CODE}_0001
// รันเลขต่อเนื่องรวมทุกคลัง แทนการแยก prefix/เลขรันตามคลังแบบปกติ
const UNIFIED_CODE = _CFG.UNIFIED_CODE || null;
// ALERT_GROUPS: แบ่งแจ้งเตือนเป็นหลายกลุ่มตามคลัง เช่น { purchase:['raw','equip_th'], withdraw:['finish'] }
// ถ้าไม่ตั้งไว้ (Factory) ระบบใช้แจ้งเตือนแบบเดียวรวมทุกคลังเหมือนเดิม
const ALERT_GROUPS = _CFG.ALERT_GROUPS || null;
// SUPPLIER_FIELDS: 'days' = lead time แบบจำนวนวัน, 'date' = วันที่ส่งของรอบถัดไป, false/undefined = ไม่แสดง
// ใช้กับฟอร์มตั้งค่า Min/Max และหน้ารายการจัดซื้อ
const SUPPLIER_FIELDS = _CFG.SUPPLIER_FIELDS || null; // 'days' | 'date' | null

// WAREHOUSE_CONFIG เริ่มต้น (Factory) — Tea House override ทั้งก้อนผ่าน
// window.WMS_CONFIG.WAREHOUSE_CONFIG ใน config.js ของตัวเอง
const WAREHOUSE_CONFIG = _CFG.WAREHOUSE_CONFIG || {
  raw:       { label:'วัตถุดิบ',          prefix:'RM', hasLot:true,  lotSupplier:true,  rawFields:true,  depts:['ผลิต','คลัง'] },
  matcha:    { label:'ชาบดผงมัตจะ',       prefix:'MC', hasLot:true,  lotSupplier:true,  rawFields:false, depts:['ผลิต','คลัง'] },
  pack:      { label:'บรรจุภัณฑ์ภายใน',    prefix:'PK', hasLot:false, lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'] },
  packaging: { label:'บรรจุภัณฑ์ภายนอก',  prefix:'PA', hasLot:false, lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'] },
  equip:     { label:'อุปกรณ์',           prefix:'EQ', hasLot:false, lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'], hasSpec:true },
  finish:    { label:'สินค้าสำเร็จรูป',  prefix:'FG', hasLot:true,  lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'] },
  sample:    { label:'ชาตัวอย่าง',          prefix:'SA', hasLot:true,  lotSupplier:true,  rawFields:false, hasExpiry:true, depts:['ผลิต','คลัง','Tea House'],
               subcats:['OEM','RD','ชาประกวด'],
               subPrefixes:{ OEM:'OEM', RD:'SWBD_RD', 'ชาประกวด':'TCT' } },
};
const WAREHOUSE_PAGES = Object.keys(WAREHOUSE_CONFIG);

const ACTION_LABELS = { receive:'รับเข้า', withdraw:'เบิก', return_good:'คืนดี', return_bad:'คืนเสีย', transform_lot:'แปรรูป', transform_out:'แปรรูปออก', transform_in:'แปรรูปเข้า' };
const ACTION_BADGE  = { receive:'badge-receive', withdraw:'badge-withdraw', return_good:'badge-return-good', return_bad:'badge-return-bad', transform_lot:'badge-transform', transform_out:'badge-transform', transform_in:'badge-receive' };
const DEPT_PILL_CLS = { 'ผลิต':'dept-prod', 'คลัง':'dept-ware', 'บรรจุ':'dept-pack', 'Tea House':'dept-tea' };

/* ═══════════════════════════════════════════
   SUPABASE CLIENT
═══════════════════════════════════════════ */
const sb = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let masterDB        = [];
let purchaseOrders  = []; // cache temp PO
let locationDB      = {};    // { code: string }
let specDB          = {};    // { code: string } — สเปกอุปกรณ์
let lotDB           = {};    // { code: [{id,lot_sw,stock,updated_at}] }
let masterCatFilter = 'all';
let curPage         = 'master';
let currentQRPage   = null;
let camScanner      = null;
let lastCamCode     = '';
let currentUser     = null;

const txState = {};
WAREHOUSE_PAGES.forEach(pg => txState[pg] = { action:'receive', records:[] });

// Batch — persisted in localStorage so it survives page reload
const batchDB = {};
WAREHOUSE_PAGES.forEach(pg => batchDB[pg] = []);

/* ═══════════════════════════════════════════
   AUTH — Login / Logout
═══════════════════════════════════════════ */
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    hideLoginScreen();
    await boot();
  } else {
    showLoginScreen();
  }

  sb.auth.onAuthStateChange((_event, session) => {
    if (session) {
      currentUser = session.user;
      hideLoginScreen();
    } else {
      currentUser = null;
      showLoginScreen();
    }
  });
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.add('visible');
  document.getElementById('appRoot').style.display = 'none';
}
function hideLoginScreen() {
  document.getElementById('loginScreen').classList.remove('visible');
  document.getElementById('appRoot').style.display = 'block';
}

async function doLogin() {
  const input = (document.getElementById('loginEmail')?.value || '').trim();
  const pass  = document.getElementById('loginPass')?.value || '';
  const errEl = document.getElementById('loginError');
  if (!input || !pass) { errEl.textContent = 'กรุณากรอก Username/Email และ Password'; return; }
  setLoginLoading(true);

  let email = input;

  // ถ้าไม่มี @ ให้ค้นหา email จาก username
  if (!input.includes('@')) {
    // ใช้ anon key query user_profiles แบบ bypass RLS ผ่าน service role ไม่ได้
    // แทนด้วยการเก็บ email mapping ใน user_profiles โดยตรง
    const { data, error } = await sb
      .from('user_profiles')
      .select('id, username')
      .eq('username', input.toLowerCase())
      .maybeSingle();

    if (!data) {
      setLoginLoading(false);
      errEl.textContent = 'ไม่พบ Username นี้ในระบบ';
      return;
    }

    // ดึง email จาก auth.users ผ่าน RPC
    const { data: emailData, error: rpcErr } = await sb
      .rpc('get_user_email_by_id', { user_id: data.id });

    if (rpcErr || !emailData) {
      // fallback: ลอง login ด้วย input ตรงๆ
      setLoginLoading(false);
      errEl.textContent = 'ไม่พบ Username นี้ กรุณาใช้ Email แทน';
      return;
    }
    email = emailData;
  }

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  setLoginLoading(false);
  if (error) { errEl.textContent = 'Username/Password ไม่ถูกต้อง'; return; }
  errEl.textContent = '';
}
function setLoginLoading(on) {
  const btn = document.getElementById('loginBtn');
  if (btn) btn.disabled = on;
  const btn_text = document.getElementById('loginBtnText');
  if (btn_text) btn_text.textContent = on ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ';
}
async function doLogout() {
  await sb.auth.signOut();
  masterDB = []; locationDB = {}; lotDB = {};
  window._operatorName = '';
}

/** อัปเดต display name ของ user (เก็บใน user_metadata) */
async function setDisplayName(name) {
  if (!name) return;
  const { error } = await sb.auth.updateUser({ data: { display_name: name } });
  if (!error) {
    window._operatorName = name;
    const el = document.getElementById('topbarUser');
    if (el) el.textContent = name;
    showToast(`เปลี่ยนชื่อเป็น "${name}" สำเร็จ`);
  }
}

/* ═══════════════════════════════════════════
   CODE GENERATION
═══════════════════════════════════════════ */
function buildCode(pg, subcat, seq) {
  const n = String(seq).padStart(4, '0');
  if (UNIFIED_CODE) return `${PREFIX}_${UNIFIED_CODE}_${n}`;
  const pfx = WAREHOUSE_CONFIG[pg].prefix;
  return pg === 'raw' ? `${PREFIX}_RM_${subcat}_${n}` : `${PREFIX}_${pfx}_${n}`;
}
function nextSeq(pg, subcat) {
  // UNIFIED_CODE: นับเลขรันรวมทุกคลัง ไม่แยกตาม pg
  const matches = UNIFIED_CODE
    ? masterDB
    : masterDB.filter(m => m.pg === pg && (pg === 'raw' ? m.subcat === subcat : true));
  return matches.length ? Math.max(...matches.map(m => m.seq || 0)) + 1 : 1;
}

/* ═══════════════════════════════════════════
   SUPABASE — DB LAYER
   ทุก call มี error handling และ return result
═══════════════════════════════════════════ */
/* DB functions defined below after dbAdjustStockWithLot */
async function dbUpsertItem(m) {
  // upsert ทั้ง stock และ metadata — stock ถูก update โดย RPC แล้ว แต่ต้อง sync กลับ DB ด้วย
  const payload = {
    code:m.code, name:m.name, pg:m.pg, subcat:m.subcat||'',
    stock:m.stock,           // ← include stock ที่ sync มาจาก RPC
    min_stock:m.min, max_stock:m.max,
    note:locationDB[m.code]||'', seq:m.seq||0,
    is_active:true,          // ← สำคัญ: ป้องกันรายการใหม่หายเพราะถูกกรองด้วย is_active=true
  };
  if (SUPPLIER_FIELDS) {
    payload.supplier_name = m.supplier_name || null;
    if (SUPPLIER_FIELDS === 'days') payload.lead_time_days = m.lead_time_days ?? null;
    if (SUPPLIER_FIELDS === 'date') payload.next_delivery_date = m.next_delivery_date || null;
  }
  if (WAREHOUSE_CONFIG[m.pg]?.hasSpec) {
    payload.spec = specDB[m.code] || null;
  }
  payload.pay_status    = m.pay_status    || null;
  payload.ship_status   = m.ship_status   || null;
  payload.tracking_url  = m.tracking_url  || null;
  payload.supplier_qty  = m.supplier_qty  || null;
  payload.supplier_price = m.supplier_price || null;
  payload.expected_arrival_date = m.expected_arrival_date || null;
  payload.next_order_date = m.next_order_date || null;
  payload.snoozed_until = m.snoozed_until || null;
  const { error } = await sb.from('items').upsert(payload, { onConflict:'code' });
  if (error) { console.error('dbUpsertItem:', error.message); return false; }
  return true;
}

async function dbInsertTransaction(rec) {
  const payload = {
    item_code:    rec.code,
    item_name:    rec.item,
    pg:           rec.pg,
    action_type:  rec.type,
    quantity:     rec.qty,
    unit:         '',
    operator_name: rec.name,
    department:   rec.dept,
    lot_sw:       rec.lotSW !== '-' ? rec.lotSW : null,
    lot_supplier: rec.lotSP || null,
    note:         rec.note || '',
    via:          rec.via || 'manual',
    old_stock:    rec.oldStock ?? null,
    new_stock:    rec.newStock ?? null,
  };
  // ข้อ 5: ตรวจสอบ offline
  if (!navigator.onLine) {
    addToOfflineQueue(payload);
    return null;
  }
  const { data, error } = await sb.from('transactions').insert(payload).select('id').single();
  if (error) { console.error('dbInsertTransaction:', error.message); return null; }
  return data?.id ?? null;
}

async function dbLoadTransactionsRaw(pg, beforeDate) {
  let q = sb.from('transactions').select('*').eq('pg', pg);
  if (beforeDate) q = q.lt('created_at', beforeDate);
  const { data, error } = await q.order('created_at', { ascending:false }).limit(1000);
  if (error) { console.error('dbLoadTx:', error.message); return []; }
  return data||[];
}

function mapTxRow(r) {
  return {
    id: r.id,
    time: new Date(r.created_at).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'}),
    timeDetail: new Date(r.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}),
    rawCreatedAt: r.created_at,
    type:r.action_type, typeLabel:ACTION_LABELS[r.action_type]||r.action_type,
    name:r.operator_name||'', dept:r.department||'',
    item:r.item_name, code:r.item_code,
    qty:parseFloat(r.quantity), lotSW:r.lot_sw||'-', lotSP:r.lot_supplier||'',
    pg:r.pg, via:r.via||'manual',
    oldStock:r.old_stock, newStock:r.new_stock,
  };
}

async function dbLoadTransactions(pg) {
  const raw = await dbLoadTransactionsRaw(pg);
  histHasMore[pg] = raw.length === 1000;
  return raw.map(mapTxRow);
}

async function dbDeleteItem(code) {
  // soft delete — ไม่ลบจริง แค่ set is_active = false
  const { error } = await sb.from('items')
    .update({ is_active: false })
    .eq('code', code);
  if (error) { console.error('dbDeleteItem:', error.message); return false; }
  return true;
}

async function dbLoadLotsForItem(code) {
  const { data, error } = await sb.from('lots')
    .select('*').eq('item_code', code).order('lot_sw', { ascending:true });
  if (error) { console.error('dbLoadLots:', error.message); return; }
  lotDB[code] = (data||[]).map(r => ({
    id:r.id, lot_sw:r.lot_sw, lot_supplier:r.lot_supplier||'',
    stock:parseFloat(r.stock)||0, updated_at:r.updated_at,
    expiry_date:r.expiry_date||null, note:r.note||'',
  }));
}

async function dbLoadItems() {
  const supplierCols = SUPPLIER_FIELDS === 'days' ? ',supplier_name,lead_time_days'
                      : SUPPLIER_FIELDS === 'date' ? ',supplier_name,next_delivery_date'
                      : '';
  const cols = 'code,name,pg,subcat,stock,min_stock,max_stock,note,spec,seq,updated_at,pay_status,ship_status,tracking_url,supplier_qty,supplier_price,expected_arrival_date,next_order_date,snoozed_until' + supplierCols;
  const { data, error } = await sb.from('items')
    .select(cols)
    .eq('is_active', true)   // โหลดเฉพาะที่ยังใช้งานอยู่
    .order('seq', { ascending: true });
  if (error) { console.error('dbLoadItems:', error.message); return false; }
  masterDB = (data || []).map(r => ({
    code:r.code, name:r.name, pg:r.pg||'', subcat:r.subcat||'',
    stock:parseFloat(r.stock)||0, min:parseFloat(r.min_stock)||0,
    max:parseFloat(r.max_stock)||0, seq:r.seq||0, updated_at:r.updated_at,
    supplier_name:r.supplier_name||null,
    lead_time_days:r.lead_time_days??null,
    next_delivery_date:r.next_delivery_date||null,
    pay_status:r.pay_status||null,
    ship_status:r.ship_status||null,
    tracking_url:r.tracking_url||null,
    supplier_qty:r.supplier_qty||null,
    supplier_price:r.supplier_price||null,
    expected_arrival_date:r.expected_arrival_date||null,
    next_order_date:r.next_order_date||null,
    snoozed_until:r.snoozed_until||null,
  }));
  (data||[]).forEach(r => {
    if (r.note) locationDB[r.code] = r.note;
    if (r.spec) specDB[r.code] = r.spec;
  });
  return true;
}

/**
 * dbAdjustStockWithLot — RPC เดียวที่ทำทุกอย่างใน 1 DB transaction
 * ─ อัปเดต items.stock และ lots.stock พร้อมกัน ป้องกัน desync
 * ─ บันทึก old_stock / new_stock ใน transactions อัตโนมัติ
 *
 * params:
 *   code    — item code
 *   action  — receive | withdraw | return_good | return_bad
 *   qty     — จำนวน
 *   lotId   — bigint id ของ lot (withdraw/return) หรือ null
 *   lotSW   — date string สำหรับ receive (สร้าง lot ใหม่)
 *   lotSP   — date string lot supplier
 *   name    — item name (ใช้ตอน insert lot ใหม่)
 */
async function dbAdjustStockWithLot(code, action, qty, { lotId=null, lotSW=null, lotSP=null, expiry=null, name='', note=null } = {}) {
  const params = {
    p_code:     code,
    p_action:   action,
    p_qty:      qty,
    p_lot_id:   lotId   || null,
    p_lot_sw:   lotSW   || null,
    p_lot_sp:   (lotSP && lotSP.length > 0) ? lotSP : null,
    p_lot_name: name    || null,
    p_note:     (note && note.length > 0) ? note : null,
  };
  const { data, error } = await sb.rpc('adjust_stock_with_lot', params);
  if (error) {
    console.error('adjust_stock_with_lot RPC:', error.message);
    showToast('เกิดข้อผิดพลาด: ' + error.message, 'err');
    return { ok: false, error: error.message };
  }
  if (!data.ok) {
    if (data.error === 'insufficient_lot_stock' || data.error === 'insufficient_stock') {
      showToast(`สต็อกไม่พอ (มี ${data.available} เหลือ)`, 'err');
    } else if (data.error === 'lot_not_found') {
      showToast('ไม่พบ Lot ที่เลือก กรุณาโหลดใหม่', 'err');
    } else {
      showToast(`เกิดข้อผิดพลาด: ${data.error}`, 'err');
    }
    return data;
  }
  // sync local cache
  const m = masterDB.find(x => x.code === code);
  if (m) m.stock = data.new_stock;
  // sync lot cache ถ้ามี
  if (data.lot_id && lotDB[code]) {
    const lot = lotDB[code].find(l => l.id === data.lot_id);
    if (lot && data.new_lot_stock !== undefined) lot.stock = data.new_lot_stock;
    if (lot && expiry) { lot.expiry_date = expiry; }
    // เพิ่ม lot ใหม่เข้า cache ถ้าเป็น receive
    if (!lot && (action === 'receive' || action === 'return_good') && lotSW) {
      await dbLoadLotsForItem(code);
    }
  }
  // ถ้าเป็น receive + มี expiry → update lots ตรงๆ
  if ((action==='receive'||action==='return_good') && expiry && data.lot_id) {
    await sb.from('lots').update({ expiry_date: expiry }).eq('id', data.lot_id);
  }
  return data;
}

/**
 * dbTransformStockLot — แปรรูป/ปรับสภาพสินค้าในคลังเดียวกัน
 * เบิก Lot ต้นทาง + สร้าง/รวม Lot ใหม่ใน item เดียวกัน แบบ atomic
 *
 * params:
 *   code      — item code (เช่น มะตูม)
 *   fromLotId — bigint id ของ Lot ต้นทาง
 *   qtyOut    — จำนวนที่นำออกจาก Lot ต้นทาง
 *   newLotSW  — date string ของ Lot ใหม่ (YYYY-MM-DD)
 *   qtyIn     — น้ำหนักหลังแปรรูป (เข้า Lot ใหม่)
 *   note      — หมายเหตุ เช่น "อบเพิ่ม 40 องศา"
 */
async function dbTransformStockLot(code, fromLotId, qtyOut, newLotSW, qtyIn, note='') {
  const params = {
    p_code:        code,
    p_from_lot_id: fromLotId,
    p_qty_out:     qtyOut,
    p_new_lot_sw:  newLotSW,
    p_qty_in:      qtyIn,
    p_note:        note || null,
  };
  const { data, error } = await sb.rpc('transform_stock_lot', params);
  if (error) {
    console.error('transform_stock_lot RPC:', error.message);
    showToast('เกิดข้อผิดพลาด: ' + error.message, 'err');
    return { ok:false, error: error.message };
  }
  if (!data.ok) {
    if (data.error === 'insufficient_lot_stock') {
      showToast(`Lot ต้นทางมีไม่พอ (มี ${data.available} เหลือ)`, 'err');
    } else if (data.error === 'from_lot_not_found') {
      showToast('ไม่พบ Lot ต้นทาง กรุณาโหลดใหม่', 'err');
    } else {
      showToast(`เกิดข้อผิดพลาด: ${data.error}`, 'err');
    }
    return data;
  }
  // sync local cache — items
  const m = masterDB.find(x => x.code === code);
  if (m) m.stock = data.new_stock;
  // sync lot cache — Lot ต้นทาง
  if (lotDB[code]) {
    const fromLot = lotDB[code].find(l => l.id === data.from_lot_id);
    if (fromLot) fromLot.stock = data.from_lot_remaining;
    // Lot ใหม่ — อัปเดตหรือเพิ่มเข้า cache
    let newLot = lotDB[code].find(l => l.id === data.new_lot_id);
    if (newLot) {
      newLot.stock = data.new_lot_stock;
    } else {
      lotDB[code].push({
        id: data.new_lot_id, lot_sw: data.new_lot_sw, lot_supplier: note||'',
        stock: data.new_lot_stock, updated_at: new Date().toISOString(), expiry_date: null,
      });
    }
  }
  return data;
}


/* ═══════════════════════════════════════════
   BIN LOCATION — ระบบพิกัดชั้นวาง
═══════════════════════════════════════════ */
let binLocations = []; // cache [{id, zone, row, level, code, label}]


/* ═══════════════════════════════════════════════
   PURCHASE ORDERS — temp items
   ═══════════════════════════════════════════════ */

async function dbLoadPurchaseOrders() {
  const { data } = await sb.from('purchase_orders')
    .select('*, payment_suppliers(name,pay_type,acc_num,acc_name,bank)')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  purchaseOrders = data || [];
}

async function dbSavePurchaseOrder(po) {
  const { data } = await sb.from('purchase_orders').insert(po).select().single();
  if (data) purchaseOrders.unshift(data);
  return data;
}

async function dbUpdatePurchaseOrder(id, fields) {
  await sb.from('purchase_orders').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  const idx = purchaseOrders.findIndex(x => x.id === id);
  if (idx >= 0) purchaseOrders[idx] = { ...purchaseOrders[idx], ...fields };
}

async function dbDeletePurchaseOrder(id) {
  await sb.from('purchase_orders').update({ is_active: false }).eq('id', id);
  purchaseOrders = purchaseOrders.filter(x => x.id !== id);
}

// เปิด modal สร้าง PO ใหม่
async function openNewPurchaseOrder() {
  await dbLoadPaymentSuppliers();
  document.getElementById('poId').value = '';
  document.getElementById('poItemName').value = '';
  document.getElementById('poItemCode').value = '';
  document.getElementById('poQty').value = '';
  document.getElementById('poUnit').value = '';
  document.getElementById('poNote').value = '';
  document.getElementById('poExpectedDate').value = '';
  // supplier selector
  const sel = document.getElementById('poSupplierSel');
  sel.innerHTML = `<option value="">— เลือกผู้จำหน่าย —</option>` +
    paymentSuppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('') +
    `<option value="new">+ เพิ่มผู้จำหน่ายใหม่</option>`;
  document.getElementById('poNewSupplierRow').style.display = 'none';
  document.getElementById('poModal').classList.add('show');
}

function onPoSupplierChange(sel) {
  document.getElementById('poNewSupplierRow').style.display = sel.value === 'new' ? 'block' : 'none';
}

async function savePurchaseOrder() {
  const id = document.getElementById('poId').value;
  const item_name = document.getElementById('poItemName').value.trim();
  const item_code = document.getElementById('poItemCode').value.trim();
  const qty = parseFloat(document.getElementById('poQty').value) || null;
  const unit = document.getElementById('poUnit').value.trim();
  const note = document.getElementById('poNote').value.trim();
  const expected_arrival_date = document.getElementById('poExpectedDate').value || null;
  const supSel = document.getElementById('poSupplierSel');
  let supplier_id = supSel.value && supSel.value !== 'new' ? parseInt(supSel.value) : null;

  if (!item_name) { showToast('กรุณาใส่ชื่อรายการ', 'err'); return; }

  // ถ้าเพิ่มผู้จำหน่ายใหม่
  if (supSel.value === 'new') {
    const newName = document.getElementById('poNewSupName').value.trim();
    const newPayType = document.getElementById('poNewPayType').value;
    const newAccNum = document.getElementById('poNewAccNum').value.trim();
    const newAccName = document.getElementById('poNewAccName').value.trim();
    if (newName) {
      const sup = await dbSavePaymentSupplier({ name: newName, pay_type: newPayType, acc_num: newAccNum, acc_name: newAccName });
      if (sup) supplier_id = sup.id;
    }
  }

  const fields = { item_name, item_code: item_code||null, supplier_id, qty, unit: unit||null, note: note||null, expected_arrival_date };

  if (id) {
    await dbUpdatePurchaseOrder(parseInt(id), fields);
    showToast('แก้ไขรายการแล้ว');
  } else {
    const user = window._operatorName || '';
    await dbSavePurchaseOrder({ ...fields, created_by: user, pay_status: null, ship_status: null });
    showToast('เพิ่มรายการจัดซื้อแล้ว');
  }
  closeModal('poModal');
  renderAlertGroupPage('purchase');
}

async function editPurchaseOrder(id) {
  await dbLoadPaymentSuppliers();
  const po = purchaseOrders.find(x => x.id === id);
  if (!po) return;
  document.getElementById('poId').value = id;
  document.getElementById('poItemName').value = po.item_name || '';
  document.getElementById('poItemCode').value = po.item_code || '';
  document.getElementById('poQty').value = po.qty || '';
  document.getElementById('poUnit').value = po.unit || '';
  document.getElementById('poNote').value = po.note || '';
  document.getElementById('poExpectedDate').value = po.expected_arrival_date || '';
  const sel = document.getElementById('poSupplierSel');
  sel.innerHTML = `<option value="">— เลือกผู้จำหน่าย —</option>` +
    paymentSuppliers.map(s => `<option value="${s.id}" ${po.supplier_id===s.id?'selected':''}>${s.name}</option>`).join('') +
    `<option value="new">+ เพิ่มผู้จำหน่ายใหม่</option>`;
  document.getElementById('poNewSupplierRow').style.display = 'none';
  document.getElementById('poModal').classList.add('show');
}

async function updatePoTracking(id, field, value) {
  const po = purchaseOrders.find(x => x.id === id);
  if (!po) return;
  const fields = { [field]: value || null };
  if (field === 'ship_status' && value === 'stocked') {
    fields.pay_status = null; fields.ship_status = null;
    fields.tracking_url = null; fields.expected_arrival_date = null;
  }
  po[field] = value || null;
  if (field === 'ship_status' && value === 'stocked') {
    po.pay_status = null; po.tracking_url = null; po.expected_arrival_date = null;
  }
  await dbUpdatePurchaseOrder(id, fields);
  renderAlertGroupPage('purchase');
}

async function setPoTrackingUrl(id, url) {
  await dbUpdatePurchaseOrder(id, { tracking_url: url.trim() || null });
  const po = purchaseOrders.find(x => x.id === id);
  if (po) po.tracking_url = url.trim() || null;
}

async function setPoExpectedArrival(id, date) {
  await dbUpdatePurchaseOrder(id, { expected_arrival_date: date || null });
  const po = purchaseOrders.find(x => x.id === id);
  if (po) po.expected_arrival_date = date || null;
}

async function openPoPaymentRequest(id) {
  const po = purchaseOrders.find(x => x.id === id);
  if (!po) return;
  await dbLoadPaymentSuppliers();
  const sup = po.payment_suppliers || paymentSuppliers.find(s => s.id === po.supplier_id);
  document.getElementById('prCode').value = '';
  document.getElementById('prCategory').value = '';
  document.getElementById('prShopSel').value = sup ? String(po.supplier_id) : '';
  document.getElementById('prShopName').value = sup?.name || '';
  document.getElementById('prPayType').value = sup?.pay_type || 'พร้อมเพย์';
  document.getElementById('prAccNum').value = sup?.acc_num || '';
  document.getElementById('prAccName').value = sup?.acc_name || '';
  document.getElementById('prBank').value = sup?.bank || '';
  document.getElementById('prBankRow').style.display = sup?.pay_type === 'โอนธนาคาร' ? 'block' : 'none';
  document.getElementById('prSaveSupplier').style.display = 'none';
  prItems = [{ desc: po.item_name, qty: po.qty ? `${po.qty}${po.unit?' '+po.unit:''}` : '', price: '' }];
  _renderPrSupplierSel();
  renderPrItems();
  updatePrPreview();
  document.getElementById('paymentRequestModal').classList.add('show');
}

/* ═══════════════════════════════════════════════
   SUPPLIER MANAGEMENT PAGE
   ═══════════════════════════════════════════════ */

async function renderSupplierPage(q='') {
  await dbLoadPaymentSuppliers();
  const div = document.getElementById('page-suppliers');
  if (!div) return;
  const search = q || document.getElementById('supSearch')?.value || '';
  const filtered = search ? paymentSuppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.category||'').toLowerCase().includes(search.toLowerCase()) ||
    (s.phone||'').includes(search) ||
    (s.email||'').toLowerCase().includes(search.toLowerCase())
  ) : paymentSuppliers;

  const cards = filtered.map(s => `
    <div style="background:var(--surface);border-radius:var(--r);border:1px solid var(--line);padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          ${s.category?`<div style="font-size:10px;color:var(--ink4);margin-bottom:2px">${s.category}</div>`:''}
          <div style="font-weight:500;font-size:13px">${s.name}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="editSupplier(${s.id})"><i class="ti ti-pencil"></i></button>
          <button class="btn btn-sm" style="color:var(--red)" onclick="deleteSupplier(${s.id})"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--ink3);display:flex;flex-direction:column;gap:3px">
        <span><i class="ti ti-credit-card" style="font-size:10px"></i> ${s.pay_type}${s.bank?' — '+s.bank:''}</span>
        ${s.acc_num?`<span><i class="ti ti-hash" style="font-size:10px"></i> ${s.acc_num}</span>`:''}
        ${s.acc_name?`<span><i class="ti ti-user" style="font-size:10px"></i> ${s.acc_name}</span>`:''}
        ${s.phone||s.line_id||s.email?`<div style="height:1px;background:var(--line);margin:4px 0"></div>`:''}
        ${s.phone?`<span><i class="ti ti-phone" style="font-size:10px"></i> ${s.phone}</span>`:''}
        ${s.line_id?`<span><i class="ti ti-brand-line" style="font-size:10px"></i> ${s.line_id}</span>`:''}
        ${s.email?`<span><i class="ti ti-mail" style="font-size:10px"></i> ${s.email}</span>`:''}
      </div>
    </div>`).join('') || `<div style="padding:40px;text-align:center;color:var(--ink4);grid-column:1/-1">
      <i class="ti ti-building-store" style="font-size:32px;display:block;margin-bottom:8px;opacity:.25"></i>
      ยังไม่มีผู้จำหน่าย — กด "+ เพิ่มผู้จำหน่าย" ได้เลยค่ะ</div>`;

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ผู้จำหน่าย</div>
        <div class="page-sub">จัดการข้อมูลร้านและบัญชีสำหรับแจ้งเบิก · ${filtered.length} ราย</div></div>
      <button class="btn btn-primary btn-sm" onclick="openAddSupplier()">
        <i class="ti ti-plus"></i> เพิ่มผู้จำหน่าย
      </button>
    </div>
    <div style="margin-bottom:12px">
      <input id="supSearch" class="fi" placeholder="ค้นหาชื่อร้าน หมวดหมู่ เบอร์โทร..."
        style="max-width:320px" oninput="renderSupplierPage()" value="${search}">
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">${cards}</div>`;
}

function openAddSupplier() {
  document.getElementById('supEditId').value = '';
  document.getElementById('supEditCategory').value = '';
  document.getElementById('supEditName').value = '';
  document.getElementById('supEditPayType').value = 'พร้อมเพย์';
  document.getElementById('supEditBank').value = '';
  document.getElementById('supEditBankRow').style.display = 'none';
  document.getElementById('supEditAccNum').value = '';
  document.getElementById('supEditAccName').value = '';
  document.getElementById('supEditPhone').value = '';
  document.getElementById('supEditLine').value = '';
  document.getElementById('supEditEmail').value = '';
  document.getElementById('supplierEditModal').classList.add('show');
}

async function editSupplier(id) {
  const s = paymentSuppliers.find(x => x.id === id);
  if (!s) return;
  document.getElementById('supEditId').value = id;
  document.getElementById('supEditCategory').value = s.category || '';
  document.getElementById('supEditName').value = s.name;
  document.getElementById('supEditPayType').value = s.pay_type || 'พร้อมเพย์';
  document.getElementById('supEditBank').value = s.bank || '';
  document.getElementById('supEditBankRow').style.display = s.pay_type === 'โอนธนาคาร' ? 'block' : 'none';
  document.getElementById('supEditAccNum').value = s.acc_num || '';
  document.getElementById('supEditAccName').value = s.acc_name || '';
  document.getElementById('supEditPhone').value = s.phone || '';
  document.getElementById('supEditLine').value = s.line_id || '';
  document.getElementById('supEditEmail').value = s.email || '';
  document.getElementById('supplierEditModal').classList.add('show');
}

function onSupEditPayTypeChange(sel) {
  document.getElementById('supEditBankRow').style.display = sel.value === 'โอนธนาคาร' ? 'block' : 'none';
}

async function saveSupplierEdit() {
  const id = document.getElementById('supEditId').value;
  const category = document.getElementById('supEditCategory').value.trim();
  const name = document.getElementById('supEditName').value.trim();
  const pay_type = document.getElementById('supEditPayType').value;
  const bank = document.getElementById('supEditBank').value.trim();
  const acc_num = document.getElementById('supEditAccNum').value.trim();
  const acc_name = document.getElementById('supEditAccName').value.trim();
  const phone = document.getElementById('supEditPhone').value.trim();
  const line_id = document.getElementById('supEditLine').value.trim();
  const email = document.getElementById('supEditEmail').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อผู้จำหน่าย', 'err'); return; }

  const fields = { category: category||null, name, pay_type, bank: bank||null, acc_num: acc_num||null, acc_name: acc_name||null, phone: phone||null, line_id: line_id||null, email: email||null };

  if (id) {
    await sb.from('payment_suppliers').update(fields).eq('id', parseInt(id));
    const idx = paymentSuppliers.findIndex(x => x.id === parseInt(id));
    if (idx >= 0) paymentSuppliers[idx] = { ...paymentSuppliers[idx], ...fields };
    showToast('แก้ไขผู้จำหน่ายแล้ว');
  } else {
    await dbSavePaymentSupplier(fields);
    showToast(`เพิ่ม "${name}" แล้ว`);
  }
  closeModal('supplierEditModal');
  renderSupplierPage();
}

async function deleteSupplier(id) {
  if (!confirm('ลบผู้จำหน่ายนี้?')) return;
  await sb.from('payment_suppliers').delete().eq('id', id);
  paymentSuppliers = paymentSuppliers.filter(x => x.id !== id);
  renderSupplierPage();
  showToast('ลบแล้ว');
}

async function snoozeItem(code, days) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  if (parseInt(days) === 0) {
    m.snoozed_until = null;
    await sb.from('items').update({ snoozed_until: null }).eq('code', code);
    renderAlertGroupPage('purchase');
    showToast('ยกเลิกพักรายการแล้ว');
    return;
  }
  const until = new Date();
  until.setDate(until.getDate() + parseInt(days));
  const dateStr = until.toISOString().split('T')[0];
  m.snoozed_until = dateStr;
  await sb.from('items').update({ snoozed_until: dateStr }).eq('code', code);
  closeModal('snoozeModal');
  renderAlertGroupPage('purchase');
  showToast(`พักรายการ ${days} วัน — กลับมา ${until.toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'})}`);
}

async function snoozePoItem(id, days) {
  const po = purchaseOrders.find(x => x.id === id);
  if (!po) return;
  const until = new Date();
  until.setDate(until.getDate() + parseInt(days));
  const dateStr = until.toISOString().split('T')[0];
  po.snoozed_until = dateStr;
  await sb.from('purchase_orders').update({ snoozed_until: dateStr }).eq('id', id);
  closeModal('snoozeModal');
  renderAlertGroupPage('purchase');
  showToast(`พักรายการ ${days} วัน`);
}

function openSnoozeModal(code, poId) {
  document.getElementById('snoozeCode').value = code||'';
  document.getElementById('snoozePoId').value = poId||'';
  document.getElementById('snoozeDays').value = '';
  document.getElementById('snoozePreview').textContent = '';
  document.getElementById('snoozeModal').classList.add('show');
}

async function confirmSnooze() {
  const days = document.getElementById('snoozeDays').value;
  const code = document.getElementById('snoozeCode').value;
  const poId = document.getElementById('snoozePoId').value;
  if (!days || parseInt(days) < 1) { showToast('กรุณาเลือกหรือระบุจำนวนวัน','err'); return; }
  if (code) await snoozeItem(code, days);
  else if (poId) await snoozePoItem(parseInt(poId), days);
}

async function openGroupPaymentRequest(supId, supName) {
  const checkboxes = [...document.querySelectorAll(`.purchase-check[data-sup="${supId}"]:checked`)];
  if (!checkboxes.length) { showToast('กรุณาติ๊กรายการที่ต้องการก่อน','err'); return; }
  await dbLoadPaymentSuppliers();
  const sup = paymentSuppliers.find(s => String(s.id) === String(supId));
  document.getElementById('prCode').value = '';
  document.getElementById('prCategory').value = '';
  document.getElementById('prShopSel').value = supId ? String(supId) : '';
  document.getElementById('prShopName').value = supName||'';
  document.getElementById('prPayType').value = sup?.pay_type||'พร้อมเพย์';
  document.getElementById('prAccNum').value = sup?.acc_num||'';
  document.getElementById('prAccName').value = sup?.acc_name||'';
  document.getElementById('prBank').value = sup?.bank||'';
  document.getElementById('prBankRow').style.display = sup?.pay_type==='โอนธนาคาร'?'block':'none';
  document.getElementById('prSaveSupplier').style.display = 'none';
  prItems = checkboxes.map(cb => ({
    desc: cb.dataset.name||'',
    qty: cb.dataset.qty||'',
    price: '',
  }));
  _renderPrSupplierSel();
  renderPrItems();
  updatePrPreview();
  document.getElementById('paymentRequestModal').classList.add('show');
}

async function renderAlertGroupPage(group) {
  const div = document.getElementById('page-alert-'+group);
  if (!div) return;
  if (!ALERT_GROUPS || !ALERT_GROUPS[group]) { div.innerHTML = ''; return; }
  const withdrawLabel = _CFG.WITHDRAW_ALERT_LABEL || 'รายการเบิก';

  if (group === 'withdraw') {
    const alerts = getAlertItems(null, group);
    const rows = alerts.map((m,i) => {
      const cfg = WAREHOUSE_CONFIG[m.pg];
      const stockColor = m.stock<=0 ? 'var(--red)' : 'var(--warn)';
      return `<tr>
        <td style="color:var(--ink4)">${i+1}</td>
        <td style="font-weight:500">${m.name}<div style="font-size:10px;color:var(--ink4)">${m.code}</div></td>
        <td>${cfg?.label||m.pg}</td>
        <td style="text-align:right;font-weight:600;color:${stockColor}">${m.stock}</td>
        <td style="text-align:right;color:var(--ink3)">${m.min}</td>
        <td style="text-align:right;color:var(--ink3)">${m.max||'—'}</td>
        <td style="text-align:center;white-space:nowrap">
          <button class="btn btn-sm btn-primary" onclick="openAlertReceiveModal('${m.code}','${group}')"><i class="ti ti-check"></i> รับเข้า</button>
          <button class="btn btn-sm" onclick="editMinMax('${m.code}')"><i class="ti ti-pencil"></i></button>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--ink4)"><i class="ti ti-check" style="font-size:20px;display:block;margin-bottom:6px;opacity:.5"></i>ไม่มีรายการ</td></tr>`;
    div.innerHTML = `<div class="page-header"><div><div class="page-title">${withdrawLabel}</div><div class="page-sub">รายการที่สต็อกต่ำกว่า Min</div></div></div>
      <div class="sc-table-wrap"><table class="sc-table"><thead><tr>
        <th style="width:28px">#</th><th>รายการ</th><th>คลัง</th>
        <th style="text-align:right">คงเหลือ</th><th style="text-align:right">Min</th><th style="text-align:right">Max</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    return;
  }

  // ── PURCHASE ──
  let alerts = getAlertItems(null, group);
  const inProgress = masterDB.filter(m => {
    const inGroup = (ALERT_GROUPS.purchase||[]).includes(m.pg);
    return inGroup && (m.pay_status || m.ship_status) && m.ship_status !== 'stocked';
  });
  const codes = new Set(alerts.map(x=>x.code));
  inProgress.forEach(m => { if(!codes.has(m.code)) { codes.add(m.code); alerts.push(m); }});

  // โหลด temp PO
  await dbLoadPurchaseOrders();

  // แจ้งเตือนของถึงกำหนด
  checkArrivalAlerts();

  const filterKey = div.dataset.filter || 'all';
  let filtered = alerts;
  if (filterKey === 'low')       filtered = alerts.filter(m => m.stock <= m.min && m.min > 0);
  else if (filterKey === 'ordered')  filtered = alerts.filter(m => m.pay_status === 'ordered');
  else if (filterKey === 'waiting')  filtered = alerts.filter(m => m.pay_status === 'waiting');
  else if (filterKey === 'shipping') filtered = alerts.filter(m => m.ship_status === 'shipping');
  else if (filterKey === 'qc')       filtered = alerts.filter(m => m.ship_status === 'qc');

  const cLow  = alerts.filter(m => m.stock <= m.min && m.min > 0).length;
  const cOrd  = alerts.filter(m => m.pay_status === 'ordered').length;
  const cWait = alerts.filter(m => m.pay_status === 'waiting').length;
  const cShip = alerts.filter(m => m.ship_status === 'shipping').length;
  const cQc   = alerts.filter(m => m.ship_status === 'qc').length;

  const setFilter = (k) => `document.getElementById('page-alert-purchase').dataset.filter='${k}';renderAlertGroupPage('purchase')`;

  const statCards = [
    {key:'low',      icon:'ti-alert-triangle', label:'ต้องสั่งซื้อ',  val:cLow},
    {key:'ordered',  icon:'ti-shopping-cart',  label:'จัดซื้อแล้ว',   val:cOrd},
    {key:'waiting',  icon:'ti-clock',          label:'รอชำระเงิน',    val:cWait},
    {key:'shipping', icon:'ti-truck',          label:'กำลังจัดส่ง',   val:cShip},
    {key:'qc',       icon:'ti-search',         label:'รอ QC',         val:cQc},
  ].map(s => `<div onclick="${setFilter(s.key)}"
    style="background:var(--surface);border-radius:var(--r);border:1px solid ${filterKey===s.key?'var(--acc)':'var(--line)'};padding:10px 14px;cursor:pointer;flex:1;transition:.12s;display:flex;align-items:center;gap:10px">
    <i class="ti ${s.icon}" style="font-size:18px;color:${filterKey===s.key?'var(--acc)':'var(--ink4)'}"></i>
    <div>
      <div style="font-size:10px;color:var(--ink4)">${s.label}</div>
      <div style="font-size:20px;font-weight:600;color:${filterKey===s.key?'var(--acc)':'var(--ink2)'};line-height:1.1">${s.val}</div>
    </div>
  </div>`).join('');

  const filterBtns = [
    {key:'all', label:'ทั้งหมด'},
    {key:'low', label:'ต้องสั่งซื้อ'},
    {key:'ordered', label:'จัดซื้อแล้ว'},
    {key:'waiting', label:'รอชำระ'},
    {key:'shipping', label:'กำลังจัดส่ง'},
    {key:'qc', label:'รอ QC'},
  ].map(f => `<button onclick="${setFilter(f.key)}"
    style="padding:3px 10px;border-radius:20px;font-size:10px;border:0.5px solid ${filterKey===f.key?'var(--acc)':'var(--line)'};background:${filterKey===f.key?'var(--acc-bg)':'transparent'};color:${filterKey===f.key?'var(--acc)':'var(--ink3)'};cursor:pointer;white-space:nowrap">${f.label}</button>`).join('');

  const SFIELDS = SUPPLIER_FIELDS;

  const today = new Date(); today.setHours(0,0,0,0);

  // แยกรายการที่พักไว้ออก
  const activeFiltered = filtered.filter(m => {
    if (!m.snoozed_until) return true;
    return new Date(m.snoozed_until) < today;
  });
  const snoozedFiltered = filtered.filter(m => {
    if (!m.snoozed_until) return false;
    return new Date(m.snoozed_until) >= today;
  });

  // group by supplier
  const groups = {};
  [...activeFiltered, ...purchaseOrders.filter(po => !po.snoozed_until || new Date(po.snoozed_until) < today)]
    .forEach(m => {
      const supName = m.supplier_name || m.payment_suppliers?.name || '—';
      const supId   = m.supplier_id || null;
      const key = supId ? `sup_${supId}` : `name_${supName}`;
      if (!groups[key]) groups[key] = { supName, supId, items: [] };
      groups[key].items.push(m);
    });

  function _mkCard(m, isAlertItem) {
    const cfg = WAREHOUSE_CONFIG[m.pg];
    const pct = m.max > 0 ? Math.min(100, Math.round(m.stock/m.max*100)) : 0;
    const isLow = m.min > 0 && m.stock <= m.min;
    const barColor = m.stock<=0 ? 'var(--red)' : isLow ? 'var(--warn)' : 'var(--line2)';
    const stockColor = m.stock<=0 ? 'var(--red)' : isLow ? 'var(--warn)' : 'var(--ink2)';
    const canRecv = m.ship_status === 'qc' || m.ship_status === 'received';

    const arrDate = m.expected_arrival_date ? new Date(m.expected_arrival_date) : null;
    const ordDate = m.next_order_date ? new Date(m.next_order_date) : null;
    const isArrOverdue = arrDate && arrDate <= today && m.ship_status !== 'stocked';
    const isOrdDue = ordDate && ordDate <= today;
    const isArrSoon = arrDate && !isArrOverdue && (arrDate - today) <= 86400000*2;
    const isOrdSoon = ordDate && !isOrdDue && (ordDate - today) <= 86400000*2;
    const arrLabel = arrDate ? arrDate.toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'}) : '';

    const alertBadge = (isLow || isArrOverdue || isOrdDue)
      ? `<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:#fee;color:var(--red);font-weight:500">⚠ แจ้งเตือน</span>` : '';
    const payBadge = m.pay_status === 'ordered' ? `<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--acc-bg);color:var(--acc);font-weight:500">จัดซื้อแล้ว</span>` :
      m.pay_status === 'waiting' ? `<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:#fff8ee;color:#b06000;font-weight:500">รอชำระเงิน</span>` :
      m.pay_status === 'paid'    ? `<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:#eefaf4;color:#0a6640;font-weight:500">ชำระแล้ว</span>` : '';

    const supId = m.supplier_id || null;
    const qty = m.qty ? `${m.qty}${m.unit?' '+m.unit:''}` : (m.supplier_qty||'');
    const isPO = !!m.item_name; // temp PO

    const checkCode = isPO ? '' : m.code;
    const checkId = isPO ? m.id : '';

    return `<div style="background:var(--surface);border-radius:var(--r);border:1px solid var(--line);padding:12px 14px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <input type="checkbox" class="purchase-check" data-sup="${supId||''}"
            data-name="${isPO?m.item_name:m.name}" data-qty="${qty}"
            data-code="${checkCode}" data-poid="${checkId}"
            style="width:14px;height:14px;cursor:pointer">
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            ${isPO?`<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--s2);color:var(--ink4);border:1px solid var(--line)">เพิ่มเติม</span>`:''}
            <div style="font-weight:500;font-size:13px">${isPO?m.item_name:m.name}</div>
            ${alertBadge}${payBadge}
          </div>
          <div style="font-size:10px;color:var(--ink4);margin-top:1px">
            ${isPO?(m.item_code?m.item_code+' · ':''):(m.code+' · '+(cfg?.label||m.pg))}
            ${qty?' · '+qty:''}
          </div>
        </div>
        <div style="display:flex;gap:3px;flex-shrink:0;align-items:flex-start">
          <button class="btn btn-sm" onclick="openSnoozeModal('${checkCode}','${checkId}')" title="พักรายการ" style="font-size:10px;padding:2px 6px">
            <i class="ti ti-moon"></i>
          </button>
          ${isPO?`<button class="btn btn-sm" onclick="editPurchaseOrder(${m.id})" style="font-size:10px;padding:2px 6px"><i class="ti ti-pencil"></i></button>
          <button class="btn btn-sm" onclick="dbDeletePurchaseOrder(${m.id}).then(()=>renderAlertGroupPage('purchase'))" style="color:var(--red);font-size:10px;padding:2px 6px"><i class="ti ti-trash"></i></button>`:''}
          ${!isPO?`<div style="text-align:right">
            <div style="font-size:16px;font-weight:700;color:${stockColor}">${m.stock.toLocaleString()}</div>
            <div style="font-size:9px;color:var(--ink4)">Min ${m.min}${m.max?' / Max '+m.max:''}</div>
          </div>`:''}
        </div>
      </div>
      ${!isPO && m.max > 0 ? `<div style="height:3px;background:var(--s2);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px"></div>
      </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;color:var(--ink4);min-width:100px">คาดว่าของจะมา</span>
          <input type="date" value="${m.expected_arrival_date||''}"
            style="font-size:10px;padding:2px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--ink2);cursor:pointer"
            onchange="${isPO?`setPoExpectedArrival(${m.id},this.value)`:`setExpectedArrival('${m.code}',this.value)`}">
          ${isArrOverdue?`<span style="font-size:10px;font-weight:500;color:var(--red)">เลยกำหนดแล้ว</span>`:
            isArrSoon?`<span style="font-size:10px;color:var(--warn)">อีก ${Math.round((arrDate-today)/86400000)} วัน</span>`:
            arrLabel?`<span style="font-size:10px;color:var(--ink4)">${arrLabel}</span>`:''}
        </div>
        ${!isPO?`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;color:var(--ink4);min-width:100px">วันสั่งซื้อรอบถัดไป</span>
          <input type="date" value="${m.next_order_date||''}"
            style="font-size:10px;padding:2px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--ink2);cursor:pointer"
            onchange="setNextOrderDate('${m.code}',this.value)">
          ${isOrdDue?`<span style="font-size:10px;font-weight:500;color:var(--red)">ถึงวันสั่งซื้อแล้ว!</span>`:
            isOrdSoon?`<span style="font-size:10px;color:var(--warn)">อีก ${Math.round((ordDate-today)/86400000)} วัน</span>`:''}
        </div>`:''}
      </div>
      <div style="border-top:1px solid var(--line);padding-top:8px">
        ${isPO ? (() => {
          const payVal = m.pay_status||'';
          const shipVal = m.ship_status||'';
          const payOpts = Object.entries(PAY_STATUS_OPTS).map(([v,o])=>`<option value="${v}" ${payVal===v?'selected':''}>${o.label}</option>`).join('');
          const shipOpts = Object.entries(SHIP_STATUS_OPTS).map(([v,o])=>`<option value="${v}" ${shipVal===v?'selected':''}>${o.label}</option>`).join('');
          const trackUrl = m.tracking_url||'';
          return `<div style="display:flex;flex-direction:column;gap:4px">
            <select style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--ink2);cursor:pointer" onchange="updatePoTracking(${m.id},'pay_status',this.value)">${payOpts}</select>
            <select style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--ink2);cursor:pointer" onchange="updatePoTracking(${m.id},'ship_status',this.value)">${shipOpts}</select>
            <div style="display:flex;gap:3px;align-items:center">
              <input type="url" placeholder="ลิงก์ Tracking..." value="${trackUrl}"
                style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);flex:1;min-width:0;color:var(--ink2)"
                onchange="setPoTrackingUrl(${m.id},this.value)" onblur="setPoTrackingUrl(${m.id},this.value)">
              ${trackUrl?`<a href="${trackUrl}" target="_blank" style="color:var(--ink3);font-size:13px;line-height:1;text-decoration:none"><i class="ti ti-external-link"></i></a>`:''}
            </div>
            ${payVal==='waiting'?`<button class="btn btn-sm" onclick="openPoPaymentRequest(${m.id})" style="font-size:10px;padding:3px 8px"><i class="ti ti-file-invoice"></i> แจ้งเบิก</button>`:''}
          </div>`;
        })() : _trackingDropdowns(m)}
      </div>
      ${canRecv ? `<button class="btn btn-sm btn-primary" onclick="${isPO?`updatePoTracking(${m.id},'ship_status','stocked')`:`openAlertReceiveModal('${m.code}','purchase')`}" style="width:100%;font-size:11px">
        <i class="ti ti-check"></i> ยืนยันรับเข้าคลัง</button>` : ''}
    </div>`;
  }

  // render grouped cards
  const groupHtml = Object.entries(groups).map(([key, grp]) => {
    const supId = grp.supId;
    const cardHtml = grp.items.map(m => _mkCard(m, true)).join('');
    return `<div style="grid-column:1/-1">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:8px 12px;background:var(--s2);border-radius:var(--r);border:1px solid var(--line)">
        <div style="font-size:12px;font-weight:500;color:var(--ink2)">
          <i class="ti ti-building-store" style="font-size:12px;color:var(--ink4)"></i>
          ${grp.supName}
        </div>
        <button class="btn btn-sm" onclick="openGroupPaymentRequest('${supId||''}','${grp.supName}')" style="font-size:10px">
          <i class="ti ti-file-invoice"></i> สร้างใบเบิกรวม
        </button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px">
        ${cardHtml}
      </div>
    </div>`;
  }).join('') || `<div style="padding:40px;text-align:center;color:var(--ink4);grid-column:1/-1">
    <i class="ti ti-inbox" style="font-size:32px;display:block;margin-bottom:8px;opacity:.25"></i>ไม่มีรายการ</div>`;

  // รายการที่พักไว้
  const snoozedHtml = snoozedFiltered.length ? `
    <div style="grid-column:1/-1;margin-top:8px">
      <div style="font-size:11px;color:var(--ink4);margin-bottom:6px"><i class="ti ti-moon"></i> พักไว้ (${snoozedFiltered.length} รายการ)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;opacity:.6">
        ${snoozedFiltered.map(m => {
          const until = new Date(m.snoozed_until).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'});
          return `<div style="background:var(--s2);border-radius:var(--r);border:1px solid var(--line);padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div>
              <div style="font-size:12px;font-weight:500">${m.name||m.item_name}</div>
              <div style="font-size:10px;color:var(--ink4)">กลับมา ${until}</div>
            </div>
            <button class="btn btn-sm" onclick="snoozeItem('${m.code}',0)" style="font-size:10px">ยกเลิกพัก</button>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">รายการจัดซื้อ</div>
        <div class="page-sub">ติดตามสถานะ · ${alerts.length + purchaseOrders.length} รายการ</div></div>
      <button class="btn btn-primary btn-sm" onclick="openNewPurchaseOrder()">
        <i class="ti ti-plus"></i> เพิ่มรายการจัดซื้อ
      </button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">${statCards}</div>
    <div class="card" style="overflow:hidden;margin-bottom:14px">
      <div style="display:flex;gap:6px;padding:8px 12px;overflow-x:auto;flex-wrap:nowrap">${filterBtns}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr;gap:14px">
      ${groupHtml}
      ${snoozedHtml}
    </div>`;
}

/* ── ยืนยันรับของจากหน้าแจ้งเตือน (จัดซื้อ/เบิก) — modal เล็ก กรอกจำนวน+วันที่ lot ──
   ใช้ logic เดียวกับฟอร์มรับเข้าปกติ (dbAdjustStockWithLot action='receive') */
function openAlertReceiveModal(code, group) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  const cfg = WAREHOUSE_CONFIG[m.pg];
  document.getElementById('arCode').value = code;
  document.getElementById('arGroup').value = group;
  document.getElementById('arName').textContent = m.name;
  document.getElementById('arSub').textContent = `${cfg?.label||m.pg} · คงเหลือปัจจุบัน ${m.stock} · Min ${m.min}`;
  document.getElementById('arQty').value = '';
  document.getElementById('arDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('arNote').value = '';
  document.getElementById('alertReceiveModal').classList.add('show');
  setTimeout(() => document.getElementById('arQty')?.focus(), 50);
}

async function submitAlertReceiveModal() {
  const code  = document.getElementById('arCode').value;
  const qty   = parseFloat(document.getElementById('arQty').value);
  const lotSW = document.getElementById('arDate').value;
  const note  = (document.getElementById('arNote').value || '').trim();

  if (isNaN(qty) || qty <= 0) { showToast('กรุณากรอกจำนวนให้ถูกต้อง', 'err'); return; }
  if (!lotSW) { showToast('กรุณาเลือกวันที่', 'err'); return; }

  const mi = masterDB.find(x => x.code === code);
  if (!mi) { showToast('ไม่พบรายการสินค้า', 'err'); closeModal('alertReceiveModal'); return; }
  const cfg = WAREHOUSE_CONFIG[mi.pg];

  setLoading('arSubmitBtn', true);
  const rpcResult = await dbAdjustStockWithLot(code, 'receive', qty, {
    lotSW: cfg?.hasLot ? lotSW : null,
    name: mi.name,
    note: (mi.pg === 'raw') ? (note || null) : null,
  });
  if (!rpcResult.ok) { setLoading('arSubmitBtn', false); return; }
  if (rpcResult.new_stock !== undefined) mi.stock = rpcResult.new_stock;
  await dbUpsertItem(mi);

  const rec = {
    time: dateToday(), timeDetail: timeNow(), type: 'receive', typeLabel: ACTION_LABELS.receive,
    name: window._operatorName || '', dept: window._operatorDept || 'คลัง', item: mi.name, code, qty,
    lotSW: cfg?.hasLot ? lotSW : '-', lotSP: '', note, pg: mi.pg, via: 'alert',
    oldStock: rpcResult.new_stock - qty, newStock: rpcResult.new_stock,
  };
  txState[mi.pg].records.unshift(rec);
  rec.id = await dbInsertTransaction(rec);

  checkAlerts();
  if (curPage === 'master') renderMasterContent();
  if (curPage.startsWith('alert-')) renderAlertGroupPage(curPage.replace('alert-',''));

  setLoading('arSubmitBtn', false);
  closeModal('alertReceiveModal');
  showToast(`"${mi.name}" รับเข้า ${qty} สำเร็จ`);
}


function dbScrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function dbExportPNG() {
  const div = document.getElementById('page-dashboard');
  if (!div) return;
  showToast('กำลังสร้างภาพ...');
  try {
    // โหลด html2canvas แบบ dynamic
    if (!window.html2canvas) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const date = new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    const canvas = await window.html2canvas(div, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f7f7f5',
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: div.scrollWidth,
      windowHeight: div.scrollHeight,
    });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `Sawanbondin_Dashboard_${date}.png`;
    a.click();
    showToast('Export PNG สำเร็จ ✓');
  } catch(e) {
    showToast('Export ไม่สำเร็จ: ' + e.message, 'err');
  }
}

async function dbExportPDF() {
  const div = document.getElementById('page-dashboard');
  if (!div) return;
  showToast('กำลังสร้าง PDF...');
  try {
    if (!window.html2canvas) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    if (!window.jspdf) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const date = new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    const canvas = await window.html2canvas(div, {
      scale: 1.5,
      useCORS: true,
      backgroundColor: '#f7f7f5',
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: div.scrollWidth,
      windowHeight: div.scrollHeight,
    });
    const { jsPDF } = window.jspdf;
    const imgW  = canvas.width;
    const imgH  = canvas.height;
    const pdfW  = 210; // A4 mm
    const pdfH  = Math.round(imgH * pdfW / imgW);
    const pdf   = new jsPDF({ orientation: pdfH > pdfW ? 'p' : 'l', unit: 'mm', format: [pdfW, pdfH] });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfW, pdfH);
    pdf.save(`Sawanbondin_Dashboard_${date}.pdf`);
    showToast('Export PDF สำเร็จ ✓');
  } catch(e) {
    showToast('Export ไม่สำเร็จ: ' + e.message, 'err');
  }
}

function dbToggleWh(id, forceOpen) {
  const body = document.getElementById(id);
  const chev = document.getElementById(id.replace('dbwh-','dbwh-chev-'));
  if (!body) return;
  const open = forceOpen !== undefined ? forceOpen : body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
}

function dbExpandAll(expand) {
  document.querySelectorAll('[id^="dbwh-"]:not([id^="dbwh-chev"])').forEach(el => {
    if (el.id.startsWith('dbwh-chev')) return;
    el.style.display = expand ? 'block' : 'none';
    const chev = document.getElementById(el.id.replace('dbwh-','dbwh-chev-'));
    if (chev) chev.style.transform = expand ? 'rotate(90deg)' : '';
  });
}

/* ── switchPage ── */
function switchPage(p) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${p}"]`)?.classList.add('active');
  const alertGroupPages = ALERT_GROUPS ? Object.keys(ALERT_GROUPS).map(g=>'alert-'+g) : [];
  ['master', ...WAREHOUSE_PAGES, 'stockcount', 'dashboard', 'suppliers', ...alertGroupPages].forEach(pg => {
    const el = document.getElementById('page-'+pg);
    if (el) el.className = pg===p ? 'page-visible' : 'page-hidden';
  });
  curPage = p;
  if (p==='master') {
    renderMasterPage();
  } else if (p==='suppliers') {
    renderSupplierPage();
  } else if (p.startsWith('alert-')) {
    renderAlertGroupPage(p.replace('alert-',''));
  } else {
    renderWarehousePage(p);
    dbLoadTransactions(p).then(recs => {
      txState[p].records = recs;
      renderHistory(p);
    });
  }
}

/* ── Override switchPage เพิ่ม dashboard ── */
const _dbOrigSwitch = switchPage;
switchPage = async function(p) {
  if (p === 'dashboard') {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-page="dashboard"]')?.classList.add('active');
    const alertGroupPages2 = ALERT_GROUPS ? Object.keys(ALERT_GROUPS).map(g=>'alert-'+g) : [];
    [...WAREHOUSE_PAGES, 'master', 'stockcount', 'dashboard', ...alertGroupPages2].forEach(pg => {
      const el = document.getElementById('page-' + pg);
      if (el) el.className = pg === p ? 'page-visible' : 'page-hidden';
    });
    curPage = p;
    await renderDashboardPage();
  } else {
    _dbOrigSwitch(p);
  }
};
