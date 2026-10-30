import { useClerk, useUser } from "@clerk/clerk-react";
import { isClerkAPIResponseError } from "@clerk/clerk-react/errors";
import { useAction } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useState } from "react";
import { forgetDeletedAccount } from "../auth/rememberedSession";

type Step = "idle" | "confirming" | "deleting" | "failed";

// The one irreversible act in the product, so it asks once, plainly, and
// says exactly what goes. The server deletes the Clerk account and every
// stored row; this browser then forgets everything it kept for the user.
export function DeleteAccount() {
  const deleteAccount = useAction(api.account.deleteAccount);
  const { signOut } = useClerk();
  const { user } = useUser();
  const [step, setStep] = useState<Step>("idle");

  const confirm = async () => {
    if (!user) return;
    const userId = user.id;
    setStep("deleting");
    try {
      // Once this returns, the deletion is committed: the server finishes
      // removing the data and the Clerk user even if that takes retries.
      await deleteAccount({});
    } catch {
      // The reply can be lost after the server already deleted the user;
      // Clerk no longer knowing the account is the proof.
      if (!(await accountIsGone(user))) {
        setStep("failed");
        return;
      }
    }
    forgetDeletedAccount(userId);
    // Deleting the user already ended its sessions; this clears Clerk's
    // client state. If that call fails on the dead session, a fresh load
    // finds no session either way.
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      window.location.assign("/");
    }
  };

  if (step === "idle")
    return (
      <button
        type="button"
        onClick={() => setStep("confirming")}
        className="flex w-full items-center rounded-[9px] px-4 py-3.5 text-left text-[15px] text-dot-ink transition-colors hover:bg-tint"
      >
        Delete account
      </button>
    );

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <p className="text-[14px] leading-[1.55] text-pt">
        This deletes your account and everything in it: every thought, its
        connections and notes, and the daily email. It can't be undone.
      </p>
      {step === "failed" && (
        <p role="status" className="text-[13px] text-dot-ink">
          Couldn't finish deleting. Try again.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={step === "deleting"}
          onClick={() => void confirm()}
          className="inline-flex h-10 items-center rounded-full bg-dot px-5 text-[14.5px] font-semibold text-on-dot transition-[filter,scale,opacity] hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
        >
          {step === "deleting" ? "Deleting…" : "Delete everything"}
        </button>
        {step !== "deleting" && (
          <button
            type="button"
            onClick={() => setStep("idle")}
            className="inline-flex h-10 items-center rounded-full px-5 text-[14.5px] text-pt transition-colors hover:bg-tint hover:text-ink"
          >
            Keep it
          </button>
        )}
      </div>
    </div>
  );
}

async function accountIsGone(user: { reload: () => Promise<unknown> }) {
  try {
    await user.reload();
    return false;
  } catch (error) {
    return (
      isClerkAPIResponseError(error) &&
      [401, 403, 404].includes(error.status)
    );
  }
}
