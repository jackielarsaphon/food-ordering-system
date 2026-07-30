/**
 * orderStore — ใบสั่งอาหาร (ตาราง food_orders)
 *
 * อ่านตารางตรงได้ (ยอดอาหารไม่ใช่ความลับ) แต่การเขียนวิ่งผ่าน function:
 *   submitDepartment -> save_food_orders   ส่งทั้งแผนกให้โรงครัวในครั้งเดียว
 *   save             -> upsert_food_order  บันทึก/แก้ไขทีละทีม เก็บเป็น draft ได้
 *   remove           -> delete_food_order  ลบ ต้องมี PIN แอดมิน
 */

import {
  MEAL_COLUMN,
  MEAL_PERIODS,
  emptyMeal,
  type FoodOrder,
  type FoodOrderInput,
  type FoodOrderRow,
  type Meal,
  type Meals,
  type OrderStatus,
} from '../types/database'
import { buildQuery, eq, restListAll, rpc } from '../lib/supabaseRest'
import { createStore, initialAsyncState, withAsync, type AsyncState } from './createStore'

// อ่านจากวิวแนวกว้าง (พิวอตจาก food_orders + food_order_items ให้เอง)
// เขียนผ่าน rpc เท่านั้น จึงไม่ต้องแตะ 2 ตารางจากฝั่งแอป
const TABLE = 'food_orders_wide'

export interface OrderFilter {
  project?: string
  /** YYYY-MM-DD */
  date?: string
  /** ช่วงวัน (ใช้ทำรายงาน) */
  fromDate?: string
  toDate?: string
  department?: string
  status?: OrderStatus
}

export interface OrderState extends AsyncState {
  items: FoodOrder[]
  /** ยอดรวมทุกมื้อของ items ปัจจุบัน */
  total: number
}

export const orderStore = createStore<OrderState>({
  ...initialAsyncState,
  items: [],
  total: 0,
})

const toMeals = (row: FoodOrderRow): Meals => Object.fromEntries(
  MEAL_PERIODS.map((period) => {
    const column = MEAL_COLUMN[period]
    const meal: Meal = {
      canteen: Number(row[`${column}_canteen` as keyof FoodOrderRow] ?? 0) || 0,
      sticky: Number(row[`${column}_sticky` as keyof FoodOrderRow] ?? 0) || 0,
      rice: Number(row[`${column}_rice` as keyof FoodOrderRow] ?? 0) || 0,
      point: String(row[`${column}_point` as keyof FoodOrderRow] ?? ''),
    }
    return [period, meal]
  }),
) as Meals

const toFoodOrder = (row: FoodOrderRow): FoodOrder => ({
  id: row.id,
  project: row.project,
  date: row.order_date,
  department: row.department,
  team: row.team,
  ...toMeals(row),
  note: row.note ?? '',
  status: (row.status ?? 'sent') as OrderStatus,
  submittedAt: row.submitted_at,
  submittedByLid: row.submitted_by_lid ?? '',
  submittedByName: row.submitted_by_name ?? '',
  total: Number(row.total) || 0,
})

/** เติมมื้อที่ไม่ได้ส่งมาให้เป็น 0 ทั้งหมด */
const fillMeals = (input: Partial<Meals>): Meals => Object.fromEntries(
  MEAL_PERIODS.map((period) => [period, { ...emptyMeal(), ...(input[period] ?? {}) }]),
) as Meals

const filterQuery = ({ project, date, fromDate, toDate, department, status }: OrderFilter): string => buildQuery([
  'select=*',
  project ? eq('project', project) : null,
  date ? eq('order_date', date) : null,
  fromDate ? `order_date=gte.${encodeURIComponent(fromDate)}` : null,
  toDate ? `order_date=lte.${encodeURIComponent(toDate)}` : null,
  department ? eq('department', department) : null,
  status ? eq('status', status) : null,
  'order=order_date.desc,department.asc,team.asc',
])

export const orderApi = {
  /** READ — ใบสั่งอาหารตามเงื่อนไข */
  list: async (filter: OrderFilter = {}): Promise<FoodOrder[]> => {
    const rows = await restListAll<FoodOrderRow>(TABLE, filterQuery(filter))
    return rows.map(toFoodOrder)
  },

  /** READ — ยอดรวมแยกตามมื้อ (ใช้กับหน้าสรุปของโรงครัว) */
  summarize: async (filter: OrderFilter = {}): Promise<{
    byPeriod: Record<string, number>
    grand: number
    teams: number
  }> => {
    const items = await orderApi.list(filter)
    const byPeriod = MEAL_PERIODS.reduce<Record<string, number>>((result, period) => {
      result[period] = items.reduce((sum, item) => {
        const meal = item[period]
        return sum + meal.canteen + meal.sticky + meal.rice
      }, 0)
      return result
    }, {})
    return {
      byPeriod,
      grand: items.reduce((sum, item) => sum + item.total, 0),
      teams: items.length,
    }
  },

  /**
   * CREATE/UPDATE — บันทึกทีละทีม (ค่าเริ่มต้นเก็บเป็น draft)
   *
   * ฐานข้อมูลเก็บเฉพาะมื้อที่มีจำนวน > 0 — ถ้าแก้ทุกมื้อเป็น 0 และไม่มีหมายเหตุ
   * แถวนั้นจะถูกลบทิ้งและฟังก์ชันคืนค่า null
   */
  save: async ({ project, date, department, team, meals, note = '', status = 'draft', submittedByLid, submittedByName }: {
    project: string
    date: string
    department: string
    team: string
    /** จุดส่งอยู่ใน meals[period].point */
    meals: Partial<Meals>
    note?: string
    status?: OrderStatus
    submittedByLid?: string
    submittedByName?: string
  }): Promise<FoodOrder | null> => {
    const row = await rpc<FoodOrderRow & { deleted?: boolean }>('upsert_food_order', {
      p_project: project,
      p_order_date: date,
      p_department: department,
      p_team: team,
      p_meals: fillMeals(meals),
      p_note: note,
      p_status: status,
      p_submitted_by_lid: submittedByLid ?? null,
      p_submitted_by_name: submittedByName ?? null,
    })
    const sameTeam = (item: FoodOrder): boolean => item.project === project
      && item.date === date
      && item.department === department
      && item.team === team

    if (row?.deleted) {
      orderStore.setState((current) => ({ items: current.items.filter((item) => !sameTeam(item)) }))
      return null
    }

    const order = toFoodOrder(row)
    orderStore.setState((current) => ({
      items: [...current.items.filter((item) => !sameTeam(item)), order],
    }))
    return order
  },

  /** CREATE/UPDATE — ส่งทั้งแผนกให้โรงครัวในครั้งเดียว (status = sent) */
  submitDepartment: async ({ project, date, department, orders, submittedByLid = '', submittedByName = '' }: {
    project: string
    date: string
    department: string
    orders: FoodOrderInput[]
    submittedByLid?: string
    submittedByName?: string
  }): Promise<{ saved: number; removed: number; submittedAt: string }> => {
    const result = await rpc<{ saved: number; removed: number; submitted_at: string }>('save_food_orders', {
      p_project: project,
      p_order_date: date,
      p_department: department,
      p_submitted_by_lid: submittedByLid,
      p_submitted_by_name: submittedByName,
      p_orders: orders,
    })
    return {
      saved: Number(result?.saved) || 0,
      removed: Number(result?.removed) || 0,
      submittedAt: result?.submitted_at ?? new Date().toISOString(),
    }
  },

  /** DELETE — ไม่ส่ง team = ลบทั้งแผนกของวันนั้น (ต้องมี PIN แอดมิน) */
  remove: async ({ project, date, department, team, adminPin }: {
    project: string
    date: string
    department: string
    team?: string
    adminPin: string
  }): Promise<number> => {
    const result = await rpc<{ deleted: number }>('delete_food_order', {
      p_project: project,
      p_order_date: date,
      p_department: department,
      p_admin_pin: adminPin,
      p_team: team ?? null,
    })
    orderStore.setState((current) => ({
      items: current.items.filter((item) => !(
        item.project === project
        && item.date === date
        && item.department === department
        && (!team || item.team === team)
      )),
    }))
    return Number(result?.deleted) || 0
  },

  /** โหลดเข้า store */
  load: async (filter: OrderFilter = {}): Promise<FoodOrder[]> =>
    withAsync(orderStore, async () => {
      const items = await orderApi.list(filter)
      orderStore.setState({ items, total: items.reduce((sum, item) => sum + item.total, 0) })
      return items
    }),
}
