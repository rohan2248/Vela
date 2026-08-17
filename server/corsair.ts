import "dotenv/config";
import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { pool } from "@/lib/db";

export const corsair = createCorsair({
  plugins: [gmail(), googlecalendar()],
  database: pool,
  kek: process.env.CORSAIR_KEK!,
  multiTenancy: true,
});
