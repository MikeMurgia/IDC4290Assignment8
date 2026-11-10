import React, { useMemo, useState } from "react";

// Searchable airport combobox: type a code ("ATL"), a city ("atlanta") or a name.
export default function AirportPicker({ id, label, value, onChange, airports }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const byCode = useMemo(() => new Map(airports.map((a) => [a.code, a])), [airports]);
  const selected = byCode.get(value);
  const shown = open ? query : selected ? `${selected.code} · ${selected.city}, ${selected.state}` : value || "";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return airports.slice(0, 8);
    const hit = airports.filter(
      (a) =>
        a.code.toLowerCase().startsWith(q) ||
        a.city.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.state.toLowerCase().includes(q)
    );
    const rank = (a) => (a.code.toLowerCase() === q ? 0 : a.code.toLowerCase().startsWith(q) ? 1 : 2);
    return hit.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code)).slice(0, 8);
  }, [airports, query]);

  const choose = (a) => {
    onChange(a.code);
    setOpen(false);
    setQuery("");
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="field picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        value={shown}
        placeholder="Search airport or city"
        onFocus={(e) => {
          setOpen(true);
          setQuery("");
          setActive(0);
          e.target.select();
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="picker-list" id={`${id}-list`} role="listbox">
          {matches.length === 0 && <li className="picker-empty">No matching airport</li>}
          {matches.map((a, i) => (
            <li
              key={a.code}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(a);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <strong>{a.code}</strong>
              <span>
                {a.city}, {a.state}
                <small>{a.name}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
