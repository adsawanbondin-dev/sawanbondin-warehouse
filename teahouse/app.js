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
  equip:     { label:'อุปกรณ์',           prefix:'EQ', hasLot:false, lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'] },
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

// Factory Supabase client สำหรับตัดสต็อก Factory
const sbFactory = window.supabase.createClient(
  'https://rsmcrshvcbtcxvvhdmnk.supabase.co',
  'sb_publishable__RK27ReptMhtMdc8EdA-KQ_K4zfhMwJ'
);

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let masterDB        = [];
let locationDB      = {};    // { code: string }
let specDB          = {};    // { code: string } — สเปกอุปกรณ์
let lotDB           = {};    // { code: [{id,lot_sw,stock,updated_at}] }
let masterCatFilter = 'all';
let masterPgFilter  = '';  // คลังที่เลือกอยู่ใน Master
let masterSubFilter = '';  // หมวดหมู่ย่อยที่เลือก
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
  // บันทึก spec ถ้าคลังนี้มี hasSpec
  if (WAREHOUSE_CONFIG[m.pg]?.hasSpec) {
    payload.spec = specDB[m.code] || null;
  }
  payload.pay_status   = m.pay_status   || null;
  payload.ship_status  = m.ship_status  || null;
  payload.tracking_url = m.tracking_url || null;
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
  const cols = 'code,name,pg,subcat,stock,min_stock,max_stock,note,spec,seq,updated_at,pay_status,ship_status,tracking_url' + supplierCols;
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
  if (!deptEl) errors.push('กรุณาเลือกแผนก');

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
  ['master', ...WAREHOUSE_PAGES, 'stockcount', 'dashboard', ...alertGroupPages].forEach(pg => {
    const el = document.getElementById('page-'+pg);
    if (el) el.className = pg===p ? 'page-visible' : 'page-hidden';
  });
  curPage = p;
  if (p==='master') {
    renderMasterPage();
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
      ${Object.entries(ACTION_LABELS).filter(([v])=>v!=='transform_lot'||cfg.hasLot).map(([v,l])=>`<option value="${v}" ${action===v?'selected':''}>${l}</option>`).join('')}
    </select>
    <i class="ti ti-chevron-down action-select-icon"></i>
  </div>`;

  h += `<div class="form-grid">
    <div class="fg">
      <label class="fl">ผู้ทำรายการ <span class="req">*</span></label>
      <input class="fi" id="${pg}-name" placeholder="ชื่อ-นามสกุล"
        autocomplete="name">
    </div>
    <div class="fg">
      <label class="fl">แผนก <span class="req">*</span></label>
      <div class="radio-grp" id="${pg}-dept">${deptOpts}</div>
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
      // เพิ่มช่องวันหมดอายุสำหรับคลังที่มี hasExpiry
      if (cfg.hasExpiry) {
        h += `<div class="lot-single" style="margin-top:8px">
          <div class="fg">
            <label class="fl">วันหมดอายุ</label>
            <input class="fi" id="${pg}-expiry" type="date">
            <div class="fhint">ไม่บังคับกรอก</div>
          </div>
        </div>`;
      }
    } else {
      h += `<div class="lot-single">
        <div class="fg">
          <label class="fl">Lot Sawanbondin</label>
          <input class="fi" id="${pg}-lotsw" type="date">
        </div>
      </div>`;
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
      <select class="fi" id="${pg}-loc-select" style="padding:7px 9px" onchange="syncLocFromSelect('${pg}')">
        <option value="">-- เลือกพิกัด --</option>
        ${binOpts}
      </select>
      <input type="hidden" id="${pg}-loc">
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

  // Lot ต้นทาง
  h += `<div class="form-grid">
    <div class="fg form-full">
      <label class="fl">Lot ต้นทาง <span class="req">*</span></label>
      <select class="fi" id="${pg}-tf-fromlot" onchange="onTransformLotChange('${pg}')">
        <option value="">-- เลือกรายการก่อน --</option>
      </select>
      <div class="fhint">เฉพาะ Lot ที่มียอดคงเหลือมากกว่า 0</div>
    </div>
  </div>`;

  // จำนวนที่นำไปแปรรูป + น้ำหนักหลังแปรรูป
  h += `<div class="form-grid">
    <div class="fg">
      <label class="fl">จำนวนที่นำไปแปรรูป <span class="req">*</span></label>
      <input class="fi" id="${pg}-tf-qtyout" type="number" min="0.01" step="0.01"
        placeholder="0.00" inputmode="decimal">
      <div class="fhint" id="${pg}-tf-avail"></div>
    </div>
    <div class="fg">
      <label class="fl">น้ำหนักหลังแปรรูป <span class="req">*</span></label>
      <input class="fi" id="${pg}-tf-qtyin" type="number" min="0.01" step="0.01"
        placeholder="0.00" inputmode="decimal">
      <div class="fhint">น้ำหนักจริงหลังอบ/แปรรูป (อาจไม่เท่าเดิม)</div>
    </div>
  </div><div class="divider"></div>`;

  // Lot ใหม่
  h += `<div class="form-grid">
    <div class="fg">
      <label class="fl">วันที่ Lot ใหม่ <span class="req">*</span></label>
      <input class="fi" id="${pg}-tf-newlot" type="date">
      <div class="fhint">ถ้าตรงกับ Lot เดิม จะรวมยอดเข้าด้วยกัน</div>
    </div>
    <div class="fg">
      <label class="fl">หมายเหตุ Lot ใหม่</label>
      <input class="fi" id="${pg}-tf-note" placeholder="เช่น อบเพิ่ม 40 องศา">
    </div>
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

  // bind live summary update
  ['${pg}-tf-qtyout','${pg}-tf-qtyin'.replace('${pg}',pg)].forEach(()=>{});
  [pg+'-tf-qtyout', pg+'-tf-qtyin'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', ()=>updateTransformSummary(pg));
  });
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
  const qtyIn  = parseFloat(document.getElementById(pg+'-tf-qtyin')?.value)||0;
  const box = document.getElementById(pg+'-tf-summary');
  if (!m || !opt?.value) { box.style.display='none'; return; }
  const newTotal = m.stock - qtyOut + qtyIn;
  box.style.display = '';
  box.innerHTML = `<i class="ti ti-calculator"></i> ยอดรวม "${m.name}": ${m.stock.toLocaleString()} − ${qtyOut.toLocaleString()} + ${qtyIn.toLocaleString()} = <strong>${newTotal.toLocaleString()}</strong>`;
}

async function submitTransform(pg) {
  const code   = document.getElementById(pg+'-tf-ival')?.value;
  const itemEl = document.getElementById(pg+'-tf-idisplay');
  const name   = itemEl?.value || '';
  const sel    = document.getElementById(pg+'-tf-fromlot');
  const fromLotId = sel?.value;
  const fromOpt   = sel?.options[sel.selectedIndex];
  const qtyOut = parseFloat(document.getElementById(pg+'-tf-qtyout')?.value);
  const qtyIn  = parseFloat(document.getElementById(pg+'-tf-qtyin')?.value);
  const newLotSW = document.getElementById(pg+'-tf-newlot')?.value;
  const note     = (document.getElementById(pg+'-tf-note')?.value||'').trim();
  const opName   = window._operatorName || '';
  const opDept   = window._operatorDept || '';

  if (!code) { showToast('กรุณาเลือกรายการ','err'); return; }
  if (!fromLotId) { showToast('กรุณาเลือก Lot ต้นทาง','err'); return; }
  if (!qtyOut || qtyOut<=0) { showToast('กรุณาระบุจำนวนที่นำไปแปรรูป','err'); return; }
  if (!qtyIn || qtyIn<=0) { showToast('กรุณาระบุน้ำหนักหลังแปรรูป','err'); return; }
  if (!newLotSW) { showToast('กรุณาระบุวันที่ Lot ใหม่','err'); return; }

  const avail = parseFloat(fromOpt?.dataset?.stock)||0;
  if (qtyOut > avail) { showToast(`Lot ต้นทางมีไม่พอ (มี ${avail.toLocaleString()} เหลือ)`,'err'); return; }

  const btn = document.getElementById(pg+'-tf-submit-btn');
  setLoading(pg+'-tf-submit-btn', true, 'กำลังบันทึก...');

  const fromLotSW = fromOpt?.dataset?.sw || '';
  const fromDateStr = fromLotSW ? new Date(fromLotSW).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
  const newDateStr  = new Date(newLotSW).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});

  const result = await dbTransformStockLot(code, parseInt(fromLotId), qtyOut, newLotSW, qtyIn, note);
  setLoading(pg+'-tf-submit-btn', false);
  if (!result.ok) return;

  // บันทึก transaction 2 รายการ — transform_out / transform_in
  const baseTx = { item_code:code, item_name:name, pg, operator_name:opName, department:opDept, via:'manual' };
  await dbInsertTransaction({
    ...baseTx, action_type:'transform_out', quantity:qtyOut,
    lot_sw:fromLotSW, note:`แปรรูปออก → Lot ${newDateStr}${note?' ('+note+')':''}`,
    old_stock:result.old_stock, new_stock:result.new_stock,
  });
  await dbInsertTransaction({
    ...baseTx, action_type:'transform_in', quantity:qtyIn,
    lot_sw:newLotSW, note:`แปรรูปเข้า ← Lot ${fromDateStr}${note?' — '+note:''}`,
    old_stock:result.old_stock, new_stock:result.new_stock,
  });

  showToast(`แปรรูปสำเร็จ — Lot ${fromDateStr} → Lot ${newDateStr}`);
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
    dept: document.querySelector('#'+pg+'-dept .sel')?.textContent?.trim()||'',
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
    return `<div class="lot-select-item${isExpired?' lot-expired':''}" onclick="pickLot(this,'${pg}','${l.lot_sw}')" data-lot="${l.lot_sw}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="lot-date">${sw}</span>
          ${sp?`<span style="font-size:10px;color:var(--ink3)">Sup: ${sp}</span>`:''}
          ${ex?`<span style="font-size:10px;color:${isExpired?'var(--red)':'var(--ink4)'}">หมดอายุ: ${ex}</span>`:''}
        </div>
      </div>
      <span class="lot-sel-stock">คงเหลือ ${l.stock}</span>
    </div>`;
  }).join('');
}
function pickLot(el,pg,lotSW){
  el.closest('.lot-select-wrap').querySelectorAll('.lot-select-item').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
  const sw=document.getElementById(pg+'-lotsw'); if(sw)sw.value=lotSW;
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
  // ข้อ 1: ดึง loc จาก select ก่อน ถ้าไม่มีค่อยดึงจาก free-text input
  const locSelectVal = (document.getElementById(pg+'-loc-select')?.value||'').trim();
  const locInputVal  = (document.getElementById(pg+'-loc')?.value||'').trim();
  const loc = locSelectVal || locInputVal;
  const action = txState[pg].action;
  const dept   = document.querySelector('#'+pg+'-dept .sel').textContent.trim();

  setLoading(pg+'-submit-btn', true);
  // ค้นหาด้วย pg + ชื่อ เพื่อให้ตรงคลัง (ไม่ข้ามคลัง)
  const mi   = masterDB.find(m=>m.name===itemName && m.pg===pg);
  const item = itemName;
  const code = mi ? mi.code : '-';

  let rpcResult = { ok: true, new_stock: mi?.stock };
  if (mi) {
    // ── RPC เดียวจัดการ items.stock + lots.stock พร้อมกัน ──
    if (action !== 'return_bad') {
      // หา lotId จาก lotDB cache ถ้าเป็นการเบิก/คืน
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
      // sync stock ใน memory จาก RPC result ก่อน upsert
      if (rpcResult.new_stock !== undefined) mi.stock = rpcResult.new_stock;
    }
    if (action==='receive' && loc) locationDB[code] = loc;
    // บันทึก spec ถ้าเป็นคลังอุปกรณ์และเป็นการรับเข้า
    if (action==='receive' && cfg?.hasSpec) {
      const spec=(document.getElementById(pg+'-spec')?.value||'').trim();
      if(spec) specDB[code]=spec;
    }
    await dbUpsertItem(mi);  // ตอนนี้ mi.stock เป็นค่าถูกต้องแล้ว
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
  const deptEl=document.querySelector('#'+pg+'-dept .sel');
  if(!name){showToast('กรุณาระบุชื่อผู้ทำรายการ','err');return;}
  if(!deptEl){showToast('กรุณาเลือกแผนก','err');return;}
  const dept=deptEl.textContent.trim();
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
              <button onclick="editBinLocation(${b.id},'${b.zone}','${b.row}','${b.level}','${(b.label||'').replace(/'/g,"\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--ink4);padding:0;font-size:12px;line-height:1" title="แก้ไข"><i class="ti ti-pencil"></i></button>
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
    <div id="new-spec-row" style="display:none;margin-bottom:9px">
      <div class="fg"><label class="fl">สเปกอุปกรณ์</label>
        <textarea class="fta" id="new-spec" rows="4" placeholder="รายละเอียดและคุณสมบัติของอุปกรณ์..."></textarea></div>
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
  const[pg]=val.split('|');
  const[,subcat]=val.split('|');
  const row=document.getElementById('new-subcat-row');
  if(row)row.style.display=subcat===''?'block':'none';
  const specRow=document.getElementById('new-spec-row');
  if(specRow)specRow.style.display=(pg&&WAREHOUSE_CONFIG[pg]?.hasSpec)?'block':'none';
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
  // บันทึก spec ถ้าเป็นคลังอุปกรณ์
  if(WAREHOUSE_CONFIG[pg]?.hasSpec){
    const spec=(document.getElementById('new-spec')?.value||'').trim();
    if(spec) specDB[code]=spec;
  }
  // บันทึกพิกัดชั้นวางถ้าเลือกไว้
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
  const m=masterDB.find(x=>x.code===code);
  if(m)await dbUpsertItem(m);
  closeModal('editSpecModal');
  renderMasterContent();
  showToast('บันทึกสเปกเรียบร้อย');
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
  // สร้าง dropdown จาก binLocations
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
  // update เฉพาะ note column โดยตรง ไม่ต้องผ่าน dbUpsertItem
  const { error } = await sb.from('items').update({ note: loc }).eq('code', code);
  if(error){ console.error('saveEditLoc:', error.message); showToast('บันทึกไม่สำเร็จ','err'); return; }
  closeModal('editLocModal');
  renderMasterContent();
  showToast('บันทึกพิกัดเรียบร้อย');
}
async function deleteMasterItem(code){ if(!canManageMaster()){showToast('ไม่มีสิทธิ์ลบรายการ','err');return;} if(!confirm('ลบรายการนี้? ข้อมูลจะหายถาวร'))return;masterDB=masterDB.filter(m=>m.code!==code);delete locationDB[code];await dbDeleteItem(code);checkAlerts();renderMasterContent(); }

/* ── ย้ายหมวดหมู่ (subcat) ── */
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
  const code  = document.getElementById('moveWhId').value;
  const newPg = document.getElementById('moveWhTarget').value;
  const m = masterDB.find(x => x.code === code);
  if (!m || !newPg) return;
  const { error } = await sb.from('items').update({ pg: newPg }).eq('code', code);
  if (error) { showToast('ย้ายไม่สำเร็จ', 'err'); return; }
  m.pg = newPg;
  closeModal('moveWhModal');
  renderMasterContent();
  showToast(`ย้าย "${m.name}" ไป ${WAREHOUSE_CONFIG[newPg]?.label || newPg} แล้ว`);
}

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
  if (!f) return;
  const isVisible = f.style.display !== 'none';
  f.style.display = isVisible ? 'none' : 'block';
  if (!isVisible) {
    ['bin-zone','bin-row','bin-level','bin-label'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    delete f.dataset.editId;
    const btn=f.querySelector('button.btn-primary');
    if(btn){btn.innerHTML='<i class="ti ti-check"></i> บันทึกพิกัด';btn.onclick=addBinLocation;}
  }
}
function editBinLocation(id, zone, row, level, label) {
  // เติมข้อมูลเดิมลงในฟอร์ม แล้วเปลี่ยนปุ่มเป็น "บันทึกการแก้ไข"
  document.getElementById('bin-zone').value  = zone;
  document.getElementById('bin-row').value   = row;
  document.getElementById('bin-level').value = level;
  document.getElementById('bin-label').value = label;
  document.getElementById('binAddForm').style.display = 'block';
  document.getElementById('binAddForm').dataset.editId = id;
  // เปลี่ยนปุ่มบันทึก
  const btn = document.querySelector('#binAddForm button.btn-primary');
  if (btn) { btn.innerHTML = '<i class="ti ti-check"></i> บันทึกการแก้ไข'; btn.onclick = saveBinLocation; }
}

async function saveBinLocation() {
  const id    = parseInt(document.getElementById('binAddForm').dataset.editId);
  const zone  = (document.getElementById('bin-zone')?.value||'').trim().toUpperCase();
  const row   = (document.getElementById('bin-row')?.value||'').trim().toUpperCase();
  const level = (document.getElementById('bin-level')?.value||'').trim();
  const label = (document.getElementById('bin-label')?.value||'').trim();
  if (!zone||!row||!level){ showToast('กรุณากรอก โซน แถว และชั้นให้ครบ','err'); return; }

  const { data, error } = await sb.from('bin_locations')
    .update({ zone, row, level, label })
    .eq('id', id)
    .select().single();
  if (error) { showToast('แก้ไขไม่สำเร็จ','err'); return; }

  // อัปเดต locationDB ของสินค้าที่ใช้พิกัดเดิม
  const oldBin = binLocations.find(b => b.id === id);
  if (oldBin) {
    const oldCode = oldBin.code;
    const newCode = data.code;
    if (oldCode !== newCode) {
      // อัปเดตสินค้าที่ใช้พิกัดเดิมให้ชี้ไปพิกัดใหม่
      Object.keys(locationDB).forEach(k => {
        if (locationDB[k] === oldCode) locationDB[k] = newCode;
      });
      await sb.from('items').update({ note: newCode }).eq('note', oldCode);
    }
  }

  // รีเซ็ตฟอร์ม
  binLocations = binLocations.map(b => b.id === id ? {...b, ...data} : b);
  showBinForm();
  renderMasterPage();
  showToast('แก้ไขพิกัดเรียบร้อย');
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
  const search  = (document.getElementById('masterSearch')?.value||'').toLowerCase();
  const content = document.getElementById('masterContent'); if(!content)return;

  // init pg filter
  if(!masterPgFilter) masterPgFilter = WAREHOUSE_PAGES[0] || 'finish';

  const cfg = WAREHOUSE_CONFIG[masterPgFilter] || {};

  // หมวดหมู่ย่อยของคลังที่เลือก
  const pgItems = masterDB.filter(m => m.pg === masterPgFilter);
  const subcats = [...new Set(pgItems.map(m => m.subcat||'ไม่มีหมวดหมู่'))].filter(Boolean).sort();
  if(!masterSubFilter || !subcats.includes(masterSubFilter)) masterSubFilter = subcats[0] || '';

  // รายการในหมวดย่อยนั้น
  const filtered = pgItems.filter(m => {
    const sub = m.subcat||'ไม่มีหมวดหมู่';
    if(sub !== masterSubFilter) return false;
    if(search && !m.name.toLowerCase().includes(search) && !m.code.toLowerCase().includes(search)) return false;
    return true;
  });

  // Warehouse tabs
  const whTabs = WAREHOUSE_PAGES.map(pg => {
    const c = WAREHOUSE_CONFIG[pg];
    const cnt = masterDB.filter(m=>m.pg===pg).length;
    return `<button onclick="masterPgFilter='${pg}';masterSubFilter='';renderMasterContent()"
      style="padding:6px 16px;border-radius:8px;border:0.5px solid var(--line);font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit;
      background:${masterPgFilter===pg?'var(--ink)':'var(--surface)'};
      color:${masterPgFilter===pg?'var(--surface)':'var(--ink3)'};
      border-color:${masterPgFilter===pg?'var(--ink)':'var(--line)'}">
      ${c?.label||pg}
      <span style="font-size:10px;opacity:.6;margin-left:4px">${cnt}</span>
    </button>`;
  }).join('');

  // Category cards
  const catCards = subcats.map(sub => {
    const subItems = pgItems.filter(m=>(m.subcat||'ไม่มีหมวดหมู่')===sub);
    const lowCnt = subItems.filter(m=>m.min>0&&m.stock<=m.min).length;
    const isActive = sub === masterSubFilter;
    return `<div onclick="masterSubFilter='${sub}';renderMasterContent()"
      style="background:var(--surface);border:0.5px solid ${isActive?'var(--ink)':'var(--line)'};border-radius:10px;padding:10px 12px;cursor:pointer;
      background:${isActive?'var(--s2)':'var(--surface)'}">
      <div style="font-size:11px;font-weight:500">${sub}</div>
      <div style="font-size:10px;color:var(--ink4);margin-top:2px">${subItems.length} รายการ</div>
      ${lowCnt?`<div style="font-size:10px;color:var(--red);margin-top:1px">${lowCnt} ต่ำกว่า Min</div>`:''}
    </div>`;
  }).join('');

  // Item rows
  const rows = filtered.map(m => itemRowHtml(m)).join('') ||
    `<div style="padding:32px;text-align:center;color:var(--ink4)"><i class="ti ti-search" style="font-size:24px;display:block;margin-bottom:8px;opacity:.3"></i>ไม่พบรายการ</div>`;

  content.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px" id="wh-tabs">${whTabs}</div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:12px">${catCards}</div>

    <div style="border:0.5px solid var(--line);border-radius:10px;overflow:hidden">
      <div style="padding:9px 14px;background:var(--s2);border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;font-weight:500">${masterSubFilter} · ${filtered.length} รายการ</span>
        ${canManageMaster()?`<button class="btn btn-sm" onclick="showAddForm()" style="font-size:11px">+ เพิ่มรายการ</button>`:''}
      </div>
      <div class="item-list">${rows}</div>
    </div>`;
}

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
    const zeroLots=allLots.filter(l=>l.stock<=0);
    const lotSubHtml=allLots.length
      ?[...activeLots,...zeroLots].map(l=>{
          const sw=l.lot_sw?new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):' ?';
          const sp=l.lot_supplier?new Date(l.lot_supplier).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
          const ex=l.expiry_date?new Date(l.expiry_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
          const isEmpty=l.stock<=0;
          const isExpired=l.expiry_date&&new Date(l.expiry_date)<new Date();
          const noteHtml=(m.pg==='raw'&&l.note)?`<span style="font-size:10px;color:var(--ink3);margin-left:8px">${l.note}</span>`:'';
          return`<div class="lot-sub-row" style="${isEmpty?'opacity:.45':''}${isExpired?';background:#fdf2f2':''}">
            <span class="lot-date">${sw}${isEmpty?' <span style="font-size:9px;color:var(--red)">หมด</span>':''}</span>
            <span class="lot-stock-val">คงเหลือ ${l.stock}</span>
            ${noteHtml}
            ${sp?`<span style="font-size:10px;color:var(--ink3);margin-left:8px">Sup: ${sp}</span>`:''}
            ${ex?`<span style="font-size:10px;color:${isExpired?'var(--red)':'var(--ink4)'};margin-left:8px">${isExpired?'⚠️ หมดอายุ':'หมดอายุ'}: ${ex}</span>`:''}
          </div>`;
        }).join('')
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
            Lot <span style="font-size:10px;color:var(--ink4)">(${allLots.length})</span>
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
        ${WAREHOUSE_CONFIG[m.pg]?.hasSpec ? `<button class="icon-btn" onclick="editSpec('${m.code}')" title="แก้ไขสเปก"><i class="ti ti-file-description"></i></button>` : ''}
        <button class="icon-btn danger" onclick="deleteMasterItem('${m.code}')" title="ลบ"><i class="ti ti-trash"></i></button>
        ` : ''}
      </div>
    </div>`;
  }

function renderSection(items,label){
  const filtered=items.filter(m=>{
    const search=(document.getElementById('masterSearch')?.value||'').toLowerCase();
    if(search&&!m.name.toLowerCase().includes(search)&&!m.code.toLowerCase().includes(search))return false;
    return true;
  });
  if(!filtered.length)return'';
  return`<div class="master-section">
    <div class="master-section-header"><div class="master-section-title">${label} <span class="mcount">${filtered.length}</span></div></div>
    <div class="item-list">${filtered.map(itemRowHtml).join('')}</div>
  </div>`;
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
   STOCK COUNT MODULE — ตรวจนับสต็อก Tea House
═══════════════════════════════════════════ */

let scPg     = 'finish';
let scSearch = '';
let scData   = {};   // { code: actualStock }
let scStatus = {};   // { code: 'pending'|'preparing'|'ready' }

const SC_STATUS_OPTS = {
  pending:    { label: 'ยังไม่ได้ดำเนินการ', color: 'var(--ink4)' },
  preparing:  { label: 'กำลังจัดเตรียม',     color: '#e8a23a' },
  ready:      { label: 'จัดเตรียมเรียบร้อย', color: 'var(--green)' },
};

// กลุ่มคลัง Tea House
const SC_GROUPS = {
  finish:   'สินค้าสำเร็จรูป',
  raw:      'วัตถุดิบ',
  equip_th: 'อุปกรณ์',
};

async function dbSaveStockCount(rows) {
  const { error } = await sb.from('stock_counts').insert(rows);
  if (error) { console.error('dbSaveStockCount:', error); return false; }
  return true;
}

async function renderStockCountPage() {
  const div = document.getElementById('page-stockcount');
  if (!div) return;

  const today = new Date().toLocaleDateString('th-TH',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});

  // โหลด lot ถ้าจำเป็น
  const allItems = masterDB.filter(m => SC_GROUPS[m.pg]);
  const lotsNeeded = allItems.filter(m => WAREHOUSE_CONFIG[m.pg]?.hasLot);
  if (lotsNeeded.length) {
    const codes = lotsNeeded.map(m=>m.code);
    const { data } = await sb.from('lots').select('*').in('item_code', codes).order('lot_sw',{ascending:true});
    if (data) data.forEach(r => {
      if (!lotDB[r.item_code]) lotDB[r.item_code] = [];
      if (!lotDB[r.item_code].find(l=>l.id===r.id))
        lotDB[r.item_code].push({ id:r.id, lot_sw:r.lot_sw, stock:parseFloat(r.stock)||0 });
    });
  }

  // สถิติ
  const counted   = allItems.filter(m => scData[m.code] !== undefined).length;
  const diffItems = allItems.filter(m => scData[m.code] !== undefined && scData[m.code] !== m.stock);

  // copy text สินค้า
  const copyFinish = () => {
    const items = masterDB.filter(m=>m.pg==='finish');
    const lines = ['ตรวจนับสินค้าสำเร็จรูป '+today,''];
    const byLoc = {};
    items.forEach(m=>{ const loc=locationDB[m.code]||'ยังไม่ระบุ'; if(!byLoc[loc])byLoc[loc]=[]; byLoc[loc].push(m); });
    Object.entries(byLoc).forEach(([loc,ms])=>{
      lines.push('── '+loc+' ──');
      ms.forEach((m,i)=>lines.push((i+1)+'. '+m.name+' (ระบบ: '+m.stock+') จริง: ___'));
      lines.push('');
    });
    navigator.clipboard.writeText(lines.join('\n')).then(()=>showToast('คัดลอกรายการสินค้าแล้ว'));
  };

  // copy text อุปกรณ์
  const copyEquip = () => {
    const items = masterDB.filter(m=>m.pg==='equip_th');
    const lines = ['ตรวจนับอุปกรณ์ '+today,''];
    const byLoc = {};
    items.forEach(m=>{ const loc=locationDB[m.code]||'ยังไม่ระบุ'; if(!byLoc[loc])byLoc[loc]=[]; byLoc[loc].push(m); });
    Object.entries(byLoc).forEach(([loc,ms])=>{
      lines.push('── '+loc+' ──');
      ms.forEach((m,i)=>lines.push((i+1)+'. '+m.name+' (ระบบ: '+m.stock+') จริง: ___'));
      lines.push('');
    });
    navigator.clipboard.writeText(lines.join('\n')).then(()=>showToast('คัดลอกรายการอุปกรณ์แล้ว'));
  };

  // สร้าง group ตามพิกัด แยกตามคลัง
  function buildLocGroups(pg) {
    const items = masterDB.filter(m => m.pg === pg && (!scSearch || m.name.toLowerCase().includes(scSearch.toLowerCase())));
    if (!items.length) return '';

    const byLoc = {};
    items.forEach(m => {
      const loc = locationDB[m.code] || 'ยังไม่ระบุพิกัด';
      if (!byLoc[loc]) byLoc[loc] = [];
      byLoc[loc].push(m);
    });

    return Object.entries(byLoc).map(([loc, locItems]) => {
      const rows = locItems.map(m => {
        const actual = scData[m.code];
        const hasVal = actual !== undefined;
        const isLow  = hasVal && actual < m.stock;
        const isOk   = hasVal && actual >= m.stock;
        const inputCls = !hasVal ? '' : isLow ? 'border:0.5px solid #b03030;background:#fdf0f0' : 'border:0.5px solid #2d6a4f;background:#edf5f0';
        return `<div style="display:grid;grid-template-columns:1fr 64px 64px;padding:9px 14px;border-bottom:0.5px solid var(--line);align-items:center;gap:8px">
          <div>
            <div style="font-size:12px;font-weight:500">${m.name}</div>
            <div style="font-size:10px;color:var(--ink4)">${m.code}</div>
          </div>
          <div style="text-align:right;font-size:12px;font-weight:500;color:var(--ink4)">${m.stock.toLocaleString()}</div>
          <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="—"
            value="${hasVal?actual:''}"
            style="padding:4px 8px;border-radius:6px;font-size:12px;text-align:right;width:100%;${inputCls||'border:0.5px solid var(--line);background:var(--surface)'};outline:none;font-family:inherit"
            onchange="scSetVal('${m.code}',this.value);const v=parseFloat(this.value);if(!isNaN(v)){this.style.border=v<${m.stock}?'0.5px solid #b03030':'0.5px solid #2d6a4f';this.style.background=v<${m.stock}?'#fdf0f0':'#edf5f0';}else{this.style.border='0.5px solid var(--line)';this.style.background='var(--surface)'}">
        </div>`;
      }).join('');

      const locCounted = locItems.filter(m=>scData[m.code]!==undefined).length;
      const locDone = locCounted === locItems.length;

      return `<div style="margin-bottom:12px;border:0.5px solid var(--line);border-radius:10px;overflow:hidden">
        <div style="padding:8px 14px;background:var(--s2);border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between;cursor:pointer"
          onclick="const rows=this.nextElementSibling.querySelectorAll(':scope>div,table');const tbl=this.parentElement.querySelector('.sc-rows');if(tbl){tbl.style.display=tbl.style.display==='none'?'':'none';}">
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500">
            <i class="ti ti-map-pin" style="font-size:13px;color:var(--ink4)"></i>
            ${loc}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:var(--ink4)">${locCounted}/${locItems.length}</span>
            ${locDone?'<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:#edf5f0;color:#2d6a4f;border:0.5px solid #2d6a4f">ครบแล้ว</span>':''}
          </div>
        </div>
        <div>
          <div style="display:grid;grid-template-columns:1fr 64px 64px;padding:5px 14px;font-size:10px;color:var(--ink4);border-bottom:0.5px solid var(--line);background:var(--s2)">
            <span>รายการ</span><span style="text-align:right">ระบบ</span><span style="text-align:right">จริง</span>
          </div>
          ${rows}
        </div>
      </div>`;
    }).join('');
  }

  const sectionFinish = buildLocGroups('finish');
  const sectionEquip  = buildLocGroups('equip_th');
  const sectionStore2 = buildLocGroups('store2');

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ตรวจนับสต็อก</div>
        <div class="page-sub">${today}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm" id="sc-copy-finish" style="font-size:11px">
          <i class="ti ti-copy"></i> คัดลอกสินค้า
        </button>
        <button class="btn btn-sm" id="sc-copy-equip" style="font-size:11px">
          <i class="ti ti-copy"></i> คัดลอกอุปกรณ์
        </button>
        <button class="btn btn-sm" onclick="renderScHistoryPage()" style="font-size:11px">
          <i class="ti ti-history"></i> ประวัติ
        </button>
        <button class="btn btn-sm" onclick="scData={};renderStockCountPage()" style="font-size:11px">
          <i class="ti ti-eraser"></i> ล้าง
        </button>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:18px;font-weight:600">${allItems.length}</div>
        <div style="font-size:10px;color:var(--ink4)">ทั้งหมด</div>
      </div>
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:18px;font-weight:600;color:var(--acc)">${counted}</div>
        <div style="font-size:10px;color:var(--ink4)">นับแล้ว</div>
      </div>
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:18px;font-weight:600;color:${diffItems.length?'var(--red)':'var(--ink)'}">${diffItems.length}</div>
        <div style="font-size:10px;color:var(--ink4)">ยอดต่าง</div>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <input class="fi" placeholder="ค้นหารายการ..." value="${scSearch}"
        oninput="scSearch=this.value;renderStockCountPage()" style="max-width:280px">
    </div>
    ${sectionFinish?`<div style="font-size:11px;font-weight:500;color:var(--ink4);margin:0 0 6px;text-transform:uppercase;letter-spacing:.3px">สินค้าสำเร็จรูป</div>${sectionFinish}`:''}
    ${sectionStore2?`<div style="font-size:11px;font-weight:500;color:var(--ink4);margin:12px 0 6px;text-transform:uppercase;letter-spacing:.3px">Store 2</div>${sectionStore2}`:''}
    ${sectionEquip?`<div style="font-size:11px;font-weight:500;color:var(--ink4);margin:12px 0 6px;text-transform:uppercase;letter-spacing:.3px">อุปกรณ์ Tea House</div>${sectionEquip}`:''}
    <div style="margin-top:16px;padding-top:12px;border-top:0.5px solid var(--line);display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="scData={};renderStockCountPage()">ล้างทั้งหมด</button>
      <button class="btn btn-primary" onclick="scSaveAll()">
        <i class="ti ti-check"></i> ยืนยันปรับยอดทั้งหมด (${counted})
      </button>
    </div>`;

  document.getElementById('sc-copy-finish')?.addEventListener('click', copyFinish);
  document.getElementById('sc-copy-equip')?.addEventListener('click', copyEquip);
}


async function scSaveAll() {
  const allItems = masterDB.filter(m => SC_GROUPS[m.pg]);
  const toUpdate = allItems.filter(m => scData[m.code] !== undefined);
  if (!toUpdate.length) { showToast('กรุณากรอกยอดจริงก่อน','err'); return; }

  const diffCount = toUpdate.filter(m => scData[m.code] !== m.stock).length;
  if (!confirm(`ยืนยันปรับยอด stock ${toUpdate.length} รายการ (${diffCount} รายการที่ต่างจากระบบ)?`)) return;

  const btn = document.querySelector('#page-stockcount .btn-primary');
  if (btn) { btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> กำลังบันทึก...'; }

  const logRows = [];
  let ok = 0;

  for (const m of toUpdate) {
    const actual = scData[m.code];
    const diff   = actual - m.stock;

    // บันทึก log ทุกรายการที่กรอก (ไม่ว่าจะต่างหรือไม่)
    logRows.push({
      pg: m.pg, item_code: m.code, item_name: m.name,
      system_stock: m.stock, actual_stock: actual,
      counted_by: window._operatorName || '',
    });

    if (diff === 0) { ok++; continue; }

    const { error } = await sb.from('items').update({ stock: actual }).eq('code', m.code);
    if (error) { console.error('scSaveAll:', error.message); continue; }

    await dbInsertTransaction({
      item_code: m.code, item_name: m.name, pg: m.pg,
      action_type: diff > 0 ? 'receive' : 'withdraw',
      quantity: Math.abs(diff),
      operator_name: window._operatorName || '',
      note: `ตรวจนับสิ้นวัน: ระบบ ${m.stock} → จริง ${actual}`,
      via: 'stockcount'
    });

    m.stock = actual;
    ok++;
  }

  // บันทึก log ทั้งหมดพร้อมกัน
  if (logRows.length) {
    await sb.from('stock_count_logs').insert(logRows);
  }

  showToast(`ปรับยอด stock เรียบร้อย ${ok} รายการ`);
  scData = {};
  renderStockCountPage();
}

async function renderScHistoryPage() {
  const div = document.getElementById('page-stockcount');
  if (!div) return;

  div.innerHTML = `<div style="padding:24px;text-align:center;color:var(--ink4)"><i class="ti ti-loader" style="font-size:24px"></i></div>`;

  const { data } = await sb.from('stock_count_logs')
    .select('*')
    .order('counted_at', { ascending: false })
    .limit(200);

  if (!data || !data.length) {
    div.innerHTML = `<div class="page-header">
      <div><div class="page-title">ประวัติการตรวจนับ</div></div>
      <button class="btn btn-sm" onclick="renderStockCountPage()"><i class="ti ti-arrow-left"></i> กลับ</button>
    </div>
    <div style="padding:40px;text-align:center;color:var(--ink4)"><i class="ti ti-history" style="font-size:32px;display:block;margin-bottom:8px;opacity:.3"></i>ยังไม่มีประวัติ</div>`;
    return;
  }

  // จัดกลุ่มตามวันที่
  const byDate = {};
  data.forEach(r => {
    const d = new Date(r.counted_at).toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric'});
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  const sections = Object.entries(byDate).map(([date, rows]) => {
    const diffCount = rows.filter(r => r.diff !== 0).length;
    const countedBy = [...new Set(rows.map(r=>r.counted_by).filter(Boolean))].join(', ') || '—';

    const tableRows = rows.map(r => {
      const diff = r.diff || 0;
      const diffColor = diff > 0 ? '#2d6a4f' : diff < 0 ? '#b03030' : 'var(--ink4)';
      const diffTxt = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '0';
      const time = new Date(r.counted_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
      return `<tr>
        <td style="padding:7px 12px;font-size:12px;font-weight:500">${r.item_name}</td>
        <td style="padding:7px 12px;font-size:10px;color:var(--ink4)">${r.pg}</td>
        <td style="padding:7px 12px;text-align:right;font-size:12px">${r.system_stock}</td>
        <td style="padding:7px 12px;text-align:right;font-size:12px;font-weight:500">${r.actual_stock}</td>
        <td style="padding:7px 12px;text-align:right;font-size:12px;font-weight:600;color:${diffColor}">${diffTxt}</td>
        <td style="padding:7px 12px;font-size:10px;color:var(--ink4)">${time}</td>
      </tr>`;
    }).join('');

    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--s2);border:0.5px solid var(--line);border-radius:8px;margin-bottom:6px">
        <div>
          <div style="font-size:12px;font-weight:500">${date}</div>
          <div style="font-size:10px;color:var(--ink4);margin-top:2px">นับโดย ${countedBy} · ${rows.length} รายการ · ต่างจากระบบ ${diffCount} รายการ</div>
        </div>
      </div>
      <div class="sc-table-wrap">
        <table class="sc-table">
          <thead><tr>
            <th>รายการ</th>
            <th>คลัง</th>
            <th style="text-align:right">ยอดระบบ</th>
            <th style="text-align:right">ยอดจริง</th>
            <th style="text-align:right">ต่าง</th>
            <th>เวลา</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ประวัติการตรวจนับ</div>
        <div class="page-sub">${data.length} รายการล่าสุด</div></div>
      <button class="btn btn-sm" onclick="renderStockCountPage()">
        <i class="ti ti-arrow-left"></i> กลับ
      </button>
    </div>
    ${sections}`;
}

function scSetVal(code, val) {
  const v = val === '' ? undefined : parseFloat(val);
  if (v === undefined) delete scData[code];
  else scData[code] = v;
}

function scSetStatus(code, status) {
  scStatus[code] = status;
  // บันทึกสถานะลง DB ทันที
  sb.from('items').update({ count_status: status }).eq('code', code);
}

async function scReceive(code) {
  const m = masterDB.find(x => x.code === code);
  const actual = scData[code];
  if (!m || actual === undefined) { showToast('กรุณากรอกยอดจริงก่อน', 'err'); return; }
  const diff = actual - m.stock;
  if (diff === 0) { showToast('ยอดตรงกันอยู่แล้ว ไม่ต้องปรับ'); return; }
  if (!confirm(`ปรับ stock "${m.name}" จาก ${m.stock} → ${actual} (${diff>0?'+':''}${diff}) ยืนยันไหม?`)) return;

  // ปรับ stock ตรงๆ
  const { error } = await sb.from('items').update({ stock: actual }).eq('code', code);
  if (error) { showToast('ปรับ stock ไม่สำเร็จ', 'err'); return; }

  // บันทึก transaction
  await dbInsertTransaction({
    item_code: code, item_name: m.name, pg: m.pg,
    action_type: diff > 0 ? 'receive' : 'withdraw',
    quantity: Math.abs(diff),
    operator_name: window._operatorName || '',
    note: `ปรับจากตรวจนับ: ระบบ ${m.stock} → จริง ${actual}`,
    via: 'manual'
  });

  m.stock = actual;
  scStatus[code] = 'ready';
  delete scData[code];
  showToast(`ปรับ stock "${m.name}" เป็น ${actual} แล้ว`);
  renderStockCountPage();
}

async function scSave() {
  const items = masterDB.filter(m => m.pg === scPg);
  const rows  = [];
  items.forEach(m => {
    if (scData[m.code] === undefined) return;
    rows.push({
      item_code: m.code, item_name: m.name, pg: m.pg,
      system_stock: m.stock, actual_stock: scData[m.code],
      status: scStatus[m.code] || 'pending',
      note: '', counted_by: window._operatorName || '',
    });
  });
  if (!rows.length) { showToast('กรุณากรอกยอดจริงก่อน', 'err'); return; }
  const ok = await dbSaveStockCount(rows);
  if (ok) {
    showToast(`บันทึกผลตรวจนับ ${rows.length} รายการ`);
    scData = {};
    renderStockCountPage();
  }
}

function scSetNote(code, val) { scData[code+'_note'] = val; }

function scSwitchPg(pg) { scPg = pg; scData = {}; scStatus = {}; renderStockCountPage(); }

function scClearAll() {
  scData = {}; scStatus = {}; renderStockCountPage();
}

function scExportCSV() {
  const cfg   = WAREHOUSE_CONFIG[scPg];
  const items = masterDB.filter(m => m.pg === scPg);
  const date  = new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
  const rows  = [['รายการ','พิกัด','ยอดระบบ','ยอดจริง','ผลต่าง','สถานะ']];
  items.forEach(m => {
    const actual = scData[m.code];
    const diff   = actual !== undefined ? actual - m.stock : '';
    const status = scStatus[m.code] ? SC_STATUS_OPTS[scStatus[m.code]]?.label : 'ยังไม่ได้ดำเนินการ';
    rows.push([m.name, locationDB[m.code]||'—', m.stock, actual??'', diff, status]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `ตรวจนับ_${cfg?.label||scPg}_${date.replace(/\//g,'-')}.csv`;
  a.click();
}

/* ── Override switchPage ── */
const _scOrigSwitch = switchPage;
switchPage = async function(p) {
  const alertGroupPages = ALERT_GROUPS ? Object.keys(ALERT_GROUPS).map(g=>'alert-'+g) : [];
  const allPages = [...WAREHOUSE_PAGES, 'master', 'stockcount', 'dashboard', 'daily-withdraw', 'daily-stockcount', 'booth-borrow', ...alertGroupPages];

  // ถ้า page ไม่มีใน allPages ให้ไปหน้าแรก
  if (!allPages.includes(p)) p = WAREHOUSE_PAGES[0] || 'master';

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${p}"]`)?.classList.add('active');
  allPages.forEach(pg => {
    const el = document.getElementById('page-' + pg);
    if (el) el.className = pg === p ? 'page-visible' : 'page-hidden';
  });
  curPage = p;

  if (p === 'stockcount') {
    await renderStockCountPage();
  } else if (p === 'daily-withdraw') {
    await renderDailyWithdrawPage();
  } else if (p === 'daily-stockcount') {
    await renderDailyStockcountPage();
  } else if (p === 'booth-borrow') {
    await renderBoothBorrowPage();
  } else if (p.startsWith('alert-')) {
    renderAlertGroupPage(p.replace('alert-',''));
  } else {
    _scOrigSwitch(p);
  }
};

/* ═══════════════════════════════════════════
   DAILY WITHDRAW MODULE — เบิกประจำวัน
═══════════════════════════════════════════ */

let dwItems = [];
let dwTab = 'finish';

const DW_STATUS = {
  pending:    { label:'รอดำเนินการ',  color:'var(--ink4)' },
  preparing:  { label:'กำลังเตรียม', color:'#7a5900' },
  ready:      { label:'จัดเตรียมแล้ว', color:'#013c58' },
};

const DW_GROUPS = {
  finish: { label:'สินค้าสำเร็จรูป', pgs:['finish'] },
  store2: { label:'Store 2',         pgs:['store2'] },
};

async function dbLoadDailyWithdrawals() {
  const { data } = await sb.from('daily_withdrawals')
    .select('*')
    .neq('status', 'received')
    .order('pg').order('item_name');
  dwItems = data || [];
}

async function dbGenerateDailyList() {
  const today = new Date().toISOString().split('T')[0];

  // ดึงรายการค้างทั้งหมดที่ยังไม่ received (ทุกวัน)
  const { data: carried } = await sb.from('daily_withdrawals')
    .select('*').neq('status','received');
  const carriedByCode = {};
  (carried||[]).forEach(x => {
    if (!carriedByCode[x.item_code]) carriedByCode[x.item_code] = [];
    carriedByCode[x.item_code].push(x);
  });

  // ดึงรายการที่ stock < min จาก masterDB
  const pgs = ['finish', 'store2'];
  const needWithdraw = masterDB.filter(m =>
    pgs.includes(m.pg) && m.is_active !== false && m.min > 0 && m.stock < m.min
  );

  for (const m of needWithdraw) {
    const existing = carriedByCode[m.code] || [];
    const newQty = Math.max(0, (m.max||0) - m.stock);

    if (existing.length === 0) {
      // ไม่มีรายการเลย สร้างใหม่
      await sb.from('daily_withdrawals').insert({
        date: today, item_code: m.code, item_name: m.name, pg: m.pg,
        current_stock: m.stock, max_stock: m.max||0,
        suggested_qty: newQty, status: 'pending',
      });
    } else {
      // มีรายการค้างอยู่แล้ว — รวมยอดเข้ากับรายการล่าสุด
      const latest = existing.sort((a,b) => new Date(b.created_at)-new Date(a.created_at))[0];
      const currentSuggested = latest.suggested_qty || 0;
      const mergedQty = currentSuggested + newQty;

      if (latest.date !== today) {
        // ค้างจากวันก่อน → อัปเดตวันที่และยอดรวม
        await sb.from('daily_withdrawals').update({
          date: today,
          current_stock: m.stock,
          suggested_qty: mergedQty,
          updated_at: new Date().toISOString(),
        }).eq('id', latest.id);

        // ลบรายการค้างอื่นๆ ถ้ามีหลายรายการ
        if (existing.length > 1) {
          const oldIds = existing.filter(x=>x.id!==latest.id).map(x=>x.id);
          await sb.from('daily_withdrawals').delete().in('id', oldIds);
        }
      }
      // ถ้าเป็นวันนี้อยู่แล้ว ไม่ต้องทำอะไร
    }
  }

  await dbLoadDailyWithdrawals();
}

async function dwSetStatus(id, status) {
  await sb.from('daily_withdrawals').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  const item = dwItems.find(x => x.id === id);
  if (item) item.status = status;
}

async function dwSetNote(id, note) {
  await sb.from('daily_withdrawals').update({ note, updated_at: new Date().toISOString() }).eq('id', id);
  const item = dwItems.find(x => x.id === id);
  if (item) item.note = note;
}

async function dwSetPreparerNote(id, note) {
  await sb.from('daily_withdrawals').update({ preparer_note: note||null, updated_at: new Date().toISOString() }).eq('id', id);
  const item = dwItems.find(x=>x.id===id);
  if (item) item.preparer_note = note;
}

async function dwSetSuggestedQty(id, val) {
  const qty = val === '' ? null : parseFloat(val);
  await sb.from('daily_withdrawals').update({ suggested_qty: qty }).eq('id', id);
  const item = dwItems.find(x => x.id === id);
  if (item) item.suggested_qty = qty;
}

async function dwSetPreparedQty(id, val) {
  const qty = val === '' ? null : parseFloat(val);
  await sb.from('daily_withdrawals').update({ prepared_qty: qty, updated_at: new Date().toISOString() }).eq('id', id);
  const item = dwItems.find(x => x.id === id);
  if (item) item.prepared_qty = qty;
}

async function dwDeleteItem(id) {
  await sb.from('daily_withdrawals').delete().eq('id', id);
  dwItems = dwItems.filter(x => x.id !== id);
  renderDailyWithdrawPage();
}

async function dwReceive(id) {
  const item = dwItems.find(x => x.id === id);
  if (!item) return;
  const recvQty = item._recvQty !== undefined ? item._recvQty : (item.suggested_qty||0);
  if (!recvQty) { showToast('กรุณากรอกจำนวนรับเข้าก่อนค่ะ','err'); return; }

  // finish → ต้องเลือก Lot ก่อน
  if (item.pg === 'finish') {
    const lotId = item._lotId;
    const lotSw = item._lotSw;
    if (!lotId) { showToast('กรุณาเลือก Lot ก่อนกดรับเข้าค่ะ','err'); return; }
    await dwDoReceive(id, item, recvQty, lotId, lotSw);
    return;
  }

  // store2 → บวก Tea House อย่างเดียว
  await dwDoReceive(id, item, recvQty, null, null);
}

// cache lots จาก Factory แยกตาม item_code
let dwFactoryLots = {}; // { item_code: [{id, lot_sw, stock, ...}] }

async function dwLoadFactoryLots(itemCodes) {
  if (!itemCodes.length) return;
  // ดึงชื่อสินค้าจาก Tea House masterDB
  const names = itemCodes.map(code => {
    const m = masterDB.find(x=>x.code===code);
    return m?.name || null;
  }).filter(Boolean);
  if (!names.length) return;

  // ดึง factory items ที่ชื่อตรงกัน
  const { data: fItems } = await sbFactory.from('items')
    .select('code, name')
    .eq('pg', 'finish')
    .in('name', names);
  if (!fItems?.length) return;

  const fCodes = fItems.map(x=>x.code);
  const { data: lots } = await sbFactory.from('lots')
    .select('id, item_code, lot_sw, lot_supplier, stock, weight_kg, bag_number, bag_total')
    .in('item_code', fCodes)
    .gt('stock', 0)
    .order('lot_sw', { ascending: true });

  // map กลับโดยใช้ชื่อ — dwFactoryLots[th_item_code] = [lots...]
  dwFactoryLots = {};
  (lots||[]).forEach(lot => {
    const fItem = fItems.find(x=>x.code===lot.item_code);
    if (!fItem) return;
    // หา TH item_code จากชื่อ
    const thItem = masterDB.find(x=>x.pg==='finish' && x.name===fItem.name);
    if (!thItem) return;
    if (!dwFactoryLots[thItem.code]) dwFactoryLots[thItem.code] = [];
    dwFactoryLots[thItem.code].push({ ...lot, factory_code: fItem.code });
  });
}

function dwSetLot(itemId, lotId, lotSw) {
  const item = dwItems.find(x=>x.id===itemId);
  if (item) { item._lotId = parseInt(lotId)||null; item._lotSw = lotSw||null; }
}

async function dwShowLotPicker(id, item, recvQty) {
  document.getElementById('dw-lot-modal')?.remove();

  // ดึง lots จาก Factory ที่ตรง item_code และมี stock > 0
  const { data: lots } = await sbFactory.from('lots')
    .select('id, lot_sw, lot_supplier, stock, weight_kg, bag_number, bag_total')
    .eq('item_code', item.item_code)
    .gt('stock', 0)
    .order('lot_sw', { ascending: true });

  const modal = document.createElement('div');
  modal.className = 'modal-wrap show';
  modal.id = 'dw-lot-modal';

  const lotRows = lots?.length ? lots.map(lot => {
    const bagInfo = lot.bag_number ? ` · ถุง ${lot.bag_number}/${lot.bag_total}` : '';
    const weightInfo = lot.weight_kg ? ` · ${lot.weight_kg} กก.` : '';
    return `<div onclick="dwSelectLot(${lot.id},'${lot.lot_sw}',${lot.stock},this)"
      style="padding:10px 14px;cursor:pointer;border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between"
      onmouseover="this.style.background='var(--s2)'" onmouseout="if(!this.classList.contains('sel'))this.style.background=''">
      <div>
        <div style="font-size:12px;font-weight:500">Lot ${lot.lot_sw}${bagInfo}</div>
        <div style="font-size:10px;color:var(--ink4)">${lot.lot_supplier||''}${weightInfo}</div>
      </div>
      <div style="text-align:right;font-size:13px;font-weight:500;color:var(--acc)">${lot.stock.toLocaleString()}</div>
    </div>`;
  }).join('') : `<div style="padding:20px;text-align:center;color:var(--ink4)">ไม่พบ Lot ใน Factory</div>`;

  modal.innerHTML = `<div class="modal" style="max-width:440px;width:95%">
    <div class="card-title" style="margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--line)">
      <div class="card-title-left">
        <div style="font-size:13px;font-weight:500">เลือก Lot จาก Factory</div>
        <div style="font-size:11px;color:var(--ink4);margin-top:2px">${item.item_name} · รับเข้า ${recvQty}</div>
      </div>
      <button class="btn btn-sm" onclick="document.getElementById('dw-lot-modal').remove()">ยกเลิก</button>
    </div>
    <div style="border:0.5px solid var(--line);border-radius:8px;overflow:hidden;max-height:280px;overflow-y:auto;margin-bottom:12px">
      <div style="display:grid;grid-template-columns:1fr auto;padding:5px 14px;font-size:10px;color:var(--ink4);background:var(--s2);border-bottom:0.5px solid var(--line)">
        <span>Lot / ซัพพลายเออร์</span><span>Stock Factory</span>
      </div>
      ${lotRows}
    </div>
    <div id="dw-lot-selected" style="display:none;background:var(--s2);border:0.5px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:10px">
      <div style="font-size:11px;color:var(--ink4)">Lot ที่เลือก</div>
      <div style="font-size:13px;font-weight:500" id="dw-lot-sel-label">—</div>
    </div>
    <input type="hidden" id="dw-lot-sel-id">
    <input type="hidden" id="dw-lot-sel-sw">
    <input type="hidden" id="dw-lot-sel-stock">
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:10px;border-top:0.5px solid var(--line)">
      <button class="btn btn-sm" onclick="document.getElementById('dw-lot-modal').remove()">ยกเลิก</button>
      <button class="btn btn-primary btn-sm" onclick="dwConfirmLotReceive(${id},${recvQty})">
        <i class="ti ti-check"></i> ยืนยันรับเข้า
      </button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function dwSelectLot(lotId, lotSw, lotStock, el) {
  document.querySelectorAll('#dw-lot-modal [onclick^="dwSelectLot"]').forEach(e => {
    e.style.background = '';
    e.classList.remove('sel');
  });
  el.style.background = 'var(--s2)';
  el.classList.add('sel');
  document.getElementById('dw-lot-sel-id').value = lotId;
  document.getElementById('dw-lot-sel-sw').value = lotSw;
  document.getElementById('dw-lot-sel-stock').value = lotStock;
  document.getElementById('dw-lot-sel-label').textContent = `Lot ${lotSw} (Stock ${lotStock.toLocaleString()})`;
  document.getElementById('dw-lot-selected').style.display = 'block';
}

async function dwConfirmLotReceive(id, recvQty) {
  const lotId    = parseInt(document.getElementById('dw-lot-sel-id')?.value);
  const lotSw    = document.getElementById('dw-lot-sel-sw')?.value;
  const lotStock = parseFloat(document.getElementById('dw-lot-sel-stock')?.value||'0');
  if (!lotId) { showToast('กรุณาเลือก Lot ก่อนค่ะ','err'); return; }
  if (recvQty > lotStock) {
    if (!confirm(`จำนวนรับ (${recvQty}) มากกว่า stock Lot นี้ (${lotStock}) ยืนยันต่อไหมคะ?`)) return;
  }
  document.getElementById('dw-lot-modal')?.remove();
  const item = dwItems.find(x=>x.id===id);
  if (!item) return;
  await dwDoReceive(id, item, recvQty, lotId, lotSw);
}

async function dwDoReceive(id, item, recvQty, lotId, lotSw) {
  if (item.pg === 'finish') {
    if (lotId) {
      // หัก stock Lot ใน Factory
      const { data: lot } = await sbFactory.from('lots').select('id,stock,item_code').eq('id', lotId).single();
      if (lot) {
        const newLotStock = Math.max(0, lot.stock - recvQty);
        await sbFactory.from('lots').update({ stock: newLotStock }).eq('id', lotId);
        // หัก item stock Factory ด้วย
        const { data: fItem } = await sbFactory.from('items').select('code,stock').eq('code', lot.item_code).single();
        if (fItem) await sbFactory.from('items').update({ stock: Math.max(0, fItem.stock - recvQty) }).eq('code', fItem.code);
      }
    }
    // บวก Tea House
    const m = masterDB.find(x=>x.code===item.item_code);
    if (m) { const ns = m.stock + recvQty; await sb.from('items').update({ stock: ns }).eq('code', item.item_code); m.stock = ns; }
  } else {
    // store2
    const m = masterDB.find(x=>x.code===item.item_code);
    if (m) { const ns = m.stock + recvQty; await sb.from('items').update({ stock: ns }).eq('code', item.item_code); m.stock = ns; }
  }

  await sb.from('daily_withdrawals').update({
    status: 'received', received_qty: recvQty,
    factory_withdraw_status: 'received',
    factory_lot_id: lotId || null,
    factory_lot_sw: lotSw || null,
    received_at: new Date().toISOString()
  }).eq('id', id);
  item.status = 'received'; item.received_qty = recvQty;
  await dbLoadDailyWithdrawals();
  renderDailyWithdrawPage();
}

async function dwReceiveAll() {
  const items = dwItems.filter(x=>x.status!=='received');
  for (const item of items) { if (!item._recvQty) item._recvQty = item.suggested_qty||0; await dwReceive(item.id); }
}

async function dwReceiveAllSection(pg) {
  const items = dwItems.filter(x=>x.pg===pg && x.status!=='received');
  if (!items.length) { showToast('ไม่มีรายการที่รอรับ','err'); return; }
  if (!confirm(`ยืนยันรับเข้า ${items.length} รายการ?`)) return;
  for (const item of items) { if (!item._recvQty) item._recvQty = item.suggested_qty||0; await dwReceive(item.id); }
}

async function dwConfirmAllSection(pg) { await dwReceiveAllSection(pg); }
function dwSetRecvQty(id, val) { const item=dwItems.find(x=>x.id===id); if(item) item._recvQty=parseFloat(val)||0; }

function dwFilterCat(btn, pg, cat) {
  document.querySelectorAll(`.dw-cat-${pg}`).forEach(b=>{ b.style.background='transparent'; b.style.color='var(--ink3)'; });
  btn.style.background='var(--ink)'; btn.style.color='var(--surface)';
  document.querySelectorAll(`.dw-row-${pg}`).forEach(row=>{
    row.style.display=(cat==='ทั้งหมด'||row.dataset.cat===cat)?'flex':'none';
  });
}

async function renderDailyWithdrawPage() {
  const div = document.getElementById('page-daily-withdraw');
  if (!div) return;
  div.innerHTML = `<div style="padding:24px;text-align:center;color:var(--ink4)"><i class="ti ti-loader" style="font-size:24px"></i></div>`;
  await dbGenerateDailyList();
  await dbLoadDailyWithdrawals();

  // โหลด lots จาก Factory สำหรับ finish items
  const finishCodes = dwItems.filter(x=>x.pg==='finish' && x.status!=='received').map(x=>x.item_code);
  if (finishCodes.length) await dwLoadFactoryLots(finishCodes);

  const today = new Date();
  const dateStr = today.toLocaleDateString('th-TH',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const todayStr = today.toISOString().split('T')[0];
  const received = dwItems.filter(x=>x.status==='received').length;
  const total    = dwItems.length;

  const statusConfig = {
    pending:  { label:'รอ Factory', color:'#7a5900', bg:'#fff8e8', border:'#c8960a' },
    cutting:  { label:'Factory กำลังตัดสต็อก', color:'#013c58', bg:'#e8f0f5', border:'#013c58' },
    shipping: { label:'กำลังจัดส่ง', color:'#2d4a0f', bg:'#edf5ec', border:'#4a6b1a' },
    received: { label:'รับเข้าแล้ว', color:'#2d4a0f', bg:'#edf5ec', border:'#4a6b1a' },
  };

  function buildSection(pg, label, icon) {
    const items = dwItems.filter(m=>m.pg===pg);
    if (!items.length) return `<div style="border:0.5px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:12px">
      <div style="padding:9px 16px;background:var(--s2);display:flex;align-items:center;gap:8px">
        <i class="ti ${icon}" style="font-size:13px;color:var(--ink4)"></i>
        <span style="font-size:12px;font-weight:500">${label}</span>
      </div>
      <div style="padding:20px;text-align:center;font-size:11px;color:var(--ink4)">ไม่มีรายการเบิก</div>
    </div>`;

    const secReceived = items.filter(x=>x.status==='received').length;
    const secPending  = items.filter(x=>x.status!=='received').length;
    // หมวดหมู่ตายตัวสำหรับ finish, ดึง dynamic สำหรับ store2
    const FINISH_CATS = ['สินค้า','ชาตกแต่ง','ชาใบแบบชง'];
    const subcatSet = pg==='finish'
      ? FINISH_CATS
      : [...new Set(items.map(i=>{const m=masterDB.find(x=>x.code===i.item_code);return m?.subcat||'อื่นๆ';}))].sort();
    const subcats = subcatSet.length > 0 ? subcatSet : [];

    const catTabsHtml = subcats.map((sub,idx)=>`
      <button onclick="dwFilterCat(this,'${pg}','${sub.replace(/'/g,"\'")}') " class="dw-cat-${pg}"
        style="padding:3px 12px;border-radius:12px;border:0.5px solid var(--line);font-size:10px;cursor:pointer;font-family:inherit;
        background:${idx===0?'var(--ink)':'transparent'};color:${idx===0?'var(--surface)':'var(--ink3)'}">
        ${sub}
      </button>`).join('');

    const defaultCat = subcats.length > 0 ? subcats[0] : '';

    const rows = items.map(item=>{
      const isDone = item.status==='received';
      const m = masterDB.find(x=>x.code===item.item_code);
      const subcat = m?.subcat||'อื่นๆ';
      const isCarried = item.date && item.date!==todayStr;
      const fwStatus = item.factory_withdraw_status||'pending';
      const sc = statusConfig[fwStatus]||statusConfig.pending;

      const initDisplay = subcats.length>0 ? (subcat===defaultCat?'flex':'none') : 'flex';
      if (isDone) if (isDone) return `<div class="dw-row-${pg}" data-cat="${subcat}"
        style="display:${initDisplay};align-items:center;gap:10px;padding:9px 16px;border-bottom:0.5px solid var(--line);opacity:.4">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500">${item.item_name}
            <span style="font-size:9px;color:#2d6a0f;margin-left:4px">✓ รับแล้ว ${item.received_qty||0}</span>
          </div>
          ${item.preparer_note?`<div style="font-size:10px;color:#013c58;background:#e8f0f5;padding:1px 6px;border-radius:4px;border-left:2px solid #013c58;margin-top:2px">หมายเหตุผู้เตรียม: ${item.preparer_note}</div>`:''}
        </div>
        <div style="font-size:11px;color:var(--ink4)">แนะนำ ${item.suggested_qty||0}</div>
        <div style="width:70px"></div><div style="width:56px"></div>
      </div>`;

      return `<div class="dw-row-${pg}" data-cat="${subcat}"
        style="display:${initDisplay};flex-direction:column;padding:10px 16px;border-bottom:0.5px solid var(--line);gap:6px" id="dwrow-${item.id}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;margin-bottom:${item.note?'3px':'0'}">${item.item_name}
              ${isCarried?`<span style="font-size:9px;color:var(--ink4);margin-left:4px">ค้างมา</span>`:''}
            </div>
            ${item.note?`<div style="font-size:10px;color:#7a5900;background:#fff8e8;padding:1px 6px;border-radius:4px;display:inline-block">${item.note}</div>`:''}
            ${pg==='finish' && fwStatus==='shipping'?`<div style="margin-top:3px"><span style="font-size:9px;padding:2px 7px;border-radius:8px;background:#edf5ec;color:#2d4a0f;border:0.5px solid #4a6b1a">กำลังจัดส่ง</span></div>`:''}
          ${pg==='finish'?(()=>{
            const lots = dwFactoryLots[item.item_code]||[];
            if(!lots.length) return `<div style="font-size:10px;color:var(--red);margin-top:3px">ไม่พบ Lot ใน Factory</div>`;
            const opts = lots.map(l=>{
              const bag = l.bag_number?` ถุง${l.bag_number}/${l.bag_total}`:'';
              const w = l.weight_kg?` ${l.weight_kg}กก.`:'';
              return `<option value="${l.id}" data-sw="${l.lot_sw}" ${item._lotId===l.id?'selected':''}>Lot ${l.lot_sw}${bag}${w} (${l.stock})</option>`;
            }).join('');
            return `<select onchange="dwSetLot(${item.id},this.value,this.options[this.selectedIndex].dataset.sw)"
              style="margin-top:4px;padding:4px 8px;border:0.5px solid var(--line);border-radius:6px;font-size:11px;background:var(--surface);color:var(--ink);font-family:inherit;width:100%">
              <option value="">— เลือก Lot —</option>
              ${opts}
            </select>`;
          })():''}
          </div>
          <div style="text-align:right;flex-shrink:0;min-width:44px">
            <div style="font-size:9px;color:var(--ink4)">แนะนำ</div>
            <div style="font-size:13px;font-weight:500">${item.suggested_qty||0}</div>
          </div>
          <input type="number" min="0" inputmode="decimal" placeholder="${item.suggested_qty||0}"
            style="width:68px;padding:5px 8px;border:0.5px solid var(--line);border-radius:7px;font-size:13px;text-align:right;background:var(--surface);outline:none;font-family:inherit"
            oninput="dwSetRecvQty(${item.id},this.value)"
            onfocus="if(!this.value)this.value='${item.suggested_qty||0}';this.select()"
            onkeydown="if(event.key==='Enter'){event.preventDefault();dwReceive(${item.id})}">
          <button onclick="dwReceive(${item.id})"
            style="padding:5px 10px;border-radius:7px;border:none;background:var(--ink);color:var(--surface);font-size:10px;cursor:pointer;font-family:inherit;white-space:nowrap">
            รับเข้า
          </button>
        </div>
        <input type="text" placeholder="หมายเหตุผู้เตรียม: เช่น รอผลิต / ของหมด..." value="${item.preparer_note||''}"
          style="width:100%;padding:4px 8px;border:0.5px solid ${item.preparer_note?'#013c58':'var(--line)'};border-radius:6px;font-size:10px;background:${item.preparer_note?'#e8f0f5':'var(--surface)'};color:var(--ink3);outline:none;font-family:inherit"
          onchange="dwSetPreparerNote(${item.id},this.value)">
      </div>`;
    }).join('');

    return `<div style="border:0.5px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:12px">
      <div style="padding:9px 16px;background:var(--s2);border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="ti ${icon}" style="font-size:13px;color:var(--ink4)"></i>
          <span style="font-size:12px;font-weight:500">${label}</span>
          <span style="font-size:10px;color:var(--ink4)">${items.length} รายการ${secReceived?` · รับแล้ว ${secReceived}`:''}</span>
        </div>
        <button onclick="dwCopySectionText('${pg}')"
          style="font-size:10px;padding:3px 10px;border-radius:6px;border:0.5px solid var(--line);background:transparent;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:4px">
          <i class="ti ti-copy" style="font-size:11px"></i> คัดลอก
        </button>
      </div>
      ${subcats.length?`<div style="display:flex;gap:6px;padding:8px 14px;border-bottom:0.5px solid var(--line);flex-wrap:wrap;background:var(--s2)">${catTabsHtml}</div>`:''}
      <div style="display:grid;grid-template-columns:1fr 48px 68px 56px;padding:5px 16px;font-size:10px;color:var(--ink4);border-bottom:0.5px solid var(--line);background:var(--s2)">
        <span>รายการ</span><span style="text-align:right">แนะนำ</span><span style="text-align:right">รับจริง</span><span></span>
      </div>
      <div>${rows}</div>
      ${secPending>0?`<div style="padding:8px 16px;border-top:0.5px solid var(--line);background:var(--s2);display:flex;justify-content:flex-end">
        <button onclick="dwConfirmAllSection('${pg}')"
          style="font-size:11px;padding:5px 14px;border-radius:8px;background:var(--ink);color:var(--surface);border:none;cursor:pointer;font-family:inherit">
          <i class="ti ti-check"></i> ยืนยันรับเข้าทั้งหมด → บวกสต็อก
        </button>
      </div>`:''}
    </div>`;
  }

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">เบิกประจำวัน</div>
        <div class="page-sub">${dateStr}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="renderDwHistoryPage()" style="font-size:11px">
          <i class="ti ti-history"></i> ประวัติ
        </button>
        <button class="btn btn-sm" onclick="dwOpenAddModal('')" style="font-size:11px">
          <i class="ti ti-plus"></i> เพิ่ม
        </button>
        <button class="btn btn-sm" onclick="(async()=>{await dbGenerateDailyList();await dbLoadDailyWithdrawals();renderDailyWithdrawPage();})()" style="font-size:11px">
          <i class="ti ti-refresh"></i>
        </button>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:20px;font-weight:500">${total}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:2px">ทั้งหมด</div>
      </div>
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:20px;font-weight:500;color:#2d6a0f">${received}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:2px">รับแล้ว</div>
      </div>
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:20px;font-weight:500">${total-received}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:2px">รอรับ</div>
      </div>
    </div>
    ${buildSection('finish','สินค้าสำเร็จรูป (จาก Factory)','ti-package')}
    ${buildSection('store2','Store 2','ti-building-store')}`;
}

function dwCopySectionText(pg) {
  const label = pg==='finish'?'สินค้าสำเร็จรูป':'Store 2';
  const items = dwItems.filter(x=>x.pg===pg && x.status!=='received');
  if (!items.length) { showToast(`ไม่มีรายการ${label}`,'err'); return; }
  const today = new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric'});
  const lines = [`รายการเบิก${label} — ${today}`, ''];
  items.forEach((item,i)=>{
    const isCarried = item.date && item.date!==new Date().toISOString().split('T')[0];
    lines.push(`${i+1}. ${item.item_name}${isCarried?' [ค้างมา]':''} — เบิก ${item.suggested_qty||0}`);
    if (item.note) lines.push(`   หมายเหตุ: ${item.note}`);
  });
  navigator.clipboard.writeText(lines.join('\n')).then(()=>showToast(`คัดลอก${label} ${items.length} รายการแล้วค่ะ`));
}


function dwCopySection(pg) {
  const label = pg === 'finish' ? 'สินค้าสำเร็จรูป' : 'Store 2';
  const items = dwItems.filter(x => x.pg === pg && x.status !== 'received');
  if (!items.length) { showToast(`ไม่มีรายการ${label}`,'err'); return; }
  const today = new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric'});
  const lines = [`รายการเบิก${label} ${today}`, ''];
  items.forEach((item, i) => {
    const qty = item.suggested_qty || 0;
    const dateTag = item.date !== new Date().toISOString().split('T')[0] ? ` [ค้างจาก ${new Date(item.date).toLocaleDateString('th-TH',{day:'2-digit',month:'short'})}]` : '';
    lines.push(`${i+1}. ${item.item_name}${dateTag} — เบิก ${qty}`);
  });
  navigator.clipboard.writeText(lines.join('\n')).then(()=>showToast(`คัดลอกรายการ${label} ${items.length} รายการแล้วค่ะ`));
}

async function renderDwHistoryPage() {
  const div = document.getElementById('page-daily-withdraw');
  if (!div) return;
  div.innerHTML = `<div style="padding:24px;text-align:center;color:var(--ink4)"><i class="ti ti-loader" style="font-size:24px"></i></div>`;

  const { data } = await sb.from('daily_withdrawals')
    .select('*')
    .eq('status','received')
    .order('received_at', { ascending: false })
    .limit(200);

  if (!data || !data.length) {
    div.innerHTML = `<div class="page-header">
      <div><div class="page-title">ประวัติการรับเข้า</div></div>
      <button class="btn btn-sm" onclick="renderDailyWithdrawPage()"><i class="ti ti-arrow-left"></i> กลับ</button>
    </div>
    <div style="padding:40px;text-align:center;color:var(--ink4)">
      <i class="ti ti-history" style="font-size:32px;display:block;margin-bottom:8px;opacity:.3"></i>ยังไม่มีประวัติ
    </div>`;
    return;
  }

  // จัดกลุ่มตามวันที่รับเข้า
  const byDate = {};
  data.forEach(r => {
    const d = r.received_at
      ? new Date(r.received_at).toLocaleDateString('th-TH',{weekday:'short',day:'2-digit',month:'long',year:'numeric'})
      : new Date(r.date).toLocaleDateString('th-TH',{weekday:'short',day:'2-digit',month:'long',year:'numeric'});
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  const sections = Object.entries(byDate).map(([date, rows]) => {
    const byPg = { finish: rows.filter(r=>r.pg==='finish'), store2: rows.filter(r=>r.pg==='store2') };
    const tableRows = rows.map(r => {
      const prepQty = r.prepared_qty ?? r.suggested_qty ?? 0;
      const recvTime = r.received_at
        ? new Date(r.received_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
        : '—';
      const pgLabel = r.pg === 'finish' ? 'สินค้า' : 'Store 2';
      return `<tr>
        <td style="padding:7px 12px;font-size:12px;font-weight:500">${r.item_name}</td>
        <td style="padding:7px 12px;font-size:10px;color:var(--ink4)">${pgLabel}</td>
        <td style="padding:7px 12px;text-align:right;font-size:12px">${r.suggested_qty||0}</td>
        <td style="padding:7px 12px;text-align:right;font-size:12px;font-weight:500;color:#2d4a0f">${prepQty}</td>
        <td style="padding:7px 12px;font-size:10px;color:var(--ink4)">${recvTime}</td>
        <td style="padding:7px 12px;font-size:11px;color:var(--ink4)">${r.note||'—'}</td>
      </tr>`;
    }).join('');

    return `<div style="margin-bottom:16px">
      <div style="padding:8px 12px;background:var(--s2);border:0.5px solid var(--line);border-radius:8px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12px;font-weight:500">${date}</div>
        <div style="font-size:10px;color:var(--ink4)">${rows.length} รายการ · สินค้า ${byPg.finish.length} / Store 2 ${byPg.store2.length}</div>
      </div>
      <div class="sc-table-wrap">
        <table class="sc-table">
          <thead><tr>
            <th>รายการ</th><th>คลัง</th>
            <th style="text-align:right">แนะนำ</th>
            <th style="text-align:right">รับเข้า</th>
            <th>เวลา</th><th>หมายเหตุ</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ประวัติการรับเข้า</div>
        <div class="page-sub">${data.length} รายการล่าสุด</div></div>
      <button class="btn btn-sm" onclick="renderDailyWithdrawPage()">
        <i class="ti ti-arrow-left"></i> กลับ
      </button>
    </div>
    ${sections}`;
}



function dwOpenAddModal(pg) {
  dwAddTab = pg || 'finish';
  document.getElementById('dw-add-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-wrap show';
  modal.id = 'dw-add-modal';
  modal.innerHTML = `<div class="modal" style="max-width:400px;width:95%">
    <div class="card-title" style="margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--line)">
      <div class="card-title-left"><i class="ti ti-plus"></i> เพิ่มรายการ</div>
      <button class="btn btn-sm" onclick="document.getElementById('dw-add-modal').remove()">ยกเลิก</button>
    </div>
    <div style="display:flex;gap:0;border-bottom:0.5px solid var(--line);margin-bottom:12px">
      <button onclick="dwSetAddTab('finish',this)" id="dw-tab-finish"
        style="font-size:12px;padding:6px 16px;border:none;background:transparent;cursor:pointer;font-family:inherit;border-bottom:2px solid var(--ink);color:var(--ink);font-weight:500">
        สินค้าสำเร็จรูป
      </button>
      <button onclick="dwSetAddTab('store2',this)" id="dw-tab-store2"
        style="font-size:12px;padding:6px 16px;border:none;background:transparent;cursor:pointer;font-family:inherit;border-bottom:2px solid transparent;color:var(--ink4)">
        Store 2
      </button>
    </div>
    <div style="position:relative;margin-bottom:8px">
      <input class="fi" id="dw-add-search" placeholder="พิมพ์ชื่อสินค้า..." autocomplete="off"
        oninput="dwFilterItems()" onfocus="dwFilterItems()">
    </div>
    <div id="dw-add-dd" style="border:0.5px solid var(--line);border-radius:8px;overflow:hidden;max-height:200px;overflow-y:auto;margin-bottom:10px"></div>
    <div id="dw-add-selected" style="display:none;background:var(--s2);border:0.5px solid var(--line);border-radius:8px;padding:8px 12px;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div>
        <div style="font-size:12px;font-weight:500" id="dw-sel-name">—</div>
        <div style="font-size:10px;color:var(--ink4)" id="dw-sel-stock">—</div>
      </div>
      <button onclick="dwClearSel()" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px">✕</button>
    </div>
    <input type="hidden" id="dw-sel-code">
    <input type="hidden" id="dw-sel-pg">
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:10px;border-top:0.5px solid var(--line)">
      <button class="btn btn-sm" onclick="document.getElementById('dw-add-modal').remove()">ยกเลิก</button>
      <button class="btn btn-primary btn-sm" onclick="dwAddManualItem()"><i class="ti ti-plus"></i> เพิ่มในรายการวันนี้</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  setTimeout(() => dwFilterItems(), 50);
}

function dwSetAddTab(pg, el) {
  dwAddTab = pg;
  ['finish','store2'].forEach(t => {
    const btn = document.getElementById('dw-tab-'+t);
    if (btn) {
      btn.style.borderBottom = t===pg ? '2px solid var(--ink)' : '2px solid transparent';
      btn.style.color = t===pg ? 'var(--ink)' : 'var(--ink4)';
      btn.style.fontWeight = t===pg ? '500' : 'normal';
    }
  });
  document.getElementById('dw-add-search').value = '';
  dwClearSel();
  dwFilterItems();
}

function dwFilterItems() {
  const q = (document.getElementById('dw-add-search')?.value||'').toLowerCase();
  const dd = document.getElementById('dw-add-dd');
  if (!dd) return;
  const items = masterDB.filter(m => {
    if (m.pg !== dwAddTab) return false;
    if (q && !m.name.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!items.length) { dd.innerHTML=`<div style="padding:12px;text-align:center;font-size:11px;color:var(--ink4)">ไม่พบรายการ</div>`; return; }
  dd.innerHTML = items.map(m=>`
    <div onclick="dwSelectItem('${m.code}','${m.name.replace(/'/g,"\'")}',${m.stock},'${m.pg}')"
      style="padding:8px 12px;cursor:pointer;border-bottom:0.5px solid var(--line);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background=''">
      <span style="font-size:12px;font-weight:500">${m.name}</span>
      <span style="font-size:10px;color:${m.stock<=0?'var(--red)':'var(--ink4)'}">คงเหลือ ${m.stock}</span>
    </div>`).join('');
}

function dwSelectItem(code, name, stock, pg) {
  document.getElementById('dw-add-search').value = name;
  document.getElementById('dw-sel-code').value = code;
  document.getElementById('dw-sel-pg').value = pg;
  document.getElementById('dw-sel-name').textContent = name;
  document.getElementById('dw-sel-stock').textContent = `คงเหลือ ${stock}`;
  document.getElementById('dw-add-selected').style.display = 'flex';
  document.getElementById('dw-add-dd').style.display = 'none';
}

function dwClearSel() {
  document.getElementById('dw-sel-code').value = '';
  document.getElementById('dw-sel-pg').value = '';
  document.getElementById('dw-add-selected').style.display = 'none';
  document.getElementById('dw-add-dd').style.display = 'block';
}

async function dwAddManualItem() {
  const code = document.getElementById('dw-sel-code')?.value;
  const pg   = document.getElementById('dw-sel-pg')?.value;
  const name = document.getElementById('dw-sel-name')?.textContent;
  if (!code || !name || name==='—') { showToast('กรุณาเลือกรายการก่อน','err'); return; }
  const m = masterDB.find(x=>x.code===code);
  const today = new Date().toISOString().split('T')[0];
  const exists = dwItems.find(x=>x.item_code===code);
  if (exists) { showToast('รายการนี้มีอยู่แล้ว','err'); return; }
  const { error } = await sb.from('daily_withdrawals').insert({
    date: today, item_code: code, item_name: name, pg,
    current_stock: m?.stock||0, max_stock: m?.max||0,
    suggested_qty: m?.max>0 ? Math.max(0,(m.max||0)-(m.stock||0)) : null,
    status: 'pending',
  });
  if (error) { showToast('เพิ่มไม่สำเร็จ','err'); return; }
  document.getElementById('dw-add-modal').remove();
  showToast(`เพิ่ม "${name}" แล้ว`);
  await dbLoadDailyWithdrawals();
  renderDailyWithdrawPage();
}

/* ═══════════════════════════════════════════
   DAILY STOCKCOUNT MODULE — ตรวจนับเบิกประจำวัน
═══════════════════════════════════════════ */

let dscCat      = '';
let dscStore2Cat = '';
let dscData   = {};   // { code: { actual, note } }
let dscSearch = '';

async function renderDailyStockcountPage() {
  const div = document.getElementById('page-daily-stockcount');
  if (!div) return;
  div.innerHTML = `<div style="padding:24px;text-align:center;color:var(--ink4)"><i class="ti ti-loader" style="font-size:24px"></i></div>`;
  dscRender();
}

function dscRender() {
  const div = document.getElementById('page-daily-stockcount');
  if (!div) return;

  const today = new Date().toLocaleDateString('th-TH',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const finishItems = masterDB.filter(m => m.pg === 'finish');
  const store2Items = masterDB.filter(m => m.pg === 'store2');
  const store2Subcats = [...new Set(store2Items.map(m => m.subcat||'ไม่มีหมวดหมู่'))].sort();
  if (!dscStore2Cat || !store2Subcats.includes(dscStore2Cat)) dscStore2Cat = store2Subcats[0] || '';

  // tabs store2
  const store2CatTabs = store2Subcats.map(sub => {
    const subItems = store2Items.filter(m=>(m.subcat||'ไม่มีหมวดหมู่')===sub);
    const counted  = subItems.filter(m=>dscData[m.code]!==undefined).length;
    const isActive = sub === dscStore2Cat;
    const allDone  = counted === subItems.length && subItems.length > 0;
    return `<button onclick="dscStore2Cat='${sub.replace(/'/g,"\\'")}';dscRender()"
      style="padding:5px 14px;border-radius:20px;border:0.5px solid ${isActive?'var(--ink)':'var(--line)'};
      font-size:11px;cursor:pointer;font-family:inherit;
      background:${isActive?'var(--ink)':'transparent'};
      color:${isActive?'var(--surface)':'var(--ink3)'};
      display:inline-flex;align-items:center;gap:5px">
      ${sub}
      ${allDone?`<span style="font-size:9px;background:#edf5ec;color:#2d6a0f;padding:1px 5px;border-radius:8px">✓</span>`:
        counted?`<span style="font-size:9px;background:var(--s2);color:var(--ink4);padding:1px 5px;border-radius:8px">${counted}</span>`:''}
    </button>`;
  }).join('');

  // รายการ store2 ในหมวดที่เลือก
  const store2Filtered = store2Items.filter(m => {
    if ((m.subcat||'ไม่มีหมวดหมู่') !== dscStore2Cat) return false;
    if (dscSearch && !m.name.toLowerCase().includes(dscSearch.toLowerCase())) return false;
    return true;
  });
  const countedStore2Cat = store2Filtered.filter(m=>dscData[m.code]!==undefined).length;
  const allItems = [...finishItems, ...store2Items];

  const subcats = [...new Set(finishItems.map(m => m.subcat||'ไม่มีหมวดหมู่'))].sort();
  if (!dscCat || !subcats.includes(dscCat)) dscCat = subcats[0] || '';

  const allCounted = Object.keys(dscData).length;

  // tabs หมวดหมู่ finish
  const catTabs = subcats.map(sub => {
    const subItems = finishItems.filter(m=>(m.subcat||'ไม่มีหมวดหมู่')===sub);
    const counted  = subItems.filter(m=>dscData[m.code]!==undefined).length;
    const isActive = sub === dscCat;
    const allDone  = counted === subItems.length && subItems.length > 0;
    return `<button onclick="dscCat='${sub.replace(/'/g,"\\'")}';dscRender()"
      style="padding:5px 14px;border-radius:20px;border:0.5px solid ${isActive?'var(--ink)':'var(--line)'};
      font-size:11px;cursor:pointer;font-family:inherit;
      background:${isActive?'var(--ink)':'transparent'};
      color:${isActive?'var(--surface)':'var(--ink3)'};
      display:inline-flex;align-items:center;gap:5px">
      ${sub}
      ${allDone?`<span style="font-size:9px;background:#edf5ec;color:#2d6a0f;padding:1px 5px;border-radius:8px">✓</span>`:
        counted?`<span style="font-size:9px;background:var(--s2);color:var(--ink4);padding:1px 5px;border-radius:8px">${counted}</span>`:''}
    </button>`;
  }).join('');

  // รายการ finish ในหมวด
  const catItems = finishItems.filter(m => {
    if ((m.subcat||'ไม่มีหมวดหมู่') !== dscCat) return false;
    if (dscSearch && !m.name.toLowerCase().includes(dscSearch.toLowerCase())) return false;
    return true;
  });
  const countedInCat = catItems.filter(m=>dscData[m.code]!==undefined).length;

  function buildRows(items) {
    return items.map(m => {
      const entry  = dscData[m.code];
      const hasVal = entry !== undefined;
      const actual = hasVal ? entry.actual : '';
      const note   = hasVal ? (entry.note||'') : '';
      const isLow  = hasVal && actual < (m.min||0);
      const spec   = m.spec || '';
      const rowBg  = !hasVal ? '' : isLow ? 'background:#fdf4f4' : 'background:#f4f9f0';
      const inpBorder = !hasVal ? 'var(--line)' : isLow ? '#d04040' : '#4a9a2a';
      const inpBg = !hasVal ? 'var(--surface)' : isLow ? '#fdf0f0' : '#f0f7ec';
      const stockColor = m.stock < (m.min||0) ? '#b03030' : 'var(--ink4)';
      const badge = m.stock < (m.min||0)
        ? `<span style="font-size:9px;padding:1px 6px;border-radius:6px;background:#fde8e8;color:#b03030;font-weight:500;margin-left:5px">ต่ำกว่า Min</span>`
        : m.stock >= (m.max||0) && m.max > 0
        ? `<span style="font-size:9px;padding:1px 6px;border-radius:6px;background:#edf5e8;color:#2d6a0f;font-weight:500;margin-left:5px">เต็ม Max</span>`
        : '';
      return `<div style="display:grid;grid-template-columns:1fr 110px 28px;padding:12px 16px;border-bottom:0.5px solid var(--line);align-items:start;gap:12px;${rowBg}">
        <div>
          <div style="font-size:13px;font-weight:500;margin-bottom:2px">${m.name}${badge}</div>
          <div style="font-size:10px;color:var(--ink4);margin-bottom:${spec?'4px':'0px'}">
            <span style="color:${stockColor};${isLow?'font-weight:500':''}">ระบบ ${m.stock}</span>
            <span style="margin:0 5px;opacity:.3">·</span>Min <b>${m.min||0}</b>
            <span style="margin:0 5px;opacity:.3">·</span>Max <b>${m.max||0}</b>
          </div>
          ${spec?`<div style="font-size:10px;color:var(--ink3);background:var(--s2);border-left:2px solid var(--line);padding:3px 8px;border-radius:0 4px 4px 0;margin-bottom:5px;line-height:1.5">${spec}</div>`:''}
          <input type="text" placeholder="หมายเหตุถึงผู้เบิก..." value="${note}"
            style="padding:4px 8px;border:0.5px solid var(--line);border-radius:6px;font-size:10px;width:100%;background:var(--surface);color:var(--ink3);outline:none;font-family:inherit"
            onchange="dscSetNote('${m.code}',this.value)">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="กรอกจำนวน"
            value="${actual}" id="inp-${m.code}"
            style="padding:7px 10px;border:0.5px solid ${inpBorder};border-radius:8px;font-size:13px;text-align:right;width:100%;background:${inpBg};color:var(--ink);outline:none;font-family:inherit"
            oninput="dscCalc('${m.code}',this.value)"
            onkeydown="dscNav(event,'${m.code}','${items.map(i=>i.code).join(',')}')"
            onfocus="this.select()">
          <div id="inp-note-${m.code}" style="font-size:9px;text-align:right;min-height:12px;color:var(--ink4)">
            ${hasVal ? (actual < (m.min||0) ? `ต่ำกว่า Min` : actual >= (m.max||0) && m.max > 0 ? 'ครบ Max ✓' : '') : ''}
          </div>
        </div>
        <button onclick="dscClearRow('${m.code}')"
          style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px;padding:0;margin-top:10px;${!hasVal?'opacity:.2':''}">✕</button>
      </div>`;
    }).join('') || `<div style="padding:32px;text-align:center;color:var(--ink4)">ไม่พบรายการ</div>`;
  }

  const rows        = buildRows(catItems);
  const store2Rows  = buildRows(store2Filtered);
  const store2Counted = store2Items.filter(m=>dscData[m.code]!==undefined).length;

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ตรวจนับเบิกประจำวัน</div>
        <div class="page-sub">${today}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="dscCopy()" style="font-size:11px">
          <i class="ti ti-copy"></i> คัดลอก
        </button>
        <button class="btn btn-sm" onclick="dscData={};dscRender()" style="font-size:11px">
          <i class="ti ti-eraser"></i> ล้าง
        </button>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:20px;font-weight:500">${allItems.length}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:2px">ทั้งหมด</div>
      </div>
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:20px;font-weight:500;color:var(--acc)">${allCounted}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:2px">นับแล้ว</div>
      </div>
      <div class="card" style="flex:1;padding:8px 12px;text-align:center">
        <div style="font-size:20px;font-weight:500">${allItems.length - allCounted}</div>
        <div style="font-size:10px;color:var(--ink4);margin-top:2px">ยังไม่นับ</div>
      </div>
    </div>

    <div style="margin-bottom:12px">
      <input class="fi" placeholder="ค้นหาทุกคลัง..." value="${dscSearch}"
        oninput="dscSearch=this.value;dscRender()" style="max-width:260px;font-size:11px">
    </div>

    <div style="font-size:11px;font-weight:600;color:var(--ink4);text-transform:uppercase;letter-spacing:.3px;margin-bottom:8px">
      <i class="ti ti-package" style="font-size:12px"></i> สินค้าสำเร็จรูป
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${catTabs}</div>
    <div style="border:0.5px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:8px">
      <div style="padding:8px 16px;background:var(--s2);border-bottom:0.5px solid var(--line)">
        <span style="font-size:12px;font-weight:500">${dscCat} · ${countedInCat}/${catItems.length}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 110px 28px;padding:5px 16px;font-size:10px;color:var(--ink4);border-bottom:0.5px solid var(--line);background:var(--s2)">
        <span>รายการ</span><span style="text-align:right">นับจริง</span><span></span>
      </div>
      ${rows}
    </div>
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:20px">
      <button class="btn btn-sm" onclick="dscFillCat('${dscCat.replace(/'/g,"\\'")}',false)" style="font-size:11px">
        นับเท่าระบบ
      </button>
      <button class="btn btn-sm" onclick="dscSaveCat('${dscCat.replace(/'/g,"\\'")}',false)" style="font-size:11px">
        <i class="ti ti-check"></i> บันทึกหมวดนี้ (${countedInCat})
      </button>
    </div>

    <div style="font-size:11px;font-weight:600;color:var(--ink4);text-transform:uppercase;letter-spacing:.3px;margin-bottom:10px">
      <i class="ti ti-building-store" style="font-size:12px"></i> Store 2
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${store2CatTabs}</div>
    <div style="border:0.5px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:8px">
      <div style="padding:8px 16px;background:var(--s2);border-bottom:0.5px solid var(--line)">
        <span style="font-size:12px;font-weight:500">${dscStore2Cat} · ${countedStore2Cat}/${store2Filtered.length}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 110px 28px;padding:5px 16px;font-size:10px;color:var(--ink4);border-bottom:0.5px solid var(--line);background:var(--s2)">
        <span>รายการ</span><span style="text-align:right">นับจริง</span><span></span>
      </div>
      ${store2Rows}
    </div>
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:20px">
      <button class="btn btn-sm" onclick="dscFillCat('${dscStore2Cat.replace(/'/g,"\\'")}',true)" style="font-size:11px">
        นับเท่าระบบ
      </button>
      <button class="btn btn-sm" onclick="dscSaveCat('${dscStore2Cat.replace(/'/g,"\\'")}',true)" style="font-size:11px">
        <i class="ti ti-check"></i> บันทึกหมวดนี้ (${countedStore2Cat})
      </button>
    </div>

    <div style="padding:10px 16px;background:var(--s2);border:0.5px solid var(--line);border-radius:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="font-size:10px;color:var(--ink4)">
        กด <kbd style="padding:1px 5px;border:0.5px solid var(--line);border-radius:4px;font-size:10px">Enter</kbd> เลื่อนรายการถัดไป
      </div>
      <button class="btn btn-sm btn-primary" onclick="dscSaveAll()" style="font-size:11px">
        <i class="ti ti-checks"></i> บันทึกทั้งหมด (${allCounted})
      </button>
    </div>`;
}
function dscCalc(code, val) {
  const v = val === '' ? undefined : parseFloat(val);
  if (v === undefined) { delete dscData[code]; }
  else { if (!dscData[code]) dscData[code] = {}; dscData[code].actual = v; }
  const m = masterDB.find(x=>x.code===code);
  if (!m) return;
  const noteEl = document.getElementById('inp-note-'+code);
  const inp    = document.getElementById('inp-'+code);
  if (!noteEl || !inp) return;
  if (v === undefined) {
    noteEl.textContent=''; inp.style.borderColor='var(--line)'; inp.style.background='var(--surface)'; return;
  }
  const isLow = v < (m.min||0);
  const isFull = m.max > 0 && v >= m.max;
  noteEl.style.color = isLow ? '#b03030' : isFull ? '#2d6a0f' : 'var(--ink4)';
  noteEl.textContent = isLow ? 'ต่ำกว่า Min' : isFull ? 'ครบ Max ✓' : '';
  inp.style.borderColor = isLow ? '#d04040' : '#4a9a2a';
  inp.style.background  = isLow ? '#fdf0f0' : '#f0f7ec';
}

function dscNav(e, code, codesStr) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const codes = codesStr.split(',');
  const i = codes.indexOf(code);
  if (i < codes.length-1) document.getElementById('inp-'+codes[i+1])?.focus();
}

function dscSetNote(code, note) {
  if (!dscData[code]) dscData[code] = {};
  dscData[code].note = note;
}

function dscClearRow(code) {
  delete dscData[code];
  const inp = document.getElementById('inp-'+code);
  if (inp) { inp.value=''; inp.style.borderColor='var(--line)'; inp.style.background='var(--surface)'; }
  const noteEl = document.getElementById('inp-note-'+code);
  if (noteEl) noteEl.textContent='';
}

function dscFillCat(cat, isStore2=false) {
  const items = isStore2
    ? masterDB.filter(m=>m.pg==='store2'&&(m.subcat||'ไม่มีหมวดหมู่')===cat)
    : masterDB.filter(m=>m.pg==='finish'&&(m.subcat||'ไม่มีหมวดหมู่')===cat);
  items.forEach(m=>{
    if(!dscData[m.code]) dscData[m.code]={};
    dscData[m.code].actual = m.stock;
    dscCalc(m.code, m.stock);
    const inp = document.getElementById('inp-'+m.code);
    if(inp) inp.value = m.stock;
  });
  dscRender();
}

function dscCopy() {
  const today = new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric'});
  const finishItems = masterDB.filter(m=>m.pg==='finish');
  const subcats = [...new Set(finishItems.map(m=>m.subcat||'ไม่มีหมวดหมู่'))].sort();
  const lines = [`ตรวจนับเบิกประจำวัน ${today}`,''];
  subcats.forEach(sub=>{
    const items = finishItems.filter(m=>(m.subcat||'ไม่มีหมวดหมู่')===sub);
    lines.push(`── ${sub} ──`);
    items.forEach((m,i)=>{
      let row = `${i+1}. ${m.name}  (ระบบ ${m.stock}  Min ${m.min||0}  Max ${m.max||0})`;
      if (m.spec) row += `  [${m.spec}]`;
      row += `  นับจริง: ___`;
      lines.push(row);
    });
    lines.push('');
  });
  navigator.clipboard.writeText(lines.join('\n')).then(()=>showToast('คัดลอกรายการแล้วค่ะ'));
}

async function dscSaveCat(cat, isStore2=false) {
  let catItems;
  if (isStore2) {
    catItems = masterDB.filter(m=>m.pg==='store2'&&(m.subcat||'ไม่มีหมวดหมู่')===cat);
  } else {
    catItems = masterDB.filter(m=>m.pg==='finish'&&(m.subcat||'ไม่มีหมวดหมู่')===cat);
  }
  const toUpdate = catItems.filter(m=>dscData[m.code]?.actual!==undefined);
  if(!toUpdate.length){showToast('กรุณากรอกยอดนับก่อนนะคะ','err');return;}
  const label = `"${cat}"`;
  if(!confirm(`ยืนยันบันทึกหมวด ${label} จำนวน ${toUpdate.length} รายการ?`)) return;
  await dscDoSave(toUpdate);
  catItems.forEach(m=>delete dscData[m.code]);
  showToast(`บันทึกหมวด ${label} เรียบร้อยค่ะ`);
  dscRender();
}

async function dscSaveAll() {
  const toUpdate = masterDB.filter(m=>
    (m.pg==='finish'||m.pg==='store2') && dscData[m.code]?.actual!==undefined
  );
  if(!toUpdate.length){showToast('กรุณากรอกยอดนับก่อนนะคะ','err');return;}
  if(!confirm(`ยืนยันบันทึกทั้งหมด ${toUpdate.length} รายการและสร้างใบเบิก?`)) return;
  await dscDoSave(toUpdate);
  toUpdate.forEach(m=>delete dscData[m.code]);
  showToast(`บันทึกทั้งหมด ${toUpdate.length} รายการเรียบร้อยค่ะ`);
  dscRender();
}

async function dscDoSave(items) {
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await sb.from('daily_withdrawals').select('item_code').eq('date',today);
  const existingCodes = new Set((existing||[]).map(x=>x.item_code));
  const newWithdraw = [];

  for (const m of items) {
    const actual = dscData[m.code].actual;
    const note   = dscData[m.code].note || null;
    await sb.from('items').update({ stock: actual }).eq('code', m.code);
    m.stock = actual;
    if (actual < (m.min||0) && !existingCodes.has(m.code) && ['finish','store2'].includes(m.pg)) {
      newWithdraw.push({
        date: today, item_code: m.code, item_name: m.name, pg: m.pg,
        current_stock: actual, max_stock: m.max||0,
        suggested_qty: Math.max(0,(m.max||0)-actual),
        note: note,   // บันทึกหมายเหตุไปด้วย
        status: 'pending',
      });
    } else if (actual < (m.min||0) && existingCodes.has(m.code) && note) {
      // อัปเดต note ถ้ามีอยู่แล้ว
      await sb.from('daily_withdrawals').update({ note }).eq('item_code', m.code).eq('date', today);
    }
  }

  if (newWithdraw.length) {
    await sb.from('daily_withdrawals').insert(newWithdraw);
    showToast(`เพิ่ม ${newWithdraw.length} รายการเข้าใบเบิกแล้วค่ะ`);
  }
}


let bbBorrows = [];
let bbShowForm = false;
let bbEditId   = null;

async function bbLoadBorrows() {
  const { data } = await sb.from('booth_borrows')
    .select('*, booth_borrow_items(*)')
    .order('created_at', { ascending: false });
  bbBorrows = data || [];
}

async function renderBoothBorrowPage() {
  const div = document.getElementById('page-booth-borrow');
  if (!div) return;
  div.innerHTML = `<div style="padding:24px;text-align:center;color:var(--ink4)"><i class="ti ti-loader" style="font-size:24px"></i></div>`;
  await bbLoadBorrows();
  bbRender();
}

let bbSearchText = '';

function bbRender() {
  const div = document.getElementById('page-booth-borrow');
  if (!div) return;

  const searchLower = bbSearchText.toLowerCase();
  const filtered = searchLower
    ? bbBorrows.filter(b => b.title.toLowerCase().includes(searchLower))
    : bbBorrows;

  const cards = filtered.map(b => {
    const storeItems  = (b.booth_borrow_items||[]).filter(i=>i.section==='store');
    const productItems= (b.booth_borrow_items||[]).filter(i=>i.section==='product');
    const statusLabel = { active:'กำลังยืม', returned:'คืนครบแล้ว', partial:'คืนบางส่วน' }[b.status] || b.status;
    const statusColor = { active:'#7a5900', returned:'#2d4a0f', partial:'#7a2020' }[b.status] || 'var(--ink4)';
    const statusBg    = { active:'#fff8e8', returned:'#f0f5ec', partial:'#fde8e8' }[b.status] || 'var(--s2)';
    const borrowDate  = b.borrow_date ? new Date(b.borrow_date).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
    const dueDate     = b.return_due  ? new Date(b.return_due).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'})  : '—';

    const storeRows = storeItems.map(i => {
      const bal = (i.qty_borrowed||0) - (i.qty_returned||0);
      const balColor = bal > 0 ? 'var(--red)' : 'var(--green)';
      return `<div style="display:grid;grid-template-columns:1fr 56px 56px 56px 28px;padding:8px 12px;border-bottom:0.5px solid var(--line);align-items:center;gap:4px">
        <div style="font-size:12px;font-weight:500">${i.item_name}</div>
        <input type="number" value="${i.qty_borrowed||0}" min="0" style="padding:3px 6px;border:0.5px solid var(--line);border-radius:5px;font-size:11px;text-align:right;background:var(--surface);width:100%"
          onchange="bbUpdateItem(${i.id},'qty_borrowed',this.value)">
        <input type="number" value="${i.qty_returned||''}" min="0" placeholder="—" style="padding:3px 6px;border:0.5px solid #4a6b1a;border-radius:5px;font-size:11px;text-align:right;background:#f0f5ec;width:100%"
          onchange="bbUpdateItem(${i.id},'qty_returned',this.value)">
        <div style="text-align:right;font-size:12px;font-weight:600;color:${balColor}">${bal}</div>
        <button onclick="bbDeleteItem(${i.id},${b.id})" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:13px">✕</button>
      </div>`;
    }).join('');

    const productRows = productItems.map(i => {
      const bal = (i.qty_borrowed||0) - (i.qty_returned||0);
      const balColor = bal > 0 ? 'var(--warn)' : '#2d4a0f';
      const lotLabel = i.lot_sw ? `<div style="font-size:10px;color:var(--ink4)">Lot ${new Date(i.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}</div>` : '';
      return `<div style="display:grid;grid-template-columns:1fr 56px 56px 56px 28px;padding:8px 12px;border-bottom:0.5px solid var(--line);align-items:center;gap:4px">
        <div><div style="font-size:12px;font-weight:500">${i.item_name}</div>${lotLabel}</div>
        <input type="number" value="${i.qty_borrowed||0}" min="0" style="padding:3px 6px;border:0.5px solid var(--line);border-radius:5px;font-size:11px;text-align:right;background:var(--surface);width:100%"
          onchange="bbUpdateItem(${i.id},'qty_borrowed',this.value)">
        <input type="number" value="${i.qty_returned||''}" min="0" placeholder="—" style="padding:3px 6px;border:0.5px solid #4a6b1a;border-radius:5px;font-size:11px;text-align:right;background:#f0f5ec;width:100%"
          onchange="bbUpdateItem(${i.id},'qty_returned',this.value)">
        <div style="text-align:right;font-size:12px;font-weight:600;color:${balColor}">${bal}</div>
        <button onclick="bbDeleteItem(${i.id},${b.id})" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:13px">✕</button>
      </div>`;
    }).join('');

    const storeReceiver = storeItems[0]?.receiver_name || '';
    const storeNote     = storeItems[0]?.note || '';
    const productReceiver = productItems[0]?.receiver_name || '';
    const productNote     = productItems[0]?.note || '';

    return `<div class="card" style="margin-bottom:12px">
      <div style="padding:10px 16px;border-bottom:0.5px solid var(--line);background:var(--s2);display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:500">${b.title}</div>
          <div style="font-size:10px;color:var(--ink4);margin-top:2px">ยืม ${borrowDate} · กำหนดคืน ${dueDate} · โดย ${b.borrower_name||'—'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:9px;padding:2px 8px;border-radius:10px;background:${statusBg};color:${statusColor};border:0.5px solid ${statusColor}">${statusLabel}</span>
          <button onclick="bbDelete(${b.id})" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:12px" title="ลบ"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px">

        <!-- อุปกรณ์สโตว์ -->
        <div style="border:0.5px solid var(--line);border-radius:8px;overflow:hidden">
          <div style="padding:7px 12px;background:var(--s2);border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:500">อุปกรณ์สโตว์</span>
              <span style="font-size:9px;padding:1px 6px;border-radius:5px;background:var(--surface);border:0.5px solid var(--line);color:var(--ink4)">หัก/บวก stock</span>
            </div>
            <span style="font-size:10px;color:var(--ink4)">${storeItems.length} รายการ</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 56px 56px 56px 28px;padding:5px 12px;font-size:10px;color:var(--ink4);border-bottom:0.5px solid var(--line)">
            <span>รายการ</span><span style="text-align:right">ยืมไป</span><span style="text-align:right">คืนแล้ว</span><span style="text-align:right;color:var(--ink2)">คงเหลือ</span><span></span>
          </div>
          ${storeRows || '<div style="padding:12px;text-align:center;font-size:11px;color:var(--ink4)">ยังไม่มีรายการ</div>'}
          <div style="padding:8px 12px;border-top:0.5px solid var(--line);background:var(--s2);display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <button onclick="bbAddItemModal(${b.id},'store')" style="font-size:11px;padding:4px 10px;border-radius:7px;border:0.5px dashed var(--line);background:transparent;color:var(--ink3);cursor:pointer">+ เพิ่มรายการ</button>
              <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
                <span style="font-size:10px;color:var(--ink4);white-space:nowrap">ผู้รับคืน</span>
                <input style="padding:3px 8px;border:0.5px solid var(--line);border-radius:5px;font-size:11px;background:var(--surface);width:120px" placeholder="ชื่อผู้รับคืน" value="${storeReceiver}"
                  onchange="bbUpdateSectionMeta(${b.id},'store','receiver_name',this.value)">
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:10px;color:var(--ink4);white-space:nowrap">หมายเหตุ</span>
              <input style="padding:3px 8px;border:0.5px solid var(--line);border-radius:5px;font-size:11px;background:var(--surface);flex:1" placeholder="หมายเหตุการคืนอุปกรณ์..." value="${storeNote}"
                onchange="bbUpdateSectionMeta(${b.id},'store','note',this.value)">
            </div>
            <div style="display:flex;gap:6px;justify-content:flex-end;padding-top:4px;border-top:0.5px solid var(--line)">
              <button onclick="bbConfirmBorrowStore(${b.id})" class="btn btn-sm" style="font-size:10px;background:var(--acc);color:#fff;border-color:var(--acc)"><i class="ti ti-arrow-down-left"></i> ยืมสโตว์</button>
              <button onclick="bbConfirmReturnStore(${b.id})" class="btn btn-sm" style="font-size:10px;background:var(--green,#2d4a0f);color:#fff;border-color:var(--green,#2d4a0f)"><i class="ti ti-arrow-up-right"></i> คืนสโตว์</button>
            </div>
          </div>
        </div>

        <!-- โปรดัก -->
        <div style="border:0.5px solid var(--line);border-radius:8px;overflow:hidden">
          <div style="padding:7px 12px;background:var(--s2);border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:500">โปรดัก</span>
              <span style="font-size:9px;padding:1px 6px;border-radius:5px;background:var(--surface);border:0.5px solid var(--line);color:var(--ink4)">บันทึกเท่านั้น</span>
            </div>
            <span style="font-size:10px;color:var(--ink4)">${productItems.length} รายการ</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 56px 56px 56px 28px;padding:5px 12px;font-size:10px;color:var(--ink4);border-bottom:0.5px solid var(--line)">
            <span>รายการ</span><span style="text-align:right">เอาไป</span><span style="text-align:right">คืนแล้ว</span><span style="text-align:right;color:var(--ink2)">คงเหลือ</span><span></span>
          </div>
          ${productRows || '<div style="padding:12px;text-align:center;font-size:11px;color:var(--ink4)">ยังไม่มีรายการ</div>'}
          <div style="padding:8px 12px;border-top:0.5px solid var(--line);background:var(--s2);display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <button onclick="bbAddItemModal(${b.id},'product')" style="font-size:11px;padding:4px 10px;border-radius:7px;border:0.5px dashed var(--line);background:transparent;color:var(--ink3);cursor:pointer">+ เพิ่มรายการ</button>
              <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
                <span style="font-size:10px;color:var(--ink4);white-space:nowrap">ผู้รับคืน</span>
                <input style="padding:3px 8px;border:0.5px solid var(--line);border-radius:5px;font-size:11px;background:var(--surface);width:120px" placeholder="ชื่อผู้รับคืน" value="${productReceiver}"
                  onchange="bbUpdateSectionMeta(${b.id},'product','receiver_name',this.value)">
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:10px;color:var(--ink4);white-space:nowrap">หมายเหตุ</span>
              <input style="padding:3px 8px;border:0.5px solid var(--line);border-radius:5px;font-size:11px;background:var(--surface);flex:1" placeholder="หมายเหตุการคืนโปรดัก..." value="${productNote}"
                onchange="bbUpdateSectionMeta(${b.id},'product','note',this.value)">
            </div>
            <div style="display:flex;gap:6px;justify-content:flex-end;padding-top:4px;border-top:0.5px solid var(--line)">
              <button onclick="bbConfirmBorrowProduct(${b.id})" class="btn btn-sm" style="font-size:10px;background:var(--acc);color:#fff;border-color:var(--acc);opacity:.85"><i class="ti ti-arrow-down-left"></i> ยืมโปรดัก → Factory</button>
              <button onclick="bbConfirmReturnProduct(${b.id})" class="btn btn-sm" style="font-size:10px;background:var(--green,#2d4a0f);color:#fff;border-color:var(--green,#2d4a0f);opacity:.85"><i class="ti ti-arrow-up-right"></i> คืนโปรดัก → Factory</button>
            </div>
          </div>
        </div>

      </div>
      <div style="padding:8px 16px;border-top:0.5px solid var(--line);background:var(--s2);display:flex;gap:6px;justify-content:flex-end">
        <button onclick="bbDelete(${b.id})" class="btn btn-sm" style="font-size:11px;color:var(--red)"><i class="ti ti-trash"></i> ลบรายการนี้</button>
      </div>
    </div>`;
  });

  // การ์ดย่อสำหรับที่คืนครบแล้ว
  const renderedCards = filtered.map((b, idx) => {
    const allItems = b.booth_borrow_items||[];
    const isFullyReturned = b.status === 'returned';
    if (isFullyReturned) {
      const storeCount  = allItems.filter(i=>i.section==='store').length;
      const productCount= allItems.filter(i=>i.section==='product').length;
      const borrowDate  = b.borrow_date ? new Date(b.borrow_date).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
      return `<div class="card" style="margin-bottom:8px;opacity:.7">
        <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="this.parentElement.querySelector('.bb-collapsed-detail').style.display=this.parentElement.querySelector('.bb-collapsed-detail').style.display==='none'?'block':'none'">
          <div>
            <div style="font-size:12px;font-weight:500">${b.title}</div>
            <div style="font-size:10px;color:var(--ink4)">ยืม ${borrowDate} · สโตว์ ${storeCount} / โปรดัก ${productCount} รายการ</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:9px;padding:2px 8px;border-radius:10px;background:#f0f5ec;color:#2d4a0f;border:0.5px solid #4a6b1a">คืนครบแล้ว</span>
            <button onclick="event.stopPropagation();bbDelete(${b.id})" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:12px"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <div class="bb-collapsed-detail" style="display:none;padding:0 16px 10px;font-size:11px;color:var(--ink4)">
          ${allItems.map(i=>`<div style="padding:2px 0">${i.item_name} · ยืม ${i.qty_borrowed} / คืน ${i.qty_returned}</div>`).join('')}
        </div>
      </div>`;
    }
    return cards[idx];
  }).join('') || `<div style="padding:40px;text-align:center;color:var(--ink4)"><i class="ti ti-arrows-exchange" style="font-size:32px;display:block;margin-bottom:8px;opacity:.3"></i>${searchLower?'ไม่พบรายการที่ค้นหา':'ยังไม่มีรายการยืม'}</div>`;

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">ยืม-คืน บูธ</div>
        <div class="page-sub">อุปกรณ์และโปรดักสำหรับงานและบูธ</div></div>
      <button class="btn btn-primary btn-sm" onclick="bbOpenNewForm()">
        <i class="ti ti-plus"></i> สร้างรายการยืม
      </button>
    </div>
    <div style="margin-bottom:12px">
      <input class="fi" placeholder="ค้นหาตามชื่องาน..." value="${bbSearchText}"
        oninput="bbSearchText=this.value;bbRender()" style="max-width:300px">
    </div>
    <div id="bb-new-form"></div>
    ${renderedCards}`;

  if (bbShowForm) bbRenderNewForm();
}

function bbOpenNewForm() {
  bbShowForm = true;
  bbRender();
  document.getElementById('bb-new-form')?.scrollIntoView({ behavior:'smooth' });
}

function bbRenderNewForm() {
  const el = document.getElementById('bb-new-form');
  if (!el) return;
  const today = new Date().toISOString().split('T')[0];
  el.innerHTML = `<div class="card" style="margin-bottom:12px;border:1.5px solid var(--acc)">
    <div style="padding:10px 16px;border-bottom:0.5px solid var(--line);background:var(--s2);font-size:13px;font-weight:500">สร้างรายการยืมใหม่</div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;flex-direction:column;gap:3px">
        <label style="font-size:10px;color:var(--ink4)">ชื่องาน / บูธ <span style="color:var(--red)">*</span></label>
        <input class="fi" id="bb-title" placeholder="เช่น งานเกษตรแฟร์ เชียงใหม่ 2569">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--ink4)">วันที่ยืม</label>
          <input class="fi" id="bb-date" type="date" value="${today}">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--ink4)">กำหนดคืน</label>
          <input class="fi" id="bb-due" type="date">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--ink4)">ผู้เบิก</label>
          <input class="fi" id="bb-borrower" placeholder="ชื่อผู้เบิก" value="${window._operatorName||''}">
        </div>
      </div>
    </div>
    <div style="padding:10px 16px;border-top:0.5px solid var(--line);display:flex;gap:8px;justify-content:flex-end;background:var(--s2)">
      <button class="btn btn-sm" onclick="bbShowForm=false;bbRender()">ยกเลิก</button>
      <button class="btn btn-primary btn-sm" onclick="bbSaveNew()"><i class="ti ti-check"></i> สร้าง</button>
    </div>
  </div>`;
}

async function bbSaveNew() {
  const title    = document.getElementById('bb-title')?.value.trim();
  const date     = document.getElementById('bb-date')?.value;
  const due      = document.getElementById('bb-due')?.value;
  const borrower = document.getElementById('bb-borrower')?.value.trim();
  if (!title) { showToast('กรุณาใส่ชื่องาน','err'); return; }

  const { data, error } = await sb.from('booth_borrows').insert({
    title, borrow_date: date||null, return_due: due||null,
    borrower_name: borrower||null, status:'active'
  }).select().single();
  if (error) { showToast('สร้างไม่สำเร็จ','err'); return; }

  showToast(`สร้างรายการ "${title}" แล้ว`);
  bbShowForm = false;
  await bbLoadBorrows();
  bbRender();
}

async function bbAddItemModal(borrowId, section) {
  const sectionLabel = section === 'store' ? 'อุปกรณ์สโตว์' : 'โปรดัก';

  document.getElementById('bb-add-modal')?.remove();

  // ถ้าเป็น product section โหลดรายการจาก Factory ก่อน
  if (section === 'product') {
    await bbLoadFactoryItems();
  }

  const modal = document.createElement('div');
  modal.className = 'modal-wrap show';
  modal.id = 'bb-add-modal';
  modal.innerHTML = `<div class="modal" style="max-width:400px;width:95%">
    <div class="card-title" style="margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--line)">
      <div class="card-title-left">เพิ่มรายการ${sectionLabel}</div>
      <button class="btn btn-sm" onclick="document.getElementById('bb-add-modal').remove()">ยกเลิก</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;flex-direction:column;gap:4px">
        <label style="font-size:10px;color:var(--ink4)">ค้นหารายการ</label>
        <div style="position:relative" id="bb-search-wrap">
          <input class="fi" id="bb-search-input" placeholder="พิมพ์ชื่อ${sectionLabel}..." autocomplete="off"
            oninput="bbFilterItems('${section}')"
            onfocus="(async()=>{if('${section}'==='product')await bbLoadFactoryItems();bbShowAllItems('${section}')})()">>
          <div id="bb-search-dd" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--surface);border:0.5px solid var(--line);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:200;max-height:200px;overflow-y:auto"></div>
        </div>
        <div style="font-size:10px;color:var(--ink4)">พิมพ์เพื่อค้นหา หรือคลิกเพื่อดูทั้งหมด</div>
      </div>
      <div id="bb-selected-item" style="display:none;background:var(--s2);border:0.5px solid var(--line);border-radius:8px;padding:8px 12px;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:12px;font-weight:500" id="bb-sel-name">—</div>
          <div style="font-size:10px;color:var(--ink4)" id="bb-sel-stock">—</div>
        </div>
        <button onclick="bbClearItemSearch()" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px">✕</button>
      </div>
      <input type="hidden" id="bb-sel-code">
      ${section === 'product' ? `
      <div id="bb-lot-section" style="display:none;flex-direction:column;gap:4px">
        <label style="font-size:10px;color:var(--ink4)">เลือก Lot <span style="color:var(--red)">*</span></label>
        <div id="bb-lot-list" style="border:0.5px solid var(--line);border-radius:8px;overflow:hidden;max-height:160px;overflow-y:auto">
          <div style="padding:10px;text-align:center;font-size:11px;color:var(--ink4)">เลือกสินค้าก่อน</div>
        </div>
        <input type="hidden" id="bb-sel-lot-id">
        <input type="hidden" id="bb-sel-lot-sw">
      </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:4px">
        <label style="font-size:10px;color:var(--ink4)">จำนวนที่ยืม</label>
        <input class="fi" id="bb-item-qty" type="number" min="1" value="1" style="text-align:right">
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
      <button class="btn btn-sm" onclick="document.getElementById('bb-add-modal').remove()">ยกเลิก</button>
      <button class="btn btn-primary btn-sm" onclick="bbAddItem(${borrowId},'${section}')"><i class="ti ti-plus"></i> เพิ่ม</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // ปิด dropdown เมื่อคลิกนอก
  setTimeout(() => {
    document.addEventListener('click', function bbClickOut(e) {
      if (!e.target.closest('#bb-search-wrap')) {
        const dd = document.getElementById('bb-search-dd');
        if (dd) dd.style.display = 'none';
      }
      if (!document.getElementById('bb-add-modal')) {
        document.removeEventListener('click', bbClickOut);
      }
    });
    document.getElementById('bb-search-input')?.focus();
  }, 100);
}

function bbGetItems(section) {
  if (section === 'store') {
    return masterDB.filter(m => m.pg === 'equip_th');
  } else {
    // product — ดึงจาก factoryItemsDB (คลัง finish ของ Factory)
    return factoryItemsDB || [];
  }
}

// cache รายการ Factory finish
let factoryItemsDB = null;  // reset ทุกครั้งที่เปิดหน้า booth-borrow
async function bbLoadFactoryItems() {
  if (factoryItemsDB) return;
  const { data, error } = await sbFactory.from('items')
    .select('code,name,stock,subcat')
    .eq('pg','finish')
    .order('name');
  if (error) { console.error('bbLoadFactoryItems:', error.message); factoryItemsDB = []; return; }
  factoryItemsDB = (data||[]).map(r => ({
    code: r.code, name: r.name, stock: parseFloat(r.stock)||0
  }));
}

function bbShowAllItems(section) {
  bbRenderItemDd(bbGetItems(section), '');
}

function bbFilterItems(section) {
  const q = document.getElementById('bb-search-input')?.value || '';
  bbRenderItemDd(bbGetItems(section), q);
}

function bbRenderItemDd(items, q) {
  const dd = document.getElementById('bb-search-dd');
  if (!dd) return;
  const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q.toLowerCase())) : items;
  if (!filtered.length) {
    dd.innerHTML = `<div style="padding:12px;text-align:center;font-size:11px;color:var(--ink4)">ไม่พบรายการ</div>`;
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = filtered.map(i => `
    <div onclick="bbSelectItem('${i.code}','${i.name.replace(/'/g,"\\'")}',${i.stock})"
      style="padding:8px 12px;cursor:pointer;border-bottom:0.5px solid var(--line);display:flex;align-items:center;justify-content:space-between"
      onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background=''">
      <span style="font-size:12px;font-weight:500">${i.name}</span>
      <span style="font-size:10px;color:var(--ink4)">คงเหลือ ${i.stock}</span>
    </div>`).join('');
  dd.style.display = 'block';
}

function bbSelectItem(code, name, stock) {
  document.getElementById('bb-search-input').value = name;
  document.getElementById('bb-search-dd').style.display = 'none';
  document.getElementById('bb-sel-code').value = code;
  document.getElementById('bb-sel-name').textContent = name;
  document.getElementById('bb-sel-stock').textContent = `คงเหลือ ${stock}`;
  document.getElementById('bb-selected-item').style.display = 'flex';
  // โหลด lot ถ้าเป็น product section
  const lotSection = document.getElementById('bb-lot-section');
  if (lotSection) {
    lotSection.style.display = 'flex';
    bbLoadProductLots(code);
  }
  document.getElementById('bb-item-qty').focus();
}

async function bbLoadProductLots(code) {
  const list = document.getElementById('bb-lot-list');
  if (!list) return;
  list.innerHTML = `<div style="padding:10px;text-align:center;font-size:11px;color:var(--ink4)"><i class="ti ti-loader"></i> กำลังโหลด...</div>`;
  const { data } = await sbFactory.from('lots')
    .select('id,lot_sw,lot_supplier,stock,bag_number,bag_total')
    .eq('item_code', code)
    .gt('stock', 0)
    .order('lot_sw', { ascending: true });
  if (!data || !data.length) {
    list.innerHTML = `<div style="padding:10px;text-align:center;font-size:11px;color:var(--ink4)">ไม่มี Lot ที่มีสต็อก</div>`;
    return;
  }
  list.innerHTML = data.map(l => {
    const sw = l.lot_sw ? new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '—';
    const bag = l.bag_number ? ` · ถุง ${l.bag_number}/${l.bag_total}` : '';
    return `<div onclick="bbSelectLot(${l.id},'${l.lot_sw||''}','${sw}',${l.stock})"
      style="padding:8px 12px;cursor:pointer;border-bottom:0.5px solid var(--line);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background=''">
      <div>
        <span style="font-size:12px;font-weight:500">Lot ${sw}${bag}</span>
      </div>
      <span style="font-size:11px;color:var(--ink4)">คงเหลือ ${l.stock}</span>
    </div>`;
  }).join('');
}

function bbSelectLot(id, sw, swLabel, stock) {
  document.getElementById('bb-sel-lot-id').value = id;
  document.getElementById('bb-sel-lot-sw').value = sw;
  // highlight selected
  document.querySelectorAll('#bb-lot-list div').forEach(d => d.style.background = '');
  event.currentTarget.style.background = 'var(--s2)';
  event.currentTarget.style.border = '1px solid var(--ink)';
  document.getElementById('bb-item-qty').focus();
  // แสดง lot ที่เลือก
  const lotSection = document.getElementById('bb-lot-section');
  if (lotSection) {
    const label = lotSection.querySelector('label');
    if (label) label.textContent = `Lot ที่เลือก: ${swLabel} · คงเหลือ ${stock}`;
  }
}

function bbClearItemSearch() {
  document.getElementById('bb-search-input').value = '';
  document.getElementById('bb-sel-code').value = '';
  document.getElementById('bb-selected-item').style.display = 'none';
  document.getElementById('bb-search-input').focus();
}

async function bbAddItem(borrowId, section) {
  const code   = document.getElementById('bb-sel-code')?.value;
  const name   = document.getElementById('bb-sel-name')?.textContent;
  const qty    = parseFloat(document.getElementById('bb-item-qty')?.value)||1;
  const lotId  = document.getElementById('bb-sel-lot-id')?.value || null;
  const lotSw  = document.getElementById('bb-sel-lot-sw')?.value || null;
  if (!name || name === '—') { showToast('กรุณาเลือกรายการ','err'); return; }
  if (section === 'product' && !lotId) { showToast('กรุณาเลือก Lot ก่อน','err'); return; }

  await sb.from('booth_borrow_items').insert({
    borrow_id: borrowId, section, item_code: code||null,
    item_name: name, qty_borrowed: qty, qty_returned: 0,
    lot_id: lotId ? parseInt(lotId) : null,
    lot_sw: lotSw || null,
  });
  document.getElementById('bb-add-modal')?.remove();
  await bbLoadBorrows();
  bbRender();
}

async function bbUpdateItem(itemId, field, value) {
  await sb.from('booth_borrow_items').update({ [field]: parseFloat(value)||0, updated_at: new Date().toISOString() }).eq('id', itemId);
  const item = bbBorrows.flatMap(b=>b.booth_borrow_items||[]).find(i=>i.id===itemId);
  if (item) item[field] = parseFloat(value)||0;
}

async function bbUpdateSectionMeta(borrowId, section, field, value) {
  await sb.from('booth_borrow_items')
    .update({ [field]: value||null })
    .eq('borrow_id', borrowId).eq('section', section);
}

async function bbDeleteItem(itemId, borrowId) {
  if (!confirm('ลบรายการนี้?')) return;
  await sb.from('booth_borrow_items').delete().eq('id', itemId);
  await bbLoadBorrows();
  bbRender();
}

async function bbDelete(borrowId) {
  if (!confirm('ลบรายการยืมนี้ทั้งหมด?')) return;
  await sb.from('booth_borrows').delete().eq('id', borrowId);
  await bbLoadBorrows();
  bbRender();
}

async function bbConfirmBorrowStore(borrowId) {
  const b = bbBorrows.find(x=>x.id===borrowId);
  if (!b) return;
  const items = (b.booth_borrow_items||[]).filter(i=>i.section==='store' && i.qty_borrowed>0);
  if (!items.length) { showToast('ไม่มีรายการอุปกรณ์สโตว์','err'); return; }
  if (!confirm(`หักสต็อกอุปกรณ์สโตว์ ${items.length} รายการ จากคลัง Tea House?`)) return;
  for (const item of items) {
    if (!item.item_code) continue;
    const m = masterDB.find(x=>x.code===item.item_code);
    if (!m) continue;
    const newStock = Math.max(0, m.stock - item.qty_borrowed);
    await sb.from('items').update({ stock: newStock }).eq('code', item.item_code);
    m.stock = newStock;
  }
  await sb.from('booth_borrows').update({ status:'active', updated_at: new Date().toISOString() }).eq('id', borrowId);
  showToast('หักสต็อกอุปกรณ์สโตว์เรียบร้อยค่ะ');
  await bbLoadBorrows(); bbRender();
}

async function bbConfirmReturnStore(borrowId) {
  const b = bbBorrows.find(x=>x.id===borrowId);
  if (!b) return;
  const items = (b.booth_borrow_items||[]).filter(i=>i.section==='store' && i.qty_returned>0);
  if (!items.length) { showToast('กรุณากรอกจำนวนที่คืน','err'); return; }
  if (!confirm(`บวกสต็อกอุปกรณ์สโตว์ ${items.length} รายการ กลับคลัง Tea House?`)) return;
  for (const item of items) {
    if (!item.item_code) continue;
    const m = masterDB.find(x=>x.code===item.item_code);
    if (!m) continue;
    const newStock = m.stock + item.qty_returned;
    await sb.from('items').update({ stock: newStock }).eq('code', item.item_code);
    m.stock = newStock;
  }
  const storeAllReturned = (b.booth_borrow_items||[]).filter(i=>i.section==='store')
    .every(i=>(i.qty_returned||0)>=(i.qty_borrowed||0));
  const productAllReturned = (b.booth_borrow_items||[]).filter(i=>i.section==='product')
    .every(i=>(i.qty_returned||0)>=(i.qty_borrowed||0));
  const newStatus = (storeAllReturned && productAllReturned) ? 'returned' : 'partial';
  await sb.from('booth_borrows').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', borrowId);
  showToast('บวกสต็อกอุปกรณ์สโตว์เรียบร้อยค่ะ');
  await bbLoadBorrows(); bbRender();
}

async function bbConfirmBorrowProduct(borrowId) {
  const b = bbBorrows.find(x=>x.id===borrowId);
  if (!b) return;
  const items = (b.booth_borrow_items||[]).filter(i=>i.section==='product' && i.qty_borrowed>0);
  if (!items.length) { showToast('ไม่มีรายการโปรดัก','err'); return; }
  if (!confirm(`หักสต็อกโปรดัก ${items.length} รายการ จากคลัง Factory (finish)?`)) return;
  for (const item of items) {
    if (!item.item_code) continue;
    if (item.lot_id) {
      // หักจาก lot โดยตรง
      const { data: lot } = await sbFactory.from('lots').select('stock').eq('id', item.lot_id).single();
      if (!lot) continue;
      const newLotStock = Math.max(0, lot.stock - item.qty_borrowed);
      await sbFactory.from('lots').update({ stock: newLotStock, updated_at: new Date().toISOString() }).eq('id', item.lot_id);
    }
    // หัก item stock
    const { data: fItem } = await sbFactory.from('items').select('code,stock').eq('code', item.item_code).single();
    if (!fItem) continue;
    const newStock = Math.max(0, fItem.stock - item.qty_borrowed);
    await sbFactory.from('items').update({ stock: newStock }).eq('code', item.item_code);
    await sbFactory.from('transactions').insert({
      item_code: item.item_code, item_name: item.item_name,
      pg: 'finish', action_type: 'withdraw', quantity: item.qty_borrowed,
      lot_id: item.lot_id || null, lot_sw: item.lot_sw || null,
      operator_name: b.borrower_name||'', note: `ยืม-บูธ Tea House: ${b.title}`,
      via: 'booth_borrow', old_stock: fItem.stock, new_stock: newStock,
    });
  }
  showToast('หักสต็อกโปรดักจาก Factory เรียบร้อยค่ะ');
  await bbLoadBorrows(); bbRender();
}

async function bbConfirmReturnProduct(borrowId) {
  const b = bbBorrows.find(x=>x.id===borrowId);
  if (!b) return;
  const items = (b.booth_borrow_items||[]).filter(i=>i.section==='product' && i.qty_returned>0);
  if (!items.length) { showToast('กรุณากรอกจำนวนที่คืน','err'); return; }
  if (!confirm(`บวกสต็อกโปรดัก ${items.length} รายการ กลับคลัง Factory (finish)?`)) return;
  for (const item of items) {
    if (!item.item_code) continue;
    if (item.lot_id) {
      // บวกกลับ lot โดยตรง
      const { data: lot } = await sbFactory.from('lots').select('stock').eq('id', item.lot_id).single();
      if (lot) {
        await sbFactory.from('lots').update({ stock: lot.stock + item.qty_returned, updated_at: new Date().toISOString() }).eq('id', item.lot_id);
      }
    }
    const { data: fItem } = await sbFactory.from('items').select('code,stock').eq('code', item.item_code).single();
    if (!fItem) continue;
    const newStock = fItem.stock + item.qty_returned;
    await sbFactory.from('items').update({ stock: newStock }).eq('code', item.item_code);
    await sbFactory.from('transactions').insert({
      item_code: item.item_code, item_name: item.item_name,
      pg: 'finish', action_type: 'receive', quantity: item.qty_returned,
      lot_id: item.lot_id || null, lot_sw: item.lot_sw || null,
      operator_name: item.receiver_name||b.borrower_name||'', note: `คืน-บูธ Tea House: ${b.title}`,
      via: 'booth_borrow', old_stock: fItem.stock, new_stock: newStock,
    });
  }
  showToast('บวกสต็อกโปรดักกลับ Factory เรียบร้อยค่ะ');
  // อัปเดต status เฉพาะเมื่อคืนครบทั้ง 2 ส่วน
  await bbLoadBorrows();
  const bUpdated = bbBorrows.find(x=>x.id===borrowId);
  if (bUpdated) {
    const storeAllReturned = (bUpdated.booth_borrow_items||[]).filter(i=>i.section==='store')
      .every(i=>(i.qty_returned||0)>=(i.qty_borrowed||0));
    const productAllReturned = (bUpdated.booth_borrow_items||[]).filter(i=>i.section==='product')
      .every(i=>(i.qty_returned||0)>=(i.qty_borrowed||0));
    const newStatus = (storeAllReturned && productAllReturned) ? 'returned' : 'partial';
    await sb.from('booth_borrows').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', borrowId);
    await bbLoadBorrows();
  }
  bbRender();
}




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
/* ── Purchase Tracking Status ── */
const PAY_STATUS_OPTS = {
  '':        { label:'— การชำระ —',     color:'var(--ink4)' },
  ordered:   { label:'จัดซื้อแล้ว',     color:'#5b8fe8' },
  waiting:   { label:'รอชำระเงิน',      color:'var(--warn)' },
  paid:      { label:'ชำระแล้ว',        color:'var(--green)' },
};
const SHIP_STATUS_OPTS = {
  '':        { label:'— การจัดส่ง —',   color:'var(--ink4)' },
  shipping:  { label:'กำลังจัดส่ง',     color:'#5b8fe8' },
  received:  { label:'ได้รับของแล้ว',   color:'#9b6fe8' },
  qc:        { label:'รอ QC',           color:'var(--warn)' },
  stocked:   { label:'รับเข้าคลังแล้ว', color:'var(--green)' },
};

async function setPurchaseTracking(code, field, value) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  m[field] = value || null;
  // ถ้ากด "รับเข้าคลังแล้ว" reset ทั้ง status และ tracking_url
  if (field === 'ship_status' && value === 'stocked') {
    m.pay_status   = null;
    m.ship_status  = null;
    m.tracking_url = null;
  }
  const { error } = await sb.from('items')
    .update({ pay_status: m.pay_status, ship_status: m.ship_status, tracking_url: m.tracking_url })
    .eq('code', code);
  if (error) { showToast('บันทึกไม่สำเร็จ', 'err'); return; }
  if (curPage.startsWith('alert-')) renderAlertGroupPage(curPage.replace('alert-', ''));
}

async function setTrackingUrl(code, url) {
  const m = masterDB.find(x => x.code === code);
  if (!m) return;
  m.tracking_url = url.trim() || null;
  await sb.from('items').update({ tracking_url: m.tracking_url }).eq('code', code);
}

function _trackingDropdowns(m) {
  const payVal  = m.pay_status  || '';
  const shipVal = m.ship_status || '';
  const payColor  = PAY_STATUS_OPTS[payVal]?.color  || 'var(--ink4)';
  const shipColor = SHIP_STATUS_OPTS[shipVal]?.color || 'var(--ink4)';
  const payOpts  = Object.entries(PAY_STATUS_OPTS).map(([v,o]) =>
    `<option value="${v}" ${payVal===v?'selected':''}>${o.label}</option>`).join('');
  const shipOpts = Object.entries(SHIP_STATUS_OPTS).map(([v,o]) =>
    `<option value="${v}" ${shipVal===v?'selected':''}>${o.label}</option>`).join('');
  const trackUrl = m.tracking_url || '';
  return `<div style="display:flex;flex-direction:column;gap:4px;min-width:160px">
    <select style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:${payColor};font-weight:500;cursor:pointer"
      onchange="setPurchaseTracking('${m.code}','pay_status',this.value)">
      ${payOpts}
    </select>
    <select style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:${shipColor};font-weight:500;cursor:pointer"
      onchange="setPurchaseTracking('${m.code}','ship_status',this.value)">
      ${shipOpts}
    </select>
    <div style="display:flex;gap:3px;align-items:center">
      <input type="url" placeholder="ลิงก์ Tracking..." value="${trackUrl}"
        style="font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface);flex:1;min-width:0"
        onchange="setTrackingUrl('${m.code}',this.value)"
        onblur="setTrackingUrl('${m.code}',this.value)">
      ${trackUrl ? `<a href="${trackUrl}" target="_blank" title="เปิดลิงก์ Tracking"
        style="color:var(--acc);font-size:14px;line-height:1;text-decoration:none"><i class="ti ti-external-link"></i></a>` : ''}
    </div>
  </div>`;
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
