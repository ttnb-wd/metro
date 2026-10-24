import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, open, unlink, lstat } from "node:fs/promises";
import { isAbsolute, resolve, join, relative } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { FoundationError } from "../owner/authorization";
import { MAX_PAYMENT_PROOF_BYTES } from "@/features/commerce/evidence-policy";
import { buildImageKitStore, imageKitConfiguration } from "./imagekit-store";

const LIMIT = MAX_PAYMENT_PROOF_BYTES;
const LEGACY_LIMIT = 5 * 1024 * 1024;
let decoding = 0;
export function privateStorageConfiguration(source = process.env) {
  const root = source.METRO_EVIDENCE_DIRECTORY, key = source.METRO_EVIDENCE_ENCRYPTION_KEY;
  if (!root || !isAbsolute(root) || !key || !/^[a-f0-9]{64}$/i.test(key) || new Set(key.toLowerCase()).size < 10) throw new FoundationError("UNAVAILABLE");
  // Runtime-only private paths must not be included in deployment file tracing.
  const directory = resolve(/* turbopackIgnore: true */ root), workspace = resolve(/* turbopackIgnore: true */ process.cwd());
  if (!relative(workspace, directory).startsWith("..") || directory === resolve(directory, "..")) throw new FoundationError("UNAVAILABLE");
  return { directory, key: Buffer.from(key, "hex") };
}
function storageProvider(source = process.env) {
  const provider = source.METRO_EVIDENCE_PROVIDER || "local";
  if (!["local", "imagekit"].includes(provider) || source.VERCEL === "1" && provider !== "imagekit") throw new FoundationError("UNAVAILABLE");
  return provider;
}
export function evidenceStorageReady(source = process.env) {
  try { if (storageProvider(source) === "imagekit") imageKitConfiguration(source); else privateStorageConfiguration(source); return true; }
  catch { return false; }
}
/** Decode and re-encode images. No HTML/SVG/PDF execution surface or original EXIF. */
export async function normalizeEvidence(bytes: Buffer, declaredType?: string) {
  if (!bytes.length || bytes.length > LIMIT) throw new FoundationError("INVALID_REQUEST");
  if (decoding >= 2) throw new FoundationError("CONFLICT");
  decoding++;
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "warning", animated: false });
    const metadata = await image.metadata();
    if (!["jpeg", "png"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error();
    if (declaredType && declaredType !== `image/${metadata.format}`) throw new Error();
    const normalized = await image.rotate().resize({ width: 2400, height: 3200, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    if (normalized.length > LIMIT) throw new Error();
    return normalized;
  } catch { throw new FoundationError("INVALID_REQUEST"); }
  finally { decoding--; }
}
export function buildEvidenceStore(configuration: { directory: string; key: Buffer }) {
  if (configuration.key.length !== 32) throw new FoundationError("UNAVAILABLE");
  const path = (ref: string) => join(configuration.directory, `${z.uuid().parse(ref)}.enc`);
  return {
    async put(input: Buffer, declaredType?: string) {
      const bytes = await normalizeEvidence(input, declaredType), storageRef = randomUUID(), iv = randomBytes(12);
      await mkdir(configuration.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(configuration.directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new FoundationError("UNAVAILABLE");
      const cipher = createCipheriv("aes-256-gcm", configuration.key, iv);
      cipher.setAAD(Buffer.from(storageRef));
      const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
      const file = await open(path(storageRef), "wx", 0o600);
      try {
        await file.writeFile(Buffer.concat([iv, cipher.getAuthTag(), body]));
        await file.sync();
        await file.close();
      } catch (error) {
        await file.close().catch(() => undefined);
        await unlink(path(storageRef)).catch(() => undefined);
        throw error;
      }
      return { storageRef, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png" as const, bytes: bytes.length };
    },
    async get(ref: string, digest: string) {
      const file = path(ref), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > LEGACY_LIMIT + 28) throw new FoundationError("UNAVAILABLE");
      const packed = await readFile(file), decipher = createDecipheriv("aes-256-gcm", configuration.key, packed.subarray(0, 12));
      decipher.setAAD(Buffer.from(ref)); decipher.setAuthTag(packed.subarray(12, 28));
      const bytes = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
      if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new FoundationError("UNAVAILABLE");
      return bytes;
    },
    async remove(ref: string) { await unlink(path(ref)); },
  };
}
export function evidenceStore(source = process.env) {
  const provider = storageProvider(source);
  const remote = () => buildImageKitStore(imageKitConfiguration(source));
  const legacy = () => {
    // A serverless disk cannot recover the old private evidence volume. Retain
    // it on its existing host until the non-destructive migration is approved.
    if (source.VERCEL === "1") throw new FoundationError("UNAVAILABLE");
    return buildEvidenceStore(privateStorageConfiguration(source));
  };
  return {
    async put(input: Buffer, declaredType?: string, reservedId?: string) { return provider === "imagekit" ? remote().putNormalized(await normalizeEvidence(input, declaredType), reservedId) : legacy().put(input, declaredType); },
    async get(ref: string, digest: string) { return ref.startsWith("imagekit:") ? remote().get(ref, digest) : legacy().get(ref, digest); },
    async remove(ref: string) { return ref.startsWith("imagekit:") ? remote().remove(ref) : legacy().remove(ref); },
  };
}
