package integration

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestContentIndexing covers file content extraction, the honesty of the status it
// reports, and the fact that indexing content opens no new route to a file.
//
// The rule that makes these scenarios evidence rather than decoration: a marker phrase
// appears ONLY in a file's body, never in the filename it is uploaded under. A test that
// puts the same slug in both passes against an extractor that does nothing, because the
// filename match alone returns the file. Removing the extractor must turn every
// "returned by a phrase from its body" assertion red — see SC-008.
func TestContentIndexing(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	chID := w.createChannel(owner, "Indexing", false)

	// Every actor is built here, in order, and before anything that moves the world's
	// current organisation. withUsersFromDifferentOrgs registers two fresh orgs and
	// leaves w.OrgID pointing at the second, so an employee created after it would land
	// in a stranger's organisation — and then "cannot find the file" would be true for
	// the wrong reason. These two must genuinely share the owner's org.
	sameOrgOutsider := w.withEmployee()
	unattachedEmployee := w.withEmployee()
	require.Equal(t, owner.OrgID, sameOrgOutsider.OrgID, "outsider must share the owner's organization")
	require.Equal(t, owner.OrgID, unattachedEmployee.OrgID, "unattached employee must share the owner's organization")
	_, otherOrgUser := w.withUsersFromDifferentOrgs()
	require.NotEqual(t, owner.OrgID, otherOrgUser.OrgID)

	// settleTimeout covers a plain-text extraction (tens of milliseconds) and an office
	// document that must go through Gotenberg first (several seconds), with room for a
	// loaded CI machine.
	const settleTimeout = 60 * time.Second

	t.Run("when a text file's body shares no word with its filename", func(t *testing.T) {
		phrase := uniqueSlug("BODYPHRASE")
		body := "Method statement for confined space entry. " + phrase + " applies throughout."
		filename := uniqueSlug("attachment") + ".txt"
		fileID := w.uploadChannelFile(owner, chID, filename, "text/plain", []byte(body))

		index := w.waitForContentIndex(owner, fileID, settleTimeout)
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus(),
			"text extraction should complete: %s", index.GetErrorMessage())

		// FR-001, FR-012, SC-001, SC-002
		t.Run("the file is returned by a phrase from its body", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, phrase, fileID),
				"a phrase that appears only in the body must return the file")
		})

		// FR-011: content indexing adds a way to find a file; it removes none.
		t.Run("the file is also still returned by its filename", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, strings.TrimSuffix(filename, ".txt"), fileID))
		})

		// FR-013, SC-003
		t.Run("a member of another organization searching that phrase gets nothing", func(t *testing.T) {
			assert.Empty(t, w.searchFiles(otherOrgUser, phrase, 20).Results)
		})

		// FR-013, SC-003
		t.Run("a member of the same organization outside the file's channel gets nothing", func(t *testing.T) {
			assert.False(t, w.fileIsFound(sameOrgOutsider, phrase, fileID),
				"channel membership, not file content, decides who can find a file")
		})

		// FR-013, SC-003
		t.Run("an employee who belongs to no channel and no department gets nothing", func(t *testing.T) {
			assert.Empty(t, w.searchFiles(unattachedEmployee, phrase, 20).Results,
				"an employee with no accessible context must match nothing at all")
		})
	})

	// FR-012: PGroonga indexes the stored text with no per-language configuration, so a
	// script with no word boundaries has to work the same way Latin script does.
	t.Run("when a file's body is in a non-Latin script", func(t *testing.T) {
		marker := uniqueSlug("JP")
		body := "会議の議事録です。" + marker + "。安全手順を確認しました。"
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("minutes")+".txt", "text/plain", []byte(body))

		index := w.waitForContentIndex(owner, fileID, settleTimeout)
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus())

		t.Run("a phrase in that script returns the file", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, "安全手順", fileID),
				"a phrase in a non-Latin script must return the file")
		})
	})

	// FR-014, Story 4 scenario 3: deletion wins over the index.
	t.Run("when a file matching by content is soft-deleted", func(t *testing.T) {
		phrase := uniqueSlug("DELETED")
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("doomed")+".txt", "text/plain",
			[]byte("Retention notice. "+phrase+" was recorded here."))

		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED,
			w.waitForContentIndex(owner, fileID, settleTimeout).GetStatus())
		require.True(t, w.fileIsFound(owner, phrase, fileID), "precondition: findable before deletion")

		w.deleteFile(owner, fileID)

		t.Run("it is no longer returned", func(t *testing.T) {
			assert.False(t, w.fileIsFound(owner, phrase, fileID),
				"a deleted file must stop being returned by a content term")
		})
	})

	// ---------------------------------------------------------------------
	// User Story 2 — find a PDF, and a Word document, by what is written in it
	// ---------------------------------------------------------------------

	// FR-002, SC-002
	t.Run("when a PDF containing selectable text is uploaded", func(t *testing.T) {
		phrase := uniqueSlug("INPDF")
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("handbook")+".pdf",
			"application/pdf", pdfWithText(phrase))

		index := w.waitForContentIndex(owner, fileID, settleTimeout)
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus(),
			"PDF extraction should complete: %s", index.GetErrorMessage())

		t.Run("a phrase from inside the PDF returns it", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, phrase, fileID))
		})

		// FR-008
		t.Run("its recorded extraction method is the PDF reader", func(t *testing.T) {
			assert.Equal(t, rpcv1.ExtractionMethod_EXTRACTION_METHOD_PDF_PARSER, index.GetExtractionMethod())
		})
	})

	// FR-003, FR-004, SC-002
	t.Run("when a word-processor document is uploaded", func(t *testing.T) {
		phrase := uniqueSlug("INDOCX")
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("procedure")+".docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			docxWithText(phrase))

		index := w.waitForContentIndex(owner, fileID, settleTimeout)
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus(),
			"office extraction should complete: %s", index.GetErrorMessage())

		t.Run("a phrase from inside it returns the document", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, phrase, fileID))
		})

		// FR-008: the method names the file that was read, not the route it took. The
		// document was read via its converted PDF, but what the user gave us was an
		// office document, and that is what the record says.
		t.Run("its recorded extraction method is the office reader, not the PDF reader", func(t *testing.T) {
			assert.Equal(t, rpcv1.ExtractionMethod_EXTRACTION_METHOD_OFFICE_PARSER, index.GetExtractionMethod())
		})
	})

	// FR-003, SC-002
	t.Run("when a spreadsheet is uploaded", func(t *testing.T) {
		phrase := uniqueSlug("INXLSX")
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("budget")+".xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			xlsxWithText(phrase))

		index := w.waitForContentIndex(owner, fileID, settleTimeout)
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus(),
			"spreadsheet extraction should complete: %s", index.GetErrorMessage())

		t.Run("a phrase from inside a cell returns the spreadsheet", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, phrase, fileID))
		})
	})

	// FR-002, Story 2 scenario 5: no OCR, and no pretending otherwise. A page with
	// nothing selectable on it yields nothing, and that is a completion, not a failure.
	t.Run("when a PDF has no selectable text", func(t *testing.T) {
		name := uniqueSlug("scanned")
		fileID := w.uploadChannelFile(owner, chID, name+".pdf", "application/pdf", pdfWithoutText())

		index := w.waitForContentIndex(owner, fileID, settleTimeout)

		t.Run("indexing completes with no extracted text", func(t *testing.T) {
			assert.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus(),
				"an empty document is indexed successfully and empty: %s", index.GetErrorMessage())
			assert.Zero(t, index.GetTextLength())
		})

		// FR-011
		t.Run("the file remains findable by its filename", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, name, fileID))
		})
	})

	// FR-008, FR-011, FR-018
	t.Run("when extraction fails for a file", func(t *testing.T) {
		name := uniqueSlug("corrupt")
		// Magic bytes say PDF, so the file is detected as one and routed to the PDF
		// reader; the body is not a PDF, so the read fails.
		corrupt := append([]byte("%PDF-1.4\n"), []byte("this body is not a PDF at all")...)
		fileID := w.uploadChannelFile(owner, chID, name+".pdf", "application/pdf", corrupt)

		index := w.waitForContentIndex(owner, fileID, settleTimeout)

		t.Run("its status reports failed with a short reason", func(t *testing.T) {
			require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_FAILED, index.GetStatus())
			reason := index.GetErrorMessage()
			assert.NotEmpty(t, reason, "a failure must say something")
			assert.Less(t, len(reason), 120, "the stored reason is a short phrase, not a dump")
			// FR-018: no infrastructure detail reaches the caller.
			for _, leak := range []string{"org-", "r2", "http", "amazonaws", "cloudflare", "goroutine", ".go:"} {
				assert.NotContains(t, strings.ToLower(reason), leak,
					"the caller-facing reason must not carry infrastructure detail")
			}
		})

		t.Run("the file is still returned by a filename search", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, name, fileID),
				"a failed extraction must not cost the file its filename search")
		})

		t.Run("the file is still downloadable", func(t *testing.T) {
			url, err := w.getDownloadURL(owner, fileID)
			assert.NoError(t, err)
			assert.NotEmpty(t, url)
		})
	})

	// ---------------------------------------------------------------------
	// User Story 3 — see honestly whether a file's content has been indexed
	// ---------------------------------------------------------------------

	// FR-016, SC-005: "unspecified" was the answer in every case. It must now be the
	// answer in none of them.
	t.Run("when a file's content index status is requested straight after upload", func(t *testing.T) {
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("fresh")+".txt", "text/plain",
			[]byte("A short body indexed almost immediately."))
		status := w.getContentIndexStatus(owner, fileID).IndexInfo.GetStatus()

		t.Run("it reports queued or extracting, never unspecified", func(t *testing.T) {
			// Extraction can already have finished by the time the query lands, which is
			// a fourth honest answer — but never "unspecified", and never "no record".
			assert.Contains(t, []rpcv1.IndexingStatus{
				rpcv1.IndexingStatus_INDEXING_STATUS_PENDING,
				rpcv1.IndexingStatus_INDEXING_STATUS_IN_PROGRESS,
				rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED,
			}, status, "a file queued for indexing must say so")
			assert.NotEqual(t, rpcv1.IndexingStatus_INDEXING_STATUS_UNSPECIFIED, status)
		})
	})

	t.Run("when indexing has settled", func(t *testing.T) {
		before := time.Now().Add(-time.Minute)
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("settled")+".txt", "text/plain",
			[]byte("A body long enough to measure. "+uniqueSlug("SETTLED")))
		index := w.waitForContentIndex(owner, fileID, settleTimeout)

		// FR-016
		t.Run("it reports completed", func(t *testing.T) {
			assert.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus())
		})

		// FR-017: these two were absent from every response before this feature.
		t.Run("it names the extraction method used", func(t *testing.T) {
			assert.Equal(t, rpcv1.ExtractionMethod_EXTRACTION_METHOD_PLAIN_TEXT, index.GetExtractionMethod())
		})

		// FR-008
		t.Run("it reports the extraction duration and the stored text length", func(t *testing.T) {
			assert.GreaterOrEqual(t, index.GetDurationMs(), int32(0))
			assert.Greater(t, index.GetTextLength(), int32(0))
		})

		// FR-017
		t.Run("it reports when the status last changed", func(t *testing.T) {
			require.NotNil(t, index.GetUpdatedAt(), "last-changed time must be present")
			assert.True(t, index.GetUpdatedAt().AsTime().After(before),
				"last-changed time must be this run's, not the zero value")
		})
	})

	// FR-016: "we do not read this kind of file" is a real answer, not an absence.
	t.Run("when the file is an image, a video or an archive", func(t *testing.T) {
		cases := []struct {
			name     string
			mimeType string
			body     []byte
		}{
			{"image", "image/png", pngBytes()},
			{"video", "video/mp4", []byte("\x00\x00\x00\x18ftypmp42not-a-real-video")},
			{"archive", "application/zip", zipParts(map[string]string{"[Content_Types].xml": "<x/>"})},
		}

		for _, tc := range cases {
			fileID := w.uploadChannelFile(owner, chID, uniqueSlug(tc.name)+"."+tc.name, tc.mimeType, tc.body)
			index := w.waitForContentIndex(owner, fileID, settleTimeout)

			t.Run("it reports that this file type is not content-indexed ("+tc.name+")", func(t *testing.T) {
				assert.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_NOT_APPLICABLE, index.GetStatus())
			})

			// FR-016, SC-005
			t.Run("and this is a distinct answer from unspecified and from an error ("+tc.name+")", func(t *testing.T) {
				assert.NotEqual(t, rpcv1.IndexingStatus_INDEXING_STATUS_UNSPECIFIED, index.GetStatus())
				assert.NotEqual(t, rpcv1.IndexingStatus_INDEXING_STATUS_FAILED, index.GetStatus())
				assert.Empty(t, index.GetErrorMessage(), "not reading a file type is not an error")
			})
		}
	})

	// FR-016: a file uploaded before this feature existed has no row, and saying
	// "indexed, and empty" about it would be a lie.
	t.Run("when the file predates content indexing", func(t *testing.T) {
		fileID := w.seedIndexableFileWithoutIndex(owner, uniqueSlug("legacy")+".txt")

		t.Run("it reports never indexed rather than indexed-and-empty", func(t *testing.T) {
			index := w.getContentIndexStatus(owner, fileID).IndexInfo
			assert.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_NEVER_INDEXED, index.GetStatus())
			assert.Zero(t, index.GetTextLength())
		})
	})

	// FR-016: the handler has to load the file to answer at all, so it can finally tell
	// "no such file" apart from "no index for this file".
	t.Run("when the file id is unknown in the caller's organization", func(t *testing.T) {
		t.Run("it returns not found", func(t *testing.T) {
			err := w.getContentIndexStatusError(owner, dbuuid.Must().String())
			require.Error(t, err)
			assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
		})
	})

	// ---------------------------------------------------------------------
	// User Story 4 — re-running indexing does not corrupt or duplicate
	// ---------------------------------------------------------------------

	// FR-009
	t.Run("when indexing runs twice for the same file", func(t *testing.T) {
		phrase := uniqueSlug("TWICE")
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("reindexed")+".docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			docxWithText(phrase))
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED,
			w.waitForContentIndex(owner, fileID, settleTimeout).GetStatus())

		// TriggerPDFConversion re-enqueues the whole post-processing workflow, which is
		// the production path by which a file gets indexed a second time.
		w.triggerPDFConversion(owner, fileID)
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED,
			w.waitForContentIndex(owner, fileID, settleTimeout).GetStatus())

		t.Run("exactly one stored result remains", func(t *testing.T) {
			assert.Equal(t, 1, w.countContentIndexRows(owner, fileID),
				"a retry must replace the stored result, not add a second one")
		})

		t.Run("the file appears exactly once in search results", func(t *testing.T) {
			assert.Equal(t, 1, w.countFileInResults(owner, phrase, fileID))
		})
	})

	// FR-009: the reason a file failed is not permanent truth about that file.
	t.Run("when a failed file is indexed again successfully", func(t *testing.T) {
		phrase := uniqueSlug("RECOVERED")
		fileID := w.seedFailedContentIndex(owner, uniqueSlug("retried")+".txt", "extraction failed")

		w.reindexFileContent(owner, fileID, phrase)
		index := w.getContentIndexStatus(owner, fileID).IndexInfo

		t.Run("the status becomes completed", func(t *testing.T) {
			assert.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus())
		})

		t.Run("the previous failure reason is cleared", func(t *testing.T) {
			assert.Empty(t, index.GetErrorMessage(),
				"a success must clear the reason a previous attempt failed, not keep it")
		})
	})

	// FR-019, SC-007: today every image upload logs a failed job. A JPEG that the system
	// correctly declines to read is a job that did exactly what it was built to do.
	t.Run("when an image is uploaded", func(t *testing.T) {
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("photo")+".png", "image/png", pngBytes())
		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_NOT_APPLICABLE,
			w.waitForContentIndex(owner, fileID, settleTimeout).GetStatus())

		t.Run("the post-processing job reports completed, not failed", func(t *testing.T) {
			assert.Equal(t, "completed", w.postProcessingOutcome(fileID),
				"every step skipping is a completed job, not a failed one")
		})
	})

	// ---------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------

	// FR-007: truncation is not a failure.
	t.Run("when a text file exceeds the stored-text cap", func(t *testing.T) {
		phrase := uniqueSlug("EARLY")
		// The marker sits in the first kilobyte, well inside the kept portion; the
		// padding that follows pushes the body past the 1 MiB cap.
		body := "Opening section. " + phrase + " appears here. " +
			strings.Repeat("padding sentence for bulk. ", 60000)
		require.Greater(t, len(body), 1<<20, "fixture must actually exceed the cap")

		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("bulky")+".txt", "text/plain", []byte(body))
		index := w.waitForContentIndex(owner, fileID, settleTimeout)

		t.Run("indexing completes rather than failing", func(t *testing.T) {
			assert.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED, index.GetStatus(),
				"a file larger than the cap is truncated, not failed: %s", index.GetErrorMessage())
		})

		t.Run("the file is findable on a phrase within the kept portion", func(t *testing.T) {
			assert.True(t, w.fileIsFound(owner, phrase, fileID))
		})

		t.Run("the reported text length equals what was stored", func(t *testing.T) {
			assert.LessOrEqual(t, index.GetTextLength(), int32(1<<20),
				"reported length must describe the stored text, not the source file")
			assert.Greater(t, index.GetTextLength(), int32(0))
		})
	})

	// FR-006: the client's claim about a file's type does not decide how it is read.
	t.Run("when a file is declared as text but is binary in fact", func(t *testing.T) {
		fileID := w.uploadChannelFile(owner, chID, uniqueSlug("mislabelled")+".txt", "text/plain", pngBytes())

		index := w.waitForContentIndex(owner, fileID, settleTimeout)

		t.Run("eligibility follows the server-detected type, not the client's claim", func(t *testing.T) {
			assert.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_NOT_APPLICABLE, index.GetStatus(),
				"an image declared as text is an image: it is not content-indexed")
		})
	})

	// FR-013, SC-003: the access rule is the sole authority on visibility. A file with no
	// rule is reachable by nobody, whatever its stored text says.
	t.Run("when a file has no access-rule row", func(t *testing.T) {
		phrase := uniqueSlug("ORPHAN")
		fileID := w.seedIndexedFileWithoutAccessRule(owner, uniqueSlug("orphan")+".txt", phrase)

		t.Run("indexing its content does not make it findable", func(t *testing.T) {
			assert.False(t, w.fileIsFound(owner, phrase, fileID),
				"stored text must not be a route to a file that no rule grants")
		})
	})
}
