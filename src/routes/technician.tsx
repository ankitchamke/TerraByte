import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { RoleGuard, Shell } from "@/components/tb";

export const Route = createFileRoute("/technician")({
  ssr: false,
  component: TechnicianLayout,
});

function TechnicianLayout() {
  const pending = useLocation().pathname.startsWith("/technician/pending");
  return (
    <RoleGuard role="technician" allowUnverified={pending}>
      {pending ? <Outlet /> : <Shell role="technician"><Outlet /></Shell>}
    </RoleGuard>
  );
}
