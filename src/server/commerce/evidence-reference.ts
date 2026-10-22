import "server-only";
import { z } from "zod";

// Existing UUID references remain readable; new references include the provider's
// immutable file ID. Ownership stays in the existing order/user foreign keys.
export const imageKitReferenceSchema = z.string().regex(/^imagekit:v1:[a-f0-9]{24}:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export const evidenceReferenceSchema = z.union([z.uuid(), imageKitReferenceSchema]);
