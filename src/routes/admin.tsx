import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RoleGuard, Shell } from "@/components/tb";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: () => (
    <RoleGuard role="admin">
      <Shell role="admin" wide>
        <Outlet />
      </Shell>
    </RoleGuard>
  ),
});
