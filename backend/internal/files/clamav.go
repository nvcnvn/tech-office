package files

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strings"
)

// ClamAVClient handles virus scanning using ClamAV TCP protocol
type ClamAVClient struct {
	host string
	port string
}

// NewClamAVClient creates a new ClamAVClient
func NewClamAVClient(host string, port string) *ClamAVClient {
	return &ClamAVClient{
		host: host,
		port: port,
	}
}

// ScanStream scans a data stream for viruses using zINSTREAM
// Returns true if clean, false if virus found (and virus name)
func (c *ClamAVClient) ScanStream(ctx context.Context, r io.Reader) (bool, string, error) {
	slog.DebugContext(ctx, "ClamAVClient.ScanStream started")

	conn, err := net.Dial("tcp", net.JoinHostPort(c.host, c.port))
	if err != nil {
		return false, "", fmt.Errorf("failed to connect to ClamAV: %w", err)
	}
	defer conn.Close()

	// Send zINSTREAM command
	// Prefix with z to indicate null-terminated command (though INSTREAM uses size chunks)
	// Protocol format:
	// Command: "zINSTREAM\0"
	// Chunks: <length><data>
	// End: <0>
	// Response: "stream: <result> FOUND\0" or "stream: OK\0"

	if _, err := conn.Write([]byte("zINSTREAM\000")); err != nil {
		return false, "", fmt.Errorf("failed to send zINSTREAM command: %w", err)
	}

	// Stream chunks
	buf := make([]byte, 4096)
	for {
		// Read chunk from input stream
		n, err := r.Read(buf)
		if n > 0 {
			// Write chunk length (4 bytes network byte order)
			if err := binary.Write(conn, binary.BigEndian, uint32(n)); err != nil {
				return false, "", fmt.Errorf("failed to write chunk length: %w", err)
			}
			// Write chunk data
			if _, err := conn.Write(buf[:n]); err != nil {
				return false, "", fmt.Errorf("failed to write chunk data: %w", err)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return false, "", fmt.Errorf("failed to read from input stream: %w", err)
		}
	}

	// Write zero length to signal end of stream
	if err := binary.Write(conn, binary.BigEndian, uint32(0)); err != nil {
		return false, "", fmt.Errorf("failed to write end of stream: %w", err)
	}

	// Read response (null terminated)
	// We'll read until 0 byte or EOF
	var response []byte
	responseBuf := make([]byte, 1024)
	n, err := conn.Read(responseBuf)
	if err != nil && err != io.EOF {
		return false, "", fmt.Errorf("failed to read response: %w", err)
	}
	response = responseBuf[:n]

	responseStr := strings.TrimSpace(string(response))
	responseStr = strings.TrimRight(responseStr, "\x00") // Remove null terminator if present

	slog.DebugContext(ctx, "ClamAV scan completed", "response", responseStr)

	// Clean: "stream: OK"
	// Virus: "stream: <virus_name> FOUND"
	if strings.Contains(responseStr, "OK") {
		return true, "", nil
	}

	if strings.Contains(responseStr, "FOUND") {
		// Format: "stream: <virus_name> FOUND"
		parts := strings.Split(responseStr, " ")
		if len(parts) >= 3 {
			// Extract virus name (middle part usually, or parse more carefully)
			// Example: "stream: Eicar-Test-Signature FOUND"
			// Just remove "stream: " prefix and " FOUND" suffix
			virusName := strings.TrimPrefix(responseStr, "stream: ")
			virusName = strings.TrimSuffix(virusName, " FOUND")
			return false, virusName, nil
		}
		return false, "Unknown Virus", nil
	}

	return false, "", fmt.Errorf("unexpected response from ClamAV: %s", responseStr)
}
