/**
 * config.js — Factory
 * ตั้งค่าเฉพาะของแต่ละหน่วยงาน (Factory / Tea House)
 * ห้ามแก้ app.js หรือ index.html เพื่อเปลี่ยนค่าพวกนี้ — แก้ที่ไฟล์นี้ที่เดียว
 */
window.WMS_CONFIG = {
  SB_URL:  'https://rsmcrshvcbtcxvvhdmnk.supabase.co',
  SB_KEY:  'sb_publishable__RK27ReptMhtMdc8EdA-KQ_K4zfhMwJ',
  PREFIX:  'SWBD',
  SITE_NAME: 'Sawanbondin',
  SITE_SUB:  'ระบบจัดการคลัง (Factory)',

  // แจ้งเตือนแบ่ง 2 กลุ่ม: สั่งซื้อ (5 คลัง ไม่รวมสินค้าสำเร็จรูป/ชาตัวอย่าง) / แจ้งผลิต (สินค้าสำเร็จรูป)
  ALERT_GROUPS: {
    purchase: ['raw', 'matcha', 'pack', 'packaging', 'equip'],
    withdraw: ['raw', 'matcha', 'finish'],
  },

  // ชื่อหน้าแจ้งเตือนกลุ่ม withdraw (ค่า default คือ "รายการเบิก" — Factory override เป็น "รายการแจ้งผลิต")
  WITHDRAW_ALERT_LABEL: 'รายการแจ้งผลิต',

  // แสดงช่องผู้จำหน่าย/วันที่ส่งของรอบถัดไป ในฟอร์มตั้งค่า Min/Max — 'date' = แบบเลือกวันที่จริง
  SUPPLIER_FIELDS: 'date',
};
