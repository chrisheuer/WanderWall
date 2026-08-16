import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Wanderwall — walkable 3D galleries",
    template: "%s — Wanderwall",
  },
  description:
    "Create a walkable 3D gallery of your photos or artworks, style the space, and share it by link.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="site-header">
            <Link href="/" className="wordmark">
              Wanderwall
            </Link>
            <nav className="nav-links">
              <Link href="/featured">Featured</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/studio">Studio</Link>
            </nav>
          </header>
        </div>
        {children}
      </body>
    </html>
  );
}
