import AddLiquidity from "./AddLiquidity";

/**
 * Vaults section — wraps AddLiquidity with a section header.
 * Extracted from Yield.tsx so the page order is Vaults → Stake → Compound,
 * with the Compound (Re-stake) block remaining in Yield.tsx.
 */
function Vaults() {
  return (
    <>
      <div id="Vault_section" className="max-w-[912px] mx-auto">
        <div className="text-white text-xl md:text-4xl-custom1 font-medium text-center">
          Provide Liquidity. Earn Extra Yield.
        </div>
        <div className="text-[#B1B3B8] text-base font-normal text-center max-w-[720px] mx-auto">
          Deposit into the AQUA-BLUB pool. Earn swap fees and rewards, auto-compounded daily.
        </div>
      </div>
      <div className="mt-10 max-w-[550px] mx-auto mb-10">
        <AddLiquidity />
      </div>
    </>
  );
}

export default Vaults;
