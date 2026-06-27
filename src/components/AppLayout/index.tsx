import { Outlet } from "react-router-dom";
import Navbar from "../Navbar";
import Footer from "../Footer";

const AppLayout = () => (
  <div className="flex flex-col min-h-screen overflow-x-hidden">
    <Navbar />
    <main
      className="grow"
      style={{ paddingTop: "var(--nav-h, 94px)" }}
    >
      <a
        href="https://whalehub-1.gitbook.io/whalehub/tokenomics/bribes-harvesting"
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full text-center text-sm py-2.5 px-4 border-b border-[#00cc99]/25 bg-[#00cc99]/[0.06] text-[#b1b3b8] hover:text-white transition-colors"
      >
        New reward engine: WhaleHub v2 harvests Aquarius bribes into BLUB. Same
        staking you know, stronger yield.{" "}
        <span className="text-[#00cc99] font-semibold whitespace-nowrap">
          Learn more &rarr;
        </span>
      </a>
      <div className="flex w-full h-full">
        <div className="flex flex-col justify-center w-full">
          <Outlet />
        </div>
      </div>
    </main>
    <Footer />
  </div>
);

export default AppLayout;
