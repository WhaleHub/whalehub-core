const WhitelistBanner = () => (
  <div
    className="fixed top-0 left-0 right-0 z-40 w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-200 text-center text-[18px] leading-[26px] px-[24px] py-[30px] font-inter backdrop-blur-[6px]"
    role="status"
  >
    <span className="font-semibold">Rewards temporarily paused.</span>{" "}
    The <span className="font-semibold">BLUB–AQUA pool</span> is awaiting{" "}
    <a
      href="https://aqua.network/asset-registry/"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-amber-100"
    >
      whitelist approval
    </a>{" "}
    from the Aquarius team. Reward distribution will resume automatically once
    the pool is re-approved.{" "}
    <span className="font-semibold">More updates coming soon.</span>
  </div>
);

export default WhitelistBanner;
