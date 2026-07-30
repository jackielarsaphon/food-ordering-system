/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** เช่น https://yorziyqfagjkzaitkpft.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** publishable key เท่านั้น — ห้ามใส่ secret key / service_role ในไฟล์ .env ของเว็บ */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Apps Script Web App URL เดิม (เหลือไว้เป็นทางถอย) */
  readonly VITE_GOOGLE_SCRIPT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
