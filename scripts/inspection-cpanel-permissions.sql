-- REVIEW TEMPLATE ONLY: all grants below are commented out deliberately.
-- Accounts confirmed by the responsible user on 2026-10-14.
-- Creating the schema does not authorize any account.
-- After explicitly approving the exact accounts and roles, uncomment only the
-- relevant rows and run against the dedicated peritajes database.
-- The account must also exist in Supabase Auth and have an active existing
-- admin_access_profiles record. First successful verification binds its UUID.
-- Existing assignments are not replaced by these statements.
-- Both accounts may use justified N/A. Only the module admin may approve,
-- publish, archive and approve evidence for public reports.
-- Do not create/activate admin_access_profiles automatically: existing
-- is_rg_admin() also uses active profiles to grant access outside this module.

-- INSERT IGNORE INTO rg_inspection_permissions(email,role,can_na,is_active)
-- VALUES ('alejandro.perez@rgcars.com.ar','admin',1,1);

-- INSERT IGNORE INTO rg_inspection_permissions(email,role,can_na,is_active)
-- VALUES ('ventas@rgcars.com.ar','inspector',1,1);

-- Revocation example (replace the email deliberately):
-- UPDATE rg_inspection_permissions SET is_active=0 WHERE email='cuenta@ejemplo.com';
