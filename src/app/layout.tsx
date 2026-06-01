import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Top Tech Companies",
  description: "Largest technology companies ranked by market cap, earnings, and revenue.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4">
            <h1 className="text-xl font-semibold tracking-tight">Top Tech Companies</h1>
            <p className="text-sm text-gray-500">
              Ranked by market cap, earnings, and revenue · data from Financial Modeling Prep
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
