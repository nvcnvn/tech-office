package main

import (
	"context"
	"log"
	"log/slog"
	"os"

	"github.com/lmittmann/tint"
	"github.com/urfave/cli/v3"
)

func main() {
	w := os.Stderr

	// Set global logger with custom options
	slog.SetDefault(slog.New(
		tint.NewHandler(w, &tint.Options{
			Level: slog.LevelDebug,
		}),
	))
	cmd := &cli.Command{
		Commands: []*cli.Command{
			StartServer,
			ToolsCommand,
			SeedDemoOrgCommand,
			HealthcheckCommand,
		},
	}

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		log.Fatal(err)
	}
}
