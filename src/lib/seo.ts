export const meta = (title: string, description: string) => ({
  meta: [
    { title: `${title} — TerraByte` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — TerraByte` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ],
});
