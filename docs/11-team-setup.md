# 11 · Team setup

How a new teammate gets running, and how to connect Resend for email.

## 1. Run the app locally

Prerequisites: Node 20+, [pnpm](https://pnpm.io/installation) (`brew install pnpm` on a Mac), Git, and access to the GitHub repo.

```bash
git clone https://github.com/athul16/assessment-platform.git
cd assessment-platform
pnpm install
cp .env.example .env.local
```

Fill in `.env.local` (values from Supabase → project **assessment-platform** → Project Settings → API Keys). Get the secret key from Athul privately; never commit it, never paste it in chat, never prefix it with `NEXT_PUBLIC_`.

```bash
pnpm dev            # http://localhost:3000
pnpm test:engine    # engine unit tests, no network
pnpm test:rls       # cross-company isolation tests against the cloud database
```

There is no local database. Everyone develops against the shared cloud project, so:

- Schema changes go **only** through new files in `supabase/migrations/`, never through the Supabase dashboard table editor.
- After a migration is applied, regenerate `src/lib/database.types.ts` and run `pnpm test:rls`.
- Test data: the tests create and delete their own throwaway users and companies. Don't leave test data behind.

## 2. Get access to Supabase (Athul does this)

The `assessment-platform` project lives in its **own Supabase organization** (moved out of "athul16's Org" on 2026-11-08), so inviting someone here gives them this project only.

1. [supabase.com/dashboard](https://supabase.com/dashboard) → organization menu (top left) → pick the org that holds **assessment-platform**.
2. **Settings → Team → Invite**.
3. Enter the teammate's email and a role:

   | Role | Use for | Can change Auth/SMTP settings? |
   | --- | --- | --- |
   | Administrator | Setting up Resend, Auth URLs, anything in settings | Yes |
   | Developer | Day-to-day coding and reading the database | No |

   Start with **Administrator** for whoever connects Resend; lower it to Developer afterwards.
4. They get an email, accept it, and the project appears in their dashboard.
5. Send them the **secret key** privately (password manager or similar) for their `.env.local`. Never by git, chat, or email.

### If Supabase says "you need additional permissions"

This can show up even for the owner, especially right after creating an org or moving a project. In order:

1. Hard-refresh the page (Cmd+Shift+R / Ctrl+Shift+R).
2. Sign out of Supabase and back in.
3. Org → **Settings → Team**: confirm your row says **Owner**.
4. Check you're signed in with the same account that created the org (avatar menu, top right). GitHub login and email login are different accounts.
5. If the org requires MFA, set up an authenticator app under your account settings first.

### Tools connected to the old org

The project's URL and API keys didn't change when it moved, so the app, `.env.local`, and the tests keep working. But anything authorized per organization (for example the Supabase connector used by Claude, or a Vercel integration) must be re-authorized for the new org.

## 3. Connect Resend (email)

Why: Supabase's built-in email sends only 2 emails an hour and only to members of the Supabase team, so invites and sign-up confirmations can't reach real users until a real provider is connected (decision Q1: Resend for everything).

You need a domain you control (DNS access), e.g. `example.com`. Email will be sent from a subdomain such as `mail.example.com`, which keeps the main domain's reputation separate.

### 3a. Resend account and domain

1. Create an account at [resend.com](https://resend.com). The free plan is fine for building (3,000/month, 100/day). Move to Pro ($20/month) before the first real hiring round.
2. **Domains → Add domain** → enter the subdomain (e.g. `mail.example.com`), region **us-east-1** (same as Supabase).
3. Resend shows DNS records (MX, TXT for SPF, TXT for DKIM). Add them exactly at the domain's DNS provider, then click **Verify**. It can take a few minutes to a few hours.
4. Recommended: add a DMARC record on the main domain if there isn't one (`_dmarc.example.com`, TXT, `v=DMARC1; p=none;` to start).
5. **API Keys → Create API key** with "Sending access", restricted to that domain. Copy it once; it isn't shown again. Store it in a password manager.

### 3b. Point Supabase Auth at Resend

Either use Resend's one-click integration (Resend dashboard → **Integrations → Supabase**, pick the `assessment-platform` project), or enter SMTP by hand:

Supabase → project **assessment-platform** → **Authentication → Emails → SMTP Settings** → enable custom SMTP:

| Field | Value |
| --- | --- |
| Sender email | e.g. `no-reply@mail.example.com` (must be on the verified domain) |
| Sender name | e.g. `Assessment Platform` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key |

Then **Authentication → Rate Limits**: raise "emails sent per hour" from the default (30 with custom SMTP) to fit a hiring round, e.g. 200.

### 3c. Check it works

1. Supabase → Authentication → Users → **Invite user** → send to your own real email.
2. It should arrive from your sender address within a minute and not in spam. Check the Resend dashboard → **Emails** for the delivery log.
3. Delete that test user afterwards.

### 3d. Later, for the app's own emails

Candidate invite links, 6-digit codes, and reminders are sent by the app, not Supabase Auth. When that's built (skeleton step 3), add the same key as a server-only env var:

```
RESEND_API_KEY=re_...
EMAIL_FROM="Assessment Platform <no-reply@mail.example.com>"
```

in `.env.local` and in Vercel's environment variables.

## 4. Auth URL settings (Athul or an Administrator)

Supabase → Authentication → **URL Configuration**:

- **Site URL:** the deployed Vercel URL once it exists (until then `http://localhost:3000`).
- **Redirect URLs:** `http://localhost:3000/**` and, once deployed, `https://<vercel-domain>/**`.

Without these, links in emails send people to the wrong place.
