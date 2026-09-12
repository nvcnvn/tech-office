-- Feature 059: file content search that actually searches content.
--
-- Drop `image_ocr` from the extraction-method CHECK constraint. Nothing has ever
-- written a row to files.file_content_index and the system performs no OCR, so the
-- value named a capability that does not exist. No data migration is needed: there is
-- no stored value that can violate the narrower constraint.

ALTER TABLE files.file_content_index
    DROP CONSTRAINT file_content_index_extraction_method_check;

ALTER TABLE files.file_content_index
    ADD CONSTRAINT file_content_index_extraction_method_check
    CHECK (extraction_method IN ('office_parser', 'pdf_parser', 'plain_text'));

COMMENT ON COLUMN files.file_content_index.extraction_method IS
'Method used to extract text: office_parser (word processor, spreadsheet and presentation
formats, read via their Gotenberg-converted PDF), pdf_parser (PDF), plain_text (text/*,
JSON, XML). MUST align with backend constants in internal/files/constants.go.';
