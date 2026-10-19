import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./console.css";
export const metadata: Metadata = {
  title: "Climato · Viabilidad climática",
  description:
    "Disponibilidad climática para completar los ensayos antes de fin de año.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
