-- ============================================================================
-- เติม function ที่ขาดให้ครบ CRUD ของ food_orders
--
--   save_food_orders   (มีแล้วใน 03) = ส่งทั้งแผนกให้โรงครัว
--   upsert_food_order  (ไฟล์นี้)     = บันทึก/แก้ไขทีละทีม เก็บเป็น draft ได้
--   delete_food_order  (ไฟล์นี้)     = ลบ ต้องใส่ PIN แอดมิน
--
-- รันหลัง 01–04 (รันซ้ำได้)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- บันทึก/แก้ไขออเดอร์ทีมเดียว
--
-- p_meals = { "morning": {"canteen":0,"sticky":0,"rice":0}, "lunch": {...},
--             "dinner": {...}, "lateNight": {...}, "irregular": {...} }
-- ---------------------------------------------------------------------------
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
set search_path = public
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
    note, status, submitted_at, submitted_by_lid, submitted_by_name, updated_at
  )
  values (
    btrim(p_project), p_order_date, btrim(p_department), btrim(p_team),
    jint(p_meals->'morning'->>'canteen'),   jint(p_meals->'morning'->>'sticky'),   jint(p_meals->'morning'->>'rice'),
    jint(p_meals->'lunch'->>'canteen'),     jint(p_meals->'lunch'->>'sticky'),     jint(p_meals->'lunch'->>'rice'),
    jint(p_meals->'dinner'->>'canteen'),    jint(p_meals->'dinner'->>'sticky'),    jint(p_meals->'dinner'->>'rice'),
    jint(p_meals->'lateNight'->>'canteen'), jint(p_meals->'lateNight'->>'sticky'), jint(p_meals->'lateNight'->>'rice'),
    jint(p_meals->'irregular'->>'canteen'), jint(p_meals->'irregular'->>'sticky'), jint(p_meals->'irregular'->>'rice'),
    coalesce(p_note, ''), v_status,
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
    status             = excluded.status,
    -- เก็บเวลาส่งครั้งแรกไว้ ถ้ายังไม่เคยส่งค่อยใช้ค่าใหม่
    submitted_at       = coalesce(excluded.submitted_at, f.submitted_at),
    submitted_by_lid   = coalesce(excluded.submitted_by_lid, f.submitted_by_lid),
    submitted_by_name  = coalesce(excluded.submitted_by_name, f.submitted_by_name),
    updated_at         = excluded.updated_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- ลบออเดอร์ — ระบุ p_team = ลบทีมเดียว, ไม่ระบุ = ลบทั้งแผนกของวันนั้น
-- ---------------------------------------------------------------------------
create or replace function public.delete_food_order(
  p_project text,
  p_order_date date,
  p_department text,
  p_admin_pin text,
  p_team text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_pin text;
  v_deleted   integer;
begin
  select value into v_admin_pin from public.app_config where key = 'admin_pin';
  if v_admin_pin is null or coalesce(p_admin_pin, '') <> v_admin_pin then
    raise exception 'รหัสแอดมินไม่ถูกต้อง';
  end if;
  if coalesce(btrim(p_project), '') = '' or p_order_date is null or coalesce(btrim(p_department), '') = '' then
    raise exception 'ต้องระบุ project, order_date และ department';
  end if;

  delete from public.food_orders
   where project = btrim(p_project)
     and order_date = p_order_date
     and department = btrim(p_department)
     and (p_team is null or team = btrim(p_team));

  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- สิทธิ์
-- ---------------------------------------------------------------------------
revoke all on function public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text) from public;
revoke all on function public.delete_food_order(text, date, text, text, text)                          from public;

grant execute on function public.upsert_food_order(text, date, text, text, jsonb, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_food_order(text, date, text, text, text)                          to anon, authenticated;
