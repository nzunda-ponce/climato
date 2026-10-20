"use client";
import { useEffect, useState } from "react";
export default function StorageStatus() {
  const [readOnly, setReadOnly] = useState(true);
  const [message, setMessage] = useState("Verificando almacenamiento…");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/storage", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        setReadOnly(data.readOnly === true);
        setMessage(
          data.cloud
            ? "Datos guardados en la nube"
            : data.backend === "postgresql"
              ? "PostgreSQL local · nube pendiente de configurar"
              : "Datos locales · nube pendiente de configurar",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage("No se pudo verificar el almacenamiento");
      });
    return () => controller.abort();
  }, []);
  return (
    <span>
      {message}
      {!readOnly && (
        <>
          {" "}
          · <a href="/api/export">Descargar respaldo</a>
        </>
      )}
    </span>
  );
}
