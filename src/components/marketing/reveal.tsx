"use client";

import { motion, MotionConfig } from "motion/react";

export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  return <MotionConfig reducedMotion="user"><motion.div className={className} initial={{ opacity: 1, y: 0 }} animate={{ opacity: 1, y: [6, 0] }} transition={{ duration: 0.28, ease: "easeOut" }}>{children}</motion.div></MotionConfig>;
}
