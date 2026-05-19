/**
 * data.js — Sawanbondin Warehouse
 * ข้อมูล seed สำหรับ import ครั้งแรกเท่านั้น
 * หลังจาก import แล้ว ข้อมูลจะอยู่ใน Supabase ทั้งหมด
 * ไม่ต้องแก้ไขไฟล์นี้เพื่อเพิ่มสินค้าในอนาคต — ใช้หน้า Master แทน
 */

const SEED_DATA = {
  raw: {
    prefix: 'RM',
    subcats: {
      PD: ['ชานมเขียวมะลิ','ชานมปู่หมื่น','ชานมหอมนวล','ผงชากระเจี๊ยบ','ผงชาเก๊กฮวย','ผงชาเจียวกู่หลาน','ผงชาตะไคร้','ผงชามะตูม','ชาอัญชัน','ผงนมธัญพีช','ผงชาภาวนา','ผงชานมัสการ','ฝางผง','ชะเอมผง','ผงธัญพีชรสจืด','Fos','Coconut Cream','Dry Malt','Innulin','Maltodextrin','Sea Holly'],
      RW: ['ฝางบดหยาบ','ฝางแท่ง','ดอกเก๊กฮวย (เชียงใหม่)','มะตูม','ตะไคร้ (เพชรบุรี)','เจียวกู่หลาน (เชียงราย)','ชะเอมแผ่น','พุทราจีน','พุดจีน','พีชฟรีสดราย','แอบเปิ้ลฟรีสดราย','Ginger','ทุเรียนฟรีสดราย','มะพร้าวฟรีสดราย','Organic hom Ubon brown Rice','Organic hom Ubon black Rice','ข้าวญี่ปุ่น ออร์แกนิค','ข้าวคั่วญี่ปุ่นออร์แกนิค','Rai Dawk Kha Rice','Cacao nibs','ผิวส้มยูสุ ญี่ปุ่น','ขิงแห้ง (หัวเฉียว)','เก๊ากี๊แห้ง (หัวเฉียว)','พุทราจีนแห้ง (หัวเฉียว)','ฉาวไปจู๋แห้ง (หัวเฉียว)','เหลียนเซี่ยว (หัวเฉียว)','ดอกคำฝอย (หัวเฉียว)','ดอกกุหลาบ (หัวเฉียว)','ชะเอมเทศ (หัวเฉียว)','ข้าวบาร์เลย์ (หัวเฉียว)','ตังกุย (หัวเฉียว)','สู่ตี้หวง (หัวเฉียว)'],
      FW: ['ดอกเก๊กฮวย (swbd)','ดอกเก๊กฮวย เมลลาร์ด','ดอกกระเจี๊ยบ (เพชรบุรี)','ดอกกระเจี๊ยบ บ่มส้ม','ดอกอัญชัน (เพชรบุรี)','อัญชัน เมลลาร์ด','อัญชัน บ่ม Peppermint oil','ดอกคาโมมายล์ (เชียงใหม่)','ดอกหอมหมื่นลี้ (เชียงใหม่)','ดอกคำฝอย','ดอกมะลิ','ดอกบัวแดง','Negkassar','Elder flower','Saffron','ลาเวนเดอร์'],
      LL: ['ใบเตย (เพชรบุรี)','ใบเตย เมลลาร์ด','หญ้าหวาน (เชียงใหม่)','Mulberry leaves','Mulberry leaves Hojicha','White Mugwort','Indian Borage','ใบหม่อนโฮจิฉะ บ่มน้ำมันผิวส้ม','ชาดำอัสสัมปู่หมื่น เกรด B','ดอกลาเวนเดอร์ บ่มน้ำมันเบอร์กามอต','ชาดำ บ่มราซเบอรี่','จินเซียนโชคจำเริญ บ่มไวท์พีช','ชาดำ บ่มน้ำมะพร้าว','ทับทิมสยาม บ่มมะม่วง','ชาดำ บ่มทุเรียน','ชาดำ บ่มวนิลา (01)','สยามจัสมิน','ชาเขียวคั่วอัสสัมโชคจำเริญ','ชาดำ อัสสัม โชคจำเริญ เกรด B','อู่หลงจินเซียน เกรด B','ชาทับทิม เกรด B','ชาขาว อัสสัม โชคจำเริญ','ตงฟางหง','Hom Khao Green Tea','ชานางงาม Oriental Beauty 2025'],
    }
  },
  matcha: {
    prefix: 'MC',
    subcats: {
      MC: ['Yame Standard 110','Yame Upper 170','Uji 180','Uji Upper 250','Kagoshima','Oriental Beauty','Golden Tips','Mae ai','Hin Lad Nai','Baking Oolong','Black Tea White Peach','Siam Jasmine','Siam Earl Grey']
    }
  },
  pack: {
    prefix: 'PK',
    subcats: {
      'ฟอยล์ | ถุง': ['ฟอยล์เงินเล็ก 7x10 cm','ฟอยล์ขาวเล็ก 9x10 cm','ฟอยล์เงินกลาง 11x16 cm','ถุงซิปล็อค ฟอยล์เงิน 10x15 cm','ถุงซิปล็อค ฟอยล์เงิน ตั้งได้ 10x15 cm','ฟอยล์เงินใหญ่ 23.5x54.5 cm','ถุงใส่เมล็ดกาแฟ ตั้งได้ 13.5x26.5+7.5cm','ถุงใส่เมล็ดกาแฟ ตั้งได้ 15x32.5+10cm','ซองซีล 3 ด้าน สีดำ 9x13 ซม.','ถุงซิปล็อคดำใหญ่ ชาผง 100 กรัม','ห่อเล็ก 10 ซอง','ห่อใหญ่ 20 ซอง','ฟอยล์เงิน 20x30 cm','ฟอยล์เงิน 22x29 cm'],
      'ซองสกรีน': ['สวนดอกไม้ — ซองสกรีน','ขนมไทย — ซองสกรีน 2 ด้าน','นมัสการ — ซองสกรีนด้านเดียว','นมัสการ — ซองสกรีน 2 ด้าน','เฮ้าส์ ออฟ เมจิก — ซองสกรีน','หอมข้าว — ซองสกรีนด้านเดียว','หอมข้าว — ซองสกรีนสองด้าน','อู่หลงจัสมิน — ซองสกรีนด้านเดียว','สยามจัสมิน — ซองสกรีน 2 ด้าน','สยามเอิร์ลเกรย์ — ซองสกรีน 2 ด้าน','สยามเบรคฟัส — ซองสกรีน 2 ด้าน','Black Tea & Cacao — ซองสกรีน 2 ด้าน','เอิร์ลเกรย์ — ซองสกรีนด้านเดียว'],
      'กล่อง': ['นมัสการ — กล่อง','ภาวนา — กล่อง','ขนมไทย TOP แบบ 5 ซอง — กล่อง','สวนดอกไม้ TOP แบบ 5 ซอง — กล่อง','กล่องคราฟเขียว','กล่องคราฟน้ำตาล'],
      'กระปุก': ['กระปุกชา 6 เหลี่ยม','กระปุกชา 4 เหลี่ยม'],
      'ตะกร้าสาน': ['ตะกร้าสานเล็ก','ตะกร้าสานใหญ่'],
      'เยื่อ': ['เยื่อไม่มีโลโก้ หน่วยละ 1,000 ชิ้น','เยื่อสวรรค์บนดิน หน่วยละ 3,000 ชิ้น','เยื่อ 10x12 cm','เยื่อคาเฟ่']
    }
  },
  packaging: { prefix: 'PA', subcats: {} },
  equip: {
    prefix: 'EQ',
    subcats: {
      'ถุงมือ & หมวก': ['ซาโตรี่ ถุงมือยางทางการแพทย์ ไม่มีแป้ง S (100 ชิ้น)','ซาโตรี่ ถุงมือยางทางการแพทย์ ไม่มีแป้ง M (100 ชิ้น)','ซาโตรี่ ถุงมือยางทางการแพทย์ ไม่มีแป้ง L (100 ชิ้น)','หมวกคลุมผมใช้แล้วทิ้ง (50 ชิ้น / ถุง)','หมวกคลุมผมสีดำ','หมวกคลุมผมสีขาว','หน้ากากอนามัย'],
      'ถุงพลาสติก': ['ถุงซิปล็อคใส 15x23 ซม.','ถุงซิปล็อคใส 25x38 ซม.','ถุงซิปล็อคใส 30x45 ซม.','ถุงร้อน 20x30 ซม.','ถุงร้อน 24x42 ซม.','ถุงขยะ 18x20 ซม.','ถุงขยะ 28x36 ซม.'],
      'กระดาษ & ทิชชู': ['กระดาษทิชชู (1 แพ็ค / 4 ห่อ)'],
      'กาว & หมึก': ['กาวร้อน (10 อัน / กล่อง)','กาว UHU','น้ำยาลบหมึก IMARK WL-150','ตลับหมึก BROTHER TN-1000','กาวสองหน้าแบบบาง 12 มม.','กาวสองหน้าแบบบาง 6 มม.'],
      'อะไหล่เครื่องจักร': ['สายพานฟันเฟือง 31.5','สายพานเทปล่อน 38.5','สายพานเทปล่อน 37.5']
    }
  },
  finish: {
    prefix: 'FG',
    subcats: {
      'Matcha': ['Yame Standard Fukuoka Matcha 20 g','Yame Standard Fukuoka Matcha 100 g','Yame Upper Fukuoka Matcha (High Firing) 20 g','Yame Upper Fukuoka Matcha (High Firing) 100 g','Matcha Okumidori Uji 20 g','Matcha Okumidori Uji 100 g','Matcha Okumidori Uji Upper 20 g','Matcha Okumidori Uji Upper 100 g','Matcha Kagoshima 20 g','Matcha Kagoshima 100 g'],
      'Finely Ground': ['Oriental Beauty Finely ground 20 g','Oriental Beauty Finely ground 100 g','Golden Tips (Assamica) Finely ground 20 g','Golden Tips (Assamica) Finely ground 100 g','Black Tea Mae Ai (Assamica) Finely ground 20 g','Black Tea Mae Ai (Assamica) Finely ground 100 g','Black Tea Hin Lad Nai (Assamica) Finely ground 20 g','Black Tea Hin Lad Nai (Assamica) Finely ground 100 g','Baking Oolong Finely ground 20 g','Baking Oolong Finely ground 100 g','Black Tea White Peach Finely ground 20 g','Black Tea White Peach Finely ground 100 g','Siam Jasmine Finely ground 20 g','Siam Jasmine Finely ground 100 g','Siam Earl Grey Finely ground 20 g','Siam Earl Grey Finely ground 100 g'],
      'ห่อเล็ก': ['ชาอัญชัน - ห่อเล็ก','ชาตะไคร้ - ห่อเล็ก','ชามะตูม - ห่อเล็ก','ชาเก๊กฮวย - ห่อเล็ก','เจียวกูหลาน - ห่อเล็ก','กระเจี๊ยบ - ห่อเล็ก'],
      'ห่อใหญ่': ['ชาอัญชัน - ห่อใหญ่','ชาตะไคร้ - ห่อใหญ่','ชามะตูม - ห่อใหญ่','ชาเก๊กฮวย - ห่อใหญ่','เจียวกูหลาน - ห่อใหญ่','กระเจี๊ยบ - ห่อใหญ่'],
      'กล่อง': ['Namaskar - กล่อง','Bhavana - กล่อง','We Care - กล่อง','Black Tea White Peach - กล่อง','Kanomthai - กล่อง','Kanomthai TOP - กล่อง','The Flower Garden - กล่อง','The Flower Garden TOP - กล่อง','House of Magic - กล่อง','Siam Breakfast - กล่อง','Siam Earl Grey - กล่อง','Siam Lady Grey - กล่อง','Siam Jasmine - กล่อง'],
      'กระปุก': ['Gold Prize - กระปุก','Mae Ai - กระปุก','Hom Khao Green Tea - กระปุก','Red Leaf Deep Forest - กระปุก','Oriental Beauty Less to Medium (SWBD) - กระปุก','Premium oriental beauty High Oxidation - กระปุก','Premium oriental beauty less Oxidation - กระปุก','Siam Earl Grey - กระปุก'],
      'ซองฟอยล์เงิน': ['ชาอัญชัน - ซองฟอยล์เงิน','ชาตะไคร้ - ซองฟอยล์เงิน','ชามะตูม - ซองฟอยล์เงิน','ชาเก๊กฮวย - ซองฟอยล์เงิน','ชาเจียวกู่หลาน - ซองฟอยล์เงิน','ชากระเจี๊ยบ - ซองฟอยล์เงิน','Namaskar - ซองฟอยล์เงิน','Bhavana - ซองฟอยล์เงิน'],
      'ซองสกรีน': ['Namaskar - ซองสกรีนด้านเดียว','Namaskar - ซองสกรีนหน้า-หลัง','Bhavana - ซองสกรีน','The Flower Garden - ซองสกรีน','Kanomthai - ซองสกรีน','House of Magic - ซองสกรีน','Hom Khao - ซองสกรีน','Siam Breakfast - ซองสกรีน','Siam Jasmine - ซองสกรีน','Siam Earl Grey - ซองสกรีน'],
      'ซองขาว': ['The Flower Garden - ซองขาว','Kanomthai - ซองขาว','House of Magic - ซองขาว','Black Tea White Peach - ซองขาว','Hom Khao - ซองขาว','Siam Breakfast - ซองขาว','Siam Jasmine - ซองขาว','Siam Earl Grey - ซองขาว','Siam Lady Grey - ซองขาว','Oolong White Grape - ซองขาว','Oolong Jasmine - ซองขาว']
    }
  }
};

/**
 * generateSeedRows() — แปลง SEED_DATA เป็น array พร้อม insert Supabase
 * ใช้ครั้งเดียวตอน import เท่านั้น
 */
function generateSeedRows() {
  const rows = [];
  for (const [pg, pgData] of Object.entries(SEED_DATA)) {
    const pfx = pgData.prefix;
    let seq = 1;
    for (const [subcat, items] of Object.entries(pgData.subcats)) {
      for (const name of items) {
        // รหัสใช้ _ แทน - เพื่อรองรับ barcode scanner ทุกชนิด
        const subPfx = pg === 'raw' ? subcat : pfx;
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
