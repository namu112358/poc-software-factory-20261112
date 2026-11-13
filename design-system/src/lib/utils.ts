import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// 独自の文字の大きさ（text-2xs）を、色のクラス（text-fg など）と取り違えないように教える。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "xs", "sm", "base", "lg", "xl"] }],
    },
  },
});

/** クラス名をまとめ、Tailwind のクラスの重なりは後ろを優先する（shadcn/ui の cn と同じ）。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
