"use client";

import { useMemo, useState } from "react";
import { useLocale } from "./locale-provider";

export interface Column<T> {
  key: string;
  label: string;
  /** What this cell shows. */
  render: (row: T) => React.ReactNode;
  /** The value sorting and text-filtering use — omit to make the column inert. */
  value?: (row: T) => string | number | null;
  align?: "left" | "right";
}

export interface Filter<T> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** Keeps a row when the chosen value is selected. */
  matches: (row: T, value: string) => boolean;
}

/**
 * One sortable, filterable table used by every admin tab.
 *
 * Sorting and filtering happen in the browser over rows already fetched,
 * which is honest for the page sizes the admin endpoints return (a couple
 * of hundred rows) and keeps the columns declarative. If a list ever
 * outgrows that, the sort would move into the query rather than this
 * component growing pagination it cannot honour.
 */
export function DataTable<T>({
  rows,
  columns,
  filters = [],
  getRowKey,
  initialSort,
  emptyLabel,
}: {
  rows: T[];
  columns: Column<T>[];
  filters?: Filter<T>[];
  getRowKey: (row: T) => string;
  initialSort?: { key: string; direction: "asc" | "desc" };
  emptyLabel: string;
}) {
  const { t } = useLocale();
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(initialSort ?? null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Record<string, string>>({});

  const visible = useMemo(() => {
    const searchable = columns.filter((c) => c.value);
    let out = rows;

    for (const filter of filters) {
      const value = active[filter.key];
      if (value) out = out.filter((row) => filter.matches(row, value));
    }

    const needle = query.trim().toLowerCase();
    if (needle) {
      out = out.filter((row) =>
        searchable.some((c) => String(c.value!(row) ?? "").toLowerCase().includes(needle)),
      );
    }

    if (sort) {
      const column = columns.find((c) => c.key === sort.key);
      if (column?.value) {
        // Copy first: sorting the caller's array in place would reorder
        // their state behind their back.
        out = [...out].sort((a, b) => {
          const av = column.value!(a);
          const bv = column.value!(b);
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          return sort.direction === "asc" ? cmp : -cmp;
        });
      }
    }

    return out;
  }, [rows, columns, filters, active, query, sort]);

  function toggleSort(key: string) {
    setSort((prev) =>
      prev?.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" },
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="table-search"
          placeholder={t("table.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        {filters.map((filter) => (
          <select
            key={filter.key}
            value={active[filter.key] ?? ""}
            onChange={(e) => setActive((prev) => ({ ...prev, [filter.key]: e.target.value }))}
            style={{ width: "auto" }}
            aria-label={filter.label}
          >
            <option value="">{filter.label}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ))}
        <span className="meta" style={{ marginLeft: "auto" }}>
          {visible.length === rows.length
            ? t("table.count", { shown: rows.length })
            : t("table.countFiltered", { shown: visible.length, total: rows.length })}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">{emptyLabel}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} style={{ textAlign: column.align ?? "left" }}>
                    {column.value ? (
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => toggleSort(column.key)}
                        aria-label={`${t("table.sortBy")} ${column.label}`}
                      >
                        {column.label}
                        <span aria-hidden="true">
                          {sort?.key === column.key ? (sort.direction === "asc" ? " ▲" : " ▼") : " ↕"}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={getRowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.key} style={{ textAlign: column.align ?? "left" }}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
