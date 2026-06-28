ALTER TABLE iam.user_preference
    ADD CONSTRAINT fk_user_preference_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE;