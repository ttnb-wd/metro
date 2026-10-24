"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return <NextThemesProvider nonce={nonce} attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>{children}</NextThemesProvider>;
}
