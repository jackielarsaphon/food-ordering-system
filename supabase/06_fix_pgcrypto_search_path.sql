-- ============================================================================
-- แก้ error: function crypt(text, text) does not exist / gen_salt(unknown)
--            (Postgres error 42883 -> PostgREST ตอบ HTTP 404)
--
-- สาเหตุ: ฟังก์ชันที่เข้ารหัส PIN เรียก crypt() / gen_salt() ของ extension
-- pgcrypto แต่ pgcrypto ไม่ได้อยู่ในสคีมาที่ search_path ของฟังก์ชันมองเห็น
--
-- ไฟล์นี้ตรวจเองว่า pgcrypto ติดตั้งอยู่สคีมาไหน (หรือยังไม่ติดตั้งเลย)
-- แล้วตั้ง search_path ให้ทั้ง 4 ฟังก์ชันตรงกับความจริง — รันซ้ำได้
-- ============================================================================

do $$
declare
  v_schema text;
  v_function text;
  v_functions text[] := array[
    'public.register_user(text, text, text)',
    'public.login_user(text, text)',
    'public.change_user_pin(text, text, text)',
    'public.reset_user_pin(text, text, text)'
  ];
begin
  -- 1) pgcrypto อยู่ที่ไหน
  select n.nspname
    into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  -- 2) ยังไม่ติดตั้ง -> ติดตั้งลงสคีมา extensions
  if v_schema is null then
    execute 'create schema if not exists extensions';
    execute 'create extension pgcrypto with schema extensions';
    v_schema := 'extensions';
    raise notice 'ติดตั้ง pgcrypto ใหม่ในสคีมา extensions';
  else
    raise notice 'พบ pgcrypto อยู่ในสคีมา %', v_schema;
  end if;

  -- 3) ตั้ง search_path ของทุกฟังก์ชันให้เห็นสคีมานั้น
  foreach v_function in array v_functions loop
    execute format('alter function %s set search_path = public, %I', v_function, v_schema);
    raise notice 'แก้ search_path ของ % แล้ว', v_function;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ตรวจผล: ทั้ง 4 แถวต้องมี search_path ที่ลงท้ายด้วยสคีมาของ pgcrypto
-- ---------------------------------------------------------------------------
select
  p.proname as ฟังก์ชัน,
  array_to_string(p.proconfig, ', ') as ตั้งค่าไว้,
  (select n.nspname
     from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto') as pgcrypto_อยู่ที่
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('register_user', 'login_user', 'change_user_pin', 'reset_user_pin')
order by p.proname;
