import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "@/lib/utils";

/** オン・オフに加えて、「一部だけ」を `"indeterminate"` で表す。 */
type CheckedState = boolean | "indeterminate";

type CheckboxProps = Omit<
  CheckboxPrimitive.Root.Props,
  "checked" | "defaultChecked" | "indeterminate" | "render" | "nativeButton" | "className"
> & {
  className?: string;
  checked?: CheckedState;
  defaultChecked?: CheckedState;
};

/**
 * オン・オフを選ぶ箱。`checked="indeterminate"` で「一部だけ」の状態になる（読み上げは `aria-checked="mixed"`）。
 * Base UI は「一部だけ」を別の props（`indeterminate`）で受けるので、ここで `checked` の値から振り分ける。
 * 状態を部品に任せる書き方（`defaultChecked="indeterminate"`）でも、押せばオンに変わる。
 * 見た目は Base UI が付ける `data-checked`・`data-unchecked`・`data-indeterminate` で切り替える。
 * 名前は Label で付け、`htmlFor` と箱の `id` を合わせる。名前を押しても切り替わる。
 */
function Checkbox({ className, checked, defaultChecked = false, onCheckedChange, ...props }: CheckboxProps) {
  const [uncontrolled, setUncontrolled] = React.useState<CheckedState>(defaultChecked);
  const isControlled = checked !== undefined;
  const state = isControlled ? checked : uncontrolled;

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      // <button> で描き、押せないときは disabled 属性が付くようにする（Tab で止まらない）。
      nativeButton
      render={<button type="button" />}
      checked={state === true}
      indeterminate={state === "indeterminate"}
      onCheckedChange={(next, details) => {
        onCheckedChange?.(next, details);
        if (!isControlled && !details.isCanceled) setUncontrolled(next);
      }}
      className={cn(
        "peer inline-flex size-4 shrink-0 cursor-pointer touch-manipulation items-center justify-center border border-border-strong bg-bg text-brand-fg",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "data-checked:border-brand data-checked:bg-brand",
        "data-indeterminate:border-brand data-indeterminate:bg-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="group flex items-center justify-center">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 group-data-indeterminate:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="hidden size-3 group-data-indeterminate:block" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 8h8" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
