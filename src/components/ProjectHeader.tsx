"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";

export default function ProjectHeader() {
  const pathname = usePathname();
  const modelView = pathname === "/data-science";
  const showResults = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      pathname !== "/" ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    window.location.hash = "resumen";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <header className="project-header">
      <div className="project-header-inner">
        <Link
          href="/"
          className="project-brand"
          onClick={showResults}
          aria-label="Climato, panel de resultados"
        >
          <span aria-hidden="true">c.</span>climato
        </Link>
        <nav className="project-views" aria-label="Vistas principales">
          <Link
            href="/"
            onClick={showResults}
            aria-current={!modelView ? "page" : undefined}
          >
            Resultados
          </Link>
          <Link
            href="/data-science"
            aria-current={modelView ? "page" : undefined}
          >
            Explicación de ML
          </Link>
        </nav>
      </div>
    </header>
  );
}
