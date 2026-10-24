import { createHash } from 'node:crypto';

/** Operator-only helper. Caller MUST verify pinned target, verified restore,
 * private readback, mapping and explicit authorization, then BEGIN. No runtime
 * privilege is granted. All trigger changes are transactional and restored
 * before COMMIT; a failure MUST roll back the entire transaction. */
export async function compareAndSwapEvidence(client, mappings) {
  if (mappings.length !== 2 || new Set(mappings.map(m => m.id)).size !== 2
    || mappings.some(m => !/^[a-f0-9-]{36}$/.test(m.oldRef) || !/^imagekit:v1:[a-f0-9]{24}:[a-f0-9-]{36}$/.test(m.newRef))) throw Error('INVALID_MIGRATION_MAPPING');
  await client.query('LOCK TABLE metro_payment_evidence IN SHARE ROW EXCLUSIVE MODE');
  const trigger = async () => (await client.query("SELECT t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t WHERE t.tgrelid='metro_payment_evidence'::regclass AND t.tgname='metro_evidence_immutable' AND NOT t.tgisinternal")).rows;
  const beforeTrigger = await trigger();
  if (beforeTrigger.length !== 1 || beforeTrigger[0].tgenabled !== 'O' || !beforeTrigger[0].definition.includes('metro_foundation_immutable')) throw Error('IMMUTABILITY_GUARD_MISMATCH');
  const baseline = (await client.query('SELECT * FROM metro_payment_evidence ORDER BY id')).rows;
  for (const m of mappings) {
    const row = baseline.find(r => r.id === m.id);
    if (!row || row.storageRef !== m.oldRef || row.orderId !== m.orderId || row.userId !== m.userId || row.sha256 !== m.sha256 || row.bytes !== m.bytes || row.mediaType !== 'image/png') throw Error('EVIDENCE_CAS_CONFLICT');
    const ownership = (await client.query('SELECT 1 FROM metro_website_order WHERE id=$1 AND "userId"=$2', [m.orderId, m.userId])).rowCount;
    if (ownership !== 1) throw Error('EVIDENCE_OWNERSHIP_MISMATCH');
  }
  await client.query('ALTER TABLE metro_payment_evidence DISABLE TRIGGER metro_evidence_immutable');
  for (const m of mappings) {
    const changed = await client.query('UPDATE metro_payment_evidence SET "storageRef"=$1 WHERE id=$2 AND "storageRef"=$3 AND "orderId"=$4 AND "userId"=$5 AND sha256=$6 AND bytes=$7', [m.newRef,m.id,m.oldRef,m.orderId,m.userId,m.sha256,m.bytes]);
    if (changed.rowCount !== 1) throw Error('EVIDENCE_CAS_CONFLICT');
  }
  await client.query('ALTER TABLE metro_payment_evidence ENABLE TRIGGER metro_evidence_immutable');
  if (JSON.stringify(await trigger()) !== JSON.stringify(beforeTrigger)) throw Error('IMMUTABILITY_GUARD_NOT_RESTORED');
  const after = (await client.query('SELECT * FROM metro_payment_evidence ORDER BY id')).rows;
  const expected = baseline.map(r => ({...r,storageRef:mappings.find(m=>m.id===r.id)?.newRef??r.storageRef}));
  if (createHash('sha256').update(JSON.stringify(after)).digest('hex') !== createHash('sha256').update(JSON.stringify(expected)).digest('hex')) throw Error('UNRELATED_EVIDENCE_CHANGE');
}
