/** Question numbers restart in every module; never use them alone as storage keys. */
export function stimulusAssetKey(section: string, moduleName: string | null, question: number | null, id: string): string {
  const module = moduleName?.match(/(?:module\s*)?(\d+)\s*$/i)?.[1] ?? "unknown";
  return `${section === "math" ? "math" : "rw"}-${module}-q${question ?? "unknown"}-${id}`;
}
