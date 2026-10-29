import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppStateProvider } from "./state/AppState";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = createRoot(document.getElementById("root")!);

if (!url) {
  root.render(
    <div dir="rtl" style={{ padding: 32, fontFamily: "Heebo, sans-serif" }}>
      <h1>האפליקציה עדיין לא חוברה למסד הנתונים</h1>
      <p>חסר משתנה הסביבה VITE_CONVEX_URL.</p>
    </div>,
  );
} else {
  const convex = new ConvexReactClient(url);
  root.render(
    <StrictMode>
      <ConvexProvider client={convex}>
        <AppStateProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AppStateProvider>
      </ConvexProvider>
    </StrictMode>,
  );
}
