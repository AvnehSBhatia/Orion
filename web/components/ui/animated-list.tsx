"use client";

import { motion, useReducedMotion } from "framer-motion";
import { type ReactElement, type ReactNode } from "react";

export function AnimatedList({ className, children }: { className?: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const items = childrenToArray(children);

  return (
    <div className={className}>
      {items.map((item, index) => (
        <motion.div
          key={item.key ?? index}
          initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: reduce ? 0 : index * 0.045, duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
        >
          {item}
        </motion.div>
      ))}
    </div>
  );
}

function childrenToArray(children: ReactNode) {
  return (Array.isArray(children) ? children : [children]).filter(Boolean) as ReactElement[];
}
