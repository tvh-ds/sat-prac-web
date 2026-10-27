// This exception belongs to one existing College Board deck, not to PDF imports generally.
export const COLLEGEBOARD_RW_BANK_IMPORT_ID = "5a255e65-742d-41e1-ba7c-ca0379257ebc";

export function isCollegeBoardRwBank(importId: string | undefined): boolean {
  return importId === COLLEGEBOARD_RW_BANK_IMPORT_ID;
}
