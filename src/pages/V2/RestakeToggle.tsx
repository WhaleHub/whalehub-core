/**
 * V2 — Auto-restaking toggle (feature 5).
 * ON  = auto-swap AQUA rewards back into BLUB stake (compounding).
 * OFF = distribute AQUA rewards to the user's wallet.
 * Persisted locally; the on-chain reward routing is wired to this preference
 * when the v2 reward flow lands.
 */
import React, { useState } from "react";

const KEY = "wh_v2_auto_restake";

const RestakeToggle: React.FC<{ onChange?: (on: boolean) => void }> = ({
  onChange,
}) => {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  const set = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    onChange?.(next);
  };

  return (
    <div className="rounded-2xl border border-[#1C2235] bg-[#151A29] p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-white font-medium">Auto-restake rewards</div>
          <div className="text-[13px] text-[#6B7280]">
            {on
              ? "AQUA rewards auto-swap into BLUB stake and compound."
              : "AQUA rewards are sent to your wallet."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => set(!on)}
          className={
            "relative w-12 h-7 rounded-full transition-colors cursor-pointer " +
            (on ? "bg-[#00cc99]" : "bg-[#2a3050]")
          }
        >
          <span
            className={
              "absolute top-1 w-5 h-5 rounded-full bg-white transition-all " +
              (on ? "left-[26px]" : "left-1")
            }
          />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div
          className={
            "rounded-lg px-3 py-2 border " +
            (on
              ? "border-[rgba(0,204,153,0.3)] text-white bg-[rgba(0,204,153,0.06)]"
              : "border-[#2a3050] text-[#6B7280]")
          }
        >
          <div className="font-medium">Compound</div>
          <div>Reinvest into BLUB stake</div>
        </div>
        <div
          className={
            "rounded-lg px-3 py-2 border " +
            (!on
              ? "border-[#2a3050] text-white bg-[#0E111B]"
              : "border-[#2a3050] text-[#6B7280]")
          }
        >
          <div className="font-medium">Payout</div>
          <div>Send AQUA to wallet</div>
        </div>
      </div>
    </div>
  );
};

export default RestakeToggle;
