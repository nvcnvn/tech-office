-- name: GetOrganizationBySubdomain :one
-- Resolves organization ID from subdomain for login UI
-- Called before frontend initiates OIDC flow
-- Example: subdomain="acme" → {id: uuid, company_name: "Acme Corporation"}
SELECT *
FROM public.organization
WHERE subdomain = $1
LIMIT 1;

-- name: GetOrganizationByID :one
-- Organization row by id, used where only the display name is needed.
SELECT *
FROM public.organization
WHERE id = $1;
