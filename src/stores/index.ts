/**
 * ทางเข้าเดียวสำหรับข้อมูลทั้งระบบ
 *
 *   employeeApi  พนักงาน 1,816 คน (อ่านอย่างเดียว — ต้นทางคือชีต dataforscan1)
 *   userApi      บัญชีผู้ใช้: สมัคร / ล็อกอิน / เปลี่ยนรหัส / ลบ
 *   orderApi     ใบสั่งอาหาร: อ่าน / บันทึก / แก้ไข / ลบ / สรุปยอด
 *
 * ตัวอย่างใช้กับ React:
 *   const { items, loading, error } = useStore(orderStore)
 *   useEffect(() => { orderApi.load({ project: 'xepon', date }) }, [date])
 */

export { supabaseConfigured, SupabaseError, PAGE_SIZE } from '../lib/supabaseRest'
export { createStore, useStore, type Store, type AsyncState } from './createStore'

export { employeeApi, employeeStore, COUNT_ONLY_WORKING, type EmployeeFilter, type EmployeeState } from './employeeStore'
export { userApi, userStore, type RegisterInput, type UserState } from './userStore'
export { orderApi, orderStore, type OrderFilter, type OrderState } from './orderStore'
export { deliveryPointApi } from './deliveryPointStore'

export {
  MEAL_PERIODS,
  MEAL_COLUMN,
  emptyMeal,
  type AppUser,
  type Employee,
  type FoodOrder,
  type FoodOrderInput,
  type Meal,
  type Meals,
  type MealPeriod,
  type OrderStatus,
  type Project,
  type UserRole,
} from '../types/database'

/* ---------------------------------------------------------------------------
 * ชื่อเดิมที่ src/App.jsx เรียกอยู่ — คงไว้เพื่อไม่ต้องแก้ทั้งไฟล์ทีเดียว
 * โค้ดใหม่ให้ใช้ employeeApi / userApi / orderApi ด้านบนแทน
 * ------------------------------------------------------------------------- */

import { employeeApi } from './employeeStore'
import { userApi, type RegisterInput } from './userStore'
import { orderApi } from './orderStore'
import { deliveryPointApi } from './deliveryPointStore'
import type { AppUser, FoodOrder, FoodOrderInput } from '../types/database'

export const fetchEmployeeByLid = employeeApi.byLid
export const fetchEmployees = employeeApi.list
export const countEmployees = employeeApi.count
export const countEmployeesByDepartment = employeeApi.countByDepartment

export const loginUser = (lid: string, pin: string): Promise<AppUser> => userApi.login(lid, pin)
export const registerUser = (params: RegisterInput): Promise<AppUser> => userApi.register(params)
export const deleteAppUser = (lid: string, adminPin: string): Promise<void> => userApi.remove(lid, adminPin)
export const fetchAppUsers = (params: { project?: string } = {}): Promise<AppUser[]> => userApi.list(params)

export const fetchFoodOrders = (params: { project?: string; date?: string; department?: string } = {}): Promise<FoodOrder[]> =>
  orderApi.list(params)

export const saveFoodOrders = (params: {
  project: string
  date: string
  department: string
  submittedByLid?: string
  submittedByName?: string
  orders: FoodOrderInput[]
}): Promise<{ saved: number; submittedAt: string }> => orderApi.submitDepartment(params)

export const fetchDeliveryPoints = (params: { project: string }): Promise<string[]> =>
  deliveryPointApi.list(params)

export const createDeliveryPoint = (params: {
  project: string
  name: string
  adminPin: string
}): Promise<string> => deliveryPointApi.create(params)

export const renameDeliveryPoint = (params: {
  project: string
  currentName: string
  newName: string
  adminPin: string
}): Promise<string> => deliveryPointApi.rename(params)

export const deleteDeliveryPoint = (params: {
  project: string
  name: string
  adminPin: string
}): Promise<void> => deliveryPointApi.remove(params)
