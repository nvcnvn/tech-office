package voice

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"strings"
	"time"

	lkauth "github.com/livekit/protocol/auth"
	lklivekit "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

type RoomOptions struct {
	OrganizationID dbuuid.UUID
	ChannelID      dbuuid.UUID
	CallID         dbuuid.UUID
	RoomName       string
}

type JoinTokenOptions struct {
	EmployeeID dbuuid.UUID
	RoomName   string
	Identity   string
}

type JoinCredentials struct {
	LiveKitURL string
	Token      string
	RoomName   string
	ExpiresAt  time.Time
}

type RecordingOptions struct {
	OrganizationID dbuuid.UUID
	CallID         dbuuid.UUID
	RoomName       string
	FileID         dbuuid.UUID
}

type RecordingStart struct {
	EgressID string
	FileID   dbuuid.UUID
	FilePath string
}

type LiveKitClient struct {
	config        Config
	roomService   *lksdk.RoomServiceClient
	egressService *lksdk.EgressClient
}

func NewLiveKitClient(config Config) *LiveKitClient {
	return &LiveKitClient{
		config:        config,
		roomService:   lksdk.NewRoomServiceClient(config.LiveKitURL, config.LiveKitAPIKey, config.LiveKitAPISecret),
		egressService: lksdk.NewEgressClient(config.LiveKitURL, config.LiveKitAPIKey, config.LiveKitAPISecret),
	}
}

func (c *LiveKitClient) EnsureRoom(ctx context.Context, opts RoomOptions) error {
	metadata, err := json.Marshal(map[string]string{
		"organizationId": opts.OrganizationID.String(),
		"channelId":      opts.ChannelID.String(),
		"callId":         opts.CallID.String(),
		"mediaMode":      "audio_only",
		"qualityPolicy":  c.config.QualityPolicy,
	})
	if err != nil {
		return fmt.Errorf("build livekit room metadata: %w", err)
	}

	_, err = c.roomService.CreateRoom(ctx, &lklivekit.CreateRoomRequest{
		Name:             opts.RoomName,
		EmptyTimeout:     60,
		DepartureTimeout: 30,
		MaxParticipants:  uint32(c.config.MaxParticipants),
		Metadata:         string(metadata),
	})
	if err != nil && !isLiveKitAlreadyExists(err) {
		return fmt.Errorf("create livekit room: %w", err)
	}
	return nil
}

func (c *LiveKitClient) MintJoinCredentials(_ context.Context, opts JoinTokenOptions) (*JoinCredentials, error) {
	publish, subscribe, data := true, true, true
	grant := &lkauth.VideoGrant{
		RoomJoin: true,
		Room:     opts.RoomName,
	}
	grant.CanPublish = &publish
	grant.CanSubscribe = &subscribe
	grant.CanPublishData = &data
	grant.SetCanPublishSources([]lklivekit.TrackSource{lklivekit.TrackSource_MICROPHONE})

	expiresAt := time.Now().Add(c.config.JoinTokenTTL)
	token, err := lkauth.NewAccessToken(c.config.LiveKitAPIKey, c.config.LiveKitAPISecret).
		SetIdentity(opts.Identity).
		SetName(opts.EmployeeID.String()).
		SetValidFor(c.config.JoinTokenTTL).
		SetVideoGrant(grant).
		ToJWT()
	if err != nil {
		return nil, fmt.Errorf("mint livekit join token: %w", err)
	}

	return &JoinCredentials{
		LiveKitURL: c.config.PublicLiveKitURL,
		Token:      token,
		RoomName:   opts.RoomName,
		ExpiresAt:  expiresAt,
	}, nil
}

func (c *LiveKitClient) StartRoomRecording(ctx context.Context, opts RecordingOptions) (*RecordingStart, error) {
	if !c.config.RecordingEnabled {
		return nil, fmt.Errorf("voice recording is disabled")
	}
	filePath := path.Join(strings.Trim(c.config.RecordingPrefix, "/"), opts.OrganizationID.String(), opts.CallID.String(), opts.FileID.String()+".ogg")
	egressInfo, err := c.egressService.StartRoomCompositeEgress(ctx, &lklivekit.RoomCompositeEgressRequest{
		RoomName:  opts.RoomName,
		AudioOnly: true,
		FileOutputs: []*lklivekit.EncodedFileOutput{
			{
				FileType: lklivekit.EncodedFileType_OGG,
				Filepath: filePath,
				Output: &lklivekit.EncodedFileOutput_S3{S3: &lklivekit.S3Upload{
					AccessKey:      c.config.RecordingAccessKeyID,
					Secret:         c.config.RecordingSecretAccessKey,
					Region:         c.config.RecordingRegion,
					Endpoint:       c.config.RecordingEndpoint,
					Bucket:         c.config.RecordingBucket,
					ForcePathStyle: c.config.RecordingForcePathStyle,
					Metadata: map[string]string{
						"organizationId": opts.OrganizationID.String(),
						"callId":         opts.CallID.String(),
						"fileId":         opts.FileID.String(),
						"encoding":       "opus/ogg",
					},
				}},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("start livekit room recording: %w", err)
	}
	return &RecordingStart{EgressID: egressInfo.GetEgressId(), FileID: opts.FileID, FilePath: filePath}, nil
}

func isLiveKitAlreadyExists(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "already") && strings.Contains(message, "exist")
}
