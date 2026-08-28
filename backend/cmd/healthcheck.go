package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/nvcnvn/tech-office/backend/internal/config"
)

// HealthcheckCommand exists so a container orchestrator can probe this process.
// The production image is distroless — it has no curl, no wget and no shell — so the
// binary has to be able to check itself. Without it Swarm marks a task healthy the
// moment it starts, and a rolling update sends traffic to an instance that is still
// opening its database pools.
var HealthcheckCommand = &cli.Command{
	Name:   "healthcheck",
	Usage:  "probe this instance's /healthz endpoint and exit non-zero when it is unhealthy",
	Action: runHealthcheck,
}

func runHealthcheck(ctx context.Context, _ *cli.Command) error {
	url := fmt.Sprintf("http://127.0.0.1:%s/healthz", config.Get().ServerPort)

	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned %d", url, resp.StatusCode)
	}
	return nil
}
