"use client";

import { useRouter } from "next/navigation";

/** The sort choice is applied as soon as it is selected (other filters only with "Filtrele"). */
export function SortSelect({ value, hrefs }: { value: "newest" | "oldest"; hrefs: Record<"newest" | "oldest", string> }) {
  const router = useRouter();
  return (
    <>
      <label htmlFor="sort" className="sr-only">
        Sıralama
      </label>
      <select
        id="sort"
        value={value}
        onChange={(e) => router.push(hrefs[e.target.value === "oldest" ? "oldest" : "newest"])}
        className="h-11 cursor-pointer appearance-none rounded-full border-[1.5px] border-dash-line-strong bg-white bg-[length:14px] bg-[right_14px_center] bg-no-repeat pl-3.5 pr-10 text-sm font-semibold text-dash-navy [background-image:var(--admin-chevron)]"
      >
        <option value="newest">Son güncellenen önce</option>
        <option value="oldest">En uzun bekleyen önce</option>
      </select>
    </>
  );
}
