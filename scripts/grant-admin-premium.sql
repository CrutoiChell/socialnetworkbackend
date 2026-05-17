-- One-time script: grant ADMIN + Premium to current account.
-- Usage example:
--   psql "$DATABASE_URL" -v account_email="'you@example.com'" -v account_username="'your_username'" -f scripts/grant-admin-premium.sql
--
-- Pass either account_email or account_username (or both).

WITH target_user AS (
  SELECT id
  FROM users
  WHERE
    (COALESCE(:account_email, '') <> '' AND email = :account_email)
    OR
    (COALESCE(:account_username, '') <> '' AND username = :account_username)
  ORDER BY id DESC
  LIMIT 1
)
UPDATE users u
SET
  role = 'ADMIN',
  "isPremium" = true,
  "premiumUntil" = NOW() + INTERVAL '365 days',
  "boostTokens" = GREATEST(COALESCE(u."boostTokens", 0), 3),
  "boostTokensRefreshedAt" = NOW()
FROM target_user t
WHERE u.id = t.id;

-- Verify result:
SELECT id, email, username, role, "isPremium", "premiumUntil", "boostTokens"
FROM users
WHERE
  (COALESCE(:account_email, '') <> '' AND email = :account_email)
  OR
  (COALESCE(:account_username, '') <> '' AND username = :account_username);
