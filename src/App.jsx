import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UtensilsCrossed,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import {
  countEmployees,
  countEmployeesByDepartment,
  createDeliveryPoint as createDeliveryPointOnSupabase,
  deleteAppUser,
  deleteDeliveryPoint as deleteDeliveryPointOnSupabase,
  fetchAppUsers,
  fetchDeliveryPoints as fetchDeliveryPointsFromSupabase,
  fetchEmployees,
  fetchFoodOrders,
  loginUser as loginUserOnSupabase,
  renameDeliveryPoint as renameDeliveryPointOnSupabase,
  registerUser as registerUserOnSupabase,
  saveFoodOrders as saveFoodOrdersOnSupabase,
  supabaseConfigured,
} from './stores'

const STORAGE_KEY = 'xepon-food-orders-v1'
const SESSION_KEY = 'xepon-food-session-v1'
const USERS_KEY = 'xepon-food-users-v1'
const DELETED_DEMO_USERS_KEY = 'xepon-deleted-demo-users-v1'
const ORDER_QUEUE_KEY = 'thaidrill-food-order-queue-v1'
const EMPLOYEE_API_URL_KEY = 'thaidrill-employee-api-url-v1'
const VISIBLE_MEALS_KEY = 'thaidrill-visible-meals-v1'
const DELIVERY_POINTS_KEY = 'thaidrill-delivery-points-v1'

const configuredApiUrl = () => (import.meta.env.VITE_GOOGLE_SCRIPT_URL || localStorage.getItem(EMPLOYEE_API_URL_KEY) || '').trim()

const readApiJson = async (response) => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.status !== 'success') throw new Error(payload.message || 'Google Apps Script ส่งข้อมูลไม่ถูกต้อง')
  return payload
}

const getFromScript = async (action, parameters = {}) => {
  const sourceUrl = configuredApiUrl()
  if (!sourceUrl) throw new Error('ยังไม่ได้ตั้งค่า Google Apps Script Web App URL กรุณาให้ Admin ตั้งค่าในหน้า User')
  const endpoint = new URL(sourceUrl)
  endpoint.searchParams.set('action', action)
  Object.entries(parameters).forEach(([key, value]) => endpoint.searchParams.set(key, value))
  endpoint.searchParams.set('_', Date.now().toString())
  return readApiJson(await fetch(endpoint.toString(), { method: 'GET' }))
}

const postToScript = async (action, parameters = {}) => {
  const sourceUrl = configuredApiUrl()
  if (!sourceUrl) throw new Error('ยังไม่ได้ตั้งค่า Google Apps Script Web App URL กรุณาให้ Admin ตั้งค่าในหน้า User')
  const body = new URLSearchParams({ action, ...parameters })
  return readApiJson(await fetch(sourceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  }))
}

/**
 * อ่านใบสั่งอาหารของวันหนึ่ง — Supabase ก่อน ถ้าไม่ได้ตั้งค่าจึงใช้ Apps Script
 * คืนค่าเป็น array รูปแบบเดียวกันทั้งสองทาง
 */
const loadRemoteOrders = async (project, date) => {
  if (supabaseConfigured()) return fetchFoodOrders({ project, date })
  const payload = await getFromScript('getFoodOrders', {
    projectId: project === 'sekong' ? 'xekong' : 'xepon',
    date,
  })
  return Array.isArray(payload.orders) ? payload.orders : []
}

const departments = [
  'Mechanical',
  'Civil & Central Service',
  'Warehouse',
  'Operation',
  'HR',
  'SHE',
  'Camp',
  'Accounting',
  'Purchasing',
  'Canteen',
  'Project Coordination',
  'IT',
]

const normalizeDepartmentName = (value = '') => {
  const text = String(value).trim()
  const key = text.toLowerCase().replace(/\s+/g, '')
  return departments.find((department) => department.toLowerCase().replace(/\s+/g, '') === key) || text
}

const departmentPins = Object.fromEntries(departments.map((department, index) => [department, String(1101 + index)]))
const ADMIN_ACCOUNT = 'kitchen-admin'
const ADMIN_PIN = '9999'

const projects = {
  xepon: { name: 'โครงการเซโปน', shortName: 'เซโปน' },
  sekong: { name: 'โครงการเซกอง', shortName: 'เซกอง' },
}

/**
 * ชื่อ location ในชีต dataforscan1 ที่นับเป็นของแต่ละโครงการ (ต้องตรงตัวอักษร)
 *
 * ใช้กรองแทนคอลัมน์ project เพราะในชีตมี location อื่นอยู่ด้วย (หงสา 320 คน,
 * เวียงจันทน์ 20 คน, แถวที่ location ว่าง 106 คน) ซึ่งไม่ใช่คนของ 2 โครงการนี้
 * ถ้า HR เพิ่ม location ใหม่หรือสะกดต่างไป ให้แก้ที่นี่ที่เดียว
 */
const projectLocations = {
  xepon: 'เชโปน',
  sekong: 'เซกอง',
}

const locationOfProject = (project) => projectLocations[project] || projectLocations.xepon

const projectFromLocation = (location = '') => {
  const normalized = String(location).trim().toLowerCase()
  return normalized.includes('เซกอง') || normalized.includes('sekong') || normalized.includes('xekong') ? 'sekong' : 'xepon'
}

const locationMatchesProject = (location = '', project = 'xepon') => {
  const normalized = String(location).trim().toLowerCase()
  if (project === 'sekong') return normalized.includes('เซกอง') || normalized.includes('sekong') || normalized.includes('xekong')
  return normalized.includes('เชโปน') || normalized.includes('xepon') || normalized.includes('xapon')
}

const demoUsers = [
  {
    id: 'demo-user-xepon',
    lid: '9000001',
    title: 'นาย',
    firstName: 'Demo',
    lastName: 'Xepon',
    position: 'ผู้ใช้งานทดลอง',
    department: 'IT',
    location: 'เซโปน',
    company: 'Thaidrill LAO',
    role: 'user',
    pin: '1234',
    createdAt: '2026-07-16T00:00:00.000Z',
    isDemo: true,
  },
  {
    id: 'demo-user-sekong',
    lid: '9000002',
    title: 'นาย',
    firstName: 'Demo',
    lastName: 'Sekong',
    position: 'ผู้ใช้งานทดลอง',
    department: 'IT',
    location: 'เซกอง',
    company: 'Thaidrill LAO',
    role: 'user',
    pin: '1234',
    createdAt: '2026-07-16T00:00:00.000Z',
    isDemo: true,
  },
  {
    // บัญชีทดลองสิทธิ์ Admin โรงครัว — เห็นยอดรวมทุกแผนก + จัดการผู้ใช้งานได้
    // ทำงานในเครื่องล้วนๆ ไม่ต้องมีใน Supabase และลบออกได้จากหน้า User
    id: 'demo-admin',
    lid: '9000000',
    title: 'นาย',
    firstName: 'Demo',
    lastName: 'Admin',
    position: 'ผู้ดูแลระบบทดลอง',
    department: 'Canteen',
    location: 'เชโปน',
    company: 'Thaidrill LAO',
    role: 'admin',
    pin: '9000',
    createdAt: '2026-07-16T00:00:00.000Z',
    isDemo: true,
  },
]

const seedTeams = {
  Mechanical: [
    'ทีมงาน-บริหารช่อมวิศวกร',
    'Admin ช่อม',
    'ทีมงาน-ช่างกะ 1',
    'ทีมงาน-ช่างกะ 2',
    'Mechanical (คนไทย) กะ 1',
    'Mechanical (คนไทย) กะ 2',
    'Mechanical (Spare-สั่งเพื่อ) กะ 1',
    'Mechanical (Spare-สั่งเพื่อ) กะ 2',
  ],
  'Civil & Central Service': [
    'ทีมงาน Admin +หัวหน้างาน',
    'งานไฟฟ้า',
    'งานโยธา',
    'สำหรับ พนักงาน-รับจ้างรายวัน',
    'Civil & Central Service (คนไทย) กะ1',
    'Civil & Central Service (คนไทย) กะ2',
    'Civil & Central Service (Spare-สั่งเพื่อ) กะ1',
    'Civil & Central Service (Spare-สั่งเพื่อ) กะ2',
  ],
  Warehouse: [
    'Admin-คลังน้ำมัน',
    'ทีมงาน-คลังน้ำมัน กะ1',
    'ทีมงาน-คลังน้ำมัน กะ2',
    'ทีมงาน-GPS กะ1',
    'ทีมงาน-GPS กะ2',
    'Admin (คลังพัสดุ+พัสดุ)',
    'คลังพัสดุ+พัสดุ กะ1',
    'คลังพัสดุ+พัสดุ กะ2',
    'Warehouse หัวหน้างานคลังน้ำมัน (คนไทย)',
    'Warehouse (Spare-สั่งเพื่อ) กะ1',
    'Warehouse (Spare-สั่งเพื่อ) กะ2',
  ],
  Operation: [
    'Admin Mining',
    'Green-Box (MOC)-กะ1',
    'Green-Box (MOC)-กะ2',
    'ทีมงาน-Surveyor',
    'ทีมงาน-Surveyor กะ2',
    'ทีมงาน-Mining-กะ1',
    'ทีมงาน-Mining-กะ2',
    'งานละเบีด',
    'งานเจาะ กะ1',
    'งานเจาะ กะ2',
    'ทีมงาน-SECO กะ1',
    'ทีมงาน-SECO กะ2',
    'ทีมทำทาง (Loading) กะ1',
    'ทีมทำทาง (Loading) กะ2',
    'ทีมงาน-ป้ำน้ำ และ โมบายคัดเชี้ กะ1',
    'ทีมงาน-ป้ำน้ำ และ โมบายคัดเชี้ กะ2',
    'วิศวกร - หน.งาน Operation -กะ1',
    'วิศวกร - หน.งาน Operation -กะ2',
    'Operation (Spare-สั่งเพื่อ) กะ1',
    'Operation (Spare-สั่งเพื่อ) กะ2',
  ],
  HR: [
    'นักเรียน-กะ1',
    'นักเรียน-กะ2',
    'ครูฝึก-กะ1',
    'ครูฝึก-กะ2',
    'HR + ER สวัสดิการ',
    'ทีมพยาบาล',
    'HR (คนไทย)',
    'HR (ครูฝึก-คนไทย)-กะ1',
    'HR (ครูฝึก-คนไทย)-กะ2',
    'HR (Spare-สั่งเพื่อ)-กะ1',
    'HR (Spare-สั่งเพื่อ)-กะ2',
  ],
  SHE: [
    'Admin - เซฟตี้',
    'ทีมงาน-Safety and Environment-กะ1',
    'ทีมงาน-Safety and Environment-กะ2',
    'SHE (คนไทย)-กะ1',
    'SHE (คนไทย)-กะ2',
    'SHE (Spare-สั่งเพื่อ)-กะ1',
    'SHE (Spare-สั่งเพื่อ)-กะ2',
  ],
  Camp: [
    'บริหาร-Camp',
    'แม่บ้าน + ปฎิบัติการ-Camp',
    'รถบริการ-กะ1',
    'รถบริการ-กะ2',
    'รถเมย์',
    'Security Guard-กะ1',
    'Security Guard-กะ2',
    'รักษาความปลอดภัย ( รปภ )-กะ1',
    'รักษาความปลอดภัย ( รปภ )-กะ2',
    'Camp (คนไทย)',
    'Camp (Spare-สั่งเพื่อ)',
  ],
  Accounting: ['ทีมงาน-บัญชี+ทรัพย์สิน', 'Accounting (คนไทย)', 'Accounting (Spare-สั่งเพื่อ)'],
  Purchasing: ['ทีมงาน-จัดซื้อ', 'Purchasing (คนไทย)', 'Purchasing (Spare-สั่งเพื่อ)'],
  Canteen: ['Admin-ทีมงาน-โรงอาหาร', 'ทีมงาน-โรงอาหาร-กะ1', 'ทีมงาน-โรงอาหาร-กะ2', 'Canteen (คนไทย)', 'Canteen (Spare-สั่งเพื่อ)'],
  'Project Coordination': ['ทีมงาน-ประสานงานโครงการ', 'ทีมงาน-DMIS', 'Project Coordination (คนไทย)', 'Project Coordination (Spare-สั่งเพื่อ)'],
  IT: ['IT', 'IT (คนไทย)', 'IT (Spare-สั่งเพื่อ)'],
}

const legacySeedTeams = {
  Mechanical: ['ทีมงาน-บริหารซ่อมวิศวกร', 'Admin ซ่อม', 'ทีมงาน-ช่างกะ 1', 'ทีมงาน-ช่างกะ 2'],
  'Civil & Central Service': ['Admin + หัวหน้างาน', 'งานไฟฟ้า', 'งานโยธา'],
  Warehouse: ['Admin-คลังน้ำมัน', 'ทีมงาน-คลังน้ำมัน กะ 1', 'ทีมงาน-คลังน้ำมัน กะ 2', 'คลังพัสดุ'],
  Operation: ['Admin Mining', 'Green-Box MOC กะ 1', 'Green-Box MOC กะ 2', 'Surveyor', 'Mining กะ 1', 'Mining กะ 2', 'งานระเบิด', 'งานเจาะ กะ 1', 'งานเจาะ กะ 2'],
  HR: ['ครูฝึก', 'HR + ER สวัสดิการ', 'ทีมพยาบาล'],
  SHE: ['Admin-SHE', 'Safety and Environment กะ 1', 'Safety and Environment กะ 2'],
  Camp: ['ทีมบริหาร-Camp', 'แม่บ้าน + ปฏิบัติการ', 'Security Guard'],
  Accounting: ['Accounting'],
  Purchasing: ['Purchasing'],
  Canteen: ['Canteen'],
  'Project Coordination': ['Project Coordination'],
  IT: [],
}

const emptyMeal = () => ({ canteen: 0, sticky: 0, rice: 0, point: '' })
const MEAL_PERIODS = ['morning', 'lunch', 'dinner', 'lateNight', 'irregular']

/**
 * จุดส่งข้าวห่อเริ่มต้น
 *
 * ใช้กับ "ข้าวห่อ" (ข้าวเหนียว + ข้าวจ้าว) เท่านั้น ส่วนที่ทานที่โรงครัวไม่ต้องส่ง
 * เลือกแยกในแต่ละมื้อ เพราะทีมเดียวกันอยู่ได้หลายจุดใน 1 วัน
 * เก็บลงคอลัมน์ morning_point / lunch_point / ... ของตาราง food_orders
 */
const defaultDeliveryPoints = [
  'KeepRoom ตู้เหลือง',
  'KeepRoom ตู้ขาว',
  'หน้างาน',
  'แคมป์ที่พัก',
]

/** ชื่อย่อที่โชว์ใน dropdown ให้คอลัมน์แคบลง — ค่าที่บันทึกยังเป็นชื่อเต็มเสมอ */
const deliveryPointShort = {
  'KeepRoom ตู้เหลือง': 'ตู้เหลือง',
  'KeepRoom ตู้ขาว': 'ตู้ขาว',
  'แคมป์ที่พัก': 'แคมป์',
}

const uniqueDeliveryPoints = (points = []) => {
  const seen = new Set()
  return points.map((point) => String(point || '').trim()).filter((point) => {
    const key = point.toLocaleLowerCase('th')
    if (!point || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const deliveryPointsStorageKey = (project = 'xepon') => `${DELIVERY_POINTS_KEY}:${project}`

const loadDeliveryPoints = (project = 'xepon') => {
  try {
    const stored = localStorage.getItem(deliveryPointsStorageKey(project))
      ?? localStorage.getItem(DELIVERY_POINTS_KEY)
    if (stored === null) return [...defaultDeliveryPoints]
    const saved = JSON.parse(stored)
    return Array.isArray(saved) ? uniqueDeliveryPoints(saved) : [...defaultDeliveryPoints]
  } catch {
    return [...defaultDeliveryPoints]
  }
}

const persistDeliveryPoints = (points, project = 'xepon') => {
  try {
    localStorage.setItem(deliveryPointsStorageKey(project), JSON.stringify(points))
    return true
  } catch {
    return false
  }
}

const makeRow = (department, team, date, project = 'xepon') => ({
  id: crypto.randomUUID(),
  project,
  department,
  team,
  date,
  morning: emptyMeal(),
  lunch: emptyMeal(),
  dinner: emptyMeal(),
  lateNight: emptyMeal(),
  irregular: emptyMeal(),
  note: '',
  status: 'draft',
})

const bangkokToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const tomorrow = () => new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const shiftDate = (date, days) => {
  const [year, month, day] = String(date).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
const number = (value) => Math.max(0, Number.parseInt(value, 10) || 0)
const formatCalculatedNumber = (value) => Number(value).toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 })
const packed = (meal) => number(meal.sticky) + number(meal.rice)
const mealTotal = (meal) => number(meal.canteen) + packed(meal)
const rowTotal = (row) => MEAL_PERIODS.reduce((total, period) => total + mealTotal(row[period] || emptyMeal()), 0)
const orderPayloadForRow = (row) => ({
  team: row.team,
  // จุดส่งมีความหมายเฉพาะมื้อที่มีข้าวห่อ มื้อที่ทานที่โรงครัวล้วนส่งค่าว่าง
  ...Object.fromEntries(MEAL_PERIODS.map((period) => [period, {
    ...row[period],
    point: packed(row[period]) ? (row[period].point || '') : '',
  }])),
  note: row.note,
})

/**
 * จำนวนหัวคนที่คิดจากยอดสั่ง = มื้อที่สั่งเยอะที่สุด
 *
 * ใช้มื้อสูงสุดเพราะคน 1 คนกินได้หลายมื้อ ถ้าเอายอดรวมทุกมื้อมาหาร 5 จะเพี้ยน
 * เวลาแผนกสั่งไม่ครบทุกมื้อ เช่น สั่งแค่มื้อเที่ยง 12 ชุด จะได้ 12 ÷ 5 = 2.4 คน
 * ทั้งที่ต้องเลี้ยงจริง 12 คน
 */
const headcountFromMeals = (mealTotals) => MEAL_PERIODS.reduce(
  (peak, period) => Math.max(peak, mealTotals[period]?.total || 0),
  0,
)
const isKitchenSubmitted = (row) => row.status === 'sent' && Boolean(row.submittedAt)
const formatDate = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'long' })
const formatSubmittedAt = (dateTime) => dateTime
  ? new Date(dateTime).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' })
  : ''

const initialRows = (date, project = 'xepon') => departments.flatMap((department) =>
  seedTeams[department].map((team) => makeRow(department, team, date, project)))

const ensureRowsForDate = (sourceRows, date, project = 'xepon') => {
  const normalizedRows = sourceRows.map((row) => ({
    ...row,
    project: row.project || 'xepon',
    ...Object.fromEntries(MEAL_PERIODS.map((period) => [period, { ...emptyMeal(), ...(row[period] || {}) }])),
  }))
  const cleanedRows = normalizedRows.filter((row) => {
    const isOldDefault = legacySeedTeams[row.department]?.includes(row.team)
      && !seedTeams[row.department]?.includes(row.team)
    const hasNoOrderData = rowTotal(row) === 0 && !row.note && (!row.status || row.status === 'draft')
    return !(isOldDefault && hasNoOrderData)
  })
  const missingRows = departments.flatMap((department) => seedTeams[department]
    .filter((team) => !cleanedRows.some((row) => row.project === project && row.date === date && row.department === department && row.team === team))
    .map((team) => makeRow(department, team, date, project)))
  return [...cleanedRows, ...missingRows]
}

const rowToStorage = (row) => [
  row.project || 'xepon',
  row.department || '',
  row.team || '',
  row.date || '',
  number(row.morning?.canteen),
  number(row.morning?.sticky),
  number(row.morning?.rice),
  number(row.lunch?.canteen),
  number(row.lunch?.sticky),
  number(row.lunch?.rice),
  number(row.dinner?.canteen),
  number(row.dinner?.sticky),
  number(row.dinner?.rice),
  number(row.lateNight?.canteen),
  number(row.lateNight?.sticky),
  number(row.lateNight?.rice),
  number(row.irregular?.canteen),
  number(row.irregular?.sticky),
  number(row.irregular?.rice),
  row.note || '',
  row.status || 'draft',
  row.submittedAt || '',
  row.submittedByLid || '',
  row.submittedByName || '',
  ...MEAL_PERIODS.map((period) => row[period]?.point || ''),
]

const rowFromStorage = (storedRow, storageVersion = 2) => {
  if (!Array.isArray(storedRow) || !storedRow[1] || !storedRow[2] || !storedRow[3]) return null
  const hasLateNight = storageVersion >= 3
  const hasIrregular = storageVersion >= 4
  const metadataIndex = hasIrregular ? 19 : hasLateNight ? 16 : 13
  // จุดส่งรายมื้อเก็บต่อท้าย metadata ตั้งแต่ version 7 (ก่อนหน้านั้นไม่มี = ค่าว่าง)
  const pointOf = (index) => (storageVersion >= 7 && storedRow[metadataIndex + 5 + index]) || ''
  return {
    id: crypto.randomUUID(),
    project: storedRow[0] || 'xepon',
    department: storedRow[1],
    team: storedRow[2],
    date: storedRow[3],
    morning: { canteen: number(storedRow[4]), sticky: number(storedRow[5]), rice: number(storedRow[6]), point: pointOf(0) },
    lunch: { canteen: number(storedRow[7]), sticky: number(storedRow[8]), rice: number(storedRow[9]), point: pointOf(1) },
    dinner: { canteen: number(storedRow[10]), sticky: number(storedRow[11]), rice: number(storedRow[12]), point: pointOf(2) },
    lateNight: hasLateNight
      ? { canteen: number(storedRow[13]), sticky: number(storedRow[14]), rice: number(storedRow[15]), point: pointOf(3) }
      : emptyMeal(),
    irregular: hasIrregular
      ? { canteen: number(storedRow[16]), sticky: number(storedRow[17]), rice: number(storedRow[18]), point: pointOf(4) }
      : emptyMeal(),
    note: storedRow[metadataIndex] || '',
    status: storedRow[metadataIndex + 1] || 'draft',
    ...(storedRow[metadataIndex + 2] ? { submittedAt: storedRow[metadataIndex + 2] } : {}),
    ...(storedRow[metadataIndex + 3] ? { submittedByLid: storedRow[metadataIndex + 3] } : {}),
    ...(storedRow[metadataIndex + 4] ? { submittedByName: storedRow[metadataIndex + 4] } : {}),
  }
}

const isRegenerableEmptyRow = (row) => seedTeams[row.department]?.includes(row.team)
  && rowTotal(row) === 0
  && !row.note
  && (!row.status || row.status === 'draft')
  && !row.submittedAt

const persistRows = (sourceRows) => {
  try {
    const storedRows = sourceRows
      .filter((row) => !isRegenerableEmptyRow(row))
      .map(rowToStorage)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 7,
      rows: storedRows,
      savedAt: new Date().toISOString(),
    }))
    return true
  } catch (error) {
    console.warn('Unable to save the local food-order cache.', error)
    return false
  }
}

const loadRows = (date) => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!Array.isArray(saved?.rows) || !saved.rows.length) return initialRows(date, 'xepon')
    const storedRows = [2, 3, 4, 5, 6, 7].includes(saved.version)
      ? saved.rows.map((row) => rowFromStorage(row, saved.version)).filter(Boolean)
      : saved.rows
    return ensureRowsForDate(storedRows, date, 'xepon')
  } catch {
    return initialRows(date, 'xepon')
  }
}

const loadSession = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY))
    if (saved?.role === 'admin') return saved
    if (saved?.role === 'department' && departments.includes(saved.department)) return saved
  } catch {
    // Ignore invalid sessions.
  }
  return null
}

const loadUsers = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(USERS_KEY))
    const currentUsers = Array.isArray(saved) ? saved : []
    const deletedDemoLids = JSON.parse(localStorage.getItem(DELETED_DEMO_USERS_KEY) || '[]')
    const missingDemoUsers = demoUsers.filter((demoUser) => !deletedDemoLids.includes(demoUser.lid) && !currentUsers.some((user) => user.lid === demoUser.lid))
    const users = [...currentUsers, ...missingDemoUsers]
    if (missingDemoUsers.length) localStorage.setItem(USERS_KEY, JSON.stringify(users))
    return users
  } catch {
    localStorage.setItem(USERS_KEY, JSON.stringify(demoUsers))
    return demoUsers
  }
}

/**
 * มื้อที่แสดงในตารางกรอกออเดอร์
 *
 * ค่าเริ่มต้นเปิดแค่ 3 มื้อหลัก เพราะเปิดครบ 5 มื้อ ตารางจะกว้าง 35 คอลัมน์
 * (~3,000px) ต้องเลื่อนซ้ายขวาตลอด — มื้อดึกกับมื้อไม่ปกติกดเปิดได้เมื่อต้องใช้
 * และระบบจะจำค่าที่เลือกไว้ให้
 */
const defaultVisibleMeals = () => ({
  morning: true,
  lunch: true,
  dinner: true,
  lateNight: false,
  irregular: false,
})

const loadVisibleMeals = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(VISIBLE_MEALS_KEY))
    if (!saved || typeof saved !== 'object') return defaultVisibleMeals()
    return Object.fromEntries(MEAL_PERIODS.map((period) => [period, saved[period] !== false]))
  } catch {
    return defaultVisibleMeals()
  }
}

const loadOrderQueue = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_QUEUE_KEY))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}


const statusText = {
  draft: 'แบบร่าง',
  confirmed: 'ยืนยันแล้ว',
  sent: 'ส่งโรงครัวแล้ว',
}

const periodLabels = {
  morning: 'มื้อเช้า',
  lunch: 'มื้อเที่ยง',
  dinner: 'มื้อเย็น',
  lateNight: 'มื้อดึก',
  irregular: 'มื้อไม่ปกติ',
}

const summarizeRows = (sourceRows) => sourceRows.reduce((sum, row) => {
  for (const period of MEAL_PERIODS) {
    const meal = row[period] || emptyMeal()
    sum[period].canteen += number(meal.canteen)
    sum[period].sticky += number(meal.sticky)
    sum[period].rice += number(meal.rice)
    sum[period].total += mealTotal(meal)
  }
  sum.grand += rowTotal(row)
  return sum
}, {
  morning: { canteen: 0, sticky: 0, rice: 0, total: 0 },
  lunch: { canteen: 0, sticky: 0, rice: 0, total: 0 },
  dinner: { canteen: 0, sticky: 0, rice: 0, total: 0 },
  lateNight: { canteen: 0, sticky: 0, rice: 0, total: 0 },
  irregular: { canteen: 0, sticky: 0, rice: 0, total: 0 },
  grand: 0,
})

function StatCard({ label, value, tone, icon: Icon }) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon"><Icon size={22} /></div>
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString('th-TH')}</strong>
        <small>ชุด</small>
      </div>
    </article>
  )
}

function QuantityInput({ value, label, onChange }) {
  return (
    <input
      className="qty-input"
      type="number"
      min="0"
      inputMode="numeric"
      value={value || ''}
      aria-label={label}
      placeholder="0"
      onChange={(event) => onChange(number(event.target.value))}
    />
  )
}

function NoteInput({ value, onChange }) {
  const resize = (element) => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.max(element.scrollHeight, 44)}px`
  }
  return (
    <textarea
      ref={resize}
      className="note-input"
      value={value}
      rows="2"
      placeholder="ระบุหมายเหตุ"
      onChange={(event) => {
        resize(event.target)
        onChange(event.target.value)
      }}
    />
  )
}

function LoginPage({ onLogin }) {
  const [loginMode, setLoginMode] = useState('user')
  const [loginId, setLoginId] = useState('')
  const [account, setAccount] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [users, setUsers] = useState(loadUsers)
  const [showSignup, setShowSignup] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const normalizedLoginId = loginId.trim().toLowerCase()
    let registeredUser = loginMode === 'user'
      ? users.find((user) => user.lid === loginId.trim() || user.username?.toLowerCase() === normalizedLoginId)
      : null
    if (loginMode === 'user' && !normalizedLoginId) {
      setError('กรุณากรอก LID')
      return
    }
    if (loginMode === 'department' && !account) {
      setError('กรุณาเลือกแผนกหรือ Admin โรงครัว')
      return
    }

    if (loginMode === 'user' && !registeredUser?.isDemo && (supabaseConfigured() || configuredApiUrl())) {
      setLoggingIn(true)
      try {
        registeredUser = supabaseConfigured()
          ? await loginUserOnSupabase(loginId.trim(), pin)
          : (await postToScript('loginUser', { lid: loginId.trim(), pin })).user
        const nextUsers = [...users.filter((user) => user.lid !== registeredUser.lid), registeredUser]
        localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers))
        setUsers(nextUsers)
      } catch (loginError) {
        if (!registeredUser?.pin || pin !== registeredUser.pin) {
          setError(loginError.message)
          setLoggingIn(false)
          return
        }
      }
    }

    if (loginMode === 'user') {
      if (!registeredUser) {
        setError(supabaseConfigured() || configuredApiUrl()
          ? 'ไม่พบบัญชีผู้ใช้สำหรับ LID นี้ กรุณาสมัครใหม่'
          : 'ไม่พบบัญชีผู้ใช้ และยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล')
        setLoggingIn(false)
        return
      }
      if (registeredUser.pin && pin !== registeredUser.pin) {
        setError('รหัสเข้าใช้งานไม่ถูกต้อง')
        setLoggingIn(false)
        return
      }
    } else {
      const validPin = account === ADMIN_ACCOUNT ? ADMIN_PIN : departmentPins[account]
      if (pin !== validPin) {
        setError('รหัสเข้าใช้งานไม่ถูกต้อง')
        return
      }
    }
    const session = registeredUser
      ? {
          role: registeredUser.role === 'admin' ? 'admin' : 'department',
          department: registeredUser.department,
          name: registeredUser.fullName || [registeredUser.title, registeredUser.firstName, registeredUser.lastName].filter(Boolean).join(' '),
          userId: registeredUser.id,
          lid: registeredUser.lid,
          location: registeredUser.location,
          company: registeredUser.company,
        }
      : account === ADMIN_ACCOUNT
      ? { role: 'admin', name: 'Admin โรงครัว' }
      : { role: 'department', department: account, name: account }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setLoggingIn(false)
    onLogin(session)
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand-mark"><UtensilsCrossed size={36} /></div>
        <p>THAIDRILL LAO FOOD SERVICE</p>
        <h1>ระบบสั่งอาหาร<br />Thaidrill LAO</h1>
        <span>แยกการเข้าใช้งานรายแผนก และสรุปยอดรวมสำหรับโรงครัวในที่เดียว</span>
        <div className="login-feature"><CheckCircle2 size={20} /><span>แต่ละแผนกเห็นเฉพาะรายการของตนเอง</span></div>
        <div className="login-feature"><ClipboardCheck size={20} /><span>Admin โรงครัวเห็นยอดข้าวจากทุกแผนก</span></div>
      </section>

      <section className="login-form-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-lock"><LockKeyhole size={25} /></div>
          <div>
            <p className="eyebrow">เข้าสู่ระบบ</p>
            <h2>{loginMode === 'user' ? 'เข้าสู่ระบบด้วย LID' : 'เลือกหน่วยงานของคุณ'}</h2>
            <span className="login-help">{loginMode === 'user' ? 'กรอก LID และรหัสเข้าใช้งาน' : 'เลือกแผนกและกรอกรหัสประจำแผนก'}</span>
          </div>

          <div className="login-mode-tabs" role="tablist" aria-label="ประเภทการเข้าสู่ระบบ">
            <button className={loginMode === 'user' ? 'active' : ''} type="button" onClick={() => { setLoginMode('user'); setError(''); setSuccess('') }}>ผู้ใช้งาน LID</button>
            <button className={loginMode === 'department' ? 'active' : ''} type="button" onClick={() => { setLoginMode('department'); setError(''); setSuccess('') }}>บัญชีแผนก</button>
          </div>

          {loginMode === 'user' ? (
            <label className="login-control">
              <span>LID / ชื่อผู้ใช้</span>
              <input
                autoFocus
                value={loginId}
                onChange={(event) => { setLoginId(event.target.value); setError('') }}
                placeholder="กรอก LID เช่น 5911865"
              />
            </label>
          ) : (
            <label className="login-control">
              <span>แผนก / ประเภทผู้ใช้</span>
              <select value={account} onChange={(event) => { setAccount(event.target.value); setError('') }}>
                <option value="">— เลือกหน่วยงาน —</option>
                <option value={ADMIN_ACCOUNT}>Admin โรงครัว</option>
                {departments.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </label>
          )}

          <label className="login-control">
            <span>รหัสเข้าใช้งาน</span>
            <div className="pin-input">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(event) => { setPin(event.target.value); setError('') }}
                placeholder="กรอกรหัสเข้าใช้งาน"
              />
              <button type="button" onClick={() => setShowPin((current) => !current)} aria-label={showPin ? 'ซ่อนรหัส' : 'แสดงรหัส'}>
                {showPin ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </label>

          {error && <div className="login-error" role="alert">{error}</div>}
          {success && <div className="login-success" role="status">{success}</div>}
          <button className="login-button" type="submit" disabled={loggingIn}>{loggingIn ? 'กำลังตรวจสอบข้อมูล...' : 'เข้าสู่ระบบ'}</button>
          <button className="signup-open-button" type="button" onClick={() => setShowSignup(true)}><UserPlus size={18} />สมัครผู้ใช้งานใหม่</button>
          <small className="login-contact">หากลืมรหัส กรุณาติดต่อผู้ดูแลระบบ</small>
        </form>
      </section>

      {showSignup && (
        <SignupModal
          users={users}
          onClose={() => setShowSignup(false)}
          onCreated={(user) => {
            const nextUsers = [...users, user]
            localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers))
            setUsers(nextUsers)
            setLoginMode('user')
            setLoginId(user.lid || user.username)
            setAccount('')
            setPin('')
            setError('')
            setSuccess(`สมัครบัญชี LID ${user.lid || user.username} สำเร็จ กรุณากรอกรหัสเพื่อเข้าสู่ระบบ`)
            setShowSignup(false)
          }}
        />
      )}
    </main>
  )
}

function SignupModal({ users = [], onClose, onCreated, allowAdmin = false, defaultProject = '' }) {
  const [form, setForm] = useState({ lid: '', role: 'user', pin: '', confirmPin: '' })
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    const lid = form.lid.trim()
    if (!lid) {
      setError('กรุณากรอกชื่อผู้ใช้ (LID)')
      return
    }
    if (users.some((user) => String(user.lid || '').trim() === lid)) {
      setError(`${lid} มีบัญชีอยู่แล้ว ถ้าลืมรหัสให้แอดมินลบบัญชีก่อน`)
      return
    }
    if (!form.pin || !form.confirmPin) {
      setError('กรุณาตั้งรหัสเข้าใช้งานและกรอกยืนยันให้ครบ')
      return
    }
    if (form.pin.length < 4) {
      setError('รหัสเข้าใช้งานต้องมีอย่างน้อย 4 ตัวอักษร')
      return
    }
    if (form.pin !== form.confirmPin) {
      setError('รหัสยืนยันไม่ตรงกัน')
      return
    }
    setSubmitting(true)
    setError('')
    // ไม่ได้ถามข้อมูลพนักงานในหน้านี้แล้ว — ถ้า LID มีในตาราง employees
    // ฐานข้อมูลจะเติมชื่อ/แผนก/location/บริษัทให้เอง ถ้าไม่มีก็ปล่อยว่างไว้
    const project = defaultProject || ''
    try {
      const role = allowAdmin ? form.role : 'user'
      const user = supabaseConfigured()
        ? await registerUserOnSupabase({ lid, pin: form.pin, role, project })
        : (await postToScript('registerUser', {
          lid,
          pin: form.pin,
          role,
          project,
          ...(allowAdmin && form.role === 'admin' ? { adminPin: ADMIN_PIN } : {}),
        })).user
      onCreated(user)
    } catch (submitError) {
      setError(submitError.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop signup-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="signup-modal" role="dialog" aria-modal="true" aria-labelledby="signup-title">
        <header className="signup-modal-header">
          <div className="signup-modal-icon"><UserPlus size={24} /></div>
          <div><p>CREATE ACCOUNT</p><h3 id="signup-title">สมัครผู้ใช้งานใหม่</h3></div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="ปิด"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <label className="modal-control signup-full-row">
            <span>ผู้ใช้ (LID) <i>*</i></span>
            <input autoFocus value={form.lid} onChange={(event) => update('lid', event.target.value)} placeholder="เช่น 5911865 หรือรหัสพนักงาน" />
          </label>
          {allowAdmin && (
            <label className="modal-control signup-full-row user-role-control">
              <span>สถานะผู้ใช้งาน <i>*</i></span>
              <select value={form.role} onChange={(event) => update('role', event.target.value)}>
                <option value="user">ผู้ใช้ทั่วไป — เข้าถึงเฉพาะแผนกของตนเอง</option>
                <option value="admin">Admin — เข้าถึงยอดสรุปและจัดการ User</option>
              </select>
            </label>
          )}
          <div className="signup-access-title signup-full-row"><LockKeyhole size={17} /><span>ตั้งรหัสเข้าใช้งาน</span></div>
          <label className="modal-control">
            <span>รหัสเข้าใช้งาน <i>*</i></span>
            <div className="pin-input signup-pin-input">
              <input type={showPassword ? 'text' : 'password'} maxLength="50" value={form.pin} onChange={(event) => update('pin', event.target.value)} placeholder="ตัวอักษร ตัวเลข หรือสัญลักษณ์" />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'ซ่อนรหัส' : 'แสดงรหัส'}>
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </label>
          <label className="modal-control">
            <span>ยืนยันรหัส <i>*</i></span>
            <div className="pin-input signup-pin-input">
              <input type={showConfirmPassword ? 'text' : 'password'} maxLength="50" value={form.confirmPin} onChange={(event) => update('confirmPin', event.target.value)} placeholder="กรอกรหัสอีกครั้ง" />
              <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? 'ซ่อนรหัสยืนยัน' : 'แสดงรหัสยืนยัน'}>
                {showConfirmPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </label>
          {error && <div className="modal-error signup-full-row" role="alert">{error}</div>}
          <p className="modal-hint signup-full-row">กรอกแค่ชื่อผู้ใช้และรหัสเข้าใช้งาน · ถ้า LID นี้มีอยู่ในตาราง employees ระบบจะเติมชื่อ แผนก location และบริษัทให้อัตโนมัติ · รหัสถูกเข้ารหัสก่อนบันทึกลง Supabase</p>
          <footer className="modal-actions signup-full-row">
            <button className="button secondary" type="button" onClick={onClose}>ยกเลิก</button>
            <button className="button primary" type="submit" disabled={submitting}><UserPlus size={17} />{submitting ? 'กำลังบันทึก...' : 'สมัครผู้ใช้งาน'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function DeliveryPointModal({ selectedProject, deliveryPoints, initialPoint = '', onClose, onSave }) {
  const [pointName, setPointName] = useState(initialPoint)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const editing = Boolean(initialPoint)

  const submit = async (event) => {
    event.preventDefault()
    const nextPoint = pointName.trim()
    if (!nextPoint) {
      setError('กรุณากรอกชื่อสถานที่ส่ง')
      return
    }
    if (deliveryPoints.some((point) => point.toLocaleLowerCase('th') === nextPoint.toLocaleLowerCase('th')
      && point.toLocaleLowerCase('th') !== initialPoint.toLocaleLowerCase('th'))) {
      setError('มีสถานที่ส่งนี้อยู่ในรายการแล้ว')
      return
    }
    if (editing && nextPoint === initialPoint) {
      onClose()
      return
    }
    setSaving(true)
    try {
      if (await onSave(nextPoint)) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="team-modal" role="dialog" aria-modal="true" aria-labelledby="add-delivery-point-title">
        <header className="team-modal-header delivery-point-modal-header">
          <div className="team-modal-icon"><MapPin size={22} /></div>
          <div>
            <p>ADMIN · DELIVERY LOCATION</p>
            <h3 id="add-delivery-point-title">{editing ? 'แก้ไขสถานที่ส่ง' : 'เพิ่มสถานที่ส่ง'}</h3>
          </div>
          <button className="modal-close" type="button" disabled={saving} onClick={onClose} aria-label="ปิด"><X size={20} /></button>
        </header>

        <form onSubmit={submit}>
          <div className="modal-department delivery-point-context">
            <ShieldCheck size={18} />
            <div><small>จัดการโดยแอดมินโรงครัวเท่านั้น</small><strong>{projects[selectedProject].name}</strong></div>
          </div>
          <label className="modal-control">
            <span>ชื่อสถานที่ส่ง <i>*</i></span>
            <input
              autoFocus
              maxLength={80}
              value={pointName}
              onChange={(event) => { setPointName(event.target.value); setError('') }}
              placeholder="เช่น ห้องควบคุมเหมือง"
            />
          </label>
          {error && <div className="modal-error" role="alert">{error}</div>}
          <p className="modal-hint">{editing
            ? 'การเปลี่ยนชื่อจะใช้กับรายการให้เลือกครั้งถัดไป โดยไม่แก้ไขชื่อในคำสั่งซื้อย้อนหลัง'
            : 'เมื่อเพิ่มแล้ว ผู้ใช้ทั่วไปจะเลือกสถานที่นี้ได้จากช่อง “ส่งห่อที่” แต่จะเพิ่มสถานที่เองไม่ได้'}</p>
          <footer className="modal-actions">
            <button className="button secondary" type="button" disabled={saving} onClick={onClose}>ยกเลิก</button>
            <button className="button primary" type="submit" disabled={saving}>{editing ? <Pencil size={17} /> : <Plus size={17} />}{saving ? 'กำลังบันทึก...' : (editing ? 'บันทึกการแก้ไข' : 'เพิ่มสถานที่')}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function PageHeader({ selectedDate, selectedProject, changeProject, session, onLogout }) {
  const [currentTime, setCurrentTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="hero">
      <div className="brand">
        <div className="brand-mark"><UtensilsCrossed size={28} /></div>
        <div>
          <p>THAIDRILL LAO FOOD SERVICE</p>
          <h1>ระบบสั่งอาหาร Thaidrill LAO</h1>
          <span>{session.role === 'admin' ? `Admin โรงครัว · ${projects[selectedProject].name}` : `${projects[selectedProject].name} · แผนก ${session.department}`}</span>
        </div>
      </div>
      <div className="hero-tools">
        {session.role === 'admin' ? (
          <div className="project-switcher" aria-label="เลือกโครงการ">
            {Object.entries(projects).map(([key, project]) => (
              <button key={key} type="button" className={selectedProject === key ? 'active' : ''} onClick={() => changeProject(key)}>{project.shortName}</button>
            ))}
          </div>
        ) : (
          <div className="project-indicator"><Building2 size={18} /><div><small>{session.location ? `location: ${session.location}` : 'โครงการของบัญชี'}</small><strong>{projects[selectedProject].name}</strong></div></div>
        )}
        <div className="live-clock">
          <Clock3 size={20} />
          <div><small>วัน–เวลาปัจจุบัน</small><strong>{currentTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' })}</strong></div>
          <i aria-hidden="true" />
        </div>
        <div className="hero-date">
          <CalendarDays size={20} />
          <div><small>วันที่รับอาหาร</small><strong>{formatDate(selectedDate)}</strong></div>
        </div>
        <button className="logout-button" onClick={onLogout}><LogOut size={18} /><span>ออกจากระบบ</span></button>
      </div>
    </header>
  )
}

function DepartmentWorkspace({ session, selectedDate, selectedProject, changeDate, rows, setRows, deliveryPoints, notify }) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [addTeamError, setAddTeamError] = useState('')
  const [submissionReceipt, setSubmissionReceipt] = useState(null)
  const [headcount, setHeadcount] = useState({ loading: true, count: null, date: '', error: '' })
  const [submittingOrder, setSubmittingOrder] = useState(false)
  const [submittingTeamId, setSubmittingTeamId] = useState('')
  const [visibleMeals, setVisibleMeals] = useState(loadVisibleMeals)
  const [orderQueue, setOrderQueue] = useState(loadOrderQueue)
  const [previousDayTemplate, setPreviousDayTemplate] = useState({ loading: true, date: '', rows: 0, error: '' })
  const department = session.department
  const currentQueueId = `${selectedProject}:${selectedDate}:${department}`
  const pendingOrder = orderQueue.find((item) => item.id === currentQueueId)

  const updateOrderQueue = (updater) => {
    setOrderQueue((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      localStorage.setItem(ORDER_QUEUE_KEY, JSON.stringify(next))
      return next
    })
  }

  const loadDepartmentHeadcount = async () => {
    setHeadcount((current) => ({ ...current, loading: true, error: '' }))

    // Supabase ก่อน (ข้อมูล sync จากชีต dataforscan1 อัตโนมัติอยู่แล้ว)
    if (supabaseConfigured()) {
      try {
        const count = await countEmployees({ location: locationOfProject(selectedProject), department })
        setHeadcount({ loading: false, count, date: bangkokToday(), error: '' })
        return
      } catch {
        // Supabase ใช้ไม่ได้ -> ถอยไปทาง Apps Script ข้างล่าง
      }
    }

    try {
      const payload = await getFromScript('getDepartmentHeadcount', {
        projectId: selectedProject === 'sekong' ? 'xekong' : 'xepon',
        department,
      })
      setHeadcount({ loading: false, count: Number(payload.count) || 0, date: payload.date || '', error: '' })
    } catch (headcountError) {
      try {
        const fallback = await getFromScript('getDataForScan')
        const uniqueLids = new Set((fallback.rows || [])
          .filter((row) => locationMatchesProject(row[7], selectedProject) && normalizeDepartmentName(row[6]) === department)
          .map((row) => String(row[1] ?? '').trim().toLowerCase())
          .filter(Boolean))
        setHeadcount({ loading: false, count: uniqueLids.size, date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }), error: '' })
      } catch (fallbackError) {
        setHeadcount({ loading: false, count: null, date: '', error: fallbackError.message || headcountError.message })
      }
    }
  }

  useEffect(() => {
    loadDepartmentHeadcount()
  }, [department, selectedProject])

  useEffect(() => {
    let active = true
    const previousDate = shiftDate(selectedDate, -1)
    setPreviousDayTemplate({ loading: true, date: previousDate, rows: 0, error: '' })

    const applyTemplate = (sourceRows) => {
      if (!active || !sourceRows.length) {
        if (active) setPreviousDayTemplate({ loading: false, date: previousDate, rows: 0, error: '' })
        return
      }
      setRows((current) => {
        const next = [...current]
        sourceRows.forEach((sourceRow) => {
          if (normalizeDepartmentName(sourceRow.department) !== department || !sourceRow.team) return
          const existingIndex = next.findIndex((row) => row.project === selectedProject
            && row.date === selectedDate
            && row.department === department
            && row.team.trim().toLowerCase() === String(sourceRow.team).trim().toLowerCase())
          const templateValues = {
            morning: { ...emptyMeal(), ...(sourceRow.morning || {}) },
            lunch: { ...emptyMeal(), ...(sourceRow.lunch || {}) },
            dinner: { ...emptyMeal(), ...(sourceRow.dinner || {}) },
            lateNight: { ...emptyMeal(), ...(sourceRow.lateNight || {}) },
            irregular: { ...emptyMeal(), ...(sourceRow.irregular || {}) },
            note: sourceRow.note || '',
            status: 'draft',
            submittedAt: null,
            submittedByLid: '',
            submittedByName: '',
            copiedFromDate: previousDate,
          }
          if (existingIndex >= 0) {
            const existing = next[existingIndex]
            const isUntouched = rowTotal(existing) === 0 && !existing.note && (!existing.status || existing.status === 'draft')
            if (isUntouched) next[existingIndex] = { ...existing, ...templateValues }
          } else {
            next.push({
              ...makeRow(department, String(sourceRow.team), selectedDate, selectedProject),
              ...templateValues,
            })
          }
        })
        persistRows(next)
        return next
      })
      setPreviousDayTemplate({ loading: false, date: previousDate, rows: sourceRows.length, error: '' })
    }

    const localPreviousRows = rows.filter((row) => row.project === selectedProject && row.date === previousDate && row.department === department)
    if (!supabaseConfigured() && !configuredApiUrl()) {
      applyTemplate(localPreviousRows)
      return () => { active = false }
    }

    loadRemoteOrders(selectedProject, previousDate).then((orders) => {
      const remoteRows = orders.filter((row) => normalizeDepartmentName(row.department) === department)
      applyTemplate(remoteRows.length ? remoteRows : localPreviousRows)
    }).catch((templateError) => {
      if (localPreviousRows.length) applyTemplate(localPreviousRows)
      else if (active) setPreviousDayTemplate({ loading: false, date: previousDate, rows: 0, error: templateError.message })
    })
    return () => { active = false }
  }, [session, selectedDate, selectedProject, department])

  const visibleRows = useMemo(() => {
    const search = query.trim().toLowerCase()
    return rows.filter((row) => row.project === selectedProject
      && row.date === selectedDate
      && row.department === department
      && (!search || `${row.team} ${row.note}`.toLowerCase().includes(search)))
  }, [rows, selectedDate, selectedProject, department, query])

  const totals = useMemo(() => summarizeRows(visibleRows), [visibleRows])
  const latestSubmittedRow = visibleRows.find((row) => row.status === 'sent' && row.submittedByLid)

  const applyVisibleMeals = (next) => {
    try {
      localStorage.setItem(VISIBLE_MEALS_KEY, JSON.stringify(next))
    } catch {
      // พื้นที่เต็ม — ใช้ค่าในหน่วยความจำต่อได้
    }
    setVisibleMeals(next)
  }

  const toggleMealVisibility = (period) => {
    const visibleCount = Object.values(visibleMeals).filter(Boolean).length
    if (visibleMeals[period] && visibleCount === 1) {
      notify('ต้องเปิดแสดงอย่างน้อย 1 มื้อ')
      return
    }
    applyVisibleMeals({ ...visibleMeals, [period]: !visibleMeals[period] })
  }

  const updateRow = (id, patch) => setRows((current) =>
    current.map((row) => {
      if (row.id !== id) return row
      const editedAfterSubmit = row.status === 'sent' && (!Object.hasOwn(patch, 'status') || patch.status !== 'sent')
      return editedAfterSubmit
        ? { ...row, ...patch, status: 'draft', submittedAt: null, submittedByLid: '', submittedByName: '' }
        : { ...row, ...patch }
    }))

  const updateMeal = (id, period, field, value) => setRows((current) =>
    current.map((row) => row.id === id
      ? {
          ...row,
          [period]: { ...row[period], [field]: value },
          ...(row.status === 'sent' ? { status: 'draft', submittedAt: null, submittedByLid: '', submittedByName: '' } : {}),
        }
      : row))

  const openAddTeam = () => {
    setNewTeamName('')
    setAddTeamError('')
    setShowAddTeam(true)
  }

  const addTeam = (event) => {
    event.preventDefault()
    const teamName = newTeamName.trim()
    if (!teamName) {
      setAddTeamError('กรุณากรอกชื่อทีมงาน')
      return
    }
    const alreadyExists = rows.some((row) => row.project === selectedProject
      && row.date === selectedDate
      && row.department === department
      && row.team.trim().toLowerCase() === teamName.toLowerCase())
    if (alreadyExists) {
      setAddTeamError('มีชื่อทีมงานนี้อยู่ในแผนกแล้ว')
      return
    }
    setRows((current) => [...current, makeRow(department, teamName, selectedDate, selectedProject)])
    setCollapsed(false)
    setShowAddTeam(false)
    notify(`เพิ่มทีมงาน “${teamName}” แล้ว กรุณากดบันทึก`)
  }

  const removeRow = (id, team) => {
    if (!window.confirm(`ลบรายการ “${team}” ใช่หรือไม่?`)) return
    setRows((current) => current.filter((row) => row.id !== id))
    notify('ลบรายการแล้ว')
  }

  const save = async (submitToKitchen = false) => {
    if (!submitToKitchen) {
      notify(persistRows(rows) ? 'บันทึกข้อมูลสำเร็จ' : 'พื้นที่จัดเก็บในเครื่องเต็ม กรุณาส่งข้อมูลไปยังโรงครัว')
      return
    }
    const departmentRows = rows.filter((row) => row.project === selectedProject && row.date === selectedDate && row.department === department)
    const orderPayload = departmentRows.map(orderPayloadForRow)
    const request = {
      projectId: selectedProject === 'sekong' ? 'xekong' : 'xepon',
      orderDate: selectedDate,
      department,
      submittedByLid: session.lid || '',
      submittedByName: session.name || department,
      orders: JSON.stringify(orderPayload),
    }
    const queueItem = { id: currentQueueId, queuedAt: new Date().toISOString(), request }
    updateOrderQueue((current) => [...current.filter((item) => item.id !== currentQueueId), queueItem])
    persistRows(rows)
    setSubmittingOrder(true)
    try {
      const submittedByLid = session.lid || ''
      const submittedByName = session.name || department
      const payload = supabaseConfigured()
        ? await saveFoodOrdersOnSupabase({
          project: selectedProject,
          date: selectedDate,
          department,
          submittedByLid,
          submittedByName,
          orders: orderPayload,
        })
        : await postToScript('saveFoodOrders', request)
      const submittedAt = payload.submittedAt || new Date().toISOString()
      const nextRows = rows.map((row) => row.project === selectedProject && row.date === selectedDate && row.department === department
        ? { ...row, status: 'sent', submittedAt, submittedByLid, submittedByName }
        : row)
      setRows(nextRows)
      persistRows(nextRows)
      updateOrderQueue((current) => current.filter((item) => item.id !== currentQueueId))
      setSubmissionReceipt({
        submittedAt,
        submittedByLid,
        submittedByName,
        orderDate: selectedDate,
        target: supabaseConfigured() ? 'Supabase' : payload.sheet,
        saved: payload.saved,
      })
    } catch (submitError) {
      notify(`ยังส่งไม่สำเร็จ เก็บคิวไว้ในเครื่องแล้ว: ${submitError.message}`)
    } finally {
      setSubmittingOrder(false)
    }
  }

  const submitTeam = async (teamRow) => {
    const team = teamRow.team.trim()
    if (!team) {
      notify('กรุณากรอกชื่อทีมงานก่อนส่งโรงครัว')
      return
    }
    if (rowTotal(teamRow) === 0 && !teamRow.note.trim()) {
      notify(`กรุณากรอกจำนวนอาหารหรือหมายเหตุของทีม “${team}” ก่อนส่ง`)
      return
    }

    const submittedByLid = session.lid || ''
    const submittedByName = session.name || department
    const orderPayload = [orderPayloadForRow({ ...teamRow, team })]
    const request = {
      projectId: selectedProject === 'sekong' ? 'xekong' : 'xepon',
      orderDate: selectedDate,
      department,
      submittedByLid,
      submittedByName,
      orders: JSON.stringify(orderPayload),
    }

    persistRows(rows)
    setSubmittingTeamId(teamRow.id)
    try {
      const payload = supabaseConfigured()
        ? await saveFoodOrdersOnSupabase({
          project: selectedProject,
          date: selectedDate,
          department,
          submittedByLid,
          submittedByName,
          orders: orderPayload,
        })
        : await postToScript('saveFoodOrders', request)
      const submittedAt = payload.submittedAt || new Date().toISOString()
      setRows((current) => {
        const next = current.map((row) => row.id === teamRow.id
          ? { ...row, team, status: 'sent', submittedAt, submittedByLid, submittedByName }
          : row)
        persistRows(next)
        return next
      })
      setSubmissionReceipt({
        submittedAt,
        submittedByLid,
        submittedByName,
        orderDate: selectedDate,
        team,
        target: supabaseConfigured() ? 'Supabase' : (payload.sheet || 'Google Sheets'),
        saved: Number(payload.saved ?? 1),
      })
    } catch (submitError) {
      notify(`ส่งทีม “${team}” ไม่สำเร็จ: ${submitError.message}`)
    } finally {
      setSubmittingTeamId('')
    }
  }

  const reset = () => {
    if (!window.confirm(`คืนค่ารายชื่อเริ่มต้นของแผนก ${department} สำหรับวันนี้ใช่หรือไม่?`)) return
    setRows((current) => [
      ...current.filter((row) => !(row.project === selectedProject && row.date === selectedDate && row.department === department)),
      ...seedTeams[department].map((team) => makeRow(department, team, selectedDate, selectedProject)),
    ])
    notify('คืนค่ารายชื่อเริ่มต้นแล้ว')
  }

  const exportCsv = () => exportRowsCsv(visibleRows, selectedDate, department, notify, selectedProject)

  return (
    <>
      <main className="page-main">
      <section className="stats-grid" aria-label="สรุปจำนวนอาหาร">
        <StatCard label="มื้อเช้า" value={totals.morning.total} tone="morning" icon={UtensilsCrossed} />
        <StatCard label="มื้อเที่ยง" value={totals.lunch.total} tone="lunch" icon={UtensilsCrossed} />
        <StatCard label="มื้อเย็น" value={totals.dinner.total} tone="dinner" icon={UtensilsCrossed} />
        <StatCard label="มื้อดึก" value={totals.lateNight.total} tone="lateNight" icon={UtensilsCrossed} />
        <StatCard label="มื้อไม่ปกติ" value={totals.irregular.total} tone="irregular" icon={UtensilsCrossed} />
        <StatCard label="รวมทั้งหมด" value={totals.grand} tone="grand" icon={CheckCircle2} />
      </section>

      <section className="department-headcount-card" aria-label="จำนวนพนักงานในแผนกวันนี้">
        <div className="department-headcount-icon"><UsersRound size={25} /></div>
        <div className="department-headcount-copy">
          <span>จำนวนพนักงานใน DataForScan วันนี้</span>
          <strong>{department} · {projects[selectedProject].name}</strong>
          {headcount.error && <small className="headcount-error">ดึงข้อมูลไม่สำเร็จ: {headcount.error}</small>}
          {!headcount.error && <small>{headcount.date ? formatDate(headcount.date) : 'กำลังตรวจสอบข้อมูลล่าสุด'}</small>}
        </div>
        <div className="department-headcount-value">
          <strong>{headcount.loading ? '…' : (headcount.count ?? '—').toLocaleString('th-TH')}</strong>
          <span>คน</span>
        </div>
        <button type="button" disabled={headcount.loading} onClick={loadDepartmentHeadcount} title="อัปเดตจำนวนพนักงาน"><RotateCcw size={18} /></button>
      </section>

      <section className="workspace-card">
        <div className="workspace-heading">
          <div>
            <p>DAILY FOOD ORDER · {department}</p>
            <h2>รายการสั่งอาหารประจำวัน</h2>
          </div>
          <div className="actions">
            <button className="button secondary" onClick={exportCsv}><Download size={17} />ส่งออก CSV</button>
            <button className="button secondary" onClick={() => window.print()}><Printer size={17} />พิมพ์</button>
            <button className="button secondary" onClick={() => save(false)}><Save size={17} />บันทึก</button>
            <button className="button primary" disabled={submittingOrder || Boolean(submittingTeamId)} onClick={() => save(true)}><ClipboardCheck size={17} />{submittingOrder ? 'กำลังส่งข้อมูล...' : 'ยืนยันส่งโรงครัว'}</button>
          </div>
        </div>

        <div className="filters department-filters">
          <label className="control date-control">
            <span>วันที่รับอาหาร</span>
            <input type="date" value={selectedDate} onChange={(event) => changeDate(event.target.value)} />
          </label>
          <label className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาทีมงานหรือหมายเหตุ" />
          </label>
          <button className="button add" onClick={openAddTeam}><Plus size={18} />เพิ่มทีมงาน</button>
          <button className="icon-button" onClick={reset} title="คืนค่าเริ่มต้น"><RotateCcw size={18} /></button>
        </div>

        <div className="next-day-notice">
          <CalendarDays size={18} />
          <div><strong>สั่งวันนี้ สำหรับรับอาหารวันพรุ่งนี้</strong><span>ระบบเลือกวันที่ {formatDate(tomorrow())} เป็นค่าเริ่มต้น</span></div>
        </div>

        {previousDayTemplate.rows > 0 && (
          <div className="previous-day-template-notice">
            <RotateCcw size={18} />
            <div><strong>แสดงค่าจากวันก่อนหน้าเป็นค่าเริ่มต้นแล้ว</strong><span>{formatDate(previousDayTemplate.date)} · {previousDayTemplate.rows} ทีมงาน สามารถแก้ไขก่อนส่งโรงครัวได้</span></div>
          </div>
        )}

        {visibleRows.some((row) => row.status === 'sent') && (
          <div className="edit-after-submit-notice">
            <ClipboardCheck size={18} />
            <div>
              <strong>ข้อมูลนี้ส่งให้โรงครัวแล้ว แต่ยังแก้ไขได้</strong>
              <span>{latestSubmittedRow ? `ผู้บันทึก LID ${latestSubmittedRow.submittedByLid} · ` : ''}เมื่อแก้ไข สถานะจะกลับเป็นแบบร่าง กรุณากดยืนยันส่งโรงครัวอีกครั้ง</span>
            </div>
          </div>
        )}

        {pendingOrder && (
          <div className="pending-order-notice">
            <Clock3 size={19} />
            <div><strong>มีข้อมูลรอส่งอยู่ในเครื่อง</strong><span>บันทึกคิวเมื่อ {formatSubmittedAt(pendingOrder.queuedAt)} ข้อมูลจะไม่หายจนกว่าจะส่งสำเร็จ</span></div>
            <button type="button" disabled={submittingOrder} onClick={() => save(true)}>{submittingOrder ? 'กำลังส่ง...' : 'ส่งอีกครั้ง'}</button>
          </div>
        )}

        <div className="meal-visibility-controls" aria-label="เปิดหรือปิดช่วงมื้ออาหาร">
          <div className="meal-visibility-copy">
            <Eye size={18} />
            <div><strong>เลือกช่วงมื้อที่ต้องการกรอก</strong><span>ซ่อนเฉพาะหน้าจอ ข้อมูลเดิมไม่ถูกลบ</span></div>
          </div>
          <div className="meal-visibility-buttons">
            {Object.entries(periodLabels).map(([period, label]) => (
              <button key={period} type="button" className={`${period} ${visibleMeals[period] ? 'active' : ''}`} aria-pressed={visibleMeals[period]} onClick={() => toggleMealVisibility(period)}>
                {visibleMeals[period] ? <Eye size={16} /> : <EyeOff size={16} />}{label}
              </button>
            ))}
            <button type="button" className="show-all" onClick={() => applyVisibleMeals(Object.fromEntries(MEAL_PERIODS.map((period) => [period, true])))}>แสดงทั้งหมด</button>
            <button type="button" className="show-all" onClick={() => applyVisibleMeals(defaultVisibleMeals())}>เฉพาะ 3 มื้อหลัก</button>
          </div>
        </div>

        <div className="legend">
          <span><i className="dot canteen-dot" />ทานที่โรงครัว</span>
          <span><i className="dot packed-dot" />ข้าวห่อ (ข้าวเหนียว + ข้าวจ้าว)</span>
          <span>{visibleRows.length.toLocaleString('th-TH')} ทีมงาน</span>
        </div>

        {visibleRows.length ? (
          <section className="department-card">
            <button className="department-head" onClick={() => setCollapsed((current) => !current)}>
              <span className="department-icon"><Building2 size={19} /></span>
              <span className="department-name"><strong>{department}</strong><small>{visibleRows.length} ทีมงาน</small></span>
              <span className="department-total"><small>รวมแผนก</small><strong>{totals.grand.toLocaleString('th-TH')} ชุด</strong></span>
              <ChevronDown className={collapsed ? 'chevron collapsed' : 'chevron'} size={20} />
            </button>
            {!collapsed && (
              <OrderTable
                rows={visibleRows}
                visibleMeals={visibleMeals}
                deliveryPoints={deliveryPoints}
                updateRow={updateRow}
                updateMeal={updateMeal}
                removeRow={removeRow}
                submitTeam={submitTeam}
                submittingOrder={submittingOrder}
                submittingTeamId={submittingTeamId}
              />
            )}
          </section>
        ) : (
          <div className="empty-state"><Search size={30} /><strong>ไม่พบรายการ</strong><span>ลองเปลี่ยนวันที่หรือคำค้นหา</span></div>
        )}
      </section>
      </main>

      {showAddTeam && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowAddTeam(false)
        }}>
          <section className="team-modal" role="dialog" aria-modal="true" aria-labelledby="add-team-title">
            <header className="team-modal-header">
              <div className="team-modal-icon"><Plus size={22} /></div>
              <div>
                <p>ADD NEW TEAM</p>
                <h3 id="add-team-title">เพิ่มทีมงานใหม่</h3>
              </div>
              <button className="modal-close" type="button" onClick={() => setShowAddTeam(false)} aria-label="ปิด"><X size={20} /></button>
            </header>

            <form onSubmit={addTeam}>
              <div className="modal-department">
                <Building2 size={18} />
                <div><small>เพิ่มทีมงานในแผนก</small><strong>{department}</strong></div>
              </div>
              <label className="modal-control">
                <span>ชื่อทีมงาน <i>*</i></span>
                <input
                  autoFocus
                  value={newTeamName}
                  onChange={(event) => { setNewTeamName(event.target.value); setAddTeamError('') }}
                  placeholder="เช่น ทีมงานกะ 1"
                />
              </label>
              {addTeamError && <div className="modal-error" role="alert">{addTeamError}</div>}
              <p className="modal-hint">ทีมงานใหม่จะถูกเพิ่มในวันที่เลือกอยู่ กรุณากดบันทึกข้อมูลหลังเพิ่ม</p>
              <footer className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setShowAddTeam(false)}>ยกเลิก</button>
                <button className="button primary" type="submit"><Plus size={17} />เพิ่มทีมงาน</button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {submissionReceipt && (
        <div className="modal-backdrop receipt-backdrop">
          <section className="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
            <div className="receipt-check"><CheckCircle2 size={39} /></div>
            <p>ORDER SUBMITTED</p>
            <h3 id="receipt-title">ส่งข้อมูลให้โรงครัวแล้ว</h3>
            <div className="receipt-details">
              <div><span>วันที่รับอาหาร</span><strong>{formatDate(submissionReceipt.orderDate)}</strong></div>
              {submissionReceipt.team && <div><span>ทีมงานที่ส่ง</span><strong>{submissionReceipt.team}</strong></div>}
              <div><span>บันทึกลงฐานข้อมูล</span><strong>{submissionReceipt.target || submissionReceipt.sheet} · {submissionReceipt.saved} ทีมงาน</strong></div>
              <div><span>ผู้บันทึกส่งโรงครัว</span><strong>{submissionReceipt.submittedByLid ? `LID ${submissionReceipt.submittedByLid}` : 'บัญชีแผนก'}{submissionReceipt.submittedByName ? ` · ${submissionReceipt.submittedByName}` : ''}</strong></div>
              <div className="receipt-time"><span>วันที่และเวลาที่ส่งข้อมูล</span><strong>{formatSubmittedAt(submissionReceipt.submittedAt)}</strong></div>
            </div>
            <button className="button primary" onClick={() => setSubmissionReceipt(null)}>รับทราบ</button>
          </section>
        </div>
      )}
    </>
  )
}

function OrderTable({ rows, visibleMeals, deliveryPoints, updateRow, updateMeal, removeRow, submitTeam, submittingOrder, submittingTeamId }) {
  return (
    <div className="table-scroll">
      <table className="order-entry-table">
        <thead>
          <tr>
            <th rowSpan="2" className="sticky-col team-col">ทีมงาน</th>
            {Object.entries(periodLabels).map(([period, label]) => <th key={period} colSpan="6" className={`meal-head ${period}-head ${visibleMeals[period] ? '' : 'meal-hidden'}`}>{label}</th>)}
            <th rowSpan="2" className="grand-head">รวม</th>
            <th rowSpan="2">หมายเหตุ</th>
            <th rowSpan="2">สถานะ</th>
            <th rowSpan="2" className="order-action-head">ส่ง / ลบ</th>
          </tr>
          <tr>
            {MEAL_PERIODS.flatMap((period) => {
              const visibility = visibleMeals[period] ? '' : ' meal-hidden'
              return [
                <th key={`${period}-canteen`} className={`subhead canteen group-start ${period}${visibility}`}>โรงครัว</th>,
                <th key={`${period}-sticky`} className={`subhead packed${visibility}`}>ข้าวเหนียว</th>,
                <th key={`${period}-rice`} className={`subhead packed${visibility}`}>ข้าวจ้าว</th>,
                <th key={`${period}-pack-total`} className={`subhead pack-total${visibility}`}>รวมห่อ</th>,
                <th key={`${period}-point`} className={`subhead delivery-subhead${visibility}`}>ส่งห่อที่</th>,
                <th key={`${period}-total`} className={`subhead meal-total${visibility}`}>รวมมื้อ</th>,
              ]
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="sticky-col team-cell">
                <input value={row.team} onChange={(event) => updateRow(row.id, { team: event.target.value })} aria-label="ชื่อทีมงาน" />
              </td>
              {MEAL_PERIODS.flatMap((period) => {
                const visibility = visibleMeals[period] ? '' : ' meal-hidden'
                const currentPoint = row[period].point || ''
                const pointIsActive = deliveryPoints.some((point) => point.toLocaleLowerCase('th') === currentPoint.toLocaleLowerCase('th'))
                return [
                  <td key={`${period}-canteen`} className={`group-start ${period}${visibility}`}><QuantityInput value={row[period].canteen} label={`${row.team} ${period} โรงครัว`} onChange={(value) => updateMeal(row.id, period, 'canteen', value)} /></td>,
                  <td key={`${period}-sticky`} className={`packed-cell${visibility}`}><QuantityInput value={row[period].sticky} label={`${row.team} ${period} ข้าวเหนียว`} onChange={(value) => updateMeal(row.id, period, 'sticky', value)} /></td>,
                  <td key={`${period}-rice`} className={`packed-cell${visibility}`}><QuantityInput value={row[period].rice} label={`${row.team} ${period} ข้าวจ้าว`} onChange={(value) => updateMeal(row.id, period, 'rice', value)} /></td>,
                  <td key={`${period}-pack-total`} className={`calc pack-calc${visibility}`}>{packed(row[period])}</td>,
                  <td key={`${period}-point`} className={`delivery-cell${visibility}`}>
                    <select
                      className={row[period].point ? 'delivery-select' : 'delivery-select empty'}
                      value={row[period].point || ''}
                      disabled={packed(row[period]) === 0}
                      title={packed(row[period]) === 0 ? 'ระบุจำนวนข้าวห่อก่อนจึงเลือกจุดส่งได้' : ''}
                      onChange={(event) => updateMeal(row.id, period, 'point', event.target.value)}
                      aria-label={`จุดส่งข้าวห่อ ${periodLabels[period]} ของทีม ${row.team}`}
                    >
                      <option value="">{packed(row[period]) === 0 ? 'ไม่มีห่อ' : '— เลือก —'}</option>
                      {currentPoint && !pointIsActive && <option value={currentPoint} disabled>{currentPoint} (ยกเลิกแล้ว)</option>}
                      {deliveryPoints.map((point) => (
                        <option key={point} value={point}>{deliveryPointShort[point] || point}</option>
                      ))}
                    </select>
                  </td>,
                  <td key={`${period}-total`} className={`calc ${period}-calc${visibility}`}>{mealTotal(row[period])}</td>,
                ]
              })}
              <td className="calc row-total">{rowTotal(row)}</td>
              <td><NoteInput value={row.note} onChange={(value) => updateRow(row.id, { note: value })} /></td>
              <td>
                <select className={`status ${row.status}`} value={row.status} onChange={(event) => updateRow(row.id, { status: event.target.value })}>
                  <option value="draft">แบบร่าง</option>
                  <option value="confirmed">ยืนยันแล้ว</option>
                  <option value="sent" disabled>ส่งโรงครัวแล้ว (ใช้ปุ่มยืนยันส่งโรงครัว)</option>
                </select>
              </td>
              <td className="row-actions-cell">
                <div className="row-actions">
                  <button
                    type="button"
                    className={`team-submit-button ${row.status === 'sent' ? 'sent' : ''}`}
                    disabled={submittingOrder || Boolean(submittingTeamId)}
                    onClick={() => submitTeam(row)}
                    title={`ส่งเฉพาะทีม ${row.team} ให้โรงครัว`}
                  >
                    {submittingTeamId === row.id
                      ? <Clock3 size={16} />
                      : row.status === 'sent'
                        ? <CheckCircle2 size={16} />
                        : <ClipboardCheck size={16} />}
                    <span>{submittingTeamId === row.id ? 'กำลังส่ง...' : row.status === 'sent' ? 'ส่งอีกครั้ง' : 'ส่งทีมนี้'}</span>
                  </button>
                  <button className="delete-button" onClick={() => removeRow(row.id, row.team)} title="ลบรายการ"><Trash2 size={17} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * ค่าคุมการพิมพ์ยอดสรุปข้าว A3 แนวนอน
 *
 * ไม่เกิน PRINT_ROWS_PER_PAGE จะใช้หน้าเดียว ถ้ามากกว่านั้นจะแบ่งเป็น 2 หน้าจริง
 * และคำนวณความสูงแถวจากพื้นที่แนวตั้งที่มี ทำให้ตารางเต็มกระดาษโดยไม่ต้อง zoom
 * ทั้งหน้าจนตัวหนังสือและตารางไปกองอยู่ด้านบนเหมือนระบบเดิม
 */
const PRINT_ROWS_PER_PAGE = 54
const PRINT_FOOTER_ROWS = 2
const PRINT_BODY_HEIGHT_MM = 238
const PRINT_MAX_ROW_HEIGHT_MM = 10

function KitchenSummaryTable({ items, totals, submittedRows, showGrandTotal = true }) {
  return (
    <table className="summary-table">
      <thead>
        <tr>
          <th rowSpan="2" className="summary-department">แผนก</th>
          <th rowSpan="2" className="summary-units">หน่วยงาน / ทีมงาน</th>
          <th rowSpan="2" className="summary-status-head">สถานะ / วันที่ส่ง / ผู้บันทึก</th>
          {Object.entries(periodLabels).map(([period, label]) => <th key={period} colSpan="6" className={`meal-head ${period}-head`}>{label}</th>)}
          <th rowSpan="2" className="grand-head">รวมทั้งหมด</th>
          <th rowSpan="2" className="summary-note-head">หมายเหตุ</th>
        </tr>
        <tr>
          {MEAL_PERIODS.flatMap((period) => [
            <th key={`${period}-canteen`} className={`summary-subhead group-start ${period}`}>โรงครัว</th>,
            <th key={`${period}-sticky`} className="summary-subhead packed">ข้าวเหนียว</th>,
            <th key={`${period}-rice`} className="summary-subhead packed">ข้าวจ้าว</th>,
            <th key={`${period}-pack-total`} className="summary-subhead pack-total">รวมห่อข้าว</th>,
            <th key={`${period}-point`} className="summary-subhead delivery-subhead">ส่งห่อที่</th>,
            <th key={`${period}-total`} className="summary-subhead total">รวมมื้อ</th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const showSubtotal = item.printSubtotal !== false
          const subtotalRows = item.printAllTeamRows || item.teamRows
          const departmentRowSpan = item.teamRows.length + (showSubtotal ? 1 : 0)
          const departmentLabel = item.printContinued ? `${item.department} (ต่อ)` : item.department
          return (
            <Fragment key={`${item.department}-${item.printPart || 'all'}`}>
              {item.teamRows.map((teamRow, index) => (
                <tr key={teamRow.id} className="team-summary-row">
                  {index === 0 && (
                    <td className="summary-department-cell" rowSpan={departmentRowSpan}>
                      <Building2 size={17} />
                      <div><strong>{departmentLabel}</strong><small>{item.teams} ทีมงาน</small></div>
                    </td>
                  )}
                  <td className="summary-unit-name">{teamRow.team}</td>
                  <td>
                    <div className="submission-info">
                      <span className={`submission-status ${teamRow.status === 'sent' ? 'complete' : teamRow.status === 'confirmed' ? 'partial' : ''}`}>{statusText[teamRow.status]}</span>
                      {teamRow.submittedAt && <small className="submission-time">{formatSubmittedAt(teamRow.submittedAt)}</small>}
                      {teamRow.submittedByLid && <small className="submission-user"><strong>LID {teamRow.submittedByLid}</strong>{teamRow.submittedByName ? ` · ${teamRow.submittedByName}` : ''}</small>}
                    </div>
                  </td>
                  {MEAL_PERIODS.flatMap((period) => [
                    <td key={`${period}-canteen`} className={`group-start ${period}`}>{number(teamRow[period].canteen)}</td>,
                    <td key={`${period}-sticky`} className="summary-packed">{number(teamRow[period].sticky)}</td>,
                    <td key={`${period}-rice`} className="summary-packed">{number(teamRow[period].rice)}</td>,
                    <td key={`${period}-pack-total`} className="summary-pack-total">{packed(teamRow[period])}</td>,
                    <td key={`${period}-point`} className={`summary-delivery ${packed(teamRow[period]) && teamRow[period].point ? '' : 'empty'}`}>{packed(teamRow[period]) ? (teamRow[period].point || 'ยังไม่ระบุ') : '—'}</td>,
                    <td key={`${period}-total`} className={`summary-meal-total ${period}`}>{mealTotal(teamRow[period])}</td>,
                  ])}
                  <td className="summary-grand-total">{rowTotal(teamRow).toLocaleString('th-TH')}</td>
                  <td className={`summary-note ${teamRow.note ? '' : 'empty'}`}>{teamRow.note || '—'}</td>
                </tr>
              ))}
              {showSubtotal && (
                <tr className="department-subtotal-row">
                  {!item.teamRows.length && (
                    <td className="summary-department-cell">
                      <div><strong>{departmentLabel}</strong><small>{item.teams} ทีมงาน</small></div>
                    </td>
                  )}
                  <td><strong>รวม {item.department}</strong></td>
                  <td><span className={`submission-status ${item.sent === item.teams ? 'complete' : item.sent ? 'partial' : ''}`}>{item.sent}/{item.teams} ส่งแล้ว</span></td>
                  {MEAL_PERIODS.flatMap((period) => [
                    <td key={`${period}-canteen`} className={`subtotal-value group-start ${period}`}>{item.totals[period].canteen}</td>,
                    <td key={`${period}-sticky`} className={`subtotal-value ${period} packed`}>{item.totals[period].sticky}</td>,
                    <td key={`${period}-rice`} className={`subtotal-value ${period} packed`}>{item.totals[period].rice}</td>,
                    <td key={`${period}-pack-total`} className="subtotal-pack-total">{item.totals[period].sticky + item.totals[period].rice}</td>,
                    <td key={`${period}-point`} className="subtotal-note">{new Set(subtotalRows.filter((row) => packed(row[period])).map((row) => row[period].point).filter(Boolean)).size} จุด</td>,
                    <td key={`${period}-total`} className={`subtotal-meal-total ${period}`}>{item.totals[period].total}</td>,
                  ])}
                  <td className="subtotal-grand">{item.totals.grand.toLocaleString('th-TH')}</td>
                  <td className="subtotal-note">รวม {subtotalRows.filter((row) => row.note).length} หมายเหตุ</td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
      {showGrandTotal && (
        <tfoot>
          <tr>
            <td colSpan="3"><strong>รวมทุกแผนก</strong></td>
            {MEAL_PERIODS.flatMap((period) => [
              <td key={`${period}-canteen`} className={`group-start ${period}`}>{totals[period].canteen}</td>,
              <td key={`${period}-sticky`}>{totals[period].sticky}</td>,
              <td key={`${period}-rice`}>{totals[period].rice}</td>,
              <td key={`${period}-pack-total`} className="footer-pack-total">{totals[period].sticky + totals[period].rice}</td>,
              <td key={`${period}-point`}>{new Set(submittedRows.filter((row) => packed(row[period])).map((row) => row[period].point).filter(Boolean)).size} จุด</td>,
              <td key={`${period}-total`} className={`footer-meal-total ${period}`}>{totals[period].total}</td>,
            ])}
            <td>{totals.grand.toLocaleString('th-TH')}</td>
            <td>{submittedRows.filter((row) => row.note).length.toLocaleString('th-TH')} หมายเหตุ</td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}

function KitchenDashboard({
  selectedDate,
  reportDate,
  selectedProject,
  changeDate,
  rows,
  deliveryPoints,
  deliveryPointDataState,
  onAddDeliveryPoint,
  onRenameDeliveryPoint,
  onDeleteDeliveryPoint,
  notify,
}) {
  const [adminView, setAdminView] = useState('summary')
  const [query, setQuery] = useState('')
  const [showAddDeliveryPoint, setShowAddDeliveryPoint] = useState(false)
  const [editingDeliveryPoint, setEditingDeliveryPoint] = useState('')
  const [registeredUsers, setRegisteredUsers] = useState(loadUsers)
  const [userQuery, setUserQuery] = useState('')
  const [showAdminSignup, setShowAdminSignup] = useState(false)
  // ข้อมูลพนักงานดึงสดจาก Supabase ทุกครั้งที่เปิดหน้า User (ไม่เก็บ cache ในเครื่อง
  // เพราะ 1,800+ แถวกิน localStorage เกินโควตาเมื่อรวมกับข้อมูลออเดอร์)
  const [employees, setEmployees] = useState([])
  const [employeeSyncState, setEmployeeSyncState] = useState({ loading: false, error: '' })
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [userSyncState, setUserSyncState] = useState({ loading: false, message: '', error: '' })
  const [userToDelete, setUserToDelete] = useState(null)
  const [deletingUser, setDeletingUser] = useState(false)
  const [deleteUserError, setDeleteUserError] = useState('')
  const [projectHeadcount, setProjectHeadcount] = useState({ loading: true, count: null, departmentCounts: {}, date: '', error: '' })
  const dayRows = useMemo(() => rows.filter((row) => row.project === selectedProject && row.date === selectedDate), [rows, selectedDate, selectedProject])
  const reportDayRows = useMemo(() => rows.filter((row) => row.project === selectedProject && row.date === reportDate), [rows, reportDate, selectedProject])
  const submittedDayRows = useMemo(() => dayRows.filter(isKitchenSubmitted), [dayRows])
  const submittedReportDayRows = useMemo(() => reportDayRows.filter(isKitchenSubmitted), [reportDayRows])
  const totals = useMemo(() => summarizeRows(submittedDayRows), [submittedDayRows])
  const reportTotals = useMemo(() => summarizeRows(submittedReportDayRows), [submittedReportDayRows])
  const summaries = useMemo(() => departments.map((department) => {
    const departmentRows = dayRows.filter((row) => row.department === department)
    const submittedDepartmentRows = departmentRows.filter(isKitchenSubmitted)
    return {
      department,
      teams: departmentRows.length,
      teamRows: departmentRows.map((row) => isKitchenSubmitted(row) ? row : {
        ...row,
        morning: emptyMeal(),
        lunch: emptyMeal(),
        dinner: emptyMeal(),
        lateNight: emptyMeal(),
        irregular: emptyMeal(),
        note: '',
        status: row.status === 'confirmed' ? 'confirmed' : 'draft',
        submittedAt: null,
        submittedByLid: '',
        submittedByName: '',
      }),
      sent: submittedDepartmentRows.length,
      totals: summarizeRows(submittedDepartmentRows),
    }
  }).filter((item) => !query.trim() || item.department.toLowerCase().includes(query.trim().toLowerCase())), [dayRows, query])
  /**
   * แผนหน้าพิมพ์ A3 — สร้างตารางแยกเป็นหน้าจริงเพื่อให้จุดตัดหน้าแน่นอน
   * และปรับความสูงแถวของแต่ละหน้าตามจำนวนข้อมูลในหน้านั้น
   */
  const printLayout = useMemo(() => {
    const bodyRows = summaries.reduce((sum, item) => sum + item.teamRows.length + 1, 0)
    const totalRows = bodyRows + PRINT_FOOTER_ROWS
    let pageItems = [summaries]

    if (totalRows > PRINT_ROWS_PER_PAGE && summaries.length > 1) {
      let bestSplitIndex = 1
      let smallestDifference = Number.POSITIVE_INFINITY
      for (let index = 1; index < summaries.length; index += 1) {
        const firstPageRows = summaries.slice(0, index).reduce((sum, item) => sum + item.teamRows.length + 1, 0)
        const secondPageRows = bodyRows - firstPageRows + PRINT_FOOTER_ROWS
        const difference = Math.abs(firstPageRows - secondPageRows)
        if (difference < smallestDifference) {
          smallestDifference = difference
          bestSplitIndex = index
        }
      }
      pageItems = [summaries.slice(0, bestSplitIndex), summaries.slice(bestSplitIndex)]
    } else if (totalRows > PRINT_ROWS_PER_PAGE && summaries.length === 1 && summaries[0].teamRows.length > 1) {
      const item = summaries[0]
      const splitAt = Math.min(item.teamRows.length - 1, Math.max(1, Math.ceil((item.teamRows.length + PRINT_FOOTER_ROWS + 1) / 2)))
      pageItems = [
        [{
          ...item,
          teamRows: item.teamRows.slice(0, splitAt),
          printSubtotal: false,
          printPart: 1,
        }],
        [{
          ...item,
          teamRows: item.teamRows.slice(splitAt),
          printAllTeamRows: item.teamRows,
          printContinued: true,
          printPart: 2,
        }],
      ]
    }

    const pages = pageItems.map((items, index) => {
      const isLastPage = index === pageItems.length - 1
      const rowCount = items.reduce((sum, item) => sum + item.teamRows.length + (item.printSubtotal === false ? 0 : 1), 0)
        + (isLastPage ? PRINT_FOOTER_ROWS : 0)
      const rowHeight = Math.floor(Math.min(PRINT_MAX_ROW_HEIGHT_MM, PRINT_BODY_HEIGHT_MM / Math.max(rowCount, 1)) * 100) / 100
      const fontSize = Math.floor(Math.min(6.5, Math.max(2.8, rowHeight * 1.25)) * 100) / 100
      const headerHeight = Math.floor(Math.min(8, Math.max(4, rowHeight)) * 100) / 100
      return { items, rowCount, rowHeight, fontSize, headerHeight, showGrandTotal: isLastPage }
    })

    return { pages }
  }, [summaries])

  const loadProjectHeadcount = async () => {
    setProjectHeadcount((current) => ({ ...current, loading: true, error: '' }))

    // Supabase ก่อน (ข้อมูล sync จากชีต dataforscan1 อัตโนมัติอยู่แล้ว)
    if (supabaseConfigured()) {
      try {
        const { total, counts } = await countEmployeesByDepartment({ location: locationOfProject(selectedProject) })
        const departmentCounts = Object.fromEntries(Object.entries(counts)
          .map(([name, value]) => [normalizeDepartmentName(name), value]))
        setProjectHeadcount({ loading: false, count: total, departmentCounts, date: bangkokToday(), error: '' })
        return
      } catch {
        // Supabase ใช้ไม่ได้ -> ถอยไปทาง Apps Script ข้างล่าง
      }
    }

    try {
      const payload = await getFromScript('getProjectHeadcount', { projectId: selectedProject === 'sekong' ? 'xekong' : 'xepon' })
      setProjectHeadcount({ loading: false, count: Number(payload.count) || 0, departmentCounts: payload.departmentCounts || {}, date: payload.date || '', error: '' })
    } catch (headcountError) {
      try {
        const fallback = await getFromScript('getDataForScan')
        const projectRows = (fallback.rows || []).filter((row) => locationMatchesProject(row[7], selectedProject))
        const uniqueLids = new Set(projectRows.map((row) => String(row[1] ?? '').trim().toLowerCase()).filter(Boolean))
        const departmentLids = projectRows.reduce((result, row) => {
          const rowDepartment = normalizeDepartmentName(row[6])
          const lid = String(row[1] ?? '').trim().toLowerCase()
          if (!rowDepartment || !lid) return result
          if (!result[rowDepartment]) result[rowDepartment] = new Set()
          result[rowDepartment].add(lid)
          return result
        }, {})
        const departmentCounts = Object.fromEntries(Object.entries(departmentLids).map(([name, lids]) => [name, lids.size]))
        setProjectHeadcount({ loading: false, count: uniqueLids.size, departmentCounts, date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }), error: '' })
      } catch (fallbackError) {
        setProjectHeadcount({ loading: false, count: null, departmentCounts: {}, date: '', error: fallbackError.message || headcountError.message })
      }
    }
  }

  useEffect(() => {
    loadProjectHeadcount()
  }, [selectedProject, reportDate])

  const allMealTotal = totals.grand
  const totalStickyRice = MEAL_PERIODS.reduce((sum, period) => sum + totals[period].sticky, 0)
  const totalPlainRice = MEAL_PERIODS.reduce((sum, period) => sum + totals[period].rice, 0)
  const totalPackedRice = totalStickyRice + totalPlainRice
  const peopleEquivalent = headcountFromMeals(totals)
  const peopleDifference = projectHeadcount.count === null ? null : peopleEquivalent - projectHeadcount.count
  const departmentReportRows = useMemo(() => departments.map((departmentName) => {
    const departmentRows = reportDayRows.filter((row) => row.department === departmentName)
    const submittedDepartmentRows = departmentRows.filter(isKitchenSubmitted)
    const departmentTotals = summarizeRows(submittedDepartmentRows)
    const employeeCount = Number(projectHeadcount.departmentCounts[departmentName]) || 0
    const equivalentPeople = headcountFromMeals(departmentTotals)
    const packedTotal = MEAL_PERIODS.reduce((sum, period) => sum + departmentTotals[period].sticky + departmentTotals[period].rice, 0)
    return {
      department: departmentName,
      employeeCount,
      morning: departmentTotals.morning.total,
      lunch: departmentTotals.lunch.total,
      dinner: departmentTotals.dinner.total,
      lateNight: departmentTotals.lateNight.total,
      irregular: departmentTotals.irregular.total,
      packedTotal,
      orderTotal: departmentTotals.grand,
      equivalentPeople,
      difference: equivalentPeople - employeeCount,
      sent: submittedDepartmentRows.length,
      teams: departmentRows.length,
      submittedByLids: [...new Set(submittedDepartmentRows.map((row) => row.submittedByLid).filter(Boolean))],
    }
  }), [reportDayRows, projectHeadcount.departmentCounts])
  const reportEmployeeTotal = departmentReportRows.reduce((sum, row) => sum + row.employeeCount, 0)
  const reportAllMealTotal = reportTotals.grand
  const reportPackedTotal = MEAL_PERIODS.reduce((sum, period) => sum + reportTotals[period].sticky + reportTotals[period].rice, 0)

  const exportDepartmentReport = () => {
    const headers = ['วันที่รับอาหาร', 'โครงการ', 'แผนก', 'จำนวนพนักงาน', 'มื้อเช้า', 'มื้อเที่ยง', 'มื้อเย็น', 'มื้อดึก', 'มื้อไม่ปกติ', 'รวมข้าวห่อ', `ยอดรวม ${MEAL_PERIODS.length} มื้อ`, 'หัวคน (มื้อสูงสุด)', 'ส่วนต่างจากพนักงาน', 'ทีมส่งแล้ว', 'ทีมทั้งหมด', 'LID ผู้บันทึก']
    const reportData = departmentReportRows.map((row) => [reportDate, projects[selectedProject].name, row.department, row.employeeCount, row.morning, row.lunch, row.dinner, row.lateNight, row.irregular, row.packedTotal, row.orderTotal, formatCalculatedNumber(row.equivalentPeople), formatCalculatedNumber(row.difference), row.sent, row.teams, row.submittedByLids.join(', ')])
    const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = `\ufeff${[headers, ...reportData].map((line) => line.map(cell).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedProject}-department-order-report-${reportDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
    notify('ส่งออกรายงานตามแผนกแล้ว')
  }

  const projectUsers = registeredUsers.filter((user) => projectFromLocation(user.location) === selectedProject)
  const visibleUsers = projectUsers.filter((user) => {
    const search = userQuery.trim().toLowerCase()
    if (!search) return true
    return [user.lid, user.title, user.firstName, user.lastName, user.fullName, user.position, user.department, user.location, user.company]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search)
  })

  const createUser = (user) => {
    const nextUsers = [...registeredUsers.filter((item) => item.lid !== user.lid), user]
    localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers))
    setRegisteredUsers(nextUsers)
    setShowAdminSignup(false)
    notify(`เพิ่มผู้ใช้งาน LID ${user.lid} แล้ว`)
  }

  const removeUser = async () => {
    const user = userToDelete
    if (!user) return
    const displayName = user.lid || user.username
    setDeletingUser(true)
    setDeleteUserError('')
    try {
      if (!user.isDemo) {
        if (supabaseConfigured()) await deleteAppUser(displayName, ADMIN_PIN)
        else if (configuredApiUrl()) await postToScript('deleteUser', { lid: displayName, adminPin: ADMIN_PIN })
      }
      if (user.isDemo) {
        const deletedDemoLids = JSON.parse(localStorage.getItem(DELETED_DEMO_USERS_KEY) || '[]')
        localStorage.setItem(DELETED_DEMO_USERS_KEY, JSON.stringify([...new Set([...deletedDemoLids, displayName])]))
      }
      const nextUsers = registeredUsers.filter((item) => item.id !== user.id)
      localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers))
      setRegisteredUsers(nextUsers)
      setUserToDelete(null)
      notify('ลบผู้ใช้งานแล้ว')
    } catch (removeError) {
      setDeleteUserError(`ลบไม่สำเร็จ: ${removeError.message}`)
    } finally {
      setDeletingUser(false)
    }
  }

  /** รวมบัญชีจากฐานข้อมูลเข้ากับบัญชี demo ในเครื่อง แล้วเก็บลง localStorage เพื่อใช้ตอนล็อกอิน */
  const applyRemoteUsers = (remoteUsers) => {
    const preservedUsers = registeredUsers.filter((user) => user.isDemo
      || projectFromLocation(user.location) !== selectedProject)
    const nextUsers = [...preservedUsers, ...remoteUsers]
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers))
    } catch {
      // พื้นที่เต็ม — ใช้ข้อมูลในหน่วยความจำต่อได้
    }
    setRegisteredUsers(nextUsers)
  }

  const syncUsers = async () => {
    if (!supabaseConfigured() && !configuredApiUrl()) {
      setUserSyncState({ loading: false, message: '', error: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล' })
      return
    }
    setUserSyncState({ loading: true, message: '', error: '' })
    try {
      const source = supabaseConfigured() ? 'Supabase' : 'Google Sheets'
      let remoteUsers = []
      if (supabaseConfigured()) {
        remoteUsers = await fetchAppUsers({ project: selectedProject })
      } else {
        const payload = await getFromScript('getUsers', { projectId: selectedProject === 'sekong' ? 'xekong' : 'xepon' })
        remoteUsers = Array.isArray(payload.users) ? payload.users : []
      }
      applyRemoteUsers(remoteUsers)
      setUserSyncState({ loading: false, message: `อัปเดตจาก ${source} สำเร็จ ${remoteUsers.length.toLocaleString('th-TH')} บัญชี`, error: '' })
      notify(`อัปเดต User จาก ${source} แล้ว`)
    } catch (syncError) {
      setUserSyncState({ loading: false, message: '', error: `ดึง User ไม่สำเร็จ: ${syncError.message}` })
    }
  }

  // เปิดหน้า User หรือสลับโครงการ -> ดึงบัญชีผู้ใช้จาก Supabase ให้เองเงียบๆ
  // (ไม่ต้องรอผู้ใช้กดปุ่ม "ดึง User" อีก)
  useEffect(() => {
    if (adminView !== 'users' || !supabaseConfigured()) return undefined
    let active = true
    fetchAppUsers({ project: selectedProject })
      .then((remoteUsers) => { if (active) applyRemoteUsers(remoteUsers) })
      .catch(() => {
        // เงียบไว้ — ยังมีปุ่ม "ดึง User" ให้กดเองพร้อมข้อความ error เต็ม
      })
    return () => { active = false }
  }, [adminView, selectedProject])

  // เปิดหน้า User หรือสลับโครงการ -> ดึงข้อมูลพนักงานจากตาราง employees ใน Supabase
  useEffect(() => {
    if (adminView !== 'users') return undefined
    if (!supabaseConfigured()) {
      setEmployeeSyncState({ loading: false, error: 'ยังไม่ได้ตั้งค่า Supabase ในไฟล์ .env' })
      return undefined
    }
    let active = true
    setEmployeeSyncState({ loading: true, error: '' })
    // กรองด้วย location ตรงตัว (ไม่ใช้ project) + เอาแค่คนที่ Status = Work
    fetchEmployees({ location: locationOfProject(selectedProject), activeOnly: true })
      .then((rows) => {
        if (!active) return
        setEmployees(rows)
        setEmployeeSyncState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (active) setEmployeeSyncState({ loading: false, error: error.message })
      })
    return () => { active = false }
  }, [adminView, selectedProject])

  // ฝั่ง Supabase กรอง project + Status = Work มาให้แล้ว
  // เผื่อมีข้อมูลเก่าค้างในหน่วยความจำ กรอง Off ออกอีกชั้นเพื่อความแน่นอน
  const projectEmployees = employees.filter((employee) => employee.isActive !== false)
  const visibleEmployees = projectEmployees.filter((employee) => {
    const search = employeeQuery.trim().toLowerCase()
    return !search || Object.values(employee).join(' ').toLowerCase().includes(search)
  })

  if (adminView === 'delivery-points') {
    return (
      <main className="page-main admin-main delivery-points-main">
        <nav className="admin-view-tabs" aria-label="เมนู Admin">
          <button type="button" onClick={() => setAdminView('summary')}><UtensilsCrossed size={19} /><span>ยอดสรุปข้าว</span></button>
          <button type="button" onClick={() => setAdminView('department-report')}><Building2 size={19} /><span>รายงานตามแผนก</span></button>
          <button type="button" className="active" onClick={() => setAdminView('delivery-points')}><MapPin size={19} /><span>สถานที่ส่ง</span><i>{deliveryPoints.length}</i></button>
          <button type="button" onClick={() => setAdminView('users')}><UsersRound size={19} /><span>User</span><i>{registeredUsers.length}</i></button>
        </nav>

        <section className="workspace-card delivery-points-workspace">
          <div className="workspace-heading">
            <div>
              <p>DELIVERY LOCATION MANAGEMENT · {projects[selectedProject].shortName}</p>
              <h2>จัดการสถานที่ส่งข้าวห่อ</h2>
            </div>
            <div className="actions">
              <button className="button primary" type="button" onClick={() => { setEditingDeliveryPoint(''); setShowAddDeliveryPoint(true) }}><Plus size={17} />เพิ่มสถานที่ส่ง</button>
            </div>
          </div>

          <div className="delivery-points-admin-note">
            <div className="delivery-points-admin-icon"><ShieldCheck size={23} /></div>
            <div>
              <strong>เฉพาะแอดมินโรงครัวเท่านั้นที่เพิ่ม แก้ไข หรือลบสถานที่ได้</strong>
              <span>{deliveryPointDataState.loading
                ? 'กำลังโหลดรายการจากฐานข้อมูล Supabase...'
                : deliveryPointDataState.source === 'database'
                  ? 'เชื่อมต่อฐานข้อมูล Supabase แล้ว · การแก้ไขหรือลบไม่เปลี่ยนคำสั่งซื้อย้อนหลัง'
                  : 'กำลังใช้ข้อมูลสำรองในเครื่อง · ต้องตั้งค่า Supabase เพื่อแชร์ข้อมูลทุกเครื่อง'}</span>
            </div>
            <b>{deliveryPoints.length.toLocaleString('th-TH')} สถานที่</b>
          </div>

          {deliveryPointDataState.error && (
            <div className="employee-sync-message error delivery-point-sync-error" role="alert">
              โหลดฐานข้อมูลสถานที่ส่งไม่สำเร็จ: {deliveryPointDataState.error}
            </div>
          )}

          {deliveryPoints.length ? (
            <div className="delivery-points-admin-grid" aria-label="รายการสถานที่ส่ง">
              {deliveryPoints.map((point, index) => {
              const isDefault = defaultDeliveryPoints.some((item) => item.toLocaleLowerCase('th') === point.toLocaleLowerCase('th'))
              return (
                <article key={point} className="delivery-point-admin-card">
                  <div className="delivery-point-admin-number"><MapPin size={20} /></div>
                  <div>
                    <small>สถานที่ส่งลำดับ {index + 1}</small>
                    <strong>{point}</strong>
                  </div>
                  <div className="delivery-point-admin-controls">
                    <span className={isDefault ? 'default' : ''}>{isDefault ? 'ค่าเริ่มต้น' : 'เพิ่มโดยแอดมิน'}</span>
                    <div>
                      <button
                        className="edit"
                        type="button"
                        onClick={() => { setEditingDeliveryPoint(point); setShowAddDeliveryPoint(true) }}
                        aria-label={`แก้ไขสถานที่ ${point}`}
                      ><Pencil size={15} />แก้ไข</button>
                      <button
                        className="remove"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`ลบสถานที่ส่ง “${point}” ใช่หรือไม่?\n\nคำสั่งซื้อย้อนหลังที่ใช้สถานที่นี้จะยังคงชื่อเดิมไว้`)) onDeleteDeliveryPoint(point)
                        }}
                        aria-label={`ลบสถานที่ ${point}`}
                      ><Trash2 size={15} />ลบ</button>
                    </div>
                  </div>
                </article>
              )
              })}
            </div>
          ) : (
            <div className="empty-state"><MapPin size={30} /><strong>ยังไม่มีสถานที่ส่ง</strong><span>กด “เพิ่มสถานที่ส่ง” เพื่อสร้างรายการแรก</span></div>
          )}
        </section>

        {showAddDeliveryPoint && (
          <DeliveryPointModal
            selectedProject={selectedProject}
            deliveryPoints={deliveryPoints}
            initialPoint={editingDeliveryPoint}
            onClose={() => { setShowAddDeliveryPoint(false); setEditingDeliveryPoint('') }}
            onSave={(nextPoint) => editingDeliveryPoint
              ? onRenameDeliveryPoint(editingDeliveryPoint, nextPoint)
              : onAddDeliveryPoint(nextPoint)}
          />
        )}
      </main>
    )
  }

  if (adminView === 'users') {
    const userDepartments = new Set(projectUsers.map((user) => user.department).filter(Boolean)).size
    const userCompanies = new Set(projectUsers.map((user) => user.company).filter(Boolean)).size
    return (
      <main className="page-main admin-main">
        <nav className="admin-view-tabs" aria-label="เมนู Admin">
          <button type="button" onClick={() => setAdminView('summary')}><UtensilsCrossed size={19} /><span>ยอดสรุปข้าว</span></button>
          <button type="button" onClick={() => setAdminView('department-report')}><Building2 size={19} /><span>รายงานตามแผนก</span></button>
          <button type="button" onClick={() => setAdminView('delivery-points')}><MapPin size={19} /><span>สถานที่ส่ง</span><i>{deliveryPoints.length}</i></button>
          <button type="button" className="active" onClick={() => setAdminView('users')}><UsersRound size={19} /><span>User</span><i>{registeredUsers.length}</i></button>
        </nav>

        <section className="user-stats-grid">
          <article><div className="user-stat-icon"><UsersRound size={22} /></div><span>ผู้ใช้งาน {projects[selectedProject].shortName}</span><strong>{projectUsers.length.toLocaleString('th-TH')}</strong><small>บัญชี</small></article>
          <article><div className="user-stat-icon employee"><ClipboardCheck size={22} /></div><span>พนักงาน {projects[selectedProject].shortName} · Work</span><strong>{projectEmployees.length.toLocaleString('th-TH')}</strong><small>คน (ไม่รวม Status Off)</small></article>
          <article><div className="user-stat-icon department"><Building2 size={22} /></div><span>แผนกที่มีผู้ใช้</span><strong>{userDepartments.toLocaleString('th-TH')}</strong><small>แผนก</small></article>
          <article><div className="user-stat-icon company"><ShieldCheck size={22} /></div><span>บริษัท</span><strong>{userCompanies.toLocaleString('th-TH')}</strong><small>บริษัท</small></article>
        </section>

        <section className="workspace-card user-workspace">
          <div className="workspace-heading">
            <div><p>USER MANAGEMENT · {projects[selectedProject].shortName}</p><h2>จัดการผู้ใช้งาน — {projects[selectedProject].name}</h2></div>
            <div className="actions">
              <button className="button secondary" type="button" disabled={userSyncState.loading} onClick={syncUsers}><Download size={17} />{userSyncState.loading ? 'กำลังดึง User...' : `ดึง User ${projects[selectedProject].shortName}`}</button>
              <button className="button primary" onClick={() => setShowAdminSignup(true)}><UserPlus size={17} />เพิ่มผู้ใช้งาน</button>
            </div>
          </div>

          {userSyncState.message && <div className="employee-sync-message success user-sync-message">{userSyncState.message}</div>}
          {userSyncState.error && <div className="employee-sync-message error user-sync-message">{userSyncState.error}</div>}

          <div className="user-toolbar">
            <label className="search-box"><Search size={18} /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="ค้นหา LID ชื่อ แผนก บริษัท..." /></label>
            <span>แสดง {visibleUsers.length.toLocaleString('th-TH')} จาก {projectUsers.length.toLocaleString('th-TH')} บัญชีในโครงการนี้</span>
          </div>

          {visibleUsers.length ? (
            <div className="user-table-scroll">
              <table className="user-table">
                <thead><tr><th>LID</th><th>MR-MRS</th><th>FirstName</th><th>LastName</th><th>position</th><th>department</th><th>location</th><th>company</th><th>สถานะ</th><th aria-label="จัดการ" /></tr></thead>
                <tbody>
                  {visibleUsers.map((user) => (
                    <tr key={user.id}>
                      <td><strong>{user.lid || user.username || '—'}</strong></td>
                      <td>{user.title || '—'}</td>
                      <td>{user.firstName || user.fullName || '—'}</td>
                      <td>{user.lastName || '—'}</td>
                      <td className="user-position">{user.position || '—'}</td>
                      <td><span className="user-department-badge">{user.department || '—'}</span></td>
                      <td>{user.location || '—'}</td>
                      <td>{user.company || '—'}</td>
                      <td><span className={`user-role-badge ${user.role === 'admin' ? 'admin' : ''}`}>{user.role === 'admin' ? 'Admin' : 'ผู้ใช้ทั่วไป'}</span></td>
                      <td><button className="delete-button" onClick={() => { setUserToDelete(user); setDeleteUserError('') }} title="ลบผู้ใช้งาน"><Trash2 size={17} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><UsersRound size={30} /><strong>ไม่พบผู้ใช้งาน</strong><span>เพิ่มบัญชีใหม่หรือเปลี่ยนคำค้นหา</span></div>
          )}
        </section>

        <section className="workspace-card employee-workspace">
          <div className="workspace-heading">
            <div><p>EMPLOYEE DIRECTORY · {projects[selectedProject].shortName}</p><h2>ข้อมูลพนักงาน — {projects[selectedProject].name}</h2></div>
            <span className="employee-updated">
              {employeeSyncState.loading ? 'กำลังดึงจาก Supabase…' : `${projectEmployees.length.toLocaleString('th-TH')} คน`}
            </span>
          </div>
          {employeeSyncState.error && (
            <div className="modal-error" role="alert">ดึงข้อมูลพนักงานไม่สำเร็จ: {employeeSyncState.error}</div>
          )}
          <div className="user-toolbar">
            <label className="search-box"><Search size={18} /><input value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="ค้นหา LID ชื่อ แผนก location..." /></label>
            <span>
              แสดง {visibleEmployees.length.toLocaleString('th-TH')} จาก {projectEmployees.length.toLocaleString('th-TH')} คนในโครงการนี้
            </span>
          </div>
          {visibleEmployees.length ? (
            <div className="user-table-scroll">
              <table className="user-table employee-table">
                <thead><tr><th>EmployeeID</th><th>LID</th><th>MR-MRS</th><th>FirstName</th><th>LastName</th><th>position</th><th>department</th><th>location</th><th>company</th></tr></thead>
                <tbody>
                  {visibleEmployees.map((employee) => (
                    <tr key={employee.lid}>
                      <td>{employee.employeeId || '—'}</td>
                      <td><strong>{employee.lid}</strong></td>
                      <td>{employee.title || '—'}</td>
                      <td>{employee.firstName || '—'}</td>
                      <td>{employee.lastName || '—'}</td>
                      <td className="user-position">{employee.position || '—'}</td>
                      <td><span className="user-department-badge">{employee.department || '—'}</span></td>
                      <td>{employee.location || '—'}</td>
                      <td>{employee.company || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <Download size={30} />
              <strong>{employeeSyncState.loading ? 'กำลังดึงข้อมูลพนักงานจาก Supabase…' : 'ไม่พบข้อมูลพนักงานในโครงการนี้'}</strong>
              <span>แสดงเฉพาะพนักงานที่ Status = Work จากตาราง employees ที่ sync จากชีต dataforscan1 อัตโนมัติ</span>
            </div>
          )}
        </section>

        {showAdminSignup && <SignupModal users={registeredUsers} onClose={() => setShowAdminSignup(false)} onCreated={createUser} allowAdmin defaultProject={selectedProject} />}
        {userToDelete && (
          <div className="modal-backdrop delete-user-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingUser) setUserToDelete(null)
          }}>
            <section className="delete-user-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title">
              <button className="delete-user-close" type="button" disabled={deletingUser} onClick={() => setUserToDelete(null)} aria-label="ปิด"><X size={19} /></button>
              <div className="delete-user-icon"><Trash2 size={28} /></div>
              <p>USER MANAGEMENT</p>
              <h3 id="delete-user-title">ยืนยันการลบผู้ใช้งาน</h3>
              <span className="delete-user-description">บัญชีนี้จะไม่สามารถเข้าสู่ระบบสั่งอาหารได้อีก</span>
              <div className="delete-user-details">
                <div><span>LID</span><strong>{userToDelete.lid || userToDelete.username || '—'}</strong></div>
                <div><span>ชื่อผู้ใช้งาน</span><strong>{[userToDelete.title, userToDelete.firstName || userToDelete.fullName, userToDelete.lastName].filter(Boolean).join(' ') || '—'}</strong></div>
                <div><span>โครงการ</span><strong>{projects[projectFromLocation(userToDelete.location)].name}</strong></div>
              </div>
              <div className="delete-user-warning"><ShieldCheck size={18} /><span>{userToDelete.isDemo ? 'ระบบจะลบบัญชี Demo ออกจากอุปกรณ์นี้และจะไม่สร้างกลับมาอัตโนมัติ' : 'ระบบจะลบบัญชีออกจากฐานข้อมูล Supabase และไม่สามารถย้อนกลับได้ (ประวัติออเดอร์ที่เคยส่งยังอยู่)'}</span></div>
              {deleteUserError && <div className="modal-error delete-user-error" role="alert">{deleteUserError}</div>}
              <footer className="delete-user-actions">
                <button className="button secondary" type="button" disabled={deletingUser} onClick={() => setUserToDelete(null)}>ยกเลิก</button>
                <button className="button delete-confirm-button" type="button" disabled={deletingUser} onClick={removeUser}><Trash2 size={17} />{deletingUser ? 'กำลังลบ...' : 'ลบผู้ใช้งาน'}</button>
              </footer>
            </section>
          </div>
        )}
      </main>
    )
  }

  if (adminView === 'department-report') {
    // ยอดรวมทุกแผนก = บวกหัวคนของแต่ละแผนก (ไม่ใช่มื้อสูงสุดของทั้งโครงการ
    // เพราะแต่ละแผนกอาจมีมื้อพีคไม่ตรงกัน)
    const reportEquivalentTotal = departmentReportRows.reduce((sum, row) => sum + row.equivalentPeople, 0)
    const reportDifferenceTotal = reportEquivalentTotal - reportEmployeeTotal
    return (
      <main className="page-main admin-main department-report-main">
        <nav className="admin-view-tabs" aria-label="เมนู Admin">
          <button type="button" onClick={() => setAdminView('summary')}><UtensilsCrossed size={19} /><span>ยอดสรุปข้าว</span></button>
          <button type="button" className="active" onClick={() => setAdminView('department-report')}><Building2 size={19} /><span>รายงานตามแผนก</span></button>
          <button type="button" onClick={() => setAdminView('delivery-points')}><MapPin size={19} /><span>สถานที่ส่ง</span><i>{deliveryPoints.length}</i></button>
          <button type="button" onClick={() => setAdminView('users')}><UsersRound size={19} /><span>User</span><i>{registeredUsers.length}</i></button>
        </nav>

        <section className="department-report-summary">
          <article><span>จำนวนพนักงานในแผนกของระบบ</span><strong>{projectHeadcount.loading ? '…' : reportEmployeeTotal.toLocaleString('th-TH')}</strong><small>คน</small></article>
          <article><span>ยอดสั่งรวม {MEAL_PERIODS.length} มื้อ</span><strong>{reportAllMealTotal.toLocaleString('th-TH')}</strong><small>ชุด</small></article>
          <article><span>หัวคนจากยอดสั่ง</span><strong>{formatCalculatedNumber(reportEquivalentTotal)}</strong><small>คน (รวมมื้อสูงสุดของทุกแผนก)</small></article>
          <article className={reportDifferenceTotal < 0 ? 'shortage' : ''}><span>ส่วนต่างจากพนักงาน</span><strong>{`${reportDifferenceTotal > 0 ? '+' : ''}${formatCalculatedNumber(reportDifferenceTotal)}`}</strong><small>คน</small></article>
        </section>

        <section className="workspace-card department-report-card">
          <div className="workspace-heading">
            <div><p>DEPARTMENT ORDER REPORT · {projects[selectedProject].shortName}</p><h2>รายงานยอดสั่งอาหารตามแผนก</h2></div>
            <div className="actions">
              <button className="button secondary" type="button" onClick={exportDepartmentReport}><Download size={17} />ส่งออก CSV</button>
              <button className="button secondary" type="button" onClick={() => window.print()}><Printer size={17} />พิมพ์รายงาน</button>
            </div>
          </div>

          <div className="department-report-meta">
            <div className="date-control"><span>วันที่รายงาน (อัปเดตอัตโนมัติ)</span><strong>{formatDate(reportDate)}</strong></div>
            <div><span>โครงการ</span><strong>{projects[selectedProject].name}</strong></div>
            <div><span>จำนวนคนจาก DataForScan</span><strong>{projectHeadcount.date ? formatDate(projectHeadcount.date) : 'กำลังอัปเดต'}</strong></div>
          </div>

          <div className="department-report-scroll">
            <table className="department-report-table">
              <thead><tr><th>แผนก</th><th>จำนวนคน</th><th>มื้อเช้า</th><th>มื้อเที่ยง</th><th>มื้อเย็น</th><th>มื้อดึก</th><th>มื้อไม่ปกติ</th><th>รวมข้าวห่อ</th><th>รวม {MEAL_PERIODS.length} มื้อ</th><th>หัวคน (มื้อสูงสุด)</th><th>ส่วนต่าง</th><th>สถานะส่ง / ผู้บันทึก</th></tr></thead>
              <tbody>
                {departmentReportRows.map((row) => (
                  <tr key={row.department}>
                    <td><strong>{row.department}</strong><small>{row.teams} ทีมงาน</small></td>
                    <td className="report-employee-count">{row.employeeCount.toLocaleString('th-TH')}</td>
                    <td>{row.morning.toLocaleString('th-TH')}</td>
                    <td>{row.lunch.toLocaleString('th-TH')}</td>
                    <td>{row.dinner.toLocaleString('th-TH')}</td>
                    <td>{row.lateNight.toLocaleString('th-TH')}</td>
                    <td>{row.irregular.toLocaleString('th-TH')}</td>
                    <td className="report-packed-total">{row.packedTotal.toLocaleString('th-TH')}</td>
                    <td className="report-order-total">{row.orderTotal.toLocaleString('th-TH')}</td>
                    <td className="report-equivalent">{formatCalculatedNumber(row.equivalentPeople)}</td>
                    <td className={row.difference < 0 ? 'report-difference shortage' : 'report-difference'}>{`${row.difference > 0 ? '+' : ''}${formatCalculatedNumber(row.difference)}`}</td>
                    <td><div className="submission-info"><span className={`submission-status ${row.sent === row.teams ? 'complete' : row.sent > 0 ? 'partial' : ''}`}>{row.sent}/{row.teams} ทีม</span>{row.submittedByLids.length > 0 && <small>ผู้บันทึก LID {row.submittedByLids.join(', ')}</small>}</div></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>รวมทุกแผนก</td><td>{reportEmployeeTotal.toLocaleString('th-TH')}</td><td>{reportTotals.morning.total.toLocaleString('th-TH')}</td><td>{reportTotals.lunch.total.toLocaleString('th-TH')}</td><td>{reportTotals.dinner.total.toLocaleString('th-TH')}</td><td>{reportTotals.lateNight.total.toLocaleString('th-TH')}</td><td>{reportTotals.irregular.total.toLocaleString('th-TH')}</td><td>{reportPackedTotal.toLocaleString('th-TH')}</td><td>{reportAllMealTotal.toLocaleString('th-TH')}</td><td>{formatCalculatedNumber(reportEquivalentTotal)}</td><td>{`${reportDifferenceTotal > 0 ? '+' : ''}${formatCalculatedNumber(reportDifferenceTotal)}`}</td><td>{submittedReportDayRows.length}/{reportDayRows.length} ทีม</td></tr></tfoot>
            </table>
          </div>
          <p className="department-report-note">รวมข้าวห่อ = ข้าวเหนียวห่อ + ข้าวจ้าวห่อของทั้ง {MEAL_PERIODS.length} มื้อ · หัวคน = ยอดของมื้อที่สั่งเยอะที่สุดในแผนกนั้น เพราะคน 1 คนกินได้หลายมื้อ · ส่วนต่าง = หัวคน − จำนวนพนักงานที่ Status = Work</p>
        </section>
      </main>
    )
  }

  return (
    <main className="page-main admin-main">
      <nav className="admin-view-tabs" aria-label="เมนู Admin">
        <button type="button" className="active" onClick={() => setAdminView('summary')}><UtensilsCrossed size={19} /><span>ยอดสรุปข้าว</span></button>
        <button type="button" onClick={() => setAdminView('department-report')}><Building2 size={19} /><span>รายงานตามแผนก</span></button>
        <button type="button" onClick={() => setAdminView('delivery-points')}><MapPin size={19} /><span>สถานที่ส่ง</span><i>{deliveryPoints.length}</i></button>
        <button type="button" onClick={() => setAdminView('users')}><UsersRound size={19} /><span>User</span><i>{registeredUsers.length}</i></button>
      </nav>

      <section className="admin-people-overview" aria-label={`เปรียบเทียบจำนวนพนักงานกับยอดสั่งรวม ${MEAL_PERIODS.length} มื้อ`}>
        <header>
          <div><p>PEOPLE & {MEAL_PERIODS.length}-MEAL OVERVIEW</p><h2>จำนวนคนเทียบยอดสั่งรวม {MEAL_PERIODS.length} มื้อ — {projects[selectedProject].name}</h2></div>
          <div className="admin-overview-date"><span>จำนวนคนจาก DataForScan วันนี้</span><strong>{projectHeadcount.date ? formatDate(projectHeadcount.date) : 'กำลังอัปเดต'}</strong><button type="button" disabled={projectHeadcount.loading} onClick={loadProjectHeadcount} title="อัปเดตจำนวนคน"><RotateCcw size={16} /></button></div>
        </header>
        <div className="admin-overview-grid">
          <article className="people-count"><span>พนักงานทั้งหมด</span><strong>{projectHeadcount.loading ? '…' : (projectHeadcount.count ?? '—').toLocaleString('th-TH')}</strong><small>คนใน {projects[selectedProject].shortName}</small></article>
          <article className="three-meal-count"><span>ยอดสั่งรวม {MEAL_PERIODS.length} มื้อ</span><strong>{allMealTotal.toLocaleString('th-TH')}</strong><small>{MEAL_PERIODS.map((period) => totals[period].total.toLocaleString('th-TH')).join(' + ')} ชุด</small></article>
          <article className="equivalent-count"><span>หัวคนจากยอดสั่ง</span><strong>{formatCalculatedNumber(peopleEquivalent)}</strong><small>คน · จากมื้อที่สั่งเยอะที่สุด</small></article>
          <article className={peopleDifference !== null && peopleDifference < 0 ? 'difference-count shortage' : 'difference-count'}><span>{peopleDifference !== null && peopleDifference < 0 ? 'น้อยกว่าจำนวนพนักงาน' : 'มากกว่าจำนวนพนักงาน'}</span><strong>{peopleDifference === null ? '—' : `${peopleDifference > 0 ? '+' : ''}${formatCalculatedNumber(peopleDifference)}`}</strong><small>คน เมื่อเทียบหัวคนกับพนักงาน Work</small></article>
        </div>
        {projectHeadcount.error && <div className="admin-overview-error">ดึงจำนวนพนักงานไม่สำเร็จ: {projectHeadcount.error}</div>}
      </section>

      <section className="stats-grid" aria-label="สรุปยอดอาหารทุกแผนก">
        <StatCard label="มื้อเช้า" value={totals.morning.total} tone="morning" icon={UtensilsCrossed} />
        <StatCard label="มื้อเที่ยง" value={totals.lunch.total} tone="lunch" icon={UtensilsCrossed} />
        <StatCard label="มื้อเย็น" value={totals.dinner.total} tone="dinner" icon={UtensilsCrossed} />
        <StatCard label="มื้อดึก" value={totals.lateNight.total} tone="lateNight" icon={UtensilsCrossed} />
        <StatCard label="มื้อไม่ปกติ" value={totals.irregular.total} tone="irregular" icon={UtensilsCrossed} />
        <StatCard label="รวมทุกแผนก" value={totals.grand} tone="grand" icon={ShieldCheck} />
      </section>

      <section className="rice-summary-grid" aria-label="สรุปตามประเภทอาหาร">
        <article><span>ทานที่โรงครัว</span><strong>{MEAL_PERIODS.reduce((sum, period) => sum + totals[period].canteen, 0).toLocaleString('th-TH')}</strong><small>ชุด</small></article>
        <article className="sticky-summary"><span>ข้าวเหนียวห่อ</span><strong>{totalStickyRice.toLocaleString('th-TH')}</strong><small>ห่อ</small></article>
        <article className="rice-summary"><span>ข้าวจ้าวห่อ</span><strong>{totalPlainRice.toLocaleString('th-TH')}</strong><small>ห่อ</small></article>
        <article className="packed-summary-total"><span>รวมข้าวห่อ</span><strong>{totalPackedRice.toLocaleString('th-TH')}</strong><small>ห่อ</small></article>
      </section>

      <section className="workspace-card admin-workspace">
        <div className="workspace-heading">
          <div>
            <p>KITCHEN ORDER SUMMARY · {projects[selectedProject].shortName}</p>
            <h2>ยอดสรุปข้าวทุกแผนก — {projects[selectedProject].name}</h2>
          </div>
          <div className="actions">
            <button className="button secondary" onClick={() => exportRowsCsv(submittedDayRows, selectedDate, 'ทุกแผนก', notify, selectedProject)}><Download size={17} />ส่งออก CSV</button>
            <button className="button secondary" onClick={() => window.print()}><Printer size={17} />พิมพ์</button>
          </div>
        </div>

        <div className="admin-filters">
          <label className="control date-control">
            <span>วันที่รับอาหาร</span>
            <input type="date" value={selectedDate} onChange={(event) => changeDate(event.target.value)} />
          </label>
          <label className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาแผนก" />
          </label>
          <div className="last-update"><CheckCircle2 size={17} /><span>รับยอดแล้ว {submittedDayRows.length.toLocaleString('th-TH')}/{dayRows.length.toLocaleString('th-TH')} ทีม จาก {departments.length} แผนก</span></div>
        </div>

        <div className="admin-table-scroll summary-screen-table">
          <KitchenSummaryTable items={summaries} totals={totals} submittedRows={submittedDayRows} />
        </div>

        <div className="summary-print-pages" aria-hidden="true">
          {printLayout.pages.map((page, index) => (
            <section
              key={`print-page-${index + 1}`}
              className="summary-print-page"
              style={{
                '--print-row-height': `${page.rowHeight}mm`,
                '--print-font-size': `${page.fontSize}pt`,
                '--print-header-height': `${page.headerHeight}mm`,
              }}
            >
              <header className="summary-print-header">
                <div>
                  <p>KITCHEN ORDER SUMMARY · {projects[selectedProject].shortName}</p>
                  <h2>ยอดสรุปข้าวทุกแผนก — {projects[selectedProject].name}</h2>
                </div>
                <div>
                  <strong>วันที่รับอาหาร {formatDate(selectedDate)}</strong>
                  <span>หน้า {index + 1}/{printLayout.pages.length}</span>
                </div>
              </header>
              <KitchenSummaryTable
                items={page.items}
                totals={totals}
                submittedRows={submittedDayRows}
                showGrandTotal={page.showGrandTotal}
              />
            </section>
          ))}
        </div>
      </section>
    </main>
  )
}

function exportRowsCsv(sourceRows, selectedDate, scope, notify, project = 'xepon') {
  const headers = [
    'วันที่', 'แผนก', 'ทีมงาน',
    'เช้า-โรงครัว', 'เช้า-ข้าวเหนียว', 'เช้า-ข้าวจ้าว', 'เช้า-รวมห่อ', 'เช้า-รวม', 'เช้า-ส่งห่อที่',
    'เที่ยง-โรงครัว', 'เที่ยง-ข้าวเหนียว', 'เที่ยง-ข้าวจ้าว', 'เที่ยง-รวมห่อ', 'เที่ยง-รวม', 'เที่ยง-ส่งห่อที่',
    'เย็น-โรงครัว', 'เย็น-ข้าวเหนียว', 'เย็น-ข้าวจ้าว', 'เย็น-รวมห่อ', 'เย็น-รวม', 'เย็น-ส่งห่อที่',
    'ดึก-โรงครัว', 'ดึก-ข้าวเหนียว', 'ดึก-ข้าวจ้าว', 'ดึก-รวมห่อ', 'ดึก-รวม', 'ดึก-ส่งห่อที่',
    'ไม่ปกติ-โรงครัว', 'ไม่ปกติ-ข้าวเหนียว', 'ไม่ปกติ-ข้าวจ้าว', 'ไม่ปกติ-รวมห่อ', 'ไม่ปกติ-รวม', 'ไม่ปกติ-ส่งห่อที่',
    'รวมทั้งหมด', 'หมายเหตุ', 'สถานะ', 'วันที่และเวลาที่ส่งข้อมูล', 'LID ผู้บันทึก', 'ชื่อผู้บันทึก',
  ]
  const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const data = sourceRows.map((row) => [
    row.date, row.department, row.team,
    row.morning.canteen, row.morning.sticky, row.morning.rice, packed(row.morning), mealTotal(row.morning), packed(row.morning) ? (row.morning.point || '') : '',
    row.lunch.canteen, row.lunch.sticky, row.lunch.rice, packed(row.lunch), mealTotal(row.lunch), packed(row.lunch) ? (row.lunch.point || '') : '',
    row.dinner.canteen, row.dinner.sticky, row.dinner.rice, packed(row.dinner), mealTotal(row.dinner), packed(row.dinner) ? (row.dinner.point || '') : '',
    row.lateNight.canteen, row.lateNight.sticky, row.lateNight.rice, packed(row.lateNight), mealTotal(row.lateNight), packed(row.lateNight) ? (row.lateNight.point || '') : '',
    row.irregular.canteen, row.irregular.sticky, row.irregular.rice, packed(row.irregular), mealTotal(row.irregular), packed(row.irregular) ? (row.irregular.point || '') : '',
    rowTotal(row), row.note, statusText[row.status], formatSubmittedAt(row.submittedAt), row.submittedByLid || '', row.submittedByName || '',
  ])
  const csv = `\ufeff${[headers, ...data].map((line) => line.map(cell).join(',')).join('\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${project}-food-order-${scope}-${selectedDate}.csv`
  link.click()
  URL.revokeObjectURL(url)
  notify('ส่งออกไฟล์ CSV แล้ว')
}

function App() {
  const [session, setSession] = useState(loadSession)
  const [selectedProject, setSelectedProject] = useState(() => projectFromLocation(loadSession()?.location))
  const [selectedDate, setSelectedDate] = useState(tomorrow)
  const [currentDate, setCurrentDate] = useState(bangkokToday)
  const [rows, setRows] = useState(() => loadRows(tomorrow()))
  const [configuredDeliveryPoints, setConfiguredDeliveryPoints] = useState(() => loadDeliveryPoints(selectedProject))
  const [deliveryPointDataState, setDeliveryPointDataState] = useState({
    loading: false,
    source: supabaseConfigured() ? 'database' : 'local',
    error: '',
  })
  const [toast, setToast] = useState('')
  const deliveryPoints = configuredDeliveryPoints

  useEffect(() => {
    const cached = loadDeliveryPoints(selectedProject)
    setConfiguredDeliveryPoints(cached)

    if (!session || !supabaseConfigured()) {
      setDeliveryPointDataState({ loading: false, source: 'local', error: '' })
      return undefined
    }

    let active = true
    setDeliveryPointDataState({ loading: true, source: 'database', error: '' })
    fetchDeliveryPointsFromSupabase({ project: selectedProject }).then((points) => {
      if (!active) return
      const next = uniqueDeliveryPoints(points)
      setConfiguredDeliveryPoints(next)
      persistDeliveryPoints(next, selectedProject)
      setDeliveryPointDataState({ loading: false, source: 'database', error: '' })
    }).catch((error) => {
      if (active) setDeliveryPointDataState({
        loading: false,
        source: 'local',
        error: error.message || 'ไม่สามารถโหลดรายการสถานที่ส่งได้',
      })
    })
    return () => { active = false }
  }, [session, selectedProject])

  useEffect(() => {
    setRows((current) => ensureRowsForDate(current, selectedDate, selectedProject))
  }, [selectedDate, selectedProject])

  useEffect(() => {
    const updateCurrentDate = () => setCurrentDate((current) => {
      const next = bangkokToday()
      return current === next ? current : next
    })
    updateCurrentDate()
    const timer = window.setInterval(updateCurrentDate, 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!session || (!supabaseConfigured() && !configuredApiUrl())) return undefined
    let active = true
    loadRemoteOrders(selectedProject, selectedDate).then((orders) => {
      if (!active) return
      setRows((current) => {
        const nextRows = [...current]
        orders.forEach((remoteOrder) => {
          const normalizedOrder = {
            ...remoteOrder,
            project: selectedProject,
            date: selectedDate,
            department: normalizeDepartmentName(remoteOrder.department),
            status: 'sent',
          }
          const existingIndex = nextRows.findIndex((row) => row.project === selectedProject
            && row.date === selectedDate
            && row.department === normalizedOrder.department
            && row.team === normalizedOrder.team)
          if (existingIndex >= 0) nextRows[existingIndex] = { ...nextRows[existingIndex], ...normalizedOrder, id: nextRows[existingIndex].id }
          else nextRows.push({ ...normalizedOrder, id: crypto.randomUUID() })
        })
        const ensuredRows = ensureRowsForDate(nextRows, selectedDate, selectedProject)
        persistRows(ensuredRows)
        return ensuredRows
      })
    }).catch(() => {
      // ใช้ข้อมูลในเครื่องต่อได้ หาก Code.gs ยังไม่ได้ Deploy action นี้
    })
    return () => { active = false }
  }, [session, selectedDate, selectedProject])

  useEffect(() => {
    if (session?.role !== 'admin' || currentDate === selectedDate
      || (!supabaseConfigured() && !configuredApiUrl())) return undefined
    let active = true
    loadRemoteOrders(selectedProject, currentDate).then((orders) => {
      if (!active) return
      setRows((current) => {
        const nextRows = [...current]
        orders.forEach((remoteOrder) => {
          const normalizedOrder = {
            ...remoteOrder,
            project: selectedProject,
            date: currentDate,
            department: normalizeDepartmentName(remoteOrder.department),
            status: 'sent',
          }
          const existingIndex = nextRows.findIndex((row) => row.project === selectedProject
            && row.date === currentDate
            && row.department === normalizedOrder.department
            && row.team === normalizedOrder.team)
          if (existingIndex >= 0) nextRows[existingIndex] = { ...nextRows[existingIndex], ...normalizedOrder, id: nextRows[existingIndex].id }
          else nextRows.push({ ...normalizedOrder, id: crypto.randomUUID() })
        })
        const ensuredRows = ensureRowsForDate(nextRows, currentDate, selectedProject)
        persistRows(ensuredRows)
        return ensuredRows
      })
    }).catch(() => {
      // ใช้ข้อมูลในเครื่องต่อได้ หากยังเชื่อมต่อ Google Apps Script ไม่สำเร็จ
    })
    return () => { active = false }
  }, [session, currentDate, selectedDate, selectedProject])

  const notify = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const addDeliveryPoint = async (pointName) => {
    if (session?.role !== 'admin') {
      notify('เฉพาะแอดมินโรงครัวเท่านั้นที่เพิ่มสถานที่ส่งได้')
      return false
    }
    if (deliveryPoints.some((point) => point.toLocaleLowerCase('th') === pointName.toLocaleLowerCase('th'))) {
      notify('มีสถานที่ส่งนี้อยู่ในรายการแล้ว')
      return false
    }
    try {
      const savedName = supabaseConfigured()
        ? await createDeliveryPointOnSupabase({
          project: selectedProject,
          name: pointName,
          adminPin: ADMIN_PIN,
        })
        : pointName
      const next = uniqueDeliveryPoints([...configuredDeliveryPoints, savedName || pointName])
      setConfiguredDeliveryPoints(next)
      persistDeliveryPoints(next, selectedProject)
      notify(supabaseConfigured()
        ? `เพิ่มสถานที่ส่ง “${savedName || pointName}” ลงฐานข้อมูลแล้ว`
        : `เพิ่มสถานที่ส่ง “${pointName}” ในเครื่องแล้ว (ยังไม่ได้เชื่อม Supabase)`)
      return true
    } catch (error) {
      notify(`เพิ่มสถานที่ส่งไม่สำเร็จ: ${error.message}`)
      return false
    }
  }

  const renameDeliveryPoint = async (currentName, nextName) => {
    if (session?.role !== 'admin') {
      notify('เฉพาะแอดมินโรงครัวเท่านั้นที่แก้ไขสถานที่ส่งได้')
      return false
    }
    const currentKey = currentName.toLocaleLowerCase('th')
    const nextKey = nextName.toLocaleLowerCase('th')
    if (configuredDeliveryPoints.some((point) => point.toLocaleLowerCase('th') === nextKey
      && point.toLocaleLowerCase('th') !== currentKey)) {
      notify('มีสถานที่ส่งชื่อนี้อยู่ในรายการแล้ว')
      return false
    }
    try {
      const savedName = supabaseConfigured()
        ? await renameDeliveryPointOnSupabase({
          project: selectedProject,
          currentName,
          newName: nextName,
          adminPin: ADMIN_PIN,
        })
        : nextName
      const next = configuredDeliveryPoints.map((point) =>
        point.toLocaleLowerCase('th') === currentKey ? (savedName || nextName) : point)
      setConfiguredDeliveryPoints(next)
      persistDeliveryPoints(next, selectedProject)
      notify(supabaseConfigured()
        ? `แก้ไขสถานที่ส่งเป็น “${savedName || nextName}” ในฐานข้อมูลแล้ว`
        : `แก้ไขสถานที่ส่งเป็น “${nextName}” ในเครื่องแล้ว (ยังไม่ได้เชื่อม Supabase)`)
      return true
    } catch (error) {
      notify(`แก้ไขสถานที่ส่งไม่สำเร็จ: ${error.message}`)
      return false
    }
  }

  const deleteDeliveryPoint = async (pointName) => {
    if (session?.role !== 'admin') {
      notify('เฉพาะแอดมินโรงครัวเท่านั้นที่ลบสถานที่ส่งได้')
      return false
    }
    const pointKey = pointName.toLocaleLowerCase('th')
    const next = configuredDeliveryPoints.filter((point) => point.toLocaleLowerCase('th') !== pointKey)
    if (next.length === configuredDeliveryPoints.length) return false
    try {
      if (supabaseConfigured()) {
        await deleteDeliveryPointOnSupabase({
          project: selectedProject,
          name: pointName,
          adminPin: ADMIN_PIN,
        })
      }
      setConfiguredDeliveryPoints(next)
      persistDeliveryPoints(next, selectedProject)
      notify(supabaseConfigured()
        ? `ลบสถานที่ส่ง “${pointName}” ออกจากฐานข้อมูลแล้ว`
        : `ลบสถานที่ส่ง “${pointName}” ในเครื่องแล้ว (ยังไม่ได้เชื่อม Supabase)`)
      return true
    } catch (error) {
      notify(`ลบสถานที่ส่งไม่สำเร็จ: ${error.message}`)
      return false
    }
  }

  const changeDate = (date) => {
    setSelectedDate(date)
    setRows((current) => ensureRowsForDate(current, date, selectedProject))
  }

  const changeProject = (project) => {
    setSelectedProject(project)
    setRows((current) => ensureRowsForDate(current, selectedDate, project))
  }

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
  }

  const login = (nextSession) => {
    const project = nextSession.role === 'admin' ? 'xepon' : projectFromLocation(nextSession.location)
    setSession(nextSession)
    setSelectedProject(project)
    setRows((current) => ensureRowsForDate(current, selectedDate, project))
  }

  if (!session) return <LoginPage onLogin={login} />

  return (
    <div className={`app-shell ${session.role === 'admin' ? 'admin-session' : 'department-session'}`}>
      <PageHeader selectedDate={selectedDate} selectedProject={selectedProject} changeProject={changeProject} session={session} onLogout={logout} />
      {session.role === 'admin'
        ? <KitchenDashboard selectedDate={selectedDate} reportDate={currentDate} selectedProject={selectedProject} changeDate={changeDate} rows={rows} deliveryPoints={deliveryPoints} deliveryPointDataState={deliveryPointDataState} onAddDeliveryPoint={addDeliveryPoint} onRenameDeliveryPoint={renameDeliveryPoint} onDeleteDeliveryPoint={deleteDeliveryPoint} notify={notify} />
        : <DepartmentWorkspace session={session} selectedDate={selectedDate} selectedProject={selectedProject} changeDate={changeDate} rows={rows} setRows={setRows} deliveryPoints={deliveryPoints} notify={notify} />}
      {toast && <div className="toast"><CheckCircle2 size={20} />{toast}</div>}
    </div>
  )
}

export default App
