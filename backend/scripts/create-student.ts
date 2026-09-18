import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/**
 * Creates a student account (admin-only operation). Students cannot
 * self-register; the platform has no public signup.
 * Usage: npm run create-student -- --email s1@school.edu --password 'TempPass123!' [--name "Jane Doe"] [--grade 11]
 */

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required (see `supabase status -o env` for local keys).");
  process.exit(1);
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const email = arg("email");
const password = arg("password");
const fullName = arg("name") ?? null;
const grade = arg("grade") ? Number(arg("grade")) : null;
if (!email || !password) {
  console.error("Usage: npm run create-student -- --email <email> --password <password> [--name \"Jane Doe\"] [--grade 11]");
  process.exit(1);
}

const svc = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUserByEmail(email: string): Promise<string | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

const existingId = await findUserByEmail(email);
let userId: string;

if (existingId) {
  userId = existingId;
  console.log(`User ${email} already exists (id ${userId})`);
} else {
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    console.error("createUser failed:", error.message);
    process.exit(1);
  }
  userId = data.user!.id;
  console.log(`Created ${email} (id ${userId})`);
}

const { error: upErr } = await svc
  .from("profiles")
  .update({ full_name: fullName ?? undefined })
  .eq("id", userId);
if (upErr) {
  console.error("profile update failed:", upErr.message);
  process.exit(1);
}

if (grade !== null) {
  const { error: gErr } = await svc
    .from("student_profiles")
    .upsert({ id: userId, grade_level: String(grade) }, { onConflict: "id" });
  if (gErr) {
    console.error("student_profiles update failed:", gErr.message);
    process.exit(1);
  }
}

console.log("Student ready:");
console.log("  email:    " + email);
console.log("  password: " + password);
console.log("  name:     " + (fullName ?? "-"));
console.log("  grade:    " + (grade ?? "-"));
