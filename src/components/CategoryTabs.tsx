import Link from "next/link";
import { CATEGORIES } from "@/config/categories";
import type { CategoryId } from "@/lib/types";

export function CategoryTabs({ active }: { active: CategoryId }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-gray-200">
      {CATEGORIES.map((c) => {
        const isActive = c.id === active;
        return (
          <Link
            key={c.id}
            href={`/${c.id}`}
            className={
              "rounded-t-md px-4 py-2 text-sm font-medium transition-colors " +
              (isActive
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-gray-500 hover:text-gray-800")
            }
          >
            {c.label}
          </Link>
        );
      })}
    </nav>
  );
}
