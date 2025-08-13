// tailwind.config.js
export default {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx,js,jsx,mdx}",
    "./src/components/**/*.{ts,tsx,js,jsx,mdx}",
    "./src/pages/**/*.{ts,tsx,js,jsx,mdx}",
  ],
  theme: { extend: {} },
  plugins: [require("tailwindcss-animate")],
};
