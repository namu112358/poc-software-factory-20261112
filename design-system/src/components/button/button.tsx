import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        /** 画面でいちばん大事な操作。1 つの区切りに 1 つだけ。 */
        primary: "border-brand bg-brand text-brand-fg hover:brightness-95 disabled:hover:brightness-100",
        /** ふつうの操作。 */
        secondary: "border-border-strong bg-bg text-fg hover:bg-hover disabled:hover:bg-bg",
        /** 目立たせない操作（取り消し・詳しく見る など）。 */
        quiet: "border-transparent bg-transparent text-link hover:bg-hover disabled:hover:bg-transparent",
      },
      size: {
        md: "min-h-9 px-3.5 text-base",
        sm: "min-h-7.5 px-2.5 text-sm",
        /** 文字の無い、アイコンだけのボタン。aria-label が必須。 */
        icon: "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

type ButtonBaseProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** true なら <button> を描かず、子の要素（<a> など）にボタンの見た目を付ける。 */
    asChild?: boolean;
  };

/** アイコンだけのボタンは、読み上げのために aria-label を必ず渡す。 */
export type ButtonProps =
  | (ButtonBaseProps & { size?: "md" | "sm" | null })
  | (ButtonBaseProps & { size: "icon"; "aria-label": string });

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      // フォームの中で思わず送信しないよう、<button> の既定は type="button" にする。
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
