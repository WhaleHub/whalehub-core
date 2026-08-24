import { existsSync } from "node:fs";

/** Manual kill switch: presence of the file means "cancel all offers and idle". */
export function killSwitchActive(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}
