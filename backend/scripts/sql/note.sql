-- organization_id := '019a206c-2146-7140-bee9-b591e1a92c3b';
WITH vars AS (
    SELECT '019a206c-2146-7140-bee9-b591e1a92c3b'::UUID AS org_id
)
, company AS (
        SELECT id,
        company_name,
        subdomain,
        updated_at,
        client_id
        FROM public.organization, vars
        WHERE id = vars.org_id
)
, identity AS (
    SELECT id,
        organization_id,
        email,
        identity_type,
        updated_at
    FROM iam.identity, vars
    WHERE organization_id = vars.org_id
)
, employee AS (
    SELECT id,
        organization_id,
        given_name,
        family_name,
        hire_date,
        date_of_birth,
        phone_number,
        home_address,
        additional_info,
        updated_at
    FROM organization.employee, vars
    WHERE organization_id = vars.org_id
)
SELECT * FROM employee;

SELECT * FROM iam.identity WHERE organization_id IS NULL;
DELETE FROM iam.identity WHERE organization_id IS NULL;