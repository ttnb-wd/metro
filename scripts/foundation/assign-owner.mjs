// Caller must verify target/history and separately approved role/identity first.
// SQL parameters contain metadata only. Never accepts email as authority.
export async function assignOwner(client, { userId, email, role }) {
  if(!/^[a-f0-9-]{36}$/.test(userId)||!/^metro_[a-z_]+$/.test(role))throw new Error('Invalid approved OWNER metadata.');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('metro:owner-assignment',0))::text");
    const identity=(await client.query('SELECT current_user::text AS role')).rows[0];
    if(identity.role!==role)throw new Error('Assignment role mismatch.');
    if((await client.query('SELECT count(*)::int AS n FROM metro_owner_binding')).rows[0].n!==0)throw new Error('OWNER already assigned; stop.');
    const matches=(await client.query('SELECT id,email,"emailVerified" FROM metro_user WHERE id=$1 AND email=$2',[userId,email])).rows;
    if(matches.length!==1||matches[0].emailVerified!==true)throw new Error('Verified approved account is required.');
    const credential=(await client.query('SELECT count(*)::int AS n FROM metro_account WHERE "userId"=$1 AND "providerId"=$2 AND "accountId"=$1',[userId,'credential'])).rows[0];
    if(credential.n!==1)throw new Error('Exactly one credential account is required.');
    const recent=(await client.query(`SELECT EXISTS(SELECT 1 FROM metro_session WHERE "userId"=$1 AND "createdAt"<=CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      AND "createdAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-INTERVAL '5 minutes' AND "expiresAt">CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS present`,[userId])).rows[0];
    if(!recent.present)throw new Error('A fresh authenticated login is required.');
    await client.query('INSERT INTO metro_owner_binding(slot,"userId") VALUES(1,$1)',[userId]);
    const binding=(await client.query('SELECT "userId" FROM metro_owner_binding WHERE slot=1')).rows;
    const audit=(await client.query(`SELECT count(*)::int AS n FROM metro_owner_audit WHERE action='OWNER_BOUND' AND outcome='SUCCESS' AND "actorId"=$1 AND "targetUserId"=$1`,[userId])).rows[0];
    if(binding.length!==1||binding[0].userId!==userId||audit.n!==1)throw new Error('OWNER binding audit mismatch.');
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
}
