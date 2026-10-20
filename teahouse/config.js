/**
 * config.js — Tea House
 * ตั้งค่าเฉพาะของ Tea House
 * ห้ามแก้ app.js หรือ index.html เพื่อเปลี่ยนค่าพวกนี้ — แก้ที่ไฟล์นี้ที่เดียว
 *
 * NOTE: ถ้ามี config.js อยู่แล้ว ให้ copy เฉพาะส่วน WAREHOUSE_CONFIG ไปใส่
 */
window.WMS_CONFIG = {
  // ใส่ SB_URL / SB_KEY ของ Tea House ถ้ามีค่าต่างจาก Factory
  // SB_URL: 'https://YOUR_TEA_HOUSE_PROJECT.supabase.co',
  // SB_KEY: 'YOUR_TEA_HOUSE_ANON_KEY',

  // Override WAREHOUSE_CONFIG เพื่อกำหนด lotSubcats สำหรับ finish
  // สินค้าสำเร็จรูปมี lot เฉพาะ subcat: Finely Ground, ซองขาว, ซองฟอยล์เงิน, ซองสกรีน
  WAREHOUSE_CONFIG: {
    raw:       { label:'วัตถุดิบ',          prefix:'RM',  hasLot:true,  lotSupplier:true,  rawFields:true,  depts:['ผลิต','คลัง'] },
    matcha:    { label:'ชาบดผงมัตจะ',       prefix:'MC',  hasLot:true,  lotSupplier:true,  rawFields:false, depts:['ผลิต','คลัง'] },
    pack:      { label:'บรรจุภัณฑ์ภายใน',    prefix:'PK',  hasLot:false, lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'] },
    packaging: { label:'บรรจุภัณฑ์ภายนอก',  prefix:'PA',  hasLot:false, lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'] },
    equip:     { label:'อุปกรณ์',           prefix:'EQ',  hasLot:false, lotSupplier:false, rawFields:false, depts:['ผลิต','คลัง','บรรจุ','Tea House'] },
    finish:    { label:'สินค้าสำเร็จรูป',  prefix:'FG',  hasLot:true,  lotSupplier:false, rawFields:false,
                 depts:['ผลิต','คลัง','บรรจุ','Tea House'],
                 lotSubcats:['Finely Ground','ซองขาว','ซองฟอยล์เงิน','ซองสกรีน'] },
    sample:    { label:'ชาตัวอย่าง',          prefix:'SA',  hasLot:true,  lotSupplier:true,  rawFields:false, hasExpiry:true, depts:['ผลิต','คลัง','Tea House'],
                 subcats:['OEM','RD','ชาประกวด'],
                 subPrefixes:{ OEM:'OEM', RD:'SWBD_RD', 'ชาประกวด':'TCT' } },
  },
};
