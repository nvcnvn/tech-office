package files

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// GotenbergClient converts documents to PDFs using Gotenberg.
//
// Current usage: LibreOffice conversion endpoint.
// See: POST /forms/libreoffice/convert
//
// Keep this client minimal and dependency-free.
type GotenbergClient struct {
	baseURL string
	http    *http.Client
}

func NewGotenbergClient(baseURL string) *GotenbergClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	return &GotenbergClient{
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

// ConvertLibreOfficeToPDF streams the given input file to Gotenberg and returns a reader for the PDF response.
//
// filename is used by LibreOffice to infer format (extension matters).
func (c *GotenbergClient) ConvertLibreOfficeToPDF(ctx context.Context, filename string, input io.Reader) (pdf io.ReadCloser, contentLength int64, err error) {
	if c == nil || c.http == nil {
		return nil, 0, fmt.Errorf("gotenberg client not configured")
	}
	if c.baseURL == "" {
		return nil, 0, fmt.Errorf("gotenberg base URL not configured")
	}

	endpoint := c.baseURL + "/forms/libreoffice/convert"

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)

	writeErrCh := make(chan error, 1)
	go func() {
		defer func() {
			_ = mw.Close()
			_ = pw.Close()
		}()

		part, err := mw.CreateFormFile("files", filename)
		if err != nil {
			writeErrCh <- err
			_ = pw.CloseWithError(err)
			return
		}

		_, err = io.Copy(part, input)
		if err != nil {
			writeErrCh <- err
			_ = pw.CloseWithError(err)
			return
		}

		writeErrCh <- nil
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, pr)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = resp.Status
		}
		// Also surface any error that occurred while streaming multipart.
		select {
		case werr := <-writeErrCh:
			if werr != nil {
				msg = msg + ": " + werr.Error()
			}
		default:
		}
		return nil, 0, fmt.Errorf("gotenberg convert failed: %s", msg)
	}

	// Ensure the multipart goroutine didn't fail.
	select {
	case werr := <-writeErrCh:
		if werr != nil {
			_ = resp.Body.Close()
			return nil, 0, werr
		}
	default:
		// It may still be copying; allow response streaming.
	}

	return resp.Body, resp.ContentLength, nil
}
