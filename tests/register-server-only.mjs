import { registerHooks } from "node:module";

// Next.js handles this compile-time marker in its bundler. Only the isolated
// Node test process replaces it; application imports remain guarded normally.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return {
      url: new URL("./server-only-stub.cjs", import.meta.url).href,
      format: "commonjs",
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
});
