/**
 * ชนิดข้อมูลของตารางใน Supabase และรูปแบบที่แอปใช้งาน
 *
 *   *Row      = หน้าตาข้อมูลดิบจากฐานข้อมูล (snake_case ตรงตามคอลัมน์)
 *   ไม่มี Row = รูปแบบที่แอปใช้ (camelCase) แปลงแล้วผ่าน mapper ในแต่ละ store
 */

/* ================================ พื้นฐาน ================================= */

export const MEAL_PERIODS = ['morning', 'lunch', 'dinner', 'lateNight', 'irregular'] as const
export type MealPeriod = (typeof MEAL_PERIODS)[number]

/** ชื่อคอลัมน์ในฐานข้อมูลของแต่ละมื้อ (lateNight -> late_night) */
export const MEAL_COLUMN: Record<MealPeriod, string> = {
  morning: 'morning',
  lunch: 'lunch',
  dinner: 'dinner',
  lateNight: 'late_night',
  irregular: 'irregular',
}

/** โครงการ — คำนวณจาก location ตอน sync จากชีต */
export type Project = 'xepon' | 'sekong' | 'hongsa' | 'vientiane' | 'other'

export type OrderStatus = 'draft' | 'confirmed' | 'sent'
export type UserRole = 'user' | 'admin'

export interface Meal {
  canteen: number
  sticky: number
  rice: number
  /**
   * จุดส่งของมื้อนั้น เช่น 'หน้างาน' — ค่าว่าง = ยังไม่ระบุ
   *
   * ผูกกับมื้อไม่ใช่ผูกกับทีม เพราะทีมเดียวกันอยู่ได้หลายจุดใน 1 วัน
   * (เช้าอยู่หน้างาน เที่ยงกลับมาโรงอาหาร) และมื้อกำหนดช่วงเวลาส่งไปในตัว
   */
  point: string
}

export const emptyMeal = (): Meal => ({ canteen: 0, sticky: 0, rice: 0, point: '' })

export type Meals = Record<MealPeriod, Meal>

/* =============================== employees =============================== */

/** ตาราง employees — sync มาจากชีต dataforscan1 แก้ในฐานข้อมูลไม่ได้ */
export interface EmployeeRow {
  lid: string
  employee_id: string | null
  title: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  position: string | null
  department: string | null
  location: string | null
  company: string | null
  status: string | null
  is_active: boolean
  project: Project | null
  sheet_row: number | null
  synced_at: string
  deleted_at: string | null
}

export interface Employee {
  lid: string
  employeeId: string | null
  title: string
  firstName: string
  lastName: string
  fullName: string
  position: string
  department: string
  location: string
  company: string
  status: string
  isActive: boolean
  project: Project | null
  syncedAt: string
}

/* =============================== app_users =============================== */

/** ตาราง app_users — คอลัมน์ pin_hash ถูกปิดสิทธิ์ไว้ อ่านจากเบราว์เซอร์ไม่ได้ */
export interface AppUserRow {
  lid: string
  role: UserRole
  title: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  position: string | null
  department: string | null
  location: string | null
  company: string | null
  project: Project | null
  is_demo: boolean
  created_at: string
  updated_at?: string
  last_login_at: string | null
}

export interface AppUser {
  id: string
  lid: string
  role: UserRole
  title: string
  firstName: string
  lastName: string
  fullName: string
  position: string
  department: string
  location: string
  company: string
  project: Project | null
  isDemo: boolean
  createdAt: string
  lastLoginAt: string | null
}

/* ============================== food_orders ============================== */

export interface FoodOrderRow {
  id: string
  project: string
  order_date: string
  department: string
  team: string
  morning_canteen: number
  morning_sticky: number
  morning_rice: number
  morning_point: string
  lunch_canteen: number
  lunch_sticky: number
  lunch_rice: number
  lunch_point: string
  dinner_canteen: number
  dinner_sticky: number
  dinner_rice: number
  dinner_point: string
  late_night_canteen: number
  late_night_sticky: number
  late_night_rice: number
  late_night_point: string
  irregular_canteen: number
  irregular_sticky: number
  irregular_rice: number
  irregular_point: string
  note: string
  status: OrderStatus
  submitted_at: string | null
  submitted_by_lid: string | null
  submitted_by_name: string | null
  total: number
  created_at: string
  updated_at: string
}

export interface FoodOrder extends Meals {
  id: string
  project: string
  /** วันที่สั่ง รูปแบบ YYYY-MM-DD (ตรงกับ row.date ที่แอปใช้อยู่) */
  date: string
  department: string
  team: string
  note: string
  status: OrderStatus
  submittedAt: string | null
  submittedByLid: string
  submittedByName: string
  total: number
}

/** ข้อมูลที่ส่งเข้า save_food_orders — 1 รายการต่อ 1 ทีมงาน */
export interface FoodOrderInput extends Partial<Meals> {
  team: string
  note?: string
}
