"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { UserRole } from "@/lib/ontology/entities";
import { isRouteAllowed } from "@/lib/rbac/nav-access";

/**
 * Client-side route guard that redirects restricted roles
 * to /dashboard/access-restricted when they navigate to
 * a route outside their allowed set.
 */
export default function RoleGuard({
  role,
  children,
}: {
  role: UserRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const allowed = isRouteAllowed(role, pathname);

  useEffect(() => {
    if (!allowed) {
      router.replace("/dashboard/access-restricted");
    }
  }, [allowed, router]);

  if (!allowed) return null;

  return <>{children}</>;
}
