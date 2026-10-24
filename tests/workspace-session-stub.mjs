// Isolated render fixture, not a database user, server route or fake login.
let currentSession = null;
let ownerBinding = null;
export function setOwnerBinding(value) { ownerBinding = value; }
export function getOwnerBinding() { return ownerBinding; }
export const calls = [];
export function setSession(value) { currentSession = value; calls.length = 0; }
export async function getWebsiteSession() { return currentSession; }
export async function requireWebsiteSession(returnTo) {
  calls.push(returnTo);
  if (!currentSession) throw new Error("TEST_REJECTED_ANONYMOUS");
  return currentSession;
}
