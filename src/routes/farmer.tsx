import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RoleGuard, Shell } from "@/components/tb";

export const Route = createFileRoute("/farmer")({
  ssr: false,
  component: () => (
    <RoleGuard role="farmer">
      <Shell role="farmer">
        <Outlet />
      </Shell>
    </RoleGuard>
  ),
});
