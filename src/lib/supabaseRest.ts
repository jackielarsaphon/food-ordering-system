/**
 * ตัวเชื่อม Supabase ระดับล่างสุด — ทุก store เรียกผ่านไฟล์นี้เท่านั้น
 *
 * ใช้ REST API (PostgREST) ตรงๆ ไม่ต้องลง @supabase/supabase-js
 * คีย์ที่ใช้เป็น publishable key: อ่านได้ตาม RLS / เขียนตรงไม่ได้เลย
 * การเขียนทุกอย่างต้องผ่าน rpc() ไปที่ database function
 */

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const SUPABASE_KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()

/** PostgREST คืนได้สูงสุด 1000 แถวต่อ request (employees มี 1,816 แถว) */
export const PAGE_SIZE = 1000

export class SupabaseError extends Error {
  readonly status: number
  readonly code?: string
  readonly hint?: string

  constructor(message: string, status: number, code?: string, hint?: string) {
    super(message)
    this.name = 'SupabaseError'
    this.status = status
    this.code = code
    this.hint = hint
  }
}

export const supabaseConfigured = (): boolean => Boolean(SUPABASE_URL && SUPABASE_KEY)

const authHeaders = (): Record<string, string> => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
})

const requireConfig = (): void => {
  if (!supabaseConfigured()) {
    throw new SupabaseError(
      'ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY ในไฟล์ .env (แก้แล้วต้องรีสตาร์ท npm run dev)',
      0,
    )
  }
}

/** ดึงข้อความ error ที่อ่านรู้เรื่อง — ข้อความจาก raise exception จะอยู่ใน .message */
const toError = async (response: Response): Promise<SupabaseError> => {
  const raw = await response.text()
  let message = raw || `Supabase ${response.status}`
  let code: string | undefined
  let hint: string | undefined

  try {
    const body = JSON.parse(raw) as { message?: string; details?: string; code?: string; hint?: string }
    message = body.message || body.details || message
    code = body.code
    hint = body.hint
  } catch {
    // ไม่ใช่ JSON — ใช้ข้อความดิบ
  }

  // PostgREST ตอบ 404 ได้จาก 2 สาเหตุที่ต่างกันมาก — แยกให้ชัดเพื่อไม่ให้ไล่ผิดทาง
  if (response.status === 404 && response.url.includes('/rpc/')) {
    const fn = response.url.split('/rpc/')[1]?.split('?')[0] ?? 'function'
    if (code === 'PGRST202') {
      // ไม่มีฟังก์ชันนี้ในฐานข้อมูลจริง (หรือชื่อพารามิเตอร์ไม่ตรง)
      message = fn.includes('delivery_point')
        ? `ฐานข้อมูลยังไม่มีฟังก์ชัน ${fn} — ต้องรัน supabase/11_delivery_points.sql ใน SQL Editor ก่อน`
        : `ฐานข้อมูลยังไม่มีฟังก์ชัน ${fn} — ต้องรัน supabase/03_functions.sql และ supabase/05_orders_crud.sql ใน SQL Editor ก่อน`
    } else if (code === '42883') {
      // ฟังก์ชันมีอยู่ แต่ข้างในเรียกฟังก์ชันอื่นที่หาไม่เจอ (เกือบทุกครั้งคือ pgcrypto/search_path)
      message = `${fn} ทำงานไม่ได้: ${message} — แก้ด้วย supabase/06_fix_pgcrypto_search_path.sql`
    } else {
      message = `${fn} (${code ?? response.status}): ${message}`
    }
  }
  if (response.status === 404 && response.url.includes('/delivery_points?')) {
    message = 'ฐานข้อมูลยังไม่มีตาราง delivery_points — ต้องรัน supabase/11_delivery_points.sql ใน SQL Editor ก่อน'
  }

  return new SupabaseError(message, response.status, code, hint)
}

export interface QueryOptions {
  /** ช่วงแถวที่ต้องการ [เริ่ม, จบ] แบบ 0-based */
  range?: [number, number]
  /** ขอจำนวนแถวทั้งหมดกลับมาด้วย (อ่านจาก header content-range) */
  exactCount?: boolean
  signal?: AbortSignal
}

const send = async (path: string, init: RequestInit, extraHeaders: Record<string, string> = {}): Promise<Response> => {
  requireConfig()
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...authHeaders(), ...extraHeaders, ...(init.headers as Record<string, string> | undefined) },
  })
  if (!response.ok) throw await toError(response)
  return response
}

const queryHeaders = ({ range, exactCount }: QueryOptions): Record<string, string> => {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (range) headers.Range = `${range[0]}-${range[1]}`
  if (exactCount) headers.Prefer = 'count=exact'
  return headers
}

/** อ่านข้อมูล 1 หน้า — query คือ query string ของ PostgREST เช่น 'select=*&lid=eq.123' */
export const restList = async <Row>(table: string, query: string, options: QueryOptions = {}): Promise<Row[]> => {
  const response = await send(`${table}?${query}`, { method: 'GET', signal: options.signal }, queryHeaders(options))
  return (await response.json()) as Row[]
}

/** อ่านข้อมูลให้ครบทุกหน้า (ใช้เมื่อข้อมูลอาจเกิน 1000 แถว) */
export const restListAll = async <Row>(table: string, query: string, options: QueryOptions = {}): Promise<Row[]> => {
  const all: Row[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await restList<Row>(table, query, { ...options, range: [from, from + PAGE_SIZE - 1] })
    all.push(...page)
    if (page.length < PAGE_SIZE) return all
  }
}

/** นับจำนวนแถว — ไม่ต้องโหลดข้อมูลจริง อ่านตัวเลขจาก header */
export const restCount = async (table: string, query: string, options: QueryOptions = {}): Promise<number> => {
  const response = await send(
    `${table}?${query}`,
    { method: 'GET', signal: options.signal },
    queryHeaders({ ...options, range: [0, 0], exactCount: true }),
  )
  return Number((response.headers.get('content-range') ?? '').split('/')[1]) || 0
}

/** เรียก database function — ใช้กับการเขียนข้อมูลทุกกรณี */
export const rpc = async <Result>(
  fn: string,
  params: Record<string, unknown> = {},
  options: { signal?: AbortSignal } = {},
): Promise<Result> => {
  const response = await send(`rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(params),
    signal: options.signal,
    headers: { 'Content-Type': 'application/json' },
  })
  const raw = await response.text()
  return (raw ? JSON.parse(raw) : null) as Result
}

/** ต่อ filter หลายตัวเป็น query string เดียว (ตัดค่าว่างออกให้) */
export const buildQuery = (parts: Array<string | false | null | undefined>): string =>
  parts.filter((part): part is string => Boolean(part)).join('&')

/** ใส่ค่า filter ให้ปลอดภัย เช่น eq('department', 'Civil & Central Service') */
export const eq = (column: string, value: string | number | boolean): string =>
  `${column}=eq.${encodeURIComponent(String(value))}`
