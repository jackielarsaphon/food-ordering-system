/**
 * employeeStore — ข้อมูลพนักงานจากตาราง employees
 *
 * อ่านอย่างเดียว (read-only) เพราะต้นทางจริงคือชีต dataforscan1
 * ถ้าจะแก้ข้อมูลพนักงานต้องไปแก้ในชีต แล้ว Apps Script จะ sync มาให้เองใน 5–10 วินาที
 */

import type { Employee, EmployeeRow, Project } from '../types/database'
import { buildQuery, eq, restCount, restList, restListAll } from '../lib/supabaseRest'
import { createStore, initialAsyncState, withAsync, type AsyncState } from './createStore'

const TABLE = 'employees'

/**
 * true  = นับหัวคนเฉพาะที่ Status = Work (ปัจจุบัน 1,466 คน)
 * false = นับทุกคนรวมที่ Status = Off  (ปัจจุบัน 1,816 คน)
 */
export const COUNT_ONLY_WORKING = true

export interface EmployeeFilter {
  project?: Project | string
  /**
   * ชื่อ location แบบตรงตัวอักษร เช่น 'เชโปน' / 'เซกอง'
   * เจาะจงกว่า project เพราะ project ถูกคำนวณตอน sync ซึ่งอาจรวม location อื่นเข้ามา
   */
  location?: string
  department?: string
  /** นับ/ดึงเฉพาะคนที่ Status = Work */
  activeOnly?: boolean
  /** คำค้นในชื่อ–นามสกุล–ตำแหน่ง */
  search?: string
}

export interface EmployeeState extends AsyncState {
  /** ผลลัพธ์ของการเรียก list() ครั้งล่าสุด */
  items: Employee[]
  /** จำนวนคนแยกตามแผนก จากการเรียก countByDepartment() ครั้งล่าสุด */
  departmentCounts: Record<string, number>
  total: number
}

export const employeeStore = createStore<EmployeeState>({
  ...initialAsyncState,
  items: [],
  departmentCounts: {},
  total: 0,
})

const toEmployee = (row: EmployeeRow): Employee => ({
  lid: row.lid,
  employeeId: row.employee_id,
  title: row.title ?? '',
  firstName: row.first_name ?? '',
  lastName: row.last_name ?? '',
  fullName: row.full_name ?? '',
  position: row.position ?? '',
  department: row.department ?? '',
  location: row.location ?? '',
  company: row.company ?? '',
  status: row.status ?? '',
  isActive: Boolean(row.is_active),
  project: row.project,
  syncedAt: row.synced_at,
})

const filterQuery = (
  { project, location, department, activeOnly = COUNT_ONLY_WORKING, search }: EmployeeFilter,
  columns = '*',
): string => buildQuery([
  `select=${columns}`,
  // deleted_at ไม่ null = ถูกลบออกจากชีตแล้ว (เก็บแถวไว้เพราะ app_users ผูก FK อยู่)
  'deleted_at=is.null',
  project ? eq('project', project) : null,
  location ? eq('location', location) : null,
  department ? eq('department', department) : null,
  activeOnly ? 'is_active=is.true' : null,
  search ? `or=(full_name.ilike.*${encodeURIComponent(search)}*,position.ilike.*${encodeURIComponent(search)}*)` : null,
])

export const employeeApi = {
  /** READ — รายชื่อพนักงาน (ไล่ทุกหน้าให้ครบ ไม่ติดเพดาน 1000 แถว) */
  list: async (filter: EmployeeFilter = {}): Promise<Employee[]> => {
    const rows = await restListAll<EmployeeRow>(TABLE, `${filterQuery(filter)}&order=lid.asc`)
    return rows.map(toEmployee)
  },

  /** READ — พนักงาน 1 คนจาก LID (ใช้ในหน้าสมัครสมาชิก) */
  byLid: async (lid: string): Promise<Employee | null> => {
    const key = String(lid ?? '').trim()
    if (!key) return null
    const [row] = await restList<EmployeeRow>(
      TABLE,
      buildQuery(['select=*', 'deleted_at=is.null', eq('lid', key), 'limit=1']),
    )
    return row ? toEmployee(row) : null
  },

  /** READ — จำนวนคน (อ่านจาก header ไม่โหลดข้อมูลจริง) */
  count: async (filter: EmployeeFilter = {}): Promise<number> =>
    restCount(TABLE, filterQuery(filter, 'lid')),

  /** READ — จำนวนคนแยกตามแผนกในโครงการเดียว */
  countByDepartment: async (
    filter: EmployeeFilter = {},
  ): Promise<{ total: number; counts: Record<string, number> }> => {
    const rows = await restListAll<Pick<EmployeeRow, 'lid' | 'department'>>(
      TABLE,
      filterQuery(filter, 'lid,department'),
    )
    const counts = rows.reduce<Record<string, number>>((result, row) => {
      const name = String(row.department ?? '').trim()
      if (name) result[name] = (result[name] ?? 0) + 1
      return result
    }, {})
    return { total: rows.length, counts }
  },

  /** โหลดเข้า store (ให้ component subscribe แล้วอ่านจาก useStore ได้) */
  load: async (filter: EmployeeFilter = {}): Promise<Employee[]> =>
    withAsync(employeeStore, async () => {
      const items = await employeeApi.list(filter)
      employeeStore.setState({ items, total: items.length })
      return items
    }),

  /** โหลดจำนวนคนแยกแผนกเข้า store */
  loadDepartmentCounts: async (filter: EmployeeFilter = {}): Promise<Record<string, number>> =>
    withAsync(employeeStore, async () => {
      const { total, counts } = await employeeApi.countByDepartment(filter)
      employeeStore.setState({ departmentCounts: counts, total })
      return counts
    }),
}
