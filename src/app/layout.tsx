import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Engineer42 UI",
  description: "shadcn sidebar + React Flow skeleton",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
