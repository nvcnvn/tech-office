package files

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"

	"github.com/nvcnvn/tech-office/backend/database"
)

// extractPlainText reads a text object into a string, bounded by MaxSourceReadBytes.
//
// The bound is on the read rather than on the file's recorded size, because the size a
// client declared at upload is not evidence about the bytes that were actually stored.
func extractPlainText(r io.Reader) (string, error) {
	var sb strings.Builder
	n, err := io.Copy(&sb, io.LimitReader(r, MaxSourceReadBytes))
	if err != nil {
		return "", fmt.Errorf("read source object: %w", err)
	}
	if n == MaxSourceReadBytes {
		return "", errSourceTooLarge
	}
	return sb.String(), nil
}

var errSourceTooLarge = errors.New("source object exceeds the readable size bound")

// collapseWhitespace folds every run of whitespace into a single space and trims the
// ends.
//
// This is not cosmetic. LibreOffice pads every line of a rendered page out to the page
// width, so the raw text of a one-line PDF measured 5,022 bytes against 88 bytes
// collapsed. Storing the padding would spend the 1 MiB cap on spaces.
func collapseWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// truncateToBytes cuts s to at most max bytes on a rune boundary, and reports whether it
// cut anything. Cutting mid-rune would store invalid UTF-8, which PGroonga indexes and
// then returns as mojibake in a snippet.
func truncateToBytes(s string, max int) (string, bool) {
	if len(s) <= max {
		return s, false
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut], true
}

// callerSafeReason maps an internal extraction error to the short string stored in
// indexing_error and handed to any caller who asks why indexing failed.
//
// FR-018: the stored reason must never carry a hostname, a credential, a storage key or
// a stack trace. The full error goes to the log, where an operator can see it and a
// tenant cannot. Anything unrecognised collapses to a generic phrase rather than being
// passed through, because passing an unknown error through is exactly how an internal
// detail escapes.
func callerSafeReason(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, errSourceTooLarge):
		return "file too large to index"
	case errors.Is(err, errNoConvertedPDF):
		return "office conversion unavailable"
	case errors.Is(err, context.DeadlineExceeded):
		return "extraction timed out"
	case errors.Is(err, context.Canceled):
		return "extraction was interrupted"
	case errors.Is(err, os.ErrNotExist):
		return "stored file is unavailable"
	case errors.Is(err, errUnreadableDocument):
		return "the document could not be read"
	default:
		return "extraction failed"
	}
}

var (
	errNoConvertedPDF     = errors.New("no converted PDF is available for this document")
	errUnreadableDocument = errors.New("document could not be read")
)

// awaitDetectedType waits, briefly, for the concurrent validation workflow to record the
// file's detected MIME type, and returns the freshest metadata it managed to read.
//
// FR-006 says eligibility follows the server-detected type rather than the client's
// claim. Detection runs in its own workflow, enqueued in the same transaction as this
// one, so without a wait the two race and the answer depends on which worker was free.
// The wait is bounded: on timeout the caller proceeds on the declared type, because
// indexing a file on a slightly worse signal beats refusing to index it because a virus
// scanner was busy.
func awaitDetectedType(ctx context.Context, svc *FilePostProcessingServices, file *database.FilesFileMetadatum) *database.FilesFileMetadatum {
	if file.ValidationStatus.String != ValidationStatusPending {
		return file
	}

	deadline := time.Now().Add(detectionSettleTimeout)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return file
		case <-time.After(detectionPollInterval):
		}

		fresh, err := svc.Queries.GetFileByID(ctx, svc.AdminPool, &database.GetFileByIDParams{
			OrganizationID: file.OrganizationID,
			ID:             file.ID,
		})
		if err != nil {
			return file
		}
		if fresh.ValidationStatus.String != ValidationStatusPending {
			return fresh
		}
		file = fresh
	}

	slog.WarnContext(ctx, "file type detection did not settle; indexing on the declared type",
		"file_id", file.ID,
		"declared_mime_type", file.MimeType)
	return file
}

const (
	// detectionSettleTimeout bounds the wait for file type detection. Detection reads
	// 8 KiB of magic bytes and a virus scan runs beside it, so this is generous.
	detectionSettleTimeout = 15 * time.Second
	detectionPollInterval  = 250 * time.Millisecond
)

// extractText reads a file's text by the method its type calls for.
//
// Office documents are read through the PDF that step 1 of this same workflow produced:
// one extractor covers PDF, the OOXML family, the legacy binary Office family and
// OpenDocument, instead of four parsers that would each need their own maintenance.
func extractText(ctx context.Context, svc *FilePostProcessingServices, method string, input *ExtractContentInput) (string, error) {
	switch method {
	case ExtractionMethodPlainText:
		body, err := svc.R2Client.GetReader(ctx, input.StorageKey)
		if err != nil {
			return "", fmt.Errorf("open stored object: %w", err)
		}
		defer body.Close()
		return extractPlainText(body)

	case ExtractionMethodPDFParser:
		return readPDFFromStorage(ctx, svc, input.StorageKey)

	case ExtractionMethodOfficeParser:
		// Empty means step 1 skipped or failed. Recording that plainly beats reporting
		// success with no text, which would tell a searcher the document holds nothing.
		if input.PDFStorageKey == "" {
			return "", errNoConvertedPDF
		}
		return readPDFFromStorage(ctx, svc, input.PDFStorageKey)

	default:
		return "", fmt.Errorf("no extractor for method %q", method)
	}
}

// readPDFFromStorage buffers a stored object and reads its text.
//
// The PDF reader needs an io.ReaderAt, so the object cannot be streamed; the read is
// bounded by MaxSourceReadBytes so an oversized file records a failure instead of
// exhausting the worker.
func readPDFFromStorage(ctx context.Context, svc *FilePostProcessingServices, storageKey string) (string, error) {
	body, err := svc.R2Client.GetReader(ctx, storageKey)
	if err != nil {
		return "", fmt.Errorf("open stored object: %w", err)
	}
	defer body.Close()

	buf, err := io.ReadAll(io.LimitReader(body, MaxSourceReadBytes))
	if err != nil {
		return "", fmt.Errorf("read stored object: %w", err)
	}
	if len(buf) == MaxSourceReadBytes {
		return "", errSourceTooLarge
	}
	return extractPDF(buf)
}

// extractPDF reads the selectable text out of a PDF.
//
// The recover is not defensive padding. ledongthuc/pdf documents itself as incomplete and
// its Value API does not report errors, so a malformed or unusual document can panic
// inside the library on input a tenant chose. FR-011 requires that to become a recorded
// failure that leaves the file findable by name, not a worker that disappears.
func extractPDF(data []byte) (text string, err error) {
	defer func() {
		if r := recover(); r != nil {
			text = ""
			err = fmt.Errorf("%w: %v", errUnreadableDocument, r)
		}
	}()

	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("%w: %v", errUnreadableDocument, err)
	}

	plain, err := reader.GetPlainText()
	if err != nil {
		return "", fmt.Errorf("%w: %v", errUnreadableDocument, err)
	}

	var sb strings.Builder
	if _, err := io.Copy(&sb, io.LimitReader(plain, MaxSourceReadBytes)); err != nil {
		return "", fmt.Errorf("%w: %v", errUnreadableDocument, err)
	}
	return sb.String(), nil
}
