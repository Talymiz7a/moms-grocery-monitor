import { Notice, PageHeader } from "../components/ui";

const CONTENT: Record<string, { title: string; stage: string; items: string[] }> = {
  analysis: {
    title: "ניתוח מוצרים",
    stage: "שלב 2",
    items: [
      "גרף עמודות מקובצות: מוצרים × 12 חודשים, לפי מספר מופעי רכישה (לא כמות)",
      "בחירת שנה ומוצרים, 10 המובילים כברירת מחדל, מעבר בין גרף לטבלה וייצוא",
      "למוצר נבחר: מופעים וכמות לפי חודש, ימים בין רכישות, השוואה לחודשים קודמים והיסטוריית מחירים",
    ],
  },
  alerts: {
    title: "התראות ובקרה",
    stage: "שלב 3",
    items: [
      "זיהוי שקוף וניתן להגדרה: תדירות חריגה, כמות חריגה, רכישות צפופות, מוצר חדש, מוצר לא צפוי, קבלה כפולה וסכום גבוה",
      "לכל התראה: הסבר, תאריכים, כמויות, בסיס השוואה היסטורי וקישור לקבלות",
      "סטטוסים: ממתין לבדיקה · נבדק והוסבר · נדרש בירור נוסף, עם הערות ותאריך טיפול",
    ],
  },
};

export function ComingSoon({ page }: { page: "analysis" | "alerts" }) {
  const c = CONTENT[page];
  return (
    <>
      <PageHeader title={c.title} />
      <Notice title={`המסך ייבנה ב${c.stage}`}>
        <p className="mb-2">שלב 1 כולל את מסד הנתונים, הממשק, ההעלאה, הקריאה והבדיקה הידנית. במסך זה יופיעו:</p>
        <ul className="list-inside list-disc space-y-1">
          {c.items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </Notice>
    </>
  );
}
