// infra/modules/cosmos.bicep
@description('Location for Cosmos DB account')
param location string

@description('Cosmos DB account name')
param accountName string

@description('Database name')
param databaseName string = 'csa_swarm'

@description('Container name')
param containerName string = 'swarm'

// ── Cosmos DB account (serverless, NoSQL) ───────────────────────────────
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-02-15-preview' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true  // enforce Entra ID / managed identity
    publicNetworkAccess: 'Enabled'
    networkAclBypass: 'AzureServices'  // allow all Azure-internal services (Container Apps, etc.)
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-02-15-preview' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: cosmosDb
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: ['/session_id']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }, { path: '/content/?' }]
      }
    }
  }
}

// ── Cosmos DB Built-in Data Contributor role assignment is handled in main.bicep
// to avoid a circular dependency with the backend module.

output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output cosmosDatabaseName string = databaseName
output cosmosContainerName string = containerName
output cosmosAccountId string = cosmosAccount.id
output cosmosAccountName string = cosmosAccount.name
