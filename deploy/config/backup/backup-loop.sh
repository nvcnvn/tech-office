#!/bin/bash
# pgBackRest scheduler. One decision per hour, on the hour:
#
#   full         on BACKUP_FULL_ON_WEEKDAY at BACKUP_FULL_AT_HOUR
#   diff         at BACKUP_DIFF_AT_HOUR
#   incr         every other hour (unless BACKUP_INCREMENTAL_ENABLED=0)
#
# Deliberately not cron: one process, container logs, and no second scheduler to
# keep alive inside the container.
set -uo pipefail

STANZA=techoffice
METRICS=/metrics/pgbackrest.prom
PGBR=(pgbackrest --stanza="$STANZA")

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

write_metrics() {
	local type="$1" status="$2" started="$3" ended="$4"
	# node_exporter reads this directory with --collector.textfile.directory.
	# Written to a temp file and moved so a scrape never sees a half-written file.
	cat >"${METRICS}.tmp" <<-PROM
	# HELP techoffice_pgbackrest_last_backup_timestamp_seconds Unix time the last backup of this type finished.
	# TYPE techoffice_pgbackrest_last_backup_timestamp_seconds gauge
	techoffice_pgbackrest_last_backup_timestamp_seconds{type="${type}"} ${ended}
	# HELP techoffice_pgbackrest_last_backup_status Exit status of the last backup attempt (0 = success).
	# TYPE techoffice_pgbackrest_last_backup_status gauge
	techoffice_pgbackrest_last_backup_status{type="${type}"} ${status}
	# HELP techoffice_pgbackrest_last_backup_duration_seconds Duration of the last backup attempt.
	# TYPE techoffice_pgbackrest_last_backup_duration_seconds gauge
	techoffice_pgbackrest_last_backup_duration_seconds{type="${type}"} $((ended - started))
	PROM
	mv "${METRICS}.tmp" "$METRICS"
}

run_backup() {
	local type="$1" started ended status
	started=$(date +%s)
	log "starting ${type} backup"
	"${PGBR[@]}" --type="$type" backup
	status=$?
	ended=$(date +%s)
	if [ $status -eq 0 ]; then
		log "${type} backup finished in $((ended - started))s"
		# expire drops backups (and the WAL they needed) beyond repo1-retention-full.
		"${PGBR[@]}" expire || log "WARNING: expire failed, repository will keep growing"
	else
		log "ERROR: ${type} backup failed with status ${status}"
	fi
	write_metrics "$type" "$status" "$started" "$ended"
}

# Wait for Postgres to accept connections before touching the stanza.
until pg_isready -q; do
	log "waiting for postgres"
	sleep 5
done

# Idempotent: creates the stanza on first run, no-ops afterwards.
"${PGBR[@]}" stanza-create || log "stanza-create returned non-zero (usually means it already exists)"
"${PGBR[@]}" check || log "WARNING: pgbackrest check failed — archiving or the repository is misconfigured"

# A stanza with no full backup can restore nothing, and WAL archiving has nothing to
# anchor to. Take one immediately rather than waiting for the schedule.
if ! "${PGBR[@]}" info --output=json | grep -q '"type":"full"'; then
	log "no full backup in the repository yet"
	run_backup full
fi

while true; do
	# Sleep to the next hour boundary so the schedule does not drift with runtime.
	sleep $(( 3600 - $(date +%s) % 3600 ))

	hour=$(date -u +%-H)
	weekday=$(date -u +%w)

	if [ "$weekday" = "$BACKUP_FULL_ON_WEEKDAY" ] && [ "$hour" = "$BACKUP_FULL_AT_HOUR" ]; then
		run_backup full
	elif [ "$hour" = "$BACKUP_DIFF_AT_HOUR" ]; then
		run_backup diff
	elif [ "$BACKUP_INCREMENTAL_ENABLED" = "1" ]; then
		run_backup incr
	fi
done
