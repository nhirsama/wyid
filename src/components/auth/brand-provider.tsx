"use client";

import { createContext, useContext, type ReactNode } from "react";
import { defaultBrand, type SiteBrand } from "@/lib/brand";

const BrandContext = createContext<SiteBrand>(defaultBrand);
export function BrandProvider({ brand, children }: { brand: SiteBrand; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
export function useBrand() { return useContext(BrandContext); }
