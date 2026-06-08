import { useCallback, useRef, useEffect } from "react";
import { useState } from "react";
import { useAppDispatch } from "../../lib/hooks";
import {
  fetchingWalletInfo,
  logOut,
  setConnectingWallet,
  setUserbalances,
  setUserWalletAddress,
  setWalletConnected,
  setWalletConnectName,
  walletSelectionAction,
} from "../../lib/slices/userSlice";
import { isAllowed, setAllowed } from "@stellar/freighter-api";
import { useSelector } from "react-redux";
import { RootState } from "../../lib/store";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { XMarkIcon, ArrowRightStartOnRectangleIcon } from "@heroicons/react/16/solid";
import { walletTypes } from "../../enums";
import { getPublicKey } from "@lobstrco/signer-extension-api";
import {
  FREIGHTER_ID,
  FreighterModule,
  ISupportedWallet,
  LOBSTR_ID,
  StellarWalletsKit,
  WalletNetwork,
  XBULL_ID,
  allowAllModules,
  xBullModule,
  StellarWalletsModal,
} from "@creit.tech/stellar-wallets-kit";
import {
  WALLET_CONNECT_ID,
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from "@creit.tech/stellar-wallets-kit/modules/walletconnect.module";
import clsx from "clsx";
import { ToastContainer, toast } from "react-toastify";
import { persistor } from "../../lib/store";
import { WALLET_NETWORK } from "../../config";
import { isMobileDevice } from "../../utils/helpers";

// Register the StellarWalletsModal web component (side-effect import)
// This is required for kit.openModal() to work
void StellarWalletsModal;

// Detect if browser is Safari (any platform) — Safari doesn't support the
// LOBSTR/Freighter browser extensions, so we route those users through WalletConnect.
const isSafariBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Chrome/Chromium/Edge report "Safari" too, so exclude them
  return /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgA|GSA/i.test(ua);
};

// Factory function to create a fresh WalletConnect kit instance
// This is needed because WalletConnect has a known bug where the modal
// won't reopen after being closed without completing a connection
// See: https://github.com/WalletConnect/walletconnect-monorepo/issues/747
const createWalletConnectKit = () => {
  return new StellarWalletsKit({
    selectedWalletId: WALLET_CONNECT_ID,
    network: WALLET_NETWORK,
    modules: [
      new WalletConnectModule({
        url: "https://app.whalehub.io",
        projectId: "3dcbb538e6a1ff9db2cdbf0b1c209a9d",
        method: WalletConnectAllowedMethods.SIGN,
        description: "WhaleHub — stake AQUA, earn BLUB rewards",
        name: "Whalehub",
        icons: ["https://app.whalehub.io/Blub_logo2.svg"],
        network: WALLET_NETWORK,
      }),
    ],
  });
};

// Global kit instance - will be recreated when needed
export let kit = createWalletConnectKit();

// Call this when the WC session is stale/dropped — creates a fresh kit
// that re-reads any surviving session from localStorage
export const reconnectWalletConnect = (): StellarWalletsKit => {
  kit = createWalletConnectKit();
  return kit;
};

const Navbar = () => {
  const dispatch = useAppDispatch();
  const user = useSelector((state: RootState) => state.user);
  const isMobile = isMobileDevice();
  const [activeSection, setActiveSection] = useState<string>("");

  useEffect(() => {
    const sectionIds = ["reward_section", "Yield_section", "Vault_section"];
    const observers: IntersectionObserver[] = [];

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(id);
        },
        { threshold: 0.3 }
      );
      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const handleWalletConnections = useCallback(
    async (walletType: walletTypes) => {
      try {
        // Reset connecting state first to ensure clean state
        dispatch(setConnectingWallet(false));
        dispatch(setConnectingWallet(true));

        const isMobile = isMobileDevice();

        if (walletType === walletTypes.FREIGHTER) {
          console.log("🌌 [Navbar] Connecting to Freighter wallet");

          // Check if on mobile - Freighter doesn't have mobile WalletConnect support yet
          if (isMobile) {
            dispatch(setConnectingWallet(false));
            toast.info(
              "Freighter mobile app doesn't support WalletConnect yet. Please use WalletConnect to connect with LOBSTR or another compatible wallet.",
              { autoClose: 5000 }
            );
            return;
          }

          const freighterKit: StellarWalletsKit = new StellarWalletsKit({
            network: WALLET_NETWORK,
            selectedWalletId: FREIGHTER_ID,
            modules: [new FreighterModule()],
          });

          const { address } = await freighterKit.getAddress();

          console.log("📍 [Navbar] Freighter address received:", {
            address: address,
            addressLength: address?.length,
            isValidFormat: address ? /^G[A-Z0-9]{55}$/.test(address) : false,
            timestamp: new Date().toISOString(),
          });

          await setAllowed();
          await isAllowed();

          dispatch(setUserWalletAddress(address));
          dispatch(setConnectingWallet(false));
          dispatch(setWalletConnectName(FREIGHTER_ID));
          dispatch(setWalletConnected(true));
          dispatch(walletSelectionAction(false));
        } else if (walletType === walletTypes.WALLETCONNECT) {
          console.log("🔗 [Navbar] Connecting to WalletConnect");

          // Create fresh kit instance to fix WalletConnect bug where modal won't reopen
          // See: https://github.com/WalletConnect/walletconnect-monorepo/issues/747
          kit = createWalletConnectKit();

          await kit.openModal({
            onWalletSelected: async (option: ISupportedWallet) => {
              console.log(
                "🔗 [Navbar] WalletConnect wallet selected:",
                option.id
              );

              kit.setWallet(option.id);
              const { address } = await kit.getAddress();

              console.log("📍 [Navbar] WalletConnect address received:", {
                address: address,
                addressLength: address?.length,
                isValidFormat: address
                  ? /^G[A-Z0-9]{55}$/.test(address)
                  : false,
                timestamp: new Date().toISOString(),
              });

              dispatch(setConnectingWallet(false));
              dispatch(setWalletConnectName(WALLET_CONNECT_ID));
              dispatch(walletSelectionAction(false));
              dispatch(setWalletConnected(true));
              dispatch(setUserWalletAddress(address));
            },
            onClosed: () => {
              console.log("🔗 [Navbar] WalletConnect modal closed");
              dispatch(setConnectingWallet(false));
            },
          });
        } else {
          console.log("🦞 [Navbar] Connecting LOBSTR wallet");

          // Helper: open LOBSTR via WalletConnect modal
          // Used on mobile AND on Safari/browsers where the extension is unavailable
          const connectLobstrViaWalletConnect = async () => {
            // Create kit BEFORE any awaits so it's triggered by the user gesture.
            // Safari blocks popup opens that occur after async operations.
            kit = createWalletConnectKit();

            await kit.openModal({
              onWalletSelected: async (option: ISupportedWallet) => {
                console.log(
                  "🔗 [Navbar] WalletConnect wallet selected for LOBSTR:",
                  option.id
                );

                kit.setWallet(option.id);
                const { address } = await kit.getAddress();

                console.log(
                  "📍 [Navbar] LOBSTR (via WalletConnect) address received:",
                  { address, timestamp: new Date().toISOString() }
                );

                dispatch(setConnectingWallet(false));
                // Use WALLET_CONNECT_ID so signing uses WalletConnect path
                dispatch(setWalletConnectName(WALLET_CONNECT_ID));
                dispatch(walletSelectionAction(false));
                dispatch(setWalletConnected(true));
                dispatch(setUserWalletAddress(address));
              },
              onClosed: () => {
                console.log("🔗 [Navbar] LOBSTR WalletConnect modal closed");
                dispatch(setConnectingWallet(false));
              },
            });
          };

          // On mobile, always use WalletConnect (LOBSTR extension is not available on mobile)
          if (isMobile) {
            console.log("📱 [Navbar] Mobile detected, using WalletConnect for LOBSTR");
            toast.info("Opening WalletConnect to connect with LOBSTR...", { autoClose: 2000 });
            await connectLobstrViaWalletConnect();
            return;
          }

          // On desktop Safari (or any browser without the LOBSTR extension),
          // redirect to WalletConnect. The LOBSTR extension only works in Chrome/Firefox.
          const safari = isSafariBrowser();
          const { isLobstrAvailable } = await import("../../utils/helpers");
          const lobstrAvail = !safari && await isLobstrAvailable();

          if (!lobstrAvail) {
            console.log("🦞 [Navbar] LOBSTR extension not available (Safari or not installed), using WalletConnect");
            toast.info(
              safari
                ? "LOBSTR extension is not available on Safari. Connecting via WalletConnect instead."
                : "LOBSTR extension not found. Connecting via WalletConnect instead.",
              { autoClose: 3000 }
            );
            await connectLobstrViaWalletConnect();
            return;
          }

          const publicKey = await getPublicKey();

          console.log("📍 [Navbar] LOBSTR public key received:", {
            publicKey: publicKey,
            keyLength: publicKey?.length,
            isValidFormat: publicKey
              ? /^G[A-Z0-9]{55}$/.test(publicKey)
              : false,
            timestamp: new Date().toISOString(),
          });

          dispatch(setConnectingWallet(false));
          dispatch(setWalletConnectName(LOBSTR_ID));
          dispatch(walletSelectionAction(false));
          dispatch(setWalletConnected(true));
          dispatch(setUserWalletAddress(publicKey));
        }
      } catch (err) {
        console.error("❌ [Navbar] Wallet connection failed:", {
          walletType: walletType,
          error: err,
          timestamp: new Date().toISOString(),
        });

        dispatch(setWalletConnectName(null));
        dispatch(setConnectingWallet(false));
        dispatch(setWalletConnected(false));

        toast.error("Failed to connect wallet. Please try again.");
      }
    },
    [user?.walletConnected, user?.connectingWallet, dispatch]
  );

  const handleDisconnect = useCallback(async () => {
    // Clear all user-related Redux state
    dispatch(logOut());

    // Clear persisted Redux state from localStorage
    try {
      await persistor.purge();
      localStorage.removeItem("persist:root");
    } catch (error) {
      console.error("Error clearing persisted state:", error);
    }

    // Force a page reload to ensure clean state
    window.location.reload();
  }, [dispatch]);

  const onScrollToRwards = () => {
    // @ts-expect-error: ignore
    document?.getElementById("reward_section").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const onScrollToYield = () => {
    // @ts-expect-error: ignore
    document.getElementById("Yield_section").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const onScrollToVaults = () => {
    // @ts-expect-error: ignore
    document.getElementById("Vault_section").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <nav className="fixed top-0 right-0 z-30 w-full bg-[#090C0E]/50 backdrop-blur-[9px] shadow-[0_2px_3px_rgba(0,0,0,.3)] py-[32px] px-[15px] md:px-[32px] transition-all duration-300 font-inter">
      <div className="flex flex-row justify-between items-center w-full max-w-[1954px] h-full mx-auto">
        <div className="shrink-0">
          <a
            href="/"
            className="flex justify-center items-center"
          >
            <img src={"/whalehub_logo.svg"} className="w-full max-w-[140px] md:max-w-none" alt="Whalehub" />
          </a>
        </div>

        <div className="flex items-center gap-8 xs:hidden lg:block space-x-4">
          {/* Order matches page layout: Stake → Vaults → Compound. */}
          <button
            className={clsx(
              "font-medium text-base py-2 px-5 rounded-lg border transition-all duration-200",
              activeSection === "reward_section"
                ? "border-[#00CC99]/70 bg-[#00CC99]/10 text-[#00CC99]"
                : "border-white/20 text-white hover:border-white/40"
            )}
            onClick={onScrollToRwards}
          >
            Stake
          </button>
          <button
            className={clsx(
              "font-medium text-base py-2 px-5 rounded-lg border transition-all duration-200",
              activeSection === "Vault_section"
                ? "border-[#00CC99]/70 bg-[#00CC99]/10 text-[#00CC99]"
                : "border-white/20 text-white hover:border-white/40"
            )}
            onClick={onScrollToVaults}
          >
            Vaults
          </button>
          <button
            className={clsx(
              "font-medium text-base py-2 px-5 rounded-lg border transition-all duration-200",
              activeSection === "Yield_section"
                ? "border-[#00CC99]/70 bg-[#00CC99]/10 text-[#00CC99]"
                : "border-white/20 text-white hover:border-white/40"
            )}
            onClick={onScrollToYield}
          >
            Compound
          </button>
        </div>

        <div className="flex justify-end items-center gap-[5.6px]">
          <div className="shrink-0 text-right">
            <Menu>
              <MenuButton
                onClick={(e) => {
                  if (user?.userWalletAddress && user?.walletConnected) {
                    e.preventDefault();
                    handleDisconnect();
                  }
                }}
                className={clsx(
                  `inline-flex items-center gap-2 py-3 text-sm/6 font-semibold text-white shadow-inner shadow-white/10 focus:outline-none data-[hover]:bg-gray-700 data-[open]:bg-gray-700 data-[focus]:outline-1 data-[focus]:outline-white rounded-lg`,
                  user?.userWalletAddress ? "px-3 md:px-8" : "px-8",
                  `${
                    !user?.userWalletAddress && !user?.walletConnected
                      ? "bg-[linear-gradient(180deg,_#00CC99_0%,_#005F99_100%)]"
                      : "b-[#3C404D]"
                  }`,
                  `${user?.userWalletAddress ? "border border-[#B1B3B8]" : ""}`
                )}
              >
                {user?.userWalletAddress ? (
                  <>
                    <ArrowRightStartOnRectangleIcon className="w-5 h-5 md:hidden" />
                    <span className="hidden md:inline text-base">Disconnect Wallet</span>
                  </>
                ) : (
                  <span className="text-base">Connect Wallet</span>
                )}
              </MenuButton>

              <MenuItems
                transition
                anchor="bottom end"
                className={clsx(
                  "w-96 origin-top-right border bg-[#151A29] border-white/5  text-sm/6 text-white transition duration-100 ease-out [--anchor-gap:var(--spacing-1)] focus:outline-none data-[closed]:scale-95 data-[closed]:opacity-0 z-40 mt-3",
                  `${
                    user?.userWalletAddress && user?.walletConnected
                      ? "hidden"
                      : "block"
                  }`
                )}
              >
                {user?.userWalletAddress != null ? (
                  <MenuItem>
                    <button
                      onClick={handleDisconnect}
                      className={clsx(
                        `group flex w-full items-center gap-2 py-4 px-4 data-[focus]:bg-white/10 justify-between border-t border-l border-r border-solid border-[#B1B3B8] text-base text-white font-semibold`
                      )}
                    >
                      Disconnect wallet
                      <XMarkIcon className="size-6 fill-white/30" />
                    </button>
                  </MenuItem>
                ) : (
                  <div></div>
                )}

                <div className="p-4 border border-solid border-[#B1B3B8]">
                  <div className="my-2">
                    <MenuItem>
                      <button
                        className="group flex w-full items-center gap-2 rounded-lg py-4 px-4 data-[focus]:bg-white/10 justify-between  text-base text-white font-semibold"
                        onClick={() =>
                          handleWalletConnections(walletTypes.WALLETCONNECT)
                        }
                      >
                        WalletConnect
                      </button>
                    </MenuItem>
                    {!isMobile && (
                      <MenuItem>
                        <button
                          className="group flex w-full items-center gap-2 rounded-lg py-4 px-4 data-[focus]:bg-white/10 justify-between  text-base text-white font-semibold"
                          onClick={() =>
                            handleWalletConnections(walletTypes.LOBSTR)
                          }
                        >
                          LOBSTR wallet
                        </button>
                      </MenuItem>
                    )}

                    {!isMobile && (
                      <MenuItem>
                        <button
                          className="group flex w-full items-center gap-2 rounded-lg py-4 px-4 data-[focus]:bg-white/10 justify-between text-base text-white font-semibold"
                          onClick={() =>
                            handleWalletConnections(walletTypes.FREIGHTER)
                          }
                        >
                          Freighter wallet
                        </button>
                      </MenuItem>
                    )}
                  </div>
                  <div className="text-xs  font-normal text-[#B1B3B8]">
                    By connecting a wallet, you agree to WhaleHub Terms of
                    Service and consent to its Privacy Policy.
                  </div>
                </div>
              </MenuItems>
            </Menu>
            <ToastContainer />
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
