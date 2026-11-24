// Fork: lets the user approve a proposed plan with one click. It sends a follow-up message in
// default mode, which ends plan mode for the thread.
import { useGT } from "gt-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";

export const PROCEED_WITH_PLAN_MESSAGE = "Proceed with the plan.";

export function ProceedPlanButton({ onProceed }: { onProceed: () => Promise<void> }) {
  const gt = useGT();
  const [sent, setSent] = useState(false);
  const proceed = () => {
    setSent(true);
    onProceed().catch((error: unknown) => {
      setSent(false);
      toastManager.add({
        type: "error",
        title: gt("Could not send the follow-up"),
        description: error instanceof Error ? error.message : gt("An error occurred."),
      });
    });
  };
  return (
    <div className="mt-4 flex justify-end">
      <Button size="sm" disabled={sent} onClick={proceed}>
        {gt("Proceed")}
      </Button>
    </div>
  );
}
