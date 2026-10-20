"use client";

import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;

export function SheetContent({ children, className, ...props }: React.ComponentProps<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0" />
      <Dialog.Content className={cn("fixed inset-y-0 right-0 z-50 flex w-[min(360px,calc(100%-24px))] flex-col border-l border-border bg-surface p-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right duration-200", className)} {...props}>
        {children}
        <Dialog.Close className="absolute right-4 top-4 inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X size={20} aria-hidden="true" /><span className="sr-only">Close menu</span>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
