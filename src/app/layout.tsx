// src/app/layout.tsx
import type { Metadata } from "next";

// your globals (Tailwind etc.)
import "./globals.css";

// Base editor CSS
import "prosemirror-view/style/prosemirror.css";

import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Engineer42 UI",
  description: "shadcn sidebar + React Flow skeleton",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-dvh overflow-y-clip" suppressHydrationWarning>
      <body className="h-full overflow-y-clip bg-background text-foreground">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
