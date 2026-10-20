import "server-only";
import { issueSchema } from "./contracts";
import type { z } from "zod";

export const transitions = {
  order: {
    AWAITING_PAYMENT: ["FULFILMENT_PENDING", "CANCELLED", "REVIEW_REQUIRED"],
    FULFILMENT_PENDING: ["COMPLETE", "REVIEW_REQUIRED"], COMPLETE: ["REVIEW_REQUIRED"],
    CANCELLED: [], REVIEW_REQUIRED: ["FULFILMENT_PENDING", "CANCELLED"],
  },
  payment: {
    UNVERIFIED: ["UNDER_REVIEW"], UNDER_REVIEW: ["CONFIRMED", "REJECTED"],
    CONFIRMED: ["REFUND_REVIEW"], REJECTED: ["UNDER_REVIEW"],
    REFUND_REVIEW: ["REFUNDED", "CONFIRMED"], REFUNDED: [],
  },
  provisioning: {
    NOT_REQUESTED: ["QUEUED"], QUEUED: ["PROCESSING", "REVIEW_REQUIRED"],
    PROCESSING: ["SUCCEEDED", "RETRY_PENDING", "REVIEW_REQUIRED"],
    RETRY_PENDING: ["PROCESSING", "REVIEW_REQUIRED"], SUCCEEDED: [], REVIEW_REQUIRED: ["QUEUED"],
  },
  issue: {
    OPEN: ["DIAGNOSING", "CLOSED"], DIAGNOSING: ["TROUBLESHOOTING", "REPLACEMENT_APPROVED", "REVIEW_REQUIRED"],
    TROUBLESHOOTING: ["RESOLVED", "REVIEW_REQUIRED"], REPLACEMENT_APPROVED: ["RESOLVED", "REVIEW_REQUIRED"],
    REVIEW_REQUIRED: ["DIAGNOSING", "CLOSED"], RESOLVED: ["CLOSED"], CLOSED: [],
  },
  replacement: {
    REQUESTED: ["FAILURE_VERIFIED", "REVIEW_REQUIRED"], FAILURE_VERIFIED: ["NEW_KEY_BLOCKED", "REVIEW_REQUIRED"],
    NEW_KEY_BLOCKED: ["LIMIT_VERIFIED", "REVIEW_REQUIRED"], LIMIT_VERIFIED: ["OLD_KEY_DISABLED", "REVIEW_REQUIRED"],
    OLD_KEY_DISABLED: ["COMMITTED", "REVIEW_REQUIRED"], COMMITTED: ["COMPLETED", "REVIEW_REQUIRED"],
    COMPLETED: [], REVIEW_REQUIRED: [],
  },
} as const;

export type Machine = keyof typeof transitions;
export type State<M extends Machine> = Extract<keyof (typeof transitions)[M], string>;
export type TransitionEvidence = {
  payment?: "CONFIRMED"; provisioning?: "SUCCEEDED"; verificationId?: string;
  paymentAuthorityVerified?: boolean; failureVerified?: boolean; ownershipVerified?: boolean;
  newKeyBlocked?: boolean; limitVerified?: boolean; oldKeyDisabled?: boolean;
  preservationVerified?: boolean; now?: string; expiresAt?: string; remainingBytes?: string;
};
export function assertTransition<M extends Machine>(machine: M, from: State<M>, to: State<M>, evidence: TransitionEvidence = {}) {
  const graph = transitions[machine] as Record<string, readonly string[]>;
  if (!graph[from]?.includes(to)) throw new Error("Invalid state transition.");
  if (machine === "payment" && to === "CONFIRMED" &&
      (!evidence.paymentAuthorityVerified || !evidence.verificationId)) throw new Error("Payment authority required.");
  if ((machine === "order" && to === "FULFILMENT_PENDING" || machine === "provisioning" && to === "QUEUED") &&
      evidence.payment !== "CONFIRMED") throw new Error("Confirmed payment required.");
  if (machine === "order" && to === "COMPLETE" &&
      (evidence.payment !== "CONFIRMED" || evidence.provisioning !== "SUCCEEDED")) throw new Error("Fulfilment evidence required.");
  if (machine === "issue" && to === "REPLACEMENT_APPROVED" && !evidence.failureVerified) throw new Error("Verified key failure required.");
  if (machine === "replacement" && to !== "REVIEW_REQUIRED") {
    if (!evidence.failureVerified || !evidence.ownershipVerified) throw new Error("Replacement authority required.");
    if (to !== "FAILURE_VERIFIED" && !evidence.newKeyBlocked) throw new Error("Blocked candidate required.");
    if (["LIMIT_VERIFIED", "OLD_KEY_DISABLED", "COMMITTED", "COMPLETED"].includes(to) && !evidence.limitVerified) throw new Error("Verified finite allowance required.");
    if (["OLD_KEY_DISABLED", "COMMITTED", "COMPLETED"].includes(to) && !evidence.oldKeyDisabled) throw new Error("Previous key must be disabled.");
    if (["COMMITTED", "COMPLETED"].includes(to)) {
      const now = Date.parse(evidence.now ?? ""); const expiry = Date.parse(evidence.expiresAt ?? "");
      if (!evidence.preservationVerified || !Number.isFinite(now) || !Number.isFinite(expiry) || now >= expiry ||
          !/^[1-9][0-9]{0,29}$/.test(evidence.remainingBytes ?? "")) throw new Error("Unexpired preserved quota required.");
    }
  }
}

type Issue = z.infer<typeof issueSchema>;
export function recordConnectionTest(issue: Issue, result: "SUCCEEDED" | "FAILED", at: string): Issue {
  issueSchema.parse(issue);
  const state = result === "SUCCEEDED" ? "TROUBLESHOOTING" : "REPLACEMENT_APPROVED";
  assertTransition("issue", issue.state, state, { failureVerified: result === "FAILED" });
  return issueSchema.parse({ ...issue, state, history: [...issue.history,
    { kind: result === "SUCCEEDED" ? "ADMIN_TEST_SUCCEEDED" : "ADMIN_TEST_FAILED", at, attempt: issue.attempts }] });
}
export function recordCustomerRetry(issue: Issue, expectedAttempt: number, result: "SUCCEEDED" | "FAILED", at: string): Issue {
  issueSchema.parse(issue);
  if (issue.state !== "TROUBLESHOOTING" || issue.attempts >= 3 || expectedAttempt !== issue.attempts) throw new Error("Retry is unavailable.");
  const attempts = issue.attempts + 1;
  return issueSchema.parse({ ...issue, attempts,
    state: result === "SUCCEEDED" ? "RESOLVED" : attempts === 3 ? "REVIEW_REQUIRED" : "TROUBLESHOOTING",
    history: [...issue.history, { kind: result === "SUCCEEDED" ? "CUSTOMER_RETRY_SUCCEEDED" : "CUSTOMER_RETRY_FAILED", at, attempt: attempts }] });
}
