-- ============================================================================
-- ปลด app_users.lid ออกจาก employees.lid
--
-- 04_relations.sql ผูก foreign key ไว้ว่า "1 พนักงาน = 1 บัญชี" แต่ 10_register_user_manual.sql
-- เปลี่ยนกติกาการสมัครไปแล้วว่า LID ที่ไม่มีในชีต dataforscan1 ก็สมัครได้
-- FK เดิมจึงค้างอยู่และทำให้การสมัครแบบใหม่ล้มด้วย error 23503 —
-- รวมถึงบัญชีของโรงครัวที่ไม่ได้เป็นพนักงานในชีต (ดู 13_kitchen_admin_users.sql)
--
-- สิ่งที่เสียไปคือกติกา "ห้ามลบพนักงานที่ยังมีบัญชีอยู่" ซึ่งไม่มีผลในทางปฏิบัติ
-- เพราะ Apps Script เปลี่ยนไปใช้ soft delete (ใส่ deleted_at) ตั้งแต่ 04 แล้ว
-- ไม่มีการลบแถว employees จริงอีกต่อไป
--
-- food_orders.submitted_by_lid -> app_users.lid ยังอยู่เหมือนเดิม
--
-- รันหลัง 01–11 (รันซ้ำได้)
-- ============================================================================

alter table public.app_users
  drop constraint if exists app_users_lid_fkey;

-- ---------------------------------------------------------------------------
-- ตรวจผล: ต้องเหลือแค่ food_orders_submitted_by_fkey แถวเดียว
-- ---------------------------------------------------------------------------
select conname as ชื่อคอนสเตรนต์, pg_get_constraintdef(oid) as นิยาม
  from pg_constraint
 where conrelid in ('public.app_users'::regclass, 'public.food_orders'::regclass)
   and contype = 'f'
 order by conname;
