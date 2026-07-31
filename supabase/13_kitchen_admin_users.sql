-- ============================================================================
-- บัญชี Admin โรงครัวประจำโครงการ (ล็อกอินด้วย LID ที่แท็บ "ผู้ใช้งาน LID")
--
--   8000001  Admin โรงครัว (เซโปน)  location เชโปน  project xepon
--   8000002  Admin โรงครัว (เซกอง)  location เซกอง  project sekong
--
-- ต่างจากของเดิม 2 ทางที่มีอยู่แล้ว:
--   * บัญชีแผนก kitchen-admin (PIN อยู่ใน App.jsx) ไม่ผูกกับ LID จึงไม่รู้ว่าใครกด
--   * บัญชีทดลอง LID 9000000 เก็บใน localStorage ของเครื่องเดียว ย้ายเครื่องแล้วหาย
-- บัญชีในไฟล์นี้อยู่ในฐานข้อมูล เข้าได้จากทุกเครื่อง และติดชื่อผู้บันทึกในออเดอร์
--
-- PIN เก็บเป็น bcrypt hash เหมือนบัญชีที่สมัครผ่านหน้าเว็บ อ่านย้อนกลับไม่ได้
-- เปลี่ยน PIN ภายหลังได้ด้วย reset_user_pin(lid, รหัสใหม่, admin_pin)
--
-- รันหลัง 12_app_users_free_lid.sql (จำเป็น — LID ชุดนี้ไม่มีในชีต dataforscan1
-- ถ้า foreign key เดิมยังอยู่จะ insert ไม่ผ่าน) รันซ้ำได้ ไม่ทับรหัสที่เปลี่ยนไปแล้ว
-- ============================================================================

insert into public.app_users (
  lid, pin_hash, role, title, first_name, last_name,
  "position", department, location, company, project
)
values
  ('8000001', crypt('9999', gen_salt('bf')), 'admin', '', 'Admin', 'โรงครัว (เซโปน)',
   'ผู้ดูแลระบบโรงครัว', 'Canteen', 'เชโปน', 'Thaidrill LAO', 'xepon'),
  ('8000002', crypt('9999', gen_salt('bf')), 'admin', '', 'Admin', 'โรงครัว (เซกอง)',
   'ผู้ดูแลระบบโรงครัว', 'Canteen', 'เซกอง', 'Thaidrill LAO', 'sekong')
on conflict (lid) do nothing;

-- ---------------------------------------------------------------------------
-- ตรวจผล: ต้องได้ 2 แถว role = admin (คอลัมน์ pin_hash ไม่แสดงโดยตั้งใจ)
-- ---------------------------------------------------------------------------
select lid, role, full_name, "position", department, location, project, created_at
  from public.app_users
 where lid in ('8000001', '8000002')
 order by lid;
