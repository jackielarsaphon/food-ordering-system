-- ============================================================================
-- Function ที่แอปเรียกใช้ (แทน Google Apps Script Web App)
--
-- ทุกตัวเป็น security definer = ทำงานด้วยสิทธิ์เจ้าของตาราง จึงเขียนข้อมูลได้
-- แม้ฝั่งเบราว์เซอร์จะถูก RLS บล็อกการเขียนตรงไว้ทั้งหมด
--
-- รันหลัง 01_employees_schema.sql และ 02_app_tables.sql
--
-- หมายเหตุสำคัญ: Supabase ติดตั้ง pgcrypto ไว้ในสคีมา extensions ไม่ใช่ public
-- ทุก function ที่เรียก crypt() / gen_salt() จึงต้องมี extensions อยู่ใน search_path
-- ไม่งั้นจะ error ว่า "function crypt(text, text) does not exist"
-- ============================================================================

create extension if not exists pgcrypto;

-- แปลงค่าจาก JSON เป็นจำนวนเต็ม ค่าว่าง/null -> 0
create or replace function public.jint(v text)
returns integer
language sql
immutable
as $$
  select coalesce(nullif(btrim(coalesce(v, '')), '')::numeric::integer, 0);
$$;

-- ---------------------------------------------------------------------------
-- สมัครผู้ใช้ใหม่ — ต้องมี LID อยู่ใน employees (ชีต dataforscan1) ก่อน
-- ---------------------------------------------------------------------------
create or replace function public.register_user(
  p_lid text,
  p_pin text,
  p_role text default 'user'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lid  text := btrim(coalesce(p_lid, ''));
  v_emp  public.employees;
  v_user public.app_users;
begin
  if v_lid = '' then
    raise exception 'กรุณากรอก LID';
  end if;
  if length(btrim(coalesce(p_pin, ''))) < 4 then
    raise exception 'รหัสเข้าใช้งานต้องมีอย่างน้อย 4 หลัก';
  end if;

  select * into v_emp from public.employees where lid = v_lid;
  if not found then
    raise exception 'ไม่พบ LID % ใน DataForScan', v_lid;
  end if;

  if exists (select 1 from public.app_users where lid = v_lid) then
    raise exception 'LID % สมัครไว้แล้ว ถ้าลืมรหัสให้แอดมินลบบัญชีก่อน', v_lid;
  end if;

  insert into public.app_users (
    lid, pin_hash, role, title, first_name, last_name,
    "position", department, location, company, project
  )
  values (
    v_emp.lid, crypt(p_pin, gen_salt('bf')), coalesce(nullif(btrim(p_role), ''), 'user'),
    v_emp.title, v_emp.first_name, v_emp.last_name,
    v_emp."position", v_emp.department, v_emp.location, v_emp.company, v_emp.project
  )
  returning * into v_user;

  return to_jsonb(v_user) - 'pin_hash';
end;
$$;

-- ---------------------------------------------------------------------------
-- เข้าสู่ระบบ — เทียบ PIN กับ hash ในฐานข้อมูล
-- ---------------------------------------------------------------------------
create or replace function public.login_user(p_lid text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users;
begin
  select * into v_user from public.app_users where lid = btrim(coalesce(p_lid, ''));

  if not found or v_user.pin_hash <> crypt(coalesce(p_pin, ''), v_user.pin_hash) then
    raise exception 'LID หรือรหัสเข้าใช้งานไม่ถูกต้อง';
  end if;

  update public.app_users set last_login_at = now() where lid = v_user.lid;

  return to_jsonb(v_user) - 'pin_hash';
end;
$$;

-- ---------------------------------------------------------------------------
-- เปลี่ยนรหัสตัวเอง (ต้องรู้รหัสเดิม)
-- ---------------------------------------------------------------------------
create or replace function public.change_user_pin(p_lid text, p_old_pin text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users;
begin
  if length(btrim(coalesce(p_new_pin, ''))) < 4 then
    raise exception 'รหัสใหม่ต้องมีอย่างน้อย 4 หลัก';
  end if;

  select * into v_user from public.app_users where lid = btrim(coalesce(p_lid, ''));
  if not found or v_user.pin_hash <> crypt(coalesce(p_old_pin, ''), v_user.pin_hash) then
    raise exception 'รหัสเดิมไม่ถูกต้อง';
  end if;

  update public.app_users
     set pin_hash = crypt(p_new_pin, gen_salt('bf')), updated_at = now()
   where lid = v_user.lid;

  return jsonb_build_object('lid', v_user.lid, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- ลบผู้ใช้ (ต้องใส่ PIN แอดมินที่เก็บใน app_config)
-- ---------------------------------------------------------------------------
create or replace function public.delete_user(p_lid text, p_admin_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin_pin text;
  v_deleted   integer;
begin
  select value into v_admin_pin from public.app_config where key = 'admin_pin';
  if v_admin_pin is null or coalesce(p_admin_pin, '') <> v_admin_pin then
    raise exception 'รหัสแอดมินไม่ถูกต้อง';
  end if;

  delete from public.app_users where lid = btrim(coalesce(p_lid, ''));
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'ไม่พบบัญชี LID %', p_lid;
  end if;

  return jsonb_build_object('lid', btrim(p_lid), 'deleted', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- รีเซ็ตรหัสผู้ใช้โดยแอดมิน
-- ---------------------------------------------------------------------------
create or replace function public.reset_user_pin(p_lid text, p_new_pin text, p_admin_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin_pin text;
begin
  select value into v_admin_pin from public.app_config where key = 'admin_pin';
  if v_admin_pin is null or coalesce(p_admin_pin, '') <> v_admin_pin then
    raise exception 'รหัสแอดมินไม่ถูกต้อง';
  end if;
  if length(btrim(coalesce(p_new_pin, ''))) < 4 then
    raise exception 'รหัสใหม่ต้องมีอย่างน้อย 4 หลัก';
  end if;

  update public.app_users
     set pin_hash = crypt(p_new_pin, gen_salt('bf')), updated_at = now()
   where lid = btrim(coalesce(p_lid, ''));

  if not found then
    raise exception 'ไม่พบบัญชี LID %', p_lid;
  end if;

  return jsonb_build_object('lid', btrim(p_lid), 'reset', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- บันทึกใบสั่งอาหารทั้งแผนกในครั้งเดียว (แทน saveFoodOrders)
--
-- p_orders รูปแบบเดียวกับที่แอปส่งอยู่แล้ว:
-- [{ "team": "...", "morning": {"canteen":0,"sticky":0,"rice":0}, "lunch": {...},
--    "dinner": {...}, "lateNight": {...}, "irregular": {...}, "note": "" }, ...]
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
    note, status, submitted_at, submitted_by_lid, submitted_by_name, updated_at
  )
  select
    btrim(p_project), p_order_date, btrim(p_department), btrim(o->>'team'),
    jint(o->'morning'->>'canteen'),    jint(o->'morning'->>'sticky'),    jint(o->'morning'->>'rice'),
    jint(o->'lunch'->>'canteen'),      jint(o->'lunch'->>'sticky'),      jint(o->'lunch'->>'rice'),
    jint(o->'dinner'->>'canteen'),     jint(o->'dinner'->>'sticky'),     jint(o->'dinner'->>'rice'),
    jint(o->'lateNight'->>'canteen'),  jint(o->'lateNight'->>'sticky'),  jint(o->'lateNight'->>'rice'),
    jint(o->'irregular'->>'canteen'),  jint(o->'irregular'->>'sticky'),  jint(o->'irregular'->>'rice'),
    coalesce(o->>'note', ''), 'sent', v_stamp,
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
-- สิทธิ์: เรียกได้จาก publishable/anon key เท่านั้นเท่าที่จำเป็น
-- ---------------------------------------------------------------------------
revoke all on function public.register_user(text, text, text)        from public;
revoke all on function public.login_user(text, text)                 from public;
revoke all on function public.change_user_pin(text, text, text)      from public;
revoke all on function public.delete_user(text, text)                from public;
revoke all on function public.reset_user_pin(text, text, text)       from public;
revoke all on function public.save_food_orders(text, date, text, text, text, jsonb) from public;

grant execute on function public.register_user(text, text, text)        to anon, authenticated;
grant execute on function public.login_user(text, text)                 to anon, authenticated;
grant execute on function public.change_user_pin(text, text, text)      to anon, authenticated;
grant execute on function public.delete_user(text, text)                to anon, authenticated;
grant execute on function public.reset_user_pin(text, text, text)       to anon, authenticated;
grant execute on function public.save_food_orders(text, date, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.jint(text)                             to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ตรวจผล: ต้องได้ 7 แถว (jint, register_user, login_user, change_user_pin,
--          delete_user, reset_user_pin, save_food_orders)
-- ---------------------------------------------------------------------------
select routine_name
  from information_schema.routines
 where routine_schema = 'public'
   and routine_type = 'FUNCTION'
 order by routine_name;
