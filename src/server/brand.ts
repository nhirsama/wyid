import { resolveBrand } from "@/lib/brand";
import { withBasePath } from "@/lib/paths";

export function getBrand() {
  const brand = resolveBrand({ nickname: process.env.SITE_NICKNAME, icon: process.env.SITE_ICON });
  return { ...brand, icon: brand.icon ? withBasePath(brand.icon) : undefined };
}
