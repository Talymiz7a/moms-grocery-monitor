import { useQuery } from "convex/react";
import { useId, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { normalizeText } from "../../convex/lib/normalize";
import { useAppState } from "../state/AppState";
import { inputClass } from "./ui";

/** Autocomplete over canonical product names and their receipt wordings. */
export function ProductSearch({
  onPick,
  placeholder = "חיפוש מוצר…",
  exclude = [],
}: {
  onPick: (p: { _id: string; canonicalName: string }) => void;
  placeholder?: string;
  exclude?: string[];
}) {
  const { readArgs } = useAppState();
  const products = useQuery(api.products.list, { ...readArgs });
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const q = normalizeText(text);
    if (!q || !products) return [];
    return products
      .filter((p) => !exclude.includes(p._id))
      .map((p) => {
        const names = [p.canonicalName, ...p.aliases].map(normalizeText);
        const starts = names.some((n) => n.startsWith(q) || n.split(" ").some((w) => w.startsWith(q)));
        const contains = names.some((n) => n.includes(q));
        return { p, rank: starts ? 0 : contains ? 1 : 2 };
      })
      .filter((m) => m.rank < 2)
      .sort((a, b) => a.rank - b.rank || a.p.canonicalName.localeCompare(b.p.canonicalName, "he"))
      .slice(0, 8)
      .map((m) => m.p);
  }, [text, products, exclude]);

  function pick(i: number) {
    const p = matches[i];
    if (!p) return;
    onPick(p);
    setText("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        className={inputClass}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter") {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-white py-1 shadow-lg">
          {matches.map((p, i) => (
            <li
              key={p._id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-brand-50" : ""}`}
            >
              <span className="font-medium">{p.canonicalName}</span>
              {p.category && <span className="ms-2 text-sm text-ink-soft">{p.category}</span>}
            </li>
          ))}
        </ul>
      )}
      {open && text.trim() && products && matches.length === 0 && (
        <p className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-line bg-white p-3 text-ink-soft shadow-lg">לא נמצא מוצר</p>
      )}
    </div>
  );
}
