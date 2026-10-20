"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return <Button variant="ghost" size="icon" aria-label="Switch color theme" title="Switch light or dark theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
    <Sun className="hidden dark:block" aria-hidden="true" />
    <Moon className="block dark:hidden" aria-hidden="true" />
  </Button>;
}
