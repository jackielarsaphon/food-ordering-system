-- ============================================================================
-- ปรับโครงสร้าง food_orders ใหม่ : แยกหัวออเดอร์ ออกจาก รายการรายมื้อ
--
-- ปัญหาของโครงเดิม (ตารางแนวกว้าง 29 คอลัมน์):
--   • เพิ่มข้อมูลต่อมื้อ 1 อย่าง = เพิ่มคอลัมน์ 5 ช่อง (จุดส่งเพิ่งเจอปัญหานี้)
--   • เพิ่มมื้อใหม่ = เพิ่มคอลัมน์อีก 4-6 ช่อง + แก้ทุก function
--   • ถามว่า "มื้อเที่ยงส่งห่อไปกี่จุด" ต้องเขียน SQL ยาว เพราะข้อมูลมื้ออยู่คนละคอลัมน์
--
-- โครงใหม่:
--   food_orders       = 1 แถวต่อ 1 ทีมงานต่อวัน  (หัวออเดอร์: ใคร แผนกไหน ส่งเมื่อไร)
--   food_order_items  = 1 แถวต่อ 1 มื้อ           (จำนวน + จุดส่งของมื้อนั้น)
--   food_orders_wide  = วิวที่แปลงกลับเป็นแนวกว้างให้แอปอ่านเหมือนเดิม
--
-- ไฟล์นี้แทน 08_delivery_point_per_meal.sql — รันเฉพาะไฟล์นี้พอ (รันซ้ำได้)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ตารางรายการอาหารรายมื้อ
-- ---------------------------------------------------------------------------
create table if not exists public.food_order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.food_orders (id) on delete cascade,
  meal       text not null check (meal in ('morning', 'lunch', 'dinner', 'lateNight', 'irregular')),

  canteen    integer not null default 0 check (canteen >= 0),   -- ทานที่โรงครัว
  sticky     integer not null default 0 check (sticky >= 0),    -- ข้าวเหนียวห่อ
  rice       integer not null default 0 check (rice >= 0),      -- ข้าวจ้าวห่อ
  point      text    not null default '',                       -- จุดส่งห่อของมื้อนี้

  packed     integer generated always as (sticky + rice) stored,
  total      integer generated always as (canteen + sticky + rice) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint food_order_items_unique unique (order_id, meal)
);

comment on table  public.food_order_items is 'จำนวนอาหารและจุดส่ง แยกตามมื้อ — 1 แถวต่อ 1 มื้อของทีมนั้น';
comment on column public.food_order_items.point is 'จุดส่งข้าวห่อของมื้อนี้ ใช้เมื่อ packed > 0';

create index if not exists food_order_items_order_idx on public.food_order_items (order_id);
create index if not exists food_order_items_meal_idx  on public.food_order_items (meal);
create index if not exists food_order_items_point_idx on public.food_order_items (point) where point <> '';

alter table public.food_order_items enable row level security;

drop policy if exists food_order_items_read on public.food_order_items;
create policy food_order_items_read on public.food_order_items
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2) ย้ายข้อมูลเดิมจากคอลัมน์แนวกว้างเข้า food_order_items
--    รองรับทั้งกรณีที่ยังมี delivery_point (โครง 07) และกรณีมี *_point (โครง 08)
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_wide  boolean;
  v_has_point boolean;   -- มีคอลัมน์จุดส่งรายมื้อจาก 08 หรือไม่
  v_has_old   boolean;   -- มีคอลัมน์ delivery_point จาก 07 หรือไม่
  v_meal      text;
  v_column    text;
  v_point_sql text;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'food_orders' and column_name = 'morning_canteen'
  ) into v_has_wide;

  if not v_has_wide then
    raise notice 'ไม่มีคอลัมน์แนวกว้างแล้ว — ข้ามขั้นย้ายข้อมูล';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'food_orders' and column_name = 'morning_point'
  ) into v_has_point;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'food_orders' and column_name = 'delivery_point'
  ) into v_has_old;

  foreach v_meal in array array['morning', 'lunch', 'dinner', 'lateNight', 'irregular'] loop
    -- ชื่อคอลัมน์ในตารางเดิมใช้ late_night ไม่ใช่ lateNight
    v_column := case when v_meal = 'lateNight' then 'late_night' else v_meal end;

    v_point_sql := case
      when v_has_point then format('coalesce(o.%I, '''')', v_column || '_point')
      when v_has_old   then 'coalesce(o.delivery_point, '''')'
      else ''''''
    end;

    execute format($ins$
      insert into public.food_order_items (order_id, meal, canteen, sticky, rice, point)
      select o.id, %L, o.%I, o.%I, o.%I, %s
        from public.food_orders o
       where not exists (
               select 1 from public.food_order_items i
                where i.order_id = o.id and i.meal = %L)
    $ins$, v_meal, v_column || '_canteen', v_column || '_sticky', v_column || '_rice', v_point_sql, v_meal);
  end loop;

  raise notice 'ย้ายข้อมูลรายมื้อเข้า food_order_items แล้ว';
end $$;

-- ---------------------------------------------------------------------------
-- 3) ลบคอลัมน์แนวกว้างออกจาก food_orders (เหลือแต่ข้อมูลระดับทีม)
-- ---------------------------------------------------------------------------
alter table public.food_orders
  drop column if exists total,                -- generated จากคอลัมน์มื้อ ต้องลบก่อน
  drop column if exists morning_canteen,      drop column if exists morning_sticky,
  drop column if exists morning_rice,         drop column if exists morning_point,
  drop column if exists lunch_canteen,        drop column if exists lunch_sticky,
  drop column if exists lunch_rice,           drop column if exists lunch_point,
  drop column if exists dinner_canteen,       drop column if exists dinner_sticky,
  drop column if exists dinner_rice,          drop column if exists dinner_point,
  drop column if exists late_night_canteen,   drop column if exists late_night_sticky,
  drop column if exists late_night_rice,      drop column if exists late_night_point,
  drop column if exists irregular_canteen,    drop column if exists irregular_sticky,
  drop column if exists irregular_rice,       drop column if exists irregular_point,
  drop column if exists delivery_point,
  drop column if exists delivery_time;

comment on table public.food_orders is 'หัวออเดอร์ — 1 แถวต่อ 1 ทีมงานต่อวัน จำนวนอาหารอยู่ใน food_order_items';

-- ---------------------------------------------------------------------------
-- 4) วิวแนวกว้าง — ให้แอปอ่านหน้าตาเดิมได้ ไม่ต้องแก้โค้ดอ่านข้อมูล
-- ---------------------------------------------------------------------------
create or replace view public.food_orders_wide as
select
  o.id, o.project, o.order_date, o.department, o.team,

  coalesce(mo.canteen, 0) as morning_canteen,
  coalesce(mo.sticky, 0)  as morning_sticky,
  coalesce(mo.rice, 0)    as morning_rice,
  coalesce(mo.point, '')  as morning_point,

  coalesce(lu.canteen, 0) as lunch_canteen,
  coalesce(lu.sticky, 0)  as lunch_sticky,
  coalesce(lu.rice, 0)    as lunch_rice,
  coalesce(lu.point, '')  as lunch_point,

  coalesce(di.canteen, 0) as dinner_canteen,
  coalesce(di.sticky, 0)  as dinner_sticky,
  coalesce(di.rice, 0)    as dinner_rice,
  coalesce(di.point, '')  as dinner_point,

  coalesce(ln.canteen, 0) as late_night_canteen,
  coalesce(ln.sticky, 0)  as late_night_sticky,
  coalesce(ln.rice, 0)    as late_night_rice,
  coalesce(ln.point, '')  as late_night_point,

  coalesce(ir.canteen, 0) as irregular_canteen,
  coalesce(ir.sticky, 0)  as irregular_sticky,
  coalesce(ir.rice, 0)    as irregular_rice,
  coalesce(ir.point, '')  as irregular_point,

  coalesce(mo.total, 0) + coalesce(lu.total, 0) + coalesce(di.total, 0)
    + coalesce(ln.total, 0) + coalesce(ir.total, 0) as total,

  o.note, o.status, o.submitted_at, o.submitted_by_lid, o.submitted_by_name,
  o.created_at, o.updated_at
from public.food_orders o
left join public.food_order_items mo on mo.order_id = o.id and mo.meal = 'morning'
left join public.food_order_items lu on lu.order_id = o.id and lu.meal = 'lunch'
left join public.food_order_items di on di.order_id = o.id and di.meal = 'dinner'
left join public.food_order_items ln on ln.order_id = o.id and ln.meal = 'lateNight'
left join public.food_order_items ir on ir.order_id = o.id and ir.meal = 'irregular';

grant select on public.food_orders_wide to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) save_food_orders : เขียนหัวออเดอร์ + รายการรายมื้อ
--
--    เก็บเฉพาะมื้อที่มีจำนวน > 0 เท่านั้น ส่วนที่เป็น 0 จะถูกลบออกจากฐานข้อมูล
--    (ทีมที่ไม่สั่งอะไรเลยและไม่มีหมายเหตุ จะไม่มีแถวค้างไว้)
-- ---------------------------------------------------------------------------
create or replace function public.save_food_orders(
  p_project text,
  p_order_date date,
  p_department text,
  p_submitted_by_lid text,
  p_submitted_by_name text,
  p_orders jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stamp   timestamptz := now();
  v_project text := btrim(p_project);
  v_dept    text := btrim(p_department);
  v_saved   integer := 0;
  v_removed integer := 0;
begin
  if v_project = '' or p_order_date is null or v_dept = '' then
    raise exception 'ต้องระบุ project, order_date และ department';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    raise exception 'p_orders ต้องเป็น JSON array';
  end if;

  -- แตกข้อมูลที่ส่งมาเป็นรายมื้อไว้ในตารางชั่วคราว
  create temp table _incoming (
    team text, note text, meal text,
    canteen integer, sticky integer, rice integer, point text,
    quantity integer
  ) on commit drop;

  insert into _incoming (team, note, meal, canteen, sticky, rice, point, quantity)
  select btrim(o->>'team'),
         coalesce(o->>'note', ''),
         m.meal,
         jint(o->m.meal->>'canteen'),
         jint(o->m.meal->>'sticky'),
         jint(o->m.meal->>'rice'),
         coalesce(o->m.meal->>'point', ''),
         jint(o->m.meal->>'canteen') + jint(o->m.meal->>'sticky') + jint(o->m.meal->>'rice')
    from jsonb_array_elements(p_orders) as o
    cross join unnest(array['morning', 'lunch', 'dinner', 'lateNight', 'irregular']) as m(meal)
   where coalesce(btrim(o->>'team'), '') <> '';

  -- หัวออเดอร์: เฉพาะทีมที่มีของสั่งจริง หรือมีหมายเหตุ
  insert into public.food_orders as f (
    project, order_date, department, team,
    note, status, submitted_at, submitted_by_lid, submitted_by_name, updated_at
  )
  select v_project, p_order_date, v_dept, i.team,
         max(i.note), 'sent', v_stamp,
         nullif(btrim(coalesce(p_submitted_by_lid, '')), ''),
         nullif(btrim(coalesce(p_submitted_by_name, '')), ''),
         v_stamp
    from _incoming i
   group by i.team
  having sum(i.quantity) > 0 or btrim(max(i.note)) <> ''
  on conflict (project, order_date, department, team) do update set
    note              = excluded.note,
    status            = excluded.status,
    submitted_at      = excluded.submitted_at,
    submitted_by_lid  = excluded.submitted_by_lid,
    submitted_by_name = excluded.submitted_by_name,
    updated_at        = excluded.updated_at;

  get diagnostics v_saved = row_count;

  -- รายการรายมื้อ: เฉพาะมื้อที่ > 0
  insert into public.food_order_items as t (order_id, meal, canteen, sticky, rice, point, updated_at)
  select f.id, i.meal, i.canteen, i.sticky, i.rice, i.point, v_stamp
    from _incoming i
    join public.food_orders f
      on f.project = v_project and f.order_date = p_order_date
     and f.department = v_dept and f.team = i.team
   where i.quantity > 0
  on conflict (order_id, meal) do update set
    canteen    = excluded.canteen,
    sticky     = excluded.sticky,
    rice       = excluded.rice,
    point      = excluded.point,
    updated_at = excluded.updated_at;

  -- ลบมื้อที่ถูกแก้ให้เป็น 0
  delete from public.food_order_items t
   using public.food_orders f, _incoming i
   where t.order_id = f.id
     and f.project = v_project and f.order_date = p_order_date
     and f.department = v_dept and f.team = i.team
     and t.meal = i.meal
     and i.quantity = 0;

  -- ลบหัวออเดอร์ของทีมที่ไม่เหลืออะไรและไม่มีหมายเหตุ
  delete from public.food_orders f
   where f.project = v_project and f.order_date = p_order_date and f.department = v_dept
     and f.team in (select distinct team from _incoming)
     and btrim(coalesce(f.note, '')) = ''
     and not exists (select 1 from public.food_order_items t where t.order_id = f.id);

  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'saved', v_saved,
    'removed', v_removed,
    'submitted_at', v_stamp,
    'project', v_project,
    'order_date', p_order_date,
    'department', v_dept
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) upsert_food_order : บันทึกทีละทีม (เก็บ draft ได้)
-- ---------------------------------------------------------------------------
drop function if exists public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text);
drop function if exists public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text, text);
drop function if exists public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text, text, text);

create or replace function public.upsert_food_order(
  p_project text,
  p_order_date date,
  p_department text,
  p_team text,
  p_meals jsonb,
  p_note text default '',
  p_status text default 'draft',
  p_submitted_by_lid text default null,
  p_submitted_by_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_status text := lower(coalesce(nullif(btrim(p_status), ''), 'draft'));
  v_stamp  timestamptz := now();
  v_id     uuid;
begin
  if coalesce(btrim(p_project), '') = '' or p_order_date is null
     or coalesce(btrim(p_department), '') = '' or coalesce(btrim(p_team), '') = '' then
    raise exception 'ต้องระบุ project, order_date, department และ team';
  end if;
  if v_status not in ('draft', 'confirmed', 'sent') then
    raise exception 'status ต้องเป็น draft, confirmed หรือ sent (ได้รับ %)', p_status;
  end if;

  insert into public.food_orders as f (
    project, order_date, department, team,
    note, status, submitted_at, submitted_by_lid, submitted_by_name, updated_at
  )
  values (
    btrim(p_project), p_order_date, btrim(p_department), btrim(p_team),
    coalesce(p_note, ''), v_status,
    case when v_status = 'sent' then v_stamp else null end,
    nullif(btrim(coalesce(p_submitted_by_lid, '')), ''),
    nullif(btrim(coalesce(p_submitted_by_name, '')), ''),
    v_stamp
  )
  on conflict (project, order_date, department, team) do update set
    note              = excluded.note,
    status            = excluded.status,
    submitted_at      = coalesce(excluded.submitted_at, f.submitted_at),
    submitted_by_lid  = coalesce(excluded.submitted_by_lid, f.submitted_by_lid),
    submitted_by_name = coalesce(excluded.submitted_by_name, f.submitted_by_name),
    updated_at        = excluded.updated_at
  returning f.id into v_id;

  -- เก็บเฉพาะมื้อที่มีจำนวน > 0
  insert into public.food_order_items as t (order_id, meal, canteen, sticky, rice, point, updated_at)
  select v_id, m.meal,
         jint(p_meals->m.meal->>'canteen'),
         jint(p_meals->m.meal->>'sticky'),
         jint(p_meals->m.meal->>'rice'),
         coalesce(p_meals->m.meal->>'point', ''),
         v_stamp
    from unnest(array['morning', 'lunch', 'dinner', 'lateNight', 'irregular']) as m(meal)
   where jint(p_meals->m.meal->>'canteen')
       + jint(p_meals->m.meal->>'sticky')
       + jint(p_meals->m.meal->>'rice') > 0
  on conflict (order_id, meal) do update set
    canteen    = excluded.canteen,
    sticky     = excluded.sticky,
    rice       = excluded.rice,
    point      = excluded.point,
    updated_at = excluded.updated_at;

  -- มื้อที่ถูกแก้ให้เป็น 0 ให้ลบออก ไม่เก็บแถวเปล่าไว้
  delete from public.food_order_items t
   where t.order_id = v_id
     and jint(p_meals->t.meal->>'canteen')
       + jint(p_meals->t.meal->>'sticky')
       + jint(p_meals->t.meal->>'rice') = 0;

  -- ถ้าไม่เหลืออะไรเลยและไม่มีหมายเหตุ ก็ไม่ต้องเก็บหัวออเดอร์
  delete from public.food_orders f
   where f.id = v_id
     and btrim(coalesce(f.note, '')) = ''
     and not exists (select 1 from public.food_order_items t where t.order_id = f.id);

  return coalesce(
    (select to_jsonb(w) from public.food_orders_wide w where w.id = v_id),
    jsonb_build_object('deleted', true, 'team', btrim(p_team))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) สิทธิ์ + Realtime
-- ---------------------------------------------------------------------------
revoke all on function public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text) from public;
grant execute on function public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.food_order_items;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 8) ล้างข้อมูลเป็น 0 ที่บันทึกไว้ก่อนหน้านี้
-- ---------------------------------------------------------------------------
delete from public.food_order_items where canteen + sticky + rice = 0;

delete from public.food_orders f
 where btrim(coalesce(f.note, '')) = ''
   and not exists (select 1 from public.food_order_items t where t.order_id = f.id);

-- ---------------------------------------------------------------------------
-- 9) ตรวจผล
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.food_orders)      as หัวออเดอร์,
  (select count(*) from public.food_order_items) as รายการรายมื้อ,
  (select count(*) from public.food_orders_wide) as แถวในวิว,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'food_orders') as คอลัมน์ที่เหลือ;
