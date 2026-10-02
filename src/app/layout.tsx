import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ASSISTANT_BOOT_SCRIPT } from "@/components/assistant/boot";
import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "./providers";
import "./globals.css";

// Inter with the optical-size axis: display cuts at 48px titles and hero numbers (STYLE.md 2).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Wefty", template: "%s · Wefty" },
  description: "Agent-assisted delivery from requirements to PO sign-off: BRD, architecture, implementation, QA certification and review, on weft (mock).",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f11" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-svh bg-background text-foreground">
        {/* Before first paint: reserve the docked assistant's column if it was left open. */}
        <script dangerouslySetInnerHTML={{ __html: ASSISTANT_BOOT_SCRIPT }} />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
