import "./register-server-only.mjs";
import { registerHooks } from "node:module";

// Only this isolated test process substitutes a session. The dev server and
// production build never load this hook or the fixture module.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const normalized = specifier.replaceAll("\\", "/");
    if (["@/server/website", "@/server/pricing", "@/server/commerce/time"].includes(normalized) || /\/src\/server\/(?:website\/index|pricing\/index|commerce\/time)(?:\.ts)?$/.test(normalized)) return { url: new URL("./workspace-data-stub.mjs", import.meta.url).href, shortCircuit: true };
    if (normalized === "next/image") return { url: new URL("./workspace-image-stub.mjs", import.meta.url).href, shortCircuit: true };
    if (normalized.endsWith(".module.css")) return { url: "data:text/javascript,export default new Proxy({},{get:(_target,key)=>typeof key==='string'?'test-'+key:undefined})", shortCircuit: true };
    if (normalized === "@/server/auth/account-routing" || /\/src\/server\/auth\/account-routing(?:\.ts)?$/.test(normalized)) {
      return { url: new URL("./workspace-routing-stub.mjs", import.meta.url).href, shortCircuit: true };
    }
    if (normalized === "@/server/auth/session" || /\/src\/server\/auth\/session(?:\.ts)?$/.test(normalized)) {
      return { url: new URL("./workspace-session-stub.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
