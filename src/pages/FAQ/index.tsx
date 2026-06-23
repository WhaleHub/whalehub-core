import { useState } from "react";

const faqData = [
  {
    section: "The Basics",
    id: "basics",
    items: [
      {
        q: "What is WhaleHub?",
        a: "WhaleHub is a yield optimization protocol on Stellar. You deposit AQUA, the protocol pools it with every other depositor's AQUA, and that combined position is used to earn the highest possible returns from the Aquarius liquidity network. Everything runs on Soroban smart contracts on Stellar mainnet.\n\nThe simplest real-world analogy is a professionally managed investment fund. You hand over capital, the fund deploys it across strategies most individuals can't efficiently access on their own, and you earn a share of the results. The difference here is that it's fully on-chain, non-custodial, and verifiable in real time.\n\nCrypto-native analogy: WhaleHub is to Stellar what Convex is to Ethereum's Curve ecosystem. Same pattern, same purpose.",
      },
      {
        q: "Who is WhaleHub for?",
        a: "Anyone holding AQUA who wants meaningful yield without doing the manual work themselves. Managing a competitive AQUA position yourself means locking tokens for up to 3 years, voting every epoch, tracking bribe markets, and re-locking as ICE decays. WhaleHub does all of that for you at scale.\n\nIf you'd rather spend zero hours on your AQUA position and still earn an amplified rate, you're the target user.",
      },
      {
        q: "Is WhaleHub live?",
        a: "Yes. The staking contract has been through multiple on-chain upgrades. The protocol is actively managing an ICE position, voting every epoch, and auto-compounding rewards to stakers 24 times a day.",
      },
      {
        q: "How do I start?",
        a: "1. Open app.whalehub.io\n2. Connect your wallet (Freighter, LOBSTR, or WalletConnect)\n3. Deposit AQUA\n4. Receive BLUB 1:1\n5. Stake BLUB to earn yield, or hold it liquid\n\nThe protocol handles everything after the deposit: ICE locking, voting, reward claiming, and compounding.",
      },
      {
        q: "Is there a minimum deposit?",
        a: "No hard minimum on the protocol side. Stellar has a small XLM reserve requirement per trustline (roughly 0.5 XLM per asset), so you'll want enough XLM in your wallet to cover network reserves plus transaction fees.",
      },
      {
        q: "What does WhaleHub cost?",
        a: "Two fee tiers depending on what you do with your AQUA:\n\n• Stake BLUB to earn POL yield: 70% to stakers, 30% to the protocol treasury.\n• Deposit into Vaults: 85% auto-compounded back into your LP position, 15% to treasury.\n\nThe treasury share is reinvested to grow the ICE position and buy BLUB from the open market. Both ultimately benefit users: a bigger ICE position means a larger share of future rewards, and treasury buys create ongoing demand for BLUB. There are no separate deposit fees, withdrawal fees, or subscription fees.",
      },
    ],
  },
  {
    section: "The BLUB Token",
    id: "blub",
    items: [
      {
        q: "What is BLUB?",
        a: "BLUB is WhaleHub's liquid staking token. When you deposit AQUA, you receive BLUB at a 1:1 ratio. BLUB represents your share of the protocol's yield-generating position.\n\nClosest precedents: stETH (Lido) on Ethereum, rETH (Rocket Pool), cvxCRV (Convex). Liquid staking tokens that you can hold, trade, or stake elsewhere while the underlying position does the work.",
      },
      {
        q: "What's the difference between holding AQUA and holding BLUB?",
        a: "AQUA on its own earns nothing unless you personally lock it into ICE, vote every epoch, and manually claim rewards. BLUB is AQUA already put to work. Holding BLUB gives you access to the pooled yield WhaleHub generates without any manual management on your part.",
      },
      {
        q: "Why 1:1? Does the exchange rate drift?",
        a: "BLUB mints 1:1 when you deposit AQUA, and that ratio stays fixed. Yield is distributed to stakers separately rather than accumulating inside the token's redemption value. This is a design choice: it keeps BLUB straightforward to account for, trade, and integrate elsewhere.",
      },
      {
        q: "Can I redeem BLUB back for AQUA at 1:1?",
        a: "No. 90% of the AQUA you deposit is committed to ICE governance to generate the yield. There's no native redemption path, and that's by design.\n\nThis is how every productive liquid staking token works. You can't directly redeem cvxCRV for CRV. The underlying CRV is vote-locked forever. The exit is always the open market.\n\nFor BLUB, you exit via the AQUA/BLUB pool on Aquarius AMM, or via LOBSTR, or via Stellar's DEX. The peg holds because of three things working together: protocol-owned liquidity, constant treasury buying pressure, and real yield that makes BLUB worth accumulating.",
      },
      {
        q: "What if BLUB trades below AQUA on the market?",
        a: "Three mechanisms push the peg back toward 1:1:\n\n1. Protocol-owned liquidity in the AQUA/BLUB pool provides deep, permanent backstop liquidity. This liquidity is never pulled.\n2. Treasury earnings (30% of all earned AQUA) are used to buy BLUB from the open market, creating a constant bid.\n3. Real staking yield makes BLUB an accumulating asset, not a pass-through. Holders are incentivized to stake and earn rather than dump.",
      },
      {
        q: "Is BLUB the same whether I staked AQUA or bought it on the market?",
        a: "Yes, identical. BLUB is fully fungible. Whether you acquired it by depositing AQUA or by buying it on the DEX, you can stake it, earn yield, and exit the same way. There is no second class of BLUB.",
      },
      {
        q: "Can I hold BLUB without staking?",
        a: "Yes. Unstaked BLUB is fully liquid. You can trade it, transfer it, or hold it. Yield only accrues to BLUB that's actively staked in the WhaleHub staking contract.",
      },
    ],
  },
  {
    section: "How Yield Works",
    id: "yield",
    items: [
      {
        q: "Where does the yield actually come from?",
        a: "Three real sources, all earned from actual protocol activity:\n\n1. ICE voting rewards. The protocol's ICE position earns AQUA rewards every epoch for directing votes to liquidity pools. Because we lock at maximum duration, we get the full 10x voting multiplier, meaning our share of the reward pool is outsized relative to our AQUA position.\n\n2. Bribe revenue. Projects that want their pools to rank higher in the Aquarius reward zone pay bribes to ICE holders. WhaleHub aggregates these bribes and routes the proceeds to stakers.\n\n3. Protocol-owned liquidity. The 10% of every deposit that enters the AQUA/BLUB pool earns swap fees and additional AQUA rewards.\n\nNo token emissions. No inflationary printing. Yield is earned, not manufactured.",
      },
      {
        q: "How often is yield distributed?",
        a: "Auto-compounding runs 24 times per day, every hour. You don't need to claim, restake, or do anything manually. Rewards get reinvested into your position before you'd even notice they arrived, which is why the effective (compounded) APY is meaningfully higher than the base APY.",
      },
      {
        q: "How is the yield split?",
        a: "Stakers receive 70% of POL yield (30% to treasury). Vault depositors receive 85% auto-compounded (15% to treasury).",
      },
      {
        q: "Is the APY guaranteed?",
        a: "No. APY is a function of total ICE in circulation, voting participation, bribe market health, and pool performance. It moves with market conditions. We publish live APY figures in the app rather than promising fixed rates, because honest DeFi yield is variable yield.",
      },
      {
        q: "Why is the effective APY higher than the base APY?",
        a: "Compounding frequency. A rate that compounds 24 times a day produces materially higher returns over a year than the same rate claimed once a month. WhaleHub's automation captures this compounding advantage for every staker, regardless of position size. A solo staker would have to pay gas to claim and redeploy that often, which would eat the benefit. The pooled model makes it economical for everyone.",
      },
      {
        q: "Is WhaleHub's yield sustainable?",
        a: "Yes. It comes from real economic activity: governance reward distributions, bribe market payments, and trading fees. None of it is emissions-based or dependent on new deposits to pay old ones.",
      },
    ],
  },
  {
    section: "Security, Custody, and Risk",
    id: "security",
    items: [
      {
        q: "Is WhaleHub custodial?",
        a: "No. WhaleHub is fully non-custodial. Every user deposit lives in a Soroban smart contract on Stellar mainnet. You can verify the contract address and balances on stellar.expert at any time. No team member can unilaterally move user funds.",
      },
      {
        q: "Who controls the contract?",
        a: "The contract uses a split admin/manager multisig architecture. Critical operations (upgrades, parameter changes) require multiple signatures. No single key can change core logic, drain funds, or pause the protocol unilaterally.",
      },
      {
        q: "What are the main risks?",
        a: "Honest list, in order of priority:\n\n1. Smart contract risk. The code has been in production through multiple upgrade cycles, but all smart contracts carry residual risk.\n2. Aquarius dependency. Yield depends on Aquarius continuing to operate, distribute rewards, and maintain reward zone mechanics.\n3. Peg risk. BLUB's market price can deviate from AQUA in stressed market conditions, though POL and treasury buying work to stabilize it.\n4. AQUA token risk. BLUB's underlying value is tied to AQUA. If AQUA's price or utility collapses, BLUB tracks down with it.\n5. Soroban ecosystem risk. As a newer smart contract platform, Soroban carries some platform-level maturity risk compared to more battle-tested environments.\n\nIf anyone is telling you a DeFi protocol has no risk, they're either lying or confused. We list these up front because that's how responsible DeFi operates.",
      },
      {
        q: "Is my wallet safe?",
        a: "WhaleHub never asks for your private keys or seed phrase. The app only requests transaction signatures through your wallet extension. Anyone asking for your seed phrase is a scammer, full stop.",
      },
      {
        q: "Is my data private?",
        a: "On-chain activity on Stellar is public, like every public blockchain. WhaleHub doesn't collect off-chain identifying data beyond what's needed for the app to function. We don't sell user data, we don't track off-chain behavior, we don't run analytics on individual wallets.",
      },
    ],
  },
  {
    section: "Staking and Unstaking",
    id: "staking",
    items: [
      {
        q: "How do I stake BLUB?",
        a: "In the app, go to the staking section, enter the amount, and confirm the transaction in your wallet. Staked BLUB starts earning yield immediately.",
      },
      {
        q: "What's the minimum lock period after staking?",
        a: "7 days from the time of staking. Before 7 days elapse, you can't begin the unstake process.",
      },
      {
        q: "How do I unstake?",
        a: "After the 7-day minimum has elapsed, initiate an unstake in the app. There's then a 10-day cooldown before the tokens become withdrawable. Once the cooldown completes, you claim your BLUB back to your wallet.",
      },
      {
        q: "Why is there a cooldown at all?",
        a: "90% of your deposit's economic backing sits in ICE locks at maximum duration. The protocol needs predictability in how much BLUB is committed versus preparing to exit, so the cooldown prevents mass exits from destabilizing pool dynamics and voting positioning.\n\nReal-world analogy: a notice-period savings account. You agree to give notice before withdrawing so the institution can manage liquidity on their side. The yield compensation is higher than an instant-access account because of that predictability.",
      },
      {
        q: "Can I sell BLUB immediately without waiting for the unstake cooldown?",
        a: "Yes. If you haven't staked, BLUB is fully liquid. You can trade it on the AQUA/BLUB pool or via LOBSTR at any time. The cooldown only applies when you're exiting a staked position. If you need immediate liquidity, the market path is always open.",
      },
      {
        q: "How often can I claim rewards?",
        a: "There's a 7-day cooldown between reward claims and a cap of 100K BLUB per claim call. For typical position sizes, this is invisible. Very large positions may spread claims across multiple transactions.",
      },
      {
        q: "Can I stake more BLUB on top of an existing position?",
        a: "Yes. Additional stakes add to your position without resetting any existing timers on already-staked tokens. Each stake has its own 7-day minimum lock from the time it was added.",
      },
    ],
  },
  {
    section: "Vaults and Liquidity",
    id: "vaults",
    items: [
      {
        q: "What is a vault?",
        a: "A vault is WhaleHub's auto-compounding liquidity wrapper. You deposit a token pair into an Aquarius AMM pool through WhaleHub, and instead of earning static fees and rewards that sit unclaimed, the vault automatically harvests and reinvests those earnings 24 times every day, every hour, around the clock.\n\nThe underlying pool is on Aquarius. The difference is everything that happens after your initial deposit: claiming, swapping, and redepositing runs automatically without you doing anything or paying gas.",
      },
      {
        q: "What vaults are currently available?",
        a: "Currently one vault: BLUB-AQUA (StableSwap pool). More vaults are coming soon. Additional Stellar AMM pairs are actively being evaluated and will be added as the protocol expands.",
      },
      {
        q: "What's the difference between staking BLUB and depositing into the AQUA/BLUB vault?",
        a: "Two separate products with different mechanics and risk profiles:\n\nBLUB Staking: You deposit BLUB into the staking contract. You earn yield from ICE rewards, bribes, and POL fees. No impermanent loss exposure. Your principal is denominated in BLUB.\n\nAQUA/BLUB Vault: You deposit into the AMM pool. You earn swap fees plus AQUA pool rewards, auto-compounded 24x daily. This is LP exposure, so it carries impermanent loss dynamics.\n\nStaking is simpler with no LP exposure. Vault LPing typically produces higher headline yield in exchange for carrying pool dynamics.",
      },
      {
        q: "Why use WhaleHub vaults instead of providing liquidity directly on Aquarius?",
        a: "Two layers: compounding mechanics and structural advantages.\n\nCompounding math:\nThe base APY shown on Aquarius represents what you'd earn if you claimed rewards once at the end of the year. WhaleHub reinvests those rewards 24 times per day. The same pool, the same rewards, but the reinvestment frequency multiplies your effective return significantly:\n\n• 20% base APY → 22.1% with WhaleHub (manual)\n• 50% base APY → 64.8% with WhaleHub vs 50% manual (+14.8%)\n• 100% base APY → 171.5% with WhaleHub vs 100% manual (+71.5%)\n• 150% base APY → 348.3% with WhaleHub vs 150% manual (+198.3%)\n\nThe gap widens dramatically as base rates increase. On high-APY pools, WhaleHub can more than double the effective return compared to leaving rewards unclaimed.\n\nWhy you can't just compound manually:\nEach compound cycle is 3-4 Stellar transactions: claim, swap, deposit. Doing this 24 times per day would cost real transaction fees and your time. WhaleHub's pooled model makes it economical for every depositor regardless of size, because the cost is shared across all vault participants.\n\nStructural advantages:\n• Rewards don't sit unclaimed between manual sessions. They're reinvested every hour, every day, including nights and weekends.\n• Single-asset entry supported: deposit just AQUA or just BLUB and the vault handles the internal swap.\n• No operational overhead: no monitoring, no timing, no multi-step manual transactions.\n• Even after the 30% protocol fee, the compounding advantage puts you materially ahead of manual LP on active pools.",
      },
      {
        q: "The compounding formula, if you want the math",
        a: "Compounded APY = (1 + base_rate / 17,520)^17,520 − 1\n\nWhere 17,520 = 48 compounds per day × 365 days\n\nExample: A 100% base APY pool: (1 + 1.0 / 17,520)^17,520 − 1 = 1.715 = 171.5%\n\nThat extra 71.5% is not from a higher base rate. It's purely from reinvestment frequency. Same pool, same rewards, same market. Only the compounding frequency changes.",
      },
      {
        q: "What is impermanent loss?",
        a: "When you provide liquidity to a pool, your position rebalances as the two asset prices diverge. If AQUA moves significantly against BLUB, your pool position can end up worth less than if you'd held both tokens separately. This is impermanent loss, standard LP risk across all AMMs, including WhaleHub vaults.\n\nReal-world analogy: LPing is like being a market maker on a currency pair. You profit from trading volume (fees) but bear the risk that the exchange rate moves against your inventory.",
      },
      {
        q: "How is impermanent loss offset?",
        a: "Swap fees and AQUA rewards flow continuously to LPs. For pairs with healthy trading volume and reward distribution, fee and reward income typically more than covers impermanent loss over reasonable time horizons. That said, impermanent loss can still outweigh earnings in extreme divergence scenarios. Know the risk before you deposit.",
      },
      {
        q: "Can I deposit into the vault with just AQUA or just BLUB?",
        a: "Yes. Single-sided deposits are supported. The protocol handles the internal swap to balance the pair.",
      },
      {
        q: "Is there a lock period on vaults?",
        a: "No. Vault deposits can be withdrawn at any time with no withdrawal fee and no cooldown. You receive both tokens in the current pool ratio.",
      },
      {
        q: "Does my direct aqua.network LP position show up in the WhaleHub app?",
        a: "No. The app only shows positions held inside WhaleHub contracts. If you want to move existing LP into the WhaleHub vault, withdraw from aqua.network first, then deposit via the WhaleHub app.",
      },
    ],
  },
  {
    section: "ICE, Voting, and Governance",
    id: "ice",
    items: [
      {
        q: "What is ICE?",
        a: "ICE is Aquarius's governance token. You acquire ICE by locking AQUA, with more ICE granted for longer locks. ICE is used to vote on which liquidity pools earn AQUA rewards each epoch, and voting power scales with your ICE holdings.",
      },
      {
        q: "Why does lock duration matter?",
        a: "Longer locks produce more ICE per AQUA locked. A 5-year lock (the maximum on Aquarius) gives the full 10x voting multiplier. Short locks produce proportionally less ICE. WhaleHub locks at maximum duration every time, which is the entire reason our voting weight is disproportionately large for the AQUA we hold.",
      },
      {
        q: "Does ICE ever unlock?",
        a: "ICE decays over time. As the unlock date approaches, the ICE boost degrades. WhaleHub re-locks before decay matters, maintaining maximum-duration positions on a continuous basis. From the protocol's perspective, the AQUA is effectively committed indefinitely, always at peak boost.",
      },
      {
        q: "Does WhaleHub vote responsibly?",
        a: "Votes are directed to support the AQUA/BLUB pool's place in the reward zone. This is directly aligned with staker interests: more rewards flowing to the AQUA/BLUB pool means more AQUA earned by the protocol, which means more yield distributed to BLUB stakers.",
      },
      {
        q: "Can WhaleHub vote against my interests?",
        a: "The protocol's economic structure makes misaligned voting self-defeating. Voting for anything other than AQUA/BLUB pool support would reduce WhaleHub's own revenue and stakers' yield. The incentives are tightly aligned with staker outcomes by design.",
      },
    ],
  },
  {
    section: "Technical Details",
    id: "technical",
    items: [
      {
        q: "What smart contract platform does WhaleHub use?",
        a: "Soroban, Stellar's Rust-based smart contract runtime. Contracts compile to WASM and run natively on Stellar mainnet. The staking contract has been through multiple production upgrades using Stellar's on-chain WASM upgrade mechanism with multisig authorization.",
      },
      {
        q: "What wallets are supported?",
        a: "Freighter, LOBSTR, and WalletConnect. These cover the major Stellar wallet providers. Hardware wallet support is available through the wallets themselves (Ledger integration through Freighter, for example).",
      },
      {
        q: "What are the transaction fees?",
        a: "Stellar transactions are extremely cheap, typically a fraction of a cent per operation. This is one of the reasons Stellar works well for auto-compounding strategies that would be uneconomic on high-fee chains.",
      },
      {
        q: "How is the protocol upgraded?",
        a: "Contract upgrades require multisig authorization and are executed on-chain. Every upgrade is publicly recorded and verifiable.",
      },
      {
        q: "Can BLUB be used in other DeFi protocols?",
        a: "Yes. BLUB is a standard Stellar asset. It can be traded on Stellar DEX, used in AMM pools on Aquarius, and integrated into other Stellar DeFi protocols.",
      },
    ],
  },
  {
    section: "Ecosystem and Listings",
    id: "ecosystem",
    items: [
      {
        q: "Is WhaleHub affiliated with Aquarius?",
        a: "WhaleHub is an independent third-party protocol that integrates with the Aquarius AMM and ICE governance system. Not operated by the Aquarius team.",
      },
      {
        q: "Is WhaleHub affiliated with Stellar Development Foundation (SDF)?",
        a: "WhaleHub is an independent project building on Stellar, pursuing SCF Build Award funding, but operated independently.",
      },
      {
        q: "Where can I trade BLUB?",
        a: "Primary liquidity is the AQUA/BLUB pool on Aquarius AMM. BLUB is also tradeable via LOBSTR (which routes through Aquarius and Stellar Classic DEX) and directly on Stellar's on-chain DEX.",
      },
      {
        q: "How can I follow WhaleHub updates?",
        a: "Telegram: t.me/whalehubdefidefi\nX/Twitter: @whalehubdefi\nEmail: contact@whalehub.io",
      },
      {
        q: "How do I propose a partnership or integration?",
        a: "Reach out on Telegram or email. Be specific about what you're proposing. Protocol integrations that benefit BLUB holders and expand Stellar DeFi composability are actively welcomed.",
      },
    ],
  },
  {
    section: "Troubleshooting",
    id: "troubleshooting",
    items: [
      {
        q: "My AQUA or BLUB balance in the app isn't updating. What's going on?",
        a: "The app reads balance data from the Stellar network. Occasionally there can be a brief delay between a transaction confirming and the new balance appearing in the UI. Refreshing the page usually resolves it. If the issue persists after a hard refresh and cache clear, message us on Telegram with your wallet address and we'll investigate.",
      },
      {
        q: "My transaction is failing. Why?",
        a: "Most common causes, in order:\n\n1. Not enough XLM for fees and reserves. Stellar requires a small XLM balance to cover transaction fees and per-trustline reserves.\n2. Missing trustline. Stellar requires you to explicitly trust an asset before holding it. If you're receiving BLUB for the first time, add the BLUB trustline in your wallet.\n3. Insufficient balance. Your usable balance is your total balance minus Stellar's reserve requirements. Make sure you're not trying to send more than your spendable amount.\n4. Slippage. In vault or swap operations, extreme price moves during signing can cause transactions to fail. Try again with slightly higher slippage tolerance.",
      },
      {
        q: "I deposited but don't see my BLUB. What happened?",
        a: "Check that BLUB has a trustline set in your wallet. Stellar requires assets to be explicitly trusted before they can be held. Once the trustline is added, BLUB should appear.",
      },
      {
        q: "The app is slow or not loading. What can I do?",
        a: "Try a hard refresh (Ctrl+Shift+R or Cmd+Shift+R). Clear browser cache for app.whalehub.io. Try a different browser. If the problem persists, message us on Telegram so we can check for any ongoing issues.",
      },
      {
        q: "I found a bug. How do I report it?",
        a: "Telegram is fastest: t.me/whalehubdefi. Include:\n• What you did (step by step)\n• What you expected to happen\n• What actually happened\n• Your wallet address (if balance-related)\n• Browser, OS, and any error messages\n\nGenuine bug reports get priority, especially from power users. We'll get back to you quickly.",
      },
      {
        q: "My question isn't here.",
        a: "Drop it in Telegram: t.me/whalehubdefi. We add new questions to this FAQ as they come up.",
      },
    ],
  },
];

const AccordionItem = ({
  q,
  a,
  isOpen,
  onToggle,
}: {
  q: string;
  a: string;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  return (
    <div className="border-b border-[#2a2a3a]">
      <button
        onClick={onToggle}
        className="w-full flex justify-between items-start gap-4 py-4 text-left hover:text-[#00CC99] transition-colors duration-150"
      >
        <span className="text-[15px] font-medium leading-snug">{q}</span>
        <span className="text-[#00CC99] text-xl mt-0.5 shrink-0 select-none">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      {isOpen && (
        <div className="pb-5 pr-8">
          {a.split("\n").map((line, i) =>
            line.trim() === "" ? (
              <div key={i} className="h-3" />
            ) : (
              <p key={i} className="text-[#B1B3B8] text-[14px] leading-relaxed">
                {line}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
};

const FAQ = () => {
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => {
    setOpenItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="w-full mt-[56px] md:mt-[64px] px-[10.5px]">
      <div className="max-w-[800px] mx-auto py-12">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">FAQ</h1>
        <p className="text-[#B1B3B8] mb-10 text-sm">
          Last updated: April 2026. If your question isn't here, ask in{" "}
          <a
            href="https://t.me/whalehubdefi"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00CC99] hover:underline"
          >
            Telegram
          </a>{" "}
          and we'll add it.
        </p>

        {/* Table of contents */}
        <div className="bg-[#0f1117] border border-[#2a2a3a] rounded-xl p-5 mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#B1B3B8] mb-3">
            Contents
          </p>
          <div className="flex flex-col gap-2">
            {faqData.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="text-[14px] text-[#E1E3E8] hover:text-[#00CC99] transition-colors"
              >
                {section.section}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-12">
          {faqData.map((section) => (
            <div key={section.id} id={section.id}>
              <h2 className="text-lg font-semibold text-[#00CC99] mb-1 pb-3 border-b border-[#2a2a3a]">
                {section.section}
              </h2>
              <div>
                {section.items.map((item, i) => {
                  const key = `${section.id}-${i}`;
                  return (
                    <AccordionItem
                      key={key}
                      q={item.q}
                      a={item.a}
                      isOpen={!!openItems[key]}
                      onToggle={() => toggle(key)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[#B1B3B8] text-xs mt-14 pt-6 border-t border-[#2a2a3a]">
          WhaleHub is live on Stellar mainnet. Nothing in this document
          constitutes financial advice. Understand what you're holding before
          you deposit.
        </p>
      </div>
    </div>
  );
};

export default FAQ;
