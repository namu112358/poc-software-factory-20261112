import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 表。名前（<caption> か aria-label）を必ず付ける。
 * 縦に長い表で見出しを残すため、親の要素にスクロールを持たせる（Story「長い表」を参照）。
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <table
      data-slot="table"
      className={cn("w-full border-collapse text-left text-base text-fg", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("pb-2 text-left text-sm text-muted", className)}
      {...props}
    />
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b border-border hover:bg-hover", className)}
      {...props}
    />
  );
}

type CellAlign = { align?: "left" | "right" };

/** 見出しのセル。数字の列は align="right" にする（TableCell と同じ向きにそろえる）。 */
function TableHead({
  className,
  align = "left",
  scope = "col",
  ...props
}: React.ComponentProps<"th"> & CellAlign) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        "sticky top-0 border-b border-border bg-bg px-2.5 py-2 text-xs font-medium text-muted",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

/** 数字の列は align="right"。右寄せにし、桁がそろうよう tabular-nums を付ける。 */
function TableCell({ className, align = "left", ...props }: React.ComponentProps<"td"> & CellAlign) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-2.5 py-2", align === "right" ? "text-right tabular-nums" : "text-left", className)}
      {...props}
    />
  );
}

/** 行が無いときの案内。列の数を colSpan に渡して、表の中に 1 行で出す。 */
function TableEmpty({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <tr data-slot="table-empty" className="border-b border-border">
      <td className={cn("px-2.5 py-6 text-center text-muted", className)} {...props} />
    </tr>
  );
}

export { Table, TableCaption, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };
