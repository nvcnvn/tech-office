package files

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2Config holds Cloudflare R2 configuration
type R2Config struct {
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	BucketName      string
	Endpoint        string
	// PublicURL is the custom domain bound to the bucket (e.g.
	// https://transformar.file.devguards.com). When set, downloads are served from it
	// instead of presigned S3-endpoint URLs — R2 presigned URLs only work against
	// the S3 API host, so the custom domain is protected by a Cloudflare WAF
	// token-auth rule instead. Requires PublicHMACSecret.
	PublicURL string
	// PublicHMACSecret is the shared secret of that WAF rule's
	// is_timed_hmac_valid_v0() call.
	PublicHMACSecret string
}

// R2Client handles interactions with Cloudflare R2 storage
type R2Client struct {
	client        *s3.Client
	presignClient *s3.PresignClient
	bucketName    string
	publicURL     string
	hmacSecret    string
}

func validateR2Config(cfg R2Config) error {
	missingFields := make([]string, 0, 4)

	if strings.TrimSpace(cfg.AccessKeyID) == "" {
		missingFields = append(missingFields, "R2_ACCESS_KEY_ID")
	}
	if strings.TrimSpace(cfg.SecretAccessKey) == "" {
		missingFields = append(missingFields, "R2_SECRET_ACCESS_KEY")
	}
	if strings.TrimSpace(cfg.BucketName) == "" {
		missingFields = append(missingFields, "R2_BUCKET_NAME")
	}
	if strings.TrimSpace(cfg.Endpoint) == "" {
		missingFields = append(missingFields, "R2_ENDPOINT")
	}

	if strings.TrimSpace(cfg.PublicURL) != "" && strings.TrimSpace(cfg.PublicHMACSecret) == "" {
		missingFields = append(missingFields, "R2_PUBLIC_URL_HMAC_SECRET")
	}

	if len(missingFields) > 0 {
		return fmt.Errorf("missing R2 configuration: %s", strings.Join(missingFields, ", "))
	}

	return nil
}

// NewR2Client creates a new R2Client instance
func NewR2Client(cfg R2Config) (*R2Client, error) {
	if err := validateR2Config(cfg); err != nil {
		return nil, err
	}

	// Create custom endpoint resolver for R2
	customResolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:               cfg.Endpoint,
				SigningRegion:     "auto",
				HostnameImmutable: true,
			}, nil
		},
	)

	// Load AWS config with R2 credentials
	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion("auto"),
		config.WithEndpointResolverWithOptions(customResolver),
		config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				cfg.AccessKeyID,
				cfg.SecretAccessKey,
				"",
			),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Create S3 client
	s3Client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		// Cloudflare R2 is S3-compatible but does not reliably support the AWS SDK's
		// automatic request checksum workflow for streaming uploads (e.g. CRC32 via
		// checksum headers/trailers). This can cause 400 BadDigest errors.
		//
		// Only compute request checksums when the operation requires it or when the
		// caller explicitly sets a checksum algorithm.
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	})
	presignClient := s3.NewPresignClient(s3Client)

	return &R2Client{
		client:        s3Client,
		presignClient: presignClient,
		bucketName:    cfg.BucketName,
		publicURL:     strings.TrimRight(cfg.PublicURL, "/"),
		hmacSecret:    cfg.PublicHMACSecret,
	}, nil
}

// GeneratePresignedUploadURL generates a presigned PUT URL for file upload
func (r *R2Client) GeneratePresignedUploadURL(ctx context.Context, storageKey string, contentType string, expiresIn time.Duration) (string, time.Time, error) {
	slog.DebugContext(ctx, "R2Client.GeneratePresignedUploadURL",
		"storage_key", storageKey,
		"content_type", contentType,
		"expires_in", expiresIn)

	putObjectInput := &s3.PutObjectInput{
		Bucket:      aws.String(r.bucketName),
		Key:         aws.String(storageKey),
		ContentType: aws.String(contentType),
	}

	presignedReq, err := r.presignClient.PresignPutObject(ctx, putObjectInput,
		s3.WithPresignExpires(expiresIn),
	)
	if err != nil {
		slog.ErrorContext(ctx, "failed to generate presigned upload URL",
			"error", err,
			"storage_key", storageKey)
		return "", time.Time{}, fmt.Errorf("failed to generate presigned upload URL: %w", err)
	}

	expiresAt := time.Now().Add(expiresIn)

	slog.InfoContext(ctx, "generated presigned upload URL",
		"storage_key", storageKey,
		"expires_at", expiresAt)

	return presignedReq.URL, expiresAt, nil
}

// GenerateDownloadURL returns a time-limited download URL for a stored object.
//
// With a custom domain configured it is a Cloudflare token-auth URL
// (https://<domain>/<key>?verify=<ts>-<mac>), validated at the edge by a WAF rule
// whose token_lifetime_seconds must match expiresIn; otherwise it is a presigned
// URL against the R2 S3 endpoint.
func (r *R2Client) GenerateDownloadURL(ctx context.Context, storageKey string, expiresIn time.Duration) (string, time.Time, error) {
	slog.DebugContext(ctx, "R2Client.GenerateDownloadURL",
		"storage_key", storageKey,
		"expires_in", expiresIn)

	if r.publicURL != "" {
		downloadURL, expiresAt := r.signedPublicURL(storageKey, expiresIn)
		slog.InfoContext(ctx, "generated signed public download URL",
			"storage_key", storageKey,
			"expires_at", expiresAt)
		return downloadURL, expiresAt, nil
	}

	getObjectInput := &s3.GetObjectInput{
		Bucket: aws.String(r.bucketName),
		Key:    aws.String(storageKey),
	}

	presignedReq, err := r.presignClient.PresignGetObject(ctx, getObjectInput,
		s3.WithPresignExpires(expiresIn),
	)
	if err != nil {
		slog.ErrorContext(ctx, "failed to generate presigned download URL",
			"error", err,
			"storage_key", storageKey)
		return "", time.Time{}, fmt.Errorf("failed to generate presigned download URL: %w", err)
	}

	expiresAt := time.Now().Add(expiresIn)

	slog.InfoContext(ctx, "generated presigned download URL",
		"storage_key", storageKey,
		"expires_at", expiresAt)

	return presignedReq.URL, expiresAt, nil
}

// signedPublicURL builds a Cloudflare token-auth URL: the MAC is
// base64(HMAC-SHA256(secret, path+timestamp)), and the edge rule
// is_timed_hmac_valid_v0(secret, http.request.uri, <lifetime>, http.request.timestamp.sec, 8)
// recomputes it — 8 being len("?verify=").
func (r *R2Client) signedPublicURL(storageKey string, expiresIn time.Duration) (string, time.Time) {
	issuedAt := time.Now()
	path := "/" + strings.TrimLeft(storageKey, "/")
	timestamp := strconv.FormatInt(issuedAt.Unix(), 10)

	mac := hmac.New(sha256.New, []byte(r.hmacSecret))
	mac.Write([]byte(path + timestamp))
	token := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return fmt.Sprintf("%s%s?verify=%s-%s", r.publicURL, path, timestamp, url.QueryEscape(token)),
		issuedAt.Add(expiresIn)
}

// DeleteObject deletes a file from R2 bucket
func (r *R2Client) DeleteObject(ctx context.Context, storageKey string) error {
	slog.DebugContext(ctx, "R2Client.DeleteObject",
		"storage_key", storageKey)

	deleteObjectInput := &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucketName),
		Key:    aws.String(storageKey),
	}

	_, err := r.client.DeleteObject(ctx, deleteObjectInput)
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete object from R2",
			"error", err,
			"storage_key", storageKey)
		return fmt.Errorf("failed to delete object: %w", err)
	}

	slog.InfoContext(ctx, "deleted object from R2",
		"storage_key", storageKey)

	return nil
}

// ReadRange reads a byte range from an object in R2
// Returns the requested bytes or an error if the read fails
func (r *R2Client) ReadRange(ctx context.Context, storageKey string, start int64, length int64) ([]byte, error) {
	slog.DebugContext(ctx, "R2Client.ReadRange",
		"storage_key", storageKey,
		"start", start,
		"length", length)

	// Construct Range header: "bytes=start-end" (end is inclusive)
	rangeHeader := fmt.Sprintf("bytes=%d-%d", start, start+length-1)

	getObjectInput := &s3.GetObjectInput{
		Bucket: aws.String(r.bucketName),
		Key:    aws.String(storageKey),
		Range:  aws.String(rangeHeader),
	}

	result, err := r.client.GetObject(ctx, getObjectInput)
	if err != nil {
		slog.ErrorContext(ctx, "failed to read range from R2",
			"error", err,
			"storage_key", storageKey,
			"range", rangeHeader)
		return nil, fmt.Errorf("failed to read object range: %w", err)
	}
	defer result.Body.Close()

	// Read exactly the requested byte range from the response body
	data := make([]byte, length)
	n, err := io.ReadFull(result.Body, data)
	if err != nil && err != io.ErrUnexpectedEOF {
		slog.ErrorContext(ctx, "failed to read response body",
			"error", err,
			"storage_key", storageKey)
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	slog.DebugContext(ctx, "successfully read range from R2",
		"storage_key", storageKey,
		"bytes_read", n)

	// Return only the bytes that were actually read
	return data[:n], nil
}

// GetReader returns an io.ReadCloser for the entire object in R2
func (r *R2Client) GetReader(ctx context.Context, storageKey string) (io.ReadCloser, error) {
	slog.DebugContext(ctx, "R2Client.GetReader",
		"storage_key", storageKey)

	getObjectInput := &s3.GetObjectInput{
		Bucket: aws.String(r.bucketName),
		Key:    aws.String(storageKey),
	}

	result, err := r.client.GetObject(ctx, getObjectInput)
	if err != nil {
		slog.ErrorContext(ctx, "failed to get object reader from R2",
			"error", err,
			"storage_key", storageKey)
		return nil, fmt.Errorf("failed to get object: %w", err)
	}

	return result.Body, nil
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// PutObject uploads an object to R2 from a streaming reader.
// Returns the number of bytes read from body.
func (r *R2Client) PutObject(ctx context.Context, storageKey string, contentType string, body io.Reader) (int64, error) {
	slog.DebugContext(ctx, "R2Client.PutObject",
		"storage_key", storageKey,
		"content_type", contentType)

	// Cloudflare R2 may reject chunked transfer encoding for PutObject and require an
	// explicit Content-Length header (411 MissingContentLength). Since many callers
	// provide a streaming reader (e.g. conversion output), buffer into memory so we
	// can set ContentLength deterministically.
	const maxBufferedUploadBytes int64 = 150 * 1024 * 1024 // 150MB safety cap
	limited := io.LimitReader(body, maxBufferedUploadBytes+1)
	buf, err := io.ReadAll(limited)
	if err != nil {
		return 0, fmt.Errorf("failed to read upload body: %w", err)
	}
	if int64(len(buf)) > maxBufferedUploadBytes {
		return 0, fmt.Errorf("upload body too large: %w", errors.New("exceeds max buffered size"))
	}

	contentLength := int64(len(buf))
	br := bytes.NewReader(buf)
	cr := &countingReader{r: br}

	putObjectInput := &s3.PutObjectInput{
		Bucket:        aws.String(r.bucketName),
		Key:           aws.String(storageKey),
		Body:          cr,
		ContentType:   aws.String(contentType),
		ContentLength: &contentLength,
	}

	_, err = r.client.PutObject(ctx, putObjectInput)
	if err != nil {
		slog.ErrorContext(ctx, "failed to upload object to R2",
			"error", err,
			"storage_key", storageKey)
		return cr.n, fmt.Errorf("failed to put object: %w", err)
	}

	slog.InfoContext(ctx, "uploaded object to R2",
		"storage_key", storageKey,
		"bytes", cr.n,
		"content_length", contentLength)

	return cr.n, nil
}
