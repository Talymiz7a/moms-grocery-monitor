import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { ReceiptStatusChips } from "../components/ReceiptStatus";
import { Card, EmptyState, Loading, Notice, PageHeader, StatCard } from "../components/ui";
import { formatIls, formatIsoDate } from "../lib/format";
import { useAppState } from "../state/AppState";

export function Dashboard() {
  const { dataset } = useAppState();
  const s = useQuery(api.receipts.dashboardSummary, { dataset });
  if (s === undefined) return <Loading />;

  return (
    <>
      <PageHeader
        title="לוח בקרה"
        subtitle={
          s.firstDate ? (
            <>
              תקופה: <span className="num">{formatIsoDate(s.firstDate)}</span> – <span className="num">{formatIsoDate(s.lastDate)}</span> · קבלות שנבדקו בלבד
            </>
          ) : (
            "עדיין אין קבלות שנבדקו"
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="קבלות שנבדקו" value={s.receiptCount} to="/receipts?filter=verified" />
        <StatCard label="מוצרים שונים" value={s.distinctProducts} hint="זהות מוצר מאושרת" />
        <StatCard label="מופעי רכישה" value={s.purchaseOccasions} hint="מוצר × קבלה (לא כמות)" />
        <StatCard label="סך הוצאה" value={formatIls(s.totalSpendAgorot)} />
        <StatCard label="התראות פתוחות" value={s.openAlertCount} hint="זיהוי חריגות — שלב 3" to="/alerts" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xl font-bold">דורש בדיקה</h2>
          <ul className="mb-4 flex flex-wrap gap-2 text-sm">
            <li><Link className="text-brand-700 underline" to="/receipts?filter=draft">{s.draftCount} ממתינות לבדיקה</Link></li>
            <li>· {s.duplicateCount} כפולות אפשריות</li>
            <li>· {s.mismatchCount} עם פער בסכום</li>
            <li>· {s.missingTotalCount} ללא סכום כולל</li>
          </ul>
          {s.needsReview.length === 0 ? (
            <EmptyState title="אין קבלות שממתינות לבדיקה" />
          ) : (
            <ReceiptMiniList rows={s.needsReview} review />
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-xl font-bold">קבלות אחרונות</h2>
          {s.recent.length === 0 ? <EmptyState title="אין עדיין קבלות" /> : <ReceiptMiniList rows={s.recent} />}
        </Card>
      </div>

      <div className="mt-6">
        <Notice title="בשלבים הבאים">
          גרף מופעי רכישה חודשי, מוצרים מובילים, סינון לפי חודש/שנה/טווח ודפוסים חריגים יתווספו בשלבים 2–4, לפי האפיון.
        </Notice>
      </div>
    </>
  );
}

type MiniRow = {
  _id: string;
  purchaseDate?: string;
  storeName?: string;
  totalAgorot?: number;
  itemCount: number;
  verificationStatus: "draft" | "verified";
  ocrConfidence?: "high" | "medium" | "low";
  reconciliationStatus?: "match" | "mismatch" | "no_total" | "no_lines";
  differenceAgorot: number | null;
  duplicateSuspected: boolean;
};

function ReceiptMiniList({ rows, review = false }: { rows: MiniRow[]; review?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r._id}>
          <Link to={review ? `/receipts/${r._id}/review` : `/receipts/${r._id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-page">
            <span className="num w-24 font-medium">{r.purchaseDate ? formatIsoDate(r.purchaseDate) : "—"}</span>
            <span className="min-w-28 flex-1">{r.storeName ?? "חנות לא ידועה"}</span>
            <span className="num font-semibold">{formatIls(r.totalAgorot)}</span>
            <span className="basis-full">
              <ReceiptStatusChips r={r} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
