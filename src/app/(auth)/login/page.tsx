import type { Metadata } from "next";
import { AuthPreview } from "@/components/forms/auth-preview";

export const metadata: Metadata = { title: "Log in preview" };
export default function LoginPage() { return <AuthPreview mode="login" />; }
