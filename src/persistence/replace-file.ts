import { promises as fs } from "node:fs";
import { setTimeout } from "node:timers/promises";

// Windows file watchers and sync clients can briefly block replacement.
// Keep the previous file intact and retry the atomic rename.
export async function replaceFile(source: string, destination: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt >= 7)
        throw error;
      await setTimeout(100 * (attempt + 1));
    }
  }
}
