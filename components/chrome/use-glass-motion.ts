"use client";

import { useReducedMotion, type Transition } from "framer-motion";

const SPRING: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 36,
  mass: 0.9,
};

const FADE: Transition = {
  duration: 0.12,
  ease: "easeOut",
};

/** Returns the transition object used by every Glass Island motion.
 *  On `prefers-reduced-motion: reduce`, collapses the spring to a 120ms
 *  opacity fade. Shared so Spec 2's layoutId morphs inherit the same guard. */
export function useGlassMotion(): Transition {
  const reduced = useReducedMotion();
  return reduced ? FADE : SPRING;
}
