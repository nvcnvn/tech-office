package interceptor

import (
	"context"
	"log/slog"

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

			resp, err := next(ctx, req)

			if err != nil {
				logger.Error("RPC call error",
					slog.String("procedure", req.Spec().Procedure),
					slog.String("peer_addr", req.Peer().Addr),
					slog.Any("error", err),
				)
			} else {
				logger.Info("RPC call successful",
					slog.String("procedure", req.Spec().Procedure),
					slog.String("peer_addr", req.Peer().Addr),
				)
			}
			return resp, err
		})
	})
}
