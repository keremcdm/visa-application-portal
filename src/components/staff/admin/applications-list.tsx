import Link from "next/link";
import { Briefcase, Check, Clock, Search, User } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { CLOSED_VISIBLE_DAYS, type ListCell } from "@/features/staff/admin-list";
import { LIST_STAGE_NAMES, LIST_TABS, type SegmentCode, type TurnInfo } from "@/features/staff/admin-state";
import { APPLICATION_TYPE_LABELS, APPLICATION_TYPES_BY_LABEL } from "@/lib/domain/constants";
import { ROUTES, staffApplicationPath } from "@/lib/site";
import { adminListQuery, type AdminListFilters, type AdminListResult, type AdminListRow } from "@/server/data/admin-list";
import { SortSelect } from "./sort-select";
import { AdminPill, adminButton } from "./ui";

/*
 * APPLICATIONS LIST
 * Tabs (with counts), filters, a 6-column table; the whole row links to the application page. Below 1200px (fixed
 * columns no longer fit) rows switch to a card view. 28px between columns; cell labels are kept short so they never
 * run into each other.
 */

const COLUMNS = "min-[1200px]:grid-cols-[minmax(0,1fr)_220px_130px_130px_140px_100px]";
const GAPS = "gap-x-7 gap-y-4";
const field = "h-11 rounded-full border-[1.5px] border-dash-line-strong bg-white text-sm font-semibold text-dash-navy";
const selectClass = cn(field, "cursor-pointer appearance-none bg-[length:14px] bg-[right_14px_center] bg-no-repeat pl-3.5 pr-10 [background-image:var(--admin-chevron)]");

const SEGMENT_BG: Record<SegmentCode, string> = {
  D: "bg-dash-green",
  S: "bg-dash-green-soft",
  x: "bg-dash-red",
  c: "bg-dash-yellow-accent",
  W: "bg-dash-line",
  X: "bg-dash-red",
};
const SEGMENT_RING: Record<SegmentCode, string> = {
  D: "",
  S: "",
  x: "shadow-[0_0_0_2px_var(--color-white),0_0_0_3.5px_var(--color-dash-red)]",
  c: "shadow-[0_0_0_2px_var(--color-white),0_0_0_3.5px_var(--color-dash-yellow-accent)]",
  W: "shadow-[0_0_0_2px_var(--color-white),0_0_0_3.5px_var(--color-dash-line)]",
  X: "shadow-[0_0_0_2px_var(--color-white),0_0_0_3.5px_var(--color-dash-red)]",
};

function TurnBadge({ turn }: { turn: TurnInfo }) {
  const style = {
    us: "bg-dash-navy text-white shadow-[0_0_0_3px_var(--color-dash-navy-tint)]",
    customer: "bg-dash-draft-bg text-dash-draft-ink shadow-[inset_0_0_0_1.5px_var(--color-dash-yellow-accent)]",
    auto: "bg-dash-subtle text-dash-ink-2",
    done: "bg-dash-green-tint text-dash-green-ink",
    cancel: "bg-dash-red-tint text-dash-red",
  }[turn.kind];
  const Icon = { us: Briefcase, customer: User, auto: Clock, done: Check, cancel: Check }[turn.kind];
  return (
    <span className={cn("inline-flex h-7 items-center gap-[7px] rounded-full pl-[9px] pr-3 text-xs font-extrabold tracking-[0.02em]", style)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.75} />
      {turn.label}
    </span>
  );
}

function Cell({ cell, label }: { cell: ListCell; label: string }) {
  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="text-xs font-bold text-dash-ink-3 min-[1200px]:hidden">{label}</span>
      <AdminPill tone={cell.tone}>{cell.label}</AdminPill>
      {cell.sub ? <span className="text-xs text-dash-ink-3">{cell.sub}</span> : null}
    </span>
  );
}

/** "Taslakları göster" / "Tamamlananları göster" (show drafts / show completed): pill toggle with an 18px box (as in the design). */
function FilterCheck({ name, checked, children }: { name: string; checked: boolean; children: string }) {
  return (
    <label className="flex h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-dash-line-strong bg-white px-4 text-sm font-semibold text-dash-navy has-[:checked]:border-dash-navy has-[:checked]:bg-dash-subtle has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-dash-red">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="peer sr-only" />
      <span
        aria-hidden
        className="grid size-[18px] place-items-center rounded-[6px] border-[1.5px] border-dash-dot bg-white peer-checked:border-dash-navy peer-checked:bg-dash-navy [&>svg]:invisible peer-checked:[&>svg]:visible"
      >
        <Check className="size-[11px] text-white" strokeWidth={4} />
      </span>
      {children}
    </label>
  );
}

function ListRow({ row }: { row: AdminListRow }) {
  return (
    <Link
      href={staffApplicationPath(row.id)}
      className={cn(
        "grid grid-cols-1 items-start border-b border-dash-line-faint px-6 py-5 text-dash-navy no-underline transition-colors last:border-b-0 hover:bg-dash-row-hover hover:text-dash-navy min-[640px]:grid-cols-2 motion-reduce:transition-none",
        GAPS,
        COLUMNS,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5 min-[640px]:col-span-2 min-[1200px]:col-span-1">
        <span className="text-[15px] font-extrabold">{row.applicantName}</span>
        <span className="truncate text-[13px] text-dash-ink-2">{row.email}</span>
        <span className="text-xs font-semibold tabular-nums text-dash-ink-3">
          {row.referenceCode} · {row.typeText}
        </span>
      </span>
      <span className="flex flex-col items-start gap-2.5">
        <span className="flex flex-wrap items-center gap-2.5">
          <TurnBadge turn={row.turn} />
          {row.wait ? <span className={cn("text-xs font-bold", row.wait.alert ? "text-dash-red" : "text-dash-ink-3")}>{row.wait.text}</span> : null}
        </span>
        {row.formEditRequested ? (
          <AdminPill tone="yellow" size="sm">
            Form düzenleme isteği
          </AdminPill>
        ) : null}
        {row.newExtraDocuments > 0 ? (
          <AdminPill tone="navy" size="sm">
            {row.newExtraDocuments > 1 ? `Yeni ek evrak (${row.newExtraDocuments})` : "Yeni ek evrak"}
          </AdminPill>
        ) : null}
        <span className="text-sm font-bold leading-[1.3]">{row.pill.label}</span>
        <span className="flex flex-col gap-[5px]">
          <span className="flex gap-[3px]" aria-hidden>
            {row.segments.map((segment) => (
              <span key={segment.name} title={segment.name} className={cn("h-1.5 w-[22px] rounded-full", SEGMENT_BG[segment.code], segment.current && SEGMENT_RING[segment.code])} />
            ))}
          </span>
          <span className="text-xs text-dash-ink-2">
            <strong className="tabular-nums text-dash-navy">{row.stepNo}/6</strong> · {row.stepName}
          </span>
        </span>
      </span>
      <Cell cell={row.payment} label="Ödeme" />
      <Cell cell={row.documents} label="Evraklar" />
      <Cell cell={row.appointment} label="Randevu" />
      <span className="flex flex-col gap-0.5 min-[1200px]:text-right">
        <span className="text-sm font-bold">{row.updatedRelative}</span>
        <span className="text-xs tabular-nums text-dash-ink-3">{row.updatedAbsolute}</span>
      </span>
    </Link>
  );
}

export function ApplicationsList({ filters, result }: { filters: AdminListFilters; result: AdminListResult }) {
  const filtered = Boolean(filters.query || filters.stage !== null || filters.type || filters.drafts || filters.closed);
  const href = (overrides: Partial<AdminListFilters>) => `${ROUTES.staff}${adminListQuery(filters, { page: 1, ...overrides })}`;

  return (
    <div className="flex flex-col gap-[22px]">
      <nav aria-label="Başvuru görünümleri" className="flex flex-wrap gap-2">
        {LIST_TABS.map((tab) => {
          const active = filters.tab === tab.id;
          const count = result.counts[tab.id];
          const hot = tab.id === "ours" && count > 0;
          return (
            <Link
              key={tab.id}
              href={href({ tab: tab.id })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 flex-none items-center gap-2.5 whitespace-nowrap rounded-full border-[1.5px] pl-[18px] pr-2 text-sm font-bold no-underline transition-colors motion-reduce:transition-none",
                active ? "border-dash-navy bg-dash-navy text-white hover:text-white" : "border-dash-line-strong bg-white text-dash-navy hover:bg-dash-subtle hover:text-dash-navy",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "grid h-7 min-w-7 place-items-center rounded-full px-2 text-[13px] font-extrabold",
                  hot ? "bg-dash-red text-white" : active ? "bg-dash-navy-hover text-white" : "bg-dash-subtle text-dash-ink-2",
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Filters are a GET form: they show up in the address bar. Searching by ID/passport number is not supported. */}
      <form method="get" action={ROUTES.staff} role="search" className="flex flex-col gap-2.5">
        {filters.tab !== "all" ? <input type="hidden" name="tab" value={filters.tab} /> : null}
        {filters.sort !== "newest" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
        <div className="flex flex-wrap items-center gap-2.5">
          <label className={cn(field, "flex min-w-[240px] flex-1 items-center gap-2.5 px-4 font-normal")}>
            <Search aria-hidden className="size-4 flex-none text-dash-ink-3" strokeWidth={2.75} />
            <span className="sr-only">Ara</span>
            <input
              name="q"
              type="search"
              defaultValue={filters.query}
              maxLength={80}
              placeholder="Ad, soyad, e-posta veya başvuru no"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-dash-navy outline-none placeholder:text-dash-ink-4 focus-visible:outline-none"
            />
          </label>
          <label htmlFor="stage" className="sr-only">
            Aşama
          </label>
          <select id="stage" name="stage" defaultValue={filters.stage === null ? "" : String(filters.stage)} className={selectClass}>
            <option value="">Tüm aşamalar</option>
            {LIST_STAGE_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <label htmlFor="type" className="sr-only">
            Başvuru tipi
          </label>
          <select id="type" name="type" defaultValue={filters.type ?? ""} className={cn(selectClass, "max-w-[210px]")}>
            <option value="">Tüm tipler</option>
            {APPLICATION_TYPES_BY_LABEL.map((type) => (
              <option key={type} value={type}>
                {APPLICATION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <SortSelect value={filters.sort} hrefs={{ newest: href({ sort: "newest" }), oldest: href({ sort: "oldest" }) }} />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <FilterCheck name="drafts" checked={filters.drafts}>
            Taslakları göster
          </FilterCheck>
          <FilterCheck name="completed" checked={filters.closed}>
            Tamamlananları göster
          </FilterCheck>
          <span className="ml-auto flex items-center gap-2.5">
            {filtered ? (
              <Link href={ROUTES.staff} className={adminButton("ghost", "lg", "px-3.5 text-dash-ink-2 hover:bg-dash-clear-hover hover:text-dash-ink-2")}>
                Temizle
              </Link>
            ) : null}
            <button type="submit" className={adminButton("primary", "lg", "px-6 font-extrabold")}>
              Filtrele
            </button>
          </span>
        </div>
      </form>

      <section aria-label="Başvuru listesi" className="overflow-hidden rounded-[22px] border border-dash-line bg-white">
        <div className={cn("hidden border-b border-dash-line-soft px-6 py-3.5 text-xs font-bold tracking-[0.06em] text-dash-ink-3 min-[1200px]:grid", GAPS, COLUMNS)} aria-hidden>
          <span>BAŞVURU</span>
          <span>DURUM VE SIRA</span>
          <span>ÖDEME</span>
          <span>EVRAKLAR</span>
          <span>RANDEVU</span>
          <span className="text-right">GÜNCELLEME</span>
        </div>
        {result.rows.length === 0 ? (
          <div className="flex flex-col items-start gap-1.5 px-6 py-12">
            <span className="text-base font-extrabold">Bu görünümde başvuru yok</span>
            <span className="text-sm text-dash-ink-2">Filtreleri temizleyin veya başka bir sekme seçin.</span>
          </div>
        ) : (
          result.rows.map((row) => <ListRow key={row.id} row={row} />)
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-dash-line-faint px-6 py-3.5 text-[13px] text-dash-ink-3">
          <span className="mr-auto" role="status">
            {result.total} başvuru gösteriliyor{filters.drafts ? " · taslaklar dahil" : ""}
            {result.hiddenClosed > 0 ? ` · ${CLOSED_VISIBLE_DAYS} günden eski ${result.hiddenClosed} tamamlanmış başvuru gizli` : ""}
            {result.pageCount > 1 ? ` · Sayfa ${Math.min(filters.page, result.pageCount)} / ${result.pageCount}` : ""}
          </span>
          {result.pageCount > 1 ? (
            <nav aria-label="Sayfalama" className="flex gap-2">
              {filters.page > 1 ? (
                <Link href={`${ROUTES.staff}${adminListQuery(filters, { page: filters.page - 1 })}`} className={adminButton("secondary", "sm")}>
                  Önceki
                </Link>
              ) : null}
              {filters.page < result.pageCount ? (
                <Link href={`${ROUTES.staff}${adminListQuery(filters, { page: filters.page + 1 })}`} className={adminButton("secondary", "sm")}>
                  Sonraki
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
