import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import { AdminProvider } from "@/components/AdminProvider";
import { isAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sous-Chef — Recipe Library",
  description:
    "Save recipes from any URL, view and customize their ingredients and steps, and build a grocery list when you're ready.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await isAdmin();
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50">
        <AdminProvider isAdmin={admin}>
          <SiteHeader isAdmin={admin} />
          {children}
        </AdminProvider>
      </body>
    </html>
  );
}
