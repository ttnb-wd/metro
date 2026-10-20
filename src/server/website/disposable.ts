import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../db/generated/client";
import { FoundationError, type SessionReader } from "../owner/authorization";
import { buildRepositories } from "./repositories";

export function getWebsiteRepositories(): never { throw new FoundationError("DISABLED"); }

// No production activation path or fallback to .env.local/Neon credentials exists.
export async function createDisposableRepositories(input: { url: string; marker: string; readSession: SessionReader }) {
  if (process.env.NODE_ENV === "production") throw new FoundationError("DISABLED");
  let url: URL;
  try { url = new URL(input.url); } catch { throw new FoundationError("DISABLED"); }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !url.port || !url.password || url.search || url.hash ||
      !/^metro_disposable_[a-f0-9]{16}$/.test(url.pathname.slice(1)) || url.username !== "metro_disposable_app" || !/^[a-f0-9]{64}$/.test(input.marker)) throw new FoundationError("DISABLED");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: input.url, max: 6 }), log: [], errorFormat: "minimal" });
  try {
    const [identity] = await db.$queryRaw<Array<{ database: string; role: string; address: string; port: number; token: string }>>`
      SELECT current_database()::text AS database,current_user::text AS role,host(inet_server_addr()) AS address,
        inet_server_port() AS port,(SELECT token FROM metro_disposable_marker WHERE slot=1) AS token`;
    if (!identity || identity.database !== url.pathname.slice(1) || identity.role !== url.username || identity.address !== "127.0.0.1" || identity.port !== Number(url.port) || identity.token !== input.marker) throw new Error();
    return { repositories: buildRepositories(db, input.readSession), close: () => db.$disconnect() };
  } catch { await db.$disconnect(); throw new FoundationError("DISABLED"); }
}
