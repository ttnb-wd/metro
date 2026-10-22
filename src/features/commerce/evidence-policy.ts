// Keep multipart requests below Vercel's 4.5 MB function payload limit.
export const MAX_PAYMENT_PROOF_BYTES = 4 * 1024 * 1024;
export const PAYMENT_PROOF_SIZE_LABEL = "4 MB";
export const PAYMENT_PROOF_MIME_TYPES = ["image/png", "image/jpeg"] as const;
