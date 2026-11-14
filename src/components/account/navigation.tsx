"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { AppLink } from "@/components/ui/app-link";
import { useBasePath } from "@/components/auth/brand-provider";
import { accountRoute } from "@/lib/account/routes";
import { withBasePath } from "@/lib/paths";

type Navigation = { route: string; navigate: (path: string, replace?: boolean) => boolean };
const NavigationContext = createContext<Navigation | null>(null);
const navigationEvent = "wyid:account-navigation";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(navigationEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(navigationEvent, listener);
  };
}
const pathname = () => window.location.pathname;

export function accountPath(path: string) {
  return /^\/(apps|settings|help|about)(\/|$|[?#])/.test(path) ? `/account${path}` : path;
}

/** The portal already loads its data through authenticated APIs. Keep its shell
 * mounted instead of fetching another RSC tree (or reloading runtime subpaths).
 * Next integrates native history updates, so Back/Forward remain compatible. */
export function AccountNavigationProvider({ route, children }: { route: string; children: ReactNode }) {
  const basePath = useBasePath();
  const initialPath = withBasePath(accountPath(route), basePath);
  const currentPath = useSyncExternalStore(subscribe, pathname, () => initialPath);
  const navigate = useCallback((path: string, replace = false) => {
    const url = new URL(withBasePath(accountPath(path), basePath), window.location.href);
    if (url.origin !== window.location.origin || !accountRoute(url.pathname, basePath)) return false;
    if (url.href === window.location.href) return true;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(navigationEvent));
    window.scrollTo({ top: 0, behavior: "instant" });
    return true;
  }, [basePath]);
  return <NavigationContext.Provider value={{ route: accountRoute(currentPath, basePath) || route, navigate }}>{children}</NavigationContext.Provider>;
}

export function useAccountRoute() {
  return useContext(NavigationContext)!.route;
}

export function AccountLink({ href, onClick, ...props }: ComponentProps<typeof AppLink>) {
  const navigation = useContext(NavigationContext);
  const basePath = useBasePath();
  const target = accountPath(href);
  if (!navigation || !accountRoute(target.split(/[?#]/)[0])) return <AppLink href={target} onClick={onClick} {...props} />;
  return <a {...props} href={withBasePath(target, basePath)} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.download !== undefined || props.target && props.target !== "_self") return;
    event.preventDefault();
    navigation.navigate(href);
  }} />;
}
export function useAccountRouter() {
  const router = useRouter();
  const basePath = useBasePath();
  const navigation = useContext(NavigationContext);
  return {
    push: (path: string) => { if (!navigation?.navigate(path)) { if (basePath) window.location.assign(withBasePath(accountPath(path), basePath)); else router.push(accountPath(path)); } },
    replace: (path: string) => { if (!navigation?.navigate(path, true)) { if (basePath) window.location.replace(withBasePath(accountPath(path), basePath)); else router.replace(accountPath(path)); } },
  };
}
