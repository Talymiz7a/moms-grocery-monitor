import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Analysis } from "./pages/Analysis";
import { Alerts } from "./pages/Alerts";
import { Dashboard } from "./pages/Dashboard";
import { ProductDetail } from "./pages/ProductDetail";
import { ProductsSettings } from "./pages/ProductsSettings";
import { Reports } from "./pages/Reports";
import { ReceiptDetail } from "./pages/ReceiptDetail";
import { Receipts } from "./pages/Receipts";
import { Review } from "./pages/Review";
import { Settings } from "./pages/Settings";
import { Upload } from "./pages/Upload";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/receipts" element={<Receipts />} />
        <Route path="/receipts/:id" element={<ReceiptDetail />} />
        <Route path="/receipts/:id/review" element={<Review />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/analysis/products/:id" element={<ProductDetail />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/products" element={<ProductsSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
