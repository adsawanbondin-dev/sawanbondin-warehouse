/**
 * data.js — Tea House Warehouse
 * เริ่มต้นแบบไม่มีสินค้า (เพิ่มสินค้าทีหลังผ่านหน้า Master)
 * ไฟล์นี้ใช้สำหรับ import ครั้งแรกเท่านั้น — หลัง import แล้วข้อมูลอยู่ใน Supabase ทั้งหมด
 */

const SEED_DATA = {
  raw:       { prefix: 'RM', subcats: {} },
  matcha:    { prefix: 'MC', subcats: {} },
  pack:      { prefix: 'PK', subcats: {} },
  packaging: { prefix: 'PA', subcats: {} },
  equip:     { prefix: 'EQ', subcats: {} },
  finish:    { prefix: 'FG', subcats: {} },
};

/**
 * generateSeedRows() — แปลง SEED_DATA เป็น array พร้อม insert Supabase
 * ใช้ครั้งเดียวตอน import เท่านั้น (ตอนนี้ว่างเปล่า เพิ่มสินค้าผ่านหน้า Master แทน)
 */
function generateSeedRows() {
  const rows = [];
  for (const [pg, pgData] of Object.entries(SEED_DATA)) {
    const pfx = pgData.prefix;
    let seq = 1;
    for (const [subcat, items] of Object.entries(pgData.subcats)) {
      for (const name of items) {
        const code = pg === 'raw'
          ? `SWBD_RM_${subcat}_${String(seq).padStart(4,'0')}`
          : `SWBD_${pfx}_${String(seq).padStart(4,'0')}`;
        rows.push({ code, name, pg, subcat, stock: 0, min_stock: 0, max_stock: 0, note: '', seq });
        seq++;
      }
    }
  }
  return rows;
}
