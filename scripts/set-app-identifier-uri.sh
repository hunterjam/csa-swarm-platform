#!/usr/bin/env sh
# postprovision hook: sets api://<clientId> identifierURI and access_as_user scope
# on the App Registration.
# This step cannot be done in Bicep because identifierUris requires the appId,
# which creates a self-reference cycle in the Graph Bicep extension.
set -e

CLIENT_ID=$(azd env get-value entraClientIdOut 2>/dev/null || true)

if [ -z "$CLIENT_ID" ]; then
  echo "WARN: entraClientIdOut not found in azd env — skipping identifierUri patch."
  exit 0
fi

OBJECT_ID=$(az ad app show --id "$CLIENT_ID" --query id --output tsv 2>/dev/null || true)
if [ -z "$OBJECT_ID" ]; then
  echo "WARN: Could not find app registration with clientId $CLIENT_ID — skipping."
  exit 0
fi

echo "Patching identifierUris for app $CLIENT_ID (objectId: $OBJECT_ID)..."
az ad app update --id "$OBJECT_ID" --identifier-uris "api://$CLIENT_ID"

# Use a fixed, deterministic scope GUID derived from the app uniqueName
SCOPE_ID="d57f0629-6ef9-55c2-899d-4f71d27803d1"

echo "Patching oauth2PermissionScopes (access_as_user)..."
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$OBJECT_ID" \
  --headers "Content-Type=application/json" \
  --body "{
    \"api\": {
      \"oauth2PermissionScopes\": [
        {
          \"id\": \"$SCOPE_ID\",
          \"adminConsentDescription\": \"Allow the app to access the API on behalf of the signed-in user.\",
          \"adminConsentDisplayName\": \"Access the API\",
          \"userConsentDescription\": \"Allow the app to access the API on your behalf.\",
          \"userConsentDisplayName\": \"Access the API\",
          \"isEnabled\": true,
          \"type\": \"User\",
          \"value\": \"access_as_user\"
        }
      ]
    }
  }"

echo "Done. identifierUri=api://$CLIENT_ID  scope=access_as_user"
