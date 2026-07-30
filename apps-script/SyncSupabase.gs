/**
 * ============================================================================
 * Sync Google Sheets "dataforscan1"  ->  Supabase table "public.employees"
 * ============================================================================
 * ทิศทางเดียว: ชีตเป็นต้นทางจริง (source of truth) / Supabase เป็นสำเนา
 *
 * ติดตั้ง 3 ขั้น (ทำครั้งเดียว):
 *   1. วางค่า SUPABASE_URL และ SUPABASE_SERVICE_KEY ใน SUPABASE_CONFIG ด้านล่าง
 *   2. รัน  testConnection        -> ครั้งแรกจะให้กดอนุญาตสิทธิ์ ต้องได้ "OK เชื่อมต่อได้"
 *   3. รัน  syncSheetToSupabase   -> sync รอบแรก
 *      รัน  installTriggers       -> เปิด sync อัตโนมัติ
 *
 * ตรวจสอบภายหลัง:  showConfig / verifySync / findDuplicateLids / listTriggers
 * ============================================================================
 */

/**
 * คีย์ Supabase
 *
 * สคริปต์จะอ่านจาก Script properties ก่อน ถ้าไม่มีจึงใช้ค่าที่วางไว้ตรงนี้
 * ไฟล์นี้รันบนเซิร์ฟเวอร์ Google เห็นได้เฉพาะคนที่มีสิทธิ์แก้ไฟล์ชีตนี้
 * (ไม่ถูกส่งไปเบราว์เซอร์ของผู้ใช้เหมือนไฟล์ .env ของเว็บ)
 *
 * ถ้าจะแชร์ชีตให้คนอื่นแก้ ให้ย้ายคีย์ไปไว้ใน Script properties แล้วล้างค่าตรงนี้เป็น ''
 */
const SUPABASE_CONFIG = {
  SUPABASE_URL: '',          // <-- วาง https://xxxxxxxx.supabase.co
  SUPABASE_SERVICE_KEY: '',  // <-- วาง secret key (sb_secret_... หรือ service_role)
}

const CFG = {
  sheetName: 'dataforscan1',   // ชื่อชีตต้นทาง
  table: 'employees',          // ตารางปลายทางใน Supabase
  conflictKey: 'lid',          // primary key ที่ใช้ upsert
  headerRow: 1,                // หัวตารางอยู่แถวที่เท่าไร
  chunkSize: 500,              // จำนวนแถวต่อ 1 request
  deleteMissingRows: true,     // true = ลบแถวใน Supabase ที่ถูกลบออกจากชีตแล้ว
  fallbackMinutes: 10,         // ตัวกันพลาด: sync ทั้งชีตทุก N นาที
}

/**
 * หัวคอลัมน์ในชีต -> ชื่อคอลัมน์ใน Supabase
 * key ทางซ้าย = หัวคอลัมน์ที่ normalize แล้ว (ตัวเล็ก + ตัด space/ขีด/จุด/วงเล็บทิ้ง)
 * อ่านจากชื่อหัวคอลัมน์ ไม่ใช่ตำแหน่ง -> สลับลำดับคอลัมน์ในชีตได้ ไม่พัง
 */
const HEADER_MAP = {
  employeeid: 'employee_id',
  lid: 'lid',
  mrmrs: 'title',          // "MR–MRS" (en dash) และ "MR-MRS" เข้าตัวนี้ทั้งคู่
  mrs: 'title',
  firstname: 'first_name',
  lastname: 'last_name',
  position: 'position',
  department: 'department',
  location: 'location',
  company: 'company',
  status: 'status',
}

/** คอลัมน์ที่ส่งเข้า Supabase — ทุกแถวต้องมีคีย์ครบชุดเท่ากัน ไม่งั้น PostgREST ปฏิเสธ */
const TARGET_COLUMNS = [
  'lid', 'employee_id', 'title', 'first_name', 'last_name', 'position',
  'department', 'location', 'company', 'status', 'project', 'sheet_row',
  'synced_at', 'updated_at',
  'deleted_at',   // ส่งค่า null ทุกรอบ = คนที่กลับมาอยู่ในชีตจะถูกยกเลิกสถานะลบให้เอง
]

/** ชื่อแผนกมาตรฐาน — ให้ตรงกับ departments ใน src/App.jsx */
const DEPARTMENTS = [
  'Mechanical', 'Civil & Central Service', 'Warehouse', 'Operation', 'HR',
  'SHE', 'Camp', 'Accounting', 'Purchasing', 'Canteen', 'Project Coordination',
  'IT', 'Administration',
]

/* ============================ ฟังก์ชันหลัก ============================== */

function syncSheetToSupabase() {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(30 * 1000)) {
    console.log('มีรอบ sync อื่นกำลังทำงาน ข้ามรอบนี้ (รอบถัดไปจะเก็บให้ครบ)')
    return
  }

  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(CFG.sheetName)
    if (!sheet) throw new Error('ไม่พบชีตชื่อ "' + CFG.sheetName + '" ในไฟล์นี้')

    // getDisplayValues = ได้ข้อความตามที่เห็นในชีต -> LID ที่มีเลข 0 นำหน้าไม่หาย
    const values = sheet.getDataRange().getDisplayValues()
    if (values.length <= CFG.headerRow) {
      console.log('ชีตว่าง ไม่มีอะไรต้อง sync')
      return
    }

    const headers = values[CFG.headerRow - 1].map(normalizeHeader_)
    if (headers.indexOf('lid') === -1) {
      throw new Error('ไม่พบคอลัมน์ LID ในแถวที่ ' + CFG.headerRow
        + ' — หัวคอลัมน์ที่อ่านได้: ' + headers.join(', '))
    }

    const stamp = new Date().toISOString()
    const byLid = {}            // LID ซ้ำ -> เก็บแถวล่างสุด
    const duplicates = []
    let skippedNoLid = 0

    for (let i = CFG.headerRow; i < values.length; i++) {
      const sheetRow = i + 1
      const record = buildRecord_(headers, values[i], stamp, sheetRow)

      if (!record.lid) {
        if (values[i].some(function (cell) { return String(cell).trim() !== '' })) skippedNoLid++
        continue
      }
      if (byLid[record.lid]) {
        duplicates.push(record.lid + ' (แถว ' + byLid[record.lid].sheet_row + ' และ ' + sheetRow + ')')
      }
      byLid[record.lid] = record
    }

    const rows = Object.keys(byLid).map(function (lid) { return byLid[lid] })
    if (!rows.length) throw new Error('ไม่พบแถวที่มี LID เลย — ตรวจข้อมูลในคอลัมน์ LID')

    for (let i = 0; i < rows.length; i += CFG.chunkSize) {
      supabaseRequest_(CFG.table + '?on_conflict=' + CFG.conflictKey, {
        method: 'post',
        payload: JSON.stringify(rows.slice(i, i + CFG.chunkSize)),
      })
    }

    // แถวที่หายไปจากชีต = ทำเครื่องหมายว่าลบ (ไม่ลบจริง)
    // เพราะ app_users.lid ผูก foreign key อยู่กับ employees.lid — ลบจริงแล้วบัญชีผู้ใช้จะพัง
    let deleted = 0
    if (CFG.deleteMissingRows) {
      const response = supabaseRequest_(
        CFG.table + '?synced_at=lt.' + encodeURIComponent(stamp) + '&deleted_at=is.null',
        {
          method: 'patch',
          payload: JSON.stringify({ deleted_at: stamp }),
          headers: { Prefer: 'return=representation', Accept: 'application/json' },
        }
      )
      const body = response.getContentText()
      deleted = body ? (JSON.parse(body) || []).length : 0
    }

    console.log('sync สำเร็จ: upsert ' + rows.length + ' แถว, ทำเครื่องหมายลบ ' + deleted + ' แถว')
    if (skippedNoLid) console.warn('ข้าม ' + skippedNoLid + ' แถวเพราะ LID ว่าง')
    if (duplicates.length) console.warn('LID ซ้ำ (เก็บแถวล่างสุด): ' + duplicates.join(', '))
  } catch (error) {
    console.error('sync ไม่สำเร็จ: ' + error.message)
    throw error   // ให้ Google ส่งอีเมลแจ้งเตือนเมื่อ trigger ทำงานพลาด
  } finally {
    lock.releaseLock()
  }
}

/* =============================== Triggers =============================== */

/** รันมือครั้งเดียวเพื่อเปิด sync อัตโนมัติ */
function installTriggers() {
  const spreadsheet = SpreadsheetApp.getActive()
  const handlers = ['onSheetEdit', 'onSheetChange', 'syncSheetToSupabase']

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger)
  })

  // installable trigger เท่านั้นที่เรียก UrlFetchApp ได้
  // (simple trigger ที่ตั้งชื่อว่า onEdit(e) ใช้ไม่ได้ เพราะไม่มีสิทธิ์ออกอินเทอร์เน็ต)
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(spreadsheet).onEdit().create()
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(spreadsheet).onChange().create()
  ScriptApp.newTrigger('syncSheetToSupabase').timeBased().everyMinutes(CFG.fallbackMinutes).create()

  console.log('ติดตั้ง trigger แล้ว: onEdit + onChange + ทุก ' + CFG.fallbackMinutes + ' นาที')
  listTriggers()
}

/** ดูว่ามี trigger อะไรทำงานอยู่ */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers()
  if (!triggers.length) {
    console.warn('ยังไม่มี trigger เลย -> ต้องรัน installTriggers')
    return
  }
  triggers.forEach(function (trigger) {
    console.log('- ' + trigger.getHandlerFunction() + ' (' + trigger.getEventType() + ')')
  })
}

/** ปิด sync อัตโนมัติทั้งหมด */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers()
  triggers.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger) })
  console.log('ลบ trigger ทั้งหมด ' + triggers.length + ' ตัวแล้ว')
}

/** Google เรียกให้เองเมื่อมีการพิมพ์/แก้เซลล์ — ไม่ต้องรันเอง */
function onSheetEdit(e) {
  if (e && e.range && e.range.getSheet().getName() !== CFG.sheetName) return
  syncSheetToSupabase()
}

/** Google เรียกให้เองเมื่อแทรก/ลบแถว, sort, วางทับ — ไม่ต้องรันเอง */
function onSheetChange(e) {
  syncSheetToSupabase()
}

/* ============================= เครื่องมือตรวจสอบ ========================= */

/** เช็คว่าคีย์ครบและมาจากที่ไหน */
function showConfig() {
  const stored = PropertiesService.getScriptProperties().getProperties()
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
  let ready = true

  keys.forEach(function (key) {
    const fromProps = String(stored[key] || '').trim()
    const fromCode = String(SUPABASE_CONFIG[key] || '').trim()
    const value = fromProps || fromCode
    const source = fromProps ? 'Script properties' : (fromCode ? 'SUPABASE_CONFIG ในโค้ด' : '- ไม่พบ -')

    if (!value) ready = false
    console.log('[' + key + '] ' + (value ? maskValue_(value) : 'ยังไม่ได้ตั้งค่า') + '  <- ' + source)
  })

  console.log(ready ? 'ครบแล้ว พร้อมรัน testConnection'
    : 'ยังไม่ครบ -> วางค่าใน SUPABASE_CONFIG ที่หัวไฟล์นี้ แล้วกด Ctrl+S ก่อนรันอีกครั้ง')
}

/** เช็คว่าต่อ Supabase ได้และตารางมีอยู่จริง */
function testConnection() {
  const response = supabaseRequest_(CFG.table + '?select=lid&limit=1', {
    method: 'get',
    headers: { Accept: 'application/json' },
  })
  console.log('OK เชื่อมต่อได้ — ตาราง ' + CFG.table + ' ตอบกลับ: ' + response.getContentText())
}

/** เทียบ LID ในชีต กับใน Supabase */
function verifySync() {
  const sheetLids = readSheetLids_()
  const response = supabaseRequest_(CFG.table + '?select=lid&deleted_at=is.null', {
    method: 'get',
    headers: { Accept: 'application/json' },
  })
  const dbLids = JSON.parse(response.getContentText()).map(function (row) { return row.lid })

  const missing = Object.keys(sheetLids).filter(function (lid) { return dbLids.indexOf(lid) === -1 })
  const extra = dbLids.filter(function (lid) { return !sheetLids[lid] })

  console.log('ชีต ' + Object.keys(sheetLids).length + ' LID / Supabase ' + dbLids.length + ' LID')
  console.log(missing.length ? 'ยังไม่ขึ้น Supabase: ' + missing.join(', ') : 'ครบทุก LID')
  if (extra.length) console.warn('มีใน Supabase แต่ไม่มีในชีต: ' + extra.join(', '))
}

/**
 * ดูว่าไฟล์ Google Sheets นี้มีชีตอะไรบ้าง หัวคอลัมน์อะไร กี่แถว
 * ใช้ตอนย้ายข้อมูล user/order เดิมจากชีตมา Supabase
 */
function listSheets() {
  const spreadsheet = SpreadsheetApp.getActive()
  console.log('ไฟล์: ' + spreadsheet.getName())
  console.log('URL : ' + spreadsheet.getUrl())

  spreadsheet.getSheets().forEach(function (sheet) {
    const lastRow = sheet.getLastRow()
    const lastColumn = sheet.getLastColumn()
    const headers = lastRow > 0 && lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].join(' | ')
      : '(ว่าง)'
    console.log('\n[' + sheet.getName() + ']  ' + Math.max(0, lastRow - 1) + ' แถวข้อมูล')
    console.log('  หัวคอลัมน์: ' + headers)
  })
}

/** หา LID ซ้ำในชีต (LID ซ้ำ = ข้อมูลจะทับกันเหลือแถวเดียว) */
function findDuplicateLids() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CFG.sheetName)
  const values = sheet.getDataRange().getDisplayValues()
  const lidIndex = values[CFG.headerRow - 1].map(normalizeHeader_).indexOf('lid')
  const seen = {}
  const dupes = []

  for (let i = CFG.headerRow; i < values.length; i++) {
    const lid = String(values[i][lidIndex] || '').trim()
    if (!lid) continue
    if (seen[lid]) dupes.push('LID ' + lid + ' -> แถว ' + seen[lid] + ' และ ' + (i + 1))
    else seen[lid] = i + 1
  }
  console.log(dupes.length ? dupes.join('\n') : 'ไม่มี LID ซ้ำ')
}

/* ================================ ภายใน ================================= */

function config_(key) {
  const stored = PropertiesService.getScriptProperties().getProperty(key)
  const value = String(stored || SUPABASE_CONFIG[key] || '').trim()
  if (!value) {
    throw new Error('ยังไม่ได้ตั้งค่า ' + key
      + ' — วางค่าใน SUPABASE_CONFIG ที่หัวไฟล์ code.gs แล้วกด Ctrl+S ก่อนรัน')
  }
  return value
}

function supabaseRequest_(path, options) {
  const key = config_('SUPABASE_SERVICE_KEY')
  const url = config_('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/' + path

  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    Prefer: 'resolution=merge-duplicates,return=minimal',
    // Apps Script ส่ง User-Agent ขึ้นต้นด้วย "Mozilla/5.0" ซึ่ง Supabase มองว่าเป็นเบราว์เซอร์
    // แล้วบล็อกคีย์ sb_secret_ ทิ้ง -> พยายามทับด้วยชื่ออื่น (Google อาจไม่ยอมให้ทับ)
    'User-Agent': 'ThaidrillSheetSync/1.0',
  }
  const extraHeaders = (options && options.headers) || {}
  Object.keys(extraHeaders).forEach(function (name) { headers[name] = extraHeaders[name] })

  const response = UrlFetchApp.fetch(url, {
    method: (options && options.method) || 'get',
    contentType: 'application/json',
    payload: options && options.payload,
    headers: headers,
    muteHttpExceptions: true,
  })

  const code = response.getResponseCode()
  if (code >= 300) {
    const body = response.getContentText()
    if (code === 401 && body.indexOf('browser') !== -1) {
      throw new Error('Supabase ปฏิเสธคีย์ sb_secret_ เพราะ Apps Script ส่ง User-Agent แบบเบราว์เซอร์'
        + ' (Google ไม่ยอมให้ทับ User-Agent) -> ให้เปลี่ยนไปใช้ legacy service_role key ที่ขึ้นต้นด้วย eyJ'
        + ' จาก Dashboard > Settings > API Keys > Legacy API keys แล้ววางใน SUPABASE_CONFIG')
    }
    throw new Error('Supabase HTTP ' + code + ' : ' + body)
  }
  return response
}

function readSheetLids_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CFG.sheetName)
  const values = sheet.getDataRange().getDisplayValues()
  const lidIndex = values[CFG.headerRow - 1].map(normalizeHeader_).indexOf('lid')
  const lids = {}

  for (let i = CFG.headerRow; i < values.length; i++) {
    const lid = String(values[i][lidIndex] || '').trim()
    if (lid) lids[lid] = true
  }
  return lids
}

function normalizeHeader_(header) {
  return String(header).toLowerCase().replace(/[\s–—\-_.()]+/g, '').trim()
}

function buildRecord_(headers, row, stamp, sheetRow) {
  const record = {}
  TARGET_COLUMNS.forEach(function (column) { record[column] = null })

  headers.forEach(function (header, index) {
    const column = HEADER_MAP[header]
    if (!column) return                   // คอลัมน์ที่ไม่ได้ map = ข้าม
    const value = String(row[index] == null ? '' : row[index]).trim()
    record[column] = value === '' ? null : value
  })

  record.department = normalizeDepartment_(record.department)
  record.status = normalizeStatus_(record.status)
  record.project = projectFromLocation_(record.location)
  record.sheet_row = sheetRow
  record.synced_at = stamp
  record.updated_at = stamp
  return record
}

/** ให้ชื่อแผนกตรงกับที่ src/App.jsx ใช้ (กันช่องว่าง/ตัวพิมพ์ไม่ตรง) */
function normalizeDepartment_(value) {
  if (!value) return null
  const key = String(value).toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i < DEPARTMENTS.length; i++) {
    if (DEPARTMENTS[i].toLowerCase().replace(/\s+/g, '') === key) return DEPARTMENTS[i]
  }
  return String(value).trim()   // ชื่อที่ไม่รู้จัก -> เก็บตามต้นฉบับ
}

/** Work / Off ให้เป็นรูปเดียวกัน (is_active ใน Supabase คำนวณจากค่านี้) */
function normalizeStatus_(value) {
  if (!value) return null
  const key = String(value).trim().toLowerCase()
  if (key === 'work' || key === 'working' || key === 'ทำงาน') return 'Work'
  if (key === 'off' || key === 'offduty' || key === 'ลาออก' || key === 'หยุด') return 'Off'
  return String(value).trim()
}

/**
 * แปลง location -> project (ตรรกะเดียวกับ locationMatchesProject ใน src/App.jsx)
 *
 * สำคัญ: อย่ายกทุก location ที่ไม่ใช่เซกองไปเป็น xepon เพราะในชีตมี หงสา 320 คน,
 * เวียงจันทน์ 20 คน ซึ่งไม่ใช่คนโครงการเซโปน ถ้ารวมเข้าไปยอดหัวคนจะเกินจริง 447 คน
 */
function projectFromLocation_(location) {
  const normalized = String(location || '').trim().toLowerCase()
  if (!normalized) return null

  const has = function (words) {
    for (let i = 0; i < words.length; i++) {
      if (normalized.indexOf(words[i]) !== -1) return true
    }
    return false
  }

  if (has(['เซกอง', 'sekong', 'xekong'])) return 'sekong'
  if (has(['เชโปน', 'เซโปน', 'xepon', 'xapon'])) return 'xepon'
  if (has(['หงสา', 'hongsa'])) return 'hongsa'
  if (has(['เวียงจันทน์', 'vientiane'])) return 'vientiane'
  return 'other'
}

function maskValue_(value) {
  return value.length > 14
    ? value.slice(0, 8) + '…' + value.slice(-4) + ' (ยาว ' + value.length + ')'
    : value
}
