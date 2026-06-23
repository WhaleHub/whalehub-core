import { useState } from "react";
import STKAqua from "./STKAqua";
import Wrapper from "./Wrapper";
import Yield from "./Yield";
import AddLiquidity from "./AddLiquidity";
import PolInfo from "./PolInfo";
import DialogC from "./Dialog";
import { isFeatureEnabled } from "../../config/soroban.config";

function NewStakelayout() {
  const [dialogMsg, setDialogMsg] = useState<string>("");
  const [dialogTitle, setDialogTitle] = useState<string>("");
  const [openDialog, setOpenDialog] = useState<boolean>(false);

  const onDialogOpen = (msg: string, title: string) => {
    setOpenDialog(true);
    setDialogMsg(msg);
    setDialogTitle(title);
  };

  const closeModal = () => {
    setOpenDialog(false);
  };

  return (
    <div className="font-inter mx-auto">
      <div className="md:w-[914px] mx-auto">
        <Wrapper>
          <STKAqua />
        </Wrapper>
      </div>

      {/* Vaults (AQUA-BLUB liquidity) — above Compound */}
      <div className="md:w-[914px] mx-auto mt-8">
        <AddLiquidity />
      </div>

      {/* Compound (Re-stake earned BLUB) — below Vaults */}
      <div className="md:w-[914px] mx-auto mt-8">
        <Yield />
      </div>

      {/* POL Information Section - Only show if Soroban is enabled */}
      {isFeatureEnabled('useSoroban') && (
        <div className="md:w-[914px] mx-auto mt-8">
          <PolInfo onDialogOpen={onDialogOpen} />
        </div>
      )}

      <DialogC
        msg={dialogMsg}
        openDialog={openDialog}
        dialogTitle={dialogTitle}
        closeModal={closeModal}
      />
    </div>
  );
}

export default NewStakelayout;
