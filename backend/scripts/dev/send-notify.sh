#!/bin/bash

ORG_ID="019a206c-2146-7140-bee9-b591e1a92c3b"
USER_ID="019a206c-2149-7e30-a21a-659413c1c71a"
NOW=$(date +"%Y-%m-%d %H:%M:%S")
# Send a real notification
go run ./cmd tools sendNotify \
  --run-as ROLE_SYSTEM \
  --to-org-id $ORG_ID \
  --to-user-id $USER_ID \
  --title "Welcome again! {$NOW}" \
  --message "Your account is ready"