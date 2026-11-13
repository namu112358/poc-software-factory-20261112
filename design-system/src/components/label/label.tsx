import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root> & {
  /** true なら、見た目の「*」と、読み上げ用の「必須」を名前の後ろに付ける。 */
  required?: boolean;
  /** true なら、押せない欄の名前として薄く表示する。欄そのものの disabled は、欄の側で付ける。 */
  disabled?: boolean;
};

/** 入力欄の名前。`htmlFor` で欄と結び付けると、名前を押したときに欄へフォーカスが移る。 */
function Label({ className, children, required = false, disabled = false, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium text-fg-2 select-none",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <>
          {/* 見た目は記号、読み上げは「必須」。記号は読み上げから外す。 */}
          <span aria-hidden="true" className="text-err">
            *
          </span>
          <span className="sr-only">必須</span>
        </>
      ) : null}
    </LabelPrimitive.Root>
  );
}

export { Label };
