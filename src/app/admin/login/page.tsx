"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Login failed");
        setLoading(false);
        return;
      }
      // Hard-navigate so the RootLayout re-executes with the new sc_admin
      // cookie. router.push + router.refresh keeps the Next.js router cache
      // entry for `/` around, and the header stays on the pre-login RSC
      // payload — so the "Admin sign in" button doesn't disappear until a
      // manual reload.
      window.location.href = "/";
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <h1 className="text-lg font-semibold text-stone-900">Admin sign in</h1>
      <p className="text-sm text-stone-500 mt-1">
        Browsing is public — sign in only to add or edit recipes.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="submit"
          disabled={!password || loading}
          className="w-full px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
        {error && <p className="text-sm text-red-600">⚠️ {error}</p>}
      </form>
    </main>
  );
}
