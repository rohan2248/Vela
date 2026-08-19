"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Notch navbar — a black pill that hangs off the top edge of the hero, its
 * bottom corners rounded so it reads as a cut-out in the frame above it.
 *
 * Pulled from the VengeanceUI registry (`@vengeanceui/notch-navbar`) and
 * rewritten here as owned source, per AGENTS.md. The registry version depended
 * on three modules this project doesn't have (`next-themes`, a theme toggle and
 * a logo asset) and drew an inverted full-bleed notch rather than a centred
 * pill, so only the notch silhouette survives.
 *
 * Colours are applied inline because the cream is a one-off that shouldn't
 * earn a theme token.
 */

const NAV_ITEMS = [
  { label: "How it works", href: "#about" },
  { label: "Capabilities", href: "#features" },
  { label: "Sign in", href: "/sign-in" },
] as const;

const IDLE = "rgba(225, 224, 204, 0.8)";
const ACTIVE = "#E1E0CC";

export function NotchNavbar({ className }: { className?: string }) {
  return (
    <nav
      className={cn(
        "absolute top-0 left-1/2 z-20 -translate-x-1/2",
        "bg-black rounded-b-2xl md:rounded-b-3xl",
        "px-4 py-2 md:px-8",
        className,
      )}
    >
      <ul className="flex items-center gap-3 sm:gap-6 md:gap-12 lg:gap-14">
        {NAV_ITEMS.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="whitespace-nowrap text-[10px] transition-colors duration-200 sm:text-xs md:text-sm"
              style={{ color: IDLE }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = ACTIVE;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = IDLE;
              }}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default NotchNavbar;
