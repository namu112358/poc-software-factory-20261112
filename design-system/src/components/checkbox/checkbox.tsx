import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root>;

/**
 * オン・オフを選ぶ箱。`checked="indeterminate"` で「一部だけ」の状態になる（読み上げは `aria-checked="mixed"`）。
 * 見た目は Radix が付ける `data-state`（checked・unchecked・indeterminate）で切り替えるので、`defaultChecked="indeterminate"` でも同じに見える。
 * 名前は Label で付け、`htmlFor` と箱の `id` を合わせる。名前を押しても切り替わる。
 */
function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer inline-flex size-4 shrink-0 cursor-pointer touch-manipulation items-center justify-center border border-border-strong bg-bg text-brand-fg",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        "data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="group flex items-center justify-center">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 group-data-[state=indeterminate]:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="hidden size-3 group-data-[state=indeterminate]:block" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 8h8" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
