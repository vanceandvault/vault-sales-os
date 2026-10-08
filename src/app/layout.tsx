import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { QuickUpdate } from "@/components/QuickUpdate";
import { supabaseServer } from "@/lib/supabase/server";
import { SwRegister } from "@/components/SwRegister";

export const metadata: Metadata = {
  title: "VAULT SALES OS", description: "Privater Sales-Assistent von VAULT STUDIO",
  manifest: "/manifest.webmanifest", icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "VAULT", statusBarStyle: "black-translucent" }, robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#070B12", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer(); const { data } = await sb.auth.getUser();
  return (
    <html lang="de-CH">
      <body>
        {data.user ? (
          <>
            <Nav />
            <main className="mx-auto max-w-3xl px-4 pb-40 md:ml-60 md:max-w-4xl md:px-10 md:pb-24">{children}</main>
            <QuickUpdate />
          </>
        ) : children}
        <SwRegister />
      </body>
    </html>
  );
}
