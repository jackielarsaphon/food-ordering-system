-- ============================================================================
-- ย้ายข้อมูลแอปทั้งหมดมาเก็บที่ Supabase (เลิกเขียนลง Google Sheets)
--   app_users   = บัญชีผู้ใช้แอป  (แทนชีต users)
--   food_orders = ใบสั่งอาหาร      (แทนชีต order)
--   app_config  = ค่าตั้งค่าลับ เช่น PIN แอดมิน
--
-- รันใน Supabase Dashboard > SQL Editor (รันซ้ำได้ ไม่พัง)
-- ต้องรัน 01_employees_schema.sql ก่อนไฟล์นี้
-- ============================================================================

create extension if not exists pgcrypto;   -- ใช้ crypt() เข้ารหัส PIN

-- ---------------------------------------------------------------------------
-- app_config : ค่าลับที่ฝั่งเบราว์เซอร์ต้องไม่เห็น
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value)
values ('admin_pin', '9999')          -- <<< เปลี่ยนรหัสนี้ทีหลังได้ที่ตารางนี้
on conflict (key) do nothing;

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;   -- ไม่มีใครอ่านได้นอกจาก function

-- ---------------------------------------------------------------------------
-- app_users : บัญชีผู้ใช้แอป — PIN เก็บเป็น hash อ่านย้อนกลับไม่ได้
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  lid           text primary key,
  pin_hash      text not null,
  role          text not null default 'user',      -- user | admin
  title         text,
  first_name    text,
  last_name     text,
  "position"    text,
  department    text,
  location      text,
  company       text,
  project       text,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz,
  full_name     text generated always as
                  (btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) stored
);

comment on table public.app_users is 'บัญชีผู้ใช้แอป — เขียนผ่าน function เท่านั้น, pin_hash ห้ามอ่านจากเบราว์เซอร์';

create index if not exists app_users_project_idx    on public.app_users (project);
create index if not exists app_users_department_idx on public.app_users (department);

alter table public.app_users enable row level security;

drop policy if exists app_users_read on public.app_users;
create policy app_users_read on public.app_users for select to anon, authenticated using (true);

-- กันอ่าน pin_hash ด้วยสิทธิ์ระดับคอลัมน์ (RLS คุมได้แค่ระดับแถว)
revoke all on public.app_users from anon, authenticated;
grant select (
  lid, role, title, first_name, last_name, "position", department, location,
  company, project, is_demo, created_at, updated_at, last_login_at, full_name
) on public.app_users to anon, authenticated;

-- ---------------------------------------------------------------------------
-- food_orders : 1 แถว = 1 ทีมงาน ต่อ 1 วัน ต่อ 1 แผนก ต่อ 1 โครงการ
-- ---------------------------------------------------------------------------
create table if not exists public.food_orders (
  id                    uuid primary key default gen_random_uuid(),
  project               text not null,             -- xepon | sekong
  order_date            date not null,
  department            text not null,
  team                  text not null,

  morning_canteen       integer not null default 0,
  morning_sticky        integer not null default 0,
  morning_rice          integer not null default 0,
  lunch_canteen         integer not null default 0,
  lunch_sticky          integer not null default 0,
  lunch_rice            integer not null default 0,
  dinner_canteen        integer not null default 0,
  dinner_sticky         integer not null default 0,
  dinner_rice           integer not null default 0,
  late_night_canteen    integer not null default 0,
  late_night_sticky     integer not null default 0,
  late_night_rice       integer not null default 0,
  irregular_canteen     integer not null default 0,
  irregular_sticky      integer not null default 0,
  irregular_rice        integer not null default 0,

  note                  text not null default '',
  status                text not null default 'draft',   -- draft | confirmed | sent
  submitted_at          timestamptz,
  submitted_by_lid      text,
  submitted_by_name     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  total                 integer generated always as (
                          morning_canteen + morning_sticky + morning_rice
                        + lunch_canteen + lunch_sticky + lunch_rice
                        + dinner_canteen + dinner_sticky + dinner_rice
                        + late_night_canteen + late_night_sticky + late_night_rice
                        + irregular_canteen + irregular_sticky + irregular_rice) stored,

  constraint food_orders_unique_team unique (project, order_date, department, team)
);

comment on table public.food_orders is 'ใบสั่งอาหาร — เขียนผ่าน function save_food_orders เท่านั้น';

create index if not exists food_orders_lookup_idx on public.food_orders (project, order_date, department);
create index if not exists food_orders_date_idx   on public.food_orders (order_date desc);

alter table public.food_orders enable row level security;

-- อ่านได้ (ยอดอาหารไม่ใช่ความลับ) แต่เขียนตรงไม่ได้ ต้องผ่าน function
drop policy if exists food_orders_read on public.food_orders;
create policy food_orders_read on public.food_orders for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Realtime : ให้หน้าจอโรงครัวเห็นออเดอร์ใหม่ทันทีที่แผนกกดส่ง
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.food_orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.app_users;
exception when duplicate_object then null;
end $$;
