-- Lets one document hold several files.
--
-- A driving licence has a front and a back; an insurance certificate runs to
-- several pages. Modelling one file per document forced those to be separate
-- records that happened to share a number, which is not what they are.
--
-- The file columns move off `documents` onto `document_files`, so `documents`
-- keeps only what describes the document itself -- owner, type, number, expiry
-- -- and the files hang off it in display order.
--
-- Safe to re-run: the table is created only if absent, the copy skips rows
-- already carried across, and the columns are dropped only while they exist.

CREATE TABLE IF NOT EXISTS document_files (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id   INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  -- Server-generated, relative to the uploads root. Unique so the same stored
  -- file can never be claimed by two rows.
  stored_path   VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  checksum      CHAR(64)     NOT NULL,
  -- Front before back, page 1 before page 2.
  sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_document_files_stored_path (stored_path),
  KEY idx_document_files_document (document_id, sort_order),
  CONSTRAINT fk_document_files_document
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @db := DATABASE();

-- Carry any existing single file across before the columns go.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'stored_path') = 1,
  'INSERT INTO document_files (document_id, original_name, stored_path, mime_type, size_bytes, checksum, sort_order)
     SELECT d.id, d.original_name, d.stored_path, d.mime_type, d.size_bytes, d.checksum, 0
       FROM documents d
      WHERE NOT EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'documents' AND INDEX_NAME = 'uq_documents_stored_path') > 0,
  'ALTER TABLE documents DROP INDEX uq_documents_stored_path', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'stored_path') = 1,
  'ALTER TABLE documents
     DROP COLUMN original_name, DROP COLUMN stored_path, DROP COLUMN mime_type,
     DROP COLUMN size_bytes, DROP COLUMN checksum',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'document_files') AS files_table_want_1,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'stored_path') AS old_columns_want_0,
  (SELECT COUNT(*) FROM documents) AS documents,
  (SELECT COUNT(*) FROM document_files) AS files;
