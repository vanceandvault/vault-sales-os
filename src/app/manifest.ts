import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VAULT SALES OS", short_name: "VAULT", description: "Privater Sales-Assistent von VAULT STUDIO", lang: "de-CH",
    start_url: "/", scope: "/", display: "standalone", orientation: "portrait", background_color: "#070B12", theme_color: "#070B12",
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  };
}
