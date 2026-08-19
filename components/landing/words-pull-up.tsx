"use client";

import { Fragment, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The landing page's signature entrance: text arrives word by word, each one
 * sliding up from below with a fixed stagger.
 *
 * Both exports here share that motion. They differ only in how much styling
 * granularity the caller needs — a single class for the whole string, or one
 * class per segment while keeping the stagger continuous across segments.
 */

const STAGGER_SECONDS = 0.08;

const pullUpTransition = (index: number) => ({
  duration: 0.5,
  delay: index * STAGGER_SECONDS,
  ease: [0.16, 1, 0.3, 1] as const,
});

type WordsPullUpProps = {
  text: string;
  className?: string;
  /**
   * Renders a superscript asterisk hanging off the final character, as on the
   * hero wordmark. The last character is split into its own relatively
   * positioned span so the asterisk can be placed against it rather than
   * against the whole word.
   */
  showAsterisk?: boolean;
};

export function WordsPullUp({
  text,
  className,
  showAsterisk = false,
}: WordsPullUpProps) {
  const words = text.split(" ");
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  return (
    <span ref={ref} className={cn("inline-flex flex-wrap", className)}>
      {words.map((word, index) => {
        const isLastWord = index === words.length - 1;
        const decorate = showAsterisk && isLastWord && word.length > 0;

        return (
          <motion.span
            key={`${word}-${index}`}
            initial={{ y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
            transition={pullUpTransition(index)}
            className="inline-block"
          >
            {decorate ? (
              <>
                {word.slice(0, -1)}
                <span className="relative inline-block">
                  {word.slice(-1)}
                  <span
                    aria-hidden="true"
                    className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]"
                  >
                    *
                  </span>
                </span>
              </>
            ) : (
              word
            )}
            {/* Trailing space kept inside the span so wrapping stays natural. */}
            {!isLastWord && <span>&nbsp;</span>}
          </motion.span>
        );
      })}
    </span>
  );
}

export type PullUpSegment = {
  text: string;
  className?: string;
  /** Force the next segment onto its own line, without restarting the stagger. */
  breakAfter?: boolean;
};

type WordsPullUpMultiStyleProps = {
  segments: PullUpSegment[];
  className?: string;
};

/**
 * Same motion, but the caller supplies styled segments. Segments are flattened
 * into a single word list up front so the stagger index runs continuously
 * across the whole heading instead of restarting at each segment.
 */
export function WordsPullUpMultiStyle({
  segments,
  className,
}: WordsPullUpMultiStyleProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  const words = segments.flatMap((segment) => {
    const segmentWords = segment.text.split(" ").filter(Boolean);
    return segmentWords.map((word, i) => ({
      word,
      className: segment.className,
      breakAfter: segment.breakAfter === true && i === segmentWords.length - 1,
    }));
  });

  return (
    <span
      ref={ref}
      className={cn("inline-flex flex-wrap justify-center", className)}
    >
      {words.map((item, index) => (
        <Fragment key={`${item.word}-${index}`}>
          <motion.span
            initial={{ y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
            transition={pullUpTransition(index)}
            className={cn("inline-block", item.className)}
          >
            {item.word}
            {index < words.length - 1 && <span>&nbsp;</span>}
          </motion.span>
          {/* A full-basis, zero-height item forces a wrap in the flex row. */}
          {item.breakAfter && <span aria-hidden="true" className="h-0 basis-full" />}
        </Fragment>
      ))}
    </span>
  );
}
