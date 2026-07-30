-- ============================================================================
-- เพิ่มจุดส่งอาหารรายทีมงาน (delivery_point)
--
-- โรงครัวต้องรู้ว่าอาหารของแต่ละทีมส่งไปที่ไหน ไม่ใช่แค่จำนวน
-- ค่าที่ใช้ตอนนี้: ทานที่โรงอาหาร / KeepRoom ตู้เหลือง / KeepRoom ตู้ขาว /
--                หน้างาน / แคมป์ที่พัก   (แก้ลิสต์ได้ที่ deliveryPoints ใน src/App.jsx)
--
-- รันหลัง 01–05 (รันซ้ำได้)
-- ============================================================================

alter table public.food_orders
  add column if not exists delivery_point text not null default '';

comment on column public.food_orders.delivery_point is 'จุดส่งอาหารของทีมงานนั้น ค่าว่าง = ยังไม่ระบุ';

create index if not exists food_orders_delivery_point_idx on public.food_orders (delivery_point);

-- ---------------------------------------------------------------------------
-- save_food_orders : อ่าน deliveryPoint จาก JSON ของแต่ละทีมเพิ่ม
-- (signature เดิม ไม่ต้อง drop)
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
  v_stamp timestamptz := now();
  v_saved integer := 0;
begin
  if coalesce(btrim(p_project), '') = '' or p_order_date is null or coalesce(btrim(p_department), '') = '' then
    raise exception 'ต้องระบุ project, order_date และ department';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    raise exception 'p_orders ต้องเป็น JSON array';
  end if;

  insert into public.food_orders as f (
    project, order_date, department, team,
    morning_canteen, morning_sticky, morning_rice,
    lunch_canteen, lunch_sticky, lunch_rice,
    dinner_canteen, dinner_sticky, dinner_rice,
    late_night_canteen, late_night_sticky, late_night_rice,
    irregular_canteen, irregular_sticky, irregular_rice,
    note, delivery_point, status, submitted_at, submitted_by_lid, submitted_by_name, updated_at
  )
  select
    btrim(p_project), p_order_date, btrim(p_department), btrim(o->>'team'),
    jint(o->'morning'->>'canteen'),    jint(o->'morning'->>'sticky'),    jint(o->'morning'->>'rice'),
    jint(o->'lunch'->>'canteen'),      jint(o->'lunch'->>'sticky'),      jint(o->'lunch'->>'rice'),
    jint(o->'dinner'->>'canteen'),     jint(o->'dinner'->>'sticky'),     jint(o->'dinner'->>'rice'),
    jint(o->'lateNight'->>'canteen'),  jint(o->'lateNight'->>'sticky'),  jint(o->'lateNight'->>'rice'),
    jint(o->'irregular'->>'canteen'),  jint(o->'irregular'->>'sticky'),  jint(o->'irregular'->>'rice'),
    coalesce(o->>'note', ''), coalesce(o->>'deliveryPoint', ''), 'sent', v_stamp,
    nullif(btrim(coalesce(p_submitted_by_lid, '')), ''),
    nullif(btrim(coalesce(p_submitted_by_name, '')), ''),
    v_stamp
  from jsonb_array_elements(p_orders) as o
  where coalesce(btrim(o->>'team'), '') <> ''
  on conflict (project, order_date, department, team) do update set
    morning_canteen    = excluded.morning_canteen,
    morning_sticky     = excluded.morning_sticky,
    morning_rice       = excluded.morning_rice,
    lunch_canteen      = excluded.lunch_canteen,
    lunch_sticky       = excluded.lunch_sticky,
    lunch_rice         = excluded.lunch_rice,
    dinner_canteen     = excluded.dinner_canteen,
    dinner_sticky      = excluded.dinner_sticky,
    dinner_rice        = excluded.dinner_rice,
    late_night_canteen = excluded.late_night_canteen,
    late_night_sticky  = excluded.late_night_sticky,
    late_night_rice    = excluded.late_night_rice,
    irregular_canteen  = excluded.irregular_canteen,
    irregular_sticky   = excluded.irregular_sticky,
    irregular_rice     = excluded.irregular_rice,
    note               = excluded.note,
    delivery_point     = excluded.delivery_point,
    status             = excluded.status,
    submitted_at       = excluded.submitted_at,
    submitted_by_lid   = excluded.submitted_by_lid,
    submitted_by_name  = excluded.submitted_by_name,
    updated_at         = excluded.updated_at;

  get diagnostics v_saved = row_count;

  return jsonb_build_object(
    'saved', v_saved,
    'submitted_at', v_stamp,
    'project', btrim(p_project),
    'order_date', p_order_date,
    'department', btrim(p_department)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- upsert_food_order : เพิ่มพารามิเตอร์ p_delivery_point
-- (signature เปลี่ยน จึงต้อง drop ตัวเก่าก่อน ไม่งั้นจะซ้อนกัน 2 ตัว)
-- ---------------------------------------------------------------------------
drop function if exists public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text);

create or replace function public.upsert_food_order(
  p_project text,
  p_order_date date,
  p_department text,
  p_team text,
  p_meals jsonb,
  p_note text default '',
  p_delivery_point text default '',
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
  v_row    public.food_orders;
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
    morning_canteen, morning_sticky, morning_rice,
    lunch_canteen, lunch_sticky, lunch_rice,
    dinner_canteen, dinner_sticky, dinner_rice,
    late_night_canteen, late_night_sticky, late_night_rice,
    irregular_canteen, irregular_sticky, irregular_rice,
    note, delivery_point, status, submitted_at, submitted_by_lid, submitted_by_name, updated_at
  )
  values (
    btrim(p_project), p_order_date, btrim(p_department), btrim(p_team),
    jint(p_meals->'morning'->>'canteen'),   jint(p_meals->'morning'->>'sticky'),   jint(p_meals->'morning'->>'rice'),
    jint(p_meals->'lunch'->>'canteen'),     jint(p_meals->'lunch'->>'sticky'),     jint(p_meals->'lunch'->>'rice'),
    jint(p_meals->'dinner'->>'canteen'),    jint(p_meals->'dinner'->>'sticky'),    jint(p_meals->'dinner'->>'rice'),
    jint(p_meals->'lateNight'->>'canteen'), jint(p_meals->'lateNight'->>'sticky'), jint(p_meals->'lateNight'->>'rice'),
    jint(p_meals->'irregular'->>'canteen'), jint(p_meals->'irregular'->>'sticky'), jint(p_meals->'irregular'->>'rice'),
    coalesce(p_note, ''), coalesce(p_delivery_point, ''), v_status,
    case when v_status = 'sent' then v_stamp else null end,
    nullif(btrim(coalesce(p_submitted_by_lid, '')), ''),
    nullif(btrim(coalesce(p_submitted_by_name, '')), ''),
    v_stamp
  )
  on conflict (project, order_date, department, team) do update set
    morning_canteen    = excluded.morning_canteen,
    morning_sticky     = excluded.morning_sticky,
    morning_rice       = excluded.morning_rice,
    lunch_canteen      = excluded.lunch_canteen,
    lunch_sticky       = excluded.lunch_sticky,
    lunch_rice         = excluded.lunch_rice,
    dinner_canteen     = excluded.dinner_canteen,
    dinner_sticky      = excluded.dinner_sticky,
    dinner_rice        = excluded.dinner_rice,
    late_night_canteen = excluded.late_night_canteen,
    late_night_sticky  = excluded.late_night_sticky,
    late_night_rice    = excluded.late_night_rice,
    irregular_canteen  = excluded.irregular_canteen,
    irregular_sticky   = excluded.irregular_sticky,
    irregular_rice     = excluded.irregular_rice,
    note               = excluded.note,
    delivery_point     = excluded.delivery_point,
    status             = excluded.status,
    submitted_at       = coalesce(excluded.submitted_at, f.submitted_at),
    submitted_by_lid   = coalesce(excluded.submitted_by_lid, f.submitted_by_lid),
    submitted_by_name  = coalesce(excluded.submitted_by_name, f.submitted_by_name),
    updated_at         = excluded.updated_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- สิทธิ์ (ต้องให้ใหม่เพราะ drop ไปแล้ว)
-- ---------------------------------------------------------------------------
revoke all on function public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text, text) from public;
grant execute on function public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------------
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'food_orders' and column_name = 'delivery_point';
