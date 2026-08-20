import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = {
  title: "Workspace — Vela",
};

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  // The layout already gates on this; re-reading here is what makes the email
  // available without threading it through a context.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  return <WorkspaceShell userEmail={session.user.email} />;
}
