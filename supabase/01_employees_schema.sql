-- ============================================================================
-- ตาราง employees : ปลายทางของ Google Sheets ชีต "dataforscan1"
-- รันไฟล์นี้ใน Supabase Dashboard > SQL Editor (รันซ้ำได้ ไม่พัง)
--
-- ห้ามแก้ข้อมูลในตารางนี้ด้วยมือ — ทุกครั้งที่ sync จะถูกเขียนทับจากชีต
-- ชีตคือ source of truth
-- ============================================================================

create table if not exists public.employees (
  -- LID = คีย์หลัก (EmployeeID ว่างหลายแถว จึงใช้เป็นคีย์ไม่ได้)
  lid          text primary key,

  employee_id  text,          -- คอลัมน์ A  EmployeeID  (อาจว่าง)
  title        text,          -- คอลัมน์ C  MR–MRS      นาย / นาง / นางสาว / น.ส.
  first_name   text,          -- คอลัมน์ D  FirstName
  last_name    text,          -- คอลัมน์ E  LastName
  "position"   text,          -- คอลัมน์ F  position
  department   text,          -- คอลัมน์ G  department
  location     text,          -- คอลัมน์ H  location    เซโปน / เซกอง / หงสา / เวียงจันทน์
  company      text,          -- คอลัมน์ I  company
  status       text,          -- คอลัมน์ J  Status      Work / Off

  project      text,          -- คำนวณจาก location โดย Apps Script: xepon / sekong
  sheet_row    integer,       -- เลขแถวในชีต (ไว้ debug ย้อนกลับไปหาต้นทาง)

  -- คอลัมน์คำนวณอัตโนมัติ (ห้ามส่งค่าเข้ามา)
  full_name    text    generated always as
                 (btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) stored,
  is_active    boolean generated always as
                 (upper(btrim(coalesce(status, ''))) = 'WORK') stored,

  synced_at    timestamptz not null default now(),   -- ใช้ตรวจว่าแถวตกรอบ sync (= ถูกลบจากชีต)
  deleted_at   timestamptz,                          -- มีค่า = ถูกลบออกจากชีตแล้ว (soft delete)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table  public.employees is 'พนักงาน — sync อัตโนมัติจาก Google Sheets ชีต dataforscan1 (read-only)';
comment on column public.employees.lid       is 'LID = คีย์ที่ใช้ match กับชีต ห้ามเปลี่ยนค่าในชีต';
comment on column public.employees.is_active is 'true เมื่อ Status = Work';

create index if not exists employees_project_idx     on public.employees (project);
create index if not exists employees_department_idx   on public.employees (department);
create index if not exists employees_is_active_idx    on public.employees (is_active);
create index if not exists employees_employee_id_idx  on public.employees (employee_id);
create index if not exists employees_full_name_idx    on public.employees (full_name);

-- ---------------------------------------------------------------------------
-- RLS : ฝั่งเว็บ (anon key) อ่านได้เท่านั้น / เขียนได้แค่ service_role ใน Apps Script
-- ---------------------------------------------------------------------------
alter table public.employees enable row level security;

drop policy if exists employees_read on public.employees;
create policy employees_read
  on public.employees
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- เปิด Realtime เพื่อให้หน้าเว็บอัปเดตทันทีเมื่อชีตเปลี่ยน
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.employees;
exception
  when duplicate_object then null;   -- เพิ่มไว้แล้ว
end $$;

-- ---------------------------------------------------------------------------
-- คำสั่งตรวจผลหลัง sync
-- ---------------------------------------------------------------------------
-- select count(*) as total,
--        count(*) filter (where is_active)          as working,
--        count(*) filter (where not is_active)      as off_duty,
--        count(*) filter (where employee_id is null) as no_employee_id,
--        max(synced_at)                             as last_sync
--   from public.employees;
--
-- select project, department, count(*) from public.employees group by 1, 2 order by 1, 2;
