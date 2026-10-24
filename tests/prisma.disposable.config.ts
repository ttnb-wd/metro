import { defineConfig } from "prisma/config";
import { fileURLToPath } from "node:url";

function localUrl(name: string, shadow = false): string {
  const raw = process.env[name];
  try {
    const url = new URL(raw ?? "");
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !url.port ||
        url.username !== "metro_disposable_migrator" || !url.password || url.search || url.hash ||
        !(shadow ? /^\/metro_disposable_[a-f0-9]{16}_shadow$/ : /^\/metro_disposable_[a-f0-9]{16}$/).test(url.pathname) ||
        !/^[a-f0-9]{64}$/.test(process.env.METRO_DISPOSABLE_VERIFIED ?? "")) throw new Error();
    return raw!;
  } catch { throw new Error("A verified disposable loopback migration target is required."); }
}
const url = localUrl("METRO_DISPOSABLE_MIGRATION_URL");
const shadow = localUrl("METRO_DISPOSABLE_SHADOW_URL", true);
if (new URL(url).host !== new URL(shadow).host || new URL(shadow).pathname !== `${new URL(url).pathname}_shadow`) {
  throw new Error("Disposable shadow target must share the verified cluster.");
}
export default defineConfig({
  schema: fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)),
  migrations: { path: fileURLToPath(new URL("../prisma/migrations", import.meta.url)) },
  datasource: { url, shadowDatabaseUrl: shadow },
});
