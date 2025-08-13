# Engineer42 UI – Starter Template (Next.js + shadcn/ui + Tailwind CSS + React Flow)

## This is a starter template for building the Engineer42 platform UI with:

- Next.js – modern React framework for building web apps
- shadcn/ui – prebuilt, customizable UI components
- Tailwind CSS – utility-first CSS framework
- React Flow – for building interactive diagrams
- TypeScript – typed JavaScript for fewer errors

It includes:
- A collapsible sidebar (from shadcn/ui)
- Project structure with src/ folder
- Tailwind CSS configured
- Common helper utilities
- Ready-to-use setup for adding components

## 🚀 How to Set Up This Project From Scratch
These are the steps I followed to get to this point. You can reuse this README whenever you need to start fresh.

# 1. Create a new Next.js project
```bash 
npx create-next-app@latest beta
```

Options I chose:
- TypeScript: Yes
- ESLint: Yes
- Tailwind CSS: Yes
- src/ directory: Yes
- Turbopack: Yes (faster dev builds)
- Custom import alias: No (@/* default)

# 2. Move into the project folder
```bash
cd beta
```

# 3. Install shadcn/ui and initialize

```bash
npm install shadcn-ui@latest
npx shadcn@latest init
```

4. Add required helper file for shadcn components

Create **src/lib/utils.ts**:

```bash
import { type ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

# 5. Install required dependencies
```bash
npm install clsx tailwind-merge class-variance-authority @radix-ui/react-slot
npm install @radix-ui/react-scroll-area @radix-ui/react-tooltip
```

# 6. Check tsconfig.json alias

Ensure:

"paths": {
  "@/*": ["./src/*"]
}

# 7. Update Tailwind config

In tailwind.config.js:
```bash
export default {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx,js,jsx,mdx}",
    "./src/components/**/*.{ts,tsx,js,jsx,mdx}",
    "./src/pages/**/*.{ts,tsx,js,jsx,mdx}"
  ],
  theme: { extend: {} },
  plugins: [require("tailwindcss-animate")],
};
```

# 8. Run the dev server

npm run dev

Visit: http://localhost:3000

📂 Project Structure

src/
  app/          → Next.js app router pages
  components/   → Reusable UI components
  lib/          → Utility functions
public/         → Static assets (images, icons, etc.)

🛠 Useful Commands

Command

What it does

npm install

Installs dependencies

npm run dev

Runs the dev server locally

npm run build

Builds the app for production

npm start

Runs the production build locally

📘 Understanding npm and npx

npm installs packages and manages dependencies.

npx runs packages without installing them globally.

🔗 Connecting to GitHub
```bash
git init
git remote add origin git@github.com:<YOUR_USERNAME>/beta.git
git add .
git commit -m "Initial commit - shadcn sidebar + React Flow skeleton"
git branch -M main
git push -u origin main
```

📦 .gitignore Essentials

node_modules
.next
.env

📝 Next Steps

Add React Flow in main content area

Expand sidebar

Integrate Stripe + AWS Cognito

Deploy to AWS EC2 or Vercel