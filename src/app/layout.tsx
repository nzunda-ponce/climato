import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./console.css";
import DevAutoReload from "@/components/DevAutoReload";
export const metadata: Metadata = {
  title: "Climato · Planificación de uniformidades",
  robots: { index: false, follow: false },
  description:
    "Planificación de ensayos por ubicación, escenarios de días aptos y validación de pronósticos.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <DevAutoReload />
        {children}
      </body>
    </html>
  );
}
