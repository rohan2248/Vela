import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Already signed in? Skip the form. Without this, returning to /sign-in --
  // via the back button after a redirect, or the landing page's CTA -- shows a
  // login screen to someone who is already logged in.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect("/workspace");

  return <div>{children}</div>;
}
