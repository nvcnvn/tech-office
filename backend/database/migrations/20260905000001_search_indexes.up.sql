-- Feature 045: Server-Side Federated Search — the two missing full-text indexes.
--
-- Two of the eight search sources match full text with no index behind them, which is
-- the most likely single cause of missing the sub-second search budget. The other two
-- full-text sources this feature touches are already covered: collaboration.task has
-- idx_task_title_pgroonga and docs.document has idx_document_title_pgroonga plus
-- idx_document_pgroonga, so no index is added for them.

CREATE INDEX IF NOT EXISTS idx_event_pgroonga
    ON calendar.event USING pgroonga (title, description);

COMMENT ON INDEX calendar.idx_event_pgroonga IS
    'PGroonga index for multilingual full-text search on event title and description. '
    'Added by feature 045: SearchEvents previously used an unindexed to_tsvector(''simple'') '
    'match and scanned every event in the database on every search.';

CREATE INDEX IF NOT EXISTS idx_file_metadata_filename_pgroonga
    ON files.file_metadata USING pgroonga (original_filename);

COMMENT ON INDEX files.idx_file_metadata_filename_pgroonga IS
    'PGroonga index for multilingual full-text search on uploaded file names. '
    'SearchFilesByNameAndContent has always matched original_filename with &@~; only the '
    'extracted content side was indexed.';
