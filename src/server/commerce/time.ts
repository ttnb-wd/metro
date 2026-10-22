import "server-only";
import { connection } from "next/server";
// Request time is resolved outside React render calculations and static builds.
export async function requestTimestamp() { await connection(); return Date.now(); }
