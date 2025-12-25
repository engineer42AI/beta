// src/lib/env.ts
export const APP_ENV =
  process.env.NEXT_PUBLIC_APP_ENV ?? "development";

export const IS_PROD = APP_ENV === "production";
export const IS_DEV = !IS_PROD;