-- ============================================================================
-- สมัครผู้ใช้ด้วย LID + รหัสผ่าน — ไม่ต้องค้นหาพนักงานจาก DataForScan ก่อน
--
-- ของเดิม (03_functions.sql) บังคับว่า LID ต้องมีในตาราง employees ก่อนถึงจะ
-- สมัครได้ ไม่มีก็ raise exception ทิ้ง
-- ของใหม่: หน้าสมัครถามแค่ ผู้ใช้ (LID) / รหัสผ่าน / ยืนยันรหัสผ่าน
--   * ถ้า LID มีใน employees -> เติมชื่อ แผนก location บริษัท ให้อัตโนมัติ
--   * ถ้าไม่มี -> สมัครได้ตามปกติ ช่องโปรไฟล์ปล่อยว่างไว้
--   * ช่องโปรไฟล์ทุกตัวยังส่งเข้ามาทับได้ (เผื่อทำหน้าแก้ไขข้อมูลผู้ใช้ทีหลัง)
--   * location/project เดาจาก p_project ที่หน้าจอส่งมาถ้าไม่มีข้อมูลอื่น
--
-- รันใน Supabase Dashboard > SQL Editor และต้องรัน "หลัง" 06_fix_pgcrypto_search_path.sql
-- (ไฟล์ 06 อ้างถึง register_user แบบ 3 พารามิเตอร์ซึ่งไฟล์นี้ลบทิ้งไปแล้ว
--  ถ้าจำเป็นต้องรัน 06 ซ้ำภายหลัง ให้ข้ามบรรทัด register_user ในไฟล์นั้น —
--  ฟังก์ชันใหม่ตั้ง search_path = public, extensions ไว้ให้ในตัวอยู่แล้ว)
--
-- รันซ้ำได้ ไม่พัง
-- ============================================================================

-- เลิกใช้ตัวเดิม 3 พารามิเตอร์ ไม่งั้นจะซ้อนกันจน PostgREST เลือกไม่ถูก
drop function if exists public.register_user(text, text, text);

create or replace function public.register_user(
  p_lid        text,
  p_pin        text,
  p_role       text default 'user',
  p_title      text default '',
  p_first_name text default '',
  p_last_name  text default '',
  p_position   text default '',
  p_department text default '',
  p_location   text default '',
  p_company    text default '',
  p_project    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lid        text := btrim(coalesce(p_lid, ''));
  v_emp        public.employees;   -- ถ้าไม่พบจะเป็น null ทุกคอลัมน์ (ใช้เติมช่องว่างเฉยๆ)
  v_user       public.app_users;
  v_title      text;
  v_first_name text;
  v_last_name  text;
  v_position   text;
  v_department text;
  v_location   text;
  v_company    text;
  v_project    text;
begin
  if v_lid = '' then
    raise exception 'กรุณากรอก LID';
  end if;
  if length(btrim(coalesce(p_pin, ''))) < 4 then
    raise exception 'รหัสเข้าใช้งานต้องมีอย่างน้อย 4 หลัก';
  end if;
  if exists (select 1 from public.app_users where lid = v_lid) then
    raise exception 'LID % สมัครไว้แล้ว ถ้าลืมรหัสให้แอดมินลบบัญชีก่อน', v_lid;
  end if;

  -- มีในชีตก็ดี ไม่มีก็สมัครได้ — ใช้แค่เติมช่องที่ผู้ใช้เว้นว่าง
  select * into v_emp from public.employees where lid = v_lid;

  v_title      := coalesce(nullif(btrim(coalesce(p_title, '')), ''),      v_emp.title);
  v_first_name := coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), v_emp.first_name);
  v_last_name  := coalesce(nullif(btrim(coalesce(p_last_name, '')), ''),  v_emp.last_name);
  v_position   := coalesce(nullif(btrim(coalesce(p_position, '')), ''),   v_emp."position");
  v_department := coalesce(nullif(btrim(coalesce(p_department, '')), ''), v_emp.department);
  v_company    := coalesce(nullif(btrim(coalesce(p_company, '')), ''),    v_emp.company);

  -- location เป็นตัวที่หน้า User ใช้กรองว่าบัญชีอยู่โครงการไหน
  -- ไม่ได้ส่งมาและไม่มีในชีต -> เดาจาก p_project ที่หน้าจอบอกมา
  v_location := coalesce(
    nullif(btrim(coalesce(p_location, '')), ''),
    v_emp.location,
    case btrim(lower(coalesce(p_project, '')))
      when 'sekong' then 'เซกอง'
      when 'xepon'  then 'เชโปน'
    end
  );

  -- project ต้องตรงกับ location เสมอ ไม่งั้นหน้า User กับฐานข้อมูลจะไม่ตรงกัน
  v_project := case
    when btrim(coalesce(v_location, '')) = ''
      then coalesce(nullif(btrim(coalesce(p_project, '')), ''), v_emp.project, 'xepon')
    when lower(v_location) similar to '%(เซกอง|sekong|xekong)%' then 'sekong'
    else 'xepon'
  end;

  insert into public.app_users (
    lid, pin_hash, role, title, first_name, last_name,
    "position", department, location, company, project
  )
  values (
    v_lid, crypt(p_pin, gen_salt('bf')), coalesce(nullif(btrim(p_role), ''), 'user'),
    v_title, v_first_name, v_last_name,
    v_position, v_department, v_location, v_company, v_project
  )
  returning * into v_user;

  return to_jsonb(v_user) - 'pin_hash';
end;
$$;

-- สิทธิ์เรียกใช้ — เหมือนเดิมทุกอย่าง แค่เปลี่ยนตามลายเซ็นใหม่
revoke all on function public.register_user(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.register_user(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ตรวจผล: ต้องได้ register_user แถวเดียว และมี 11 พารามิเตอร์
-- ---------------------------------------------------------------------------
select p.proname as ฟังก์ชัน,
       pg_get_function_identity_arguments(p.oid) as พารามิเตอร์,
       array_to_string(p.proconfig, ', ') as ตั้งค่าไว้
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = 'register_user';
