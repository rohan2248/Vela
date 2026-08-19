import { Hero } from "@/components/landing/hero";
import { About } from "@/components/landing/about";
import { Features } from "@/components/landing/features";

export default function Home() {
  // bg-black is scoped here rather than on <body> so the rest of the app —
  // /sign-in and the workspace to come — keeps the shadcn background.
  return (
    <main className="bg-black">
      <Hero />
      <About />
      <Features />
    </main>
  );
}
