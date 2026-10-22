// Load .env.local with Node's --env-file, never print its contents. This check
// owns exactly one generated ImageKit file and never connects to production DBs.
import ImageKit from "@imagekit/nodejs";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync, readFileSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { imageKitConfiguration, buildImageKitStore } from "../src/server/commerce/imagekit-store.ts";
import { normalizeEvidence } from "../src/server/commerce/evidence-store.ts";

const results: Record<string, string | number> = {};
let stage = "configuration", candidate: { id: string; path: string; ref: string } | undefined;
let client: ImageKit | undefined, manifest: string | undefined;
const baseline = new Set<string>();
let confirmedEndpoint: string | undefined;
const originalEnvironment = readFileSync(".env.local", "utf8");
try {
  const folder = "/metro/payment-evidence", privateKey = process.env.METRO_IMAGEKIT_PRIVATE_KEY ?? "";
  if (process.env.METRO_IMAGEKIT_FOLDER !== folder || process.env.METRO_EVIDENCE_PROVIDER !== "imagekit" || !/^private_[A-Za-z0-9_+\/=.-]{20,500}$/.test(privateKey)) throw new Error();
  client = new ImageKit({ privateKey, baseURL: "https://api.imagekit.io", timeout: 15000, maxRetries: 0, logLevel: "off", fetchOptions: { cache: "no-store", redirect: "error" } });
  stage = "mediaReadPermission";
  for (const file of await client.assets.list({ type: "file", path: folder, limit: 100 })) if (file.fileId) baseline.add(file.fileId);
  results.mediaReadPermission = "PASS";
  stage = "privateUploadAndSignedOriginal";
  const bytes = await normalizeEvidence(await sharp({ create: { width: 24, height: 24, channels: 3, background: "#074a75" } }).png().toBuffer(), "image/png");
  const uploadId = randomUUID(), expectedPath = `${folder}/${uploadId}.png`;
  const uploaded = await client.files.upload({ file: new File([new Uint8Array(bytes)], `${uploadId}.png`, { type: "image/png" }), fileName: `${uploadId}.png`, folder,
    isPrivateFile: true, useUniqueFileName: false, overwriteFile: false, responseFields: ["isPrivateFile"], tags: ["metro-disposable-storage-check"] });
  if (/^[a-f0-9]{24}$/.test(uploaded.fileId ?? "") && uploaded.filePath === expectedPath && !baseline.has(uploaded.fileId!)) {
    candidate = { id: uploaded.fileId!, path: expectedPath, ref: `imagekit:v1:${uploaded.fileId}:${uploadId}` };
    manifest = resolve(`.tmp/imagekit-live-${randomUUID()}.json`);
    writeFileSync(manifest, JSON.stringify({ ...candidate, fixtureOnly: true }), { mode: 0o600 });
  }
  if (!candidate || uploaded.isPrivateFile !== true || uploaded.size !== bytes.length || !uploaded.url) throw new Error();
  // Read the account endpoint from this authenticated API response, not a guess.
  const delivery = new URL(uploaded.url);
  if (delivery.protocol !== "https:" || delivery.hostname !== "ik.imagekit.io" || delivery.username || delivery.password || !delivery.pathname.endsWith(expectedPath)) throw new Error();
  const endpoint = delivery.origin + delivery.pathname.slice(0, -expectedPath.length);
  const config = imageKitConfiguration({ ...process.env, METRO_IMAGEKIT_URL_ENDPOINT: endpoint });
  process.env.METRO_IMAGEKIT_URL_ENDPOINT = config.urlEndpoint;
  confirmedEndpoint = config.urlEndpoint;
  results.configuration = "PASS";
  const monitoredFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname === "ik.imagekit.io" && !response.ok) results.lastSignedDeliveryHttpStatus = response.status;
    return response;
  };
  const store = buildImageKitStore(config, { fetch: monitoredFetch });
  const receipt = { storageRef: candidate.ref, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png" as const, bytes: bytes.length };
  writeFileSync(manifest!, JSON.stringify(receipt), { mode: 0o600 });
  if (createHash("sha256").update(await store.get(receipt.storageRef, receipt.sha256)).digest("hex") !== receipt.sha256) throw new Error();
  results.privateUploadAndSignedOriginal = "PASS";
  stage = "ordinaryUnsignedUrlDenied";
  const ordinary = config.urlEndpoint + candidate.path;
  for (const suffix of ["", "?tr=orig-true"]) {
    const response = await fetch(ordinary + suffix, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    await response.body?.cancel();
    results.ordinaryUnsignedHttpStatus = response.status;
    if (![401, 403, 404].includes(response.status)) throw new Error();
  }
  results.ordinaryUnsignedUrlDenied = "PASS";
  stage = "unsignedNamedTransformation";
  const named = await fetch(ordinary + "?tr=n-ik_ml_thumbnail", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  await named.body?.cancel(); results.unsignedNamedHttpStatus = named.status;
  if (named.ok) throw new Error();
  results.unsignedNamedTransformation = [401, 403, 404].includes(named.status) ? "PASS" : "NOT_VERIFIED";
  stage = "ownerRouteAuthorization";
  const systemNames = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "COMSPEC", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)"];
  const childEnv: NodeJS.ProcessEnv = {};
  for (const name of systemNames) if (process.env[name]) childEnv[name] = process.env[name];
  for (const name of ["METRO_EVIDENCE_PROVIDER", "METRO_IMAGEKIT_PRIVATE_KEY", "METRO_IMAGEKIT_URL_ENDPOINT", "METRO_IMAGEKIT_FOLDER"]) childEnv[name] = process.env[name];
  childEnv.METRO_IMAGEKIT_LIVE_MANIFEST = manifest;
  // No Neon, VPN, SMTP, Better Auth or existing customer credentials enter this
  // disposable fixture process. Only its generated local roles and ImageKit key.
  const run = spawnSync(process.execPath, ["tests/run-checkout.mjs"], { env: childEnv, encoding: "utf8", windowsHide: true, timeout: 420000, maxBuffer: 2 * 1024 * 1024 });
  const scrub = (value: string) => value.replaceAll(config.privateKey, "[REDACTED]");
  writeFileSync(resolve(".tmp/imagekit-live-authorization.log"), scrub((run.stdout ?? "") + (run.stderr ?? "")), { mode: 0o600 });
  if (run.status !== 0) throw new Error();
  results.ownerRouteAuthorization = "PASS";
} catch (error) {
  results[stage] = "FAIL";
  if (typeof (error as { status?: unknown })?.status === "number") results.failureHttpStatus = (error as { status: number }).status;
  process.exitCode = 1;
} finally {
  if (candidate && client) {
    try {
      const actual = await client.files.get(candidate.id);
      if (actual.fileId !== candidate.id || actual.filePath !== candidate.path || baseline.has(candidate.id)) throw new Error();
      await client.files.delete(candidate.id);
      try { await client.files.get(candidate.id); throw new Error(); }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
      results.disposableCleanup = "PASS";
    } catch (error) {
      // The production store may already have removed an uncommitted upload.
      if ((error as { status?: number }).status === 404) results.disposableCleanup = "PASS";
      else { results.disposableCleanup = "FAIL"; process.exitCode = 1; }
    }
    if (results.disposableCleanup === "PASS" && manifest) unlinkSync(manifest);
  } else results.disposableCleanup = "NOT_NEEDED";
  if (results.ownerRouteAuthorization === "PASS" && results.disposableCleanup === "PASS" && confirmedEndpoint && !process.exitCode) {
    try {
      if (readFileSync(".env.local", "utf8") !== originalEnvironment) throw new Error();
      const matches = [...originalEnvironment.matchAll(/^\s*METRO_IMAGEKIT_URL_ENDPOINT\s*=[^\r\n]*/gm)];
      if (matches.length !== 1) throw new Error();
      const updated = originalEnvironment.replace(/^(\s*METRO_IMAGEKIT_URL_ENDPOINT\s*=)[^\r\n]*/m, `$1${confirmedEndpoint}`);
      const temporary = ".env.local.imagekit-check.tmp";
      writeFileSync(temporary, updated, { mode: statSync(".env.local").mode & 0o777, flag: "wx" });
      renameSync(temporary, ".env.local");
      results.endpointConfiguration = "FIXED_FROM_AUTHENTICATED_RESPONSE";
    } catch { results.endpointConfiguration = "FAIL"; process.exitCode = 1; }
  }
  results.productionDatabaseAccess = "NONE";
  console.log(JSON.stringify(results));
}
