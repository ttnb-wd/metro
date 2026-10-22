-- REVIEW ONLY. Separate credential for a trusted background process, never Next
-- runtime/browser. Role creation and target/recovery gate must precede execution.
-- metro_commerce_worker: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
-- NOBYPASSRLS, NOREPLICATION; no membership in migration/operator/runtime roles.
GRANT USAGE ON SCHEMA public TO metro_commerce_worker;
GRANT SELECT ON metro_website_outbox,metro_website_operation,metro_website_order,metro_support_issue,metro_service_reference TO metro_commerce_worker;
GRANT UPDATE(state,"leaseId","leaseUntil",attempts,version,"availableAt") ON metro_website_outbox TO metro_commerce_worker;
GRANT UPDATE(state,version,"candidateKeyId") ON metro_website_operation TO metro_commerce_worker;
GRANT UPDATE(state,provisioning,version) ON metro_website_order TO metro_commerce_worker;
GRANT UPDATE(state,version) ON metro_support_issue TO metro_commerce_worker;
GRANT INSERT ON metro_service_reference TO metro_commerce_worker;
GRANT UPDATE(snapshot,version,"capturedAt") ON metro_service_reference TO metro_commerce_worker;
-- No access to passwords, sessions, verification tokens, payment files or OWNER binding.
