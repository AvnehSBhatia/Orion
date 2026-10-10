"use client";

import { cn } from "@/lib/utils";
import { motion, type Transition, useAnimate } from "framer-motion";
import { useRef } from "react";

type SwapTransition = Transition;

function shuffled(length: number) {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

export function RandomLetterSwap({
  label,
  className,
  reverse = false,
  staggerDuration = 0.03,
  transition = { duration: 0.6, type: "spring" },
}: {
  label: string;
  className?: string;
  reverse?: boolean;
  staggerDuration?: number;
  transition?: SwapTransition;
}) {
  const [scope, animate] = useAnimate();
  const running = useRef(false);
  const letters = label.split("");

  const play = async () => {
    if (running.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    running.current = true;
    const order = shuffled(letters.length);
    await Promise.all(
      order.map(async (letterIndex, step) => {
        const delay = step * staggerDuration;
        await Promise.all([
          animate(`.letter-${letterIndex}`, { y: reverse ? "100%" : "-100%" }, { ...transition, delay }),
          animate(`.letter-secondary-${letterIndex}`, { top: "0%" }, { ...transition, delay }),
        ]);
        animate(`.letter-${letterIndex}`, { y: 0 }, { duration: 0 });
        animate(`.letter-secondary-${letterIndex}`, { top: reverse ? "-100%" : "100%" }, { duration: 0 });
      }),
    );
    running.current = false;
  };

  return (
    <motion.span
      ref={scope}
      data-label={label}
      role="button"
      tabIndex={0}
      onHoverStart={play}
      onFocus={play}
      className={cn("relative flex items-center justify-center overflow-hidden", className)}
    >
      <span className="sr-only">{label}</span>
      {letters.map((letter, index) => (
        <span key={index} aria-hidden className="relative flex whitespace-pre">
          <motion.span className={`relative letter-${index}`} style={{ top: 0 }}>
            {letter}
          </motion.span>
          <motion.span className={`absolute letter-secondary-${index}`} style={{ top: reverse ? "-100%" : "100%" }}>
            {letter}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}
