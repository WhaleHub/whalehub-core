const WhitelistBanner = () => (
  <div
    className="fixed top-0 left-0 right-0 z-40 w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-200 text-center text-[16px] leading-[22px] px-[24px] py-[24px] font-inter backdrop-blur-[6px]"
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

export default WhitelistBanner;
