import { redirect } from "next/navigation";
import { authContext, authLink } from "@/lib/auth";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(authLink("/login", authContext(await searchParams)));
}
