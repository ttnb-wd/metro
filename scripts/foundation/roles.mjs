// Reviewed role policy. No environment loading, connection or secret output.
export const productionRoles = { runtime: 'metro_runtime', migration: 'metro_migrator', assignment: 'metro_owner_assign' };
export const authTables = ['metro_user','metro_session','metro_account','metro_verification','metro_rate_limit'];
export const foundationTables = ['metro_owner_binding','metro_website_order','metro_payment_evidence','metro_payment_decision','metro_service_reference','metro_support_issue','metro_issue_event','metro_owner_audit','metro_website_request','metro_website_operation','metro_website_outbox'];
export function identifier(value) {
  if (!/^metro_[a-z0-9_]{1,48}$/.test(value) && value !== '_prisma_migrations') throw new Error('Invalid foundation identifier.');
  return '"'+value+'"';
}
export function grantsSql(roles = productionRoles, includeFoundation = true) {
  const r=identifier(roles.runtime), m=identifier(roles.migration), a=identifier(roles.assignment);
  const list=values=>values.map(identifier).join(',');
  const tables=[...authTables,...(includeFoundation?foundationTables:[])];
  return `REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE,CREATE ON SCHEMA public TO ${m};
    GRANT USAGE ON SCHEMA public TO ${r},${a};
    REVOKE ALL ON TABLE ${list([...tables,'_prisma_migrations'])} FROM ${r},${a};
    GRANT SELECT ON TABLE ${list(tables)} TO ${r};
    GRANT INSERT,UPDATE,DELETE ON TABLE ${list(authTables)} TO ${r};
    GRANT SELECT(migration_name,finished_at,rolled_back_at) ON _prisma_migrations TO ${r};
    GRANT SELECT(id,name,email,"emailVerified","createdAt") ON metro_user TO ${a};
    GRANT SELECT("userId","providerId","accountId") ON metro_account TO ${a};
    GRANT SELECT("userId","createdAt","expiresAt") ON metro_session TO ${a};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
    ${includeFoundation?`GRANT INSERT,UPDATE ON metro_website_order,metro_support_issue,metro_website_request,metro_website_operation,metro_website_outbox TO ${r};
    GRANT INSERT ON metro_payment_evidence,metro_payment_decision,metro_issue_event,metro_owner_audit TO ${r};
    GRANT SELECT,INSERT ON metro_owner_binding,metro_owner_audit TO ${a};`:''}`;
}
export function transferTablesSql(roles = productionRoles, includeFoundation = false) {
  return [...authTables,'_prisma_migrations',...(includeFoundation?foundationTables:[])].map(table=>`ALTER TABLE ${identifier(table)} OWNER TO ${identifier(roles.migration)};`).join('\n');
}
export function revokeAssignmentSql(roles = productionRoles) {
  return `REVOKE INSERT ON metro_owner_binding,metro_owner_audit FROM ${identifier(roles.assignment)}`;
}

export async function createRestrictedRoles(client, roles, passwords) {
  if(new Set(Object.values(roles)).size!==3)throw new Error('Role identities must be separate.');
  for(const [kind,name] of Object.entries(roles)){
    identifier(name);
    if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount)throw new Error('Role already exists; inspect rather than overwrite.');
    const password=passwords[kind];
    if(typeof password!=='string'||password.length<32||password.length>256||!/^[-_A-Za-z0-9]+$/.test(password)||new Set(password).size<10)throw new Error('Strong injected role credential required.');
    await client.query(`CREATE ROLE ${identifier(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  }
  const administrator=(await client.query('SELECT quote_ident(current_user) AS name')).rows[0].name;
  // Needed for legacy ownership transfer; never grant this to runtime/operator.
  await client.query(`GRANT ${identifier(roles.migration)} TO ${administrator} WITH SET TRUE`);
}
