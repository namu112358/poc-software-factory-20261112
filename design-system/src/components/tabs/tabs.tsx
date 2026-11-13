import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

/** Base UI は className に関数も受けるが、`cn` でまとめるため文字列だけにする。 */
type WithStringClassName<P> = Omit<P, "className"> & { className?: string };

/** 同じ場所で表示を切り替える。左右の矢印キーでタブを移り、Tab キーで中身に移る。 */
function Tabs({ className, ...props }: WithStringClassName<TabsPrimitive.Root.Props>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-3", className)} {...props} />;
}

/**
 * タブの列。下に線を引く。読み上げのために、aria-label で何の切り替えかを伝える。
 * 矢印キーでタブに移ったとき、そのタブを選ぶ（`activateOnFocus`。Base UI の既定は「Enter・Space で選ぶ」）。
 */
function TabsList({ className, activateOnFocus = true, ...props }: WithStringClassName<TabsPrimitive.List.Props>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      activateOnFocus={activateOnFocus}
      className={cn("flex border-b border-border", className)}
      {...props}
    />
  );
}

/** 1 つのタブ。選ばれているときは下線が出る。件数は `TabsCount` を子に置く。 */
function TabsTrigger({ className, ...props }: WithStringClassName<TabsPrimitive.Tab.Props>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3.5 py-2 text-base text-fg-2",
        "hover:bg-hover",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
        "aria-selected:border-brand aria-selected:font-semibold aria-selected:text-fg",
        // Base UI の押せないタブは、disabled 属性ではなく data-disabled（と aria-disabled）が付く。
        "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

/** タブに添える件数。タブの名前の読み上げに含まれる（「未対応 3」）。 */
function TabsCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tabs-count"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-err px-1.5 text-xs font-bold text-brand-fg",
        className,
      )}
      {...props}
    />
  );
}

/** タブの中身。`value` が対応するタブと同じものを表示する。 */
function TabsContent({ className, ...props }: WithStringClassName<TabsPrimitive.Panel.Props>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        // 切り替えの動きは付けないので、閉じていく中身はすぐ隠す（新旧の中身が同時に見えないように）。
        "data-ending-style:hidden",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsCount, TabsContent };
