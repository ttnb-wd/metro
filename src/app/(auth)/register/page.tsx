import type { Metadata } from "next";
import { AuthPreview } from "@/components/forms/auth-preview";

export const metadata: Metadata = { title: "Create account preview" };
export default function RegisterPage() { return <AuthPreview mode="register" />; }
