-- ============================================================================
-- เชื่อมตารางเข้าหากันด้วย foreign key
--
--   employees.lid  ◄──────── app_users.lid            (1 พนักงาน = 1 บัญชี)
--   app_users.lid  ◄──────── food_orders.submitted_by_lid
--
-- เงื่อนไขสำคัญ: ต้องเลิกลบแถว employees แบบลบจริงก่อน ไม่งั้น FK จะทำให้
-- การ sync ล้มทุกครั้งที่ HR ลบคนออกจากชีต -> เปลี่ยนเป็น soft delete
-- (ใส่เวลาไว้ที่ deleted_at แล้วให้แอปกรองออกเอง)
--
-- รันหลัง 01, 02, 03  (รันซ้ำได้)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) soft delete สำหรับ employees
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists deleted_at timestamptz;

comment on column public.employees.deleted_at is
  'มีค่า = ถูกลบออกจากชีต dataforscan1 แล้ว แต่เก็บแถวไว้เพื่อไม่ให้บัญชี/ประวัติออเดอร์พัง';

create index if not exists employees_deleted_at_idx on public.employees (deleted_at);

-- ---------------------------------------------------------------------------
-- 2) app_users.lid -> employees.lid
--    on delete restrict = ห้ามลบพนักงานที่ยังมีบัญชีอยู่ (จะไม่เกิดเพราะ soft delete แล้ว)
--    on update cascade  = ถ้าแก้ LID ในชีต บัญชีตามไปด้วย
--
--    เลิกใช้แล้ว: 12_app_users_free_lid.sql ถอด FK ตัวนี้ออก เพราะ 10_register_user_manual.sql
--    เปลี่ยนกติกาไปว่า LID ที่ไม่มีในชีตก็สมัครได้ ถ้ารัน 04 ซ้ำภายหลังให้รัน 12 ตามด้วย
-- ---------------------------------------------------------------------------
do $$
begin
  alter table public.app_users
    add constraint app_users_lid_fkey
    foreign key (lid) references public.employees (lid)
    on update cascade
    on delete restrict;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 3) food_orders.submitted_by_lid -> app_users.lid
--    on delete set null = ลบบัญชีได้ ออเดอร์เก่ายังอยู่ แค่ไม่รู้ว่าใครส่ง
-- ---------------------------------------------------------------------------
do $$
begin
  alter table public.food_orders
    add constraint food_orders_submitted_by_fkey
    foreign key (submitted_by_lid) references public.app_users (lid)
    on update cascade
    on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists food_orders_submitted_by_idx on public.food_orders (submitted_by_lid);

-- ---------------------------------------------------------------------------
-- 4) วิวสำหรับใช้งานทั่วไป — เห็นแต่พนักงานที่ยังอยู่ในชีต
-- ---------------------------------------------------------------------------
create or replace view public.employees_current as
  select * from public.employees where deleted_at is null;

grant select on public.employees_current to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------------
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid in ('public.app_users'::regclass, 'public.food_orders'::regclass)
--    and contype = 'f';
