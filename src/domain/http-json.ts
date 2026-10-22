// API failures can be HTML (404, proxy errors, an expired development build).
// Never expose an HTML parser exception as if it were a model result.
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new Error(
      `No se pudieron cargar los datos (HTTP ${response.status}). El servidor devolvió una página en lugar de datos. Reintentá en unos segundos.`,
    );
  let data: T & { error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "La respuesta de datos llegó incompleta. Reintentá la consulta.",
    );
  }
  if (!response.ok)
    throw new Error(
      data?.error ||
        `No se pudieron cargar los datos (HTTP ${response.status}).`,
    );
  return data;
}
