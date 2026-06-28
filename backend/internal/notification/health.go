package notification

import (
	"encoding/json"
	"net/http"
	"time"
)

// HealthStatus represents the response from /healthz
type HealthStatus struct {
	Status            string `json:"status"` // "ok" or "degraded"
	InstanceID        string `json:"instance_id"`
	ConsumerStatus    string `json:"consumer_status"`
	ActiveConnections int    `json:"active_connections"`
	ReconnectCount    int32  `json:"reconnect_count"`
	LastError         string `json:"last_error,omitempty"`
	UptimeSeconds     int64  `json:"uptime_seconds"`
}

// InstanceStatus represents the detailed response from /api/internal/status
type InstanceStatus struct {
	HealthStatus
	ConsumerLastActive *time.Time `json:"consumer_last_active,omitempty"`
	ConsumerStaleFor   string     `json:"consumer_stale_for,omitempty"`
	ListenTopic        string     `json:"listen_topic"`
	ListenConnAlive    bool       `json:"listen_conn_alive"`
}

// NewHealthHandler returns an HTTP handler for /healthz.
// Returns 200 when consumer is running, 503 when degraded/stopped.
func NewHealthHandler(s *NotificationService) http.Handler {
	startTime := time.Now()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := "ok"
		httpCode := http.StatusOK

		consumerStatus, _ := s.consumerStatus.Load().(string)
		if consumerStatus == "" {
			consumerStatus = "unknown"
		}

		switch consumerStatus {
		case "running":
			// Check if consumer is stale
			if lastActive, ok := s.lastConsumerActive.Load().(time.Time); ok {
				if time.Since(lastActive) > 5*time.Minute && s.ActiveConnectionCount() > 0 {
					status = "degraded"
					httpCode = http.StatusServiceUnavailable
				}
			}
		case "reconnecting":
			status = "degraded"
			httpCode = http.StatusServiceUnavailable
		case "stopped":
			status = "degraded"
			httpCode = http.StatusServiceUnavailable
		}

		lastErr, _ := s.lastError.Load().(string)

		resp := HealthStatus{
			Status:            status,
			InstanceID:        s.InstanceID,
			ConsumerStatus:    consumerStatus,
			ActiveConnections: s.ActiveConnectionCount(),
			ReconnectCount:    s.reconnectCount.Load(),
			LastError:         lastErr,
			UptimeSeconds:     int64(time.Since(startTime).Seconds()),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpCode)
		json.NewEncoder(w).Encode(resp)
	})
}

// NewStatusHandler returns an HTTP handler for /api/internal/status.
// Returns detailed instance status as JSON (similar to CLI sse-connections output).
func NewStatusHandler(s *NotificationService) http.Handler {
	startTime := time.Now()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		consumerStatus, _ := s.consumerStatus.Load().(string)
		if consumerStatus == "" {
			consumerStatus = "unknown"
		}

		lastErr, _ := s.lastError.Load().(string)

		status := "ok"
		switch consumerStatus {
		case "reconnecting", "stopped":
			status = "degraded"
		}

		resp := InstanceStatus{
			HealthStatus: HealthStatus{
				Status:            status,
				InstanceID:        s.InstanceID,
				ConsumerStatus:    consumerStatus,
				ActiveConnections: s.ActiveConnectionCount(),
				ReconnectCount:    s.reconnectCount.Load(),
				LastError:         lastErr,
				UptimeSeconds:     int64(time.Since(startTime).Seconds()),
			},
			ListenTopic:     listenTopicForInstance(s.InstanceID),
			ListenConnAlive: s.ListenConn != nil && !s.ListenConn.IsClosed(),
		}

		if lastActive, ok := s.lastConsumerActive.Load().(time.Time); ok {
			resp.ConsumerLastActive = &lastActive
			resp.ConsumerStaleFor = time.Since(lastActive).Round(time.Second).String()
		}

		// Check for stale consumer with active connections
		if lastActive, ok := s.lastConsumerActive.Load().(time.Time); ok {
			if time.Since(lastActive) > 5*time.Minute && s.ActiveConnectionCount() > 0 {
				resp.Status = "degraded"
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})
}
