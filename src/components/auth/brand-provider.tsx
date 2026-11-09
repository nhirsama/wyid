"use client";

import { createContext, useContext, type ReactNode } from "react";
import { defaultBrand, type SiteBrand } from "@/lib/brand";

const BrandContext = createContext<SiteBrand>(defaultBrand);
const BasePathContext = createContext("");
export function BrandProvider({ brand, basePath, children }: { brand: SiteBrand; basePath: string; children: ReactNode }) {
  return <BasePathContext.Provider value={basePath}><BrandContext.Provider value={brand}>{children}</BrandContext.Provider></BasePathContext.Provider>;
}
export function useBrand() { return useContext(BrandContext); }
export function useBasePath() { return useContext(BasePathContext); }
