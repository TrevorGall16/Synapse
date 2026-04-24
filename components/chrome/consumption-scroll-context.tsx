"use client";

import { createContext, useContext, type RefObject } from "react";

export const ConsumptionScrollContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useConsumptionScrollRef() {
  return useContext(ConsumptionScrollContext);
}
