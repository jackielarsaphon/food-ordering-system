/**
 * deliveryPointStore — รายการสถานที่ส่งข้าวห่อจากตาราง delivery_points
 *
 * อ่านผ่าน REST ตาม RLS; เพิ่ม/แก้ไข/ลบผ่าน RPC ที่ตรวจ PIN แอดมินในฐานข้อมูล
 */

import { buildQuery, eq, restList, rpc } from '../lib/supabaseRest'

interface DeliveryPointRow {
  id: number
  project: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

const TABLE = 'delivery_points'
const READ_COLUMNS = 'id,project,name,sort_order,created_at,updated_at'

const clean = (value: unknown): string => String(value ?? '').trim()

export const deliveryPointApi = {
  /** READ — รายการที่เปิดให้เลือก เรียงตามลำดับที่แอดมินกำหนด */
  list: async ({ project }: { project: string }): Promise<string[]> => {
    const projectKey = clean(project).toLowerCase()
    if (!projectKey) return []
    const rows = await restList<DeliveryPointRow>(TABLE, buildQuery([
      `select=${READ_COLUMNS}`,
      eq('project', projectKey),
      'order=sort_order.asc,id.asc',
    ]))
    return rows.map((row) => clean(row.name)).filter(Boolean)
  },

  /** CREATE — ต้องผ่าน PIN แอดมิน */
  create: async ({ project, name, adminPin }: {
    project: string
    name: string
    adminPin: string
  }): Promise<string> => {
    const row = await rpc<DeliveryPointRow>('create_delivery_point', {
      p_project: clean(project).toLowerCase(),
      p_name: clean(name),
      p_admin_pin: clean(adminPin),
    })
    return clean(row?.name)
  },

  /** UPDATE — เปลี่ยนเฉพาะรายการตั้งค่า ไม่เปลี่ยนชื่อในออเดอร์ย้อนหลัง */
  rename: async ({ project, currentName, newName, adminPin }: {
    project: string
    currentName: string
    newName: string
    adminPin: string
  }): Promise<string> => {
    const row = await rpc<DeliveryPointRow>('rename_delivery_point', {
      p_project: clean(project).toLowerCase(),
      p_current_name: clean(currentName),
      p_new_name: clean(newName),
      p_admin_pin: clean(adminPin),
    })
    return clean(row?.name)
  },

  /** DELETE — ประวัติใน food_orders ไม่ถูกลบตาม */
  remove: async ({ project, name, adminPin }: {
    project: string
    name: string
    adminPin: string
  }): Promise<void> => {
    await rpc('delete_delivery_point', {
      p_project: clean(project).toLowerCase(),
      p_name: clean(name),
      p_admin_pin: clean(adminPin),
    })
  },
}
