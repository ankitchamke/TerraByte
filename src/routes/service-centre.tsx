import { createFileRoute, redirect } from "@tanstack/react-router";

/** Alias for the existing service centre workspace. */
export const Route = createFileRoute("/service-centre")({
  beforeLoad: () => { throw redirect({ to: "/admin" }); },
});
