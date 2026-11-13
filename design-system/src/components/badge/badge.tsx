import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-xs font-semibold",
  {
    variants: {
      variant: {
        /** 状態の良し悪しを言わない、ふつうの札。 */
        neutral: "bg-surface text-fg-2",
        /** 済み・確定など、問題の無い状態。 */
        ok: "bg-ok-soft text-ok",
        /** 注意・見込み・遅れなど、気にかけたい状態。 */
        warn: "bg-warn-soft text-warn",
        /** 誤り・失敗など、直す必要がある状態。 */
        err: "bg-err-soft text-err",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

/** 状態を示す小さな札。押せない（<span>）。色だけに頼らず、状態は文言で書く。 */
function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
