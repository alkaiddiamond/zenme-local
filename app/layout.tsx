import type { Metadata } from "next";
import { Suspense } from "react";
import "@xyflow/react/dist/style.css";
import { AppShell } from "@/components/zenme/app-shell";
import { ThemeController } from "@/components/zenme/theme-controller";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://127.0.0.1"),
  title: "Zenme",
  description: "Local-first AI project desktop app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeScript = `(()=>{let t='light';try{const s=localStorage.getItem('zenme.theme.v1');if(s==='dark'||s==='system'||s==='light')t=s}catch{}const d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches),e=document.documentElement;e.classList.toggle('dark',d);e.dataset.theme=t;e.style.colorScheme=d?'dark':'light'})()`;

  return (
    <html
      data-theme="light"
      lang="zh-CN"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeController />
        <Suspense fallback={null}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
