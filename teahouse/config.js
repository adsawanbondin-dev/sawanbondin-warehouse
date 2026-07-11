/**
 * config.js — Tea House
 * ตั้งค่าเฉพาะของแต่ละหน่วยงาน (Factory / Tea House)
 * ห้ามแก้ app.js หรือ index.html เพื่อเปลี่ยนค่าพวกนี้ — แก้ที่ไฟล์นี้ที่เดียว
 */
window.WMS_CONFIG = {
  SB_URL:  'https://zdeasnvrntcakyccwlsq.supabase.co',
  SB_KEY:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkZWFzbnZybnRjYWt5Y2N3bHNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NTU5NzcsImV4cCI6MjA5NzUzMTk3N30.blvUX2UYOxv9OZvMDtLCzLjDmxNcsiXfwYYihQd076E',
  PREFIX:  'SWBD',
  SITE_NAME: 'Sawanbondin',
  SITE_SUB:  'ระบบจัดการคลัง (Tea House)',

  // รหัสสินค้าทุกคลังใช้รูปแบบเดียวกัน SWBD_TH_0001, 0002, ... รันต่อเนื่องไม่แยกตามคลัง
  UNIFIED_CODE: 'TH',

  // โครงสร้างคลังของ Tea House — แทนที่ WAREHOUSE_CONFIG เริ่มต้นของ Factory ทั้งก้อน
  WAREHOUSE_CONFIG: {
    finish:     { label:'คลังสินค้าสำเร็จรูป',     prefix:'TH', hasLot:true,  lotSupplier:false, rawFields:false, depts:['คลัง'], hasSpec:true },
    raw:        { label:'คลังวัตถุดิบ',             prefix:'TH', hasLot:true,  lotSupplier:false, rawFields:false, depts:['คลัง'], hasSpec:true },
    equip_th:   { label:'คลังอุปกรณ์ Tea House',   prefix:'TH', hasLot:false, lotSupplier:false, rawFields:false, depts:['คลัง'], hasSpec:true },
    store2:     { label:'Store 2',                  prefix:'TH', hasLot:true,  lotSupplier:false, rawFields:false, depts:['คลัง'], hasSpec:false, hasItemLot:true },
  },

  // แจ้งเตือนแบ่ง 2 กลุ่ม: สั่งซื้อ (วัตถุดิบ+อุปกรณ์ทั้ง2คลัง) / เบิก (สินค้าสำเร็จรูป)
  ALERT_GROUPS: {
    purchase: ['raw', 'equip_th'],
    withdraw: ['finish'],
  },

  // รายการสินค้าใน Store 2 ที่มี Lot (วันหมดอายุ)
  STORE2_LOT_ITEMS: [
    'ข้าว','น้ำผึ้ง','กาแฟ','ไอศครีม','นมคาร์เนชั่น',
    'วิปปิ้งครีม','นมเมจิ','นมโอ๊ต','เลม่อนเคิร์ต',
    'แอปเปิ้ล','บลูเบอรี่','แยมลูกม่อน',
  ],

  // แสดงช่องผู้จำหน่าย/วันที่ส่งของรอบถัดไป ในฟอร์มตั้งค่า Min/Max — 'date' = แบบเลือกวันที่จริง
  SUPPLIER_FIELDS: 'date',
};

