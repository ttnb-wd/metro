import "server-only";
import { notFound, redirect } from "next/navigation";
import { foundationDatabase } from "../website";
import { FoundationError } from "../owner/authorization";
import { buildAdminRepository } from "./repository";
import { getWebsiteSession } from "../auth/session";

export async function getAdminRepository() {
  const session = await getWebsiteSession();
  if (!session?.user.emailVerified) throw new FoundationError("UNAUTHENTICATED");
  return buildAdminRepository(await foundationDatabase());
}
export async function adminPage<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof FoundationError) {
      if (error.code === "UNAUTHENTICATED") redirect("/login?next=%2Fadmin");
      if (["FORBIDDEN", "NOT_FOUND"].includes(error.code)) notFound();
    }
    throw new Error("Metro administration is temporarily unavailable. Please try again.");
  }
}
