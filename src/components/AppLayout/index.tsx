import { Outlet } from "react-router-dom";
import Navbar from "../Navbar";
import Footer from "../Footer";
import WhitelistBanner from "../WhitelistBanner";

const AppLayout = () => (
  <div className="flex flex-col min-h-screen overflow-x-hidden">
    <WhitelistBanner />
    <Navbar />
    <main
      className="grow"
      style={{ paddingTop: "calc(var(--banner-h, 94px) + 81.5px)" }}
    >
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
