"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"              // toggles 'class' on <html>
      defaultTheme="system"          // light/dark based on OS by default
      enableSystem
      disableTransitionOnChange      // avoids flash when switching
    >
      {children}
    </NextThemesProvider>
  );
}
