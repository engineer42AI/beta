import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const idToken = cookies().get("e42_it")?.value;

  if (!idToken) {
    redirect("/api/auth/login");
  }

  return <>{children}</>; // No <html> or <body> here
}
