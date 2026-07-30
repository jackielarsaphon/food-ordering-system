# Sync `dataforscan1` → Supabase

ดึงข้อมูลพนักงานจาก Google Sheets ชีต **dataforscan1** มาเก็บที่ Supabase ตาราง `public.employees`
และอัปเดตอัตโนมัติทุกครั้งที่ชีตถูกแก้

```
dataforscan1 ──(onEdit / onChange trigger ≈ 1–5 วินาที)──► Apps Script ──(REST upsert)──► Supabase
      └───────────(time-driven ทุก 10 นาที = ตัวกันพลาด)───────────┘
```

## การจับคู่คอลัมน์

| ชีต (คอลัมน์) | Supabase | หมายเหตุ |
|---|---|---|
| A `EmployeeID` | `employee_id` | ว่างได้ (ในชีตว่างหลายแถว) |
| B `LID` | `lid` | **primary key** ห้ามว่าง / ห้ามซ้ำ |
| C `MR–MRS` | `title` | นาย / นาง / นางสาว / น.ส. |
| D `FirstName` | `first_name` | |
| E `LastName` | `last_name` | |
| F `position` | `position` | |
| G `department` | `department` | ปรับชื่อให้ตรงลิสต์ในแอปอัตโนมัติ |
| H `location` | `location` | เซโปน / เซกอง / หงสา / เวียงจันทน์ |
| I `company` | `company` | |
| J `Status` | `status` | Work / Off |
| – | `project` | คำนวณจาก `location` → `xepon` / `sekong` / `hongsa` / `vientiane` / `other` / `null` |
| – | `full_name` | `first_name + last_name` (คำนวณอัตโนมัติ) |
| – | `is_active` | `true` เมื่อ `Status = Work` (คำนวณอัตโนมัติ) |
| – | `sheet_row` | เลขแถวในชีต ไว้ debug |
| – | `synced_at` | เวลา sync ล่าสุด |

สลับลำดับคอลัมน์ในชีตได้ สคริปต์อ่านจากชื่อหัวคอลัมน์ ไม่ใช่ตำแหน่ง
ถ้าเพิ่มคอลัมน์ใหม่ในชีต ต้องเพิ่มใน `HEADER_MAP` + `TARGET_COLUMNS` และ `alter table` ด้วย ไม่งั้นจะถูกข้าม

## ขั้นตอนติดตั้ง

### 1. สร้างตารางใน Supabase
Dashboard → SQL Editor → วางเนื้อหา [`supabase/01_employees_schema.sql`](../supabase/01_employees_schema.sql) → Run

### 2. เอาคีย์จาก Supabase
Dashboard → Settings → API keys
- `Project URL` → เช่น `https://abcdefgh.supabase.co`
- คีย์ฝั่งเซิร์ฟเวอร์ = `secret` key (`sb_secret_...`) หรือ `service_role` key (JWT แบบเก่า) อันใดอันหนึ่ง
  → **ใช้แค่ใน Apps Script Script properties เท่านั้น ห้ามใส่ในไฟล์ `.env` ของโปรเจกต์นี้**
  (ตัวแปรที่ขึ้นต้น `VITE_` ถูก build ติดไปกับ JavaScript ที่ส่งให้เบราว์เซอร์ = ใครก็เปิดดูได้)
- ฝั่งเว็บ/React ใช้ `publishable` key (`sb_publishable_...`) หรือ `anon` key ซึ่งอ่านได้ตาม RLS เท่านั้น

### 3. ใส่โค้ดใน Apps Script
เปิดไฟล์ Google Sheets → Extensions → Apps Script → สร้างไฟล์ใหม่ชื่อ `SyncSupabase.gs` → วางเนื้อหา [`SyncSupabase.gs`](SyncSupabase.gs) → Save

### 4. ตั้งค่า Script properties
Apps Script → ⚙ Project Settings → Script properties → Add script property

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key |

### 5. ทดสอบตามลำดับ
รันจาก dropdown ด้านบนของ Apps Script Editor แล้วดูผลใน **Execution log**

| ลำดับ | ฟังก์ชัน | ผลที่ควรได้ |
|---|---|---|
| 1 | `testConnection` | ครั้งแรกจะให้กด Review permissions → Allow แล้วขึ้น `OK เชื่อมต่อได้` |
| 2 | `findDuplicateLids` | ควรขึ้น `ไม่มี LID ซ้ำ` — ถ้ามีซ้ำต้องแก้ในชีตก่อน |
| 3 | `syncSheetToSupabase` | `sync สำเร็จ: upsert N แถว` |
| 4 | `verifySync` | `ครบทุก LID` |
| 5 | `installTriggers` | `ติดตั้ง trigger แล้ว...` = เปิด auto-sync เรียบร้อย |

### 6. ทดสอบ auto-sync
แก้ชื่อคนใดคนหนึ่งในชีต รอ 5–10 วินาที แล้วเช็คใน Supabase Table Editor ว่าค่าเปลี่ยนตาม

## ข้อควรรู้

- **LID ต้องมีทุกแถวและห้ามซ้ำ** แถวที่ LID ว่างจะถูกข้าม (log บอกจำนวน) / LID ซ้ำจะเหลือแถวล่างสุด
- **ห้ามแก้ข้อมูลใน Supabase ด้วยมือ** เพราะรอบ sync ถัดไปจะเขียนทับกลับเป็นค่าในชีต
- **ลบแถวในชีต = ลบใน Supabase** (ควบคุมด้วย `CFG.deleteMissingRows`) ถ้าอยากเก็บประวัติไว้ ตั้งเป็น `false` แล้วใช้ `synced_at` เช็คว่าแถวไหนตกรอบ
- ต้องใช้ **installable trigger** (สร้างจาก `installTriggers`) — simple trigger ที่ชื่อ `onEdit(e)` เรียก `UrlFetchApp` ไม่ได้ จะเงียบและไม่ sync
- `onEdit` ไม่ยิงเมื่อชีตเปลี่ยนจากสูตร / IMPORTRANGE / API ภายนอก → จึงมี time-driven ทุก 10 นาทีเป็นตัวกันพลาด
- โควตาบัญชีฟรี: UrlFetch ~20,000 ครั้ง/วัน, trigger runtime 90 นาที/วัน — ชีตหลักร้อยถึงหลักพันแถวสบาย
- ถ้า trigger fail Google จะส่งอีเมลแจ้งเจ้าของสคริปต์ให้เอง

## ถ้ามีปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `401 Forbidden use of secret API key in browser` | คีย์แบบใหม่ `sb_secret_...` ถูกบล็อกเมื่อ User-Agent ขึ้นต้นด้วย `Mozilla/5.0` ซึ่ง Apps Script ส่งแบบนั้นเสมอและทับไม่ได้ → เปลี่ยนไปใช้ **legacy `service_role` key** (ขึ้นต้น `eyJ`) จาก Dashboard → Settings → API Keys → Legacy API keys ซึ่งไม่มีการตรวจนี้ |
| `ยังไม่ได้ตั้งค่า Script Property: SUPABASE_SERVICE_KEY` | ตั้งค่าใน UI แล้วลืมกดปุ่ม **Save script properties** / ชื่อ property พิมพ์ผิด → รัน `showConfig` เพื่อดูว่าบันทึกอะไรไว้จริง ถ้ายังไม่ได้ ให้ใช้ `setupProperties` ตั้งจากโค้ดแทน |
| `Supabase HTTP 401` | `SUPABASE_SERVICE_KEY` ผิด หรือใช้ anon key แทน service_role |
| `Supabase HTTP 404` | ยังไม่ได้รัน SQL สร้างตาราง หรือชื่อตารางใน `CFG.table` ไม่ตรง |
| `HTTP 400 ... no unique constraint` | ตาราง `employees` ไม่มี primary key บน `lid` — รัน SQL ใหม่ |
| `HTTP 400 All object keys must match` | เพิ่มคอลัมน์ใน `HEADER_MAP` แต่ลืมเพิ่มใน `TARGET_COLUMNS` |
| `ไม่พบคอลัมน์ LID` | หัวตารางไม่ได้อยู่แถว 1 → แก้ `CFG.headerRow` |
| แก้ชีตแล้วไม่ sync | ยังไม่ได้รัน `installTriggers` หรือแก้อยู่ในชีตอื่นที่ไม่ใช่ `dataforscan1` |
