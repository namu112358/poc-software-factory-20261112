import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva("rounded-md border border-border px-3.5 py-2.5 text-base leading-relaxed", {
  variants: {
    variant: {
      /** 補足・注記。状態の良し悪しを言わない。 */
      note: "bg-surface-soft text-fg",
      /** 完了・成功。 */
      ok: "bg-ok-soft text-fg",
      /** 気をつけてほしいこと。 */
      warn: "bg-warn-soft text-fg",
      /** 誤り・失敗。すぐ読み上げられる。 */
      err: "bg-err-soft text-fg",
    },
  },
  defaultVariants: {
    variant: "note",
  },
});

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>;

/** 見出しか先頭の語の色。色だけに頼らず、種類は文言でも書く。 */
const alertAccentVariants = cva("font-semibold", {
  variants: {
    variant: {
      note: "text-fg",
      ok: "text-ok",
      warn: "text-warn",
      err: "text-err",
    },
  },
  defaultVariants: {
    variant: "note",
  },
});

const AlertContext = React.createContext<AlertVariant>("note");

type AlertProps = React.ComponentProps<"div"> & VariantProps<typeof alertVariants>;

/** 誤り（err）は role="alert"（すぐ読み上げ）、それ以外は role="status"（落ち着いて読み上げ）。 */
function Alert({ className, variant, ...props }: AlertProps) {
  const kind: AlertVariant = variant ?? "note";
  return (
    <AlertContext.Provider value={kind}>
      <div
        data-slot="alert"
        role={kind === "err" ? "alert" : "status"}
        className={cn(alertVariants({ variant: kind }), className)}
        {...props}
      />
    </AlertContext.Provider>
  );
}

/** 種類の色の見出し。 */
function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  const kind = React.useContext(AlertContext);
  return <div data-slot="alert-title" className={cn(alertAccentVariants({ variant: kind }), className)} {...props} />;
}

/** 本文。先頭の語を種類の色にしたいときは、`AlertLead` で包む。 */
function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("text-fg", className)} {...props} />;
}

/** 見出しを置かないときの、種類の色の先頭の語（「完了:」「注意:」など）。 */
function AlertLead({ className, ...props }: React.ComponentProps<"span">) {
  const kind = React.useContext(AlertContext);
  return <span data-slot="alert-lead" className={cn(alertAccentVariants({ variant: kind }), "mr-1", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, AlertLead, alertVariants };
