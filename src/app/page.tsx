import { redirectToApp } from "@/server/redirect";
import { authContext, authLink } from "@/lib/auth";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirectToApp(authLink("/login", authContext(await searchParams)));
}
