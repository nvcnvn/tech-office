FROM golang:1.25-bookworm AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY database ./database
COPY internal ./internal
COPY rpc ./rpc

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
	go build -trimpath -ldflags='-s -w' -o /out/tech-office ./cmd

FROM gcr.io/distroless/base-debian12:nonroot

WORKDIR /app

COPY --from=builder /out/tech-office /usr/local/bin/tech-office

EXPOSE 18080

ENTRYPOINT ["/usr/local/bin/tech-office"]