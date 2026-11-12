"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { AppLink } from "@/components/ui/app-link";
import { useBasePath } from "@/components/auth/brand-provider";
import { withBasePath } from "@/lib/paths";

export function accountPath(path: string) {
  return /^\/(apps|settings|help)(\/|$|\?)/.test(path) ? `/account${path}` : path;
}
export function AccountLink({ href, ...props }: ComponentProps<typeof AppLink>) {
  return <AppLink href={accountPath(href)} {...props} />;
}
export function useAccountRouter() {
  const router = useRouter();
  const basePath = useBasePath();
  return {
    push: (path: string) => basePath ? window.location.assign(withBasePath(accountPath(path), basePath)) : router.push(accountPath(path)),
    replace: (path: string) => basePath ? window.location.replace(withBasePath(accountPath(path), basePath)) : router.replace(accountPath(path)),
  };
}
