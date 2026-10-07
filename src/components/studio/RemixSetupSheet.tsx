import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { RemixableParts } from "~/components/cr/RemixableParts";
import { useReturnFocus } from "~/hooks/use-return-focus";

// "Make it remixable": the creator picks what people who remix this design may change (its words,
// characters, people, and groups), then tries it as a remix. Opening it reads the design once.
export function RemixSetupSheet({
  generationId,
  onTry,
  onClose,
}: {
  generationId: Id<"generations">;
  onTry: () => void;
  onClose: () => void;
}) {
  const setup = useMutation(api.remixParts.setup);
  const dialog = useRef<HTMLDivElement>(null);
  useReturnFocus();
  useEffect(() => {
    void setup({ generationId }).catch(() => undefined);
  }, [generationId, setup]);
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Make it remixable"
        className="max-h-[90svh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] outline-none md:max-w-xl md:rounded-3xl md:p-8"
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black tracking-tight">Make it remixable</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Choose what people can change when they remix this design, then try it yourself. Publishing it keeps these settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl font-black hover:bg-black hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="mt-4">
          <RemixableParts target={{ generationId }} editing bare onTry={onTry} />
        </div>
      </motion.div>
    </motion.div>
  );
}

