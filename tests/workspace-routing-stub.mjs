import { resolveAccountDestination } from '../src/server/auth/account-routing-policy.ts';
import { getOwnerBinding } from './workspace-session-stub.mjs';
// Isolated route-render fixture only; never loaded by Next or application runtime.
export async function getAccountDestination(session, requested='/dashboard') {
  return resolveAccountDestination(session.user, requested, async()=>getOwnerBinding());
}
