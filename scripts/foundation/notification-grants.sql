-- REVIEW ONLY. Apply after the additive notification migration and role creation.
-- metro_notifications_worker: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB,
-- NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; no memberships.
GRANT USAGE ON SCHEMA public TO metro_notifications_worker;
GRANT SELECT ON metro_website_notification TO metro_runtime,metro_commerce_worker,metro_notifications_worker;
GRANT INSERT ON metro_website_notification TO metro_runtime,metro_commerce_worker;
GRANT UPDATE("readAt") ON metro_website_notification TO metro_runtime;
GRANT UPDATE("emailState","emailErrorCode","emailSentAt","emailAttempts","emailLeaseId","emailLeaseUntil","emailAvailableAt") ON metro_website_notification TO metro_notifications_worker;
GRANT SELECT ON metro_service_reference TO metro_notifications_worker;
GRANT SELECT(id,"userId",version) ON metro_support_issue TO metro_notifications_worker;
GRANT SELECT(id,email,"emailVerified") ON metro_user TO metro_notifications_worker;
-- No sessions, password hashes, evidence, OWNER binding, pricing or order writes.
