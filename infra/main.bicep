// infra/main.bicep
// CSA Swarm Platform — Azure infrastructure
// Deploys: Container Apps (backend + frontend), Cosmos DB NoSQL (serverless),
//          ACR, AI Services (AI Foundry hub + project + gpt-4o), Log Analytics,
//          Entra app registration, managed identities, role assignments

extension 'br:mcr.microsoft.com/bicep/extensions/microsoftgraph/beta:0.1.8-preview'

targetScope = 'resourceGroup'

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Environment suffix (dev, staging, prod)')
param envSuffix string = 'dev'

@description('Foundry model deployment name')
param foundryModelDeploymentName string = 'gpt-4o'

var prefix         = 'csa-swarm-${envSuffix}'
var acrName        = 'csaswarm${replace(envSuffix, '-', '')}${uniqueString(resourceGroup().id)}'
var aiServicesName = 'csaswarm-ai-${uniqueString(resourceGroup().id)}'
var aiStorageName  = 'csast${uniqueString(resourceGroup().id)}'
var aiKvName       = 'csakv${uniqueString(resourceGroup().id)}'
// Placeholder images used during initial provision — azd deploy replaces these with real ACR images
var backendImage   = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var frontendImage  = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var entraTenantId  = tenant().tenantId

// ── Virtual Network ────────────────────────────────────────────────────────
// Two subnets:
//   container-apps-infra — /23 dedicated to Container Apps environment (Azure requirement)
//   private-endpoints    — /27 for Cosmos DB (and future) private endpoints
// This is required so Container Apps can reach Cosmos DB via private link,
// making publicNetworkAccess: Disabled on Cosmos DB irrelevant (SFI-proof).
resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.0.0.0/16']
    }
    subnets: [
      {
        name: 'container-apps-infra'
        properties: {
          addressPrefix: '10.0.0.0/23'
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.0.2.0/27'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// ── Log Analytics (for Container Apps environment) ───────────────────────
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── AI Storage + Key Vault (AI Foundry Hub dependencies) ────────────────
resource aiHubStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: aiStorageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
}

resource aiHubKv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: aiKvName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    accessPolicies: []
    enableRbacAuthorization: false
  }
}

// ── Azure AI Services (AI Foundry model backend) ─────────────────────────
resource aiServices 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: aiServicesName
  location: location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    publicNetworkAccess: 'Enabled'
    customSubDomainName: aiServicesName
  }
}

resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: foundryModelDeploymentName
  sku: {
    name: 'Standard'
    capacity: 10  // 10K tokens per minute
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-11-20'
    }
  }
}

// ── AI Foundry Hub ───────────────────────────────────────────────────────
resource aiHub 'Microsoft.MachineLearningServices/workspaces@2024-04-01' = {
  name: '${prefix}-hub'
  location: location
  kind: 'Hub'
  identity: { type: 'SystemAssigned' }
  properties: {
    friendlyName: '${prefix} AI Hub'
    storageAccount: aiHubStorage.id
    keyVault: aiHubKv.id
  }
}

// Connect AI Services account to the Hub
resource aiServicesConnection 'Microsoft.MachineLearningServices/workspaces/connections@2024-04-01' = {
  parent: aiHub
  name: '${prefix}-aiservices'
  properties: {
    category: 'AIServices'
    target: aiServices.properties.endpoint
    authType: 'AAD'
    isSharedToAll: true
    metadata: {
      ApiType: 'Azure'
      ResourceId: aiServices.id
    }
  }
}

// ── AI Foundry Project ───────────────────────────────────────────────────
resource aiProject 'Microsoft.MachineLearningServices/workspaces@2024-04-01' = {
  name: '${prefix}-project'
  location: location
  kind: 'Project'
  identity: { type: 'SystemAssigned' }
  properties: {
    friendlyName: '${prefix} AI Project'
    hubResourceId: aiHub.id
  }
}

// ── Container Registry ──────────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false  // managed identity pull only
  }
}

// ── Container Apps Environment (VNet-injected) ──────────────────────────
// NOTE: VNet configuration cannot be changed on an existing environment.
// If updating from a non-VNet environment, delete the old environment and
// apps first, then redeploy:  see deployment instructions in README.
resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: '${vnet.id}/subnets/container-apps-infra'
      internal: false  // external ingress (public FQDNs) still works
    }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// Compute FQDNs deterministically from environment domain to avoid
// circular dependency between backend and frontend modules.
var backendFqdn  = '${prefix}-backend.${containerAppsEnv.properties.defaultDomain}'
var frontendFqdn = '${prefix}-frontend.${containerAppsEnv.properties.defaultDomain}'

// AI Foundry endpoints derived from provisioned resources
// NOTE: The `services.ai.azure.com/api/projects/` API requires a Foundry-native project,
// not an ML Hub-backed project. The agents use the Azure OpenAI endpoint directly.
var foundryProjectEndpoint = 'https://${aiServices.name}.services.ai.azure.com/api/projects/${aiProject.name}'
var foundryOpenAIEndpoint  = 'https://${aiServices.name}.openai.azure.com'

// ── Cosmos DB ────────────────────────────────────────────────────────────
module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    accountName: '${prefix}-cosmos'
    privateEndpointSubnetId: '${vnet.id}/subnets/private-endpoints'
    vnetId: vnet.id
  }
}

// ── Entra ID app registration (via Microsoft Graph extension) ─────────────
// NOTE: Using 'existing' to reference the pre-created app reg.
// The registration was created on first deployment. Re-creating it fails with
// "Permission cannot be deleted or updated unless disabled first" when the scope
// already exists and is enabled. Reading an existing resource avoids that conflict.
resource appReg 'Microsoft.Graph/applications@beta' existing = {
  uniqueName: '${prefix}-webapp'
}
// NOTE: identifierUris (api://<appId>) is set via azd postprovision hook in azure.yaml
// because Bicep does not allow self-referencing appReg.appId inside its own declaration.

var entraClientId = appReg.appId

// ── Backend Container App ────────────────────────────────────────────────
module backend 'modules/containerapp.bicep' = {
  name: 'backend'
  params: {
    appName: '${prefix}-backend'
    location: location
    environmentId: containerAppsEnv.id
    image: backendImage
    registryServer: acr.properties.loginServer
    azdServiceName: 'backend'
    targetPort: 8000
    minReplicas: 0
    env: [
      { name: 'FOUNDRY_PROJECT_ENDPOINT',      value: foundryProjectEndpoint }
      { name: 'FOUNDRY_OPENAI_ENDPOINT',       value: foundryOpenAIEndpoint }
      { name: 'FOUNDRY_MODEL_DEPLOYMENT_NAME', value: foundryModelDeploymentName }
      { name: 'COSMOS_ENDPOINT',               value: cosmos.outputs.cosmosEndpoint }
      { name: 'COSMOS_DATABASE',               value: cosmos.outputs.cosmosDatabaseName }
      { name: 'COSMOS_CONTAINER',              value: cosmos.outputs.cosmosContainerName }
      { name: 'COSMOS_KEY',                    value: '' }   // blank → managed identity
      { name: 'ENTRA_TENANT_ID',               value: entraTenantId }
      { name: 'ENTRA_CLIENT_ID',               value: entraClientId }
      { name: 'AUTH_ENABLED',                  value: 'true' }
      { name: 'CORS_ORIGINS',                  value: 'https://${frontendFqdn}' }
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
    registryServer: acr.properties.loginServer
    azdServiceName: 'frontend'
    targetPort: 3000
    minReplicas: 0
    env: [
      { name: 'BACKEND_URL',               value: 'https://${backendFqdn}' }
      { name: 'NEXT_PUBLIC_ENTRA_CLIENT_ID', value: entraClientId }
      { name: 'NEXT_PUBLIC_ENTRA_TENANT_ID', value: entraTenantId }
      { name: 'NEXT_PUBLIC_AUTH_ENABLED',    value: 'true' }
    ]
  }
}

// ── Cognitive Services OpenAI User role for backend → AI Services ─────────
// Role: Cognitive Services OpenAI User (5e0bd9bd-7b93-4f28-af87-19fc36ad61bd)
resource foundryRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiServices.id, '${prefix}-backend', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  scope: aiServices
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: backend.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Azure AI Developer role for backend → AI Foundry Project ─────────────
// Role: Azure AI Developer (64702f94-c441-49e6-a78b-ef80e0188fee)
resource backendAiDeveloper 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiProject.id, '${prefix}-backend', '64702f94-c441-49e6-a78b-ef80e0188fee')
  scope: aiProject
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '64702f94-c441-49e6-a78b-ef80e0188fee')
    principalId: backend.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Cosmos DB Data Contributor role for backend ──────────────────────────
// Built-in Cosmos DB Data Contributor role ID — use vars to avoid nested quote issues
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'
var cosmosAccountResId = resourceId('Microsoft.DocumentDB/databaseAccounts', '${prefix}-cosmos')
var cosmosRoleAssignmentGuid = guid(cosmosAccountResId, '${prefix}-backend', cosmosDataContributorRoleId)

resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-02-15-preview' = {
  name: '${prefix}-cosmos/${cosmosRoleAssignmentGuid}'
  properties: {
    roleDefinitionId: '${cosmos.outputs.cosmosAccountId}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: backend.outputs.principalId
    scope: cosmos.outputs.cosmosAccountId
  }
}

// ── AcrPull role for backend + frontend → ACR ────────────────────────────
// Role: AcrPull (7f951dda-4ed3-4680-a7ca-43fe172d538d)
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource backendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, '${prefix}-backend', acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: backend.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

resource frontendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, '${prefix}-frontend', acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: frontend.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────
// AZURE_CONTAINER_REGISTRY_ENDPOINT is the azd convention for ACR discovery
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.properties.loginServer
output acrName           string = acrName
output backendUrl        string = 'https://${backend.outputs.fqdn}'
output frontendUrl       string = 'https://${frontend.outputs.fqdn}'
output foundryEndpoint   string = foundryProjectEndpoint
output entraClientIdOut  string = entraClientId
