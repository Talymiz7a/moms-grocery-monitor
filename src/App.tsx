import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ComingSoon } from "./pages/ComingSoon";
import { Dashboard } from "./pages/Dashboard";
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
        <Route path="/analysis" element={<ComingSoon page="analysis" />} />
        <Route path="/alerts" element={<ComingSoon page="alerts" />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
