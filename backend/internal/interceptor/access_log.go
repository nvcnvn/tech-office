package interceptor

import (
	"context"
	"log/slog"
	"time"

	"connectrpc.com/connect"
)

// AccessLogInterceptor logs information using a structured logger.
func AccessLogInterceptor(logger *slog.Logger) connect.UnaryInterceptorFunc {
	return connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return connect.UnaryFunc(func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			logger.Info("Incoming RPC call",
				slog.String("procedure", req.Spec().Procedure),
				slog.String("peer_addr", req.Peer().Addr),
			)

			start := time.Now()
			resp, err := next(ctx, req)
			durationMS := time.Since(start).Milliseconds()

			if err != nil {
				logger.Error("RPC call error",
					slog.String("procedure", req.Spec().Procedure),
					slog.String("peer_addr", req.Peer().Addr),
					slog.Int64("duration_ms", durationMS),
					slog.Any("error", err),
				)
			} else {
				logger.Info("RPC call successful",
					slog.String("procedure", req.Spec().Procedure),
					slog.String("peer_addr", req.Peer().Addr),
					slog.Int64("duration_ms", durationMS),
				)
			}
			return resp, err
		})
	})
}
