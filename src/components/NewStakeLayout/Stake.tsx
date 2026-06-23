import { useState } from "react";
import STKAqua from "./STKAqua";
import Wrapper from "./Wrapper";
import Yield from "./Yield";
import Vaults from "./Vaults";
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
      <div className="md:w-[960px] mx-auto px-4">
        <Wrapper>
          {/* Page order: Stake → Compound → Vaults. */}
          <STKAqua />
          <Yield />
          <Vaults />
        </Wrapper>
      </div>
      
      {/* POL Information Section - Only show if Soroban is enabled */}
      {isFeatureEnabled('useSoroban') && (
        <div className="md:w-[960px] mx-auto mt-8 px-4">
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
