import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

function getEnv(name: string): string {
  return (process.env[name] || "").trim();
}

async function main() {
  const adminEmail = getEnv("DEFAULT_ADMIN_EMAIL").toLowerCase();
  const adminName = getEnv("DEFAULT_ADMIN_NAME") || "Default Admin";

  if (!adminEmail) {
    console.log("Skipping admin seed: DEFAULT_ADMIN_EMAIL is not set.");
    return;
  }

  const now = new Date();
  const [seeded] = await db
    .insert(users)
    .values({
      email: adminEmail,
      name: adminName,
      role: "admin",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        role: "admin",
        name: adminName,
        updatedAt: now,
      },
    })
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
    });

  console.log(`Default admin ready: ${seeded.email} (${seeded.role})`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to seed default admin:", error);
    process.exit(1);
  });
