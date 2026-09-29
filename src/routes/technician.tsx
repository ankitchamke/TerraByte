import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RoleGuard, Shell } from "@/components/tb";

export const Route = createFileRoute("/technician")({
  ssr: false,
  component: () => (
    <RoleGuard role="technician">
      <Shell role="technician">
        <Outlet />
      </Shell>
    </RoleGuard>
  ),
});
