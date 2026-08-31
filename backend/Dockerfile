# Cross-compile from the builder's native architecture rather than emulating the
# target: pure-Go builds do this for free, and QEMU would make the multi-arch
# publish job take hours.
FROM --platform=$BUILDPLATFORM golang:1.27-bookworm AS builder

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY database ./database
COPY internal ./internal
COPY rpc ./rpc

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
	go build -trimpath -ldflags='-s -w' -o /out/tech-office ./cmd

FROM gcr.io/distroless/base-debian12:nonroot

WORKDIR /app

COPY --from=builder /out/tech-office /usr/local/bin/tech-office

EXPOSE 18080

ENTRYPOINT ["/usr/local/bin/tech-office"]