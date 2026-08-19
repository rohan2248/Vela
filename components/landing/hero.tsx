"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NotchNavbar } from "@/components/ui/notch-navbar";
import { WordsPullUp } from "@/components/landing/words-pull-up";

const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4";

const CREAM = "#E1E0CC";
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function Hero() {
  return (
    // The outer padding is what creates the inset frame — the video is a card
    // floating on black rather than a full-bleed background.
    <section className="h-screen w-full p-4 md:p-6">
      <div className="relative h-full w-full overflow-hidden rounded-2xl md:rounded-[2rem]">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={HERO_VIDEO}
          autoPlay
          loop
          muted
          playsInline
        />

        {/* Grain, then a vertical gradient to seat the wordmark against the
            footage and keep the navbar legible at the top. */}
        <div className="noise-overlay pointer-events-none absolute inset-0 opacity-[0.7] mix-blend-overlay" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />

        <NotchNavbar />

        <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 sm:px-6 md:px-8 md:pb-6">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-4">
            <div className="col-span-12 lg:col-span-8">
              <h1
                className="text-[26vw] font-medium leading-[0.85] tracking-[-0.07em] sm:text-[24vw] md:text-[22vw] lg:text-[20vw] xl:text-[19vw] 2xl:text-[20vw]"
                style={{ color: CREAM }}
              >
                <WordsPullUp text="Vela" showAsterisk />
              </h1>
            </div>

            <div className="col-span-12 flex flex-col gap-5 pb-2 lg:col-span-4 lg:pb-6">
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5, ease: EASE_OUT }}
                className="max-w-md text-xs text-cream/70 sm:text-sm md:text-base"
                style={{ lineHeight: 1.2 }}
              >
                Vela is an agent that lives inside your mail and calendar —
                reading every thread, holding every commitment, surfacing the one
                message you half-remember. It drafts and it schedules, but it
                never sends a word without your say-so.
              </motion.p>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.7, ease: EASE_OUT }}
              >
                <Button
                  variant="ghost"
                  size="lg"
                  // This renders as an <a>, not a <button>, so Base UI needs to
                  // be told to drop native button semantics.
                  nativeButton={false}
                  className="group h-auto gap-2 rounded-full bg-cream py-1.5 pl-6 pr-1.5 text-sm font-medium text-black hover:bg-cream hover:gap-3 sm:text-base"
                  render={<Link href="/sign-in" />}
                >
                  Connect your inbox
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black transition-transform duration-300 group-hover:scale-110 sm:h-10 sm:w-10">
                    <ArrowRight
                      className="size-4 sm:size-[18px]"
                      style={{ color: CREAM }}
                    />
                  </span>
                </Button>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
