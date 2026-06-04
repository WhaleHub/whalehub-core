import { useEffect, useRef } from "react";

// Publishes its rendered height as `--banner-h` on the document root so the
// fixed Navbar and main padding sit below it regardless of how many lines the
// copy wraps to on narrow viewports.
const WhitelistBanner = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty(
        "--banner-h",
        `${el.offsetHeight}px`,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--banner-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 right-0 z-40 w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-200 text-center text-[12px] leading-[16px] sm:text-[16px] sm:leading-[22px] px-[12px] sm:px-[24px] py-[10px] sm:py-[24px] font-inter backdrop-blur-[6px]"
      role="status"
    >
      <span className="font-semibold">Rewards temporarily paused</span> due to
      the{" "}
      <a
        href="https://aqua.network/asset-registry/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-amber-100"
      >
        Aquarius asset whitelisting proposal
      </a>{" "}
      now in effect. Distribution resumes once BLUB is approved and emissions
      return to the AQUA–BLUB pool.{" "}
      <span className="font-semibold">Your stake is safe. Updates soon.</span>
    </div>
  );
};

export default WhitelistBanner;
