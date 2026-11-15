/**
 * Runs in every node-project test worker before each test file. Loads the
 * local test database settings from .env.test and refuses to continue if the
 * configured Supabase is not local (see tests/helpers/env.ts).
 */
import { assertLocalSupabase, loadTestEnv } from "../helpers/env";

loadTestEnv();
assertLocalSupabase();
// Emails must land in .dev-outbox, never go out through Resend.
delete process.env.RESEND_API_KEY;
// No test may call the real Claude API: shadow scoring sees no key and skips.
delete process.env.ANTHROPIC_API_KEY;
