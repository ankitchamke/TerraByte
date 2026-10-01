import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => { throw redirect({ to: "/login" }); },
  head: () => ({
    meta: [
      { title: "TerraByte — Get your farm machine back to work" },
      { name: "description", content: "TerraByte coordinates agricultural equipment repairs from breakdown to service history." },
      { property: "og:title", content: "TerraByte — Get your farm machine back to work" },
      { property: "og:description", content: "Breakdown reporting, matched technicians, transparent quotes and live repair tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
