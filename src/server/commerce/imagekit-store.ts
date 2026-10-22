import "server-only";
import ImageKit from "@imagekit/nodejs";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { FoundationError } from "../owner/authorization";
import { imageKitReferenceSchema } from "./evidence-reference";

const folder = "/metro/payment-evidence";
const storedLimit = 5 * 1024 * 1024; // Preserve original evidence during a later migration.
const configSchema = z.object({
  METRO_IMAGEKIT_PRIVATE_KEY: z.string().regex(/^private_[A-Za-z0-9_+\/=.-]{20,500}$/),
  METRO_IMAGEKIT_URL_ENDPOINT: z.string().regex(/^https:\/\/ik\.imagekit\.io\/[A-Za-z0-9_-]{1,100}\/?$/),
  METRO_IMAGEKIT_FOLDER: z.literal(folder),
});
export function imageKitConfiguration(source: Record<string, string | undefined> = process.env) {
  const result = configSchema.safeParse(source);
  if (!result.success) throw new FoundationError("UNAVAILABLE");
  return { privateKey: result.data.METRO_IMAGEKIT_PRIVATE_KEY, urlEndpoint: result.data.METRO_IMAGEKIT_URL_ENDPOINT.replace(/\/$/, ""), folder };
}
type Configuration = ReturnType<typeof imageKitConfiguration>;
const fileSchema = z.object({ fileId: z.string().regex(/^[a-f0-9]{24}$/), filePath: z.string(), isPrivateFile: z.literal(true), fileType: z.literal("image"), size: z.number().int().positive().max(storedLimit) });

export function buildImageKitStore(configuration: Configuration, dependencies: { fetch?: typeof fetch } = {}) {
  const request = dependencies.fetch ?? fetch;
  const client = new ImageKit({ privateKey: configuration.privateKey, baseURL: "https://api.imagekit.io", timeout: 15_000, maxRetries: 0, logLevel: "off", fetch: request, fetchOptions: { cache: "no-store", redirect: "error" } });
  const filePath = (id: string) => `${configuration.folder}/${z.uuid().parse(id)}.png`;
  async function details(ref: string) {
    const parsed = imageKitReferenceSchema.safeParse(ref);
    if (!parsed.success) throw new FoundationError("UNAVAILABLE");
    const [, , fileId, uploadId] = parsed.data.split(":");
    const result = fileSchema.safeParse(await client.files.get(fileId));
    if (!result.success || result.data.fileId !== fileId || result.data.filePath !== filePath(uploadId)) throw new FoundationError("UNAVAILABLE");
    return result.data;
  }
  async function download(ref: string, digest: string) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new FoundationError("UNAVAILABLE");
    const file = await details(ref);
    // Original bytes, never an optimized/transformed payment receipt. The URL
    // lives for 60 seconds and is used server-side only, after repository auth.
    const signed = client.helper.buildSrc({ src: file.filePath, urlEndpoint: configuration.urlEndpoint, signed: true, expiresIn: 60, queryParameters: { tr: "orig-true" } });
    const response = await request(signed, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body || response.headers.get("content-type")?.split(";")[0] !== "image/png") throw new FoundationError("UNAVAILABLE");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > storedLimit) throw new FoundationError("UNAVAILABLE"); chunks.push(part.value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = Buffer.concat(chunks);
    if (size !== file.size || createHash("sha256").update(bytes).digest("hex") !== digest) throw new FoundationError("UNAVAILABLE");
    return bytes;
  }
  return {
    // The caller must have decoded/re-encoded the file before this boundary.
    async putNormalized(bytes: Buffer) {
      if (!bytes.length || bytes.length > storedLimit) throw new FoundationError("INVALID_REQUEST");
      const uploadId = randomUUID(), digest = createHash("sha256").update(bytes).digest("hex");
      let candidate: { fileId: string; filePath: string } | undefined;
      try {
        const uploaded = await client.files.upload({ file: new File([new Uint8Array(bytes)], `${uploadId}.png`, { type: "image/png" }), fileName: `${uploadId}.png`, folder: configuration.folder,
          isPrivateFile: true, useUniqueFileName: false, overwriteFile: false, responseFields: ["isPrivateFile"], tags: ["metro-payment-proof"] });
        const identity = z.object({ fileId: z.string().regex(/^[a-f0-9]{24}$/), filePath: z.string() }).safeParse(uploaded);
        if (identity.success && identity.data.filePath === filePath(uploadId)) candidate = identity.data;
        const parsed = fileSchema.safeParse(uploaded);
        if (!parsed.success || parsed.data.filePath !== filePath(uploadId) || parsed.data.size !== bytes.length) throw new FoundationError("UNAVAILABLE");
        const storageRef = `imagekit:v1:${parsed.data.fileId}:${uploadId}`;
        // Verify privacy, exact original bytes and signed access before Neon can
        // reference the upload or move a payment into its review queue.
        await download(storageRef, digest);
        return { storageRef, sha256: digest, mediaType: "image/png" as const, bytes: bytes.length };
      } catch {
        // This upload has never been returned to a repository. Remove only its
        // exact generated path after confirming identity; never a supplied ID.
        if (candidate) {
          try { const actual = await client.files.get(candidate.fileId); if (actual.filePath === candidate.filePath) await client.files.delete(candidate.fileId); }
          catch { /* Ambiguous/private orphan retained for the scoped audit procedure. */ }
        }
        throw new FoundationError("UNAVAILABLE");
      }
    },
    async get(ref: string, digest: string) { try { return await download(ref, digest); } catch { throw new FoundationError("UNAVAILABLE"); } },
    async remove(ref: string) {
      try { const file = await details(ref); await client.files.delete(file.fileId); }
      catch { throw new FoundationError("UNAVAILABLE"); }
    },
  };
}
