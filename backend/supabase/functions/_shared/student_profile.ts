export type StudentProfileStatus = "incomplete" | "pending" | "approved";

export interface RequiredStudentProfile {
  full_name: string | null | undefined;
  phone_number: string | null | undefined;
  parent_name: string | null | undefined;
  parent_phone_number: string | null | undefined;
}

export function hasRequiredStudentProfile(profile: RequiredStudentProfile): boolean {
  return [
    profile.full_name,
    profile.phone_number,
    profile.parent_name,
    profile.parent_phone_number,
  ].every((value) => typeof value === "string" && value.trim().length > 0);
}

export function nextStudentProfileStatus(
  currentStatus: StudentProfileStatus,
  current: RequiredStudentProfile,
  submitted: RequiredStudentProfile,
): StudentProfileStatus {
  const unchanged = (Object.keys(current) as Array<keyof RequiredStudentProfile>)
    .every((key) => (current[key] ?? "").trim() === (submitted[key] ?? "").trim());
  return currentStatus === "approved" && unchanged ? "approved" : "pending";
}
