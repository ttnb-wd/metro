// Read-only inventory. Never deletes unreferenced or ambiguous files.
import ImageKit from "@imagekit/nodejs";
import { ChannelBindingClient, createPgPoolConfig } from "../../src/server/db/connection-config.ts";
import { assertWebsiteTargetUrl } from "../../src/server/db/target-policy.ts";
import { imageKitConfiguration } from "../../src/server/commerce/imagekit-store.ts";

const config = imageKitConfiguration();
if (config.urlEndpoint !== "https://ik.imagekit.io/r86wb9d9ez") throw new Error("Dedicated Metro account required.");
const url = assertWebsiteTargetUrl(process.env.METRO_DATABASE_URL!, "metro_runtime", true);
const db = new ChannelBindingClient(createPgPoolConfig(url.href));
let connected = false;
try {
  await db.connect(); connected = true; await db.query("BEGIN READ ONLY");
  const refs = (await db.query('SELECT "storageRef" FROM metro_payment_evidence')).rows.map(r => r.storageRef as string);
  const intents = new Set((await db.query("SELECT id FROM metro_website_request WHERE action='CHECKPOINT' AND \"resultId\" LIKE 'evidence-upload:%'")).rows.map(r => r.id as string));
  const client = new ImageKit({ privateKey: config.privateKey, logLevel: "off", maxRetries: 0, timeout: 15000 });
  const counts = { referenced: 0, retainedKnownUpload: 0, retainedAmbiguous: 0, nonPrivate: 0, privacyUnknown: 0, truncated: false };
  for (let skip = 0; skip < 10000; skip += 100) {
    const page = await client.assets.list({ type: "file", path: config.folder + "/", limit: 100, skip });
    for (const file of page) {
      if (!("fileId" in file) || !("filePath" in file) || typeof file.filePath !== "string") { counts.retainedAmbiguous++; continue; }
      const upload = file.filePath.match(/^\/metro\/payment-evidence\/([a-f0-9-]{36})\.png$/)?.[1];
      if (!upload) { counts.retainedAmbiguous++; continue; }
      if (refs.includes(`imagekit:v1:${file.fileId}:${upload}`)) counts.referenced++;
      else if (intents.has(upload)) counts.retainedKnownUpload++;
      else counts.retainedAmbiguous++; // Includes protected migration copies or lost provider replies.
      if (!("isPrivateFile" in file)) counts.privacyUnknown++;
      else if (file.isPrivateFile !== true) counts.nonPrivate++;
    }
    if (page.length < 100) break;
    if (skip === 9900) counts.truncated = true;
  }
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ mode: "READ_ONLY_RECONCILIATION", ...counts, deletions: 0, action: "Review retained files against durable upload intents and protected rollback manifests; never delete by age alone." }));
} catch {
  console.error("Metro evidence reconciliation unavailable; no files or records changed."); process.exitCode = 1;
} finally { if (connected) await db.end().catch(() => undefined); }
