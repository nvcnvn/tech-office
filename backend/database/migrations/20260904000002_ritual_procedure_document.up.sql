-- Feature 043: a ritual definition can carry a written procedure.
--
-- One nullable column pointing at an existing workspace document in the same
-- organization. No new table, no snapshot, no back-reference on the document:
-- the attachment is a reference, so one document can be the procedure of many
-- definitions across many projects with no bookkeeping.
--
-- The implicit read it grants is a *path* through internal/collaboration, not a
-- row in docs.document_access, which is why clearing the column ends the access
-- with nothing to revoke.

ALTER TABLE collaboration.ritual_definition
    ADD COLUMN IF NOT EXISTS procedure_document_id uuid;

COMMENT ON COLUMN collaboration.ritual_definition.procedure_document_id IS
    'The workspace document that is this ritual''s written procedure. NULL means no procedure. Readers of an instance may read this document without their own docs grant, through CollaborationService.GetRitualProcedure only.';

-- Composite and organization-leading, per Constitution I: a single-column
-- reference would permit a cross-organization attachment that FR-003 forbids.
-- ON DELETE RESTRICT matches the existing fk_task_description. Documents are
-- soft-deleted, so this never fires in normal operation; SET NULL was rejected
-- because it would silently turn "the procedure was deleted" (a visible loss)
-- into "there was never a procedure" (a silent absence).
ALTER TABLE collaboration.ritual_definition
    DROP CONSTRAINT IF EXISTS fk_ritual_definition_procedure;

ALTER TABLE collaboration.ritual_definition
    ADD CONSTRAINT fk_ritual_definition_procedure
        FOREIGN KEY (organization_id, procedure_document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE RESTRICT;

-- Deliberately no index: the column is only ever read from a definition already
-- located by primary key, and nothing asks "which definitions use this document".

-- SearchDocuments now matches d.title as well as d.content_text. The procedure
-- picker searches by document name, and without a PGroonga index on the title
-- that predicate degrades to a sequential scan on every keystroke.
CREATE INDEX IF NOT EXISTS idx_document_title_pgroonga
    ON docs.document USING pgroonga (title);
