import { z } from "zod";
export const rejectionReasons = {
  AMOUNT_MISMATCH: "The received amount does not match this order. Check the exact amount and submit corrected proof.",
  RECIPIENT_MISMATCH: "The proof does not show payment to Metro’s receiving account. Check the payment instructions before submitting corrected proof.",
  UNREADABLE_PROOF: "The receipt is unreadable or incomplete. Upload a clear receipt showing the amount and transaction reference.",
  TRANSACTION_NOT_FOUND: "The transaction could not be confirmed in the receiving account. Check the reference and submit valid proof.",
  DUPLICATE_TRANSACTION: "This transaction was already used for another order. Submit proof of a separate valid payment.",
  OTHER_REVIEW_REQUIRED: "The payment could not be verified from this proof. Check the receiving account, amount and transaction reference before submitting corrected proof.",
} as const;
export const rejectionReasonSchema = z.enum(Object.keys(rejectionReasons) as [keyof typeof rejectionReasons, ...(keyof typeof rejectionReasons)[]]);
