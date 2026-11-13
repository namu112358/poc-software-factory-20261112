import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "../label/label";

type InputProps = Omit<React.ComponentProps<"input">, "aria-invalid"> & {
  /** 欄の名前。短い名詞で書く。必ず渡す。 */
  label: React.ReactNode;
  /** 欄の使い方の補足。読み上げでは欄の説明として読まれる。 */
  description?: React.ReactNode;
  /** 誤りの文言。渡すと欄が赤い枠になり、`aria-invalid` が付き、欄の説明として読まれる。 */
  error?: React.ReactNode;
};

/** 1 行の入力欄。名前（Label）・補足・誤りの文言とあわせて描く。`id` を渡さなければ、欄ごとに別の `id` を付ける。 */
function Input({ className, label, description, error, id, required, disabled, type = "text", ...props }: InputProps) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const hasError = error !== undefined && error !== null && error !== false && error !== "";
  const hasDescription = description !== undefined && description !== null && description !== false && description !== "";
  const describedBy =
    [hasDescription ? descriptionId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div data-slot="input-field" className="flex flex-col gap-1">
      <Label htmlFor={inputId} required={required} disabled={disabled}>
        {label}
      </Label>
      <input
        id={inputId}
        data-slot="input"
        type={type}
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
      />
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

export { Input };
export type { InputProps };
