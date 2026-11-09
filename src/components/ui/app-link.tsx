"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";
import { useBasePath } from "@/components/auth/brand-provider";
import { withBasePath } from "@/lib/paths";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/**
 * For a runtime subpath, use a normal anchor so Next's build-time router base
 * path cannot drop or duplicate the prefix. Root deployments keep Next Link's
 * client-side navigation.
 */
export function AppLink({ href, ...props }: Props) {
  const basePath = useBasePath();
  if (basePath) return <a href={withBasePath(href, basePath)} {...props} />;
  return <Link href={href} {...props} />;
}
