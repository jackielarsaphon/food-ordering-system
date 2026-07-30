/**
 * userStore — บัญชีผู้ใช้แอป (ตาราง app_users)
 *
 * การเขียนทุกอย่างวิ่งผ่าน database function เพราะ RLS บล็อก INSERT/UPDATE/DELETE
 * ตรงจากเบราว์เซอร์ไว้ทั้งหมด และคอลัมน์ pin_hash ถูกปิดสิทธิ์ไม่ให้อ่าน
 */

import type { AppUser, AppUserRow, Project, UserRole } from '../types/database'
import { buildQuery, eq, restList, rpc } from '../lib/supabaseRest'
import { createStore, initialAsyncState, withAsync, type AsyncState } from './createStore'

const TABLE = 'app_users'

const READ_COLUMNS = [
  'lid', 'role', 'title', 'first_name', 'last_name', 'full_name', 'position',
  'department', 'location', 'company', 'project', 'is_demo', 'created_at', 'last_login_at',
].join(',')

/** ข้อมูลที่หน้าสมัครส่งเข้า register() — ช่องโปรไฟล์เว้นว่างได้ */
export interface RegisterInput {
  lid: string
  pin: string
  role?: UserRole
  title?: string
  firstName?: string
  lastName?: string
  position?: string
  department?: string
  location?: string
  company?: string
  project?: string
}

export interface UserState extends AsyncState {
  /** ผู้ใช้ที่ล็อกอินอยู่ */
  current: AppUser | null
  /** รายชื่อบัญชีจากการเรียก load() ครั้งล่าสุด */
  items: AppUser[]
}

export const userStore = createStore<UserState>({
  ...initialAsyncState,
  current: null,
  items: [],
})

const toAppUser = (row: AppUserRow): AppUser => ({
  id: row.lid,
  lid: row.lid,
  role: (row.role ?? 'user') as UserRole,
  title: row.title ?? '',
  firstName: row.first_name ?? '',
  lastName: row.last_name ?? '',
  fullName: row.full_name ?? '',
  position: row.position ?? '',
  department: row.department ?? '',
  location: row.location ?? '',
  company: row.company ?? '',
  project: row.project,
  isDemo: Boolean(row.is_demo),
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
})

export const userApi = {
  /** READ — รายชื่อบัญชี (ไม่มีคอลัมน์ PIN) */
  list: async ({ project }: { project?: Project | string } = {}): Promise<AppUser[]> => {
    const rows = await restList<AppUserRow>(TABLE, buildQuery([
      `select=${READ_COLUMNS}`,
      project ? eq('project', project) : null,
      'order=created_at.desc',
    ]))
    return rows.map(toAppUser)
  },

  /** READ — บัญชีเดียวจาก LID */
  byLid: async (lid: string): Promise<AppUser | null> => {
    const key = String(lid ?? '').trim()
    if (!key) return null
    const [row] = await restList<AppUserRow>(TABLE, buildQuery([
      `select=${READ_COLUMNS}`, eq('lid', key), 'limit=1',
    ]))
    return row ? toAppUser(row) : null
  },

  /**
   * CREATE — สมัครใหม่ด้วยข้อมูลที่กรอกในหน้าสมัคร (ไม่ต้องมี LID ใน employees ก่อน)
   *
   * ช่องที่ส่งมาว่างและ LID นั้นบังเอิญมีในตาราง employees ฐานข้อมูลจะเติมให้เอง
   */
  register: async ({ lid, pin, role = 'user', ...profile }: RegisterInput): Promise<AppUser> => {
    const text = (value?: string) => String(value ?? '').trim()
    const row = await rpc<AppUserRow>('register_user', {
      p_lid: text(lid),
      p_pin: String(pin ?? ''),
      p_role: role,
      p_title: text(profile.title),
      p_first_name: text(profile.firstName),
      p_last_name: text(profile.lastName),
      p_position: text(profile.position),
      p_department: text(profile.department),
      p_location: text(profile.location),
      p_company: text(profile.company),
      p_project: text(profile.project),
    })
    const user = toAppUser(row)
    userStore.setState((current) => ({
      items: [user, ...current.items.filter((item) => item.lid !== user.lid)],
    }))
    return user
  },

  /** เข้าสู่ระบบ — ฐานข้อมูลเทียบ PIN กับ bcrypt hash ให้ */
  login: async (lid: string, pin: string): Promise<AppUser> => {
    const row = await rpc<AppUserRow>('login_user', {
      p_lid: String(lid ?? '').trim(),
      p_pin: String(pin ?? ''),
    })
    const user = toAppUser(row)
    userStore.setState({ current: user })
    return user
  },

  logout: (): void => {
    userStore.setState({ current: null })
  },

  /** UPDATE — เปลี่ยนรหัสตัวเอง (ต้องรู้รหัสเดิม) */
  changePin: async ({ lid, oldPin, newPin }: {
    lid: string
    oldPin: string
    newPin: string
  }): Promise<void> => {
    await rpc('change_user_pin', {
      p_lid: String(lid ?? '').trim(),
      p_old_pin: String(oldPin ?? ''),
      p_new_pin: String(newPin ?? ''),
    })
  },

  /** UPDATE — แอดมินรีเซ็ตรหัสให้ผู้ใช้ */
  resetPin: async ({ lid, newPin, adminPin }: {
    lid: string
    newPin: string
    adminPin: string
  }): Promise<void> => {
    await rpc('reset_user_pin', {
      p_lid: String(lid ?? '').trim(),
      p_new_pin: String(newPin ?? ''),
      p_admin_pin: String(adminPin ?? ''),
    })
  },

  /** DELETE — ลบบัญชี (ตรวจ PIN แอดมินฝั่งเซิร์ฟเวอร์) */
  remove: async (lid: string, adminPin: string): Promise<void> => {
    const key = String(lid ?? '').trim()
    await rpc('delete_user', { p_lid: key, p_admin_pin: String(adminPin ?? '') })
    userStore.setState((current) => ({
      items: current.items.filter((item) => item.lid !== key),
      current: current.current?.lid === key ? null : current.current,
    }))
  },

  /** โหลดรายชื่อเข้า store */
  load: async (params: { project?: Project | string } = {}): Promise<AppUser[]> =>
    withAsync(userStore, async () => {
      const items = await userApi.list(params)
      userStore.setState({ items })
      return items
    }),
}
