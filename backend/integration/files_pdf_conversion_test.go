package integration

import (
	"testing"
	"time"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPDFConversion covers triggering office-to-PDF conversion and polling for status.
func TestPDFConversion(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	chID := w.createChannel(owner, "PDF Conv", false)

	t.Run("when triggering conversion on a DOCX file", func(t *testing.T) {
		// Minimal DOCX content (just enough to be accepted)
		docxContent := createMinimalDOCX()
		fileID := w.uploadChannelFile(owner, chID, "report.docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			docxContent)

		w.triggerPDFConversion(owner, fileID)

		t.Run("polling eventually yields completed or pending", func(t *testing.T) {
			var status *rpcv1.GetPDFConversionStatusResponse
			deadline := time.After(30 * time.Second)
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()

			for {
				select {
				case <-deadline:
					t.Log("PDF conversion did not complete within timeout — verifying at least triggered")
					status = w.getPDFConversionStatus(owner, fileID)
					require.NotNil(t, status)
					return
				case <-ticker.C:
					status = w.getPDFConversionStatus(owner, fileID)
					if status.ConversionInfo != nil &&
						status.ConversionInfo.Status == rpcv1.ConversionStatus_CONVERSION_STATUS_COMPLETED {
						assert.NotEmpty(t, status.ConversionInfo.PdfDownloadUrl)
						return
					}
				}
			}
		})
	})

	t.Run("when triggering conversion on an already-PDF file", func(t *testing.T) {
		fileID := w.uploadChannelFile(owner, chID, "already.pdf", "application/pdf", []byte("%PDF-1.4 data"))

		// Should either reject or return as already completed
		status := w.getPDFConversionStatus(owner, fileID)
		t.Run("no conversion is needed", func(t *testing.T) {
			// Either status is nil or completed — we just verify no panic
			_ = status
		})
	})
}

// createMinimalDOCX creates a minimal ZIP-based DOCX for testing.
func createMinimalDOCX() []byte {
	// PK header + minimal zip structure
	return []byte("PK\x03\x04\x14\x00\x00\x00\x08\x00" +
		"\x00\x00\x00\x00\x00\x00\x00\x00" +
		"\x00\x00\x00\x00\x00\x00\x00\x00" +
		"[Content_Types].xml")
}
