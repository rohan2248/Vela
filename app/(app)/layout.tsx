import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { QueryProvider } from "@/components/providers/query-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Authenticated shell.
 *
 * There is no middleware.ts / proxy.ts in this project, so this layout is the
 * only thing standing between an anonymous visitor and the workspace. It calls
 * getSession directly rather than requireTenant(), which throws rather than
 * redirecting and would surface as a 500 page.
 *
 * `dark` is set here because nothing else in the app ever sets it — the shadcn
 * tokens in globals.css define a .dark block that would otherwise go unused,
 * and every surface would render light.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  return (
    <div className="dark h-screen overflow-hidden bg-black text-cream">
      <QueryProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryProvider>
    </div>
  );
}
