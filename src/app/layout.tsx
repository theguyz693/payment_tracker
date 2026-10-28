import type { Metadata, Viewport } from "next";
import "@fontsource-variable/public-sans";
import "./globals.css";
import { ClientBoot } from "@/components/ClientBoot";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: { default: "Payment Tracker", template: "%s · Payment Tracker" },
  description: "Know what you need to pay and what you're owed.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e131b" },
  ],
};

// Applies the saved theme before first paint (no flash). Runs before React.
const themeScript = `document.documentElement.classList.add("js");try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <ToastProvider>
          <ClientBoot />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
