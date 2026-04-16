-- Normalize all user roles to two-role model: manager / employee
UPDATE users
SET role = CASE
  WHEN role IN ('manager', 'admin') THEN 'manager'
  ELSE 'employee'
END;

-- Keep role permissions for employee only (manager is full access by design)
DELETE FROM role_permissions WHERE role <> 'employee';
