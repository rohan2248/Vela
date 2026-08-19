"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useInView } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";

import { WordsPullUpMultiStyle } from "@/components/landing/words-pull-up";

const CREAM = "#E1E0CC";
const CARD_EASE = [0.22, 1, 0.36, 1] as const;

const FEATURE_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_133058_0504132a-0cf3-4450-a370-8ea3b05c95d4.mp4";

type Feature = {
  number: string;
  title: string;
  icon: string;
  items: string[];
};

// Every claim here maps to something the backend actually does — see
// lib/search.ts (RRF), lib/embeddings.ts (local MiniLM), lib/agent/tools.ts
// (find_free_time, resolve_datetime, needsApproval) and lib/tenant.ts.
const FEATURES: Feature[] = [
  {
    number: "01",
    title: "Semantic Recall.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171918_4a5edc79-d78f-4637-ac8b-53c43c220606.png&w=1280&q=85",
    items: [
      "Hybrid vector and full-text search, fused with RRF",
      "Embeddings run locally — nothing leaves your machine",
      "Ask in plain language, not Gmail operators",
      "Re-indexed the second new mail lands",
    ],
  },
  {
    number: "02",
    title: "Calendar Command.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171741_ed9845ab-f5b2-4018-8ce7-07cc01823522.png&w=1280&q=85",
    items: [
      "Reads freebusy and proposes slots that actually work",
      "Creates the event and delivers the invites",
      "Natural-language times resolved to your timezone",
    ],
  },
  {
    number: "03",
    title: "Approval Gate.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171809_f56666dc-c099-4778-ad82-9ad4f209567b.png&w=1280&q=85",
    items: [
      "Nothing sends or invites without your sign-off",
      "Scripted actions always stop for a human",
      "Tenant scoped from the session cookie alone",
    ],
  },
];

/** Shared entrance: cards settle in from slightly under-scale, one after another. */
function CardShell({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <motion.div
      ref={ref}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={isInView ? { scale: 1, opacity: 1 } : { scale: 0.95, opacity: 0 }}
      transition={{ duration: 0.7, delay: index * 0.15, ease: CARD_EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Features() {
  return (
    <section
      id="features"
      className="relative min-h-screen overflow-hidden bg-black px-4 py-20 md:px-6 md:py-28"
    >
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.15]" />

      {/* Same cap as the About card, so all three sections share one edge. */}
      <div className="relative mx-auto w-full max-w-[1920px]">
        <h2 className="text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            className="max-w-5xl justify-start text-left"
            segments={[
              {
                text: "Agent-grade infrastructure for the work in your inbox.",
                className: "text-cream",
                breakAfter: true,
              },
              {
                text: "Local by default. Approved by you.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-2 md:gap-1 lg:h-[480px] lg:grid-cols-4">
          <CardShell
            index={0}
            className="relative h-[320px] overflow-hidden rounded-2xl lg:h-full"
          >
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src={FEATURE_VIDEO}
              autoPlay
              loop
              muted
              playsInline
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
            <p
              className="absolute bottom-5 left-5 right-5 text-base font-medium sm:text-lg"
              style={{ color: CREAM }}
            >
              Your inbox, understood.
            </p>
          </CardShell>

          {FEATURES.map((feature, i) => (
            <CardShell
              key={feature.number}
              index={i + 1}
              className="flex h-full min-h-[320px] flex-col rounded-2xl bg-[#212121] p-5 sm:p-6 lg:h-full"
            >
              <Image
                src={feature.icon}
                alt=""
                width={48}
                height={48}
                className="h-10 w-10 rounded-lg object-cover sm:h-12 sm:w-12"
              />

              <h3 className="mt-5 text-base font-medium sm:text-lg" style={{ color: CREAM }}>
                {feature.title}{" "}
                <span className="text-gray-500">{feature.number}</span>
              </h3>

              <ul className="mt-5 flex flex-col gap-3">
                {feature.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-cream" />
                    <span className="text-xs leading-snug text-gray-400 sm:text-sm">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href="/sign-in"
                className="group mt-auto flex items-center gap-1.5 pt-6 text-xs text-cream transition-opacity hover:opacity-70 sm:text-sm"
              >
                Learn more
                <ArrowRight className="size-3.5 -rotate-45 transition-transform group-hover:translate-x-0.5" />
              </a>
            </CardShell>
          ))}
        </div>
      </div>
    </section>
  );
}
