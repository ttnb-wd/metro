import assert from "node:assert/strict";
export function imageKitFixture() {
  type Asset = { fileId: string; filePath: string; name: string; isPrivateFile: boolean; fileType: string; size: number; data: Buffer };
  const files = new Map<string, Asset>();
  const state = { uploads: 0, downloads: 0, deletions: 0, calls: 0, failUpload: false, failRead: false, corrupt: false, publicUpload: false };
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const fetcher: typeof fetch = async (input, init) => {
    state.calls++;
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url), method = init?.method ?? "GET";
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    if (url.hostname === "upload.imagekit.io") {
      assert.equal(method, "POST"); assert.equal(url.pathname, "/api/v1/files/upload");
      const form = init?.body; assert.ok(form instanceof FormData);
      assert.equal(form.get("isPrivateFile"), "true"); assert.equal(form.get("overwriteFile"), "false"); assert.equal(form.get("useUniqueFileName"), "false");
      assert.equal(form.get("folder"), "/metro/payment-evidence"); assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Basic /);
      state.uploads++;
      if (state.failUpload) return json({ message: "Isolated provider failure" }, 503);
      const blob = form.get("file"); assert.ok(blob instanceof Blob);
      const data = Buffer.from(await blob.arrayBuffer()), name = String(form.get("fileName")), fileId = state.uploads.toString(16).padStart(24, "0");
      const asset: Asset = { fileId, filePath: `/metro/payment-evidence/${name}`, name, isPrivateFile: !state.publicUpload, fileType: "image", size: data.length, data };
      files.set(fileId, asset); const { data: _data, ...metadata } = asset; void _data; return json(metadata);
    }
    if (url.hostname === "api.imagekit.io") {
      const id = url.pathname.split("/")[3], asset = files.get(id); if (!asset) return json({}, 404);
      if (method === "DELETE") { files.delete(id); state.deletions++; return new Response(null, { status: 204 }); }
      assert.equal(url.pathname, `/v1/files/${id}/details`);
      if (state.failRead) return json({}, 503);
      const { data: _data, ...metadata } = asset; void _data; return json(metadata);
    }
    assert.equal(url.origin, "https://ik.imagekit.io");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.equal(url.searchParams.get("tr"), "orig-true"); assert.match(url.searchParams.get("ik-s") ?? "", /^[a-f0-9]{40}$/);
    const lifetime = Number(url.searchParams.get("ik-t")) - Math.floor(Date.now() / 1000); assert.ok(lifetime >= 58 && lifetime <= 60);
    const asset = [...files.values()].find(file => `/metro-fixture${file.filePath}` === url.pathname); if (!asset) return new Response(null, { status: 404 });
    state.downloads++;
    return new Response(new Uint8Array(state.corrupt ? Buffer.from("altered") : asset.data), { headers: { "Content-Type": "image/png" } });
  };
  return { files, state, fetch: fetcher };
}
