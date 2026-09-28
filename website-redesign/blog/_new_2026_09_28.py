#!/usr/bin/env python3
"""Two Stellar news articles, 28 Sep 2026: Blend's 2026 incidents, and borrowing
against Aquarius LP tokens. Run from this directory: python3 _new_2026_09_28.py"""

from _build_article import build, make_cover

DATE = "2026-09-28"
DISCLAIMER = ("This article is for education only and is not financial advice. Figures are taken from the "
              "sources linked in the text as of the date shown and change constantly. Verify them before acting.")

# ---------------------------------------------------------------------------
blend = {
    "slug": "blend-exploits-2026",
    "date": DATE,
    "title": "Blend's 2026 Incidents: YieldBlox and the Comet Backstop, Explained",
    "card_title": "Blend's 2026 Incidents, Explained",
    "card_blurb": "Two losses, two different layers of the stack: an isolated pool's oracle in February and the backstop AMM in August. What happened, what it did not touch, and what to check.",
    "description": "What happened in Blend's two 2026 incidents — the $10M YieldBlox oracle exploit and the $717K Comet backstop exploit — which layer failed, what was not affected, and what users should check.",
    "keywords": "blend exploit, yieldblox exploit, blend hack, comet backstop exploit, blend protocol stellar, stellar defi security",
    "category": "Stellar DeFi",
    "read": 8,
    "alt": "Blend's 2026 incidents explained: YieldBlox oracle exploit and Comet backstop exploit",
    "cta_h": "Yield on Stellar, with the risks written down",
    "cta_p": "WhaleHub stakes AQUA, aggregates ICE voting power and auto-compounds Aquarius rewards — and publishes how each part can fail.",
    "disclaimer": DISCLAIMER,
    "related": [("blend-protocol-stellar", "What Is Blend?"),
                ("defi-risks", "DeFi Risks: The Nine That Cost Money"),
                ("smart-contract-audits", "Smart Contract Audits")],
    "inbound": ["blend-protocol-stellar", "defi-risks", "smart-contract-audits", "stellar-defi-guide"],
    "faqs": [
        ("Was Blend hacked in 2026?",
         "Two incidents touched the Blend ecosystem in 2026, but neither was a flaw in Blend V2's pool contracts. In February an attacker manipulated the price feed for one collateral asset in the community-run YieldBlox pool and borrowed about $10M against it. In August a bug in the Comet AMM that holds Blend's backstop deposits was exploited for about $717K."),
        ("Were Blend deposits lost in the Comet exploit?",
         "The loss was in the Comet BLND-USDC pool, which holds backstop deposits, not in Blend's lending pools. Blend paused its backstop in response. DefiLlama shows Blend's lending pools holding roughly $150–165M before and after the incident, which contradicts reports that Blend's TVL fell to near zero."),
        ("What caused the YieldBlox exploit?",
         "The pool accepted USTRY as collateral and priced it from a Reflector feed that sourced from a very thin USTRY/USDC market on the Stellar DEX. The attacker moved that market from about $1.06 to about $107, the oracle reported the inflated price, and the attacker borrowed about 1M USDC and 61M XLM against collateral worth a fraction of that."),
        ("Is it safe to use Blend now?",
         "That depends on which pool you use. Blend pools are isolated: each has its own collateral list, oracle settings and backstop. Check how every collateral asset in the pool is priced, how deep its market is, and the current state of the backstop before depositing."),
    ],
    "body": '''
    <p class="lead">Blend is Stellar's largest lending protocol, and 2026 gave it two very different incidents: a <strong>$10M oracle manipulation in one isolated pool in February</strong>, and a <strong>$717K exploit of the AMM holding its backstop in August</strong>. Both are routinely reported as "Blend was hacked". Neither was a bug in the lending contracts, and the difference matters if you are deciding where to deposit.</p>

    <div class="callout">
      <div class="k">The short version</div>
      <p><strong>February:</strong> the community-run YieldBlox pool priced a collateral token from a market that could be moved with one trade. <strong>August:</strong> the Comet pool that holds backstop deposits had a bug in same-asset swaps. Different layers, different fixes. Blend's lending pools held roughly $150–165M throughout, per DefiLlama.</p>
    </div>

    <div class="toc">
      <div class="k">On this page</div>
      <ol>
        <li><a href="#layers">Three layers, three kinds of risk</a></li>
        <li><a href="#yieldblox">February: the YieldBlox oracle exploit</a></li>
        <li><a href="#comet">August: the Comet backstop exploit</a></li>
        <li><a href="#tvl">What the TVL numbers actually show</a></li>
        <li><a href="#check">What to check before depositing</a></li>
        <li><a href="#faq">FAQ</a></li>
      </ol>
    </div>

    <div class="prose">
      <h2 id="layers">Three layers, three kinds of risk</h2>
      <p class="answer">A Blend deposit relies on three separate things: the pool contracts that hold loans, the pool's configuration (which assets it accepts and how it prices them), and the backstop that absorbs bad debt. The 2026 incidents hit the second and third, not the first.</p>
      <p>Blend V2 is a set of <strong>isolated pools</strong>. Anyone can deploy one, choose its collateral and borrowable assets, set collateral factors and pick an oracle. Script3 wrote the contracts; pool operators such as the YieldBlox DAO run the configuration. Each pool also has a <strong>backstop</strong>: depositors lock BLND-USDC liquidity-pool tokens, earn a share of interest, and take first loss if the pool accrues bad debt. That LP token lives in a Comet weighted pool. For the full mechanics, see <a href="blend-protocol-stellar">what is Blend</a>.</p>

      <h2 id="yieldblox">February: the YieldBlox oracle exploit</h2>
      <p>On <strong>22 February 2026</strong>, an attacker drained roughly <strong>$10M</strong> from the YieldBlox pool. The pool let users borrow XLM and USDC against <strong>USTRY</strong>, a tokenised Treasury product, and priced USTRY through a Reflector feed that sourced from the USTRY/USDC market on the Stellar DEX.</p>
      <p>That market was nearly empty. According to BlockSec's analysis, the attacker cleared the normal orders and placed abnormal ones, moving USTRY from about <strong>$1.06 to about $107</strong>. The feed reported the new price, the pool valued the attacker's USTRY collateral at roughly a hundred times its worth, and the attacker borrowed about <strong>1M USDC and 61.2M XLM</strong> against it.</p>
      <p>Script3's post-mortem describes the attack as "isolated to a single asset in a single community managed pool", possible because USTRY liquidity had been temporarily removed and no other trades occurred for 15 minutes. The YieldBlox backstop was liquidated to cover bad debt, with about 4.38M BLND-USDC LP tokens (about $1.3M) auctioned.</p>
      <p>The lesson is the oldest one in DeFi lending: <strong>collateral is only as safe as the market that prices it</strong>. A lending contract can be flawless and still lend $10M against a price that one trade can set. For more on this failure class, see <a href="defi-risks">DeFi risks</a>.</p>

      <h2 id="comet">August: the Comet backstop exploit</h2>
      <p>On <strong>25 August 2026</strong>, the Comet BLND-USDC pool that holds Blend's backstop deposits was exploited for about <strong>$717K</strong>. The mechanism was a bug in <strong>same-asset swaps</strong> — swapping a token for itself — which the attacker repeated 1,459 times, according to indexers that later had to filter those swaps out of their price data. Blend paused its backstop in response.</p>
      <p>This is a different layer from February. Lending pools were not the target; the loss fell on the pool that backstop depositors hold their stake in. As of this writing we have not found an official post-mortem for the Comet incident, so treat the details above as reported rather than confirmed.</p>

      <h2 id="tvl">What the TVL numbers actually show</h2>
      <p>Several outlets reported that Blend's TVL "fell to near zero" after August. DefiLlama's own data for Blend's lending pools does not show that:</p>
      <table>
        <thead><tr><th>Date (2026)</th><th>Blend lending pools TVL</th></tr></thead>
        <tbody>
          <tr><td>22 Aug</td><td>$171.5M</td></tr>
          <tr><td>25 Aug (exploit)</td><td>$164.2M</td></tr>
          <tr><td>28 Aug</td><td>$150.9M</td></tr>
          <tr><td>10 Sep</td><td>$148.2M</td></tr>
          <tr><td>28 Sep</td><td>$158–161M</td></tr>
        </tbody>
      </table>
      <p>What did fall sharply was Stellar DeFi TVL as a whole, from about $270M to about $98M between 22 and 27 August. DefiLlama's separate "Blend Backstop" entry reads $0, but it read $0 before the exploit too, so it cannot be used to measure the incident.</p>

      <h2 id="check">What to check before depositing</h2>
      <ul>
        <li><strong>Every collateral asset's price source.</strong> A pool is exposed to its weakest collateral, not just the asset you deposit. Ask where each price comes from and how much it would cost to move that market.</li>
        <li><strong>Market depth behind the feed.</strong> A feed sourced from a thin DEX market is a feed an attacker can set.</li>
        <li><strong>Backstop status.</strong> The backstop is the first-loss layer. If it is paused or depleted, bad debt falls on lenders.</li>
        <li><strong>Who operates the pool.</strong> Contracts are shared, configuration is not. Two Blend pools can carry very different risk.</li>
        <li><strong>Audits in scope.</strong> An audit of the pool contracts says nothing about a pool's oracle choice. See <a href="smart-contract-audits">what an audit proves</a>.</li>
      </ul>

      <h2>The takeaway</h2>
      <p>Both 2026 incidents were real losses, and both happened outside the code most people mean when they say "Blend". That is not a reassurance — it is a map. Isolated pools move risk into configuration and backstops, so that is where depositors need to look.</p>
      <p class="disclaimer">Sources: BlockSec, "YieldBlox DAO incident on Stellar"; Script3 post-mortem on X (@script3official); DefiLlama (blend-pools-v2); rumblefishdev/stellar-prices-api PR #345; Bitget News and DailyCoin coverage of the August exploit.</p>
    </div>
''',
}

# ---------------------------------------------------------------------------
lpcoll = {
    "slug": "aquarius-lp-collateral",
    "date": DATE,
    "title": "Borrowing Against Aquarius LP Tokens on Stellar: Venues and Leverage Maths",
    "card_title": "Borrowing Against Aquarius LP Tokens",
    "card_blurb": "Aquarius LP shares are now accepted as collateral on Stellar. Where, on what terms, and the maths of looping an LP position before you try it.",
    "description": "Aquarius LP tokens can now be used as collateral on Stellar. Which venues accept them, the LTVs and caps, how looping works, and how far XLM can move before a levered XLM/USDC LP is liquidated.",
    "keywords": "aquarius lp collateral, borrow against lp tokens, leveraged liquidity stellar, xoxno lending stellar, leveraged yield farming stellar, aquarius lp",
    "category": "Stellar DeFi",
    "read": 9,
    "alt": "Borrowing against Aquarius LP tokens on Stellar: venues, LTVs and leverage maths",
    "cta_h": "Earn on Aquarius without managing a loop",
    "cta_p": "WhaleHub's vaults auto-compound Aquarius LP positions every 4 hours. Stake AQUA or deposit into a vault in a few clicks.",
    "disclaimer": DISCLAIMER + " Leverage can lose more than the yield it adds; a levered position can be liquidated.",
    "related": [("aquarius-concentrated-liquidity", "Aquarius Concentrated Liquidity"),
                ("impermanent-loss-explained", "Impermanent Loss, With Real Numbers"),
                ("blend-exploits-2026", "Blend's 2026 Incidents, Explained")],
    "inbound": ["aquarius-amm-explained", "aquarius-concentrated-liquidity", "stellar-yield-farming", "impermanent-loss-explained", "blend-protocol-stellar"],
    "faqs": [
        ("Can you borrow against Aquarius LP tokens?",
         "Yes. Since August 2026 XOXNO Lending on Stellar lists several Aquarius LP tokens as collateral, including XLM/USDC, XLM/AQUA and AQUA/USDC, at 50% loan-to-value. Blend V2 pools can also list an LP token as collateral if a pool operator chooses to."),
        ("How much leverage can you get on an Aquarius LP position?",
         "At a 50% loan-to-value, looping an LP position reaches at most 2x in theory. At 2x there is almost no room before liquidation, so a practical range is 1.25–1.75x, where XLM would have to rise roughly 96–800% before a levered XLM/USDC position with XLM debt is liquidated, under the assumptions in this article."),
        ("Do you still earn Aquarius rewards on LP tokens used as collateral?",
         "Aquarius rewards accrue to the address holding the LP token. When the token sits in a lending contract, whether the rewards reach you depends on that venue. Check before levering, because rewards are often a large share of an LP's yield."),
        ("What liquidates a levered XLM/USDC LP position?",
         "If the debt is in XLM, an XLM rally. The LP's value grows roughly with the square root of the XLM price while the debt grows one-for-one with it, so a sharp rally closes the gap. A falling XLM price makes this position safer."),
    ],
    "body": '''
    <p class="lead">For most of Stellar's DeFi history, an Aquarius LP token did one thing: earn fees and rewards in the wallet that held it. Since August 2026 it can also be <strong>borrowed against</strong>, which makes leveraged liquidity provision possible on Stellar for the first time. This guide covers where you can do it, on what terms, and the maths to understand before looping a position.</p>

    <div class="callout">
      <div class="k">The short version</div>
      <p>XOXNO Lending lists Aquarius LPs as collateral at <strong>50% LTV, 60% liquidation threshold</strong>, borrowing XLM, USDC, EURC or PYUSD. Looping at 50% LTV caps out at 2×, and at 2× a 44% XLM rally liquidates an XLM/USDC position with XLM debt. The useful range is well below the maximum.</p>
    </div>

    <div class="toc">
      <div class="k">On this page</div>
      <ol>
        <li><a href="#why">Why LP collateral matters</a></li>
        <li><a href="#venues">Where you can borrow against an LP today</a></li>
        <li><a href="#loop">How a leveraged LP position works</a></li>
        <li><a href="#maths">The maths: yield and liquidation</a></li>
        <li><a href="#check">Questions to ask before looping</a></li>
        <li><a href="#faq">FAQ</a></li>
      </ol>
    </div>

    <div class="prose">
      <h2 id="why">Why LP collateral matters</h2>
      <p class="answer">An LP token is a claim on two assets in a pool plus the fees they earn. Using it as collateral lets a liquidity provider borrow against that claim and add more liquidity, turning a fixed position into a levered one.</p>
      <p>On Ethereum and Solana this is a mature category: LP and yield-bearing tokens are routine collateral, and curated vaults run looped positions for users. On Stellar the pieces arrived separately. <a href="aquarius-amm-explained">Aquarius</a> issues transferable SEP-41 LP share tokens, and Soroban lending venues support flash loans. What was missing was a venue willing to list the LP tokens themselves.</p>

      <h2 id="venues">Where you can borrow against an LP today</h2>
      <p><strong>XOXNO Lending</strong> is the first venue on Stellar to list Aquarius LP tokens, in its mainnet configuration from August 2026. The LPs are collateral-only: you can deposit them, but nobody can borrow them. They sit in two isolated risk groups, "AMM Collateral" and "Aquarius Ecosystem":</p>
      <table>
        <thead><tr><th>Aquarius LP</th><th>Max LTV</th><th>Liquidation threshold</th><th>Liquidation bonus</th><th>Supply cap</th></tr></thead>
        <tbody>
          <tr><td>XLM/AQUA</td><td>50%</td><td>60%</td><td>10%</td><td>5,000,000 LP</td></tr>
          <tr><td>AQUA/USDC</td><td>50%</td><td>60%</td><td>10%</td><td>5,000,000 LP</td></tr>
          <tr><td>XLM/USDC</td><td>50%</td><td>60%</td><td>10%</td><td>500 LP</td></tr>
          <tr><td>PYUSD/USDC, USDY/USDC, CETES/USDC, USTRY/USDC, XAUM/USDC, XLM/SolvBTC</td><td>50%</td><td>60%</td><td>10%</td><td>200–500 LP</td></tr>
        </tbody>
      </table>
      <p>Against them you can borrow <strong>XLM, USDC, EURC or PYUSD</strong>, and XOXNO supports flash loans on those assets, which is what makes a one-transaction loop possible. Two caveats. First, the supply caps on most pairs are small, so capacity is limited today. Second, XOXNO's Stellar deployment is young and small, with roughly $74K of TVL on DefiLlama at the time of writing.</p>
      <p><strong>Blend V2</strong> can list LP tokens too, because anyone can deploy a pool with any collateral. We are not aware of a major Blend pool listing Aquarius LPs as of this writing, and Blend paused its backstop after the <a href="blend-exploits-2026">August Comet exploit</a>, so check its current status first.</p>

      <h2 id="loop">How a leveraged LP position works</h2>
      <p>Take $1,000 in an XLM/USDC LP and a target of 1.5× exposure. Done by hand, you would deposit the LP, borrow XLM, swap half to USDC, add liquidity, deposit the new LP, and repeat. Each pass adds less, costs more fees, and leaves the position exposed between steps.</p>
      <p>A flash loan does it in one transaction:</p>
      <ol>
        <li>Flash-borrow $500 of XLM.</li>
        <li>Swap half to USDC and add both to the pool, receiving about $500 of new LP.</li>
        <li>Deposit all $1,500 of LP as collateral.</li>
        <li>Borrow $500 of XLM against it and repay the flash loan.</li>
      </ol>
      <p>You end with $1,500 of LP exposure and $500 of XLM debt, and the venue checks health once, at the end. This is the pattern XOXNO's "multiply" feature and WhaleHub's leverage vault (in testnet development) both use.</p>

      <h2 id="maths">The maths: yield and liquidation</h2>
      <p><strong>Yield.</strong> At leverage <em>L</em>, return on your equity is the LP yield on the whole position minus interest on the borrowed part:</p>
      <p><code>net APY = LP APY × L − borrow APR × (L − 1)</code></p>
      <p>With an LP earning 10.77% (the Aquarius XLM/USDC concentrated pool's unboosted rate in August) at 1.5×: borrowing at 0.10% nets 16.11%; at 5% it nets 13.66%; at 10.79% it nets 10.76%, the same as not levering at all. Leverage only pays while the borrow rate stays well under the LP yield, and borrow rates move with utilisation.</p>
      <p><strong>Liquidation.</strong> With XLM debt against an XLM/USDC LP, the risk is an XLM rally. In a constant-product pool the LP's value grows with the square root of the XLM price, while XLM debt grows one-for-one. With a 60% liquidation threshold, the health factor starts at <code>0.6 × L ÷ (L − 1)</code> and falls with the square root of the price move:</p>
      <table>
        <thead><tr><th>Leverage</th><th>Starting health factor</th><th>XLM rise that liquidates</th></tr></thead>
        <tbody>
          <tr><td>1.25×</td><td>3.00</td><td>+800%</td></tr>
          <tr><td>1.50×</td><td>1.80</td><td>+224%</td></tr>
          <tr><td>1.75×</td><td>1.40</td><td>+96%</td></tr>
          <tr><td>2.00× (max at 50% LTV)</td><td>1.20</td><td>+44%</td></tr>
        </tbody>
      </table>
      <p>These figures ignore interest, fees and the extra <a href="impermanent-loss-explained">impermanent loss</a> of concentrated ranges, all of which bring liquidation closer. A falling XLM price makes this position safer, because the debt shrinks faster than the collateral. Borrowing USDC instead flips that: a falling XLM becomes the risk.</p>

      <h2 id="check">Questions to ask before looping</h2>
      <ul>
        <li><strong>Do rewards still reach you?</strong> Aquarius rewards accrue to the address holding the LP token. Once it is in a lending contract, whether you still receive them depends on the venue, and rewards are often a large share of LP yield.</li>
        <li><strong>How is the LP priced?</strong> An LP priced from the pool's own spot price can be manipulated; one priced from the pool invariant and independent feeds is much harder to move. The <a href="blend-exploits-2026">YieldBlox exploit</a> shows what happens when collateral pricing is weak.</li>
        <li><strong>What is the borrow rate, and how fast can it change?</strong> Utilisation-driven rates can jump when others borrow the same asset.</li>
        <li><strong>How deep is the exit?</strong> Unwinding sells through the same Aquarius pool. A large unwind in a shallow pool moves the price against you.</li>
        <li><strong>Who watches the position?</strong> A self-managed loop has no one deleveraging it at 3am during a rally.</li>
      </ul>

      <h2>The takeaway</h2>
      <p>LP collateral is a genuine new primitive for Stellar, and the numbers make the trade clear: modest leverage, a borrow rate well below the LP yield, and a price move you can survive. The maximum leverage a venue allows is not the leverage worth using.</p>
      <p class="disclaimer">Sources: XOXNO rs-lending-xlm mainnet configuration (configs/mainnet/markets.json, spokes.json); DefiLlama; Aquarius pool data as of August 2026. Supply caps and parameters can change through XOXNO governance.</p>
    </div>
''',
}

for spec, cover in ((blend, ("Blend's 2026", "Incidents", "YieldBlox · Comet backstop · what changed", "STELLAR DEFI", 210)),
                    (lpcoll, ("Aquarius LP", "as Collateral", "Venues · LTVs · leverage maths", "STELLAR DEFI", 210))):
    ok = make_cover(spec["slug"], cover[0], cover[1], cover[2], cover[3], tag_w=cover[4])
    n = build(spec)
    print(spec["slug"], "cover", ok, "inbound links added", n)
