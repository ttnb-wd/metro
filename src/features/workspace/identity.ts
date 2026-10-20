export function accountInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (!parts.length) return "M";
  const initials = [parts[0], ...(parts.length > 1 ? [parts[parts.length - 1]] : [])]
    .map(part => Array.from(part)[0]).join("").toUpperCase();
  return Array.from(initials).slice(0, 2).join("");
}
