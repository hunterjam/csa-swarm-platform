// infra/modules/cosmos.bicep
@description('Location for Cosmos DB account')
param location string

@description('Cosmos DB account name')
param accountName string

@description('Database name')
param databaseName string = 'csa_swarm'

@description('Container name')
param containerName string = 'swarm'

@description('Principal IDs that need Cosmos DB Data Contributor access')
param principalIds array = []

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

// Cosmos DB Built-in Data Contributor role
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-02-15-preview' = [for (principalId, i) in principalIds: {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, principalId, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: principalId
    scope: cosmosAccount.id
  }
}]

output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output cosmosDatabaseName string = databaseName
output cosmosContainerName string = containerName
