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

const ACTION_LABELS = { receive:'รับเข้า', withdraw:'เบิก', return_good:'คืนดี', return_bad:'คืนเสีย', transform_lot:'แปรรูป' };
const ACTION_BADGE  = { receive:'badge-receive', withdraw:'badge-withdraw', return_good:'badge-return-good', return_bad:'badge-return-bad', transform_lot:'badge-transform' };
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
let bomRecipes      = []; // cache สูตรการผลิตทั้งหมด
let purchaseOrders  = []; // cache temp PO
let locationDB      = {};    // { code: string }
let specDB          = {};    // { code: string } — สเปกอุปกรณ์
let remarkDB        = {};    // { code: string } — หมายเหตุ
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

/** เปิด modal ตั้งค่าโปรไฟล์ */
function openProfileSettings() {
  document.getElementById('profileName').value = window._operatorName || '';
  document.getElementById('profileDept').value = window._operatorDept || '';
  document.getElementById('profileModal').classList.add('show');
}

async function saveProfileSettings() {
  const name = document.getElementById('profileName').value.trim();
  const dept = document.getElementById('profileDept').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อ','err'); return; }

  // บันทึกลง user_profiles
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    await sb.from('user_profiles').upsert({
      id: user.id,
      display_name: name,
      department: dept || null,
    }, { onConflict: 'id' });
    await sb.auth.updateUser({ data: { display_name: name } });
  }

  window._operatorName = name;
  window._operatorDept = dept;
  const el = document.getElementById('topbarUser');
  if (el) el.textContent = `${name}${dept?' · '+dept:''}`;
  closeModal('profileModal');
  showToast(`บันทึกโปรไฟล์แล้ว`);
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
    payload.spec   = specDB[m.code]   || null;
    payload.remark = remarkDB[m.code] || null;
  }
  payload.pay_status    = m.pay_status    || null;
  payload.ship_status   = m.ship_status   || null;
  payload.tracking_url  = m.tracking_url  || null;
  payload.supplier_qty  = m.supplier_qty  || null;
  payload.supplier_price = m.supplier_price || null;
  payload.expected_arrival_date = m.expected_arrival_date || null;
  payload.next_order_date = m.next_order_date || null;
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
    bag_number:r.bag_number||null, bag_total:r.bag_total||null, weight_kg:parseFloat(r.weight_kg)||null,
  }));
}

async function dbLoadItems() {
  const supplierCols = SUPPLIER_FIELDS === 'days' ? ',supplier_name,lead_time_days'
                      : SUPPLIER_FIELDS === 'date' ? ',supplier_name,next_delivery_date'
                      : '';
  const cols = 'code,name,pg,subcat,stock,min_stock,max_stock,note,remark,spec,seq,updated_at,pay_status,ship_status,tracking_url,supplier_qty,supplier_price,expected_arrival_date,next_order_date' + supplierCols;
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
    remark:r.remark||null,
  }));
  (data||[]).forEach(r => {
    if (r.note) locationDB[r.code] = r.note;
    if (r.spec) specDB[r.code] = r.spec;
    if (r.remark) remarkDB[r.code] = r.remark;
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

/* ═══════════════════════════════════════════════════════════════
   BOM — สูตรการผลิต
   ═══════════════════════════════════════════════════════════════ */

async function dbLoadBomRecipes() {
  const { data, error } = await sb.from('bom_recipes')
    .select('*, bom_items(*)')
    .eq('is_active', true)
    .order('name');
  if (error) { console.error('dbLoadBomRecipes:', error.message); return false; }
  bomRecipes = data || [];
  return true;
}

async function dbSaveBomRecipe(recipe) {
  const { data, error } = await sb.from('bom_recipes')
    .insert({ name:recipe.name, description:recipe.description||'', output_qty:recipe.output_qty, output_unit:recipe.output_unit })
    .select().single();
  if (error) { showToast('บันทึกสูตรไม่สำเร็จ','err'); return null; }
  // บันทึก items
  if (recipe.items?.length) {
    const rows = recipe.items.map(i => ({
      recipe_id: data.id, item_code: i.code, item_name: i.name,
      pg: i.pg, qty_per_unit: i.qty
    }));
    await sb.from('bom_items').insert(rows);
  }
  return data.id;
}

async function dbUpdateBomRecipe(id, recipe) {
  await sb.from('bom_recipes').update({
    name:recipe.name, description:recipe.description||'',
    output_qty:recipe.output_qty, output_unit:recipe.output_unit, updated_at:new Date().toISOString()
  }).eq('id', id);
  // ลบ items เดิมแล้วใส่ใหม่
  await sb.from('bom_items').delete().eq('recipe_id', id);
  if (recipe.items?.length) {
    const rows = recipe.items.map(i => ({
      recipe_id: id, item_code: i.code, item_name: i.name,
      pg: i.pg, qty_per_unit: i.qty
    }));
    await sb.from('bom_items').insert(rows);
  }
}

async function dbDeleteBomRecipe(id) {
  await sb.from('bom_recipes').update({ is_active: false }).eq('id', id);
}

/* ── render หน้า BOM ── */
function renderBomPage() {
  const div = document.getElementById('page-bom');
  if (!div) return;
  dbLoadBomRecipes().then(() => _renderBomContent(div));
}

function _renderBomContent(div) {
  const recipeCards = bomRecipes.map(r => {
    const items = (r.bom_items||[]).map(i =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);font-size:12px">
        <span style="color:var(--ink2)">${i.item_name}</span>
        <span style="color:var(--ink3);font-family:monospace">${i.qty_per_unit} × ${r.output_qty} ${r.output_unit}</span>
      </div>`
    ).join('');
    return `<div class="card" style="margin-bottom:10px">
      <div class="card-title">
        <div class="card-title-left">
          <i class="ti ti-clipboard-list" style="color:var(--acc)"></i>
          <span style="font-weight:600">${r.name}</span>
          <span class="mcount" style="font-size:10px">${r.output_qty} ${r.output_unit}</span>
        </div>
        ${canManageMaster()?`<div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="openBomEdit(${r.id})"><i class="ti ti-pencil"></i> แก้ไข</button>
          <button class="btn btn-sm" style="color:var(--red)" onclick="deleteBomRecipe(${r.id})"><i class="ti ti-trash"></i></button>
        </div>`:''}
      </div>
      ${r.description?`<div style="font-size:11px;color:var(--ink3);margin-bottom:8px">${r.description}</div>`:''}
      <div style="margin-bottom:10px">${items}</div>
      <button class="btn btn-primary" style="width:100%" onclick="openPackaging(${r.id})">
        <i class="ti ti-package"></i> ทำแพคเกจ
      </button>
    </div>`;
  }).join('') || `<div style="text-align:center;padding:40px;color:var(--ink4)">
    <i class="ti ti-clipboard-list" style="font-size:40px;display:block;margin-bottom:10px;opacity:.3"></i>
    ยังไม่มีสูตรการผลิต — กด "+ สร้างสูตร" เพื่อเริ่มต้น
  </div>`;

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">สูตรการผลิต (BOM)</div>
        <div class="page-sub">จัดการสูตร และทำแพคเกจ</div></div>
      <div>
        ${canManageMaster()?`<button class="btn btn-primary btn-sm" onclick="openBomEdit(null)">
          <i class="ti ti-plus"></i> สร้างสูตร</button>`:''}
      </div>
    </div>
    <div style="max-width:600px;margin:0 auto">${recipeCards}</div>`;
}

/* ── modal แก้ไข/สร้างสูตร ── */
function openBomEdit(id) {
  const r = id ? bomRecipes.find(x=>x.id===id) : null;
  const items = r?.bom_items || [];
  document.getElementById('bomEditId').value = id||'';
  document.getElementById('bomEditName').value = r?.name||'';
  document.getElementById('bomEditDesc').value = r?.description||'';
  document.getElementById('bomEditQty').value = r?.output_qty||1;
  document.getElementById('bomEditUnit').value = r?.output_unit||'ชุด';
  // render items
  _renderBomEditItems(items);
  document.getElementById('bomEditModal').classList.add('show');
}

function _renderBomEditItems(items) {
  const container = document.getElementById('bomEditItems');
  container.innerHTML = items.map((item,i) => _bomItemRow(i, item)).join('');
}

function _bomItemRow(i, item={}) {
  const pgOpts = Object.entries(WAREHOUSE_CONFIG).map(([k,v]) =>
    `<option value="${k}" ${item.pg===k?'selected':''}>${v.label}</option>`).join('');
  const itemOpts = masterDB
    .filter(m => !item.pg || m.pg === item.pg)
    .map(m => `<option value="${m.code}" data-name="${m.name}" data-pg="${m.pg}" ${item.item_code===m.code?'selected':''}>${m.name}</option>`)
    .join('');
  return `<div class="form-grid bom-item-row" style="background:var(--s2);border-radius:var(--r);padding:10px;margin-bottom:8px;position:relative" data-idx="${i}">
    <div class="fg">
      <label class="fl">คลัง</label>
      <select class="fi" onchange="onBomPgChange(this,${i})" style="padding:7px 9px">
        <option value="">-- เลือกคลัง --</option>
        ${pgOpts}
      </select>
    </div>
    <div class="fg form-full">
      <label class="fl">รายการ <span class="req">*</span></label>
      <select class="fi bom-item-sel" style="padding:7px 9px">
        <option value="">-- เลือกรายการ --</option>
        ${itemOpts}
      </select>
    </div>
    <div class="fg">
      <label class="fl">จำนวนต่อหน่วยผลิต <span class="req">*</span></label>
      <input class="fi bom-item-qty" type="number" min="0.001" step="0.001" value="${item.qty_per_unit||''}" placeholder="0.00" inputmode="decimal">
    </div>
    <button onclick="this.closest('.bom-item-row').remove()"
      style="position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px">✕</button>
  </div>`;
}

function onBomPgChange(sel, idx) {
  const pg = sel.value;
  const row = sel.closest('.bom-item-row');
  const itemSel = row.querySelector('.bom-item-sel');
  const opts = masterDB.filter(m => !pg || m.pg===pg)
    .map(m=>`<option value="${m.code}" data-name="${m.name}" data-pg="${m.pg}">${m.name}</option>`).join('');
  itemSel.innerHTML = '<option value="">-- เลือกรายการ --</option>' + opts;
}

function addBomItem() {
  const container = document.getElementById('bomEditItems');
  const idx = container.children.length;
  container.insertAdjacentHTML('beforeend', _bomItemRow(idx));
}

async function saveBomRecipe() {
  const id = document.getElementById('bomEditId').value;
  const name = document.getElementById('bomEditName').value.trim();
  const description = document.getElementById('bomEditDesc').value.trim();
  const output_qty = parseFloat(document.getElementById('bomEditQty').value)||1;
  const output_unit = document.getElementById('bomEditUnit').value.trim()||'ชุด';

  if (!name) { showToast('กรุณาใส่ชื่อสูตร','err'); return; }

  // รวบรวม items
  const rows = [...document.querySelectorAll('#bomEditItems .bom-item-row')];
  const items = [];
  for (const row of rows) {
    const sel = row.querySelector('.bom-item-sel');
    const qty = parseFloat(row.querySelector('.bom-item-qty').value);
    if (!sel.value || !qty) continue;
    const opt = sel.options[sel.selectedIndex];
    items.push({ code: sel.value, name: opt.text, pg: opt.dataset.pg, qty });
  }
  if (!items.length) { showToast('กรุณาเพิ่มรายการในสูตรอย่างน้อย 1 รายการ','err'); return; }

  const recipe = { name, description, output_qty, output_unit, items };
  if (id) {
    await dbUpdateBomRecipe(parseInt(id), recipe);
  } else {
    await dbSaveBomRecipe(recipe);
  }
  closeModal('bomEditModal');
  showToast('บันทึกสูตรเรียบร้อย');
  await dbLoadBomRecipes();
  _renderBomContent(document.getElementById('page-bom'));
}

async function deleteBomRecipe(id) {
  if (!confirm('ลบสูตรนี้?')) return;
  await dbDeleteBomRecipe(id);
  showToast('ลบสูตรเรียบร้อย');
  await dbLoadBomRecipes();
  _renderBomContent(document.getElementById('page-bom'));
}

/* ── หน้าทำแพคเกจ ── */
function openPackaging(recipeId) {
  const r = bomRecipes.find(x=>x.id===recipeId);
  if (!r) return;
  document.getElementById('pkgRecipeId').value = recipeId;
  document.getElementById('pkgRecipeName').textContent = r.name;
  document.getElementById('pkgQty').value = '';
  document.getElementById('pkgOperator').value = window._operatorName||'';
  document.getElementById('pkgPreview').innerHTML = '';
  // เลือกแผนก
  const deptEl = document.getElementById('pkgDept');
  if (deptEl) selRadio(deptEl.querySelector('.radio-opt'), 'pkgDept');
  document.getElementById('pkgModal').classList.add('show');
}

function updatePkgPreview() {
  const recipeId = parseInt(document.getElementById('pkgRecipeId').value);
  const qty = parseFloat(document.getElementById('pkgQty').value)||0;
  const r = bomRecipes.find(x=>x.id===recipeId);
  if (!r || qty<=0) { document.getElementById('pkgPreview').innerHTML=''; return; }

  const rows = (r.bom_items||[]).map((item,idx) => {
    const needed = item.qty_per_unit * qty;
    const m = masterDB.find(x=>x.code===item.item_code);
    const avail = m?.stock||0;
    const ok = avail >= needed;
    const cfg = WAREHOUSE_CONFIG[item.pg];
    const hasLot = cfg?.hasLot;

    let lotCell = '';
    if (hasLot) {
      const lots = (lotDB[item.item_code]||[]).filter(l=>l.stock>0)
        .sort((a,b)=>new Date(a.lot_sw)-new Date(b.lot_sw));
      if (lots.length) {
        const opts = lots.map(l => {
          const sw = new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
          return `<option value="${l.id}" data-sw="${l.lot_sw}" data-stock="${l.stock}">${sw} (เหลือ ${l.stock.toLocaleString()})</option>`;
        }).join('');
        lotCell = `<select class="fi pkg-lot-sel" data-code="${item.item_code}" data-idx="${idx}"
          style="font-size:11px;padding:3px 6px;margin-top:4px">
          <option value="auto">เลือกอัตโนมัติ (FIFO)</option>
          ${opts}
        </select>`;
      } else {
        lotCell = '<span style="font-size:10px;color:var(--red)">ไม่มี Lot</span>';
      }
    }

    return `<tr>
      <td>
        <div style="font-weight:500">${item.item_name}</div>
        ${lotCell}
      </td>
      <td style="text-align:center;color:var(--ink3);font-size:11px">${cfg?.label||item.pg}</td>
      <td style="text-align:right;font-weight:600">${needed.toLocaleString()}</td>
      <td style="text-align:right;color:${ok?'var(--green)':'var(--red)'}">${avail.toLocaleString()}</td>
      <td style="text-align:center">${ok?'<i class="ti ti-check" style="color:var(--green)"></i>':'<i class="ti ti-x" style="color:var(--red)"></i>'}</td>
    </tr>`;
  }).join('');

  document.getElementById('pkgPreview').innerHTML = `
    <table class="hist-table" style="margin-top:10px">
      <thead><tr>
        <th>รายการ / Lot</th><th style="text-align:center">คลัง</th>
        <th style="text-align:right">ต้องการ</th><th style="text-align:right">มีอยู่</th><th style="text-align:center">สถานะ</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function submitPackaging() {
  const recipeId = parseInt(document.getElementById('pkgRecipeId').value);
  const qty = parseFloat(document.getElementById('pkgQty').value);
  const opName = (document.getElementById('pkgOperator').value||'').trim();
  const dept = document.querySelector('#pkgDept .radio-opt.sel')?.textContent?.trim()||'';
  const r = bomRecipes.find(x=>x.id===recipeId);

  if (!r) return;
  if (!qty||qty<=0) { showToast('กรุณาระบุจำนวนที่ต้องการผลิต','err'); return; }
  if (!opName) { showToast('กรุณาระบุผู้ทำรายการ','err'); return; }

  // เช็คว่าของพอไหม
  const items = r.bom_items||[];
  for (const item of items) {
    const needed = item.qty_per_unit * qty;
    const m = masterDB.find(x=>x.code===item.item_code);
    if (!m || m.stock < needed) {
      showToast(`${item.item_name} ไม่พอ (มี ${m?.stock||0} ต้องการ ${needed})`, 'err');
      return;
    }
  }

  setLoading('pkgSubmitBtn', true, 'กำลังเบิก...');

  // เบิกออกทุกรายการ
  for (const item of items) {
    const needed = item.qty_per_unit * qty;
    const m = masterDB.find(x=>x.code===item.item_code);
    if (!m) continue;

    const cfg = WAREHOUSE_CONFIG[item.pg];
    const hasLot = cfg?.hasLot;

    if (hasLot) {
      const lotSelEl = document.querySelector(`.pkg-lot-sel[data-code="${item.item_code}"]`);
      const lotSelVal = lotSelEl?.value || 'auto';

      if (lotSelVal !== 'auto') {
        // ใช้ lot ที่เลือก — เช็คว่าพอไหม
        const lot = (lotDB[item.item_code]||[]).find(l=>String(l.id)===lotSelVal);
        if (!lot) { showToast(`ไม่พบ Lot ของ ${item.item_name}`,'err'); setLoading('pkgSubmitBtn',false); return; }
        if (lot.stock < needed) {
          showToast(`${item.item_name} — Lot ที่เลือกมีไม่พอ (มี ${lot.stock.toLocaleString()} ต้องการ ${needed.toLocaleString()})`, 'err');
          setLoading('pkgSubmitBtn', false);
          return;
        }
        const sw = lotSelEl.options[lotSelEl.selectedIndex]?.dataset?.sw || lot.lot_sw;
        await dbAdjustStockWithLot(item.item_code, 'withdraw', needed, { lotId: lot.id, lotSW: sw });
      } else {
        // FIFO อัตโนมัติ
        const lots = (lotDB[item.item_code]||[]).filter(l=>l.stock>0).sort((a,b)=>new Date(a.lot_sw)-new Date(b.lot_sw));
        let remaining = needed;
        for (const lot of lots) {
          if (remaining <= 0) break;
          const take = Math.min(lot.stock, remaining);
          await dbAdjustStockWithLot(item.item_code, 'withdraw', take, { lotId: lot.id, lotSW: lot.lot_sw });
          remaining -= take;
        }
      }
    } else {
      await dbAdjustStockWithLot(item.item_code, 'withdraw', needed, {});
    }

    // บันทึก transaction
    const rec = {
      item_code: item.item_code, item_name: item.item_name, pg: item.pg,
      action_type: 'withdraw', quantity: needed,
      operator_name: opName, department: dept,
      note: `แพคเกจ: ${r.name} × ${qty} ${r.output_unit}`, via: 'manual'
    };
    await dbInsertTransaction(rec);
  }

  setLoading('pkgSubmitBtn', false);
  closeModal('pkgModal');
  showToast(`ทำแพคเกจ "${r.name}" × ${qty} ${r.output_unit} เรียบร้อย`);
  checkAlerts();
  if (curPage==='bom') renderBomPage();
}

async function dbLoadBinLocations() {
  const { data, error } = await sb.from('bin_locations')
    .select('*').order('code', { ascending: true });
  if (error) { console.error('dbLoadBins:', error.message); return; }
  binLocations = (data || []).sort((a,b) => {
    if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
    if (a.row  !== b.row)  return a.row.localeCompare(b.row);
    return String(a.level).localeCompare(String(b.level), undefined, {numeric:true});
  });
}

async function dbSaveBinLocation(zone, row, level, label='') {
  const { data, error } = await sb.from('bin_locations')
    .insert({ zone, row, level, label })
    .select().single();
  if (error) { console.error('dbSaveBin:', error.message); return null; }
  binLocations.push(data);
  return data;
}

async function dbAssignBin(itemCode, binCode) {
  locationDB[itemCode] = binCode;
  const m = masterDB.find(x => x.code===itemCode);
  if (m) await dbUpsertItem(m);
}

function buildBinSelectHtml(selectedCode='') {
  if (!binLocations.length) return '<option value="">ยังไม่มีพิกัด — เพิ่มที่หน้า Master</option>';
  const zones = [...new Set(binLocations.map(b=>b.zone))];
  return '<option value="">-- เลือกพิกัด --</option>' +
    zones.map(z => {
      const bins = binLocations.filter(b=>b.zone===z);
      return `<optgroup label="โซน ${z}">${
        bins.map(b=>`<option value="${b.code}" ${b.code===selectedCode?'selected':''}>${b.code}${b.label?' ('+b.label+')':''}</option>`).join('')
      }</optgroup>`;
    }).join('');
}

/* ═══════════════════════════════════════════
   QR INBOUND / OUTBOUND FLOW
═══════════════════════════════════════════ */
/**
 * parseScanCode — แยก QR payload ออกเป็น { type, itemCode, lotSW }
 * รองรับ 2 รูปแบบ:
 *   1. SWBD_RM_PD_0001              → item scan
 *   2. SWBD_RM_PD_0001__LOT__2025-05-19 → lot scan
 */
function parseScanCode(raw) {
  if (raw.includes('__LOT__')) {
    const [itemCode, lotSW] = raw.split('__LOT__');
    return { type: 'lot', itemCode: itemCode.trim(), lotSW: lotSW.trim() };
  }
  return { type: 'item', itemCode: raw.trim(), lotSW: '' };
}

/**
 * handleScanResult — เรียกเมื่อสแกน QR ได้ ทั้งจากกล้องและ QR sidebar
 * ถ้าสแกนได้ lot QR → autofill ทั้ง item และ lot date ในฟอร์ม
 */
function handleScanResult(raw, pg) {
  const parsed = parseScanCode(raw);
  const m = masterDB.find(x => x.code === parsed.itemCode);
  if (!m) return { found: false };

  // autofill item
  const di = document.getElementById(pg+'-idisplay');
  const iv = document.getElementById(pg+'-ival');
  if (di) di.value = m.name;
  if (iv) iv.value = m.name;

  // autofill lot date ถ้าเป็น lot QR
  if (parsed.type === 'lot' && parsed.lotSW) {
    const sw = document.getElementById(pg+'-lotsw');
    if (sw) sw.value = parsed.lotSW;
    // autofill lot picker
    const pickerList = document.getElementById(pg+'-lot-picker-list');
    if (pickerList && (WAREHOUSE_CONFIG[pg]?.hasLot)) {
      buildLotPickerHtml(m.code, pg).then(html => {
        pickerList.innerHTML = html;
        const action = txState[pg]?.action;
        if (action==='withdraw'||action==='return_good'||action==='return_bad') {
          const first = pickerList.querySelector('.lot-select-item');
          if (first) pickLot(first, pg, first.dataset.lot);
        }
      });
    }
  }

  // autofill location
  if (locationDB[m.code]) {
    const locEl = document.getElementById(pg+'-loc');
    if (locEl) locEl.value = locationDB[m.code];
  }

  return { found: true, item: m, lotSW: parsed.lotSW };
}


function validateForm(pg, skipLot = false) {
  const errors = [];
  const name = (document.getElementById(pg+'-name')?.value||'').trim();
  const item = document.getElementById(pg+'-ival')?.value || document.getElementById(pg+'-idisplay')?.value?.trim() || '';
  const qty  = parseFloat(document.getElementById(pg+'-qty')?.value||0);
  const deptEl = document.querySelector('#'+pg+'-dept .sel');
  const cfg  = WAREHOUSE_CONFIG[pg];
  const action = txState[pg].action;

  if (!name)   errors.push('กรุณาระบุชื่อผู้ทำรายการ');
  if (!item)   errors.push('กรุณาเลือกรายการ');
  if (!qty || qty <= 0) errors.push('กรุณาระบุจำนวนที่มากกว่า 0');
  // dept จาก user profile อัตโนมัติ

  // stock check for withdraw
  if (!skipLot && (action === 'withdraw') && item) {
    const mi = masterDB.find(m => m.name===item);
    if (mi && qty > mi.stock) errors.push(`สต็อกไม่พอ (มี ${mi.stock} เหลือ)`);
  }

  // lot SW ไม่บังคับ — user เลือกเองได้

  return errors;
}

function showValidationErrors(errors) {
  if (!errors.length) return;
  showToast(errors[0], 'err');
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
function pad2(n) { return String(n).padStart(2,'0'); }
function timeNow() { const d=new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dateToday() {
  const d=new Date();
  const m=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()+543}`;
}
function stockStatus(m) {
  if (m.min<=0 && m.max<=0) return 'ok';
  if (m.stock<=0) return 'out';
  if (m.stock<=m.min) return 'low';
  return 'ok';
}
function getAlertItems(pg, group) {
  return masterDB.filter(m => {
    if (pg && m.pg!==pg) return false;
    if (group && ALERT_GROUPS) {
      const g = ALERT_GROUPS[group];
      if (!g || !g.includes(m.pg)) return false;
    }
    if (m.min <= 0) return false;           // ไม่นับถ้าไม่ได้ตั้ง Min
    return m.stock < m.min;                  // ต่ำกว่า Min (ไม่รวม stock === min)
  });
}
/* ═══════════════════════════════════════════
   HISTORY EDIT/DELETE — เฉพาะ admin/manager
═══════════════════════════════════════════ */
function canEditHistory() {
  const role = window._operatorRole || '';
  return role === 'admin' || role === 'manager' || role === 'warehouse';
}

/** แก้ไขวันที่ทำรายการ — เฉพาะ admin/warehouse เท่านั้น */
function canEditDate() {
  const role = window._operatorRole || '';
  return role === 'admin' || role === 'warehouse';
}

/** จัดการ Master (เพิ่ม/แก้ไข/ลบสินค้า, ตั้งค่า Min/Max) — เฉพาะ admin/warehouse */
function canManageMaster() {
  const role = window._operatorRole || '';
  return role === 'admin' || role === 'warehouse';
}

/**
 * applyStockDelta — เรียก RPC ปรับสต็อกตาม action/qty/lot
 * ใช้ทั้งตอน "ย้อนผลเดิม" (กลับด้าน action) และ "ใช้ค่าใหม่"
 * คืนค่า { ok, ... } จาก dbAdjustStockWithLot
 */
async function applyStockDelta(code, type, qty, lotSW, name) {
  if (type === 'return_bad' || !qty) return { ok: true, skipped: true };
  let lotId = null;
  if (lotSW && lotSW !== '-') {
    if (!lotDB[code]) await dbLoadLotsForItem(code);
    const cached = (lotDB[code]||[]).find(l => l.lot_sw === lotSW);
    if (cached) lotId = cached.id;
  }
  return await dbAdjustStockWithLot(code, type, qty, {
    lotId,
    lotSW: (type==='receive'||type==='return_good') && lotSW && lotSW!=='-' ? lotSW : null,
    name,
  });
}

/** การกระทำตรงข้าม สำหรับ "ย้อนผลเดิม" */
function oppositeAction(type) {
  if (type === 'receive' || type === 'return_good') return 'withdraw';
  if (type === 'withdraw') return 'return_good';
  return null; // return_bad — ไม่กระทบสต็อก
}

function openEditTxById(id, pg) {
  const rec = (txState[pg]?.records||[]).find(x=>x.id==id);
  if (!rec) { showToast('ไม่พบรายการ','err'); return; }
  openEditTx(rec, pg);
}

function openEditTx(rec, pg) {
  if (!canEditHistory()) return;
  const cfg = WAREHOUSE_CONFIG[pg];
  document.getElementById('editTxId').value = rec.id;
  document.getElementById('editTxPg').value = pg;
  document.getElementById('editTxOrigJson').value = JSON.stringify(rec);
  document.getElementById('editTxItem').textContent = `${rec.item} (${rec.code})`;
  document.getElementById('editTxType').value = rec.type;
  document.getElementById('editTxQty').value = rec.qty;
  document.getElementById('editTxName').value = rec.name;
  document.getElementById('editTxNote').value = rec.note || '';

  // วันที่ทำรายการ — แก้ได้เฉพาะ admin
  const dateRow = document.getElementById('editTxDateRow');
  const dateInput = document.getElementById('editTxDate');
  if (canEditDate()) {
    dateRow.style.display = 'block';
    // rec.rawCreatedAt เป็น ISO string จาก DB — แปลงเป็น local datetime-local format
    if (rec.rawCreatedAt) {
      const d = new Date(rec.rawCreatedAt);
      const pad = n => String(n).padStart(2,'0');
      const localStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      dateInput.value = localStr;
    } else {
      dateInput.value = '';
    }
  } else {
    dateRow.style.display = 'none';
    dateInput.value = '';
  }

  // แผนก
  const deptSel = document.getElementById('editTxDept');
  deptSel.innerHTML = (cfg.depts||[]).map(d=>`<option value="${d}" ${d===rec.dept?'selected':''}>${d}</option>`).join('');

  // Lot row — แสดงเฉพาะคลังที่มี lot
  const lotRow = document.getElementById('editTxLotRow');
  if (cfg.hasLot) {
    lotRow.style.display = 'grid';
    buildEditTxLotOptions(rec, pg);
  } else {
    lotRow.style.display = 'none';
  }

  onEditTxTypeChange();
  document.getElementById('editTxModal').classList.add('show');
}

async function buildEditTxLotOptions(rec, pg) {
  const sel = document.getElementById('editTxLot');
  sel.innerHTML = `<option value="">กำลังโหลด...</option>`;
  await dbLoadLotsForItem(rec.code);
  const lots = (lotDB[rec.code]||[]).slice().sort((a,b)=>new Date(a.lot_sw)-new Date(b.lot_sw));
  let opts = `<option value="">-- ไม่ระบุ Lot --</option>`;
  opts += lots.map(l=>{
    const dateStr = new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
    const sel_ = l.lot_sw===rec.lotSW ? 'selected':'';
    return `<option value="${l.lot_sw}" ${sel_}>${dateStr} — คงเหลือ ${l.stock.toLocaleString()}</option>`;
  }).join('');
  // ถ้า lot เดิมของรายการนี้ไม่อยู่ใน list (เช่น lot ถูกใช้หมดแล้ว) ให้เพิ่มเข้าไปด้วย
  if (rec.lotSW && rec.lotSW!=='-' && !lots.find(l=>l.lot_sw===rec.lotSW)) {
    const dateStr = new Date(rec.lotSW).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
    opts += `<option value="${rec.lotSW}" selected>${dateStr} (Lot เดิม)</option>`;
  }
  sel.innerHTML = opts;
}

function onEditTxTypeChange() {
  const type = document.getElementById('editTxType').value;
  const dateWrap = document.getElementById('editTxLotDateWrap');
  // สำหรับ receive — เลือกวันที่ Lot ใหม่แทน dropdown lot ที่มีอยู่
  if (type === 'receive') {
    dateWrap.style.display = 'block';
    const sel = document.getElementById('editTxLot');
    const dateInput = document.getElementById('editTxLotDate');
    if (sel.value) dateInput.value = sel.value;
  } else {
    dateWrap.style.display = 'none';
  }
}

async function saveEditTx() {
  if (!canEditHistory()) return;
  const id    = document.getElementById('editTxId').value;
  const pg    = document.getElementById('editTxPg').value;
  const orig  = JSON.parse(document.getElementById('editTxOrigJson').value);
  const cfg   = WAREHOUSE_CONFIG[pg];

  const newType = document.getElementById('editTxType').value;
  const newQty  = parseFloat(document.getElementById('editTxQty').value);
  const newName = (document.getElementById('editTxName').value||'').trim();
  const newDept = document.getElementById('editTxDept').value;
  const newNote = document.getElementById('editTxNote').value||'';
  let   newLotSW = cfg.hasLot ? (document.getElementById('editTxLot').value || '') : '';
  if (cfg.hasLot && newType==='receive') {
    const lotDate = document.getElementById('editTxLotDate').value;
    if (lotDate) newLotSW = lotDate;
  }

  if (!newName) { showToast('กรุณาระบุชื่อผู้ทำรายการ','err'); return; }
  if (!newQty || newQty<=0) { showToast('กรุณาระบุจำนวนที่มากกว่า 0','err'); return; }

  setLoading('editTxSaveBtn', true, 'กำลังบันทึก...');

  const mi = masterDB.find(m => m.code === orig.code);
  let finalOldStock = orig.oldStock;
  let finalNewStock = orig.newStock;

  if (mi) {
    // ── 1) ย้อนผลเดิมกลับ ──
    const revertType = oppositeAction(orig.type);
    if (revertType) {
      const revertRes = await applyStockDelta(orig.code, revertType, orig.qty, orig.lotSW, orig.item);
      if (!revertRes.ok) { setLoading('editTxSaveBtn', false); return; }
    }
    // ── 2) ใช้ค่าใหม่กับสต็อกปัจจุบัน ──
    const applyType = newType;
    if (applyType !== 'return_bad') {
      const applyRes = await applyStockDelta(orig.code, applyType, newQty, newLotSW || null, newName);
      if (!applyRes.ok) {
        // rollback การย้อนผล ถ้าใช้ค่าใหม่ไม่สำเร็จ (เช่นสต็อกไม่พอ) — กลับไปใช้ action เดิม
        if (revertType) await applyStockDelta(orig.code, orig.type, orig.qty, orig.lotSW, orig.item);
        setLoading('editTxSaveBtn', false);
        return;
      }
      finalOldStock = mi.stock - (applyType==='withdraw' ? -newQty : newQty);
      finalNewStock = mi.stock;
    } else {
      finalOldStock = mi.stock;
      finalNewStock = mi.stock;
    }
    await dbUpsertItem(mi);
  }

  // ── 3) อัปเดตแถว transaction ──
  const updatePayload = {
    action_type:  newType,
    quantity:     newQty,
    operator_name:newName,
    department:   newDept,
    lot_sw:       (newLotSW && newLotSW!=='-') ? newLotSW : null,
    note:         newNote,
    old_stock:    finalOldStock,
    new_stock:    finalNewStock,
  };
  // วันที่ทำรายการ — แก้ได้เฉพาะ admin
  if (canEditDate()) {
    const dateVal = document.getElementById('editTxDate')?.value;
    if (dateVal) {
      const d = new Date(dateVal); // local time → JS Date handles tz conversion on toISOString
      if (!isNaN(d.getTime())) updatePayload.created_at = d.toISOString();
    }
  }
  const { error } = await sb.from('transactions').update(updatePayload).eq('id', id);

  setLoading('editTxSaveBtn', false);
  if (error) { showToast('บันทึกไม่สำเร็จ: '+error.message,'err'); return; }

  // ── 4) sync local cache ──
  const r = txState[pg].records.find(x=>x.id==id);
  if (r) {
    r.type=newType; r.typeLabel=ACTION_LABELS[newType];
    r.qty=newQty; r.name=newName; r.dept=newDept; r.note=newNote;
    r.lotSW=(newLotSW&&newLotSW!=='-')?newLotSW:'-';
    r.oldStock=finalOldStock; r.newStock=finalNewStock;
    if (updatePayload.created_at) {
      r.rawCreatedAt = updatePayload.created_at;
      const d = new Date(updatePayload.created_at);
      r.time = d.toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'});
      r.timeDetail = d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    }
  }

  closeModal('editTxModal');
  checkAlerts();
  // ถ้าแก้วันที่ ลำดับการเรียงอาจเปลี่ยน — เรียง records ใหม่
  if (updatePayload.created_at) {
    txState[pg].records.sort((a,b)=> new Date(b.rawCreatedAt) - new Date(a.rawCreatedAt));
  }
  renderHistory(pg);
  if (curPage==='master') renderMasterContent();
  showToast('แก้ไขรายการสำเร็จ');
}

async function deleteTx(id, pg) {
  if (!canEditHistory()) return;
  if (!confirm('ลบรายการนี้และย้อนผลสต็อกที่เกิดจากรายการนี้?')) return;

  const r = txState[pg].records.find(x=>x.id==id);
  if (!r) return;

  const mi = masterDB.find(m => m.code === r.code);
  if (mi) {
    const revertType = oppositeAction(r.type);
    if (revertType) {
      const revertRes = await applyStockDelta(r.code, revertType, r.qty, r.lotSW, r.item);
      if (!revertRes.ok) return;
    }
    await dbUpsertItem(mi);
  }

  const { error } = await sb.from('transactions').delete().eq('id', id);
  if (error) { showToast('ลบไม่สำเร็จ: '+error.message,'err'); return; }

  txState[pg].records = txState[pg].records.filter(x=>x.id!=id);
  checkAlerts();
  renderHistory(pg);
  if (curPage==='master') renderMasterContent();
  showToast('ลบรายการสำเร็จ');
}

function checkAlerts() {
  const alerts = getAlertItems(null);
  // อัปเดต dot และ count
  const dot = document.getElementById('alertDot');
  if (dot) dot.style.display = alerts.length ? 'block' : 'none';
  const cnt = document.getElementById('alertCount');
  if (cnt) { cnt.textContent = alerts.length||''; cnt.style.display = alerts.length?'flex':'none'; }
  // อัปเดต alert bar ถ้ามี
  const bar = document.getElementById('alertBar');
  if (bar) {
    if (alerts.length) {
      bar.style.display = 'flex';
      const names = alerts.slice(0,5).map(m=>m.name).join(', ');
      const more  = alerts.length > 5 ? ` และอีก ${alerts.length-5} รายการ` : '';
      const barText = document.getElementById('alertBarText');
      if (barText) barText.textContent = `สต็อกต่ำ ${alerts.length} รายการ: ${names}${more}`;
    } else {
      bar.style.display = 'none';
    }
  }
}

function renderAlertList(alerts) {
  if (!alerts.length) {
    return '<div style="padding:16px;text-align:center;font-size:12px;color:var(--ink3)"><i class="ti ti-check" style="font-size:20px;display:block;margin-bottom:8px;opacity:.5"></i>ไม่มีรายการ</div>';
  }
  return alerts.map(m => {
    const cfg = WAREHOUSE_CONFIG[m.pg];
    const pct = m.max > 0 ? Math.min(100, Math.round(m.stock/m.max*100)) : 0;
    const cls = m.stock <= 0 ? 'fill-out' : 'fill-low';
    const leadInfo = SUPPLIER_FIELDS === 'days' && m.lead_time_days
      ? 'Lead '+m.lead_time_days+' วัน'
      : SUPPLIER_FIELDS === 'date' && m.next_delivery_date
      ? 'ส่งของ '+new Date(m.next_delivery_date).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'})
      : '';
    const supplierLine = (m.supplier_name || leadInfo)
      ? `<div style="font-size:10px;color:var(--ink3);margin-top:1px">${m.supplier_name ? 'ผจห. '+m.supplier_name : ''}${m.supplier_name && leadInfo ? ' · ' : ''}${leadInfo}</div>`
      : '';
    return `<div style="padding:9px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;cursor:pointer" onclick="document.getElementById('alertPanelWrap').classList.remove('show');switchPage('${m.pg}')">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.name}</div>
        <div style="font-size:10px;color:var(--ink3);margin-top:1px">${cfg?.label||m.pg} · Min ${m.min}</div>
        ${supplierLine}
        <div class="stock-bar" style="width:100%;margin-top:4px"><div class="stock-bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:14px;font-weight:600;color:${m.stock<=0?'var(--red)':'var(--warn)'}">${m.stock}</div>
        <div style="font-size:9px;color:var(--ink4)">${m.stock<=0?'หมด':'ต่ำ'}</div>
      </div>
    </div>`;
  }).join('');
}

function toggleAlertPanel() {
  const wrap = document.getElementById('alertPanelWrap');
  if (!wrap) return;
  if (wrap.classList.contains('show')) {
    wrap.classList.remove('show');
  } else {
    openAlertPanel();
  }
}

function openAlertPanel(tab) {
  const panel = document.getElementById('alertPanel');
  if (!panel) return;

  if (ALERT_GROUPS) {
    // โหมดแบ่งกลุ่ม (เช่น Tea House: สั่งซื้อ / เบิก)
    window._alertTab = tab || window._alertTab || Object.keys(ALERT_GROUPS)[0];
    const tabLabels = { purchase:'สั่งซื้อ', withdraw:'เบิก' };
    const tabsHtml = Object.keys(ALERT_GROUPS).map(g => {
      const active = g === window._alertTab;
      return `<div onclick="openAlertPanel('${g}')" style="flex:1;text-align:center;padding:7px 0;font-size:11px;font-weight:500;cursor:pointer;border-bottom:2px solid ${active?'var(--ink)':'transparent'};color:${active?'var(--ink)':'var(--ink3)'}">${tabLabels[g]||g}</div>`;
    }).join('');
    const alerts = getAlertItems(null, window._alertTab);
    panel.innerHTML = `<div style="display:flex;border-bottom:1px solid var(--line)">${tabsHtml}</div><div>${renderAlertList(alerts)}</div>`;
  } else {
    // โหมดเดิม — แจ้งเตือนรวมทุกคลัง
    const alerts = getAlertItems(null);
    panel.innerHTML = renderAlertList(alerts);
  }

  const wrap = document.getElementById('alertPanelWrap');
  if (!wrap) return;
  wrap.classList.add('show');
}

function showToast(msg, type='ok') {
  const bg = type==='ok' ? '#2d6a4f' : '#7a2020';
  const icon = type==='ok' ? 'circle-check' : 'alert-circle';
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;background:${bg};color:#fff;padding:11px 16px;border-radius:9px;font-size:12px;z-index:9999;display:flex;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:320px;animation:fadeIn .2s`;
  t.innerHTML = `<i class="ti ti-${icon}" style="font-size:16px;flex-shrink:0"></i><span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function setLoading(btnId, on, loadingText='กำลังบันทึก...') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  btn.dataset.origText = btn.dataset.origText || btn.innerHTML;
  btn.innerHTML = on
    ? `<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> ${loadingText}`
    : btn.dataset.origText;
}

function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }

/* ═══════════════════════════════════════════
   BATCH — localStorage persistence
═══════════════════════════════════════════ */
function saveBatchLS() {
  try { localStorage.setItem('swbd_batch_v2', JSON.stringify(batchDB)); } catch(e){}
}
function loadBatchLS() {
  try {
    const s = localStorage.getItem('swbd_batch_v2');
    if (s) { const b=JSON.parse(s); WAREHOUSE_PAGES.forEach(pg=>{if(b[pg])batchDB[pg]=b[pg];}); }
  } catch(e){}
}

/* ═══════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════ */
function switchPage(p) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${p}"]`)?.classList.add('active');
  // รวมทุกหน้าเพื่อให้ซ่อนครบ
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

/* ═══════════════════════════════════════════
   WAREHOUSE PAGE
═══════════════════════════════════════════ */
function renderWarehousePage(pg) {
  const cfg = WAREHOUSE_CONFIG[pg];
  const div = document.getElementById('page-'+pg);
  if (!div) return;

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">${cfg.label}</div>
        <div class="page-sub">รับเข้า · เบิก · คืนดี · คืนเสีย</div></div>
      <div class="page-actions">
        <button class="btn btn-sm" onclick="exportTransactionsCsv('${pg}')" title="Export ประวัติรายการ">
          <i class="ti ti-table-export"></i> Export</button>
        <button class="cam-btn" onclick="openCamera('${pg}')">
          <i class="ti ti-camera"></i> กล้อง</button>
        <button class="qr-btn" onclick="openQR('${pg}')">
          <i class="ti ti-qrcode"></i> QR</button>
      </div>
    </div>
    <div class="wh-layout">
      <div class="wh-left">
        <div class="card">
          <div class="card-title">
            <div class="card-title-left">
              <span id="${pg}-ftitle">รับเข้า — ${cfg.label}</span>
              <span class="badge badge-receive" id="${pg}-fbadge">รับเข้า</span>
            </div>
          </div>
          <div id="${pg}-fbody"></div>
        </div>
        <div class="card" id="${pg}-batch-card" style="display:none">
          <div class="card-title" style="color:var(--grn)">
            <div class="card-title-left">
              <i class="ti ti-list-check"></i> รายการที่เพิ่มไว้
              <span class="mcount" id="${pg}-batch-count">0</span>
            </div>
            <button class="btn btn-sm" onclick="clearBatch('${pg}')">ล้าง</button>
          </div>
          <div id="${pg}-batch-list"></div>
          <div style="margin-top:10px;display:flex;gap:6px;justify-content:flex-end">
            <button class="btn btn-primary" id="${pg}-batch-submit-btn" onclick="submitBatch('${pg}')">
              <i class="ti ti-device-floppy"></i> บันทึกทั้งหมด
            </button>
          </div>
        </div>
      </div>
      <div class="wh-right">
        <div class="card">
          <div class="card-title">
            <div class="card-title-left">
              ประวัติรายการ <span class="mcount" id="${pg}-hcount">0</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="position:relative">
                <i class="ti ti-search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--ink4);pointer-events:none"></i>
                <input class="fi" id="${pg}-hist-search" type="text" placeholder="ค้นหาชื่อ/รหัส..." 
                  style="padding:5px 10px 5px 28px;font-size:11px;width:160px;height:30px"
                  oninput="filterHistory('${pg}')">
              </div>
              <button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="clearHistSearch('${pg}')" title="ล้างการค้นหา"><i class="ti ti-x"></i></button>
            </div>
          </div>
          <div class="hist-wrap">
            <table class="hist-table">
              <thead><tr>
                <th>วันที่</th><th>ประเภท</th><th>ผู้ทำรายการ</th>
                <th>แผนก</th><th>รายการ</th><th>รหัส</th><th>จำนวน</th>
                ${cfg.hasLot ? '<th>Lot SW</th>' : ''}
                ${cfg.lotSupplier ? '<th>Lot Supplier</th>' : ''}
                ${canEditHistory() ? '<th></th>' : ''}
              </tr></thead>
              <tbody id="${pg}-hbody">
                <tr><td colspan="${(cfg.hasLot?(cfg.lotSupplier?9:8):7)+(canEditHistory()?1:0)}">
                  <div class="empty">
                    <i class="ti ti-notes"></i>
                    <div class="empty-text">ยังไม่มีรายการ</div>
                  </div>
                </td></tr>
              </tbody>
            </table>
          </div>
          <div class="hist-pager" id="${pg}-hpager"></div>
        </div>
      </div>
    </div>`;

  renderForm(pg);
  renderHistory(pg);
  renderBatchCard(pg);
}

/* ── FORM ── */
function renderForm(pg) {
  const cfg    = WAREHOUSE_CONFIG[pg];
  const action = txState[pg].action;
  const isRecv = action === 'receive';
  const isRB   = action === 'return_bad';
  const body   = document.getElementById(pg+'-fbody');
  if (!body) return;

  const t = document.getElementById(pg+'-ftitle');
  const b = document.getElementById(pg+'-fbadge');
  if (t) t.textContent = `${ACTION_LABELS[action]} — ${cfg.label}`;
  if (b) { b.textContent=ACTION_LABELS[action]; b.className='badge '+ACTION_BADGE[action]; }

  if (action === 'transform_lot') { renderTransformForm(pg); return; }

  const deptOpts = cfg.depts.map(d =>
    `<label class="radio-opt" onclick="selRadio(this,'${pg}-dept')"><input type="radio"> ${d}</label>`
  ).join('');

  let h = '';
  if (isRB) h += `<div class="info-bar warn"><i class="ti ti-info-circle"></i> บันทึกในประวัติ — ไม่หักสต็อก</div>`;

  h += `<div class="action-select-wrap">
    <span class="action-select-label">ประเภท</span>
    <select class="action-select" id="${pg}-action-sel" onchange="switchAction('${pg}',this.value)">
      ${Object.entries(ACTION_LABELS).filter(([v])=>(v!=='transform_lot'||cfg.hasLot)&&v!=='transform_out'&&v!=='transform_in').map(([v,l])=>`<option value="${v}" ${action===v?'selected':''}>${l}</option>`).join('')}
    </select>
    <i class="ti ti-chevron-down action-select-icon"></i>
  </div>`;

  h += `<div class="form-grid">
    <div class="fg form-full">
      <label class="fl">ผู้ทำรายการ <span class="req">*</span></label>
      <input class="fi" id="${pg}-name" placeholder="ชื่อ-นามสกุล" autocomplete="name">
    </div>
  </div><div class="divider"></div>`;

  h += `<div class="form-grid">
    <div class="fg form-full">
      <label class="fl">รายการ <span class="req">*</span></label>
      <div class="item-wrap">
        <input class="item-input" id="${pg}-idisplay" placeholder="พิมพ์เพื่อค้นหา"
          oninput="ddFilter('${pg}',this.value)" onfocus="ddShow('${pg}')"
          autocomplete="off">
        <button class="item-btn" onclick="ddToggle('${pg}')">
          <i class="ti ti-chevron-down"></i>
        </button>
        <div class="dd" id="${pg}-dd" style="display:none">
          <div class="dd-search">
            <input id="${pg}-dds" placeholder="ค้นหา..."
              oninput="ddListFilter('${pg}',this.value)">
          </div>
          <div id="${pg}-ddl"></div>
        </div>
      </div>
      <input type="hidden" id="${pg}-ival">
    </div>
    <div class="fg">
      <label class="fl">จำนวน <span class="req">*</span></label>
      <input class="fi" id="${pg}-qty" type="number" min="0.01" step="0.01"
        placeholder="0.00" inputmode="decimal">
    </div>
  </div>`;

  // Lot fields
  if (cfg.hasLot) {
    h += '<div class="divider"></div>';
    if (!isRecv && (WAREHOUSE_CONFIG[pg]?.hasLot)) {
      // เบิก/คืน raw, finish และ matcha: แสดง lot picker
      h += `<div class="fg">
        <label class="fl">Lot Sawanbondin</label>
        <input class="fi" id="${pg}-lotsw" type="date">
        <div class="fhint">เลือก Lot ที่ต้องการเบิก/คืน</div>
      </div>
      <div class="lot-select-wrap" id="${pg}-lot-picker">
        <div class="lot-select-label">
          <i class="ti ti-stack" style="font-size:10px"></i> Lot ที่มีอยู่
        </div>
        <div id="${pg}-lot-picker-list">
          <div class="lot-empty">เลือกรายการก่อนเพื่อดู Lot</div>
        </div>
      </div>`;
    } else if (cfg.lotSupplier) {
      h += `<div class="lot-pair">
        <div class="fg">
          <label class="fl">Lot Sawanbondin</label>
          <input class="fi" id="${pg}-lotsw" type="date">
          <div class="fhint">วันที่รับเข้า Sawanbondin</div>
        </div>
        <div class="fg">
          <label class="fl">Lot Supplier</label>
          <input class="fi" id="${pg}-lotsp" type="date">
          <div class="fhint">วันที่ผลิตของ Supplier</div>
        </div>
      </div>`;
      if (cfg.hasExpiry) {
        h += `<div class="lot-single" style="margin-top:8px">
          <div class="fg">
            <label class="fl">วันหมดอายุ</label>
            <input class="fi" id="${pg}-expiry" type="date">
            <div class="fhint">ไม่บังคับกรอก</div>
          </div>
        </div>`;
      }
      // ช่องกรอกถุง — เฉพาะตอนรับเข้า สำหรับคลังที่มี hasLot
      if (isRecv && cfg.hasLot) {
        h += `<div class="divider"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label class="fl" style="margin:0">น้ำหนักแต่ละถุง (กก.)</label>
          <button type="button" class="btn btn-sm" onclick="addBagRow('${pg}')" style="font-size:10px">
            <i class="ti ti-plus"></i> เพิ่มถุง
          </button>
        </div>
        <div id="${pg}-bag-rows"></div>
        <div id="${pg}-bag-summary" style="background:var(--s2);border-radius:var(--r);padding:8px 12px;margin-top:6px;font-size:11px;color:var(--ink3);display:flex;gap:16px">
          <span>ถุง: <strong id="${pg}-bag-count">0</strong> ใบ</span>
          <span>รวม: <strong id="${pg}-bag-total">0</strong> กก.</span>
          <span>เฉลี่ย: <strong id="${pg}-bag-avg">0</strong> กก./ถุง</span>
        </div>
        <div class="fhint" style="margin-top:4px">ถ้าไม่กรอก จะรับเป็น 1 lot ตามจำนวนในช่องด้านบน</div>`;
        setTimeout(() => { const br=document.getElementById(pg+'-bag-rows'); if(br&&!br.children?.length) addBagRow(pg); }, 100);
      }
    } else {
      h += `<div class="lot-single">
        <div class="fg">
          <label class="fl">Lot Sawanbondin</label>
          <input class="fi" id="${pg}-lotsw" type="date">
        </div>
      </div>`;
      // ช่องกรอกถุงสำหรับ finish
      if (isRecv && cfg.hasLot) {
        h += `<div class="divider"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label class="fl" style="margin:0">จำนวนชิ้น/กล่องแต่ละถุง</label>
          <button type="button" class="btn btn-sm" onclick="addBagRow('${pg}')" style="font-size:10px">
            <i class="ti ti-plus"></i> เพิ่มถุง
          </button>
        </div>
        <div id="${pg}-bag-rows"></div>
        <div id="${pg}-bag-summary" style="background:var(--s2);border-radius:var(--r);padding:8px 12px;margin-top:6px;font-size:11px;color:var(--ink3);display:flex;gap:16px">
          <span>ถุง: <strong id="${pg}-bag-count">0</strong> ใบ</span>
          <span>รวม: <strong id="${pg}-bag-total">0</strong> ชิ้น</span>
        </div>
        <div class="fhint" style="margin-top:4px">ถ้าไม่กรอก จะรับเป็น 1 lot ตามจำนวนในช่องด้านบน</div>`;
        setTimeout(() => { const br=document.getElementById(pg+'-bag-rows'); if(br&&!br.children?.length) addBagRow(pg); }, 100);
      }
    }
  }

  if (isRecv && cfg.rawFields) {
    h += `<div class="divider"></div>
    <div class="form-grid-3">
      <div class="fg"><label class="fl">สายพันธุ์</label>
        <input class="fi" id="${pg}-variety" placeholder="เช่น อัสสัม"></div>
      <div class="fg"><label class="fl">แหล่งที่มา</label>
        <input class="fi" id="${pg}-origin" placeholder="เช่น เชียงราย"></div>
      <div class="fg"><label class="fl">กระบวนการผลิต</label>
        <input class="fi" id="${pg}-process" placeholder="เช่น คั่ว, หมัก"></div>
    </div>
    <div class="fg" style="margin-top:10px">
      <label class="fl">มีการปรับปรุงอะไรมาบ้าง</label>
      <textarea class="fta" id="${pg}-improve" placeholder="ระบุการปรับปรุง..."></textarea>
    </div>`;
  } else {
    h += `<div class="fg" style="margin-top:10px">
      <label class="fl">${isRB?'สาเหตุการคืนเสีย':'หมายเหตุ'}</label>
      <textarea class="fta" id="${pg}-note"
        placeholder="${isRB?'ระบุสาเหตุ...':'หมายเหตุเพิ่มเติม...'}"></textarea>
    </div>`;
    if(cfg?.hasSpec && action==='receive'){
      h += `<div class="fg" style="margin-top:10px">
        <label class="fl"><i class="ti ti-file-description" style="font-size:11px"></i> สเปกอุปกรณ์</label>
        <textarea class="fta" id="${pg}-spec" rows="4"
          placeholder="รายละเอียดและคุณสมบัติของอุปกรณ์..."></textarea>
        <div class="fhint">จะอัปเดตข้อมูลสเปกในหน้า Master ด้วย</div>
      </div>`;
    }
  }

  // ข้อ 3: location ใช้ได้ทุก action (เพื่อดู/แก้ไข) แต่ save เฉพาะ receive
  {
    const locVal = '';
    const binOpts = binLocations.length
      ? binLocations.map(b=>`<option value="${b.code}">${b.code}${b.label?' — '+b.label:''}</option>`).join('')
      : '';
    h += `<div class="fg" style="margin-top:10px">
      <label class="fl"><i class="ti ti-map-pin" style="font-size:11px"></i> สถานที่จัดเก็บ</label>
      <div style="display:flex;gap:5px">
        <select class="fi" id="${pg}-loc-select" style="padding:7px 9px;flex:1" onchange="syncLocFromSelect('${pg}')">
          <option value="">-- เลือกพิกัด --</option>
          ${binOpts}
        </select>
        <input class="fi" id="${pg}-loc" placeholder="หรือพิมพ์เอง" autocomplete="off" style="flex:1"
          oninput="syncLocFromInput('${pg}')">
      </div>
      <div class="fhint">เลือกจาก dropdown หรือพิมพ์เองก็ได้</div>
    </div>`;
  }

  h += `<div class="form-actions">
    <button class="btn" onclick="resetForm('${pg}')">
      <i class="ti ti-refresh"></i> ล้าง</button>
    <button class="btn" onclick="addToBatch('${pg}')"
      style="border-color:var(--acc-mid);color:var(--acc)">
      <i class="ti ti-circle-plus"></i> เพิ่มในรายการ</button>
    <button class="btn btn-primary" id="${pg}-submit-btn" onclick="submitF('${pg}')">
      <i class="ti ti-device-floppy"></i> บันทึกทันที</button>
  </div>`;

  body.innerHTML = h;
  buildDDList(pg, '');
  // autofill ชื่อและแผนกจาก login
  if(window._operatorName){
    const nameEl=document.getElementById(pg+'-name');
    if(nameEl&&!nameEl.value)nameEl.value=window._operatorName;
  }
  // autofill แผนก
  if(window._operatorDept){
    setTimeout(()=>{
      document.querySelectorAll('#'+pg+'-dept .radio-opt').forEach(o=>{
        if(o.textContent.trim()===window._operatorDept){
          o.classList.add('sel');
        }
      });
    },50);
  }
}

/* ── TRANSFORM / แปรรูป FORM ── */
function renderTransformForm(pg) {
  const cfg  = WAREHOUSE_CONFIG[pg];
  const body = document.getElementById(pg+'-fbody');
  if (!body) return;

  let h = `<div class="info-bar" style="background:var(--acc-bg);color:var(--acc);border-color:var(--acc-mid)">
    <i class="ti ti-recycle"></i> แปรรูป/ปรับสภาพ — เบิก Lot เดิมออก แล้วสร้าง Lot ใหม่เข้าในสินค้าเดิม
  </div>`;

  // เลือกสินค้า
  h += `<div class="form-grid">
    <div class="fg form-full">
      <label class="fl">รายการ <span class="req">*</span></label>
      <div class="item-wrap">
        <input class="item-input" id="${pg}-tf-idisplay" placeholder="พิมพ์เพื่อค้นหา"
          oninput="ddFilter('${pg}',this.value,true)" onfocus="ddShow('${pg}')"
          autocomplete="off">
        <button class="item-btn" onclick="ddToggle('${pg}')">
          <i class="ti ti-chevron-down"></i>
        </button>
        <div class="dd" id="${pg}-dd" style="display:none">
          <div class="dd-search">
            <input id="${pg}-dds" placeholder="ค้นหา..."
              oninput="ddListFilter('${pg}',this.value,true)">
          </div>
          <div id="${pg}-ddl"></div>
        </div>
      </div>
      <input type="hidden" id="${pg}-tf-ival">
    </div>
  </div><div class="divider"></div>`;

  // Lot ต้นทาง + จำนวนที่นำไปแปรรูป
  h += `<div class="form-grid">
    <div class="fg form-full">
      <label class="fl">Lot ต้นทาง <span class="req">*</span></label>
      <select class="fi" id="${pg}-tf-fromlot" onchange="onTransformLotChange('${pg}')">
        <option value="">-- เลือกรายการก่อน --</option>
      </select>
      <div class="fhint">เฉพาะ Lot ที่มียอดคงเหลือมากกว่า 0</div>
    </div>
  </div>
  <div class="form-grid">
    <div class="fg">
      <label class="fl">จำนวนที่นำไปแปรรูปทั้งหมด <span class="req">*</span></label>
      <input class="fi" id="${pg}-tf-qtyout" type="number" min="0.01" step="0.01"
        placeholder="0.00" inputmode="decimal" oninput="updateTransformSummary('${pg}')">
      <div class="fhint" id="${pg}-tf-avail"></div>
    </div>
  </div><div class="divider"></div>`;

  // Batch ย่อย
  h += `<div style="margin-bottom:8px">
    <div style="font-size:12px;font-weight:500;color:var(--ink);margin-bottom:8px">
      <i class="ti ti-git-branch"></i> Batch ผลลัพธ์ (B1, B2, ...)
      <span style="font-size:10px;color:var(--ink3);margin-left:6px">เพิ่มได้หลาย batch</span>
    </div>
    <div id="${pg}-tf-batches"></div>
    <button class="btn btn-sm" style="margin-top:8px" onclick="addTransformBatch('${pg}')">
      <i class="ti ti-plus"></i> เพิ่ม Batch
    </button>
  </div>`;

  // สรุปยอด
  h += `<div class="info-bar" id="${pg}-tf-summary" style="display:none"></div>`;

  h += `<div class="form-actions">
    <button class="btn" onclick="resetForm('${pg}')">
      <i class="ti ti-refresh"></i> ล้าง</button>
    <button class="btn btn-primary" id="${pg}-tf-submit-btn" onclick="submitTransform('${pg}')">
      <i class="ti ti-device-floppy"></i> บันทึกแปรรูป</button>
  </div>`;

  body.innerHTML = h;
  buildDDList(pg, '', true);

  // เพิ่ม batch แรกอัตโนมัติ
  addTransformBatch(pg);

  [pg+'-tf-qtyout'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', ()=>updateTransformSummary(pg));
  });
}

function addTransformBatch(pg) {
  const container = document.getElementById(pg+'-tf-batches');
  if (!container) return;
  const idx = container.children.length + 1;
  const div = document.createElement('div');
  div.className = 'form-grid';
  div.style.cssText = 'background:var(--s2);border-radius:var(--r);padding:10px;margin-bottom:8px;position:relative';
  div.innerHTML = `
    <div class="fg">
      <label class="fl">B${idx} — วันที่ Lot ใหม่ <span class="req">*</span></label>
      <input class="fi tf-batch-date" type="date" oninput="updateTransformSummary('${pg}')">
    </div>
    <div class="fg">
      <label class="fl">น้ำหนักหลังแปรรูป <span class="req">*</span></label>
      <input class="fi tf-batch-qty" type="number" min="0.01" step="0.01" placeholder="0.00"
        inputmode="decimal" oninput="updateTransformSummary('${pg}')">
    </div>
    <div class="fg form-full">
      <label class="fl">หมายเหตุ Batch นี้</label>
      <input class="fi tf-batch-note" placeholder="เช่น B${idx} — อบ 100 องศา / 1 ชั่วโมง">
    </div>
    ${idx > 1 ? `<button onclick="this.closest('.form-grid').remove();updateTransformSummary('${pg}')"
      style="position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px">✕</button>` : ''}
  `;
  container.appendChild(div);
  updateTransformSummary(pg);
}


// เมื่อเลือกสินค้าจาก dropdown ในโหมดแปรรูป — โหลด Lot ของสินค้านั้น
async function onTransformItemSelect(pg, code, name) {
  document.getElementById(pg+'-tf-ival').value = code;
  document.getElementById(pg+'-tf-idisplay').value = name;
  const sel = document.getElementById(pg+'-tf-fromlot');
  sel.innerHTML = `<option value="">กำลังโหลด Lot...</option>`;
  if (!lotDB[code]) await dbLoadLotsForItem(code);
  const lots = (lotDB[code]||[]).filter(l=>l.stock>0).sort((a,b)=>a.lot_sw.localeCompare(b.lot_sw));
  if (!lots.length) {
    sel.innerHTML = `<option value="">-- ไม่มี Lot ที่มียอดคงเหลือ --</option>`;
    return;
  }
  sel.innerHTML = `<option value="">-- เลือก Lot --</option>` +
    lots.map(l=>{
      const dateStr = new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
      const supStr  = l.lot_supplier ? ` (${l.lot_supplier})` : '';
      return `<option value="${l.id}" data-stock="${l.stock}" data-sw="${l.lot_sw}">${dateStr}${supStr} — คงเหลือ ${l.stock.toLocaleString()}</option>`;
    }).join('');
  document.getElementById(pg+'-tf-avail').textContent = '';
  updateTransformSummary(pg);
}

function onTransformLotChange(pg) {
  const sel = document.getElementById(pg+'-tf-fromlot');
  const opt = sel.options[sel.selectedIndex];
  const avail = opt?.dataset?.stock;
  const hint = document.getElementById(pg+'-tf-avail');
  if (avail) hint.textContent = `คงเหลือใน Lot นี้: ${parseFloat(avail).toLocaleString()}`;
  else hint.textContent = '';
  updateTransformSummary(pg);
}

function updateTransformSummary(pg) {
  const m = masterDB.find(x=>x.code===document.getElementById(pg+'-tf-ival')?.value);
  const sel = document.getElementById(pg+'-tf-fromlot');
  const opt = sel?.options[sel.selectedIndex];
  const qtyOut = parseFloat(document.getElementById(pg+'-tf-qtyout')?.value)||0;
  const box = document.getElementById(pg+'-tf-summary');
  if (!m || !opt?.value) { if(box) box.style.display='none'; return; }

  // รวม qty จาก batches ทั้งหมด
  const batchQtys = [...document.querySelectorAll(`#${pg}-tf-batches .tf-batch-qty`)]
    .map(el=>parseFloat(el.value)||0);
  const totalBatchQty = batchQtys.reduce((a,b)=>a+b, 0);
  const remaining = qtyOut - totalBatchQty;

  if (!box) return;
  box.style.display = '';
  const color = Math.abs(remaining) < 0.001 ? 'var(--green)' : remaining < 0 ? 'var(--red)' : 'var(--warn)';
  box.innerHTML = `<i class="ti ti-calculator"></i>
    นำไปแปรรูป <strong>${qtyOut.toLocaleString()}</strong> →
    Batch รวม <strong>${totalBatchQty.toLocaleString()}</strong>
    <span style="color:${color};margin-left:6px">${remaining > 0.001 ? `ยังขาด ${remaining.toLocaleString()}` : remaining < -0.001 ? `เกิน ${Math.abs(remaining).toLocaleString()}` : '✓ ครบพอดี'}</span>`;
}

async function submitTransform(pg) {
  const code   = document.getElementById(pg+'-tf-ival')?.value;
  const itemEl = document.getElementById(pg+'-tf-idisplay');
  const name   = itemEl?.value || '';
  const sel    = document.getElementById(pg+'-tf-fromlot');
  const fromLotId = sel?.value;
  const fromOpt   = sel?.options[sel.selectedIndex];
  const qtyOut = parseFloat(document.getElementById(pg+'-tf-qtyout')?.value);
  const opName   = window._operatorName || '';
  const opDept   = window._operatorDept || '';

  if (!code) { showToast('กรุณาเลือกรายการ','err'); return; }
  if (!fromLotId) { showToast('กรุณาเลือก Lot ต้นทาง','err'); return; }
  if (!qtyOut || qtyOut<=0) { showToast('กรุณาระบุจำนวนที่นำไปแปรรูป','err'); return; }

  const avail = parseFloat(fromOpt?.dataset?.stock)||0;
  if (qtyOut > avail) { showToast(`Lot ต้นทางมีไม่พอ (มี ${avail.toLocaleString()} เหลือ)`,'err'); return; }

  // เก็บ batch ย่อยทั้งหมด
  const batchContainers = [...document.querySelectorAll(`#${pg}-tf-batches .form-grid`)];
  const batches = batchContainers.map((div, i) => ({
    date: div.querySelector('.tf-batch-date')?.value,
    qty:  parseFloat(div.querySelector('.tf-batch-qty')?.value),
    note: (div.querySelector('.tf-batch-note')?.value||'').trim(),
    label: `B${i+1}`,
  }));

  for (const b of batches) {
    if (!b.date) { showToast('กรุณาระบุวันที่ Lot ทุก Batch','err'); return; }
    if (!b.qty || b.qty <= 0) { showToast('กรุณาระบุน้ำหนักทุก Batch','err'); return; }
  }

  const totalQtyIn = batches.reduce((s,b)=>s+b.qty, 0);
  if (Math.abs(totalQtyIn - qtyOut) > 0.001) {
    if (!confirm(`น้ำหนัก batch รวม (${totalQtyIn.toLocaleString()}) ไม่ตรงกับที่นำไปแปรรูป (${qtyOut.toLocaleString()})\nบันทึกต่อไปหรือไม่?`)) return;
  }

  setLoading(pg+'-tf-submit-btn', true, 'กำลังบันทึก...');

  const fromLotSW = fromOpt?.dataset?.sw || '';
  const fromDateStr = fromLotSW ? new Date(fromLotSW).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
  const baseTx = { item_code:code, item_name:name, pg, operator_name:opName, department:opDept, via:'manual' };

  // บันทึก transform_out ครั้งเดียว
  const result = await dbTransformStockLot(code, parseInt(fromLotId), qtyOut, batches[0].date, batches[0].qty, batches[0].note);
  setLoading(pg+'-tf-submit-btn', false);
  if (!result.ok) return;

  await dbInsertTransaction({
    ...baseTx, action_type:'transform_out', quantity:qtyOut,
    lot_sw:fromLotSW, note:`แปรรูปออก ${qtyOut.toLocaleString()} → ${batches.length} Batch`,
    old_stock:result.old_stock, new_stock:result.new_stock,
  });

  // บันทึก transform_in แยกตาม batch
  for (const b of batches) {
    const newDateStr = new Date(b.date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
    // สำหรับ batch ที่ 2 เป็นต้นไป ต้องเรียก RPC แยก
    if (batches.indexOf(b) > 0) {
      await dbTransformStockLot(code, parseInt(fromLotId), 0, b.date, b.qty, b.note);
    }
    await dbInsertTransaction({
      ...baseTx, action_type:'transform_in', quantity:b.qty,
      lot_sw:b.date, note:`${b.label} ← Lot ${fromDateStr}${b.note?' — '+b.note:''}`,
      old_stock:result.old_stock, new_stock:result.new_stock,
    });
  }

  showToast(`แปรรูปสำเร็จ — ${batches.length} Batch`);
  checkAlerts();
  if (curPage===pg) {
    const recs = await dbLoadTransactions(pg);
    if (recs) txState[pg].records = recs;
    renderWarehousePage(pg);
    renderHistory(pg,1);
  }
}

function switchAction(pg, action) {
  const sv = {
    name: document.getElementById(pg+'-name')?.value||'',
    ival: document.getElementById(pg+'-ival')?.value||'',
    idisp: document.getElementById(pg+'-idisplay')?.value||'',
    qty:  document.getElementById(pg+'-qty')?.value||'',
    dept: window._operatorDept||'',
  };
  txState[pg].action = action;
  renderForm(pg);
  if (sv.name)  { const el=document.getElementById(pg+'-name');     if(el)el.value=sv.name; }
  if (sv.ival)  { const iv=document.getElementById(pg+'-ival');     if(iv)iv.value=sv.ival; }
  if (sv.idisp) { const di=document.getElementById(pg+'-idisplay'); if(di)di.value=sv.idisp; }
  if (sv.qty)   { const qe=document.getElementById(pg+'-qty');      if(qe)qe.value=sv.qty; }
  if (sv.dept)  {
    document.querySelectorAll('#'+pg+'-dept .radio-opt').forEach(o=>{
      if (o.textContent.trim()===sv.dept) o.classList.add('sel');
    });
  }
  // ── ถ้ามีรายการที่เลือกอยู่แล้ว และ action เป็นเบิก/คืน → โหลด Lot picker + auto-select ──
  if (sv.ival && (WAREHOUSE_CONFIG[pg]?.hasLot)) {
    const m = masterDB.find(x=>x.code===sv.ival || x.name===sv.idisp);
    const pickerList = document.getElementById(pg+'-lot-picker-list');
    if (m && pickerList && (action==='withdraw'||action==='return_good'||action==='return_bad')) {
      buildLotPickerHtml(m.code, pg).then(html => {
        pickerList.innerHTML = html;
        const first = pickerList.querySelector('.lot-select-item');
        if (first) pickLot(first, pg, first.dataset.lot);
      });
    }
  }
}
function resetForm(pg) {
  const a = txState[pg].action;
  renderWarehousePage(pg); txState[pg].action=a; renderForm(pg);
}

/* ── DROPDOWN ── */
function buildDDList(pg, filter, isTransform=false) {
  const l = document.getElementById(pg+'-ddl');
  if (!l) return;
  const filt  = filter.toLowerCase();
  const items = masterDB.filter(m => m.pg===pg && m.name.toLowerCase().includes(filt));
  if (!items.length) {
    l.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--ink3)">ไม่พบรายการ</div>';
    return;
  }
  const groups = {};
  items.forEach(m => { const g=m.subcat||'-'; if(!groups[g])groups[g]=[]; groups[g].push(m); });
  let h = '';
  for (const [grp, grpItems] of Object.entries(groups)) {
    if (grp!=='-') h += `<div class="dd-grp-label">${grp}</div>`;
    grpItems.forEach(m => {
      const es = m.name.replace(/'/g,"\\'");
      h += `<div class="dd-item" onclick="${isTransform?`selTransformItem('${pg}','${es}','${m.code}')`:`selItem('${pg}','${es}','${m.code}')`}">
        <span>${m.name}</span><span class="dd-code">${m.code}</span>
      </div>`;
    });
  }
  l.innerHTML = h;
}
function ddFilter(pg,v,isTransform=false){ buildDDList(pg,v,isTransform); document.getElementById(pg+'-dd').style.display='block'; if(!isTransform){const iv=document.getElementById(pg+'-ival');if(iv)iv.value='';} }
function ddListFilter(pg,v,isTransform=false){ buildDDList(pg,v,isTransform); }
function ddShow(pg)        { const idispId=document.getElementById(pg+'-tf-idisplay')?pg+'-tf-idisplay':pg+'-idisplay'; const isTransform=idispId.includes('-tf-'); buildDDList(pg,document.getElementById(idispId)?.value||'',isTransform); document.getElementById(pg+'-dd').style.display='block'; }
function ddToggle(pg)      { const d=document.getElementById(pg+'-dd'); if(!d)return; d.style.display=d.style.display==='none'?'block':'none'; if(d.style.display==='block')ddShow(pg); }
function selTransformItem(pg, item, code) {
  document.getElementById(pg+'-tf-idisplay').value = item;
  document.getElementById(pg+'-tf-ival').value = code;
  document.getElementById(pg+'-dd').style.display='none';
  onTransformItemSelect(pg, code, item);
}
function selItem(pg, item, code) {
  const di=document.getElementById(pg+'-idisplay');
  const iv=document.getElementById(pg+'-ival');
  const dd=document.getElementById(pg+'-dd');
  if(di)di.value=item; if(iv)iv.value=item; if(dd)dd.style.display='none';
  // ค้นหาด้วย code ก่อน (แม่นยำกว่า) แล้วค่อย fallback เป็นชื่อ+คลัง
  const m = code
    ? masterDB.find(x=>x.code===code)
    : masterDB.find(x=>x.name===item&&x.pg===pg);
  if(m&&locationDB[m.code]){
    const locEl=document.getElementById(pg+'-loc');if(locEl)locEl.value=locationDB[m.code];
    const sel=document.getElementById(pg+'-loc-select');
    if(sel){const opt=[...sel.options].find(o=>o.value===locationDB[m.code]);sel.value=opt?locationDB[m.code]:'';}
  }
  const pickerList=document.getElementById(pg+'-lot-picker-list');
  if(m&&pickerList&&(WAREHOUSE_CONFIG[pg]?.hasLot)) {
    pickerList.innerHTML='<div class="lot-empty"><i class="ti ti-loader" style="animation:spin .8s linear infinite"></i> โหลด Lot...</div>';
    buildLotPickerHtml(m.code,pg).then(html=>{
      pickerList.innerHTML=html;
      // ── auto-select Lot แรก (FIFO เก่าสุด) สำหรับ เบิก/คืน ──
      const action = txState[pg]?.action;
      if (action==='withdraw'||action==='return_good'||action==='return_bad') {
        const first = pickerList.querySelector('.lot-select-item');
        if (first) pickLot(first, pg, first.dataset.lot);
      }
    });
  }
}
document.addEventListener('click', e => {
  WAREHOUSE_PAGES.forEach(pg=>{
    const dd=document.getElementById(pg+'-dd');
    const inp=document.getElementById(pg+'-idisplay');
    if(dd&&inp&&!dd.contains(e.target)&&e.target!==inp&&!e.target.closest('.item-btn'))
      dd.style.display='none';
  });
});
/* ── Bag weight functions ── */
function addBagRow(pg) {
  const container = document.getElementById(pg+'-bag-rows');
  if (!container) return;
  const idx = container.children.length + 1;
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:28px 1fr 32px;gap:6px;align-items:center;margin-bottom:6px';
  row.innerHTML = `
    <span style="font-size:11px;color:var(--ink4);text-align:center;font-weight:500">${idx}</span>
    <input class="fi bag-weight-input" type="number" min="0.01" step="0.01" inputmode="decimal"
      placeholder="น้ำหนัก กก." oninput="updateBagSummary('${pg}')">
    <button type="button" onclick="this.closest('div').remove();reindexBags('${pg}');updateBagSummary('${pg}')"
      style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px;padding:0">✕</button>`;
  container.appendChild(row);
  updateBagSummary(pg);
  row.querySelector('input')?.focus();
}

function reindexBags(pg) {
  const container = document.getElementById(pg+'-bag-rows');
  if (!container) return;
  [...container.children].forEach((row, i) => {
    const numEl = row.querySelector('span');
    if (numEl) numEl.textContent = i + 1;
  });
}

function updateBagSummary(pg) {
  const container = document.getElementById(pg+'-bag-rows');
  if (!container) return;
  const weights = [...container.querySelectorAll('.bag-weight-input')]
    .map(el => parseFloat(el.value)||0).filter(w => w > 0);
  const total = weights.reduce((s,w) => s+w, 0);
  const avg = weights.length ? (total/weights.length) : 0;
  const fmt = n => n.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const cntEl = document.getElementById(pg+'-bag-count');
  const totEl = document.getElementById(pg+'-bag-total');
  const avgEl = document.getElementById(pg+'-bag-avg');
  if (cntEl) cntEl.textContent = weights.length;
  if (totEl) totEl.textContent = fmt(total);
  if (avgEl) avgEl.textContent = fmt(avg);
  // sync qty field ถ้ากรอกถุงแล้ว
  const qtyEl = document.getElementById(pg+'-qty');
  if (qtyEl && total > 0) qtyEl.value = total;
}

function selRadio(el,gid){
  document.querySelectorAll('#'+gid+' .radio-opt').forEach(o=>o.classList.remove('sel'));
  el.classList.add('sel');
}

/* ── LOT PICKER ── */
async function buildLotPickerHtml(code, pg) {
  await dbLoadLotsForItem(code);
  // ข้อ 3: เรียงเก่าก่อน (FIFO) · ข้อ 4: ซ่อน lot หมด
  const lots = (lotDB[code]||[])
    .filter(l => l.stock > 0)
    .sort((a,b) => new Date(a.lot_sw) - new Date(b.lot_sw));
  if(!lots.length) return '<div class="lot-empty">ไม่มี Lot ที่มีสต็อกเหลืออยู่</div>';
  return lots.map(l=>{
    const sw = l.lot_sw ? new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '?';
    const sp = l.lot_supplier ? new Date(l.lot_supplier).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
    const ex = l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
    const isExpired = l.expiry_date && new Date(l.expiry_date) < new Date();
    const bagInfo = l.bag_number ? `ถุง ${l.bag_number}/${l.bag_total}` : (l.note||'');
    const weightInfo = l.weight_kg ? `${l.weight_kg.toLocaleString()} กก.` : '';
    return `<div class="lot-select-item${isExpired?' lot-expired':''}" onclick="pickLot(this,'${pg}','${l.lot_sw}','${l.id}')" data-lot="${l.lot_sw}" data-lot-id="${l.id}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="lot-date">${sw}</span>
          ${bagInfo?`<span style="font-size:10px;color:var(--ink2);font-weight:500">${bagInfo}</span>`:''}
          ${weightInfo?`<span style="font-size:10px;color:var(--acc);font-weight:500">${weightInfo}</span>`:''}
          ${sp?`<span style="font-size:10px;color:var(--ink3)">Sup: ${sp}</span>`:''}
          ${ex?`<span style="font-size:10px;color:${isExpired?'var(--red)':'var(--ink4)'}">หมดอายุ: ${ex}</span>`:''}
        </div>
      </div>
      <span class="lot-sel-stock">คงเหลือ ${l.stock}</span>
    </div>`;
  }).join('');
}
function pickLot(el,pg,lotSW,lotId){
  el.closest('.lot-select-wrap').querySelectorAll('.lot-select-item').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
  const sw=document.getElementById(pg+'-lotsw'); if(sw)sw.value=lotSW;
  const hi=document.getElementById(pg+'-lot-id-hidden'); if(hi) hi.value=lotId||'';
}

/* ── SUBMIT SINGLE ── */
async function submitF(pg) {
  const errors = validateForm(pg);
  if (errors.length) { showValidationErrors(errors); return; }

  const cfg    = WAREHOUSE_CONFIG[pg];
  const name   = document.getElementById(pg+'-name').value.trim();
  const itemName = document.getElementById(pg+'-ival')?.value||document.getElementById(pg+'-idisplay')?.value?.trim()||'';
  const qty    = parseFloat(document.getElementById(pg+'-qty').value);
  const lotSW  = cfg.hasLot ? (document.getElementById(pg+'-lotsw')?.value||'') : '';
  const lotSP  = cfg.lotSupplier ? (document.getElementById(pg+'-lotsp')?.value||'') : '';
  const expiry = cfg.hasExpiry ? (document.getElementById(pg+'-expiry')?.value||'') : '';
  const note   = document.getElementById(pg+'-note')?.value||document.getElementById(pg+'-improve')?.value||'';
  const locSelectVal = (document.getElementById(pg+'-loc-select')?.value||'').trim();
  const locInputVal  = (document.getElementById(pg+'-loc')?.value||'').trim();
  const loc = locSelectVal || locInputVal;
  const action = txState[pg].action;
  const dept   = window._operatorDept||'';

  // ── ถุง ──
  const bagContainer = document.getElementById(pg+'-bag-rows');
  const bagWeights = bagContainer
    ? [...bagContainer.querySelectorAll('.bag-weight-input')]
        .map(el => parseFloat(el.value)||0).filter(w => w > 0)
    : [];
  const hasBags = bagWeights.length > 0 && action === 'receive' && cfg.hasLot;

  setLoading(pg+'-submit-btn', true);
  const mi   = masterDB.find(m=>m.name===itemName && m.pg===pg);
  const item = itemName;
  const code = mi ? mi.code : '-';

  let rpcResult = { ok: true, new_stock: mi?.stock };
  if (mi) {
    if (action !== 'return_bad') {
      if (hasBags) {
        // บันทึกแต่ละถุงแยก lot row
        const bagTotal = bagWeights.length;
        let newStock = mi.stock;
        for (let i = 0; i < bagWeights.length; i++) {
          const w = bagWeights[i];
          const bagNote = `ถุงที่ ${i+1}/${bagTotal}`;
          // สร้าง lot แยกต่างหากแต่ละถุง
          const { data: lotData } = await sb.from('lots').insert({
            item_code: code, item_name: item,
            lot_sw: lotSW || null, lot_supplier: lotSP || null,
            stock: w, weight_kg: w,
            bag_number: i+1, bag_total: bagTotal,
            qr_payload: `${code}__LOT__${lotSW}__BAG${i+1}__${Date.now()}`,
            note: bagNote,
          }).select().single();
          newStock += w;
          // อัปเดต items.stock
          await sb.from('items').update({ stock: newStock }).eq('code', code);
          mi.stock = newStock;
        }
        rpcResult = { ok: true, new_stock: mi.stock };
      } else {
        let lotId = null;
        if ((WAREHOUSE_CONFIG[pg]?.hasLot) && lotSW && (action==='withdraw'||action==='return_good')) {
          const cached = (lotDB[code]||[]).find(l=>l.lot_sw===lotSW);
          if (cached) lotId = cached.id;
        }
        rpcResult = await dbAdjustStockWithLot(code, action, qty, {
          lotId,
          lotSW: (cfg.hasLot && lotSW && lotSW.length > 0) ? lotSW : null,
          lotSP: (lotSP && lotSP.length > 0) ? lotSP : null,
          expiry: (expiry && expiry.length > 0) ? expiry : null,
          name: item,
          note: (pg==='raw' && action==='receive') ? note : null,
        });
        if (!rpcResult.ok) { setLoading(pg+'-submit-btn', false); return; }
        if (rpcResult.new_stock !== undefined) mi.stock = rpcResult.new_stock;
      }
    }
    if (action==='receive' && loc) locationDB[code] = loc;
    if (action==='receive' && cfg?.hasSpec) {
      const spec=(document.getElementById(pg+'-spec')?.value||'').trim();
      if(spec) specDB[code]=spec;
    }
    await dbUpsertItem(mi);
  }

  if (true) {
    const rec={
      time:dateToday(), timeDetail:timeNow(), type:action, typeLabel:ACTION_LABELS[action],
      name, dept, item, code, qty,
      lotSW:lotSW||'-', lotSP, note, pg, via:'manual',
      oldStock: rpcResult.ok ? (rpcResult.new_stock - (action==='receive'||action==='return_good' ? qty : -qty)) : null,
      newStock:  rpcResult.ok ? rpcResult.new_stock : null,
    };
    txState[pg].records.unshift(rec);
    rec.id = await dbInsertTransaction(rec);
    checkAlerts();
    renderHistory(pg);
    // อัปเดตตัวเลขใน Master ถ้ากำลังดูอยู่
    if (curPage === 'master') renderMasterContent();
    const a=action; resetForm(pg); txState[pg].action=a;
    showToast(`"${item}" ${qty} — ${ACTION_LABELS[action]}`);
  }
  setLoading(pg+'-submit-btn', false);
}

/* ── BATCH ── */
function addToBatch(pg) {
  const errors = validateForm(pg, true);
  if (errors.length) { showValidationErrors(errors); return; }
  const cfg    = WAREHOUSE_CONFIG[pg];
  const item   = document.getElementById(pg+'-ival')?.value||document.getElementById(pg+'-idisplay')?.value?.trim()||'';
  const qty    = parseFloat(document.getElementById(pg+'-qty').value);
  const lotSW  = cfg.hasLot?(document.getElementById(pg+'-lotsw')?.value||''):'';
  const lotSP  = cfg.lotSupplier?(document.getElementById(pg+'-lotsp')?.value||''):'';
  const note   = document.getElementById(pg+'-note')?.value||document.getElementById(pg+'-improve')?.value||'';
  // ข้อ 1: ดึง loc จาก select ก่อน ถ้าไม่มีค่อยดึงจาก free-text input
  const locSelectVal = (document.getElementById(pg+'-loc-select')?.value||'').trim();
  const locInputVal  = (document.getElementById(pg+'-loc')?.value||'').trim();
  const loc = locSelectVal || locInputVal;
  const action = txState[pg].action;
  // ค้นหาด้วย pg + ชื่อ ให้ตรงคลัง
  const mi     = masterDB.find(m=>m.name===item && m.pg===pg);
  batchDB[pg].push({item,code:mi?mi.code:'-',qty,lotSW,lotSP,note,loc,action,typeLabel:ACTION_LABELS[action]});
  saveBatchLS(); renderBatchCard(pg);
  const di=document.getElementById(pg+'-idisplay');if(di)di.value='';
  const iv=document.getElementById(pg+'-ival');if(iv)iv.value='';
  const qe=document.getElementById(pg+'-qty');if(qe)qe.value='';
}
function removeBatchRow(pg,idx){ batchDB[pg].splice(idx,1); saveBatchLS(); renderBatchCard(pg); }
function clearBatch(pg){ batchDB[pg]=[]; saveBatchLS(); renderBatchCard(pg); }
function renderBatchCard(pg){
  const card=document.getElementById(pg+'-batch-card');
  const list=document.getElementById(pg+'-batch-list');
  const cnt=document.getElementById(pg+'-batch-count');
  if(!card||!list) return;
  const rows=batchDB[pg]||[];
  if(!rows.length){card.style.display='none';return;}
  card.style.display='block';
  if(cnt)cnt.textContent=rows.length;
  list.innerHTML=rows.map((r,i)=>`<div class="batch-row">
    <div class="batch-row-name">${r.item}</div>
    <div class="batch-row-meta">${r.typeLabel} · ${r.qty}${r.lotSW&&r.lotSW!=='-'?' · '+r.lotSW:''}</div>
    <button class="batch-row-del" onclick="removeBatchRow('${pg}',${i})"><i class="ti ti-x"></i></button>
  </div>`).join('');
}
async function submitBatch(pg){
  const rows=batchDB[pg];
  if(!rows.length){alert('ยังไม่มีรายการ');return;}
  const name=(document.getElementById(pg+'-name')?.value||'').trim();
  if(!name){showToast('กรุณาระบุชื่อผู้ทำรายการ','err');return;}
  const dept = window._operatorDept || '';
  setLoading(pg+'-batch-submit-btn',true,'กำลังบันทึก...');
  for(const r of rows){
    const mi=masterDB.find(m=>m.name===r.item);
    const code=mi?mi.code:r.code;
    if(mi){
      // ── RPC เดียว: items.stock + lots.stock พร้อมกัน ──
      if(r.action!=='return_bad'){
        let lotId=null;
        if((WAREHOUSE_CONFIG[pg]?.hasLot)&&r.lotSW&&(r.action==='withdraw'||r.action==='return_good')){
          const cached=(lotDB[code]||[]).find(l=>l.lot_sw===r.lotSW);
          if(cached)lotId=cached.id;
        }
        const cfg_r = WAREHOUSE_CONFIG[pg];
        const res=await dbAdjustStockWithLot(code,r.action,r.qty,{
          lotId,
          lotSW:(cfg_r.hasLot && r.lotSW && r.lotSW!=='-') ? r.lotSW : null,
          lotSP:(r.lotSP && r.lotSP.length > 0) ? r.lotSP : null,
          name:r.item,
          note: (pg==='raw' && r.action==='receive') ? (r.note||null) : null,
        });
        if(!res.ok)continue;
        // sync stock จาก RPC result
        if(res.new_stock !== undefined) mi.stock = res.new_stock;
      }
      if(r.action==='receive'&&r.loc)locationDB[code]=r.loc;
      await dbUpsertItem(mi);
    }
    const rec={time:dateToday(),timeDetail:timeNow(),type:r.action,typeLabel:r.typeLabel,name,dept,item:r.item,code,qty:r.qty,lotSW:r.lotSW||'-',lotSP:r.lotSP||'',note:r.note||'',pg,via:'batch'};
    txState[pg].records.unshift(rec);
    rec.id = await dbInsertTransaction(rec);
  }
  checkAlerts(); renderHistory(pg);
  if(curPage==='master') renderMasterContent();
  const n=rows.length;
  batchDB[pg]=[]; saveBatchLS(); renderBatchCard(pg);
  setLoading(pg+'-batch-submit-btn',false);
  showToast(`บันทึก <strong>${n}</strong> รายการสำเร็จ`);
}

const HIST_PAGE_SIZE = 20;
const histPageState = {}; // { pg: currentPage }
const histHasMore = {};    // { pg: bool }
const histSearchState = {}; // { pg: searchText }

function filterHistory(pg) {
  const q = (document.getElementById(pg+'-hist-search')?.value||'').trim();
  histSearchState[pg] = q;
  histPageState[pg] = 1;
  renderHistory(pg, 1);
}

function clearHistSearch(pg) {
  const el = document.getElementById(pg+'-hist-search');
  if (el) el.value = '';
  histSearchState[pg] = '';
  histPageState[pg] = 1;
  renderHistory(pg, 1);
}

async function loadMoreHistory(pg){
  const recs = txState[pg].records;
  const oldest = recs[recs.length-1];
  if (!oldest) return;
  const olderRaw = await dbLoadTransactionsRaw(pg, oldest.rawCreatedAt);
  if (!olderRaw.length) { histHasMore[pg] = false; renderHistory(pg); return; }
  histHasMore[pg] = olderRaw.length === 1000;
  txState[pg].records = recs.concat(olderRaw.map(mapTxRow));
  // ไปหน้าแรกของชุดข้อมูลที่โหลดเพิ่ม
  const newTotalPages = Math.max(1, Math.ceil(txState[pg].records.length / HIST_PAGE_SIZE));
  const prevLastPage = Math.max(1, Math.ceil(recs.length / HIST_PAGE_SIZE));
  renderHistory(pg, Math.min(prevLastPage+1, newTotalPages));
}

function renderHistory(pg, page){
  const cfg=WAREHOUSE_CONFIG[pg];
  const tb=document.getElementById(pg+'-hbody');
  const hc=document.getElementById(pg+'-hcount');
  const pager=document.getElementById(pg+'-hpager');
  if(!tb)return;
  const allRecs=txState[pg].records;

  // ── กรองตาม search text ──
  const q=(histSearchState[pg]||'').toLowerCase();
  const recs = q
    ? allRecs.filter(r =>
        r.item.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q)
      )
    : allRecs;

  if(hc)hc.textContent=recs.length+(q?` (กรองจาก ${allRecs.length})`:'');
  const canEdit = canEditHistory();
  const totalCols = (cfg.hasLot ? (cfg.lotSupplier ? 9 : 8) : 7) + (canEdit?1:0);

  if(!recs.length){
    tb.innerHTML=`<tr><td colspan="${totalCols}"><div class="empty"><i class="ti ti-notes"></i><div class="empty-text">ยังไม่มีรายการ</div></div></td></tr>`;
    if(pager) pager.innerHTML='';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(recs.length / HIST_PAGE_SIZE));
  let curP = page!==undefined ? page : (histPageState[pg]||1);
  if(curP < 1) curP = 1;
  if(curP > totalPages) curP = totalPages;
  histPageState[pg] = curP;

  const start = (curP-1)*HIST_PAGE_SIZE;
  const pageRecs = recs.slice(start, start+HIST_PAGE_SIZE);

  tb.innerHTML=pageRecs.map(r=>`<tr ${r.type==='return_bad'?'style="opacity:.75"':''}>
    <td title="${r.timeDetail||''}">${r.time}</td>
    <td><span class="tbadge ${ACTION_BADGE[r.type]}">${r.typeLabel}</span></td>
    <td>${r.name}${r.via==='scan'||r.via==='camera'?'<span style="font-size:9px;color:var(--acc);margin-left:3px">scan</span>':r.via==='batch'?'<span style="font-size:9px;color:var(--grn);margin-left:3px">batch</span>':''}</td>
    <td><span class="dept-pill ${DEPT_PILL_CLS[r.dept]||''}">${r.dept}</span></td>
    <td title="${r.item}">${r.item}</td>
    <td style="font-family:monospace;font-size:10px;color:var(--acc)">${r.code}</td>
    <td>${r.qty}</td>
    ${cfg.hasLot?`<td>${r.lotSW||'-'}</td>`:''}

    ${cfg.lotSupplier?`<td style="font-size:10px;color:var(--ink3)">${r.lotSP||'-'}</td>`:''}
    ${canEdit?`<td style="white-space:nowrap"><button class="icon-btn" title="แก้ไข" onclick="openEditTxById(${r.id},'${pg}')"><i class="ti ti-pencil"></i></button><button class="icon-btn danger" title="ลบ" onclick="deleteTx(${r.id},'${pg}')"><i class="ti ti-trash"></i></button></td>`:''}
  </tr>`).join('');

  // ── Pagination controls ──
  if(pager){
    const showLoadMore = histHasMore[pg] && curP===totalPages;
    const loadMoreBtn = showLoadMore
      ? `<button class="btn btn-sm" style="margin-left:8px" onclick="loadMoreHistory('${pg}')"><i class="ti ti-history"></i> โหลดประวัติเก่าเพิ่ม</button>`
      : '';
    if(totalPages<=1){
      pager.innerHTML=`<span>ทั้งหมด ${recs.length} รายการ</span>${loadMoreBtn}`;
    } else {
      const rangeStart = start+1;
      const rangeEnd = Math.min(start+HIST_PAGE_SIZE, recs.length);
      // สร้างเลขหน้า: แสดงสูงสุด 5 ปุ่ม รอบหน้าปัจจุบัน
      let pages=[];
      let lo=Math.max(1,curP-2), hi=Math.min(totalPages,curP+2);
      if(curP<=2) hi=Math.min(totalPages,5);
      if(curP>=totalPages-1) lo=Math.max(1,totalPages-4);
      for(let i=lo;i<=hi;i++) pages.push(i);
      const btns = pages.map(i=>`<button class="hist-pg ${i===curP?'active':''}" onclick="renderHistory('${pg}',${i})">${i}</button>`).join('');
      pager.innerHTML = `
        <span>${rangeStart}-${rangeEnd} จาก ${recs.length} รายการ</span>
        <div class="hist-pager-btns">
          <button class="hist-pg" onclick="renderHistory('${pg}',${curP-1})" ${curP<=1?'disabled':''}><i class="ti ti-chevron-left" style="font-size:12px"></i></button>
          ${lo>1?`<button class="hist-pg" onclick="renderHistory('${pg}',1)">1</button>${lo>2?'<span style="padding:0 2px">…</span>':''}`:''}
          ${btns}
          ${hi<totalPages?`${hi<totalPages-1?'<span style="padding:0 2px">…</span>':''}<button class="hist-pg" onclick="renderHistory('${pg}',${totalPages})">${totalPages}</button>`:''}
          <button class="hist-pg" onclick="renderHistory('${pg}',${curP+1})" ${curP>=totalPages?'disabled':''}><i class="ti ti-chevron-right" style="font-size:12px"></i></button>
        </div>${loadMoreBtn}`;
    }
  }
}

/* ═══════════════════════════════════════════
   CAMERA
═══════════════════════════════════════════ */
function openCamera(pg){
  currentQRPage=pg; lastCamCode='';
  document.getElementById('camResult').textContent='พุ่งกล้องไปที่ QR หรือ Barcode';
  document.getElementById('camResult').className='cam-result';
  document.getElementById('camLotPickerCam').style.display='none';
  document.getElementById('camOverlay').classList.add('show');
  // autofill แผนกจาก profile
  const deptSel=document.getElementById('camDept');
  if(deptSel&&window._operatorDept){
    const opt=[...deptSel.options].find(o=>o.value===window._operatorDept);
    if(opt) deptSel.value=window._operatorDept;
  }
  camScanner=new Html5Qrcode('cam-reader');
  camScanner.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},
    rawCode=>{
      lastCamCode=rawCode;
      const parsed=parseScanCode(rawCode);
      const m=masterDB.find(x=>x.code===parsed.itemCode);
      const res=document.getElementById('camResult');
      if(m){
        res.className='cam-result ok';
        res.textContent=`พบ: ${m.name}${parsed.lotSW?' · Lot '+parsed.lotSW:''} · สต็อก ${m.stock}`;
        // autofill lot ถ้าเป็น lot QR
        if(parsed.lotSW){
          document.getElementById('camLotSW').style.display='block';
          document.getElementById('camLotSWVal').textContent=parsed.lotSW;
          document.getElementById('camLotHidden').value=parsed.lotSW;
        } else {
          document.getElementById('camLotSW').style.display='none';
          document.getElementById('camLotHidden').value='';
        }
        // แสดง lot picker ถ้าคลังนี้มี lot และมี lots อยู่
        const hasLotPg = !!WAREHOUSE_CONFIG[m.pg]?.hasLot;
        const lots = hasLotPg ? (lotDB[m.code]||[]).filter(l=>l.stock>0) : [];
        // เรียงเก่าก่อน (FIFO)
        lots.sort((a,b)=>new Date(a.lot_sw)-new Date(b.lot_sw));
        const picker = document.getElementById('camLotPickerCam');
        if(hasLotPg && lots.length){
          picker.style.display='block';
          document.getElementById('camLotPickerList').innerHTML = lots.map(l=>{
            const sw = new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
            const sp = l.lot_supplier ? new Date(l.lot_supplier).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
            const ex = l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
            return `<div class="cam-lot-row" onclick="selectCamLot(this,'${l.lot_sw}')" data-lot="${l.lot_sw}">
              <div style="flex:1">
                <div style="font-size:12px;font-weight:600;color:#fff">${sw}</div>
                <div style="font-size:10px;color:rgba(255,255,255,.5)">
                  ${sp?'Sup: '+sp+' · ':''}คงเหลือ ${l.stock}${ex?' · หมดอายุ: '+ex:''}
                </div>
              </div>
              <i class="ti ti-check" style="display:none;color:#4cd964;font-size:14px"></i>
            </div>`;
          }).join('');
        } else {
          picker.style.display='none';
        }
      }
      else{res.className='cam-result err';res.textContent=`ไม่พบรหัส "${rawCode}"`;}
    },()=>{}
  ).catch(()=>{document.getElementById('camResult').textContent='ไม่สามารถเปิดกล้องได้';});
}

function selectCamLot(el, lotSW) {
  // toggle select
  const already = el.classList.contains('selected');
  document.querySelectorAll('#camLotPickerList .cam-lot-row').forEach(r=>{
    r.classList.remove('selected');
    r.querySelector('.ti-check').style.display='none';
  });
  if(!already){
    el.classList.add('selected');
    el.querySelector('.ti-check').style.display='block';
    document.getElementById('camLotHidden').value = lotSW;
    document.getElementById('camLotSWInput').value = lotSW;
  } else {
    document.getElementById('camLotHidden').value = '';
    document.getElementById('camLotSWInput').value = '';
  }
}
async function confirmCamScan(){
  if(!lastCamCode){alert('ยังไม่ได้สแกน');return;}
  const action=document.getElementById('camAction').value;
  const qty=parseFloat(document.getElementById('camQty').value||1);
  const dept=document.getElementById('camDept')?.value||(window._operatorDept||'คลัง');
  if(!qty||qty<=0){alert('กรุณาระบุจำนวน');return;}
  const parsed=parseScanCode(lastCamCode);
  const m=masterDB.find(x=>x.code===parsed.itemCode);
  if(!m){alert('ไม่พบรหัสในระบบ');return;}
  const pg=m.pg;
  const hasLotPg=!!WAREHOUSE_CONFIG[pg]?.hasLot;

  if(action!=='return_bad'){
    // ดึง lot SW จากทุกแหล่ง — picker > hidden > input > QR
    const pickerSelected = document.querySelector('#camLotPickerList .cam-lot-row.selected');
    const lotSW = pickerSelected?.dataset?.lot
      || document.getElementById('camLotHidden')?.value
      || document.getElementById('camLotSWInput')?.value
      || parsed.lotSW
      || null;
    const lotSP = document.getElementById('camLotSPInput')?.value || null;

    // หา lotId จาก cache หรือโหลดใหม่
    let lotId = null;
    if(hasLotPg && lotSW && (action==='withdraw'||action==='return_good')){
      // โหลด lots ใหม่ให้แน่ใจว่าข้อมูลล่าสุด
      await dbLoadLotsForItem(m.code);
      const cached=(lotDB[m.code]||[]).find(l=>l.lot_sw===lotSW);
      if(cached) lotId=cached.id;
      else {
        showToast(`ไม่พบ Lot ${lotSW} กรุณาตรวจสอบ`, 'err');
        return;
      }
    }

    const res=await dbAdjustStockWithLot(m.code,action,qty,{
      lotId,
      lotSW:(action==='receive')?lotSW:null,
      lotSP:(lotSP&&lotSP.length>0)?lotSP:null,
      name:m.name,
    });
    if(!res.ok) return;
    if(res.new_stock!==undefined) m.stock=res.new_stock;

    // sync lot cache
    if(res.lot_id && lotDB[m.code]){
      const lot=lotDB[m.code].find(l=>l.id===res.lot_id);
      if(lot && res.new_lot_stock!==undefined) lot.stock=res.new_lot_stock;
    }
  }

  await dbUpsertItem(m);

  // ดึง lotSW จริงที่ใช้บันทึก เพื่อใส่ใน rec
  const pickerSelected2 = document.querySelector('#camLotPickerList .cam-lot-row.selected');
  const recLotSW = pickerSelected2?.dataset?.lot
    || document.getElementById('camLotHidden')?.value
    || parsed.lotSW || '-';

  const rec={
    time:dateToday(), timeDetail:timeNow(), type:action, typeLabel:ACTION_LABELS[action],
    name:window._operatorName||'(กล้องสแกน)', dept,
    item:m.name, code:m.code, qty,
    lotSW:recLotSW, pg, via:'camera',
    oldStock:action!=='return_bad'?m.stock+((action==='withdraw'?1:-1)*qty):null,
    newStock:action!=='return_bad'?m.stock:null,
  };
  txState[pg].records.unshift(rec);
  rec.id = await dbInsertTransaction(rec);
  checkAlerts();
  if(currentQRPage===pg) renderHistory(pg,1);
  if(curPage==='master') renderMasterContent();

  document.getElementById('camResult').className='cam-result ok';
  document.getElementById('camResult').textContent=`${ACTION_LABELS[action]} "${m.name}" ${qty} · สต็อก ${m.stock}`;
  lastCamCode='';
  document.getElementById('camQty').value='1';
  document.getElementById('camLotSW').style.display='none';
  document.getElementById('camLotHidden').value='';
  document.getElementById('camLotSWInput').value='';
  document.getElementById('camLotSPInput').value='';
  document.getElementById('camLotPickerCam').style.display='none';
  document.getElementById('camLotPickerList').innerHTML='';
}
function closeCamera(){
  if(camScanner){camScanner.stop().catch(()=>{});camScanner=null;}
  document.getElementById('cam-reader').innerHTML='';
  document.getElementById('camOverlay').classList.remove('show');
  lastCamCode='';
}

/* ═══════════════════════════════════════════
   QR SIDEBAR
═══════════════════════════════════════════ */
function openQR(pg){
  currentQRPage=pg;
  document.getElementById('qrPanelTitle').textContent=`QR — ${WAREHOUSE_CONFIG[pg].label}`;
  document.getElementById('qr-scan-input').value='';
  document.getElementById('qr-scan-qty').value='1';
  document.getElementById('qr-scan-result').className='qr-result';
  document.getElementById('qrSidebar').classList.add('show');
  buildQRList(pg);
  setTimeout(()=>document.getElementById('qr-scan-input').focus(),200);
}
function closeQR(){document.getElementById('qrSidebar').classList.remove('show');currentQRPage=null;}
function buildQRList(pg){
  const list=document.getElementById('qrList');list.innerHTML='';
  masterDB.filter(m=>m.pg===pg).slice(0,50).forEach(m=>{
    const row=document.createElement('div');row.className='qr-list-item';
    const canvas=document.createElement('canvas');canvas.style.cssText='width:56px;height:56px;flex-shrink:0';
    const info=document.createElement('div');info.className='qr-list-info';
    info.innerHTML=`<div class="qr-list-name">${m.name}</div><div class="qr-list-code">${m.code}</div><div class="qr-list-stock">สต็อก: ${m.stock}</div>`;
    row.appendChild(canvas);row.appendChild(info);list.appendChild(row);
    try{new QRCode(canvas,{text:m.code,width:56,height:56,colorDark:'#1c1c1e',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});}catch(e){}
  });
}
async function doQRScan(){
  const code=(document.getElementById('qr-scan-input').value||'').trim();
  const action=document.getElementById('qr-scan-action').value;
  const qty=parseFloat(document.getElementById('qr-scan-qty').value||1);
  const res=document.getElementById('qr-scan-result');
  if(!code){res.className='qr-result err';res.textContent='กรุณาสแกนหรือพิมพ์รหัส';setTimeout(()=>res.className='qr-result',2500);return;}
  const m=masterDB.find(x=>x.code.toLowerCase()===code.toLowerCase());
  if(!m){res.className='qr-result err';res.textContent=`ไม่พบรหัส "${code}"`;setTimeout(()=>res.className='qr-result',3000);return;}
  if(action==='withdraw'&&qty>m.stock){res.className='qr-result err';res.textContent=`สต็อกไม่พอ (มี ${m.stock} เหลือ)`;setTimeout(()=>res.className='qr-result',3000);return;}
  if(action==='receive'||action==='return_good') m.stock+=qty;
  else if(action==='withdraw') m.stock=Math.max(0,m.stock-qty);
  const rpcRes=await dbAdjustStockWithLot(m.code,action,qty,{name:m.name});
  if(!rpcRes.ok){res.className='qr-result err';res.textContent=rpcRes.error||'เกิดข้อผิดพลาด';setTimeout(()=>res.className='qr-result',3000);return;}
  if(rpcRes.new_stock!==undefined) m.stock=rpcRes.new_stock;
  await dbUpsertItem(m);
  const pg=m.pg;
  const rec={time:timeNow(),type:action,typeLabel:ACTION_LABELS[action],name:'(QR)',dept:(WAREHOUSE_CONFIG[pg]?.depts||[''])[0],item:m.name,code:m.code,qty,lotSW:'-',pg,via:'scan'};
  txState[pg].records.unshift(rec);
  rec.id = await dbInsertTransaction(rec);
  checkAlerts();if(currentQRPage===pg)renderHistory(pg,1);
  res.className='qr-result ok';
  res.textContent=`${ACTION_LABELS[action]} "${m.name}" ${qty} · สต็อก ${m.stock}`;
  document.getElementById('qr-scan-input').value='';document.getElementById('qr-scan-qty').value='1';
  buildQRList(pg);setTimeout(()=>res.className='qr-result',4000);
}

/* ═══════════════════════════════════════════
   MASTER PAGE
═══════════════════════════════════════════ */
function renderMasterPage(){
  const div=document.getElementById('page-master'); if(!div)return;
  const alerts=getAlertItems(null);
  let alertHtml='';
  if(alerts.length){
    alertHtml=`<div class="alert-bar"><i class="ti ti-alert-triangle"></i><div>
      <div class="alert-bar-title">พบ ${alerts.length} รายการสต็อกต่ำ</div>
      <div class="alert-items">${alerts.slice(0,6).map(i=>`<span class="alert-chip">${i.name} (${i.stock})</span>`).join('')}${alerts.length>6?`<span class="alert-chip">+${alerts.length-6}</span>`:''}</div>
    </div></div>`;
  }
  const namingRows=Object.entries(WAREHOUSE_CONFIG).map(([pg,cfg])=>{
    if(pg==='raw')return['PD','RW','FW','LL'].map(s=>`<div class="naming-rule">SWBD_RM_${s}_XXXX</div>`).join('');
    return`<div class="naming-rule">SWBD_${cfg.prefix}_XXXX</div>`;
  }).join('');

  div.innerHTML=`
    <div class="page-header">
      <div><div class="page-title">Master Data</div>
        <div class="page-sub">จัดการรายการ หมวดหมู่ และ QR Code</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="exportAllCsv()" title="Export ทุกอย่าง: สต็อก + ประวัติ + Lot">
          <i class="ti ti-table-export"></i> Export ทั้งหมด</button>
        ${canManageMaster() ? `<button class="btn btn-primary btn-sm" onclick="showAddForm()">
          <i class="ti ti-plus"></i> เพิ่มรายการ</button>` : ''}
      </div>
    </div>
    <div class="card" style="margin-bottom:11px">
      <div class="card-title" style="cursor:pointer;user-select:none;margin-bottom:0" onclick="toggleAccordion('namingBody','namingChev')">
        <div class="card-title-left"><i class="ti ti-hash" style="color:var(--ink3)"></i>
          <span style="color:var(--ink2)">รูปแบบรหัส</span>
        </div>
        <i class="ti ti-chevron-down" id="namingChev" style="color:var(--ink4);font-size:13px;transition:transform .2s;transform:rotate(-90deg)"></i>
      </div>
      <div id="namingBody" style="display:none;margin-top:12px">
        <div class="naming-grid">${namingRows}</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:11px">
      <div class="card-title" style="cursor:pointer;user-select:none;margin-bottom:0" onclick="toggleAccordion('binBody','binChev')">
        <div class="card-title-left"><i class="ti ti-map-pin" style="color:var(--ink3)"></i>
          <span style="color:var(--ink2)">พิกัดชั้นวาง (Bin Location)</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();showBinForm()">
            <i class="ti ti-plus"></i> เพิ่มพิกัด</button>
          <i class="ti ti-chevron-down" id="binChev" style="color:var(--ink4);font-size:13px;transition:transform .2s;transform:rotate(-90deg)"></i>
        </div>
      </div>
      <div id="binBody" style="display:none;margin-top:12px">
        <div id="binAddForm" style="display:none;margin-bottom:10px;padding:11px;background:var(--s2);border:1px solid var(--line);border-radius:var(--r)">
          <div class="form-grid" style="margin-bottom:8px">
            <div class="fg"><label class="fl">โซน <span class="req">*</span></label>
              <input class="fi" id="bin-zone" placeholder="เช่น ZN1, COLD"></div>
            <div class="fg"><label class="fl">แถว <span class="req">*</span></label>
              <input class="fi" id="bin-row" placeholder="เช่น A, B, C"></div>
            <div class="fg"><label class="fl">ชั้น <span class="req">*</span></label>
              <input class="fi" id="bin-level" placeholder="เช่น 01, 02"></div>
            <div class="fg"><label class="fl">ชื่อเพิ่มเติม</label>
              <input class="fi" id="bin-label" placeholder="เช่น ตู้แช่เย็น"></div>
          </div>
          <div style="display:flex;gap:7px;justify-content:flex-end">
            <button class="btn btn-sm" onclick="showBinForm()">ยกเลิก</button>
            <button class="btn btn-primary btn-sm" onclick="addBinLocation()">
              <i class="ti ti-check"></i> บันทึกพิกัด</button>
          </div>
        </div>
        <div id="binList" style="display:flex;flex-wrap:wrap;gap:5px">
          ${binLocations.length ? binLocations.map(b=>
            `<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:var(--acc-bg);border:1px solid var(--line);border-radius:6px;margin-bottom:3px">
              <span style="font-size:11px;color:var(--acc);font-family:monospace;font-weight:500">${b.code}</span>
              ${b.label?`<span style="font-size:10px;color:var(--ink3)">${b.label}</span>`:''}
              <button onclick="deleteBinLocation(${b.id})" style="background:none;border:none;cursor:pointer;color:var(--ink4);padding:0;font-size:12px;line-height:1" title="ลบ"><i class="ti ti-x"></i></button>
            </div>`
          ).join('') : '<span style="font-size:12px;color:var(--ink3)">ยังไม่มีพิกัด — กด "+ เพิ่มพิกัด" เพื่อเริ่มต้น</span>'}
        </div>
      </div>
    </div>
    <div class="card" id="addFormCard" style="display:none;margin-bottom:11px">
      <div class="card-title">
        <div class="card-title-left"><i class="ti ti-plus"></i> เพิ่มรายการใหม่</div>
        <button class="btn btn-sm" onclick="hideAddForm()">ยกเลิก</button>
      </div>
      <div id="addFormBody"></div>
    </div>
    <div class="card">
      <div class="master-search-bar">
        <input id="masterSearch" placeholder="ค้นหารายการหรือรหัส..." oninput="renderMasterContent()">
        <div class="cat-tabs" id="masterCatTabs"></div>
      </div>
      <div id="masterContent"></div>
    </div>`;

  buildCatTabs();
  renderMasterContent();
  buildAddForm();
}

function buildCatTabs(){
  const container=document.getElementById('masterCatTabs'); if(!container)return;
  const tabs=[
    {key:'all',label:'ทั้งหมด'},
    ...WAREHOUSE_PAGES.map(pg=>({key:pg,label:WAREHOUSE_CONFIG[pg].label})),
    {key:'alert',label:'<i class="ti ti-alert-triangle" style="font-size:10px"></i> แจ้งเตือน'},
  ];
  container.innerHTML=tabs.map(t=>
    `<div class="cat-tab ${t.key===masterCatFilter?'active':''}" onclick="setCatFilter('${t.key}',this)">${t.label}</div>`
  ).join('');
}
function setCatFilter(c,el){
  masterCatFilter=c;
  document.querySelectorAll('.cat-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  renderMasterContent();
}

function buildAddForm(){
  const body=document.getElementById('addFormBody'); if(!body)return;
  const pgOpts=WAREHOUSE_PAGES.map(pg=>{
    const cfg=WAREHOUSE_CONFIG[pg];
    const subcats=[...new Set(masterDB.filter(m=>m.pg===pg).map(m=>m.subcat).filter(Boolean))];
    const opts=subcats.map(s=>`<option value="${pg}|${s}">${cfg.label} — ${s}</option>`).join('');
    return `<optgroup label="${cfg.label}">${opts}<option value="${pg}|">— หมวดใหม่ใน ${cfg.label}</option></optgroup>`;
  }).join('');

  body.innerHTML=`
    <div class="add-form-grid" style="margin-bottom:9px">
      <div class="fg"><label class="fl">ชื่อรายการ <span class="req">*</span></label>
        <input class="fi" id="new-name" placeholder="ชื่อรายการ"></div>
      <div class="fg"><label class="fl">คลัง / หมวดหมู่ <span class="req">*</span></label>
        <select class="fi" id="new-cat" style="padding:7px 9px" onchange="onNewCatChange()">
          <option value="">-- เลือกคลัง --</option>${pgOpts}
        </select></div>
    </div>
    <div id="new-subcat-row" style="display:none;margin-bottom:9px">
      <div class="fg"><label class="fl">ชื่อหมวดหมู่ใหม่ <span class="req">*</span></label>
        <input class="fi" id="new-subcat-name" placeholder="เช่น Herbal, Special Blend"></div>
    </div>
    <div class="form-grid" style="margin-bottom:9px">
      <div class="fg"><label class="fl">สต็อกเริ่มต้น</label>
        <input class="fi" id="new-stock" type="number" min="0" step="0.01" value="0" inputmode="decimal"></div>
      <div class="fg"><label class="fl">Min</label>
        <input class="fi" id="new-min" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal"></div>
      <div class="fg"><label class="fl">Max</label>
        <input class="fi" id="new-max" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal"></div>
    </div>
    <div class="fg" style="margin-bottom:9px">
      <label class="fl"><i class="ti ti-map-pin" style="font-size:11px"></i> พิกัดชั้นวาง</label>
      <select class="fi" id="new-bin" style="padding:7px 9px">
        ${buildBinSelectHtml()}
      </select>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button class="btn btn-primary" id="add-item-btn" onclick="addMasterItem()">
        <i class="ti ti-check"></i> บันทึก</button>
    </div>`;
}
function onNewCatChange(){
  const val=document.getElementById('new-cat')?.value||'';
  const[,subcat]=val.split('|');
  const row=document.getElementById('new-subcat-row');
  if(row)row.style.display=subcat===''?'block':'none';
}
function showAddForm(){ const c=document.getElementById('addFormCard');if(c){c.style.display='block';c.scrollIntoView({behavior:'smooth',block:'nearest'});} }
function hideAddForm(){ const c=document.getElementById('addFormCard');if(c)c.style.display='none'; }

async function addMasterItem(){
  const name=(document.getElementById('new-name')?.value||'').trim();
  const catVal=document.getElementById('new-cat')?.value||'';
  const stock=parseFloat(document.getElementById('new-stock')?.value||0)||0;
  const min=parseFloat(document.getElementById('new-min')?.value||0)||0;
  const max=parseFloat(document.getElementById('new-max')?.value||0)||0;
  if(!name){showToast('กรุณาระบุชื่อรายการ','err');return;}
  if(!catVal){showToast('กรุณาเลือกหมวดหมู่','err');return;}
  const[pg,subcatRaw]=catVal.split('|');
  let subcat=subcatRaw;
  if(!subcat){
    subcat=(document.getElementById('new-subcat-name')?.value||'').trim();
    if(!subcat){showToast('กรุณาระบุชื่อหมวดหมู่ใหม่','err');return;}
  }
  setLoading('add-item-btn',true,'กำลังบันทึก...');
  const seq=nextSeq(pg,subcat);
  const code=buildCode(pg,subcat,seq);

  // ตรวจสอบรหัสซ้ำก่อนบันทึก ป้องกันชนกับรายการที่มีอยู่
  if(masterDB.find(x=>x.code===code)){
    setLoading('add-item-btn',false);
    showToast(`รหัส ${code} มีอยู่แล้วในระบบ กรุณาลองใหม่`,'err');
    return;
  }

  const newItem={code,name,pg,subcat,stock,min,max,seq};
  const bin=(document.getElementById('new-bin')?.value||'').trim();
  if(bin) locationDB[code]=bin;
  const ok=await dbUpsertItem(newItem);
  setLoading('add-item-btn',false);
  if(ok){
    masterDB.push(newItem);
    checkAlerts(); hideAddForm(); buildAddForm(); renderMasterContent();
    showToast(`เพิ่ม "${name}" (${code}) สำเร็จ`);
  } else {
    showToast(`บันทึกไม่สำเร็จ — ${code} อาจไม่ถูกบันทึกลงระบบ`,'err');
  }
}

/* ── EDIT ── */
function editStock(code){ const m=masterDB.find(x=>x.code===code);if(!m)return;document.getElementById('editStockId').value=code;document.getElementById('editStockName').textContent=m.name;document.getElementById('editStockVal').value=m.stock;document.getElementById('editStockModal').classList.add('show'); }
async function saveEditStock(){ const code=document.getElementById('editStockId').value;const val=parseFloat(document.getElementById('editStockVal').value);if(isNaN(val)||val<0){showToast('ค่าไม่ถูกต้อง','err');return;}const m=masterDB.find(x=>x.code===code);if(m){m.stock=val;await dbUpsertItem(m);}checkAlerts();closeModal('editStockModal');renderMasterContent(); }
function editMinMax(code){
  const m=masterDB.find(x=>x.code===code);if(!m)return;
  document.getElementById('editMMId').value=code;
  document.getElementById('editMMName').textContent=m.name;
  document.getElementById('editMMMin').value=m.min;
  document.getElementById('editMMMax').value=m.max;
  const sf=document.getElementById('editMMSupplierFields');
  if(sf){
    sf.style.display=SUPPLIER_FIELDS?'grid':'none';
    document.getElementById('editMMSupplier').value=m.supplier_name||'';
    const leadLabel=document.getElementById('editMMLeadTimeLabel');
    const leadInput=document.getElementById('editMMLeadTime');
    if(SUPPLIER_FIELDS==='date'){
      if(leadLabel) leadLabel.textContent='วันที่ส่งของรอบถัดไป';
      if(leadInput){ leadInput.type='date'; leadInput.value=m.next_delivery_date||''; }
    } else if(SUPPLIER_FIELDS==='days'){
      if(leadLabel) leadLabel.textContent='Lead time (วัน)';
      if(leadInput){ leadInput.type='number'; leadInput.min='0'; leadInput.step='1'; leadInput.value=m.lead_time_days||''; }
    }
  }
  document.getElementById('editMinMaxModal').classList.add('show');
}
async function saveEditMinMax(){
  const code=document.getElementById('editMMId').value;
  const mn=parseFloat(document.getElementById('editMMMin').value);
  const mx=parseFloat(document.getElementById('editMMMax').value);
  if(isNaN(mn)||isNaN(mx)){showToast('ค่าไม่ถูกต้อง','err');return;}
  const m=masterDB.find(x=>x.code===code);
  if(m){
    m.min=mn;m.max=mx;
    if(SUPPLIER_FIELDS){
      m.supplier_name=(document.getElementById('editMMSupplier')?.value||'').trim()||null;
      const leadVal=document.getElementById('editMMLeadTime')?.value||'';
      if(SUPPLIER_FIELDS==='date'){
        m.next_delivery_date=leadVal||null;
      } else if(SUPPLIER_FIELDS==='days'){
        const lt=parseInt(leadVal);
        m.lead_time_days=isNaN(lt)?null:lt;
      }
    }
    await dbUpsertItem(m);
  }
  checkAlerts();closeModal('editMinMaxModal');renderMasterContent();
}
function moveWarehouse(code) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  document.getElementById('moveWhId').value = code;
  document.getElementById('moveWhName').textContent = m.name;
  document.getElementById('moveWhCurrent').textContent = WAREHOUSE_CONFIG[m.pg]?.label || m.pg;
  const sel = document.getElementById('moveWhTarget');
  sel.innerHTML = Object.entries(WAREHOUSE_CONFIG)
    .filter(([pg]) => pg !== m.pg)
    .map(([pg, cfg]) => `<option value="${pg}">${cfg.label}</option>`)
    .join('');
  document.getElementById('moveWhModal').classList.add('show');
}

async function saveMovedWarehouse() {
  const code   = document.getElementById('moveWhId').value;
  const newPg  = document.getElementById('moveWhTarget').value;
  const m = masterDB.find(x => x.code === code);
  if (!m || !newPg) return;

  const { error } = await sb.from('items').update({ pg: newPg }).eq('code', code);
  if (error) { showToast('ย้ายไม่สำเร็จ', 'err'); return; }

  m.pg = newPg;
  closeModal('moveWhModal');
  renderMasterContent();
  showToast(`ย้าย "${m.name}" ไป ${WAREHOUSE_CONFIG[newPg]?.label || newPg} แล้ว`);
}

function editSpec(code){
  const m=masterDB.find(x=>x.code===code);if(!m)return;
  document.getElementById('editSpecId').value=code;
  document.getElementById('editSpecName').textContent=m.name;
  document.getElementById('editSpecVal').value=specDB[code]||'';
  document.getElementById('editSpecModal').classList.add('show');
}
async function saveEditSpec(){
  const code=document.getElementById('editSpecId').value;
  const spec=(document.getElementById('editSpecVal').value||'').trim();
  specDB[code]=spec||'';
  const { error } = await sb.from('items').update({ spec: spec||null }).eq('code', code);
  if(error){ showToast('บันทึกไม่สำเร็จ','err'); return; }
  closeModal('editSpecModal');
  renderMasterContent();
  showToast('บันทึกสเปกเรียบร้อย');
}

function editRemark(code){
  const m=masterDB.find(x=>x.code===code);if(!m)return;
  document.getElementById('editRemarkId').value=code;
  document.getElementById('editRemarkName').textContent=m.name;
  document.getElementById('editRemarkVal').value=remarkDB[code]||'';
  document.getElementById('editRemarkModal').classList.add('show');
}
async function saveEditRemark(){
  const code=(document.getElementById('editRemarkId').value||'').trim();
  const remark=(document.getElementById('editRemarkVal').value||'').trim();
  remarkDB[code]=remark||'';
  const m=masterDB.find(x=>x.code===code);
  if(m) m.remark=remark||null;
  const { error } = await sb.from('items').update({ remark: remark||null }).eq('code', code);
  if(error){ showToast('บันทึกไม่สำเร็จ','err'); return; }
  closeModal('editRemarkModal');
  renderMasterContent();
  showToast('บันทึกหมายเหตุเรียบร้อย');
}

function editName(code){ const m=masterDB.find(x=>x.code===code);if(!m)return;document.getElementById('editNameId').value=code;document.getElementById('editNameVal').value=m.name;document.getElementById('editNameModal').classList.add('show'); }
async function saveEditName(){
  const code = document.getElementById('editNameId').value;
  const nm   = (document.getElementById('editNameVal').value||'').trim();
  if(!nm){ showToast('กรุณาระบุชื่อ','err'); return; }
  const m = masterDB.find(x=>x.code===code);
  if(m){
    m.name = nm;
    await dbUpsertItem(m);
    // อัปเดตชื่อใน transactions และ lots ด้วย
    await Promise.all([
      sb.from('transactions').update({ item_name: nm }).eq('item_code', code),
      sb.from('lots').update({ item_name: nm }).eq('item_code', code),
    ]);
    // อัปเดต txState cache ที่โหลดไว้แล้ว
    for (const pg of WAREHOUSE_PAGES) {
      if (txState[pg]?.records) {
        txState[pg].records.forEach(r => { if(r.code===code) r.item=nm; });
      }
    }
  }
  closeModal('editNameModal');
  renderMasterContent();
  showToast(`เปลี่ยนชื่อเป็น "${nm}" สำเร็จ`);
}
function editLoc(code){
  const m=masterDB.find(x=>x.code===code);if(!m)return;
  document.getElementById('editLocId').value=code;
  document.getElementById('editLocName').textContent=m.name;
  const sel=document.getElementById('editLocVal');
  if(sel){
    sel.innerHTML='<option value="">— ไม่ระบุพิกัด —</option>'+
      binLocations.map(b=>`<option value="${b.code}" ${locationDB[code]===b.code?'selected':''}>${b.code}${b.label?' — '+b.label:''}</option>`).join('');
  }
  document.getElementById('editLocModal').classList.add('show');
}
async function saveEditLoc(){
  const code=document.getElementById('editLocId').value;
  const loc=(document.getElementById('editLocVal').value||'').trim();
  locationDB[code]=loc;
  const { error } = await sb.from('items').update({ note: loc }).eq('code', code);
  if(error){ console.error('saveEditLoc:', error.message); showToast('บันทึกไม่สำเร็จ','err'); return; }
  closeModal('editLocModal');
  renderMasterContent();
  showToast('บันทึกพิกัดเรียบร้อย');
}
async function deleteMasterItem(code){ if(!canManageMaster()){showToast('ไม่มีสิทธิ์ลบรายการ','err');return;} if(!confirm('ลบรายการนี้? ข้อมูลจะหายถาวร'))return;masterDB=masterDB.filter(m=>m.code!==code);delete locationDB[code];await dbDeleteItem(code);checkAlerts();renderMasterContent(); }

/* ── ย้ายหมวดหมู่ (subcat) ── */
function editSubcat(code){
  const m=masterDB.find(x=>x.code===code); if(!m) return;
  document.getElementById('editSubcatId').value=code;
  document.getElementById('editSubcatName').textContent=m.name;
  document.getElementById('editSubcatCurrent').textContent=m.subcat||'(ไม่มีหมวดหมู่)';

  // รวมรายชื่อ subcat ที่มีอยู่จริงในระบบ + ที่ตั้งไว้ใน WAREHOUSE_CONFIG
  const cfg = WAREHOUSE_CONFIG[m.pg];
  const fromConfig = cfg?.subcats || [];
  const fromData = [...new Set(masterDB.filter(x=>x.pg===m.pg).map(x=>x.subcat).filter(Boolean))];
  const all = [...new Set([...fromConfig, ...fromData])].sort();

  const sel = document.getElementById('editSubcatSelect');
  sel.innerHTML = all.map(s=>`<option value="${s}" ${s===m.subcat?'selected':''}>${s}</option>`).join('')
    + `<option value="__new__">-- หมวดหมู่ใหม่ --</option>`;

  document.getElementById('editSubcatNewRow').style.display='none';
  document.getElementById('editSubcatNewName').value='';
  document.getElementById('editSubcatModal').classList.add('show');
}

function onEditSubcatSelectChange(){
  const v = document.getElementById('editSubcatSelect').value;
  document.getElementById('editSubcatNewRow').style.display = (v==='__new__') ? 'block' : 'none';
}

async function saveEditSubcat(){
  const code = document.getElementById('editSubcatId').value;
  const m = masterDB.find(x=>x.code===code); if(!m) return;
  let target = document.getElementById('editSubcatSelect').value;
  if (target === '__new__') {
    target = (document.getElementById('editSubcatNewName').value||'').trim();
    if (!target) { showToast('กรุณาระบุชื่อหมวดหมู่ใหม่','err'); return; }
  }
  if (target === m.subcat) { closeModal('editSubcatModal'); return; }
  m.subcat = target;
  await dbUpsertItem(m);
  closeModal('editSubcatModal');
  renderMasterContent();
  showToast(`ย้ายไปหมวดหมู่ "${target}" สำเร็จ`);
}

/* ── MASTER CONTENT ── */
function showBinForm(){
  const f=document.getElementById('binAddForm');
  if(f) f.style.display=f.style.display==='none'?'block':'none';
}
async function addBinLocation(){
  const zone=(document.getElementById('bin-zone')?.value||'').trim().toUpperCase();
  const row=(document.getElementById('bin-row')?.value||'').trim().toUpperCase();
  const level=(document.getElementById('bin-level')?.value||'').trim();
  const label=(document.getElementById('bin-label')?.value||'').trim();
  if(!zone||!row||!level){showToast('กรุณากรอก โซน แถว และ ชั้น','err');return;}
  const data=await dbSaveBinLocation(zone,row,level,label);
  if(data){
    showToast(`เพิ่มพิกัด ${data.code} สำเร็จ`);
    renderMasterPage();
  }
}
async function deleteBinLocation(id){
  if(!confirm('ลบพิกัดนี้?'))return;
  const{error}=await sb.from('bin_locations').delete().eq('id',id);
  if(!error){
    binLocations=binLocations.filter(b=>b.id!==id);
    renderMasterPage();
  }
}

function renderMasterContent(){
  const search=(document.getElementById('masterSearch')?.value||'').toLowerCase();
  const cat=masterCatFilter;
  const content=document.getElementById('masterContent'); if(!content)return;

  function itemRowHtml(m){
    const st=stockStatus(m);
    const pct=m.max>0?Math.min(100,Math.round(m.stock/m.max*100)):0;
    const fC=st==='out'?'fill-out':st==='low'?'fill-low':'fill-ok';
    const sC=st==='out'?'si-out':st==='low'?'si-low':'si-ok';
    const sL=st==='out'?'หมด':st==='low'?'ต่ำ':'ปกติ';
    const sI=st==='out'?'ti-circle-x':st==='low'?'ti-alert-triangle':'ti-check';
    const cls=st==='out'?'out-stock':st==='low'?'low-stock':'';
    const loc=locationDB[m.code]||'';
    const hasLotPg=(WAREHOUSE_CONFIG[m.pg]?.hasLot);
    const allLots=hasLotPg?(lotDB[m.code]||[]):[];
    const activeLots=allLots.filter(l=>l.stock>0);
    const lotSubHtml=allLots.length
      ?activeLots.length
        ?activeLots.map(l=>{
            const sw=l.lot_sw?new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):' ?';
            const sp=l.lot_supplier?new Date(l.lot_supplier).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
            const ex=l.expiry_date?new Date(l.expiry_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
            const isExpired=l.expiry_date&&new Date(l.expiry_date)<new Date();
            const noteHtml=l.note?`<span style="font-size:10px;color:var(--ink3);margin-left:8px">${l.note}</span>`:'';
            return`<div class="lot-sub-row">
              <span class="lot-date">${sw}</span>
              <span class="lot-stock-val">คงเหลือ ${l.stock.toLocaleString()}</span>
              ${noteHtml}
              ${sp?`<span style="font-size:10px;color:var(--ink3);margin-left:8px">Sup: ${sp}</span>`:''}
              ${ex?`<span style="font-size:10px;color:${isExpired?'var(--red)':'var(--ink4)'};margin-left:8px">${isExpired?'⚠️ หมดอายุ':'หมดอายุ'}: ${ex}</span>`:''}
            </div>`;
          }).join('')
        :'<div class="lot-empty" style="color:var(--ink4);font-size:11px;padding:4px 0">ทุก Lot หมดแล้ว</div>'
      :'<div class="lot-empty">ยังไม่มี Lot</div>';
    return`<div class="item-row ${cls}">
      <div class="ir-main">
        <div class="ir-name" title="${m.name}">${m.name}</div>
        <div class="ir-code">${m.code}</div>
        ${(WAREHOUSE_CONFIG[m.pg]?.hasSpec && specDB[m.code])?`<div style="font-size:11px;color:var(--ink3);margin-top:2px;margin-bottom:4px;line-height:1.5;white-space:pre-wrap">${specDB[m.code]}</div>`:''}
        <div class="ir-meta">
          <span class="ir-stock"><strong>${m.stock}</strong></span>
          ${(m.min>0||m.max>0)?`
            <div class="stock-bar" style="width:80px"><div class="stock-bar-fill ${fC}" style="width:${pct}%"></div></div>
            <span class="ir-si ${sC}"><i class="ti ${sI}" style="font-size:10px"></i> ${sL}</span>
            <span class="ir-minmax">Min ${m.min} · Max ${m.max}</span>
          `:' <span class="ir-minmax" style="color:var(--ink4)">ยังไม่ตั้ง Min/Max</span>'}
        </div>
        <div>
          <span class="loc-tag" onclick="editLoc('${m.code}')">
            <i class="ti ti-map-pin"></i>
            ${loc||'<span style="color:var(--ink4)">ยังไม่ระบุสถานที่</span>'}
          </span>
        </div>
        ${hasLotPg?`<div>
          <button class="lot-expand-btn" onclick="toggleLotSub('lot_sub_${m.code}','${m.code}')">
            <i class="ti ti-layers-subtract" style="font-size:11px"></i>
            Lot <span style="font-size:10px;color:var(--ink4)">(${activeLots.length})</span>
          </button>
          <div class="lot-sub-list" id="lot_sub_${m.code}" style="display:none">${lotSubHtml}</div>
        </div>`:''}
      </div>
      <div class="ir-actions">
        ${canManageMaster() ? `
        <button class="icon-btn" onclick="editName('${m.code}')" title="แก้ไขชื่อ"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn" onclick="editSubcat('${m.code}')" title="ย้ายหมวดหมู่"><i class="ti ti-folder-symlink"></i></button>
        <button class="icon-btn" onclick="moveWarehouse('${m.code}')" title="ย้ายคลัง"><i class="ti ti-arrows-transfer-up"></i></button>
        <button class="icon-btn" onclick="editStock('${m.code}')" title="สต็อก"><i class="ti ti-edit"></i></button>
        <button class="icon-btn" onclick="editMinMax('${m.code}')" title="Min/Max"><i class="ti ti-adjustments-horizontal"></i></button>
        ${WAREHOUSE_CONFIG[m.pg]?.hasSpec?`<button class="icon-btn" onclick="editSpec('${m.code}')" title="แก้ไขสเปก"><i class="ti ti-file-description"></i></button>`:''}\n        <button class="icon-btn" onclick="editRemark('${m.code}')" title="หมายเหตุ"><i class="ti ti-message-2"></i></button>
        <button class="icon-btn danger" onclick="deleteMasterItem('${m.code}')" title="ลบ"><i class="ti ti-trash"></i></button>
        ` : ''}
      </div>
    </div>`;
  }

  function renderSection(items,label){
    const filtered=items.filter(m=>{
      if(search&&!m.name.toLowerCase().includes(search)&&!m.code.toLowerCase().includes(search))return false;
      if(cat==='alert')return stockStatus(m)!=='ok'&&(m.min>0||m.max>0);
      return true;
    });
    if(!filtered.length)return'';
    return`<div class="master-section">
      <div class="master-section-header"><div class="master-section-title">${label} <span class="mcount">${filtered.length}</span></div></div>
      <div class="item-list">${filtered.map(itemRowHtml).join('')}</div>
    </div>`;
  }

  const showAll=cat==='all'||cat==='alert';
  let html='';
  WAREHOUSE_PAGES.forEach(pg=>{
    if(!showAll&&cat!==pg)return;
    const cfg=WAREHOUSE_CONFIG[pg];
    const pgItems=masterDB.filter(m=>m.pg===pg);
    const subcats=[...new Set(pgItems.map(m=>m.subcat||''))];
    subcats.forEach(sub=>{
      const items=pgItems.filter(m=>(m.subcat||'')===sub);
      html+=renderSection(items,sub?`${cfg.label} — ${sub}`:cfg.label);
    });
  });
  content.innerHTML=html||'<div class="empty" style="padding:32px"><i class="ti ti-search"></i><div class="empty-text">ไม่พบรายการ</div></div>';
}

function syncLocFromSelect(pg){
  const sel=document.getElementById(pg+'-loc-select')?.value||'';
  const inp=document.getElementById(pg+'-loc');
  if(sel&&inp)inp.value=sel;
}
function syncLocFromInput(pg){
  const inp=document.getElementById(pg+'-loc')?.value||'';
  const sel=document.getElementById(pg+'-loc-select');
  if(!sel)return;
  // reset select if typed manually
  const matching=[...sel.options].find(o=>o.value===inp);
  sel.value=matching?inp:'';
}

/* ═══════════════════════════════════════════
   OFFLINE QUEUE — บันทึกเมื่อเน็ตหลุด sync อัตโนมัติเมื่อกลับออนไลน์
═══════════════════════════════════════════ */
const OFFLINE_QUEUE_KEY = 'swbd_offline_queue';

function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); }
  catch(e) { return []; }
}
function saveOfflineQueue(q) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
}
function addToOfflineQueue(item) {
  const q = getOfflineQueue();
  q.push({ ...item, _queuedAt: new Date().toISOString() });
  saveOfflineQueue(q);
  showToast('บันทึกออฟไลน์สำเร็จ — รอเชื่อมต่อเน็ต', 'warn');
  updateOfflineIndicator();
}

function updateOfflineIndicator() {
  const q = getOfflineQueue();
  const el = document.getElementById('offlineIndicator');
  if (el) {
    if (q.length > 0) {
      el.style.display = 'flex';
      el.textContent = `⏳ ${q.length} รายการรอ sync`;
    } else {
      el.style.display = 'none';
    }
  }
}

async function syncOfflineQueue() {
  const q = getOfflineQueue();
  if (!q.length) return;
  const failed = [];
  for (const item of q) {
    try {
      const { _queuedAt, ...rec } = item;
      await sb.from('transactions').insert(rec);
    } catch(e) {
      failed.push(item);
    }
  }
  saveOfflineQueue(failed);
  updateOfflineIndicator();
  if (!failed.length && q.length > 0) {
    showToast(`Sync สำเร็จ ${q.length} รายการ`);
    await dbLoadItems();
    checkAlerts();
    if (curPage === 'master') renderMasterContent();
  }
}

// Sync อัตโนมัติเมื่อกลับออนไลน์
window.addEventListener('online', () => {
  showToast('เชื่อมต่อเน็ตแล้ว กำลัง sync...');
  syncOfflineQueue();
});
window.addEventListener('offline', () => {
  showToast('เน็ตหลุด — บันทึกไว้ offline', 'warn');
});

function toggleAccordion(bodyId, chevId) {
  const body = document.getElementById(bodyId);
  const chev = document.getElementById(chevId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function toggleLotSub(subId,code){
  const sub=document.getElementById(subId);if(!sub)return;
  const isOpen=sub.style.display!=='none';
  if(isOpen){sub.style.display='none';return;}
  sub.style.display='block';
  if(!lotDB[code]){
    sub.innerHTML='<div class="lot-empty"><i class="ti ti-loader" style="animation:spin .8s linear infinite"></i> โหลด...</div>';
    dbLoadLotsForItem(code).then(()=>{
      const lots=lotDB[code]||[];
      const m=masterDB.find(x=>x.code===code);
      sub.innerHTML=lots.length
        ?lots.map(l=>{
            const sw=l.lot_sw?new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'?';
            const sp=l.lot_supplier?new Date(l.lot_supplier).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
            const ex=l.expiry_date?new Date(l.expiry_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
            const isEmpty=l.stock<=0;
            const isExpired=l.expiry_date&&new Date(l.expiry_date)<new Date();
            const noteHtml=(m&&m.pg==='raw'&&l.note)?`<span style="font-size:10px;color:var(--ink3);margin-left:8px">${l.note}</span>`:'';
            return`<div class="lot-sub-row" style="${isEmpty?'opacity:.45':''}${isExpired?';background:#fdf2f2':''}">
              <span class="lot-date" title="Lot SW">${sw}${isEmpty?' <span style="font-size:9px;color:var(--red)">หมด</span>':''}</span>
              <span class="lot-stock-val">คงเหลือ ${l.stock}</span>
              ${noteHtml}
              ${sp?`<span style="font-size:10px;color:var(--ink3);margin-left:8px" title="Lot Supplier">Sup: ${sp}</span>`:''}
              ${ex?`<span style="font-size:10px;color:${isExpired?'var(--red)':'var(--ink4)'};margin-left:8px">${isExpired?'⚠️ หมดอายุ':'หมดอายุ'}: ${ex}</span>`:''}
            </div>`;
          }).join('')
        :'<div class="lot-empty">ยังไม่มี Lot</div>';
    });
  }
}


/* ═══════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════ */
function escapeCsv(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const bom = '\uFEFF'; // BOM สำหรับ Excel ภาษาไทย
  const csv = bom + rows.map(r => r.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/** Export รวมทุกอย่าง: stock + transactions + lots ──
 * ออกเป็น 1 ไฟล์ CSV ต่อ sheet (3 tabs แต่ CSV เป็น 1 ไฟล์ต่อ type)
 * สำหรับ full export ใช้ exportAllCsv()
 */
async function exportAllCsv() {
  showToast('กำลัง Export ข้อมูลทั้งหมด...');
  const d = new Date().toISOString().split('T')[0];

  // ── Sheet 1: Stock ──
  const stockRows = [
    ['รหัส','ชื่อรายการ','คลัง','หมวดหมู่','สต็อก','Min','Max','สถานที่จัดเก็บ'],
    ...masterDB.map(m => [m.code, m.name, WAREHOUSE_CONFIG[m.pg]?.label||m.pg, m.subcat||'', m.stock, m.min, m.max, locationDB[m.code]||''])
  ];
  downloadCsv(`sawanbondin_stock_${d}.csv`, stockRows);

  // ── Sheet 2: Transactions ──
  try {
    const { data } = await sb.from('transactions').select('*').order('created_at',{ascending:false}).limit(10000);
    if (data) {
      const txRows = [
        ['วันที่','เวลา','ประเภท','ผู้ทำรายการ','แผนก','รายการ','รหัส','คลัง','จำนวน','Lot SW','Lot Supplier','สต็อกก่อน','สต็อกหลัง','หมายเหตุ','ช่องทาง'],
        ...data.map(r => {
          const dt = new Date(r.created_at);
          return [dt.toLocaleDateString('th-TH'), dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}),
            ACTION_LABELS[r.action_type]||r.action_type, r.operator_name||'', r.department||'',
            r.item_name||'', r.item_code||'', r.pg||'', r.quantity||0,
            r.lot_sw||'', r.lot_supplier||'', r.old_stock??'', r.new_stock??'', r.note||'', r.via||''];
        })
      ];
      setTimeout(() => downloadCsv(`sawanbondin_transactions_${d}.csv`, txRows), 500);
    }
  } catch(e) { console.warn(e); }

  // ── Sheet 3: Lots ──
  try {
    const { data } = await sb.from('lots').select('*').order('item_code',{ascending:true}).order('lot_sw',{ascending:true});
    if (data) {
      const lotRows = [
        ['รหัสสินค้า','ชื่อสินค้า','Lot Sawanbondin','Lot Supplier','สต็อกคงเหลือ','สถานะ'],
        ...data.map(r => [r.item_code, r.item_name, r.lot_sw||'', r.lot_supplier||'', r.stock, parseFloat(r.stock)<=0?'หมดแล้ว':'มีสต็อก'])
      ];
      setTimeout(() => downloadCsv(`sawanbondin_lots_${d}.csv`, lotRows), 1000);
    }
  } catch(e) { console.warn(e); }

  showToast('Export สำเร็จ — ดาวน์โหลด 3 ไฟล์');
}

/** Export stock snapshot ของทุกรายการ */
function exportStockCsv() {
  const rows = [
    ['รหัส','ชื่อรายการ','คลัง','หมวดหมู่','สต็อก','Min','Max','สถานที่จัดเก็บ'],
    ...masterDB.map(m => [
      m.code, m.name,
      WAREHOUSE_CONFIG[m.pg]?.label || m.pg,
      m.subcat || '',
      m.stock, m.min, m.max,
      locationDB[m.code] || '',
    ])
  ];
  const d = new Date().toISOString().split('T')[0];
  downloadCsv(`sawanbondin_stock_${d}.csv`, rows);
}

/** Export ประวัติรายการของคลังที่กำลังดูอยู่ */
async function exportTransactionsCsv(pg) {
  // โหลดข้อมูลใหม่จาก DB เพื่อให้ครบ ไม่ใช่แค่ in-memory 60 รายการ
  showToast('กำลังโหลดข้อมูล...');
  try {
    const { data, error } = await sb.from('transactions')
      .select('*')
      .eq('pg', pg)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) { showToast('โหลดข้อมูลไม่สำเร็จ', 'err'); return; }
    const cfg = WAREHOUSE_CONFIG[pg];
    const header = ['วันที่','เวลา','ประเภท','ผู้ทำรายการ','แผนก','รายการ','รหัส','จำนวน'];
    if (cfg.hasLot)        header.push('Lot Sawanbondin');
    if (cfg.lotSupplier)   header.push('Lot Supplier');
    header.push('หมายเหตุ','ช่องทาง');
    const rows = [header];
    for (const r of data) {
      const dt = new Date(r.created_at);
      const row = [
        dt.toLocaleDateString('th-TH'),
        dt.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' }),
        ACTION_LABELS[r.action_type] || r.action_type,
        r.operator_name || '',
        r.department || '',
        r.item_name || '',
        r.item_code || '',
        r.quantity || 0,
      ];
      if (cfg.hasLot)      row.push(r.lot_sw || '');
      if (cfg.lotSupplier) row.push(r.lot_supplier || '');
      row.push(r.note || '', r.via || '');
      rows.push(row);
    }
    const d = new Date().toISOString().split('T')[0];
    downloadCsv(`sawanbondin_${pg}_transactions_${d}.csv`, rows);
    showToast(`Export ${data.length} รายการสำเร็จ`);
  } catch(e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'err');
  }
}

/** Export Lot ทั้งหมดของวัตถุดิบ */
async function exportLotsCsv() {
  showToast('กำลังโหลดข้อมูล Lot...');
  try {
    const { data, error } = await sb.from('lots')
      .select('*')
      .order('item_code', { ascending: true })
      .order('lot_sw', { ascending: true });
    if (error) { showToast('โหลดข้อมูลไม่สำเร็จ', 'err'); return; }
    const rows = [
      ['รหัสสินค้า','ชื่อสินค้า','Lot Sawanbondin','Lot Supplier','สต็อกคงเหลือ','สถานะ'],
      ...data.map(r => [
        r.item_code, r.item_name,
        r.lot_sw || '',
        r.lot_supplier || '',
        r.stock,
        parseFloat(r.stock) <= 0 ? 'หมดแล้ว' : 'มีสต็อก',
      ])
    ];
    const d = new Date().toISOString().split('T')[0];
    downloadCsv(`sawanbondin_lots_${d}.csv`, rows);
    showToast(`Export ${data.length} Lot สำเร็จ`);
  } catch(e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'err');
  }
}

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
async function boot(){
  const banner=document.createElement('div');
  banner.id='bootBanner';
  banner.style.cssText='position:fixed;bottom:16px;right:16px;background:#1a1a1c;color:#fff;padding:9px 15px;border-radius:8px;font-size:12px;z-index:999;display:flex;align-items:center;gap:7px';
  banner.innerHTML='<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> กำลังโหลดข้อมูล...';
  document.body.appendChild(banner);

  // Load items
  const ok=await dbLoadItems();
  if(!ok){
    banner.innerHTML='<i class="ti ti-alert-circle" style="color:#e24b4a"></i> โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรช';
    return;
  }

  // First-time seed
  if(masterDB.length===0&&typeof SEED_DATA!=='undefined'){
    banner.innerHTML='<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> import ข้อมูลครั้งแรก...';
    const rows=generateSeedRows();
    for(let i=0;i<rows.length;i+=50){
      await sb.from('items').upsert(rows.slice(i,i+50),{onConflict:'code'});
    }
    await dbLoadItems();
  }

  // Preload lots สำหรับ raw และ finish
  try{
    const lotCodes=masterDB.filter(m=>WAREHOUSE_CONFIG[m.pg]?.hasLot).map(m=>m.code);
    if(lotCodes.length){
      const{data}=await sb.from('lots').select('*').in('item_code',lotCodes).order('lot_sw',{ascending:true});
      if(data)data.forEach(r=>{
        if(!lotDB[r.item_code])lotDB[r.item_code]=[];
        if(!lotDB[r.item_code].find(l=>l.id===r.id))
          lotDB[r.item_code].push({id:r.id,lot_sw:r.lot_sw,lot_supplier:r.lot_supplier||'',stock:parseFloat(r.stock)||0,updated_at:r.updated_at,expiry_date:r.expiry_date||null,note:r.note||''});
      });
    }
  }catch(e){console.warn(e);}

  // Load bin locations
  await dbLoadBinLocations();

  loadBatchLS();
  document.getElementById('topbarDate').textContent=dateToday();

  // โหลด user profile (username, display_name, department)
  if(currentUser){
    const { data: profile } = await sb
      .from('user_profiles')
      .select('username,display_name,department,role')
      .eq('id', currentUser.id)
      .single();
    const displayName = profile?.display_name
      || currentUser.user_metadata?.display_name
      || currentUser.email?.split('@')[0]
      || 'User';
    const dept = profile?.department || '';
    window._operatorName = displayName;
    window._operatorDept = dept;
    window._operatorRole = profile?.role || 'staff';
    const el = document.getElementById('topbarUser');
    if (el) el.textContent = `${displayName}${dept?' · '+dept:''}`;
  }

  checkAlerts();
  WAREHOUSE_PAGES.forEach(pg=>renderWarehousePage(pg));
  renderMasterPage();
  WAREHOUSE_PAGES.forEach(pg=>renderBatchCard(pg));
  banner.remove();

  // ── Realtime channels ──
  let _realtimeDebounce = null;
  function _scheduleRerender(reason) {
    // debounce 400ms กันการ re-render ซ้ำซ้อน
    clearTimeout(_realtimeDebounce);
    _realtimeDebounce = setTimeout(() => {
      checkAlerts();
      if (curPage === 'master') renderMasterContent();
      else if (curPage.startsWith('alert-')) renderAlertGroupPage(curPage.replace('alert-',''));
      else if (WAREHOUSE_PAGES.includes(curPage)) renderWarehousePage(curPage);
      else if (curPage === 'dashboard') renderDashboardPage();
    }, 400);
  }

  // items channel
  const itemsChannel = sb.channel('items-changes');
  itemsChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, payload => {
    const row = payload.new || payload.old;
    if (!row) return;
    if (payload.eventType === 'DELETE' || row.is_active === false) {
      masterDB = masterDB.filter(m => m.code !== (row.code || payload.old?.code));
    } else if (payload.eventType === 'INSERT') {
      if (!masterDB.find(m => m.code === row.code)) {
        masterDB.push({
          code:row.code, name:row.name, pg:row.pg||'', subcat:row.subcat||'',
          stock:parseFloat(row.stock)||0, min:parseFloat(row.min_stock)||0,
          max:parseFloat(row.max_stock)||0, seq:row.seq||0,
        });
      }
    } else if (payload.eventType === 'UPDATE') {
      const m = masterDB.find(x => x.code === row.code);
      if (m) {
        m.stock = parseFloat(row.stock)||0;
        m.min   = parseFloat(row.min_stock)||0;
        m.max   = parseFloat(row.max_stock)||0;
        m.name  = row.name || m.name;
        if (row.note) locationDB[row.code] = row.note;
      }
    }
    _scheduleRerender('items');
  }).subscribe(status => {
    if (status === 'CHANNEL_ERROR') console.warn('items-changes channel error');
  });

  // transactions channel
  let _txDebounce = {};
  const txChannel = sb.channel('tx-changes');
  txChannel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, async payload => {
    const pg = payload.new?.pg;
    if (!pg || !WAREHOUSE_PAGES.includes(pg)) return;
    // debounce per pg
    clearTimeout(_txDebounce[pg]);
    _txDebounce[pg] = setTimeout(async () => {
      const recs = await dbLoadTransactions(pg);
      if (recs) txState[pg].records = recs;
      if (curPage === pg) renderHistory(pg,1);
    }, 600);
  }).subscribe();

  // lots channel
  const lotsChannel = sb.channel('lots-changes');
  lotsChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'lots' }, payload => {
    const row = payload.new || payload.old;
    if (!row?.item_code) return;
    const code = row.item_code;
    if (payload.eventType === 'DELETE') {
      if (lotDB[code]) lotDB[code] = lotDB[code].filter(l => l.id !== payload.old.id);
    } else if (payload.eventType === 'INSERT') {
      if (!lotDB[code]) lotDB[code] = [];
      if (!lotDB[code].find(l => l.id === row.id)) {
        lotDB[code].push({
          id:row.id, lot_sw:row.lot_sw, lot_supplier:row.lot_supplier||'',
          stock:parseFloat(row.stock)||0, updated_at:row.updated_at,
          expiry_date:row.expiry_date||null,
        });
      }
    } else if (payload.eventType === 'UPDATE') {
      if (lotDB[code]) {
        const lot = lotDB[code].find(l => l.id === row.id);
        if (lot) {
          lot.stock = parseFloat(row.stock)||0;
          lot.updated_at = row.updated_at;
          if (row.expiry_date) lot.expiry_date = row.expiry_date;
        }
      }
    }
    // อัปเดต lot sub ที่เปิดอยู่เท่านั้น ไม่ re-render ทั้งหน้า
    const subEl = document.getElementById(`lot_sub_${code}`);
    if (subEl && subEl.style.display !== 'none') {
      const lots = (lotDB[code]||[]);
      const active = lots.filter(l=>l.stock>0);
      const zero   = lots.filter(l=>l.stock<=0);
      subEl.innerHTML = lots.length
        ? [...active,...zero].map(l=>{
            const sw = l.lot_sw ? new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : '?';
            const sp = l.lot_supplier ? new Date(l.lot_supplier).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
            const ex = l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
            const isEmpty = l.stock <= 0;
            const isExp   = l.expiry_date && new Date(l.expiry_date) < new Date();
            return`<div class="lot-sub-row" style="${isEmpty?'opacity:.45':''}${isExp?';background:#fdf2f2':''}">
              <span class="lot-date">${sw}${isEmpty?' <span style="font-size:9px;color:var(--red)">หมด</span>':''}</span>
              <span class="lot-stock-val">คงเหลือ ${l.stock}</span>
              ${sp?`<span style="font-size:10px;color:var(--ink3);margin-left:8px">Sup: ${sp}</span>`:''}
              ${ex?`<span style="font-size:10px;color:${isExp?'var(--red)':'var(--ink4)'};margin-left:8px">${isExp?'⚠️ หมดอายุ':'หมดอายุ'}: ${ex}</span>`:''}
            </div>`;
          }).join('')
        : '<div class="lot-empty">ยังไม่มี Lot</div>';
    }
  }).subscribe();

  // ── Auto-refresh ทุก 10 นาที (fallback เท่านั้น ไม่ใช่ realtime หลัก) ──
  let _autoRefreshTimer = null;
  function scheduleAutoRefresh() {
    clearTimeout(_autoRefreshTimer);
    _autoRefreshTimer = setTimeout(async () => {
      await dbLoadItems();
      checkAlerts();
      if (curPage === 'master') renderMasterContent();
      else if (WAREHOUSE_PAGES.includes(curPage)) {
        const recs = await dbLoadTransactions(curPage);
        if (recs) { txState[curPage].records = recs; renderHistory(curPage); }
      }
      scheduleAutoRefresh(); // วนซ้ำ
    }, 10 * 60 * 1000);
  }
  scheduleAutoRefresh();

  // หยุด auto-refresh เมื่อ tab ไม่ active เพื่อลด noise
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(_autoRefreshTimer);
    } else {
      // กลับมา active — refresh ทันทีครั้งเดียว แล้ววน schedule ใหม่
      dbLoadItems().then(() => { checkAlerts(); scheduleAutoRefresh(); });
    }
  });
}

// Start with auth
initAuth();

/* ═══════════════════════════════════════════
   STOCK COUNT MODULE — ตรวจนับสต็อก
   กรอกยอดจริง → บันทึกผลต่าง ไม่ปรับสต็อก
═══════════════════════════════════════════ */

let scPg     = 'raw';     // คลังที่กำลังตรวจ
let scSearch = '';        // คำค้น
let scData   = {};        // { code: actualStock } ที่กรอกแล้ว

/* ── DB ── */
async function dbSaveStockCount(rows) {
  // rows = [{ item_code, item_name, pg, system_stock, actual_stock, note, counted_by }]
  const { error } = await sb.from('stock_counts').insert(rows);
  if (error) { console.error('dbSaveStockCount:', error); return false; }
  return true;
}
async function dbLoadStockCountHistory(pg, limit=50) {
  const { data, error } = await sb.from('stock_counts')
    .select('*').eq('pg', pg)
    .order('counted_at', { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

/* ── RENDER ── */
async function renderStockCountPage() {
  const div = document.getElementById('page-stockcount');
  if (!div) return;

  const cfg   = WAREHOUSE_CONFIG[scPg];
  const hasLotPg = !!WAREHOUSE_CONFIG[scPg]?.hasLot;
  const items = masterDB.filter(m => m.pg === scPg);

  // โหลด lots สำหรับคลังที่มี lot
  if (hasLotPg) {
    const codes = items.map(m => m.code);
    if (codes.length) {
      const { data } = await sb.from('lots').select('*').in('item_code', codes).order('lot_sw',{ascending:true});
      if (data) data.forEach(r => {
        if (!lotDB[r.item_code]) lotDB[r.item_code] = [];
        if (!lotDB[r.item_code].find(l => l.id === r.id))
          lotDB[r.item_code].push({ id:r.id, lot_sw:r.lot_sw, lot_supplier:r.lot_supplier||'', stock:parseFloat(r.stock)||0, expiry_date:r.expiry_date||null, note:r.note||'', bag_number:r.bag_number||null, bag_total:r.bag_total||null, weight_kg:parseFloat(r.weight_kg)||null });
      });
    }
  }

  const filtered = scSearch
    ? items.filter(m => m.name.toLowerCase().includes(scSearch) || m.code.toLowerCase().includes(scSearch))
    : items;

  // สรุป — นับทั้ง item และ lot rows
  const counted    = filtered.filter(m => scData[m.code] !== undefined || (hasLotPg&&(lotDB[m.code]||[]).some(l=>scData[m.code+'_lot_'+l.id]!==undefined))).length;
  const diffItems  = filtered.filter(m => {
    if (!hasLotPg) return scData[m.code]!==undefined && scData[m.code]!==m.stock;
    const lots = (lotDB[m.code]||[]);
    if (lots.length) return lots.some(l=>scData[m.code+'_lot_'+l.id]!==undefined && scData[m.code+'_lot_'+l.id]!==l.stock);
    return scData[m.code]!==undefined && scData[m.code]!==m.stock;
  });
  const totalDiff = diffItems.reduce((s,m) => {
    if (!hasLotPg) return s + Math.abs((scData[m.code]||0)-m.stock);
    const lots=(lotDB[m.code]||[]);
    if(lots.length) return s+lots.reduce((ss,l)=>{
      const v=scData[m.code+'_lot_'+l.id];
      return v!==undefined?ss+Math.abs(v-l.stock):ss;
    },0);
    return s+Math.abs((scData[m.code]||0)-m.stock);
  },0);

  const pgTabs = Object.entries(WAREHOUSE_CONFIG).map(([pg,cfg]) =>
    `<div class="sc-pg-tab ${pg===scPg?'active':''}" onclick="scSwitchPg('${pg}')">${cfg.label}</div>`
  ).join('');

  // สร้าง table rows — แยก lot แต่ละแถว
  const tableRows = filtered.map((m,i) => {
    const lots = hasLotPg ? (lotDB[m.code]||[]) : [];
    const activeLots = lots.filter(l => l.stock > 0);
    const hasLots = activeLots.length > 0;

    if (!hasLots) {
      // รายการปกติ ไม่มี lot
      const actual  = scData[m.code];
      const hasVal  = actual !== undefined;
      const diff    = hasVal ? actual - m.stock : null;
      const diffCls = diff===null?'':diff>0?'sc-diff-pos':diff<0?'sc-diff-neg':'sc-diff-zero';
      const diffTxt = diff===null?'—':(diff>0?'+':'')+diff.toLocaleString();
      const status  = !hasVal?'<span class="sc-status-blank">ยังไม่นับ</span>':diff===0?'<span class="sc-status-ok">✓ ตรงกัน</span>':'<span class="sc-status-diff">ไม่ตรง</span>';
      return `<tr id="sc-row-${m.code}" ${diff!==null&&diff!==0?'style="background:#fef8f8"':''}>
        <td style="color:var(--ink4);font-size:11px">${i+1}</td>
        <td style="font-weight:500;color:var(--ink)">${m.name}</td>
        <td style="font-family:monospace;font-size:10px;color:var(--ink4)">${m.code}</td>
        <td style="color:var(--ink4);font-size:10px">—</td>
        <td style="text-align:right;font-weight:500">${m.stock.toLocaleString()}</td>
        <td style="text-align:center">
          <input class="sc-input" type="number" min="0" step="0.01" inputmode="decimal"
            placeholder="—" value="${hasVal?actual:''}"
            onchange="scSetVal('${m.code}',this.value)"
            onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();document.querySelector('[data-sc-next]')?.focus()}"
            id="sc-input-${m.code}">
        </td>
        <td style="text-align:right" class="${diffCls}">${diffTxt}</td>
        <td>${status}</td>
        <td><input style="border:none;background:none;outline:none;font-size:11px;color:var(--ink3);width:100px" placeholder="หมายเหตุ..." value="${scData[m.code+'_note']||''}" onchange="scSetNote('${m.code}',this.value)"></td>
      </tr>`;
    }

    // รายการที่มี lot — แสดงหัวแถว + แถว lot แต่ละ lot (ซ่อน lot stock=0)
    const lotRows = activeLots.map((l, li) => {
      const sw     = l.lot_sw ? new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '?';
      const sp     = l.lot_supplier ? new Date(l.lot_supplier).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
      const ex     = l.expiry_date  ? new Date(l.expiry_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
      const isExp  = l.expiry_date && new Date(l.expiry_date) < new Date();
      const key    = m.code+'_lot_'+l.id;
      const actual = scData[key];
      const hasVal = actual !== undefined;
      const diff   = hasVal ? actual - l.stock : null;
      const diffCls= diff===null?'':diff>0?'sc-diff-pos':diff<0?'sc-diff-neg':'sc-diff-zero';
      const diffTxt= diff===null?'—':(diff>0?'+':'')+diff.toLocaleString();
      const status = !hasVal?'<span class="sc-status-blank">ยังไม่นับ</span>':diff===0?'<span class="sc-status-ok">✓ ตรงกัน</span>':'<span class="sc-status-diff">ไม่ตรง</span>';
      const nextKey = li+1 < activeLots.length ? m.code+'_lot_'+activeLots[li+1].id : '';
      return `<tr id="sc-row-${key}" style="${diff!==null&&diff!==0?'background:#fef8f8':''};border-top:${li===0?'1px solid var(--line)':'none'}">
        ${li===0?`<td rowspan="${activeLots.length}" style="color:var(--ink4);font-size:11px;border-right:1px solid var(--line);vertical-align:top;padding-top:11px">${i+1}</td>
        <td rowspan="${activeLots.length}" style="font-weight:500;color:var(--ink);border-right:1px solid var(--line);vertical-align:top;padding-top:11px">${m.name}</td>
        <td rowspan="${activeLots.length}" style="font-family:monospace;font-size:10px;color:var(--ink4);border-right:1px solid var(--line);vertical-align:top;padding-top:11px">${m.code}</td>`:''}
        <td style="font-size:10px;padding-left:8px">
          <div style="font-family:monospace;font-weight:500;color:var(--ink2)">${sw}</div>
          ${sp?`<div style="color:var(--ink4)">Sup: ${sp}</div>`:''}
          ${ex?`<div style="color:${isExp?'var(--red)':'var(--ink4)'}">${isExp?'⚠️ ':''}หมดอายุ: ${ex}</div>`:''}
        </td>
        <td style="text-align:right;font-weight:500">${l.stock.toLocaleString()}</td>
        <td style="text-align:center">
          <input class="sc-input" type="number" min="0" step="0.01" inputmode="decimal"
            placeholder="—" value="${hasVal?actual:''}"
            id="sc-input-${key}"
            onchange="scSetLotVal('${m.code}','${l.id}',this.value,'${nextKey}')"
            onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();scFocusNext('','${nextKey}')}">
        </td>
        <td style="text-align:right" class="${diffCls}" id="sc-diff-${key}">${diffTxt}</td>
        <td id="sc-status-${key}">${status}</td>
        <td><input style="border:none;background:none;outline:none;font-size:11px;color:var(--ink3);width:100px" placeholder="หมายเหตุ..." value="${scData[key+'_note']||''}" onchange="scSetNote('${key}',this.value)"></td>
      </tr>`;
    }).join('');
    return lotRows;
  }).join('');

  div.innerHTML = `
    <div class="sc-header">
      <div>
        <div class="sc-title"><i class="ti ti-clipboard-check" style="color:var(--ink3)"></i> ตรวจนับสต็อก</div>
        <div class="sc-sub">กรอกยอดจริง เทียบกับยอดในระบบ — ${hasLotPg?'แสดงแยกตาม Lot · ':''}ไม่ปรับสต็อกอัตโนมัติ</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="scClearAll()"><i class="ti ti-eraser"></i> ล้าง</button>
        <button class="btn" onclick="scExportCSV()"><i class="ti ti-download"></i> Export</button>
        <button class="btn btn-primary" onclick="scSave()">
          <i class="ti ti-device-floppy"></i> บันทึกผล (${counted})
        </button>
      </div>
    </div>
    <div class="sc-summary">
      <div class="sc-kpi"><div class="sc-kpi-label">รายการทั้งหมด</div><div class="sc-kpi-val">${items.length}</div></div>
      <div class="sc-kpi"><div class="sc-kpi-label">นับแล้ว</div><div class="sc-kpi-val">${counted}</div></div>
      <div class="sc-kpi"><div class="sc-kpi-label">ยอดไม่ตรง</div><div class="sc-kpi-val" style="color:${diffItems.length>0?'var(--red)':'var(--ink)'}">${diffItems.length}</div></div>
      <div class="sc-kpi"><div class="sc-kpi-label">ผลต่างรวม</div><div class="sc-kpi-val" style="color:${totalDiff>0?'var(--red)':'var(--ink)'}">${totalDiff.toLocaleString()}</div></div>
    </div>
    <div class="sc-toolbar">
      <div class="sc-pg-tabs">${pgTabs}</div>
      <div class="sc-search">
        <i class="ti ti-search" style="font-size:12px;color:var(--ink4)"></i>
        <input placeholder="ค้นหารายการ..." value="${scSearch}" oninput="scSearch=this.value;renderStockCountPage()">
      </div>
    </div>
    <div class="sc-table-wrap">
      <table class="sc-table">
        <thead>
          <tr>
            <th style="width:28px">#</th>
            <th>รายการ</th>
            <th>รหัส</th>
            <th style="width:110px">${hasLotPg?'Lot SW':'—'}</th>
            <th style="text-align:right">ยอดในระบบ</th>
            <th style="text-align:center;width:100px">ยอดจริง</th>
            <th style="text-align:right">ผลต่าง</th>
            <th>สถานะ</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="sc-footer">
        <div style="font-size:11px;color:var(--ink4)">${counted>0?`นับแล้ว ${counted}/${filtered.length} · ไม่ตรง ${diffItems.length} รายการ`:'กรอกยอดจริงในช่องด้านบน · Tab หรือ Enter ไปรายการถัดไป'}</div>
        <div style="font-size:11px;color:var(--ink4)">ผู้ตรวจ: ${window._operatorName||'—'} · ${new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric'})}</div>
      </div>
    </div>`;
}


async function scSave() {
  const cfg      = WAREHOUSE_CONFIG[scPg];
  const hasLotPg = !!WAREHOUSE_CONFIG[scPg]?.hasLot;
  const items    = masterDB.filter(m => m.pg === scPg);
  const rows     = [];
  const adjustments = []; // สำหรับปรับ stock

  items.forEach(m => {
    const lots = hasLotPg ? (lotDB[m.code]||[]).filter(l => l.stock > 0) : [];
    if (lots.length) {
      lots.forEach(l => {
        const key = m.code + '_lot_' + l.id;
        if (scData[key] === undefined) return;
        const sw = l.lot_sw || '';
        rows.push({
          item_code:    m.code,
          item_name:    m.name + (sw ? ` [Lot ${new Date(sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}]` : ''),
          pg:           m.pg,
          system_stock: l.stock,
          actual_stock: scData[key],
          note:         scData[key+'_note'] || '',
          counted_by:   window._operatorName || '',
        });
        if (scData[key] !== l.stock) {
          adjustments.push({ m, l, actual: scData[key], key, note: scData[key+'_note']||'' });
        }
      });
    } else {
      if (scData[m.code] === undefined) return;
      rows.push({
        item_code:    m.code,
        item_name:    m.name,
        pg:           m.pg,
        system_stock: m.stock,
        actual_stock: scData[m.code],
        note:         scData[m.code+'_note'] || '',
        counted_by:   window._operatorName || '',
      });
      if (scData[m.code] !== m.stock) {
        adjustments.push({ m, l: null, actual: scData[m.code], key: m.code, note: scData[m.code+'_note']||'' });
      }
    }
  });

  if (!rows.length) { showToast('กรุณากรอกยอดจริงก่อน', 'err'); return; }

  const btn = document.querySelector('#page-stockcount .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> กำลังบันทึก...'; }

  // บันทึก stock count log
  const ok = await dbSaveStockCount(rows);
  if (!ok) {
    showToast('บันทึกไม่สำเร็จ', 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="ti ti-device-floppy"></i> บันทึกผล`; }
    return;
  }

  // ปรับ stock อัตโนมัติ + บันทึก transaction
  for (const adj of adjustments) {
    const { m, l, actual, note } = adj;
    const diff = actual - (l ? l.stock : m.stock);
    const action = diff > 0 ? 'receive' : 'withdraw';
    const qty = Math.abs(diff);
    const lotSW = l?.lot_sw || null;
    const lotId = l?.id || null;
    const swStr = lotSW ? new Date(lotSW).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
    const txNote = `ปรับจากตรวจนับ: ระบบ ${(l?l.stock:m.stock).toLocaleString()} → จริง ${actual.toLocaleString()}${note?' — '+note:''}`;

    // ปรับ lot stock
    if (l) {
      await sb.from('lots').update({ stock: actual, updated_at: new Date().toISOString() }).eq('id', l.id);
      l.stock = actual;
    }
    // ปรับ items stock
    const newItemStock = l
      ? (m.stock + diff)
      : actual;
    await sb.from('items').update({ stock: newItemStock }).eq('code', m.code);
    m.stock = newItemStock;

    // บันทึก transaction
    await dbInsertTransaction({
      item_code: m.code, item_name: m.name, pg: m.pg,
      action_type: action, quantity: qty,
      lot_sw: lotSW, old_stock: l ? l.stock + (diff < 0 ? diff : 0) : m.stock - diff,
      new_stock: newItemStock,
      operator_name: window._operatorName || '',
      note: txNote, via: 'stockcount'
    });
  }

  showToast(`บันทึกผลตรวจนับ ${rows.length} แถว · ปรับ stock ${adjustments.length} รายการ`);
  scData = {};
  renderStockCountPage();
}

function scSetLotVal(itemCode, lotId, val, nextKey) {
  const key = itemCode + '_lot_' + lotId;
  const lot = (lotDB[itemCode]||[]).find(l => String(l.id) === String(lotId));
  if (!lot) return;
  const n = parseFloat(val);
  if (val === '' || isNaN(n)) { delete scData[key]; }
  else { scData[key] = n; }
  const hasVal = scData[key] !== undefined;
  const diff   = hasVal ? scData[key] - lot.stock : null;
  const diffCls= diff===null?'':diff>0?'sc-diff-pos':diff<0?'sc-diff-neg':'sc-diff-zero';
  const diffTxt= diff===null?'—':(diff>0?'+':'')+diff.toLocaleString();
  const status = !hasVal?'<span class="sc-status-blank">ยังไม่นับ</span>'
               : diff===0?'<span class="sc-status-ok">✓ ตรงกัน</span>'
               : '<span class="sc-status-diff">ไม่ตรง</span>';
  const row = document.getElementById('sc-row-'+key);
  const diffEl = document.getElementById('sc-diff-'+key);
  const statusEl = document.getElementById('sc-status-'+key);
  if (row) row.style.background = diff!==null&&diff!==0 ? '#fef8f8' : '';
  if (diffEl) { diffEl.className = diffCls; diffEl.textContent = diffTxt; }
  if (statusEl) statusEl.innerHTML = status;
  renderScKpi();
}

function scSetVal(code, val) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  const n = parseFloat(val);
  if (val === '' || isNaN(n)) { delete scData[code]; }
  else { scData[code] = n; }
  const actual = scData[code];
  const hasVal = actual !== undefined;
  const diff   = hasVal ? actual - m.stock : null;
  const diffCls= diff===null?'':diff>0?'sc-diff-pos':diff<0?'sc-diff-neg':'sc-diff-zero';
  const diffTxt= diff===null?'—':(diff>0?'+':'')+diff.toLocaleString();
  const status = !hasVal?'<span class="sc-status-blank">ยังไม่นับ</span>'
               : diff===0?'<span class="sc-status-ok">✓ ตรงกัน</span>'
               : '<span class="sc-status-diff">ไม่ตรง</span>';
  const row = document.getElementById('sc-row-'+code);
  if (row) {
    row.cells[6].className = diffCls; row.cells[6].textContent = diffTxt;
    row.cells[7].innerHTML = status;
    row.style.background = diff!==null&&diff!==0 ? '#fef8f8' : '';
  }
  renderScKpi();
}

function scSetNote(code, val) { scData[code+'_note'] = val; }

function scFocusNext(cur, nextCode) {
  if (nextCode) {
    const el = document.getElementById('sc-input-'+nextCode);
    if (el) { el.focus(); el.select(); }
  }
}

function scSwitchPg(pg) { scPg = pg; scData = {}; renderStockCountPage(); }

function scClearAll() {
  if (!confirm('ล้างข้อมูลที่กรอกทั้งหมด?')) return;
  scData = {}; renderStockCountPage();
}

function renderScKpi() {
  const hasLotPg = !!WAREHOUSE_CONFIG[scPg]?.hasLot;
  const items = masterDB.filter(m => m.pg === scPg);
  let counted = 0, diffs = 0, totalDiff = 0;
  items.forEach(m => {
    const lots = hasLotPg ? (lotDB[m.code]||[]) : [];
    if (lots.length) {
      lots.forEach(l => {
        const k = m.code+'_lot_'+l.id;
        if (scData[k] !== undefined) {
          counted++;
          const d = scData[k] - l.stock;
          if (d !== 0) { diffs++; totalDiff += Math.abs(d); }
        }
      });
    } else if (scData[m.code] !== undefined) {
      counted++;
      const d = scData[m.code] - m.stock;
      if (d !== 0) { diffs++; totalDiff += Math.abs(d); }
    }
  });
  const kpis = document.querySelectorAll('.sc-kpi .sc-kpi-val');
  if (kpis.length >= 4) {
    kpis[1].textContent = counted;
    kpis[2].textContent = diffs; kpis[2].style.color = diffs>0?'var(--red)':'var(--ink)';
    kpis[3].textContent = totalDiff.toLocaleString(); kpis[3].style.color = totalDiff>0?'var(--red)':'var(--ink)';
  }
}

function scExportCSV() {
  const items = masterDB.filter(m => m.pg === scPg);
  const cfg   = WAREHOUSE_CONFIG[scPg];
  const date  = new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
  const rows  = [['รหัส','ชื่อสินค้า','คลัง','ยอดในระบบ','ยอดจริง','ผลต่าง','สถานะ','หมายเหตุ','วันที่ตรวจ','ผู้ตรวจ']];
  items.forEach(m => {
    const actual = scData[m.code];
    const hasVal = actual !== undefined;
    const diff   = hasVal ? actual - m.stock : '';
    const status = !hasVal ? 'ยังไม่นับ' : diff === 0 ? 'ตรงกัน' : 'ไม่ตรง';
    rows.push([m.code, m.name, cfg.label, m.stock, hasVal ? actual : '', diff, status, scData[m.code+'_note']||'', date, window._operatorName||'']);
  });
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ตรวจนับ_${cfg.label}_${date.replace(/\//g,'-')}.csv`;
  a.click();
}

/* ── Override switchPage ── */
const _scOrigSwitch = switchPage;
switchPage = async function(p) {
  if (p === 'stockcount') {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-page="stockcount"]')?.classList.add('active');
    // ซ่อนทุกหน้ารวมถึง dashboard
    const alertGroupPages = ALERT_GROUPS ? Object.keys(ALERT_GROUPS).map(g=>'alert-'+g) : [];
    const allPages = [...WAREHOUSE_PAGES, 'master', 'stockcount', 'dashboard', ...alertGroupPages];
    allPages.forEach(pg => {
      const el = document.getElementById('page-' + pg);
      if (el) el.className = pg === p ? 'page-visible' : 'page-hidden';
    });
    curPage = p;
    await renderStockCountPage();
  } else {
    _scOrigSwitch(p);
  }
};

/* ═══════════════════════════════════════════
   DASHBOARD MODULE — สำหรับผู้บริหาร (อ่านอย่างเดียว)
═══════════════════════════════════════════ */

async function renderDashboardPage(dbDateFrom, dbDateTo) {
  const div = document.getElementById('page-dashboard');
  if (!div) return;
  div.innerHTML = `<div style="padding:32px;text-align:center;color:var(--ink4)"><i class="ti ti-loader" style="font-size:24px"></i><br><span style="font-size:12px;margin-top:8px;display:block">กำลังโหลด...</span></div>`;

  const today    = new Date().toISOString().slice(0,10);
  const day30ago = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const day60fwd = new Date(Date.now()+60*86400000).toISOString().slice(0,10);
  const dateFrom = dbDateFrom || today;
  const dateTo   = dbDateTo   || today;
  const isToday  = dateFrom === dateTo && dateFrom === today;

  const [{ data:txDay }, { data:tx30 }, { data:expiryLots }, { data:scHistory }] = await Promise.all([
    sb.from('transactions').select('action_type,quantity,pg,item_name,operator_name,created_at')
      .gte('created_at', dateFrom+'T00:00:00+00:00')
      .lte('created_at', dateTo+'T23:59:59+00:00')
      .order('created_at',{ascending:false}),
    sb.from('transactions').select('action_type,quantity,pg,created_at')
      .gte('created_at',day30ago+'T00:00:00+00:00'),
    sb.from('lots').select('item_code,item_name,lot_sw,expiry_date,stock')
      .gt('stock',0).not('expiry_date','is',null)
      .lte('expiry_date',day60fwd).order('expiry_date',{ascending:true}),
    sb.from('stock_counts').select('*').order('counted_at',{ascending:false}).limit(20),
  ]);

  const now       = new Date();
  const recItems  = (txDay||[]).filter(t=>t.action_type==='receive');
  const withItems = (txDay||[]).filter(t=>t.action_type==='withdraw');
  const totalStock= masterDB.reduce((s,m)=>s+m.stock,0);
  const lowItems  = masterDB.filter(m=>m.min>0&&m.stock>0&&m.stock<m.min);
  const outItems  = masterDB.filter(m=>m.min>0&&m.stock===0);
  const allAlerts = [...outItems,...lowItems];
  const expPast   = (expiryLots||[]).filter(l=>new Date(l.expiry_date)<now);
  const exp30     = (expiryLots||[]).filter(l=>{const d=new Date(l.expiry_date);return d>=now&&d<=new Date(Date.now()+30*86400000);});

  const dateLabel = dateFrom===dateTo
    ? new Date(dateFrom).toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'})
    : `${new Date(dateFrom).toLocaleDateString('th-TH',{day:'numeric',month:'short'})} – ${new Date(dateTo).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})}`;

  // ── mini bar chart (7 วัน) ──
  const days7 = Array.from({length:7},(_,i)=>new Date(Date.now()-(6-i)*86400000).toISOString().slice(0,10));
  const dayRec  = days7.map(d=>(tx30||[]).filter(t=>t.created_at.slice(0,10)===d&&t.action_type==='receive').reduce((s,t)=>s+t.quantity,0));
  const dayWith = days7.map(d=>(tx30||[]).filter(t=>t.created_at.slice(0,10)===d&&t.action_type==='withdraw').reduce((s,t)=>s+t.quantity,0));
  const maxBar  = Math.max(...dayRec,...dayWith,1);
  const dayNames= days7.map(d=>new Date(d).toLocaleDateString('th-TH',{weekday:'short'}));
  const barChart= days7.map((_,i)=>`
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <div style="display:flex;align-items:flex-end;gap:2px;height:56px">
        <div title="รับเข้า ${dayRec[i]}" style="width:9px;border-radius:3px 3px 0 0;background:#7BAE95;height:${Math.max(2,Math.round(dayRec[i]/maxBar*56))}px;transition:height .3s"></div>
        <div title="เบิก ${dayWith[i]}" style="width:9px;border-radius:3px 3px 0 0;background:#D4A96A;height:${Math.max(2,Math.round(dayWith[i]/maxBar*56))}px;transition:height .3s"></div>
      </div>
      <div style="font-size:9px;color:var(--ink4)">${dayNames[i]}</div>
    </div>`).join('');

  // ── warehouse donut data ──
  const whColors = ['#7BAE95','#A8C5DA','#D4A96A','#B5B5D4','#C4A882','#8DB8A8','#C9A8B8'];
  const whData   = Object.entries(WAREHOUSE_CONFIG).map(([pg,cfg],i)=>{
    const total = masterDB.filter(m=>m.pg===pg).reduce((s,m)=>s+m.stock,0);
    return {pg,label:cfg.label,total,color:whColors[i]};
  }).filter(w=>w.total>0);
  const grandTotal = whData.reduce((s,w)=>s+w.total,0)||1;
  // SVG donut
  let angle = -90, r=40, cx=55, cy=55, strokeW=14;
  const donutPaths = whData.map(w=>{
    const pct   = w.total/grandTotal;
    const deg   = pct*360;
    const a1    = angle*Math.PI/180;
    const a2    = (angle+deg)*Math.PI/180;
    const x1    = cx+r*Math.cos(a1), y1=cy+r*Math.sin(a1);
    const x2    = cx+r*Math.cos(a2), y2=cy+r*Math.sin(a2);
    const large = deg>180?1:0;
    const path  = deg>359.9
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${w.color}" stroke-width="${strokeW}"/>`
      : `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${w.color}" stroke-width="${strokeW}" stroke-linecap="round"/>`;
    angle += deg;
    return path;
  }).join('');

  const donutLegend = whData.map(w=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f5f5f3">
      <div style="display:flex;align-items:center;gap:7px">
        <div style="width:8px;height:8px;border-radius:2px;background:${w.color};flex-shrink:0"></div>
        <span style="font-size:11px;color:var(--ink2)">${w.label}</span>
      </div>
      <span style="font-size:12px;font-weight:600;color:var(--ink)">${w.total.toLocaleString()}</span>
    </div>`).join('');

  // ── activity feed ──
  const recentTx = (txDay||[]).slice(0,12).map(t=>{
    const time = new Date(t.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    const isRec = t.action_type==='receive';
    const dotColor = isRec?'#7BAE95':'#D4A96A';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f8f8f6">
      <div style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.item_name}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:1px">${t.operator_name||'—'} · ${WAREHOUSE_CONFIG[t.pg]?.label||t.pg}</div>
      </div>
      <div style="flex-shrink:0;text-align:right">
        <div style="font-size:12px;font-weight:600;color:${isRec?'#3A7D52':'#92600A'}">${isRec?'+':'-'}${t.quantity}</div>
        <div style="font-size:9px;color:var(--ink4)">${time}</div>
      </div>
    </div>`;
  }).join('') || `<div style="padding:20px;text-align:center;color:var(--ink4);font-size:12px">ไม่มีรายการ</div>`;

  // ── low stock tags ──
  const lowTags = allAlerts.slice(0,20).map(m=>{
    const isOut = m.stock===0;
    const pct   = m.max>0?Math.min(100,Math.round(m.stock/m.max*100)):0;
    return `<div style="padding:9px 14px;border-bottom:1px solid #f8f8f6;display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.name}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:2px">${WAREHOUSE_CONFIG[m.pg]?.label||m.pg}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div style="width:40px;height:3px;background:#efefed;border-radius:2px;overflow:hidden"><div style="height:100%;background:${isOut?'#C47A7A':'#C4A06A'};width:${pct}%;border-radius:2px"></div></div>
        <span style="font-size:12px;font-weight:700;color:${isOut?'#A33030':'#92600A'};min-width:28px;text-align:right">${m.stock}</span>
        <span style="font-size:10px;padding:2px 7px;border-radius:5px;font-weight:500;background:${isOut?'#FDF2F2':'#FEF5E7'};color:${isOut?'#A33030':'#92600A'}">${isOut?'หมด':'ต่ำ'}</span>
      </div>
    </div>`;
  }).join('') || `<div style="padding:20px;text-align:center;color:#7BAE95;font-size:12px">✓ ทุกรายการปกติ</div>`;

  // ── lot expiry tags ──
  const lotTags = (expiryLots||[]).slice(0,12).map(l=>{
    const ex   = new Date(l.expiry_date);
    const days = Math.ceil((ex-now)/(1000*60*60*24));
    const bg   = days<0?'#FDF2F2':days<=30?'#FEF5E7':'#EDF5EF';
    const col  = days<0?'#A33030':days<=30?'#92600A':'#3A7D52';
    const label= days<0?`หมดแล้ว`:days===0?'วันนี้':`${days} วัน`;
    const sw   = l.lot_sw?new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    return `<div style="padding:9px 14px;border-bottom:1px solid #f8f8f6;display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.item_name}</div>
        <div style="font-size:10px;color:var(--ink4);font-family:monospace;margin-top:2px">Lot ${sw} · เหลือ ${l.stock}</div>
      </div>
      <span style="font-size:10px;padding:3px 8px;border-radius:5px;font-weight:600;background:${bg};color:${col};white-space:nowrap;flex-shrink:0">${label}</span>
    </div>`;
  }).join('') || `<div style="padding:20px;text-align:center;color:#7BAE95;font-size:12px">✓ ไม่มี Lot ใกล้หมดอายุ</div>`;

  // ── warehouse accordion — compact grid per warehouse ──
  const dbWhSearch2 = window._dbWhSearch || '';

  const whAccordion = Object.entries(WAREHOUSE_CONFIG).map(([pg,cfg],wi)=>{
    const allItems = masterDB.filter(m=>m.pg===pg);
    if(!allItems.length) return '';
    const items = dbWhSearch2
      ? allItems.filter(m=>m.name.toLowerCase().includes(dbWhSearch2)||m.code.toLowerCase().includes(dbWhSearch2))
      : allItems;
    const total  = allItems.reduce((s,m)=>s+m.stock,0);
    const low    = allItems.filter(m=>m.min>0&&m.stock>0&&m.stock<m.min).length;
    const out    = allItems.filter(m=>m.min>0&&m.stock===0).length;
    const tagBg  = out>0?'#FDF2F2':low>0?'#FEF5E7':'#EDF5EF';
    const tagCol = out>0?'#A33030':low>0?'#92600A':'#3A7D52';
    const tagTxt = out>0?`${out} หมด`:low>0?`${low} ต่ำ`:'ปกติ';
    const openByDefault = !!dbWhSearch2;

    if(!items.length) return '';

    // compact grid — 2 คอลัมน์ ไม่มี subcat header ไม่มี code
    const rows = items.map(m=>{
      const isOut = m.stock===0&&m.min>0;
      const isLow = m.stock>0&&m.min>0&&m.stock<m.min;
      const pct   = m.max>0?Math.min(100,Math.round(m.stock/m.max*100)):null;
      const barC  = isOut?'#C47A7A':isLow?'#C4A06A':'#7BAE95';
      const sCol  = isOut?'#A33030':isLow?'#92600A':'var(--ink)';
      const badge = isOut?`<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#FDF2F2;color:#A33030;font-weight:500;flex-shrink:0">หมด</span>`
                  : isLow?`<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#FEF5E7;color:#92600A;font-weight:500;flex-shrink:0">ต่ำ</span>`:'';
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid #f5f5f3;min-width:0;transition:background .1s" onmouseover="this.style.background='#f8f8f6'" onmouseout="this.style.background=''">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--ink)">${m.name}</div>
        ${pct!==null?`<div style="width:32px;height:3px;background:#efefed;border-radius:2px;overflow:hidden;flex-shrink:0"><div style="height:100%;background:${barC};width:${pct}%;border-radius:2px"></div></div>`:''}
        <div style="font-size:12px;font-weight:600;color:${sCol};min-width:36px;text-align:right;flex-shrink:0">${m.stock.toLocaleString()}</div>
        <div style="width:28px;flex-shrink:0;text-align:right">${badge}</div>
      </div>`;
    }).join('');

    return`<div style="border-top:1px solid #ebebea">
      <div onclick="dbToggleWh('dbwh-${pg}',${openByDefault||undefined})"
        style="padding:8px 12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:background .1s;user-select:none"
        onmouseover="this.style.background='#f8f8f6'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:7px">
          <i class="ti ti-chevron-right" id="dbwh-chev-${pg}" style="font-size:10px;color:var(--ink4);transition:transform .2s;flex-shrink:0;${openByDefault?'transform:rotate(90deg)':''}"></i>
          <div style="width:7px;height:7px;border-radius:2px;background:${whColors[wi]};flex-shrink:0"></div>
          <span style="font-size:12px;font-weight:500;color:var(--ink)">${cfg.label}</span>
          <span style="font-size:10px;color:var(--ink4)">${items.length}${dbWhSearch2?`/${allItems.length}`:''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:13px;font-weight:600;color:var(--ink)">${total.toLocaleString()}</span>
          <span style="font-size:10px;padding:2px 7px;border-radius:4px;font-weight:500;background:${tagBg};color:${tagCol}">${tagTxt}</span>
        </div>
      </div>
      <div id="dbwh-${pg}" style="display:${openByDefault?'block':'none'};columns:2;column-gap:0;column-fill:balance">${rows}</div>
    </div>`;
  }).join('');
  // ── date picker ──
  const datePicker=`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    <button class="btn btn-sm${isToday?' btn-primary':''}" onclick="renderDashboardPage()">วันนี้</button>
    <button class="btn btn-sm" onclick="renderDashboardPage('${new Date(Date.now()-86400000).toISOString().slice(0,10)}','${new Date(Date.now()-86400000).toISOString().slice(0,10)}')">เมื่อวาน</button>
    <button class="btn btn-sm" onclick="renderDashboardPage('${new Date(Date.now()-7*86400000).toISOString().slice(0,10)}','${today}')">7 วัน</button>
    <button class="btn btn-sm" onclick="renderDashboardPage('${day30ago}','${today}')">30 วัน</button>
    <input type="date" class="fi" style="width:130px;font-size:11px;padding:5px 8px" id="db-from" value="${dateFrom}">
    <span style="color:var(--ink4);font-size:11px">–</span>
    <input type="date" class="fi" style="width:130px;font-size:11px;padding:5px 8px" id="db-to" value="${dateTo}">
    <button class="btn btn-sm" onclick="renderDashboardPage(document.getElementById('db-from').value,document.getElementById('db-to').value)">ดู</button>
  </div>`;

  // ── RENDER ──
  div.innerHTML = `
<div style="padding:0 0 32px">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px">
    <div>
      <div style="font-size:20px;font-weight:600;color:var(--ink);letter-spacing:-.4px">Dashboard</div>
      <div style="font-size:12px;color:var(--ink4);margin-top:2px">${new Date().toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
    </div>
    <div style="display:flex;gap:7px">
      <button class="btn btn-sm" onclick="dbExportPNG()"><i class="ti ti-photo-down"></i> Export PNG</button>
      <button class="btn btn-sm" onclick="dbExportPDF()"><i class="ti ti-file-type-pdf"></i> Export PDF</button>
    </div>
  </div>

  <!-- KPI row -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:20px">
    ${[
      {icon:'ti-database',     label:'สต็อกรวม',     val:totalStock.toLocaleString(),  sub:`${masterDB.length} รายการ`,     col:'var(--ink)'},
      {icon:'ti-package-import',label:'รับเข้า',      val:recItems.reduce((s,t)=>s+t.quantity,0).toLocaleString(), sub:`${recItems.length} รายการ`,col:'#3A7D52'},
      {icon:'ti-package-export',label:'เบิกออก',      val:withItems.reduce((s,t)=>s+t.quantity,0).toLocaleString(), sub:`${withItems.length} รายการ`,col:'#92600A'},
      {icon:'ti-alert-triangle',label:'สต็อกต่ำ/หมด', val:allAlerts.length, sub:`${outItems.length} หมด · ${lowItems.length} ต่ำ`, col:allAlerts.length>0?'#92600A':'var(--ink)'},
      {icon:'ti-clock-exclamation',label:'Lot หมดอายุใกล้',val:(expiryLots||[]).length,sub:`${expPast.length} หมดแล้ว · ${exp30.length} ≤30 วัน`,col:expPast.length>0?'#A33030':exp30.length>0?'#92600A':'var(--ink)'},
    ].map(k=>`<div style="background:#fff;border:1px solid #ebebea;border-radius:14px;padding:16px 18px">
      <div style="font-size:10px;color:var(--ink4);margin-bottom:10px;display:flex;align-items:center;gap:5px"><i class="ti ${k.icon}" style="font-size:13px"></i>${k.label}</div>
      <div style="font-size:26px;font-weight:500;color:${k.col};letter-spacing:-.5px;line-height:1">${k.val}</div>
      <div style="font-size:10px;color:var(--ink4);margin-top:6px">${k.sub}</div>
    </div>`).join('')}
  </div>

  <!-- Row 1: Donut + Bar chart -->
  <div style="display:grid;grid-template-columns:300px 1fr;gap:12px;margin-bottom:12px">
    <div style="background:#fff;border:1px solid #ebebea;border-radius:14px;padding:16px 18px">
      <div style="font-size:11px;font-weight:600;color:var(--ink4);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px">สรุปคลังทั้งหมด</div>
      <div style="display:flex;align-items:center;gap:14px">
        <svg width="110" height="110" viewBox="0 0 110 110" style="flex-shrink:0">
          ${donutPaths}
          <text x="55" y="50" text-anchor="middle" style="font-size:18px;font-weight:600;fill:#1c1c1e">${totalStock.toLocaleString()}</text>
          <text x="55" y="66" text-anchor="middle" style="font-size:10px;fill:#aeaeb2">รวม</text>
        </svg>
        <div style="flex:1">${donutLegend}</div>
      </div>
    </div>
    <div style="background:#fff;border:1px solid #ebebea;border-radius:14px;padding:16px 18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:11px;font-weight:600;color:var(--ink4);text-transform:uppercase;letter-spacing:.5px">กิจกรรม 7 วัน</div>
        <div style="display:flex;gap:10px;font-size:10px;color:var(--ink4)">
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#7BAE95;margin-right:4px"></span>รับเข้า</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#D4A96A;margin-right:4px"></span>เบิก</span>
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:0;justify-content:space-around;padding:0 4px">${barChart}</div>
      <div style="display:flex;gap:16px;margin-top:10px;padding-top:10px;border-top:1px solid #f5f5f3">
        <div style="font-size:11px;color:var(--ink4)">รับ 7 วัน: <strong style="color:#3A7D52">${dayRec.reduce((a,b)=>a+b,0).toLocaleString()}</strong></div>
        <div style="font-size:11px;color:var(--ink4)">เบิก 7 วัน: <strong style="color:#92600A">${dayWith.reduce((a,b)=>a+b,0).toLocaleString()}</strong></div>
      </div>
    </div>
  </div>

  <!-- Row 2: รายการ + สต็อกต่ำ + Lot -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
    <div style="background:#fff;border:1px solid #ebebea;border-radius:14px;overflow:hidden">
      <div style="padding:13px 16px;border-bottom:1px solid #ebebea;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:6px"><i class="ti ti-history" style="font-size:13px;color:var(--ink3)"></i> รายการ</div>
        <div style="display:flex;gap:5px">${['วันนี้','เมื่อวาน','7วัน','30วัน'].map((l,i)=>{
          const froms=[today,new Date(Date.now()-86400000).toISOString().slice(0,10),new Date(Date.now()-7*86400000).toISOString().slice(0,10),day30ago];
          const tos=[today,new Date(Date.now()-86400000).toISOString().slice(0,10),today,today];
          const act=dateFrom===froms[i]&&dateTo===tos[i];
          return `<button onclick="renderDashboardPage('${froms[i]}','${tos[i]}')" style="font-size:10px;padding:3px 8px;border-radius:8px;border:1px solid ${act?'var(--ink)':'#ebebea'};background:${act?'var(--ink)':'#fff'};color:${act?'#fff':'var(--ink3)'};cursor:pointer">${l}</button>`;
        }).join('')}</div>
      </div>
      <div style="max-height:300px;overflow-y:auto;padding:0 2px">${recentTx}</div>
    </div>
    <div style="background:#fff;border:1px solid #ebebea;border-radius:14px;overflow:hidden">
      <div style="padding:13px 16px;border-bottom:1px solid #ebebea;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:6px"><i class="ti ti-alert-triangle" style="font-size:13px;color:#C4A06A"></i> สต็อกต่ำ/หมด</div>
        <span style="font-size:10px;padding:2px 8px;border-radius:5px;background:${allAlerts.length>0?'#FEF5E7':'#EDF5EF'};color:${allAlerts.length>0?'#92600A':'#3A7D52'};font-weight:500">${allAlerts.length} รายการ</span>
      </div>
      <div style="max-height:300px;overflow-y:auto">${lowTags}</div>
    </div>
    <div style="background:#fff;border:1px solid #ebebea;border-radius:14px;overflow:hidden">
      <div style="padding:13px 16px;border-bottom:1px solid #ebebea;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:6px"><i class="ti ti-clock-exclamation" style="font-size:13px;color:#C47A7A"></i> Lot ใกล้หมดอายุ</div>
        <span style="font-size:10px;color:var(--ink4)">${expPast.length} หมดแล้ว · ${exp30.length} ≤30 วัน</span>
      </div>
      <div style="max-height:300px;overflow-y:auto">${lotTags}</div>
    </div>
  </div>

  <!-- Row 3: ยอดคงเหลือแยกคลัง accordion -->
  <div style="background:#fff;border:1px solid #ebebea;border-radius:14px;overflow:hidden;margin-bottom:12px">
    <div style="padding:13px 16px;border-bottom:1px solid #ebebea;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:6px"><i class="ti ti-list-details" style="font-size:13px;color:var(--ink3)"></i> ยอดคงเหลือแยกคลัง</div>
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;background:var(--s2);border:1px solid var(--line);border-radius:8px;padding:5px 10px;min-width:180px">
          <i class="ti ti-search" style="font-size:12px;color:var(--ink4)"></i>
          <input placeholder="ค้นหารายการ..." id="db-wh-search"
            style="border:none;background:none;outline:none;font-size:12px;color:var(--ink);width:100%"
            value="${window._dbWhSearch||''}"
            oninput="window._dbWhSearch=this.value.toLowerCase();renderDashboardPage(document.getElementById('db-from')?.value,document.getElementById('db-to')?.value)">
        </div>
        <button class="btn btn-sm" onclick="dbExpandAll(true)">ขยายทั้งหมด</button>
        <button class="btn btn-sm" onclick="dbExpandAll(false)">ยุบทั้งหมด</button>
      </div>
    </div>
    ${whAccordion}
  </div>

  <!-- Row 4: ประวัติตรวจนับ -->
  <div style="background:#fff;border:1px solid #ebebea;border-radius:14px;overflow:hidden">
    <div style="padding:13px 16px;border-bottom:1px solid #ebebea;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:12px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:6px"><i class="ti ti-clipboard-check" style="font-size:13px;color:var(--ink3)"></i> ประวัติตรวจนับล่าสุด</div>
      <span style="font-size:10px;color:var(--ink4)">${(scHistory||[]).length} รายการ</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>${['วันที่','รายการ','คลัง','ยอดระบบ','ยอดจริง','ผลต่าง','ผู้ตรวจ'].map((h,i)=>`<th style="padding:8px 13px;font-size:9px;color:var(--ink4);font-weight:600;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #ebebea;text-align:${i>=3&&i<=5?'right':'left'}">${h}</th>`).join('')}</tr></thead>
      <tbody>${(scHistory||[]).slice(0,15).map(r=>{
        const diff=parseFloat(r.difference)||0;
        const col=diff>0?'#3A7D52':diff<0?'#A33030':'var(--ink4)';
        const at=new Date(r.counted_at).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'});
        return `<tr style="border-bottom:1px solid #f8f8f6">
          <td style="padding:9px 13px;font-size:10px;color:var(--ink4);white-space:nowrap">${at}</td>
          <td style="padding:9px 13px;font-size:12px;font-weight:500;color:var(--ink);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.item_name}</td>
          <td style="padding:9px 13px;font-size:10px;color:var(--ink4)">${WAREHOUSE_CONFIG[r.pg]?.label||r.pg}</td>
          <td style="padding:9px 13px;font-size:12px;text-align:right">${r.system_stock}</td>
          <td style="padding:9px 13px;font-size:12px;font-weight:600;text-align:right">${r.actual_stock}</td>
          <td style="padding:9px 13px;font-size:12px;font-weight:700;text-align:right;color:${col}">${diff===0?'—':(diff>0?'+':'')+diff}</td>
          <td style="padding:9px 13px;font-size:10px;color:var(--ink3)">${r.counted_by||'—'}</td>
        </tr>`;
      }).join('')||`<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--ink4);font-size:12px">ยังไม่มีประวัติ</td></tr>`}</tbody>
    </table>
  </div>

</div>`;
}

/* ═══════════════════════════════════════════
   ALERT GROUP PAGES — หน้าเต็มสำหรับ "รายการจัดซื้อ" / "รายการเบิก"
   ใช้เฉพาะระบบที่ตั้ง ALERT_GROUPS ไว้ (เช่น Tea House)
═══════════════════════════════════════════ */
/* ── Purchase Tracking (Factory) ── */
const PAY_STATUS_OPTS = {
  '':        { label:'— การชำระ —',    color:'var(--ink4)' },
  ordered:   { label:'จัดซื้อแล้ว',    color:'#5b8fe8' },
  waiting:   { label:'รอชำระเงิน',     color:'#e8a23a' },
  paid:      { label:'ชำระแล้ว',       color:'var(--green)' },
};
const SHIP_STATUS_OPTS = {
  '':        { label:'— การจัดส่ง —',  color:'var(--ink4)' },
  shipping:  { label:'กำลังจัดส่ง',    color:'#5b8fe8' },
  received:  { label:'ได้รับของแล้ว',  color:'#9b6fe8' },
  qc:        { label:'รอ QC',          color:'#e8a23a' },
  stocked:   { label:'รับเข้าคลังแล้ว', color:'var(--green)' },
};

async function setPurchaseTracking(code, field, value) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  m[field] = value || null;
  if (field === 'ship_status' && value === 'stocked') {
    m.pay_status = null; m.ship_status = null;
    m.tracking_url = null; m.expected_arrival_date = null;
  }
  await sb.from('items').update({
    pay_status: m.pay_status, ship_status: m.ship_status,
    tracking_url: m.tracking_url, expected_arrival_date: m.expected_arrival_date
  }).eq('code', code);
  if (curPage.startsWith('alert-')) renderAlertGroupPage(curPage.replace('alert-',''));
}

async function setTrackingUrl(code, url) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  m.tracking_url = url.trim() || null;
  await sb.from('items').update({ tracking_url: m.tracking_url }).eq('code', code);
}

async function setExpectedArrival(code, date) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  m.expected_arrival_date = date || null;
  await sb.from('items').update({ expected_arrival_date: m.expected_arrival_date }).eq('code', code);
  if (curPage.startsWith('alert-')) renderAlertGroupPage(curPage.replace('alert-',''));
}

async function setNextOrderDate(code, date) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  m.next_order_date = date || null;
  await sb.from('items').update({ next_order_date: m.next_order_date }).eq('code', code);
}

function checkArrivalAlerts() {
  const today = new Date(); today.setHours(0,0,0,0);

  // เช็คของถึงกำหนด
  const overdue = masterDB.filter(m => {
    if (!m.expected_arrival_date) return false;
    if (m.ship_status === 'stocked' || m.ship_status === 'received') return false;
    return new Date(m.expected_arrival_date) <= today;
  });

  // เช็คถึงวันสั่งซื้อ
  const orderDue = masterDB.filter(m => {
    if (!m.next_order_date) return false;
    return new Date(m.next_order_date) <= today;
  });

  if (overdue.length > 0) {
    const names = overdue.map(m=>m.name).slice(0,2).join(', ');
    const more = overdue.length > 2 ? ` +${overdue.length-2}` : '';
    showToast(`📦 ของถึงกำหนด: ${names}${more}`, null, 6000);
  }
  if (orderDue.length > 0) {
    const names = orderDue.map(m=>m.name).slice(0,2).join(', ');
    const more = orderDue.length > 2 ? ` +${orderDue.length-2}` : '';
    showToast(`🛒 ถึงวันสั่งซื้อ: ${names}${more}`, null, 6000);
  }
  return { overdue, orderDue };
}

function _trackingDropdowns(m) {
  const payVal  = m.pay_status  || '';
  const shipVal = m.ship_status || '';
  const payOpts  = Object.entries(PAY_STATUS_OPTS).map(([v,o]) =>
    `<option value="${v}" ${payVal===v?'selected':''}>${o.label}</option>`).join('');
  const shipOpts = Object.entries(SHIP_STATUS_OPTS).map(([v,o]) =>
    `<option value="${v}" ${shipVal===v?'selected':''}>${o.label}</option>`).join('');
  const trackUrl = m.tracking_url || '';
  return `<div style="display:flex;flex-direction:column;gap:4px;min-width:160px">
    <select style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--ink2);cursor:pointer"
      onchange="setPurchaseTracking('${m.code}','pay_status',this.value)">${payOpts}</select>
    <select style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--ink2);cursor:pointer"
      onchange="setPurchaseTracking('${m.code}','ship_status',this.value)">${shipOpts}</select>
    <div style="display:flex;gap:3px;align-items:center">
      <input type="url" placeholder="ลิงก์ Tracking..." value="${trackUrl}"
        style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);flex:1;min-width:0;color:var(--ink2)"
        onchange="setTrackingUrl('${m.code}',this.value)"
        onblur="setTrackingUrl('${m.code}',this.value)">
      ${trackUrl?`<a href="${trackUrl}" target="_blank" style="color:var(--ink3);font-size:13px;line-height:1;text-decoration:none"><i class="ti ti-external-link"></i></a>`:''}
    </div>
    ${payVal==='waiting'?`<button class="btn btn-sm" onclick="openPaymentRequest('${m.code}')" style="font-size:10px;padding:3px 8px">
      <i class="ti ti-file-invoice"></i> แจ้งเบิก
    </button>`:''}
  </div>`;
}

/* ── Payment Request Modal ── */
let prItems = [];
let paymentSuppliers = []; // cache จาก DB

const PR_CATEGORIES = [
  'เบิกค่าวัตถุดิบ',
  'เบิกค่าฉลากบรรจุภัณฑ์',
  'เบิกค่าอุปกรณ์',
  'เบิกค่าบรรจุภัณฑ์',
  'เบิกค่าสกรีนซอง',
  'เบิกค่าใช้จ่ายบริษัท',
  'เบิกค่าน้ำมันรถ',
  'เบิกค่าวัตถุดิบและค่าใช้จ่ายอื่นๆ',
  'ค่าไปรษณีย์',
  'ค่าน้ำประปา',
  'เบิกค่าซ่อมอุปกรณ์โรงงาน',
];

async function dbLoadPaymentSuppliers() {
  const { data } = await sb.from('payment_suppliers').select('*').order('name');
  paymentSuppliers = data || [];
}

function _renderPrSupplierSel() {
  const sel = document.getElementById('prShopSel');
  if (!sel) return;
  // datalist สำหรับพิมพ์และค้นหา
  const dl = document.getElementById('prShopDatalist');
  if (dl) dl.innerHTML = paymentSuppliers.map(s => `<option value="${s.name}" data-id="${s.id}">${s.name}</option>`).join('');
  const opts = paymentSuppliers.map(s =>
    `<option value="${s.id}" data-name="${s.name}" data-pay="${s.pay_type}" data-num="${s.acc_num||''}" data-accname="${s.acc_name||''}" data-bank="${s.bank||''}">${s.name}</option>`
  ).join('');
  sel.innerHTML = `<option value="">— เลือกร้านที่บันทึกไว้ —</option>${opts}<option value="new">+ บันทึกร้านใหม่</option>`;
}

function onPrShopNameInput(val) {
  // พิมพ์ชื่อแล้วค้นหาจาก supplier list
  const sup = paymentSuppliers.find(s => s.name.toLowerCase() === val.toLowerCase());
  if (sup) {
    document.getElementById('prPayType').value = sup.pay_type || 'พร้อมเพย์';
    document.getElementById('prAccNum').value = sup.acc_num || '';
    document.getElementById('prAccName').value = sup.acc_name || '';
    document.getElementById('prBank').value = sup.bank || '';
    document.getElementById('prBankRow').style.display = sup.pay_type === 'โอนธนาคาร' ? 'block' : 'none';
    document.getElementById('prSaveSupplier').style.display = 'none';
  } else {
    document.getElementById('prSaveSupplier').style.display = val.trim() ? 'block' : 'none';
  }
  updatePrPreview();
}

async function dbSavePaymentSupplier(sup) {
  const { data } = await sb.from('payment_suppliers').insert(sup).select().single();
  if (data) paymentSuppliers.push(data);
  return data;
}

async function openPaymentRequest(code) {
  await dbLoadPaymentSuppliers();
  const m = masterDB.find(x => x.code === code);
  document.getElementById('prCode').value = code||'';
  document.getElementById('prCategory').value = '';
  document.getElementById('prShopSel').value = '';
  document.getElementById('prShopName').value = m?.supplier_name||'';
  document.getElementById('prPayType').value = 'พร้อมเพย์';
  document.getElementById('prBank').value = '';
  document.getElementById('prBankRow').style.display = 'none';
  document.getElementById('prAccNum').value = '';
  document.getElementById('prAccName').value = '';
  document.getElementById('prSaveSupplier').style.display = 'none';
  prItems = m ? [{desc: m.name, qty: m.supplier_qty||'', price: m.supplier_price||''}] : [{desc:'', qty:'', price:''}];
  _renderPrSupplierSel();
  renderPrItems();
  updatePrPreview();
  document.getElementById('paymentRequestModal').classList.add('show');
}

function onPrShopSelChange(sel) {
  if (sel.value === 'new') {
    sel.value = '';
    ['prShopName','prAccNum','prAccName'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('prBank').value = '';
    document.getElementById('prPayType').value = 'พร้อมเพย์';
    document.getElementById('prBankRow').style.display = 'none';
    document.getElementById('prSaveSupplier').style.display = 'block';
    return;
  }
  if (!sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  document.getElementById('prShopName').value = opt.dataset.name||'';
  document.getElementById('prPayType').value = opt.dataset.pay||'พร้อมเพย์';
  document.getElementById('prAccNum').value = opt.dataset.num||'';
  document.getElementById('prAccName').value = opt.dataset.accname||'';
  document.getElementById('prBank').value = opt.dataset.bank||'';
  document.getElementById('prBankRow').style.display = opt.dataset.pay==='โอนธนาคาร'?'block':'none';
  document.getElementById('prSaveSupplier').style.display = 'none';
  updatePrPreview();
}

async function savePrSupplier() {
  const name = document.getElementById('prShopName').value.trim();
  const pay_type = document.getElementById('prPayType').value;
  const acc_num = document.getElementById('prAccNum').value.trim();
  const acc_name = document.getElementById('prAccName').value.trim();
  const bank = document.getElementById('prBank').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อร้าน','err'); return; }
  const sup = await dbSavePaymentSupplier({name, pay_type, acc_num, acc_name, bank});
  if (sup) {
    _renderPrSupplierSel();
    document.getElementById('prSaveSupplier').style.display = 'none';
    showToast(`บันทึกร้าน "${name}" แล้ว`);
  }
}

function renderPrItems() {
  const container = document.getElementById('prItemRows');
  if (!container) return;
  container.innerHTML = prItems.map((it, i) => `
    <div style="display:grid;grid-template-columns:1fr 70px 90px 22px;gap:5px;margin-bottom:5px;align-items:center">
      <input class="fi" value="${it.desc||''}" placeholder="ชื่อรายการ..."
        style="padding:4px 7px;font-size:11px" oninput="prItems[${i}].desc=this.value;updatePrPreview()">
      <input class="fi" value="${it.qty||''}" placeholder="จำนวน"
        style="padding:4px 7px;font-size:11px" oninput="prItems[${i}].qty=this.value;updatePrPreview()">
      <input class="fi" type="number" value="${it.price||''}" placeholder="ราคา"
        style="padding:4px 7px;font-size:11px" oninput="prItems[${i}].price=this.value;updatePrPreview()">
      <button onclick="prItems.splice(${i},1);renderPrItems();updatePrPreview()"
        style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px;padding:0">✕</button>
    </div>`).join('');
}

function addPrItem() {
  prItems.push({desc:'', qty:'', price:''});
  renderPrItems();
}

function onPrPayTypeChange(sel) {
  const bankRow = document.getElementById('prBankRow');
  if (bankRow) bankRow.style.display = sel.value === 'โอนธนาคาร' ? 'block' : 'none';
  updatePrPreview();
}

function updatePrPreview() {
  const category = document.getElementById('prCategory')?.value||'';
  const shop     = document.getElementById('prShopName')?.value||'';
  const payType  = document.getElementById('prPayType')?.value||'พร้อมเพย์';
  const bank     = document.getElementById('prBank')?.value||'';
  const accNum   = document.getElementById('prAccNum')?.value||'';
  const accName  = document.getElementById('prAccName')?.value||'';
  const total = prItems.reduce((s,it) => s + (parseFloat(it.price)||0), 0);
  const fmt = n => n.toLocaleString('th-TH', {minimumFractionDigits:0, maximumFractionDigits:2});

  const itemLines = prItems.filter(it=>it.desc||it.price)
    .map(it => `- ${it.desc||'รายการ'}${it.qty?' จำนวน '+it.qty:''} ราคา ${fmt(parseFloat(it.price)||0)} บาท`)
    .join('\n');

  let paySection = '';
  if (payType === 'เงินสด') {
    paySection = 'ชำระเป็นเงินสด';
  } else if (payType === 'โอนธนาคาร') {
    paySection = `โอนธนาคาร${bank?' '+bank:''}\nเลขบัญชี ${accNum}\nชื่อบัญชี ${accName}`;
  } else {
    paySection = `${payType}\nเลขบัญชี ${accNum}\nชื่อบัญชี ${accName}`;
  }

  const text = [category, shop, '', itemLines, '', `รวมยอดโอน ${fmt(total)} บาท`, '', paySection].join('\n');
  const preview = document.getElementById('prPreview');
  if (preview) preview.textContent = text;
  const totalEl = document.getElementById('prTotal');
  if (totalEl) totalEl.textContent = fmt(total) + ' บาท';
}

async function copyPaymentRequest() {
  const text = document.getElementById('prPreview')?.textContent||'';
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copy ข้อความแล้ว — นำไปวางใน Line ได้เลย');
  } catch(e) { showToast('Copy ไม่สำเร็จ','err'); }
}

function _progDots(pay, ship) {
  const steps = [pay !== '', pay === 'paid', ['shipping','received','qc','stocked'].includes(ship), ship === 'stocked'];
  let h = '';
  steps.forEach((done, i) => {
    const isCur = !done && (i === 0 || steps[i-1]);
    const cls = done ? 'background:var(--green);border-color:var(--green)' : isCur ? 'background:var(--acc);border-color:var(--acc)' : 'background:transparent;border-color:var(--line2)';
    h += `<div style="width:8px;height:8px;border-radius:50%;border:1.5px solid;flex-shrink:0;${cls}"></div>`;
    if (i < 3) {
      const lc = (done && steps[i+1]) ? 'var(--green)' : done ? 'var(--acc)' : 'var(--line2)';
      h += `<div style="flex:1;height:1.5px;background:${lc}"></div>`;
    }
  });
  return `<div style="display:flex;align-items:center;gap:2px;min-width:90px">${h}</div>`;
}

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

  // ── PURCHASE — แจ้งผลิต (raw, matcha, finish) ──
  const PURCHASE_GROUPS = [
    { pg: 'raw',    label: 'วัตถุดิบ' },
    { pg: 'matcha', label: 'ชาบดผงมัตจะ' },
    { pg: 'finish', label: 'สินค้าสำเร็จรูป' },
  ];

  const allAlerts = masterDB.filter(m => {
    const pgs = PURCHASE_GROUPS.map(g=>g.pg);
    return pgs.includes(m.pg) && m.min > 0 && m.stock <= m.min;
  });

  const totalLow  = allAlerts.length;
  const totalZero = allAlerts.filter(m => m.stock <= 0).length;

  const sections = PURCHASE_GROUPS.map(({pg, label}) => {
    const items = allAlerts.filter(m => m.pg === pg);
    if (!items.length) return '';

    const rows = items.map((m,i) => {
      const stockColor = m.stock <= 0 ? 'var(--red)' : 'var(--warn)';
      return `<tr>
        <td style="color:var(--ink4);font-size:11px">${i+1}</td>
        <td style="font-weight:500;font-size:12px">${m.name}</td>
        <td style="text-align:right;font-weight:600;color:${stockColor};font-size:12px">${m.stock.toLocaleString()}</td>
        <td style="text-align:right;color:var(--ink4);font-size:12px">${m.min.toLocaleString()}</td>
      </tr>`;
    }).join('');

    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:var(--s2);border:0.5px solid var(--line);border-radius:8px;margin-bottom:6px">
        <span style="font-size:12px;font-weight:500">${label}</span>
        <span style="font-size:10px;color:var(--ink4)">${items.length} รายการ</span>
      </div>
      <div class="sc-table-wrap">
        <table class="sc-table">
          <thead><tr>
            <th style="width:28px">#</th>
            <th>รายการ</th>
            <th style="text-align:right">คงเหลือ</th>
            <th style="text-align:right">Min</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">รายการแจ้งผลิต</div>
        <div class="page-sub">สินค้าที่สต็อกต่ำกว่า Min</div></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <div class="card" style="flex:1;padding:10px 14px;text-align:center">
        <div style="font-size:18px;font-weight:600">${totalLow}</div>
        <div style="font-size:10px;color:var(--ink4)">รายการทั้งหมด</div>
      </div>
      <div class="card" style="flex:1;padding:10px 14px;text-align:center">
        <div style="font-size:18px;font-weight:600;color:var(--red)">${totalZero}</div>
        <div style="font-size:10px;color:var(--ink4)">หมดสต็อก</div>
      </div>
      <div class="card" style="flex:1;padding:10px 14px;text-align:center">
        <div style="font-size:18px;font-weight:600;color:var(--warn)">${totalLow - totalZero}</div>
        <div style="font-size:10px;color:var(--ink4)">ต่ำกว่า Min</div>
      </div>
    </div>
    ${sections || `<div style="padding:40px;text-align:center;color:var(--ink4)">
      <i class="ti ti-check" style="font-size:32px;display:block;margin-bottom:8px;opacity:.3"></i>
      สต็อกอยู่ในเกณฑ์ปกติทั้งหมด</div>`}`;
  return;
}

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
