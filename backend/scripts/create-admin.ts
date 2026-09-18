import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/**
 * Admin bootstrap: creates the first admin account and promotes it.
 * Usage: npm run create-admin -- --email admin@school.edu --password 'TempPass123!'
 * Env: SUPABASE_URL (default local), SUPABASE_SERVICE_ROLE_KEY (required),
 *      APP_ADMIN_EMAIL / APP_ADMIN_PASSWORD fallbacks.
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

const email = arg("email") ?? process.env.APP_ADMIN_EMAIL;
const password = arg("password") ?? process.env.APP_ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Usage: npm run create-admin -- --email <email> --password <password>");
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

const { error: upErr } = await svc.from("profiles").update({ role: "admin" }).eq("id", userId);
if (upErr) {
  console.error("promote failed:", upErr.message);
  process.exit(1);
}

const { error: studentProfileErr } = await svc.from("student_profiles").delete().eq("id", userId);
if (studentProfileErr) {
  console.error("student profile cleanup failed:", studentProfileErr.message);
  process.exit(1);
}

console.log("Admin ready:");
console.log("  email:   " + email);
console.log("  password: " + password);
console.log("  role:    admin");
console.log("Promote more admins by re-running this script with their credentials.");
