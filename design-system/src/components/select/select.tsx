import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "../label/label";

type SelectProps = Omit<React.ComponentProps<"select">, "aria-invalid"> & {
  /** 欄の名前。短い名詞で書く。必ず渡す。 */
  label: React.ReactNode;
  /** 欄の使い方の補足。読み上げでは欄の説明として読まれる。 */
  description?: React.ReactNode;
  /** 誤りの文言。渡すと欄が赤い枠になり、`aria-invalid` が付き、欄の説明として読まれる。 */
  error?: React.ReactNode;
};

/**
 * 選択肢から 1 つ選ぶ欄。ブラウザ標準の `<select>` を使い、名前（Label）・補足・誤りの文言とあわせて描く。
 * 選択肢は子に `<option>` で渡す。`id` を渡さなければ、欄ごとに別の `id` を付ける。
 */
function Select({ className, label, description, error, id, required, disabled, children, ...props }: SelectProps) {
  const autoId = React.useId();
  const selectId = id ?? autoId;
  const descriptionId = `${selectId}-description`;
  const errorId = `${selectId}-error`;
  const hasError = error !== undefined && error !== null && error !== false && error !== "";
  const hasDescription = description !== undefined && description !== null && description !== false && description !== "";
  const describedBy =
    [hasDescription ? descriptionId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div data-slot="select-field" className="flex flex-col gap-1">
      <Label htmlFor={selectId} required={required} disabled={disabled}>
        {label}
      </Label>
      <select
        id={selectId}
        data-slot="select"
        required={required}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-9 w-full rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-base text-fg",
          "focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand",
          "aria-invalid:border-err",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {hasDescription ? (
        <p id={descriptionId} className="text-xs text-muted">
          {description}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} className="text-xs text-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { Select };
export type { SelectProps };
