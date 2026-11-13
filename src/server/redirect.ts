import { redirect } from "next/navigation";
import { runtimeBasePath, siteUrl } from "@/lib/paths";
import { getAppUrl } from "./config";

/** Resolve runtime subpaths before Next handles HTTP, streamed or action redirects.
 * Absolute URLs prevent both missing client prefixes and double server prefixes. */
export function redirectToApp(path: string): never {
  redirect(runtimeBasePath() ? siteUrl(path, getAppUrl()).href : path);
}
