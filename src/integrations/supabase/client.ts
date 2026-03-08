import { createClient } from "@supabase/supabase-js";
import { ENV } from "../../config/env.js";

export const supabaseAdmin = createClient(
  ENV.SUPABASE_URL,
  ENV.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: "public" },
  }
);
