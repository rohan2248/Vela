"use client";

import { Fragment, useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";

import { WordsPullUpMultiStyle } from "@/components/landing/words-pull-up";

const BODY_TEXT =
  "Every message and event is indexed the moment it lands — embedded locally on your own hardware, never shipped to a third party. Vector recall and full-text search are fused with reciprocal rank fusion, so Vela finds the thread whether you remember the invoice number or only the argument.";

const TOTAL_CHARS = BODY_TEXT.length;

/**
 * Words paired with the index of their first character in the full string.
 *
 * Splitting to words keeps lines from breaking mid-word, while the retained
 * global character index is what drives each letter's reveal window. Derived
 * from a constant, so it's computed once at module load rather than per render.
 */
const WORDS = (() => {
  const out: { word: string; startIndex: number }[] = [];
  let cursor = 0;
  for (const word of BODY_TEXT.split(" ")) {
    out.push({ word, startIndex: cursor });
    cursor += word.length + 1; // +1 for the space that follows
  }
  return out;
})();

/**
 * One character of the scroll-revealed paragraph.
 *
 * This has to be its own component: each character needs its own
 * `useTransform`, and hooks can't be called from inside a render loop.
 */
function AnimatedLetter({
  char,
  index,
  totalChars,
  progress,
}: {
  char: string;
  index: number;
  totalChars: number;
  progress: MotionValue<number>;
}) {
  // Each character brightens over a narrow window of the parent's scroll
  // progress, and those windows overlap — the overlap is what makes the reveal
  // read as a wipe rather than characters flicking on one at a time.
  const charProgress = index / totalChars;
  const opacity = useTransform(
    progress,
    [charProgress - 0.1, charProgress + 0.05],
    [0.2, 1],
  );

  return <motion.span style={{ opacity }}>{char}</motion.span>;
}

export function About() {
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: paragraphRef,
    offset: ["start 0.8", "end 0.2"],
  });

  // Horizontal padding matches the hero's inset so the dark card lines up with
  // the video card above it rather than pinching inward on wide screens.
  return (
    <section id="about" className="bg-black px-4 py-20 md:px-6 md:py-28">
      <div className="mx-auto w-full max-w-[1920px] rounded-2xl bg-[#101010] px-6 py-16 text-center sm:px-10 md:rounded-[2rem] md:py-24">
        <p className="text-[10px] uppercase tracking-[0.2em] text-cream sm:text-xs">
          Autonomous work
        </p>

        <h2 className="mx-auto mt-8 max-w-3xl text-3xl leading-[0.95] text-cream sm:text-4xl sm:leading-[0.9] md:text-5xl lg:text-6xl xl:text-7xl">
          <WordsPullUpMultiStyle
            segments={[
              { text: "This is an agent,", className: "font-normal" },
              { text: "not another inbox.", className: "font-serif italic" },
              {
                text: "It reads, recalls, schedules and drafts — then waits for your word.",
                className: "font-normal",
              },
            ]}
          />
        </h2>

        <p
          ref={paragraphRef}
          className="mx-auto mt-10 max-w-2xl text-xs text-[#DEDBC8] sm:text-sm md:mt-14 md:text-base"
        >
          {WORDS.map(({ word, startIndex }, wordIndex) => (
            <Fragment key={`${word}-${wordIndex}`}>
              <span className="inline-block">
                {word.split("").map((char, i) => (
                  <AnimatedLetter
                    key={i}
                    char={char}
                    index={startIndex + i}
                    totalChars={TOTAL_CHARS}
                    progress={scrollYProgress}
                  />
                ))}
              </span>
              {/* The separating space sits outside the inline-block word, so the
                  browser still has somewhere to break the line. */}
              {wordIndex < WORDS.length - 1 && (
                <AnimatedLetter
                  char=" "
                  index={startIndex + word.length}
                  totalChars={TOTAL_CHARS}
                  progress={scrollYProgress}
                />
              )}
            </Fragment>
          ))}
        </p>
      </div>
    </section>
  );
}
