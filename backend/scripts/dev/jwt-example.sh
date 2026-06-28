#!/bin/bash
# Example: Test notification system with dev JWT

set -e

echo "🔧 Dev JWT Testing Example"
echo "=========================="
echo ""

# Configuration
ORG_ID="01932b8e-1234-7890-abcd-ef1234567890"
USER_ID="test-user-123"
SERVER_URL="http://localhost:18080"

# Generate token
echo "1️⃣  Generating dev token..."
TOKEN=$(cd backend && go run ./cmd tools token \
  --org-id="$ORG_ID" \
  --user-id="$USER_ID" \
  --email="test@example.com" \
  --roles=ROLE_ADMIN \
  --roles=ROLE_EMPLOYEE | grep "eyJ" | head -1)

echo "✅ Token generated"
echo ""

# Send notification using dev token (this actually sends the notification!)
echo "2️⃣  Sending test notification via RPC..."
cd backend && go run ./cmd tools sendNotify \
  --run-as=ROLE_SYSTEM \
  --to-org-id="$ORG_ID" \
  --to-user-id="$USER_ID" \
  --title="Dev Test" \
  --message="This is a test from dev JWT example"

echo ""
echo "3️⃣  Check your notification stream to see if it arrived!"
echo ""
echo "📝 The token is also available if you want to use it manually:"
echo ""
echo "export DEV_TOKEN=\"$TOKEN\""
echo ""
echo "curl $SERVER_URL/api.v1.NotificationService/ListNotifications \\"
echo "  -H \"Authorization: Bearer \$DEV_TOKEN\""
