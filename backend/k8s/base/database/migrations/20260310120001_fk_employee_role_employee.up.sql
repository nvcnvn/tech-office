ALTER TABLE iam.employee_role
    ADD CONSTRAINT fk_employee_role_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE;