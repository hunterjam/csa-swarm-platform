// infra/main.bicep
// CSA Swarm Platform — Azure infrastructure
// Deploys: Container Apps (backend + frontend), Cosmos DB NoSQL (serverless),
//          Key Vault, managed identities, role assignments

targetScope = 'resourceGroup'

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Environment suffix (dev, staging, prod)')
param envSuffix string = 'dev'

@description('Container registry where images are pushed (e.g. myacr.azurecr.io)')
param containerRegistry string

@description('Backend image tag')
param backendImageTag string = 'latest'

@description('Frontend image tag')
param frontendImageTag string = 'latest'

@description('Azure AI Foundry project endpoint')
param foundryProjectEndpoint string

@description('Foundry model deployment name')
param foundryModelDeploymentName string = 'gpt-4o'

@description('Entra ID tenant ID')
param entraTenantId string

@description('Entra ID client ID (app registration)')
param entraClientId string

var prefix = 'csa-swarm-${envSuffix}'
var backendImage  = '${containerRegistry}/csa-swarm-backend:${backendImageTag}'
var frontendImage = '${containerRegistry}/csa-swarm-frontend:${frontendImageTag}'

// ── Log Analytics (for Container Apps environment) ───────────────────────
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Container Apps Environment ───────────────────────────────────────────
resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ── Cosmos DB ────────────────────────────────────────────────────────────
module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    accountName: '${prefix}-cosmos'
    principalIds: [backend.outputs.principalId]
  }
}

// ── Backend Container App ────────────────────────────────────────────────
module backend 'modules/containerapp.bicep' = {
  name: 'backend'
  params: {
    appName: '${prefix}-backend'
    location: location
    environmentId: containerAppsEnv.id
    image: backendImage
    targetPort: 8000
    env: [
      { name: 'FOUNDRY_PROJECT_ENDPOINT',      value: foundryProjectEndpoint }
      { name: 'FOUNDRY_MODEL_DEPLOYMENT_NAME', value: foundryModelDeploymentName }
      { name: 'COSMOS_ENDPOINT',               value: cosmos.outputs.cosmosEndpoint }
      { name: 'COSMOS_DATABASE',               value: cosmos.outputs.cosmosDatabaseName }
      { name: 'COSMOS_CONTAINER',              value: cosmos.outputs.cosmosContainerName }
      { name: 'COSMOS_KEY',                    value: '' }   // blank → managed identity
      { name: 'ENTRA_TENANT_ID',               value: entraTenantId }
      { name: 'ENTRA_CLIENT_ID',               value: entraClientId }
      { name: 'AUTH_ENABLED',                  value: 'true' }
      { name: 'CORS_ORIGINS',                  value: 'https://${frontend.outputs.fqdn}' }
    ]
  }
}

// ── Frontend Container App ───────────────────────────────────────────────
module frontend 'modules/containerapp.bicep' = {
  name: 'frontend'
  params: {
    appName: '${prefix}-frontend'
    location: location
    environmentId: containerAppsEnv.id
    image: frontendImage
    targetPort: 3000
    env: [
      { name: 'NEXT_PUBLIC_API_URL',         value: 'https://${backend.outputs.fqdn}' }
      { name: 'NEXT_PUBLIC_ENTRA_CLIENT_ID', value: entraClientId }
      { name: 'NEXT_PUBLIC_ENTRA_TENANT_ID', value: entraTenantId }
      { name: 'NEXT_PUBLIC_AUTH_ENABLED',    value: 'true' }
    ]
  }
}

// ── Cognitive Services OpenAI User role for backend → Foundry ────────────
// Role: Cognitive Services OpenAI User (5e0bd9bd-7b93-4f28-af87-19fc36ad61bd)
resource foundryRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, backend.outputs.principalId, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: backend.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────
output backendUrl  string = 'https://${backend.outputs.fqdn}'
output frontendUrl string = 'https://${frontend.outputs.fqdn}'
output cosmosEndpoint string = cosmos.outputs.cosmosEndpoint
