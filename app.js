/**
 * app.js — Sawanbondin Warehouse System
 * Logic ทั้งหมดแยกออกจาก HTML
 * 
 * เพิ่มสินค้า: ใช้หน้า Master → เพิ่มรายการ (ไม่ต้องแก้โค้ด)
 * เพิ่มคลัง: เพิ่มใน WAREHOUSE_CONFIG ด้านล่าง + เพิ่ม tab ใน index.html
 */

/* ══════════════════════════════════════
   CONFIG — แก้ได้ง่าย ไม่กระทบ logic
══════════════════════════════════════ */
const SB_URL = 'https://rsmcrshvcbtcxvvhdmnk.supabase.co';
const SB_KEY = 'sb_publishable__RK27ReptMhtMdc8EdA-KQ_K4zfhMwJ';
const PREFIX  = 'SWBD';

/** เพิ่มคลังใหม่ที่นี่ที่เดียว */
const WAREHOUSE_CONFIG = {
  raw:       { label: 'วัตถุดิบ',         prefix: 'RM', hasLot: true,  lotSupplier: true,  rawFields: true,  depts: ['ผลิต','คลัง'] },
  matcha:    { label: 'ชาบดผงมัตจะ',      prefix: 'MC', hasLot: true,  lotSupplier: true,  rawFields: false, depts: ['ผลิต','คลัง'] },
  pack:      { label: 'บรรจุภัณฑ์',       prefix: 'PK', hasLot: false, lotSupplier: false, rawFields: false, depts: ['ผลิต','คลัง','บรรจุ','Tea House'] },
  packaging: { label: 'Packaging',         prefix: 'PA', hasLot: false, lotSupplier: false, rawFields: false, depts: ['ผลิต','คลัง','บรรจุ','Tea House'] },
  equip:     { label: 'อุปกรณ์',          prefix: 'EQ', hasLot: false, lotSupplier: false, rawFields: false, depts: ['ผลิต','คลัง','บรรจุ','Tea House'] },
  finish:    { label: 'สินค้าสำเร็จรูป', prefix: 'FG', hasLot: true,  lotSupplier: false, rawFields: false, depts: ['ผลิต','คลัง','บรรจุ','Tea House'] },
};
const WAREHOUSE_PAGES = Object.keys(WAREHOUSE_CONFIG);

const ACTION_LABELS = { receive:'รับเข้า', withdraw:'เบิก', return_good:'คืนดี', return_bad:'คืนเสีย' };
const ACTION_BADGE  = { receive:'badge-receive', withdraw:'badge-withdraw', return_good:'badge-return-good', return_bad:'badge-return-bad' };
const DEPT_PILL_CLS = { 'ผลิต':'dept-prod', 'คลัง':'dept-ware', 'บรรจุ':'dept-pack', 'Tea House':'dept-tea' };

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
const sb = window.supabase.createClient(SB_URL, SB_KEY);

// masterDB: array of items loaded from Supabase (source of truth = DB)
let masterDB   = [];
let locationDB = {}; // { code: locationString } — from items.note
let lotDB      = {}; // { code: [{id,lot_sw,lot_supplier,stock}] }
let pendingDB  = []; // loaded from pending_items table
let batchDB    = {}; // { pg: [{item,code,qty,lotSW,...}] } — localStorage
let masterCatFilter = 'all';
let curPage    = 'master';
let currentQRPage = null;
let camScanner = null;
let lastCamCode = '';

WAREHOUSE_PAGES.forEach(pg => batchDB[pg] = []);

/* ══════════════════════════════════════
   CODE GENERATION — from DB sequence
══════════════════════════════════════ */
function buildCode(pg, subcat, seq) {
  const pfx = WAREHOUSE_CONFIG[pg].prefix;
  const n = String(seq).padStart(4, '0');
  if (pg === 'raw') return `${PREFIX}_RM_${subcat}_${n}`;
  return `${PREFIX}_${pfx}_${n}`;
}

/** หา seq ถัดไปสำหรับคลัง+subcat จาก masterDB */
function nextSeq(pg, subcat) {
  const matches = masterDB.filter(m => m.pg === pg && (pg === 'raw' ? m.subcat === subcat : true));
  if (!matches.length) return 1;
  const maxSeq = Math.max(...matches.map(m => m.seq || 0));
  return maxSeq + 1;
}

/* ══════════════════════════════════════
   SUPABASE — CRUD
══════════════════════════════════════ */
async function dbLoadItems() {
  const { data, error } = await sb.from('items')
    .select('code,name,pg,subcat,stock,min_stock,max_stock,note,seq')
    .order('seq', { ascending: true });
  if (error) { console.error('loadItems', error); return; }
  masterDB = (data || []).map(r => ({
    code: r.code, name: r.name, pg: r.pg || '', subcat: r.subcat || '',
    stock: parseFloat(r.stock) || 0,
    min: parseFloat(r.min_stock) || 0,
    max: parseFloat(r.max_stock) || 0,
    seq: r.seq || 0,
  }));
  data.forEach(r => { if (r.note) locationDB[r.code] = r.note; });
}

async function dbUpsertItem(m) {
  try {
    await sb.from('items').upsert({
      code: m.code, name: m.name, pg: m.pg, subcat: m.subcat || '',
      stock: m.stock, min_stock: m.min, max_stock: m.max,
      note: locationDB[m.code] || '', seq: m.seq || 0,
    }, { onConflict: 'code' });
  } catch(e) { console.warn('upsertItem', e); }
}

async function dbDeleteItem(code) {
  try { await sb.from('items').delete().eq('code', code); } catch(e) { console.warn(e); }
}

async function dbInsertTransaction(rec) {
  try {
    await sb.from('transactions').insert({
      item_code: rec.code, item_name: rec.item, pg: rec.pg,
      action_type: rec.type, quantity: rec.qty, unit: '',
      operator_name: rec.name, department: rec.dept,
      lot_sw: rec.lotSW || '', lot_supplier: rec.lotSP || '',
      note: rec.note || '', via: rec.via || 'manual',
    });
  } catch(e) { console.warn('insertTx', e); }
}

async function dbLoadTransactions(pg) {
  try {
    const { data, error } = await sb.from('transactions')
      .select('*').eq('pg', pg)
      .order('created_at', { ascending: false }).limit(60);
    if (error || !data) return;
    return data.map(r => ({
      time: new Date(r.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      type: r.action_type, typeLabel: ACTION_LABELS[r.action_type] || r.action_type,
      name: r.operator_name || '', dept: r.department || '',
      item: r.item_name, code: r.item_code,
      qty: parseFloat(r.quantity), lotSW: r.lot_sw || '-',
      pg: r.pg, via: r.via || 'manual',
    }));
  } catch(e) { console.warn(e); return []; }
}

// Pending
async function dbLoadPending() {
  try {
    const { data } = await sb.from('pending_items').select('*').order('created_at', { ascending: true });
    pendingDB = (data || []).map(r => ({ id: r.id, tempCode: r.temp_code, stock: parseFloat(r.stock) || 0, createdAt: r.created_at }));
  } catch(e) { console.warn(e); }
}
async function dbInsertPending(tempCode, stock) {
  const { data } = await sb.from('pending_items').insert({ temp_code: tempCode, stock }).select().single();
  return data;
}
async function dbDeletePending(id) {
  await sb.from('pending_items').delete().eq('id', id);
}

// Lots
async function dbLoadLotsForItem(code) {
  try {
    const { data } = await sb.from('lots').select('*').eq('item_code', code).order('lot_sw', { ascending: true });
    lotDB[code] = (data || []).map(r => ({ id: r.id, lot_sw: r.lot_sw, lot_supplier: r.lot_supplier || '', stock: parseFloat(r.stock) || 0 }));
  } catch(e) { console.warn(e); }
}
async function dbUpsertLot(code, name, lotSW, lotSP, qty, action) {
  if (!lotDB[code]) await dbLoadLotsForItem(code);
  const lots = lotDB[code] || [];
  if (action === 'receive' || action === 'return_good') {
    const existing = lots.find(l => l.lot_sw === lotSW);
    if (existing) {
      existing.stock += qty;
      await sb.from('lots').update({ stock: existing.stock }).eq('id', existing.id);
    } else {
      const { data } = await sb.from('lots').insert({ item_code: code, item_name: name, lot_sw: lotSW, lot_supplier: lotSP || null, stock: qty }).select().single();
      if (data) lots.push({ id: data.id, lot_sw: data.lot_sw, lot_supplier: data.lot_supplier || '', stock: qty });
    }
    lotDB[code] = lots;
  } else if (action === 'withdraw' || action === 'return_bad') {
    const lot = lots.find(l => l.lot_sw === lotSW);
    if (lot) {
      lot.stock = Math.max(0, lot.stock - qty);
      await sb.from('lots').update({ stock: lot.stock }).eq('id', lot.id);
    }
  }
}

/* ══════════════════════════════════════
   TRANSACTIONS STATE (in-memory history)
══════════════════════════════════════ */
const txState = {};
WAREHOUSE_PAGES.forEach(pg => txState[pg] = { action: 'receive', records: [] });

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function pad2(n) { return String(n).padStart(2, '0'); }
function timeNow() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dateToday() {
  const d = new Date();
  const m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()+543}`;
}

function stockStatus(m) {
  if (m.min <= 0 && m.max <= 0) return 'ok';
  if (m.stock <= 0) return 'out';
  if (m.stock <= m.min) return 'low';
  return 'ok';
}
function getAlertItems(pg) {
  return masterDB.filter(m => {
    if (pg && m.pg !== pg) return false;
    if (m.min <= 0 && m.max <= 0) return false;
    return m.stock <= m.min;
  });
}
function checkAlerts() {
  const dot = document.getElementById('alertDot');
  if (dot) dot.style.display = getAlertItems(null).length ? 'block' : 'none';
}

function showToast(msg, type = 'ok') {
  const bg = type === 'ok' ? '#2d6a4f' : '#7a2020';
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;background:${bg};color:#fff;padding:11px 16px;border-radius:9px;font-size:12px;z-index:9999;display:flex;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:320px`;
  t.innerHTML = `<i class="ti ti-${type==='ok'?'circle-check':'alert-circle'}" style="font-size:16px;flex-shrink:0"></i><span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }

/* ══════════════════════════════════════
   BATCH — persisted in localStorage
══════════════════════════════════════ */
function saveBatchLS() {
  try { localStorage.setItem('swbd_batch', JSON.stringify(batchDB)); } catch(e) {}
}
function loadBatchLS() {
  try {
    const s = localStorage.getItem('swbd_batch');
    if (s) { const b = JSON.parse(s); WAREHOUSE_PAGES.forEach(pg => { if (b[pg]) batchDB[pg] = b[pg]; }); }
  } catch(e) {}
}

/* ══════════════════════════════════════
   NAVIGATION
══════════════════════════════════════ */
function switchPage(p) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector(`[data-page="${p}"]`);
  if (navEl) navEl.classList.add('active');
  ['master', ...WAREHOUSE_PAGES].forEach(pg => {
    const el = document.getElementById('page-' + pg);
    if (el) el.className = pg === p ? 'page-visible' : 'page-hidden';
  });
  curPage = p;
  if (p === 'master') {
    renderMasterPage();
  } else {
    renderWarehousePage(p);
    dbLoadTransactions(p).then(recs => {
      if (recs) { txState[p].records = recs; renderHistory(p); }
    });
  }
}

/* ══════════════════════════════════════
   WAREHOUSE PAGE
══════════════════════════════════════ */
function renderWarehousePage(pg) {
  const cfg = WAREHOUSE_CONFIG[pg];
  const div = document.getElementById('page-' + pg);
  if (!div) return;
  const alerts = getAlertItems(pg);
  let alertHtml = '';
  if (alerts.length) {
    const chips = alerts.slice(0, 5).map(i => `<span class="alert-chip">${i.name} (${i.stock})</span>`).join('');
    const more = alerts.length > 5 ? `<span class="alert-chip">+${alerts.length-5}</span>` : '';
    alertHtml = `<div class="alert-bar"><i class="ti ti-alert-triangle"></i><div><div class="alert-bar-title">สต็อกต่ำ — ${cfg.label}</div><div class="alert-items">${chips}${more}</div></div></div>`;
  }
  const cols = txState[pg].records.length > 0 || true ? (cfg.hasLot ? 8 : 7) : 7;
  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">${cfg.label}</div><div class="page-sub">รับเข้า · เบิก · คืนดี · คืนเสีย</div></div>
      <div class="page-actions">
        <button class="cam-btn" onclick="openCamera('${pg}')"><i class="ti ti-camera"></i> กล้อง</button>
        <button class="qr-btn" onclick="openQR('${pg}')"><i class="ti ti-qrcode"></i> QR</button>
      </div>
    </div>
    ${alertHtml}
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
            <button class="btn btn-primary" onclick="submitBatch('${pg}')">
              <i class="ti ti-device-floppy"></i> บันทึกทั้งหมด
            </button>
          </div>
        </div>
      </div>
      <div class="wh-right">
        <div class="card">
          <div class="card-title">
            <div class="card-title-left">ประวัติรายการ <span class="mcount" id="${pg}-hcount">0</span></div>
          </div>
          <div class="hist-wrap">
            <table class="hist-table">
              <thead><tr>
                <th>เวลา</th><th>ประเภท</th><th>ผู้ทำรายการ</th>
                <th>แผนก</th><th>รายการ</th><th>รหัส</th><th>จำนวน</th>
                ${cfg.hasLot ? '<th>Lot SW</th>' : ''}
              </tr></thead>
              <tbody id="${pg}-hbody">
                <tr><td colspan="${cfg.hasLot?8:7}">
                  <div class="empty"><i class="ti ti-notes"></i><div class="empty-text">ยังไม่มีรายการ</div></div>
                </td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
  renderForm(pg);
  renderHistory(pg);
  renderBatchCard(pg);
}

/* ── FORM ── */
function renderForm(pg) {
  const cfg = WAREHOUSE_CONFIG[pg];
  const action = txState[pg].action;
  const isReceive = action === 'receive';
  const isRB = action === 'return_bad';
  const body = document.getElementById(pg + '-fbody');
  if (!body) return;

  const t = document.getElementById(pg + '-ftitle');
  const b = document.getElementById(pg + '-fbadge');
  if (t) t.textContent = `${ACTION_LABELS[action]} — ${cfg.label}`;
  if (b) { b.textContent = ACTION_LABELS[action]; b.className = 'badge ' + ACTION_BADGE[action]; }

  const deptOpts = cfg.depts.map(d =>
    `<label class="radio-opt" onclick="selRadio(this,'${pg}-dept')"><input type="radio"> ${d}</label>`
  ).join('');

  let h = '';
  if (isRB) h += `<div class="info-bar warn"><i class="ti ti-info-circle"></i> บันทึกในประวัติ — ไม่หักสต็อก</div>`;

  // Action select
  h += `<div class="action-select-wrap">
    <span class="action-select-label">ประเภท</span>
    <select class="action-select" id="${pg}-action-sel" onchange="changeAction('${pg}',this.value)">
      ${Object.entries(ACTION_LABELS).map(([v,l]) =>
        `<option value="${v}" ${action===v?'selected':''}>${l}</option>`
      ).join('')}
    </select>
    <i class="ti ti-chevron-down action-select-icon"></i>
  </div>`;

  // Name + dept
  h += `<div class="form-grid">
    <div class="fg"><label class="fl">ผู้ทำรายการ <span class="req">*</span></label>
      <input class="fi" id="${pg}-name" placeholder="ชื่อ-นามสกุล"></div>
    <div class="fg"><label class="fl">แผนก <span class="req">*</span></label>
      <div class="radio-grp" id="${pg}-dept">${deptOpts}</div></div>
  </div><div class="divider"></div>`;

  // Item + qty
  h += `<div class="form-grid">
    <div class="fg form-full"><label class="fl">รายการ <span class="req">*</span></label>
      <div class="item-wrap">
        <input class="item-input" id="${pg}-idisplay" placeholder="พิมพ์เพื่อค้นหา"
          oninput="ddFilter('${pg}',this.value)" onfocus="ddShow('${pg}')">
        <button class="item-btn" onclick="ddToggle('${pg}')">
          <i class="ti ti-chevron-down"></i></button>
        <div class="dd" id="${pg}-dd" style="display:none">
          <div class="dd-search">
            <input id="${pg}-dds" placeholder="ค้นหา..." oninput="ddListFilter('${pg}',this.value)">
          </div>
          <div id="${pg}-ddl"></div>
        </div>
      </div>
      <input type="hidden" id="${pg}-ival">
    </div>
    <div class="fg"><label class="fl">จำนวน <span class="req">*</span></label>
      <input class="fi" id="${pg}-qty" type="number" min="0" step="0.01" placeholder="0.00"></div>
  </div>`;

  // Lot fields
  if (cfg.hasLot) {
    h += '<div class="divider"></div>';
    if (!isReceive && pg === 'raw') {
      // เบิก/คืน raw: แสดง lot picker
      h += `<div class="fg">
        <label class="fl">Lot Sawanbondin <span class="req">*</span></label>
        <input class="fi" id="${pg}-lotsw" type="date" placeholder="เลือกจากรายการด้านล่าง">
        <div class="fhint">เลือก Lot ที่ต้องการ</div>
      </div>
      <div class="lot-select-wrap" id="${pg}-lot-picker">
        <div class="lot-select-label"><i class="ti ti-stack" style="font-size:10px"></i> Lot ที่มีอยู่</div>
        <div id="${pg}-lot-picker-list"><div class="lot-empty">เลือกรายการก่อนเพื่อดู Lot</div></div>
      </div>`;
    } else if (cfg.lotSupplier) {
      h += `<div class="lot-pair">
        <div class="fg"><label class="fl">Lot Sawanbondin${isReceive?' <span class="req">*</span>':''}</label>
          <input class="fi" id="${pg}-lotsw" type="date">
          <div class="fhint">วันที่รับเข้า Sawanbondin</div></div>
        <div class="fg"><label class="fl">Lot Supplier</label>
          <input class="fi" id="${pg}-lotsp" type="date">
          <div class="fhint">วันที่ผลิตของ Supplier</div></div>
      </div>`;
    } else {
      h += `<div class="lot-single">
        <div class="fg"><label class="fl">Lot Sawanbondin${isReceive?' <span class="req">*</span>':''}</label>
          <input class="fi" id="${pg}-lotsw" type="date">
          <div class="fhint">วันที่รับเข้า</div></div>
      </div>`;
    }
  }

  // Extra fields
  if (isReceive && cfg.rawFields) {
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
      <label class="fl">${isRB ? 'สาเหตุการคืนเสีย' : 'หมายเหตุ'}</label>
      <textarea class="fta" id="${pg}-note"
        placeholder="${isRB ? 'ระบุสาเหตุ...' : 'หมายเหตุเพิ่มเติม...'}"></textarea>
    </div>`;
  }

  // Location (receive only)
  if (isReceive) {
    h += `<div class="fg" style="margin-top:10px">
      <label class="fl"><i class="ti ti-map-pin" style="font-size:11px"></i> สถานที่จัดเก็บ</label>
      <input class="fi" id="${pg}-loc" placeholder="เช่น ชั้น A1, ห้องเย็น" autocomplete="off">
    </div>`;
  }

  h += `<div class="form-actions">
    <button class="btn" onclick="resetForm('${pg}')"><i class="ti ti-refresh"></i> ล้าง</button>
    <button class="btn" onclick="addToBatch('${pg}')"
      style="border-color:var(--acc-mid);color:var(--acc)">
      <i class="ti ti-circle-plus"></i> เพิ่มในรายการ</button>
    <button class="btn btn-primary" onclick="submitF('${pg}')">
      <i class="ti ti-device-floppy"></i> บันทึกทันที</button>
  </div>`;

  body.innerHTML = h;
  buildDDList(pg, '');
}

function changeAction(pg, action) {
  const sv = {
    name: document.getElementById(pg+'-name')?.value || '',
    ival: document.getElementById(pg+'-ival')?.value || '',
    idisp: document.getElementById(pg+'-idisplay')?.value || '',
    qty: document.getElementById(pg+'-qty')?.value || '',
    dept: document.querySelector('#'+pg+'-dept .sel')?.textContent?.trim() || '',
  };
  txState[pg].action = action;
  renderForm(pg);
  if (sv.name) { const el = document.getElementById(pg+'-name'); if(el) el.value = sv.name; }
  if (sv.ival) { const iv = document.getElementById(pg+'-ival'); if(iv) iv.value = sv.ival; }
  if (sv.idisp) { const di = document.getElementById(pg+'-idisplay'); if(di) di.value = sv.idisp; }
  if (sv.qty) { const qe = document.getElementById(pg+'-qty'); if(qe) qe.value = sv.qty; }
  if (sv.dept) {
    document.querySelectorAll('#'+pg+'-dept .radio-opt').forEach(o => {
      if (o.textContent.trim() === sv.dept) o.classList.add('sel');
    });
  }
}
function resetForm(pg) {
  const a = txState[pg].action;
  renderWarehousePage(pg);
  txState[pg].action = a;
  renderForm(pg);
}

/* ── DROPDOWN ── */
function buildDDList(pg, filter) {
  const l = document.getElementById(pg + '-ddl');
  if (!l) return;
  const filt = filter.toLowerCase();
  const items = masterDB.filter(m =>
    m.pg === pg && m.name.toLowerCase().includes(filt)
  );

  if (!items.length) {
    l.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--ink3)">ไม่พบรายการ</div>';
    return;
  }

  // Group by subcat
  const groups = {};
  items.forEach(m => {
    const g = m.subcat || '-';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  });

  let h = '';
  for (const [grp, grpItems] of Object.entries(groups)) {
    if (grp !== '-') h += `<div class="dd-grp-label">${grp}</div>`;
    grpItems.forEach(m => {
      const es = m.name.replace(/'/g, "\\'");
      h += `<div class="dd-item" onclick="selItem('${pg}','${es}')">
        <span>${m.name}</span>
        <span class="dd-code">${m.code}</span>
      </div>`;
    });
  }
  l.innerHTML = h;
}
function ddFilter(pg, v) {
  buildDDList(pg, v);
  document.getElementById(pg+'-dd')?.style && (document.getElementById(pg+'-dd').style.display='block');
  const iv = document.getElementById(pg+'-ival'); if(iv) iv.value='';
}
function ddListFilter(pg, v) { buildDDList(pg, v); }
function ddShow(pg) {
  buildDDList(pg, document.getElementById(pg+'-idisplay')?.value || '');
  const d = document.getElementById(pg+'-dd'); if(d) d.style.display='block';
}
function ddToggle(pg) {
  const d = document.getElementById(pg+'-dd'); if(!d) return;
  d.style.display = d.style.display==='none' ? 'block' : 'none';
  if (d.style.display==='block') ddShow(pg);
}
function selItem(pg, item) {
  const di = document.getElementById(pg+'-idisplay');
  const iv = document.getElementById(pg+'-ival');
  const dd = document.getElementById(pg+'-dd');
  if (di) di.value = item;
  if (iv) iv.value = item;
  if (dd) dd.style.display = 'none';
  const m = masterDB.find(x => x.name===item && x.pg===pg);
  if (m && locationDB[m.code]) {
    const locEl = document.getElementById(pg+'-loc');
    if (locEl) locEl.value = locationDB[m.code];
  }
  // Load lot picker for raw non-receive
  const pickerList = document.getElementById(pg+'-lot-picker-list');
  if (m && pickerList && pg==='raw') {
    pickerList.innerHTML = '<div class="lot-empty"><i class="ti ti-loader" style="animation:spin .8s linear infinite"></i> โหลด Lot...</div>';
    buildLotPickerHtml(m.code, pg).then(html => { pickerList.innerHTML = html; });
  }
}
document.addEventListener('click', function(e) {
  WAREHOUSE_PAGES.forEach(pg => {
    const dd = document.getElementById(pg+'-dd');
    const inp = document.getElementById(pg+'-idisplay');
    if (dd && inp && !dd.contains(e.target) && e.target!==inp && !e.target.closest('.item-btn'))
      dd.style.display = 'none';
  });
});
function selRadio(el, gid) {
  document.querySelectorAll('#'+gid+' .radio-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel');
}

/* ── LOT PICKER ── */
async function buildLotPickerHtml(code, pg) {
  await dbLoadLotsForItem(code);
  const lots = (lotDB[code] || []).filter(l => l.stock > 0);
  if (!lots.length) return '<div class="lot-empty">ยังไม่มี Lot ในระบบ</div>';
  return lots.map(l => {
    const d = l.lot_sw ? new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '?';
    return `<div class="lot-select-item" onclick="pickLot(this,'${pg}','${l.lot_sw}')" data-lot="${l.lot_sw}">
      <span class="lot-date">${d}</span>
      <span class="lot-sel-stock">คงเหลือ ${l.stock}</span>
    </div>`;
  }).join('');
}
function pickLot(el, pg, lotSW) {
  el.closest('.lot-select-wrap').querySelectorAll('.lot-select-item').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  const sw = document.getElementById(pg+'-lotsw');
  if (sw) sw.value = lotSW;
}

/* ── SUBMIT SINGLE ── */
async function submitF(pg) {
  const cfg = WAREHOUSE_CONFIG[pg];
  const name = (document.getElementById(pg+'-name')?.value||'').trim();
  const item = document.getElementById(pg+'-ival')?.value || document.getElementById(pg+'-idisplay')?.value?.trim() || '';
  const qty  = document.getElementById(pg+'-qty')?.value || '';
  const lotSW = cfg.hasLot ? (document.getElementById(pg+'-lotsw')?.value||'') : '';
  const lotSP = cfg.lotSupplier ? (document.getElementById(pg+'-lotsp')?.value||'') : '';
  const note  = document.getElementById(pg+'-note')?.value || document.getElementById(pg+'-improve')?.value || '';
  const loc   = (document.getElementById(pg+'-loc')?.value||'').trim();
  const action = txState[pg].action;

  if (!name) { alert('กรุณาระบุชื่อผู้ทำรายการ'); return; }
  if (!item) { alert('กรุณาเลือกรายการ'); return; }
  if (!qty || parseFloat(qty)<=0) { alert('กรุณาระบุจำนวน'); return; }
  const deptEl = document.querySelector('#'+pg+'-dept .sel');
  if (!deptEl) { alert('กรุณาเลือกแผนก'); return; }
  if (pg==='raw' && action!=='receive' && !lotSW) { alert('กรุณาเลือก Lot Sawanbondin'); return; }

  const dept = deptEl.textContent.trim();
  const q    = parseFloat(qty);
  const mi   = masterDB.find(m => m.name===item);
  const code = mi ? mi.code : '-';

  if (mi) {
    if (action==='receive'||action==='return_good') mi.stock += q;
    else if (action==='withdraw') mi.stock = Math.max(0, mi.stock-q);
    if (action==='receive' && loc) locationDB[code] = loc;
    await dbUpsertItem(mi);
    if (pg==='raw' && lotSW) await dbUpsertLot(code, item, lotSW, lotSP, q, action);
  }

  const rec = { time:timeNow(), type:action, typeLabel:ACTION_LABELS[action], name, dept, item, code, qty:q, lotSW:lotSW||'-', lotSP, note, pg, via:'manual' };
  txState[pg].records.unshift(rec);
  await dbInsertTransaction(rec);
  checkAlerts();
  renderHistory(pg);
  const a = action; resetForm(pg); txState[pg].action = a;
  showToast(`"${item}" ${q} — ${ACTION_LABELS[action]}`);
}

/* ── BATCH ── */
function addToBatch(pg) {
  const cfg = WAREHOUSE_CONFIG[pg];
  const item = document.getElementById(pg+'-ival')?.value || document.getElementById(pg+'-idisplay')?.value?.trim() || '';
  const qty  = parseFloat(document.getElementById(pg+'-qty')?.value||0);
  const lotSW = cfg.hasLot ? (document.getElementById(pg+'-lotsw')?.value||'') : '';
  const lotSP = cfg.lotSupplier ? (document.getElementById(pg+'-lotsp')?.value||'') : '';
  const note  = document.getElementById(pg+'-note')?.value || document.getElementById(pg+'-improve')?.value || '';
  const loc   = (document.getElementById(pg+'-loc')?.value||'').trim();
  const action = txState[pg].action;

  if (!item) { alert('กรุณาเลือกรายการ'); return; }
  if (!qty||qty<=0) { alert('กรุณาระบุจำนวน'); return; }
  if (pg==='raw' && action!=='receive' && !lotSW) { alert('กรุณาเลือก Lot Sawanbondin'); return; }

  const mi = masterDB.find(m => m.name===item);
  batchDB[pg].push({ item, code:mi?mi.code:'-', qty, lotSW, lotSP, note, loc, action, typeLabel:ACTION_LABELS[action] });
  saveBatchLS();
  renderBatchCard(pg);
  const di = document.getElementById(pg+'-idisplay'); if(di) di.value='';
  const iv = document.getElementById(pg+'-ival');     if(iv) iv.value='';
  const qe = document.getElementById(pg+'-qty');      if(qe) qe.value='';
}
function removeBatchRow(pg, idx) {
  batchDB[pg].splice(idx, 1);
  saveBatchLS();
  renderBatchCard(pg);
}
function clearBatch(pg) { batchDB[pg]=[]; saveBatchLS(); renderBatchCard(pg); }
function renderBatchCard(pg) {
  const card = document.getElementById(pg+'-batch-card');
  const list = document.getElementById(pg+'-batch-list');
  const cnt  = document.getElementById(pg+'-batch-count');
  if (!card||!list) return;
  const rows = batchDB[pg] || [];
  if (!rows.length) { card.style.display='none'; return; }
  card.style.display = 'block';
  if (cnt) cnt.textContent = rows.length;
  list.innerHTML = rows.map((r,i) => `
    <div class="batch-row">
      <div class="batch-row-name">${r.item}</div>
      <div class="batch-row-meta">${r.typeLabel} · ${r.qty}${r.lotSW&&r.lotSW!=='-'?' · '+r.lotSW:''}</div>
      <button class="batch-row-del" onclick="removeBatchRow('${pg}',${i})"><i class="ti ti-x"></i></button>
    </div>`).join('');
}
async function submitBatch(pg) {
  const rows = batchDB[pg];
  if (!rows.length) { alert('ยังไม่มีรายการ'); return; }
  const name = (document.getElementById(pg+'-name')?.value||'').trim();
  const deptEl = document.querySelector('#'+pg+'-dept .sel');
  if (!name) { alert('กรุณาระบุชื่อผู้ทำรายการ'); return; }
  if (!deptEl) { alert('กรุณาเลือกแผนก'); return; }
  const dept = deptEl.textContent.trim();
  for (const r of rows) {
    const mi = masterDB.find(m => m.name===r.item);
    const code = mi ? mi.code : r.code;
    if (mi) {
      if (r.action==='receive'||r.action==='return_good') mi.stock += r.qty;
      else if (r.action==='withdraw') mi.stock = Math.max(0, mi.stock-r.qty);
      if (r.action==='receive' && r.loc) locationDB[code] = r.loc;
      await dbUpsertItem(mi);
      if (pg==='raw' && r.lotSW && r.lotSW!=='-') await dbUpsertLot(code, r.item, r.lotSW, r.lotSP||'', r.qty, r.action);
    }
    const rec = { time:timeNow(), type:r.action, typeLabel:r.typeLabel, name, dept, item:r.item, code, qty:r.qty, lotSW:r.lotSW||'-', lotSP:r.lotSP||'', note:r.note||'', pg, via:'batch' };
    txState[pg].records.unshift(rec);
    await dbInsertTransaction(rec);
  }
  checkAlerts(); renderHistory(pg);
  const n = rows.length;
  batchDB[pg] = []; saveBatchLS(); renderBatchCard(pg);
  showToast(`บันทึก <strong>${n}</strong> รายการสำเร็จ`);
}

/* ── HISTORY ── */
function renderHistory(pg) {
  const cfg = WAREHOUSE_CONFIG[pg];
  const tb  = document.getElementById(pg+'-hbody');
  const hc  = document.getElementById(pg+'-hcount');
  if (!tb) return;
  const recs = txState[pg].records;
  if (hc) hc.textContent = recs.length;
  if (!recs.length) {
    tb.innerHTML = `<tr><td colspan="${cfg.hasLot?8:7}">
      <div class="empty"><i class="ti ti-notes"></i><div class="empty-text">ยังไม่มีรายการ</div></div>
    </td></tr>`;
    return;
  }
  tb.innerHTML = recs.slice(0,60).map(r => `
    <tr ${r.type==='return_bad'?'style="opacity:.75"':''}>
      <td>${r.time}</td>
      <td><span class="tbadge ${ACTION_BADGE[r.type]}">${r.typeLabel}</span></td>
      <td>${r.name}${r.via==='scan'||r.via==='camera'?'<span style="font-size:9px;color:var(--acc);margin-left:3px">scan</span>':r.via==='batch'?'<span style="font-size:9px;color:var(--grn);margin-left:3px">batch</span>':''}</td>
      <td><span class="dept-pill ${DEPT_PILL_CLS[r.dept]||''}">${r.dept}</span></td>
      <td title="${r.item}">${r.item}</td>
      <td style="font-family:monospace;font-size:10px;color:var(--acc)">${r.code}</td>
      <td>${r.qty}</td>
      ${cfg.hasLot ? `<td>${r.lotSW||'-'}</td>` : ''}
    </tr>`).join('');
}

/* ══════════════════════════════════════
   CAMERA
══════════════════════════════════════ */
function openCamera(pg) {
  currentQRPage = pg;
  lastCamCode = '';
  document.getElementById('camResult').textContent = 'พุ่งกล้องไปที่ QR หรือ Barcode';
  document.getElementById('camResult').className = 'cam-result';
  document.getElementById('camOverlay').classList.add('show');
  camScanner = new Html5Qrcode('cam-reader');
  camScanner.start({ facingMode:'environment' }, { fps:10, qrbox:{width:250,height:250} },
    code => {
      lastCamCode = code;
      const m = masterDB.find(x => x.code.toLowerCase()===code.toLowerCase());
      const res = document.getElementById('camResult');
      if (m) { res.className='cam-result ok'; res.textContent=`พบ: ${m.name} · สต็อก ${m.stock}`; }
      else   { res.className='cam-result err'; res.textContent=`ไม่พบรหัส "${code}"`; }
    }, () => {}
  ).catch(() => { document.getElementById('camResult').textContent='ไม่สามารถเปิดกล้องได้'; });
}
async function confirmCamScan() {
  if (!lastCamCode) { alert('ยังไม่ได้สแกน'); return; }
  const action = document.getElementById('camAction').value;
  const qty    = parseFloat(document.getElementById('camQty').value||1);
  if (!qty||qty<=0) { alert('กรุณาระบุจำนวน'); return; }
  const m = masterDB.find(x => x.code.toLowerCase()===lastCamCode.toLowerCase());
  if (!m) { alert('ไม่พบรหัสในระบบ'); return; }
  if (action==='receive'||action==='return_good') m.stock += qty;
  else if (action==='withdraw') m.stock = Math.max(0, m.stock-qty);
  await dbUpsertItem(m);
  const pg = m.pg;
  const rec = { time:timeNow(), type:action, typeLabel:ACTION_LABELS[action], name:'(กล้องสแกน)', dept:(WAREHOUSE_CONFIG[pg]?.depts||[''])[0], item:m.name, code:m.code, qty, lotSW:'-', pg, via:'camera' };
  txState[pg].records.unshift(rec);
  await dbInsertTransaction(rec);
  checkAlerts();
  if (currentQRPage===pg) renderHistory(pg);
  document.getElementById('camResult').className = 'cam-result ok';
  document.getElementById('camResult').textContent = `${ACTION_LABELS[action]} "${m.name}" ${qty} · สต็อก ${m.stock}`;
  lastCamCode=''; document.getElementById('camQty').value='1';
}
function closeCamera() {
  if (camScanner) { camScanner.stop().catch(()=>{}); camScanner=null; }
  document.getElementById('cam-reader').innerHTML = '';
  document.getElementById('camOverlay').classList.remove('show');
  lastCamCode='';
}

/* ══════════════════════════════════════
   QR SIDEBAR
══════════════════════════════════════ */
function openQR(pg) {
  currentQRPage = pg;
  document.getElementById('qrPanelTitle').textContent = `QR — ${WAREHOUSE_CONFIG[pg].label}`;
  document.getElementById('qr-scan-input').value = '';
  document.getElementById('qr-scan-qty').value = '1';
  document.getElementById('qr-scan-result').className = 'qr-result';
  document.getElementById('qrSidebar').classList.add('show');
  buildQRList(pg);
}
function closeQR() { document.getElementById('qrSidebar').classList.remove('show'); currentQRPage=null; }
function buildQRList(pg) {
  const list = document.getElementById('qrList');
  list.innerHTML = '';
  masterDB.filter(m => m.pg===pg).slice(0,50).forEach(m => {
    const row = document.createElement('div'); row.className='qr-list-item';
    const canvas = document.createElement('canvas'); canvas.style.cssText='width:56px;height:56px;flex-shrink:0';
    const info = document.createElement('div'); info.className='qr-list-info';
    info.innerHTML = `<div class="qr-list-name">${m.name}</div><div class="qr-list-code">${m.code}</div><div class="qr-list-stock">สต็อก: ${m.stock}</div>`;
    row.appendChild(canvas); row.appendChild(info); list.appendChild(row);
    try { new QRCode(canvas,{text:m.code,width:56,height:56,colorDark:'#1c1c1e',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M}); } catch(e){}
  });
}
async function doQRScan() {
  const code   = (document.getElementById('qr-scan-input').value||'').trim();
  const action = document.getElementById('qr-scan-action').value;
  const qty    = parseFloat(document.getElementById('qr-scan-qty').value||1);
  const res    = document.getElementById('qr-scan-result');
  if (!code) { res.className='qr-result err'; res.textContent='กรุณาสแกนหรือพิมพ์รหัส'; setTimeout(()=>res.className='qr-result',2500); return; }
  const m = masterDB.find(x => x.code.toLowerCase()===code.toLowerCase());
  if (!m) { res.className='qr-result err'; res.textContent=`ไม่พบรหัส "${code}"`; setTimeout(()=>res.className='qr-result',3000); return; }
  if (action==='receive'||action==='return_good') m.stock+=qty;
  else if (action==='withdraw') m.stock=Math.max(0,m.stock-qty);
  await dbUpsertItem(m);
  const pg = m.pg;
  const rec = { time:timeNow(), type:action, typeLabel:ACTION_LABELS[action], name:'(QR)', dept:(WAREHOUSE_CONFIG[pg]?.depts||[''])[0], item:m.name, code:m.code, qty, lotSW:'-', pg, via:'scan' };
  txState[pg].records.unshift(rec);
  await dbInsertTransaction(rec);
  checkAlerts(); if(currentQRPage===pg) renderHistory(pg);
  res.className='qr-result ok';
  res.textContent=`${ACTION_LABELS[action]} "${m.name}" ${qty} · สต็อก ${m.stock}`;
  document.getElementById('qr-scan-input').value=''; document.getElementById('qr-scan-qty').value='1';
  buildQRList(pg); setTimeout(()=>res.className='qr-result',4000);
}

/* ══════════════════════════════════════
   MASTER DATA PAGE
══════════════════════════════════════ */
function renderMasterPage() {
  const div = document.getElementById('page-master');
  if (!div) return;
  const alerts = getAlertItems(null);
  let alertHtml = '';
  if (alerts.length) {
    alertHtml = `<div class="alert-bar"><i class="ti ti-alert-triangle"></i><div>
      <div class="alert-bar-title">พบ ${alerts.length} รายการสต็อกต่ำ</div>
      <div class="alert-items">${alerts.slice(0,6).map(i=>`<span class="alert-chip">${i.name} (${i.stock})</span>`).join('')}${alerts.length>6?`<span class="alert-chip">+${alerts.length-6}</span>`:''}</div>
    </div></div>`;
  }
  const namingRows = Object.entries(WAREHOUSE_CONFIG).map(([pg, cfg]) => {
    if (pg==='raw') return ['PD','RW','FW','LL'].map(s=>`<div class="naming-rule">SWBD_RM_${s}_XXXX</div>`).join('');
    return `<div class="naming-rule">SWBD_${cfg.prefix}_XXXX</div>`;
  }).join('');

  div.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Master Data</div>
        <div class="page-sub">จัดการรายการ หมวดหมู่ และ QR Code</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="addPendingItem()"
          style="border-color:var(--warn-bdr);color:var(--warn)">
          <i class="ti ti-package-import"></i> รับสินค้ารอตั้งชื่อ</button>
        <button class="btn btn-primary btn-sm" onclick="showAddForm()">
          <i class="ti ti-plus"></i> เพิ่มรายการ</button>
      </div>
    </div>
    ${alertHtml}
    <div class="card" style="margin-bottom:11px">
      <div class="card-title"><div class="card-title-left"><i class="ti ti-hash"></i> รูปแบบรหัส</div></div>
      <div class="naming-grid">${namingRows}</div>
    </div>
    <div id="pendingSection"></div>
    <div class="card" style="margin-bottom:11px" id="addFormCard" style="display:none">
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
  renderPendingSection();
  renderMasterContent();
  buildAddForm();
}

function buildCatTabs() {
  const container = document.getElementById('masterCatTabs');
  if (!container) return;
  const tabs = [
    { key:'all', label:'ทั้งหมด' },
    ...WAREHOUSE_PAGES.map(pg => ({ key:pg, label:WAREHOUSE_CONFIG[pg].label })),
    { key:'alert', label:'<i class="ti ti-alert-triangle" style="font-size:10px"></i> แจ้งเตือน' },
  ];
  container.innerHTML = tabs.map(t =>
    `<div class="cat-tab ${t.key===masterCatFilter?'active':''}"
      onclick="setCatFilter('${t.key}',this)">${t.label}</div>`
  ).join('');
}
function setCatFilter(c, el) {
  masterCatFilter = c;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderMasterContent();
}

/* ── ADD FORM ── */
function buildAddForm() {
  const body = document.getElementById('addFormBody');
  if (!body) return;
  // Warehouse options
  let pgOpts = WAREHOUSE_PAGES.map(pg => {
    const cfg = WAREHOUSE_CONFIG[pg];
    const item = masterDB.filter(m=>m.pg===pg);
    const subcats = [...new Set(item.map(m=>m.subcat).filter(Boolean))];
    if (subcats.length) {
      return `<optgroup label="${cfg.label}">` +
        subcats.map(s=>`<option value="${pg}|${s}">${cfg.label} — ${s}</option>`).join('') +
        `<option value="${pg}|">— หมวดใหม่ใน ${cfg.label}</option></optgroup>`;
    }
    return `<option value="${pg}|">${cfg.label}</option>`;
  }).join('');

  body.innerHTML = `
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
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:9px;align-items:end">
      <div class="fg"><label class="fl">สต็อกเริ่มต้น</label>
        <input class="fi" id="new-stock" type="number" min="0" step="0.01" value="0"></div>
      <div class="fg"><label class="fl">Min</label>
        <input class="fi" id="new-min" type="number" min="0" step="0.01" placeholder="0"></div>
      <div class="fg"><label class="fl">Max</label>
        <input class="fi" id="new-max" type="number" min="0" step="0.01" placeholder="0"></div>
      <div class="fg"><label class="fl" style="opacity:0">-</label>
        <button class="btn btn-primary" onclick="addMasterItem()">
          <i class="ti ti-check"></i> บันทึก</button></div>
    </div>`;
}
function onNewCatChange() {
  const val = document.getElementById('new-cat')?.value || '';
  const [, subcat] = val.split('|');
  const row = document.getElementById('new-subcat-row');
  if (row) row.style.display = subcat==='' ? 'block' : 'none';
}
function showAddForm() {
  const card = document.getElementById('addFormCard');
  if (card) { card.style.display='block'; card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
}
function hideAddForm() {
  const card = document.getElementById('addFormCard');
  if (card) card.style.display='none';
}
async function addMasterItem() {
  const name  = (document.getElementById('new-name')?.value||'').trim();
  const catVal = document.getElementById('new-cat')?.value || '';
  const stock  = parseFloat(document.getElementById('new-stock')?.value||0)||0;
  const min    = parseFloat(document.getElementById('new-min')?.value||0)||0;
  const max    = parseFloat(document.getElementById('new-max')?.value||0)||0;
  if (!name)   { alert('กรุณาระบุชื่อรายการ'); return; }
  if (!catVal) { alert('กรุณาเลือกหมวดหมู่'); return; }
  const [pg, subcatRaw] = catVal.split('|');
  let subcat = subcatRaw;
  if (!subcat) {
    subcat = (document.getElementById('new-subcat-name')?.value||'').trim();
    if (!subcat) { alert('กรุณาระบุชื่อหมวดหมู่ใหม่'); return; }
  }
  const seq  = nextSeq(pg, subcat);
  const code = buildCode(pg, subcat, seq);
  const newItem = { code, name, pg, subcat, stock, min, max, seq };
  masterDB.push(newItem);
  await dbUpsertItem(newItem);
  checkAlerts();
  hideAddForm();
  buildAddForm(); // rebuild to include new subcat
  renderMasterContent();
  showToast(`เพิ่ม "${name}" (${code}) สำเร็จ`);
}

/* ── EDIT ── */
function editStock(code) {
  const m = masterDB.find(x=>x.code===code); if(!m) return;
  document.getElementById('editStockId').value = code;
  document.getElementById('editStockName').textContent = m.name;
  document.getElementById('editStockVal').value = m.stock;
  document.getElementById('editStockModal').classList.add('show');
}
async function saveEditStock() {
  const code = document.getElementById('editStockId').value;
  const val  = parseFloat(document.getElementById('editStockVal').value);
  if (isNaN(val)||val<0) { alert('กรุณาระบุตัวเลขที่ถูกต้อง'); return; }
  const m = masterDB.find(x=>x.code===code);
  if (m) { m.stock=val; await dbUpsertItem(m); }
  checkAlerts(); closeModal('editStockModal'); renderMasterContent();
}
function editMinMax(code) {
  const m = masterDB.find(x=>x.code===code); if(!m) return;
  document.getElementById('editMMId').value = code;
  document.getElementById('editMMName').textContent = m.name;
  document.getElementById('editMMMin').value = m.min;
  document.getElementById('editMMMax').value = m.max;
  document.getElementById('editMinMaxModal').classList.add('show');
}
async function saveEditMinMax() {
  const code = document.getElementById('editMMId').value;
  const mn   = parseFloat(document.getElementById('editMMMin').value);
  const mx   = parseFloat(document.getElementById('editMMMax').value);
  if (isNaN(mn)||isNaN(mx)) { alert('กรุณาระบุตัวเลขที่ถูกต้อง'); return; }
  const m = masterDB.find(x=>x.code===code);
  if (m) { m.min=mn; m.max=mx; await dbUpsertItem(m); }
  checkAlerts(); closeModal('editMinMaxModal'); renderMasterContent();
}
function editName(code) {
  const m = masterDB.find(x=>x.code===code); if(!m) return;
  document.getElementById('editNameId').value = code;
  document.getElementById('editNameVal').value = m.name;
  document.getElementById('editNameModal').classList.add('show');
}
async function saveEditName() {
  const code = document.getElementById('editNameId').value;
  const nm   = (document.getElementById('editNameVal').value||'').trim();
  if (!nm) { alert('กรุณาระบุชื่อ'); return; }
  const m = masterDB.find(x=>x.code===code);
  if (m) { m.name=nm; await dbUpsertItem(m); }
  closeModal('editNameModal'); renderMasterContent();
}
function editLoc(code) {
  const m = masterDB.find(x=>x.code===code); if(!m) return;
  document.getElementById('editLocId').value = code;
  document.getElementById('editLocName').textContent = m.name;
  document.getElementById('editLocVal').value = locationDB[code]||'';
  document.getElementById('editLocModal').classList.add('show');
}
async function saveEditLoc() {
  const code = document.getElementById('editLocId').value;
  const loc  = (document.getElementById('editLocVal').value||'').trim();
  locationDB[code] = loc;
  const m = masterDB.find(x=>x.code===code);
  if (m) await dbUpsertItem(m);
  closeModal('editLocModal'); renderMasterContent();
}
async function deleteMasterItem(code) {
  if (!confirm('ลบรายการนี้?')) return;
  masterDB = masterDB.filter(m => m.code!==code);
  delete locationDB[code];
  await dbDeleteItem(code);
  checkAlerts(); renderMasterContent();
}

/* ── MASTER CONTENT ── */
function renderMasterContent() {
  const search  = (document.getElementById('masterSearch')?.value||'').toLowerCase();
  const cat     = masterCatFilter;
  const content = document.getElementById('masterContent');
  if (!content) return;

  function itemRowHtml(m) {
    const st  = stockStatus(m);
    const pct = m.max>0 ? Math.min(100,Math.round(m.stock/m.max*100)) : 0;
    const fC  = st==='out'?'fill-out':st==='low'?'fill-low':'fill-ok';
    const sC  = st==='out'?'si-out':st==='low'?'si-low':'si-ok';
    const sL  = st==='out'?'หมด':st==='low'?'ต่ำ':'ปกติ';
    const sI  = st==='out'?'ti-circle-x':st==='low'?'ti-alert-triangle':'ti-check';
    const cls = st==='out'?'out-stock':st==='low'?'low-stock':'';
    const loc = locationDB[m.code]||'';
    const lots = m.pg==='raw' ? (lotDB[m.code]||[]) : [];
    const lotSubHtml = lots.length
      ? lots.map(l=>{
          const d=l.lot_sw?new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'?';
          return `<div class="lot-sub-row"><span class="lot-date">${d}</span><span class="lot-stock-val">${l.stock}</span></div>`;
        }).join('')
      : '<div class="lot-empty">ยังไม่มี Lot</div>';

    return `<div class="item-row ${cls}">
      <div class="ir-main">
        <div class="ir-name" title="${m.name}">${m.name}</div>
        <div class="ir-code">${m.code}</div>
        <div class="ir-meta">
          <span class="ir-stock"><strong>${m.stock}</strong></span>
          ${(m.min>0||m.max>0)
            ? `<span class="ir-minmax">Min ${m.min} · Max ${m.max}</span>
               <span class="ir-si ${sC}"><i class="ti ${sI}" style="font-size:10px"></i> ${sL}</span>`
            : '<span class="ir-minmax" style="color:var(--ink4)">ยังไม่ตั้ง Min/Max</span>'}
        </div>
        ${(m.min>0||m.max>0)
          ? `<div class="stock-bar" style="width:80px;margin-top:4px">
               <div class="stock-bar-fill ${fC}" style="width:${pct}%"></div></div>` : ''}
        <div>
          <span class="loc-tag" onclick="editLoc('${m.code}')">
            <i class="ti ti-map-pin"></i>
            ${loc||'<span style="color:var(--ink4)">ยังไม่ระบุสถานที่</span>'}
          </span>
        </div>
        ${m.pg==='raw' ? `
        <div>
          <button class="lot-expand-btn" onclick="toggleLotSub('lot_sub_${m.code}','${m.code}')">
            <i class="ti ti-layers-subtract" style="font-size:11px"></i>
            Lot <span style="font-size:10px;color:var(--ink4)">(${lots.length})</span>
          </button>
          <div class="lot-sub-list" id="lot_sub_${m.code}" style="display:none">${lotSubHtml}</div>
        </div>` : ''}
      </div>
      <div class="ir-actions">
        <button class="icon-btn" onclick="editName('${m.code}')" title="แก้ไขชื่อ">
          <i class="ti ti-pencil"></i></button>
        <button class="icon-btn" onclick="editStock('${m.code}')" title="สต็อก">
          <i class="ti ti-edit"></i></button>
        <button class="icon-btn" onclick="editMinMax('${m.code}')" title="Min/Max">
          <i class="ti ti-adjustments-horizontal"></i></button>
        <button class="icon-btn danger" onclick="deleteMasterItem('${m.code}')" title="ลบ">
          <i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }

  function renderSection(items, label) {
    const filtered = items.filter(m => {
      if (search && !m.name.toLowerCase().includes(search) && !m.code.toLowerCase().includes(search)) return false;
      if (cat==='alert') return stockStatus(m)!=='ok' && (m.min>0||m.max>0);
      return true;
    });
    if (!filtered.length) return '';
    return `<div class="master-section">
      <div class="master-section-header">
        <div class="master-section-title">${label} <span class="mcount">${filtered.length}</span></div>
      </div>
      <div class="item-list">${filtered.map(itemRowHtml).join('')}</div>
    </div>`;
  }

  const showAll = cat==='all'||cat==='alert';
  let html = '';
  WAREHOUSE_PAGES.forEach(pg => {
    if (!showAll && cat!==pg) return;
    const cfg = WAREHOUSE_CONFIG[pg];
    const pgItems = masterDB.filter(m => m.pg===pg);
    const subcats = [...new Set(pgItems.map(m=>m.subcat||''))];
    subcats.forEach(sub => {
      const items = pgItems.filter(m=>(m.subcat||'')===sub);
      const label = sub ? `${cfg.label} — ${sub}` : cfg.label;
      html += renderSection(items, label);
    });
  });

  content.innerHTML = html ||
    '<div class="empty" style="padding:32px"><i class="ti ti-search"></i><div class="empty-text">ไม่พบรายการ</div></div>';
}

/* ── LOT EXPAND ── */
function toggleLotSub(subId, code) {
  const sub = document.getElementById(subId); if (!sub) return;
  const isOpen = sub.style.display !== 'none';
  if (isOpen) { sub.style.display='none'; return; }
  sub.style.display = 'block';
  if (!lotDB[code]) {
    sub.innerHTML = '<div class="lot-empty"><i class="ti ti-loader" style="animation:spin .8s linear infinite"></i> โหลด...</div>';
    dbLoadLotsForItem(code).then(() => {
      const lots = lotDB[code]||[];
      sub.innerHTML = lots.length
        ? lots.map(l=>{
            const d=l.lot_sw?new Date(l.lot_sw).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}):'?';
            return `<div class="lot-sub-row"><span class="lot-date">${d}</span><span class="lot-stock-val">${l.stock}</span></div>`;
          }).join('')
        : '<div class="lot-empty">ยังไม่มี Lot</div>';
    });
  }
}

/* ══════════════════════════════════════
   PENDING
══════════════════════════════════════ */
let pendingSeq = 1;
async function addPendingItem() {
  const qty = parseFloat(prompt('รับสินค้าใหม่ที่ยังไม่มีชื่อ — ระบุจำนวน:') || 0);
  if (!qty||qty<=0) return;
  const tempCode = `PENDING_${String(pendingSeq).padStart(3,'0')}`;
  pendingSeq++;
  const row = await dbInsertPending(tempCode, qty);
  if (row) pendingDB.push({ id:row.id, tempCode:row.temp_code, stock:parseFloat(row.stock)||qty, createdAt:row.created_at });
  renderPendingSection();
}
function renderPendingSection() {
  const sec = document.getElementById('pendingSection'); if(!sec) return;
  if (!pendingDB.length) { sec.innerHTML=''; return; }
  let rows = '';
  pendingDB.forEach(p => {
    const d = new Date(p.createdAt).toLocaleDateString('th-TH');
    rows += `<div class="pending-item-row">
      <div class="pi-info">
        <div class="pi-temp">${p.tempCode}</div>
        <div class="pi-stock">สต็อก: ${p.stock} · รับเข้า ${d}</div>
      </div>
      <div class="pi-actions">
        <button class="assign-btn" onclick="openAssignPending(${p.id})">
          <i class="ti ti-tag"></i> ตั้งชื่อ</button>
        <button class="icon-btn danger" onclick="deletePendingItem(${p.id})">
          <i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  });
  sec.innerHTML = `<div class="pending-card">
    <div class="card-title" style="border-bottom-color:var(--warn-bdr)">
      <div class="card-title-left">
        <i class="ti ti-clock-hour-4" style="color:var(--warn)"></i>
        สินค้ารอตั้งชื่อ <span class="pending-badge">${pendingDB.length} รายการ</span>
      </div>
    </div>
    <div style="font-size:11px;color:var(--warn);margin-bottom:9px;padding:6px 9px;background:#fff8ee;border-radius:var(--r);border:1px solid var(--warn-bdr)">
      <i class="ti ti-lock" style="font-size:11px"></i>
      รายการเหล่านี้ <strong>ไม่สามารถเบิก คืน</strong> ได้จนกว่าจะตั้งชื่อและจัดหมวดหมู่
    </div>
    ${rows}
  </div>`;
}
async function deletePendingItem(id) {
  if (!confirm('ลบรายการรอตั้งชื่อนี้?')) return;
  await dbDeletePending(id);
  pendingDB = pendingDB.filter(p=>p.id!==id);
  renderPendingSection();
}
function openAssignPending(id) {
  const p = pendingDB.find(x=>x.id===id); if(!p) return;
  document.getElementById('assignPendingId').value  = id;
  document.getElementById('assignPendingInfo').textContent = `${p.tempCode} · สต็อก ${p.stock}`;
  document.getElementById('assignPendingName').value = '';
  document.getElementById('assignPendingLoc').value  = '';
  // Build warehouse+subcat options from current masterDB
  const pgOpts = WAREHOUSE_PAGES.map(pg => {
    const cfg = WAREHOUSE_CONFIG[pg];
    const subcats = [...new Set(masterDB.filter(m=>m.pg===pg).map(m=>m.subcat).filter(Boolean))];
    const opts = subcats.map(s=>`<option value="${pg}|${s}">${cfg.label} — ${s}</option>`).join('');
    return `<optgroup label="${cfg.label}">${opts}<option value="${pg}|">— หมวดใหม่ใน ${cfg.label}</option></optgroup>`;
  }).join('');
  const sel = document.getElementById('assignPendingCat');
  if (sel) sel.innerHTML = '<option value="">-- เลือกคลัง --</option>' + pgOpts;
  document.getElementById('assignPendingModal').classList.add('show');
}
async function confirmAssignPending() {
  const id     = parseInt(document.getElementById('assignPendingId').value);
  const name   = (document.getElementById('assignPendingName').value||'').trim();
  const catVal = document.getElementById('assignPendingCat').value||'';
  const loc    = (document.getElementById('assignPendingLoc').value||'').trim();
  if (!name)   { alert('กรุณาระบุชื่อรายการ'); return; }
  if (!catVal) { alert('กรุณาเลือกหมวดหมู่'); return; }
  const p = pendingDB.find(x=>x.id===id); if(!p) return;
  const [pg, subcatRaw] = catVal.split('|');
  let subcat = subcatRaw;
  if (!subcat) {
    subcat = (document.getElementById('assignNewSubcat')?.value||'').trim();
    if (!subcat) { alert('กรุณาระบุชื่อหมวดหมู่ใหม่'); return; }
  }
  const seq  = nextSeq(pg, subcat);
  const code = buildCode(pg, subcat, seq);
  const newItem = { code, name, pg, subcat, stock:p.stock, min:0, max:0, seq };
  masterDB.push(newItem);
  if (loc) locationDB[code] = loc;
  await dbUpsertItem(newItem);
  await dbDeletePending(id);
  pendingDB = pendingDB.filter(x=>x.id!==id);
  closeModal('assignPendingModal');
  masterCatFilter = 'all';
  document.querySelectorAll('.cat-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim()==='ทั้งหมด');
  });
  renderPendingSection();
  renderMasterContent();
  buildAddForm();
  showToast(`ตั้งชื่อสำเร็จ! <strong>${name}</strong> (${code}) อยู่ในคลัง${WAREHOUSE_CONFIG[pg].label}`);
}

/* ══════════════════════════════════════
   BOOT — โหลดข้อมูลจาก Supabase ครั้งแรก
══════════════════════════════════════ */
async function boot() {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#1a1a1c;color:#fff;padding:9px 15px;border-radius:8px;font-size:12px;z-index:999;display:flex;align-items:center;gap:7px';
  banner.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> กำลังโหลดข้อมูล...';
  document.body.appendChild(banner);

  // 1. Load items from Supabase
  await dbLoadItems();

  // 2. If DB is empty → seed from data.js
  if (masterDB.length === 0 && typeof SEED_DATA !== 'undefined') {
    banner.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> กำลัง import ข้อมูลครั้งแรก...';
    const rows = generateSeedRows();
    // Insert in batches of 50
    for (let i=0; i<rows.length; i+=50) {
      const batch = rows.slice(i,i+50);
      await sb.from('items').upsert(batch, { onConflict:'code' });
    }
    await dbLoadItems(); // reload after seed
    banner.innerHTML = '<i class="ti ti-check"></i> import สำเร็จ ' + masterDB.length + ' รายการ';
    setTimeout(() => banner.remove(), 2000);
  } else {
    banner.remove();
  }

  // 3. Load pending
  await dbLoadPending();

  // 4. Preload lots for raw items
  try {
    const rawCodes = masterDB.filter(m=>m.pg==='raw').map(m=>m.code);
    if (rawCodes.length) {
      const { data } = await sb.from('lots').select('*').in('item_code', rawCodes).order('lot_sw',{ascending:true});
      if (data) {
        data.forEach(r => {
          if (!lotDB[r.item_code]) lotDB[r.item_code] = [];
          if (!lotDB[r.item_code].find(l=>l.id===r.id))
            lotDB[r.item_code].push({ id:r.id, lot_sw:r.lot_sw, lot_supplier:r.lot_supplier||'', stock:parseFloat(r.stock)||0 });
        });
      }
    }
  } catch(e) { console.warn(e); }

  // 5. Load batch from localStorage
  loadBatchLS();

  // 6. Initial render
  document.getElementById('topbarDate').textContent = dateToday();
  checkAlerts();
  WAREHOUSE_PAGES.forEach(pg => renderWarehousePage(pg));
  renderMasterPage();
  WAREHOUSE_PAGES.forEach(pg => renderBatchCard(pg));
}

// Start
boot();
