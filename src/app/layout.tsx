import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Sous-Chef — Recipe Library",
  description:
    "Save recipes from any URL, view and customize their ingredients and steps, and build a grocery list when you're ready.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
